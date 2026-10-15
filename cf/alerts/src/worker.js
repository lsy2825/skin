// 가격 알림 (yoonsiljang-alerts): Web Push subscriptions in D1 and a once-a-week bundled push, Cloudflare free plan.
//   POST   /v1/push/subscribe       {subscription, rules} → 201 {id}       (the phone keeps the id; nothing personal stored)
//   PUT    /v1/push/rules/{id}      {rules}               → 200 {ok:true} | 404 (subscribe again); rules [] DELETES the row
//                                                            (200 {ok:true}; afterwards that id answers 404)
//   DELETE /v1/push/subscribe/{id}                        → 204
//   GET    /health (= /v1/health)                         → 200 {ok:true, window, sending, finished, stale, capacity}
//                                                            | 503 {ok:false} when D1 fails
//   /v1/internal/{watched,digest,finish,send}             → the price factory (weekly.yml → notify.mjs), Bearer ALERTS_SECRET
//   cron '*/10 23,0-11 * * *' (UTC = 08:00–20:50 KST)     → send(): at most SEND_LIMIT pushes per run
// No Cloudflare imports, so node tests import this file and pass their own env (DB = a D1-shaped wrapper over node:sqlite).
// src/index.js re-exports only the default handler (a Worker entry may export nothing else).
//
// Free-plan arithmetic (re-check when changing the cron, SEND_LIMIT or MAX_SUBS):
//   runs that may send: the cron fires 13 h × 6 = 78 times a day; inWindow() refuses 20:50 → 77 runs (08:00 … 20:40 KST)
//   pushes: 77 runs × SEND_LIMIT 40 = 3,080 a day = 21,560 a week
//   need: each phone gets ≤ 1 weekly bundle + expiring pushes (≤ 1 a day; budget ~1 a week) ≈ 2 pushes a week
//         → 21,560 / 2 = 10,780 phones; MAX_SUBS 8,000 leaves ~25% for retries, 429-paused hosts and runs cut at 20:45.
//         That is an average: a day with more due than 3,080 (Monday's weekly news + month-end deadlines) sends expiring
//         rows first, nearest end date first (CLAIM_X), so a deadline is not queued behind weekly news that can wait
//   subrequests per run: ≤ 40 push fetches (redirects never followed, so 1 each) of the 50 external allowed; D1 = 2 batch
//         calls of the 1,000 allowed to Cloudflare services
//   D1 writes (100,000 a day): a push ≈ 6 rows (claim + result, with index entries) → ≤ ~18,500 a day; new subscriptions
//         ≤ NEW_PER_DAY 2,000 × ~6 rows (row, endpoint index, 2 counters, the 'day' marker) ≈ 12,000; the factory's digest ≈ 1
//         row per pair
//   D1 reads (5,000,000 a day; the free limit is enforced since 2026-09-01: a day over it fails every query until
//         00:00 UTC = 09:00 KST, which /health shows as 503): an empty cron run reads ~0 rows (partial indexes
//         subs_due/subs_claim/subs_x hold only rows with something pending); with P rows pending, each of the three claims
//         (CLAIM_X/CLAIM_W/CLAIM_F) walks its index in order and stops after its share of SEND_LIMIT due rows — worst case
//         (every pending row walked, none due) 3 × P per run = 3 × 77 × 8,000 ≈ 1.85M a day, DROP_ENDED another ≤ P per
//         run; the factory's finish ≈ 4 scans of subs (PRUNE_XSENT, MARK_WEEKLY, MARK_EXPIRING, CLEAR_STALE_X) + ≤ 20 snap
//         primary-key lookups per subscription in each MARK/CLEAR (json_each × snap) ≈ 3 × 8,000 × 20 = 480,000 → worst day
//         ≈ 3M of 5M; a normal day (a few hundred pending rows) is far below 1M
//   CPU (10 ms): one ES256 signature per push origin per 11 h (cached in D1), JSON of ≤ 40 rows
import { ID_RE, validDay, validRun, FINISH_SLACK_DAYS, daysBetween, newId, kstDay, addDays, inWindow, pushTtl, dueKinds, outcome,
  hostTrouble, capacityOf, STALE_DAYS, validateRules, cleanEntry, clientKey, RETRY_DROP, REFUSED_DROP, NEVER_DROP, FAIL_SLOTS,
  ABORT_EVIDENCE } from "./rules.js";
import { checkSubscription, vapidJwt, keysMatch, pushRequest } from "./push.js";
import * as Q from "./sql.js";

export const SEND_LIMIT = 40;          // pushes per run: free plan allows 50 outside requests per invocation
export const MAX_SUBS = 8000;          // what the cron can serve (arithmetic above); wrangler.jsonc vars.MAX_SUBS. Nothing evicts: full = 503 FULL
export const NEW_PER_DAY = 2000;       // new subscriptions per KST day (D1 Free: 100,000 rows written a day)
const PARALLEL = 6;                    // the runtime runs at most 6 outside fetches at once anyway
const PUBLIC_MAX = 8 * 1024, INTERNAL_MAX = 256 * 1024;
const PAGE = 2000, DIGEST_MAX = 500;

const json = (data, status = 200, extra = {}) =>
  new Response(data === null ? null : JSON.stringify(data), { status, headers: { ...(data === null ? {} : { "content-type": "application/json; charset=utf-8" }), ...extra } });

// constant-time comparison (cf/factory/src/runs.js sameSecret); empty never matches
export function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

class Bad extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

// the body, at most max bytes, read as a stream with a running count (a body without Content-Length cannot make the
// Worker buffer more than max): too big → 413 (stream cancelled), the client going away mid-body → 400
async function readCapped(request, max) {
  const declared = request.headers.get("content-length");
  if (declared !== null && !(/^\d+$/.test(declared) && Number(declared) <= max)) throw new Bad(413, "TOO_LARGE");
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    let step;
    try { step = await reader.read(); } catch { throw new Bad(400, "BAD_JSON"); }
    if (step.done) break;
    total += step.value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); throw new Bad(413, "TOO_LARGE"); }
    chunks.push(step.value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

// JSON body with a size cap. application/json or text/plain (so the app may send a simple request); the Origin check is
// separate.
async function readJson(request, max) {
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type && type !== "application/json" && type !== "text/plain") throw new Bad(400, "BAD_JSON");
  const buf = await readCapped(request, max);
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { throw new Bad(400, "BAD_JSON"); }
}

function allowedOrigins(env) {
  return [env.ALLOWED_ORIGIN, ...String(env.DEV_ORIGINS || "").split(",")].map((s) => (s || "").trim()).filter(Boolean);
}
// browsers send Origin on cross-site calls: only the app's own origin gets CORS; a foreign Origin is refused.
// (Not a security boundary — the 128-bit id, the host allow-list, size caps and the rate limits are.)
function cors(request, env) {
  const o = request.headers.get("origin");
  if (!o) return { ok: true, headers: {} };
  if (!allowedOrigins(env).includes(o)) return { ok: false, headers: { vary: "Origin" } };
  return { ok: true, headers: { "access-control-allow-origin": o, vary: "Origin" } };
}

const bearer = (request) => { const h = request.headers.get("authorization") || ""; return h.startsWith("Bearer ") ? h.slice(7) : ""; };
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

async function subscribe(request, env, now) {
  const body = await readJson(request, PUBLIC_MAX);
  const sub = checkSubscription(body && body.subscription);
  if (sub.error) throw new Bad(400, sub.error);
  const v = validateRules(body.rules);
  // an empty subscription would never send and sit in D1 for ever
  if (v.error || !v.rules.length) throw new Bad(400, "BAD_RULES");
  // Per-client rate limit (after validation, so junk requests do not use it up). The key is the connecting IP
  // (cf-connecting-ip): IPv4 as is, IPv6 cut to its /64 (rules.js clientKey — one client usually holds a whole /64). It
  // goes ONLY to the Rate Limiting binding, whose counter lives in Cloudflare's memory at that location for the 60-second
  // period: it is never written to D1, never logged, never returned. Missing binding (node tests, a local run without
  // it) → no check.
  if (env.SUBS_RL) {
    const key = clientKey(request.headers.get("cf-connecting-ip"));
    if (!(await env.SUBS_RL.limit({ key })).success) throw new Bad(429, "RATE_LIMITED");
  }
  const today = kstDay(now), max = num(env.MAX_SUBS, MAX_SUBS), perDay = num(env.NEW_PER_DAY, NEW_PER_DAY);
  // one batch: the Worker's own KST day first (the subs_ins trigger names today's 'new:' counter from it), then the INSERT
  const res = await env.DB.batch([
    env.DB.prepare(Q.SET_DAY).bind(Number(today.replace(/-/g, ""))),
    env.DB.prepare(Q.SUBSCRIBE).bind(newId(), sub.endpoint, JSON.stringify(v.rules), today, max, perDay),
  ]);
  const row = res[1] && res[1].results && res[1].results[0];
  if (!row) {
    const c = await env.DB.prepare(Q.SUBS_COUNTS).bind(today).first();
    // today's new-subscription budget used up: 429 (checked first, so a flood does not read as "full"); else the table is
    // full: 503 FULL. Nothing is evicted — GET /health "capacity" tells the operator (the monitor warns), who purges or
    // raises MAX_SUBS.
    if (!c || c.today >= perDay) throw new Bad(429, "RATE_LIMITED");
    throw new Bad(503, "FULL");
  }
  return { status: 201, body: { id: row.id } };
}

async function putRules(request, env, id) {
  if (!ID_RE.test(id)) throw new Bad(404, "NOT_FOUND");
  const body = await readJson(request, PUBLIC_MAX);
  const v = validateRules(body && body.rules);
  if (v.error) throw new Bad(400, v.error);
  // no rules left = the phone switched every alert off: the row is deleted (unknown id → 404 as for any other PUT)
  const row = v.rules.length
    ? await env.DB.prepare(Q.PUT_RULES).bind(id, JSON.stringify(v.rules)).first()
    : await env.DB.prepare(Q.DELETE_SUB_RETURNING).bind(id).first();
  if (!row) throw new Bad(404, "NOT_FOUND");
  return { status: 200, body: { ok: true } };
}

async function unsubscribe(env, id) {
  if (ID_RE.test(id)) await env.DB.prepare(Q.DELETE_SUB).bind(id).run();
  return { status: 204, body: null };
}

// ---- factory side (Bearer ALERTS_SECRET; never CORS)
async function watched(env, url) {
  const after = (url.searchParams.get("after") || "|").split("|");
  const k = after[0] || "", r = after.slice(1).join("|") || "";
  const { results } = await env.DB.prepare(Q.WATCHED).bind(k, r, PAGE).all();
  const pairs = (results || []).map((x) => ({ k: x.k, r: x.r }));
  const last = pairs[pairs.length - 1];
  return { pairs, next: pairs.length === PAGE ? `${last.k}|${last.r}` : null };
}

async function digest(request, env) {
  const body = await readJson(request, INTERNAL_MAX);
  if (!body || !validRun(body.run) || !Array.isArray(body.entries) || body.entries.length > DIGEST_MAX) throw new Bad(400, "BAD_DIGEST");
  const entries = body.entries.map(cleanEntry);
  if (entries.some((e) => !e)) throw new Bad(400, "BAD_DIGEST");
  if (entries.length) await env.DB.prepare(Q.DIGEST).bind(body.run, JSON.stringify(entries)).run();
  return { saved: entries.length };
}

// one atomic batch: mark the phones, THEN promote the pending numbers to the baseline (a failure promotes nothing).
// Every date here comes from the Worker's own clock (today = kstDay(now)): the body's `today` and the run's day part only
// have to agree with it (calendar dates within FINISH_SLACK_DAYS, else 400 BAD_FINISH and nothing is touched), so the
// factory token can neither wipe past days' budgets with a far-future day nor pin /health "finished".
async function finish(request, env, now) {
  const body = await readJson(request, INTERNAL_MAX);
  const today = kstDay(now);
  if (!body || !validRun(body.run) || !validDay(body.today)) throw new Bad(400, "BAD_FINISH");
  if (Math.abs(daysBetween(body.today, today)) > FINISH_SLACK_DAYS || body.run.split("|")[1] !== body.today) throw new Bad(400, "BAD_FINISH");
  const res = await env.DB.batch([
    env.DB.prepare(Q.PRUNE_XSENT).bind(today),
    env.DB.prepare(Q.MARK_WEEKLY),
    env.DB.prepare(Q.MARK_EXPIRING).bind(body.run),
    env.DB.prepare(Q.CLEAR_STALE_X).bind(body.run),
    env.DB.prepare(Q.PROMOTE),
    env.DB.prepare(Q.PRUNE_SNAP).bind(body.run),
    env.DB.prepare(Q.PRUNE_STAT).bind(today),
    env.DB.prepare(Q.ROLL_BU),
    env.DB.prepare(Q.STAT_FINISH).bind(Number(today.replace(/-/g, ""))),
  ]);
  const ch = (i) => (res[i] && res[i].meta && res[i].meta.changes) || 0;
  const out = { weekly: ch(1), expiring: ch(2), changed: ch(4) };
  console.log("alerts finish", JSON.stringify(out));
  return out;
}

// ---- one send run (cron, or POST /v1/internal/send). Counts only in logs — never ids or endpoints.
// nowMs = when the run starts: the REAL time (scheduled() passes the later of scheduledTime and Date.now(), so a cron run
// that starts late is judged by the clock, not by its schedule). clock() = the time right now, read before every push: by
// default nowMs plus the real time elapsed since the call (Date.now() advances with every I/O in a Worker); tests pass
// their own clock.
export async function send(env, nowMs = Date.now(), { fetch: f = fetch, clock } = {}) {
  const started = Date.now();
  const now = clock || (() => nowMs + (Date.now() - started));
  const out = { sent: 0, gone: 0, retry: 0, refused: 0, stopped: 0, held: 0 };
  if (!inWindow(nowMs)) { console.log("alerts send: outside 08:00-20:45 KST"); return { ...out, skipped: "window" }; }
  const pub = env.VAPID_PUBLIC_KEY || "", priv = env.VAPID_PRIVATE_JWK || "";
  if (!pub || !priv) { console.log("alerts send: VAPID keys not set"); return { ...out, skipped: "keys" }; }
  if (!keysMatch(pub, priv)) { console.error("alerts send: VAPID private key does not match VAPID_PUBLIC_KEY"); return { ...out, skipped: "keys" }; }
  const today = kstDay(nowMs), minute = Math.floor(nowMs / 60e3), nowS = Math.floor(nowMs / 1000);
  const limit = num(env.SEND_LIMIT, SEND_LIMIT), weekAgo = addDays(today, -7);
  const [, , cache, cx, cw, cf] = await env.DB.batch([
    env.DB.prepare(Q.RESET_STALE).bind(minute),
    env.DB.prepare(Q.DROP_ENDED).bind(today),
    env.DB.prepare(Q.VAPID_CACHE),
    env.DB.prepare(Q.CLAIM_X).bind(minute, weekAgo, today, limit),
    env.DB.prepare(Q.CLAIM_W).bind(minute, weekAgo, today, limit),
    env.DB.prepare(Q.CLAIM_F).bind(minute, weekAgo, today, limit, FAIL_SLOTS),
  ]);
  // RETURNING gives rows in table order, not in the ORDER BY of the claim: sort again (nearest deadline first, then the
  // weekly queue longest wait first, then the few rows that failed before: fewest failures first)
  const by = (...f) => (a, b) => { for (const g of f) { const x = g(a), y = g(b); if (x !== y) return x < y ? -1 : 1; } return 0; };
  const subs = [...(cx.results || []).sort(by((r) => r.pend_x)),
    ...(cw.results || []).sort(by((r) => r.last_w || "")),
    ...(cf.results || []).sort(by((r) => r.fails, (r) => r.last_w || ""))];
  if (!subs.length) return out;

  // one JWT per push origin, cached in D1 (keyed with the public key, so a new key never uses an old token)
  const tag = pub.slice(0, 12);
  const jwts = new Map(), fresh = [];
  for (const c of cache.results || []) if (c.aud.startsWith(tag + " ") && c.exp - nowS > 3600) jwts.set(c.aud.slice(tag.length + 1), c.jwt);
  const stmts = [], slowHosts = new Set(), refused = [], trouble = [], okOrigins = new Set();
  let abort = false, evidence = 0;
  const result = (s, what, due) => {
    if (what === "sent") { out.sent++; stmts.push(env.DB.prepare(Q.SENT).bind(s.id, due.weekly ? 1 : 0, due.expiring ? 1 : 0, today, s.pend_x ?? null, s.pend_xl ?? null)); }
    else if (what === "gone") { out.gone++; stmts.push(env.DB.prepare(Q.GONE).bind(s.id)); }
    else if (what === "retry") { out.retry++; stmts.push(env.DB.prepare(Q.RETRY).bind(s.id), env.DB.prepare(Q.DROP_FAILING).bind(s.id, RETRY_DROP, NEVER_DROP)); }
    else { out.stopped++; stmts.push(env.DB.prepare(Q.RELEASE).bind(s.id)); }
  };
  async function one(s) {
    const due = dueKinds(s, today);
    if (!due.weekly && !due.expiring) return result(s, "stopped", due);       // claimed but nothing due after all
    let origin;
    try { origin = new URL(s.endpoint).origin; } catch { return result(s, "gone", due); }
    if (abort || slowHosts.has(origin)) return result(s, "stopped", due);
    if (!jwts.has(origin))   // a promise, so parallel pushes to one origin sign once
      jwts.set(origin, vapidJwt(origin, priv, env.VAPID_SUBJECT || env.ALLOWED_ORIGIN, nowMs).then((t) => {
        fresh.push(env.DB.prepare(Q.SAVE_JWT).bind(`${tag} ${origin}`, t.jwt, t.exp));
        return t.jwt;
      }));
    const jwt = await jwts.get(origin);
    // the window is checked again right before this push, and the TTL is computed from this moment: a run that is
    // still going at 20:45 stops, and no push can arrive after 21:00
    const t = now();
    if (abort || !inWindow(t)) { if (!abort) { abort = true; out.closed = true; } return result(s, "stopped", due); }
    const req = pushRequest(s.endpoint, jwt, pub, pushTtl(t));
    let status = 0;
    try { status = (await f(req.url, { ...req.init, signal: AbortSignal.timeout(8000) })).status; } catch { status = 0; }
    const what = outcome(status);
    if (what === "sent") okOrigins.add(origin);
    if (what === "slow") { slowHosts.add(origin); return result(s, "stopped", due); }
    if (what === "refused") {
      // decided after the run (below). Evidence that OUR setup is wrong: a phone that took our pushes before and had no
      // failure since now refuses the token. Enough of it with nothing sent → stop sending in this run.
      refused.push(s);
      if (s.fails === 0 && (s.last_w || s.last_x)) evidence++;
      if (out.sent === 0 && evidence >= ABORT_EVIDENCE) abort = true;
      return;
    }
    // the push SERVICE having trouble (5xx, redirect, timeout) is decided after the run: it counts against the row only if
    // that origin also took another push in this run (below)
    if (what === "retry" && hostTrouble(status)) { trouble.push({ s, origin, due }); return; }
    return result(s, what, due);
  }
  for (let i = 0; i < subs.length; i += PARALLEL) await Promise.all(subs.slice(i, i + PARALLEL).map(one));
  // a push origin that answered 5xx / a redirect / timed out for a row but took another push 2xx in this run: the service
  // was up, so that failure is the row's (counted, RETRY_DROP / NEVER_DROP). An origin with no 2xx in this run may simply
  // be down: its rows are released unchanged (fails does not move) — an hour of push-service trouble deletes nobody.
  for (const t of trouble) {
    if (okOrigins.has(t.origin)) result(t.s, "retry", t.due);
    else { out.held++; stmts.push(env.DB.prepare(Q.RELEASE).bind(t.s.id)); }
  }
  // 401/403 rows: one more failure each (they leave the fails = 0 queues for CLAIM_F's few slots). Removed after
  // REFUSED_DROP in a row, a row that never received a push at its first refusal — except in a run that looks like our own
  // setup is broken (configBroken): then nobody is removed.
  const configBroken = out.sent === 0 && evidence >= ABORT_EVIDENCE;
  for (const s of refused) {
    out.refused++;
    stmts.push(env.DB.prepare(Q.RETRY).bind(s.id));
    if (!configBroken) stmts.push(env.DB.prepare(Q.DROP_REFUSED).bind(s.id, REFUSED_DROP));
  }
  if (configBroken) { out.aborted = true; console.error("alerts send: phones that took our pushes before now refuse the VAPID token — stopped this run"); }
  await env.DB.batch([...fresh, ...stmts, env.DB.prepare(Q.DROP_OLD_JWT).bind(nowS)]);
  console.log("alerts send", JSON.stringify(out));
  return out;
}

async function health(env, now) {
  const sending = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK && keysMatch(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_JWK));
  const h = { "cache-control": "no-store" };
  let row;
  try { row = await env.DB.prepare(Q.HEALTH).first(); }
  catch { console.error("alerts health: D1 did not answer"); return json({ ok: false }, 503, h); }
  // finished: KST day of the last factory finish (null before the first). stale: that finish is more than STALE_DAYS days
  // old (the factory → Worker link stopped; notify.mjs fails quietly, so the monitor reads this). capacity: 'ok' |
  // 'nearly_full' (≥ 80% of MAX_SUBS) | 'full' — nothing is evicted, a person must purge or raise MAX_SUBS; words only.
  const fin = row && row.fin ? String(row.fin) : "";
  const finished = /^\d{8}$/.test(fin) ? `${fin.slice(0, 4)}-${fin.slice(4, 6)}-${fin.slice(6)}` : null;
  const stale = !!finished && validDay(finished) && daysBetween(kstDay(now), finished) > STALE_DAYS;
  const capacity = capacityOf(row && row.subs, num(env.MAX_SUBS, MAX_SUBS));
  return json({ ok: true, window: "08-21 KST", sending, finished, stale, capacity }, 200, h);
}

async function route(request, env, now) {
  const url = new URL(request.url), path = url.pathname, m = request.method;
  if ((path === "/health" || path === "/v1/health") && m === "GET") return health(env, now);

  if (path.startsWith("/v1/push/")) {
    const c = cors(request, env);
    if (!c.ok) return json({ error: "FORBIDDEN_ORIGIN" }, 403, c.headers);
    if (m === "OPTIONS")
      return new Response(null, { status: 204, headers: { ...c.headers, "access-control-allow-methods": "POST, PUT, DELETE", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
    let r;
    try {
      const seg = path.split("/");                      // ['', 'v1', 'push', 'subscribe' | 'rules', id?]
      if (m === "POST" && path === "/v1/push/subscribe") r = await subscribe(request, env, now);
      else if (m === "PUT" && seg[3] === "rules" && seg.length === 5) r = await putRules(request, env, seg[4]);
      else if (m === "DELETE" && seg[3] === "subscribe" && seg.length === 5) r = await unsubscribe(env, seg[4]);
      else r = { status: 404, body: { error: "NOT_FOUND" } };
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      r = { status: e.status, body: { error: e.code } };
    }
    return json(r.body, r.status, c.headers);
  }

  if (path.startsWith("/v1/internal/")) {
    if (!env.ALERTS_SECRET) return json({ error: "NOT_CONFIGURED" }, 503);
    if (!sameSecret(bearer(request), env.ALERTS_SECRET)) return json({ error: "UNAUTHORIZED" }, 401);
    try {
      if (m === "GET" && path === "/v1/internal/watched") return json(await watched(env, url));
      if (m === "POST" && path === "/v1/internal/digest") return json(await digest(request, env));
      if (m === "POST" && path === "/v1/internal/finish") return json(await finish(request, env, now));
      if (m === "POST" && path === "/v1/internal/send") return json(await send(env, now));
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      return json({ error: e.code }, e.status);
    }
  }
  return json({ error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request, env, _ctx, now = Date.now()) {
    // the message only (D1/runtime errors name no request data); never the URL, which may hold a subscription id
    try { return await route(request, env, now); }
    catch (e) { console.error("alerts error", e && e.message); return json({ error: "INTERNAL" }, 500); }
  },
  async scheduled(event, env, ctx) {
    // the real start time: a cron run may start late (it runs when a machine is free), and the window and every TTL must
    // follow the clock, never the schedule
    const start = Math.max(event.scheduledTime || 0, Date.now());
    ctx.waitUntil(send(env, start).catch((e) => console.error("alerts send failed", e && e.message)));
  },
};
