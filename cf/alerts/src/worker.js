// 가격 알림 (yoonsiljang-alerts): Web Push subscriptions in D1 and a once-a-week bundled push, Cloudflare free plan.
//   POST   /v1/push/subscribe       {subscription, rules} → 201 {id}       (the phone keeps the id; nothing personal stored)
//   PUT    /v1/push/rules/{id}      {rules}               → 200 {ok:true} | 404 (unknown id); rules [] DELETES the row
//                                                            (200 {ok:true}; afterwards that id answers 404)
//     both (6th review — fields only added, nothing refused): the rules are stored as sent; when some of their keys are not
//           in the key set of the factory's last data.json, the answer also has "unknown": [those keys] (information only:
//           those pairs are not computed until a later data.json has the key — sql.js UNKNOWN_KEYS, WATCHED)
//   DELETE /v1/push/subscribe/{id}                        → 204
//   GET    /health (= /v1/health)                         → 200 {ok:true, window, sending, key, finished, stale, refusing,
//                                                            capacity, pairs} (health() below) | 503 {ok:false} when D1 fails
//   /v1/internal/{keys,watched,digest,finish,send}        → the price factory (weekly.yml → notify.mjs), Bearer ALERTS_SECRET
//   cron '*/10 23,0-11 * * *' (UTC = 08:00–20:50 KST)     → send(): at most SEND_LIMIT pushes per run
// No Cloudflare imports, so node tests import this file and pass their own env (DB = a D1-shaped wrapper over node:sqlite).
// src/index.js re-exports only the default handler (a Worker entry may export nothing else).
//
// Free-plan arithmetic (re-check when changing the cron, SEND_LIMIT or MAX_SUBS):
//   runs that may send: the cron fires 13 h × 6 = 78 times a day; inWindow() refuses 20:50 → 77 runs (08:00 … 20:40 KST)
//   pushes: 77 runs × SEND_LIMIT 40 = 3,080 a day = 21,560 a week
//   need: each phone gets ≤ 1 weekly bundle a week + pushes with an expiring notice (≤ 1 a day, rules.js dueKinds; budget
//         ~1 a week) ≈ 2 pushes a week
//         → 21,560 / 2 = 10,780 phones; MAX_SUBS 8,000 leaves ~25% for retries, 429-paused hosts and runs cut at 20:45.
//         That is an average: a day with more due than 3,080 (Monday's weekly news + month-end deadlines) sends expiring
//         rows first, nearest end date first (CLAIM_X), so a deadline is not queued behind weekly news that can wait.
//         Rows held back at a push service in trouble (rules.js HOLD) take at most PROBE_SLOTS 10 of a run's 40, and rows
//         that failed before at most FAIL_SLOTS 10
//   subrequests per run: ≤ 40 push fetches (redirects never followed, so 1 each) of the 50 external allowed; D1 = the claim
//         batch + one results batch per parallel group of 6 (≤ 7) + the closing one, each tried at most 3 times → ≤ ~27 of
//         the 1,000 allowed to Cloudflare services
//   HOW OFTEN THE FACTORY CALLS (6th review): weekly.yml runs on every push to main — 26 and 29 runs were counted on
//         2026-10-15/16 UTC — plus the daily schedule and Run workflow. Only the daily SCHEDULE run computes (ALERTS_MODE=full:
//         keys, watched, digest, finish); a run started by a push or by Run workflow sends only the key set (keys: 1 row read,
//         ≤ 1 written); a full run of a data.json finished the same KST day stops at its first watched page (done: 3 rows
//         read, 0 written — sql.js SAME_DATA; a re-run of the schedule's job). So a D1 day holds ONE full computation (the
//         schedule's, 06:00 KST = 21:00 UTC). Left: a schedule run that only computes after 09:00 KST (a run ahead of it in
//         the queue for more than 3 h) shares the next D1 day with that day's own — two computations (below).
//   D1 writes (100,000 rows a day FOR THE WHOLE ACCOUNT, 00:00–24:00 UTC = 09:00–09:00 KST — cf/metrics shares it; since
//         2026-09-01 a free account over it gets an error for EVERY D1 query until 09:00 KST: no finish, no send, no
//         subscribe). D1 counts every row a statement writes plus one per index entry it changes. Rows written per
//         statement, measured on a local D1 (wrangler 4.145.0 / workerd, 2026-10-16; production is assumed to count the same
//         way — a guess), with the snap deletes counted as 2 (row + primary-key entry, as the D1 docs describe):
//           a push: claim 2 + its result (SENT 1; a hold 2 + its later release 2; a counted failure up to 4 — the row and
//             its subs_due, subs_x and subs_fail entries (measured: RETRY of a row with pend_w 1 and pend_x set) — and a
//             delete 2 more) ≤ 8 (≈ 6 on average) → 77 runs × SEND_LIMIT 40 = 3,080 pushes × 8 = 24,640 at most
//           a new subscription: 5 (row, primary-key and endpoint entries, the two counters; the KST day's first one 8 with
//             the 'day' row and the new counter — measured). NEW_PER_DAY is per KST day and a D1 day spans two of them →
//             ≤ 2 × 2,000 × 5 = 20,000. Unknown keys change nothing here (the rules are stored like any others)
//           the factory's finish on subs: PRUNE_XSENT 1 + MARK_WEEKLY 2 (row + subs_due entry) + MARK_EXPIRING 2 or
//             CLEAR_STALE_X 1 (row + subs_x entry) → ≤ 5 rows per subscription on a day every one of them changes every
//             mark → ≤ MAX_SUBS 8,000 × 5 = 40,000. A row that failed before adds its subs_fail entry to each mark (≤ 7);
//             such rows are few: a real phone's push-service trouble or suspect refusal is not counted, and a planted row
//             has no exp_sent (never sent) and is marked weekly once in its life (pend_w stays 1 until a push gets through)
//           the factory's snap: a pair digested again 1, its PROMOTE or ROLL_BU 1, a new pair 2, a pruned pair 2. Pairs are
//             what subscriptions say (up to MAX_SUBS × 20 = 160,000), and a subscription needs no browser (one POST with a
//             made-up endpoint on an allowed host). So (1) watched() ranks only pairs of keys in the factory's key set and
//             cuts the list at PAIR_CAP (sql.js WATCHED: pairs of phones that took a push, then pairs computed in the last
//             PAIR_KEEP_DAYS, then pairs not computed yet, then the rest), and (2) a new pair is added only while snap holds
//             fewer than PAIR_CAP rows (sql.js DIGEST: ≤ PAIR_CAP + 500 rows). With S rows at the start, k digested again, x
//             added and S − k pruned: 2k + 2x + 2(S − k) = 2(x + S) ≤ 2 × (PAIR_CAP + 500) = 7,000 per full computation.
//             Measured with 3,000 real-key pairs (150 phones × 20): the first run 6,005, the next day's 3,001; at the
//             ceiling (8,000 phones × 20 rules, 3,000 pairs computed): 6,003–6,461 for a day of new numbers
//           the factory's key set (sql.js SET_KEYS): 1 row when the data.json's keys changed, 0 when not (one row, INTEGER
//             PRIMARY KEY: no index entry; measured) → ≤ 1 per run that sends it, ≤ 30 a day at the run counts above
//           a finish's own stat rows: 'finish' and 'data' only when they change, 'capped' when the list was cut → ≤ 3
//         → a D1 day where everything peaks at once (a full table whose every row changes every mark, every push at its most
//         rows, two KST days of new subscriptions, a full pair turnover, key sets on 30 runs) ≈ 24,640 + 20,000 + 40,000 +
//         7,000 + 30 + 3 ≈ 91,700 of 100,000; the other runs of the day add nothing (measured: the schedule + 28 push-started
//         runs + a Run workflow + a re-run of the same data = 6,005 rows at 3,000 pairs, where the code of the 5th review
//         wrote 6,004 + 3,001 for EVERY further run). A SECOND full computation the same D1 day (only the late schedule
//         run above) could add up to 7,000 + 40,000 in that same worst case — over the limit; measured, a second day of
//         new numbers writes 3,001–6,461. Not counted: PUT/DELETE and a subscription sent again for the same endpoint
//         (≈ 2–4 rows each, bounded only by the Workers request limit and SUBS_RL), and cf/metrics, which shares the
//         account's limit (src/rules.js there: up to 80,000 rows on a spammed day — the two together can pass it). The
//         levers are NEW_PER_DAY (1,000 → −10,000) and MAX_SUBS (−5 rows a day per subscription less): a user decision
//   D1 reads (5,000,000 a day, the same account-wide D1 day; enforced since 2026-09-01: a day over it fails every query until
//         00:00 UTC = 09:00 KST, which /health shows as 503). Measured on a local D1 at the ceiling (MAX_SUBS 8,000 phones
//         × 20 rules = 160,000 rule entries, real keys × regions, 3,000 pairs computed, PAGE 5,000 = one watched page):
//           one full computation ≤ 988,767: keys 1 + watched 437,746 (subs × rules grouped once — the 5th review's two
//             pages of 2,000 read that twice: 1,246,502 a run) + digest 12,000 (6 chunks) + finish 539,020 (PRUNE_XSENT
//             8,001, MARK_WEEKLY ≈ 174,000, MARK_EXPIRING ≈ 174,000, CLEAR_STALE_X ≈ 174,000 when rows hold a pending
//             expiring, PROMOTE/PRUNE_SNAP/ROLL_BU 3,000 each). Rule mix: all newmatch 808,761, mixed 978,980, all
//             expiring 988,767
//           a key-set-only run 1; a same-data repeat 3; a subscribe 31 (≤ 50 with 20 unknown keys); a PUT ≈ 90
//           one cron run: 26 with nothing pending (the partial indexes hold only rows with something pending); every claim
//             walks its index in order and stops after its share of SEND_LIMIT due rows, so the worst is rows with news
//             waiting that are NOT due: weekly waiting (sent within 7 days) 8,026, expiring waiting (one went out today)
//             16,024 (CLAIM_X + DROP_ENDED), both 24,024 = 3 × MAX_SUBS; 40 due rows 347 → ≤ 77 × 24,024 = 1,849,848 a day.
//             Held rows (H, 0 on a normal day): CLAIM_P reads those whose minute has come once per run and RELEASE_HELD
//             walks them when a push origin answers 2xx again — H = 2,000 adds ≈ 160,000 a day
//         → worst D1 day ≈ 988,767 + 1,849,848 + 160,000 + 2 × 2,000 × 31 (subscribes) + 30 (key sets) ≈ 3.12M of 5M; a
//         normal day (a few hundred pending rows) is far below 1.5M. The late-schedule day above adds ≤ 988,767 more
//         (≈ 4.1M, still under). Not counted: PUT/DELETE (≈ 90 rows read each, bounded only by the Workers request limit)
//         and cf/metrics (shares the account's limit)
//   CPU (10 ms): one ES256 signature per push origin per 11 h (cached in D1), one test signature + verify per run that
//         has a key (push.js vapidKey, before any claim; GET /health does the same), JSON of ≤ 40 rows
// VAPID: only the secret VAPID_PRIVATE_JWK is needed — the public key is derived from it (push.js publicKeyOf). The
//   optional var VAPID_PUBLIC_KEY, when set, must be that same key (else nothing is sent, GET /health sending:false).
import { ID_RE, validDay, validRun, FINISH_SLACK_DAYS, daysBetween, newId, kstDay, addDays, inWindow, pushTtl, dueKinds, outcome,
  hostTrouble, capacityOf, STALE_DAYS, REFUSING_DAYS, CAPPED_DAYS, validateRules, cleanEntry, keySetJson, clientKey, RETRY_DROP, REFUSED_DROP,
  NEVER_DROP, FAIL_SLOTS, REFUSING_GRACE_DAYS, HOLD_MINUTES, SLOW_HOLD_MINUTES, PROBES, PROBE_SLOTS, PAIR_KEEP_DAYS } from "./rules.js";
import { checkSubscription, vapidJwt, vapidKey, pushRequest } from "./push.js";
import * as Q from "./sql.js";

export const SEND_LIMIT = 40;          // pushes per run: free plan allows 50 outside requests per invocation
export const MAX_SUBS = 8000;          // what the cron can serve (arithmetic above); wrangler.jsonc vars.MAX_SUBS. Nothing evicts: full = 503 FULL
export const NEW_PER_DAY = 2000;       // new subscriptions per KST day (D1 Free: 100,000 rows written a day)
// (key, region) pairs the factory digests per run, and the most rows snap holds (+ one digest chunk) — its D1 writes are
// ≤ 2 × (PAIR_CAP + 500) rows per full computation, once a D1 day (arithmetic above). A user decision; wrangler.jsonc vars.PAIR_CAP. Only
// pairs of keys in the factory's key set count (a key the data.json does not have never takes a place). Past it the list
// is cut (sql.js WATCHED: pairs of phones that took a push, then pairs computed this week, then pairs not computed yet,
// then the rest) or a new pair waits for a free row, and GET /health says "pairs": "capped" (the monitor warns)
export const PAIR_CAP = 3000;
const PARALLEL = 6;                    // the runtime runs at most 6 outside fetches at once anyway
const PUBLIC_MAX = 8 * 1024, INTERNAL_MAX = 256 * 1024;
// a watched page holds the whole list (PAGE ≥ PAIR_CAP): every page groups subs × rules again (sql.js WATCHED), so one page
// per factory run reads the table once — 6th review: two pages of 2,000 read it twice (≈ 435,000 rows each at the ceiling)
const PAGE = 5000, DIGEST_MAX = 500;
// a data.json's sha256 (lower-case hex) and its tag in stat 'data': the first 52 bits as a number (exact in JS and SQLite)
const SHA_RE = /^[0-9a-f]{64}$/;
const dataTag = (sha) => parseInt(sha.slice(0, 13), 16);
// waits (ms) before the 2nd and 3rd try of a results batch (D1 retries no write by itself: "Network connection lost",
// "overloaded", "DB reset … retry" are answers a write can get)
const RESULT_WAITS = [100, 400];
// a stat day number (yyyymmdd) → 'YYYY-MM-DD', or null
const dayOfNum = (n) => { const s = n ? String(n) : ""; const d = /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : ""; return validDay(d) ? d : null; };
const dayNum = (day) => Number(day.replace(/-/g, ""));

const json = (data, status = 200, extra = {}) =>
  new Response(data === null ? null : JSON.stringify(data), { status, headers: { ...(data === null ? {} : { "content-type": "application/json; charset=utf-8" }), ...extra } });

// constant-time comparison (cf/factory/src/runs.js sameSecret); empty never matches
export function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// a refused request: status and error code
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
  const rules = JSON.stringify(v.rules);
  // one batch: the Worker's own KST day first (the subs_ins trigger names today's 'new:' counter from it), then the INSERT,
  // then which of these keys the factory's last data.json does not have (reads the keyset row once)
  const res = await env.DB.batch([
    env.DB.prepare(Q.SET_DAY).bind(Number(today.replace(/-/g, ""))),
    env.DB.prepare(Q.SUBSCRIBE).bind(newId(), sub.endpoint, rules, today, max, perDay),
    env.DB.prepare(Q.UNKNOWN_KEYS).bind(rules),
  ]);
  const row = res[1] && res[1].results && res[1].results[0];
  if (!row) {
    // today's new-subscription budget used up: 429 (so a flood does not read as "full"); else the table is full: 503 FULL.
    // Nothing is evicted — GET /health "capacity" tells the operator (the monitor warns), who purges or raises MAX_SUBS.
    const c = await env.DB.prepare(Q.SUBS_COUNTS).bind(today).first();
    if (!c || c.today >= perDay) throw new Bad(429, "RATE_LIMITED");
    throw new Bad(503, "FULL");
  }
  return { status: 201, body: { id: row.id, ...unknownOf(res[2]) } };
}

// the "unknown" field of a subscribe/PUT answer (sql.js UNKNOWN_KEYS: keys of the stored rules that the factory's last key
// set does not hold) — only when there are some. Information only: the rules were stored; those pairs are computed once a
// later data.json has the key (a phone may simply have a newer or older app data than the factory's last run).
function unknownOf(res) {
  const keys = ((res && res.results) || []).map((x) => x.k);
  return keys.length ? { unknown: keys } : {};
}

async function putRules(request, env, id) {
  if (!ID_RE.test(id)) throw new Bad(404, "NOT_FOUND");
  const body = await readJson(request, PUBLIC_MAX);
  const v = validateRules(body && body.rules);
  if (v.error) throw new Bad(400, v.error);
  // no rules left = the phone switched every alert off: the row is deleted (unknown id → 404 as for any other PUT)
  if (!v.rules.length) {
    if (!(await env.DB.prepare(Q.DELETE_SUB_RETURNING).bind(id).first())) throw new Bad(404, "NOT_FOUND");
    return { status: 200, body: { ok: true } };
  }
  const rules = JSON.stringify(v.rules);
  const [put, unknown] = await env.DB.batch([env.DB.prepare(Q.PUT_RULES).bind(id, rules), env.DB.prepare(Q.UNKNOWN_KEYS).bind(rules)]);
  if (!(put && put.results && put.results[0])) throw new Bad(404, "NOT_FOUND");
  return { status: 200, body: { ok: true, ...unknownOf(unknown) } };
}

async function unsubscribe(env, id) {
  if (ID_RE.test(id)) await env.DB.prepare(Q.DELETE_SUB).bind(id).run();
  return { status: 204, body: null };
}

// ---- factory side (Bearer ALERTS_SECRET; never CORS)
// POST /v1/internal/keys {keys} → {keys: <how many>, changed}. The compare keys of the data.json the app was just given,
// each once in ascending order (rules.js keySetJson; else 400 BAD_KEYS). Stored as ONE row, rewritten only when it differs
// (sql.js SET_KEYS: ≤ 1 row written). notify.mjs sends it on every run after a deploy — a push-started run sends only this
// — and before the first watched page of a full run: WATCHED then ranks only pairs of these keys, and subscribe/PUT name
// any other key of their rules in "unknown" (stored all the same).
async function storeKeys(request, env) {
  const body = await readJson(request, INTERNAL_MAX);
  const set = keySetJson(body && body.keys);
  if (!set) throw new Bad(400, "BAD_KEYS");
  const res = await env.DB.prepare(Q.SET_KEYS).bind(set).run();
  return { keys: body.keys.length, changed: ((res && res.meta && res.meta.changes) || 0) > 0 };
}

// GET /v1/internal/watched?at=<offset>[&data=<sha256 of the data.json>] → {pairs, next: <offset> | null, capped?: true} |
// {pairs: [], next: null, done: true}. At most PAIR_CAP pairs in all, only pairs whose key is in the stored key set
// (storeKeys above), most important first (sql.js WATCHED; a pair keeps its place PAIR_KEEP_DAYS after it was first
// computed, by the Worker's clock); a list cut at the cap answers capped: true on its last page and stamps stat 'capped'
// (GET /health "pairs"). With digest's room check this keeps the factory's D1 writes bounded however many pairs the
// subscriptions name. One page holds PAGE pairs (≥ PAIR_CAP), so a factory run groups the table once.
// done: the first page of a run whose data.json (data) was already finished today (sql.js SAME_DATA) — the factory stops
// there: no digest, no finish (a second run of the same data the same day would rewrite every pair and change nothing).
async function watched(env, url, now) {
  const cap = num(env.PAIR_CAP, PAIR_CAP);
  const raw = url.searchParams.get("at") || "0", data = url.searchParams.get("data");
  const at = /^\d{1,9}$/.test(raw) ? Number(raw) : -1;
  if (at < 0 || at > cap || (data !== null && !SHA_RE.test(data))) throw new Bad(400, "BAD_PAGE");
  if (at === 0 && data !== null) {
    const same = await env.DB.prepare(Q.SAME_DATA).bind(dayNum(kstDay(now)), dataTag(data)).first();
    if (same && same.same) return { pairs: [], next: null, done: true };
  }
  const want = Math.min(PAGE, cap - at);
  const { results } = await env.DB.prepare(Q.WATCHED).bind(want + 1, at, addDays(kstDay(now), -PAIR_KEEP_DAYS)).all();
  const rows = results || [];
  const pairs = rows.slice(0, want).map((x) => ({ k: x.k, r: x.r }));
  const more = rows.length > want, end = at + pairs.length;
  if (more && end >= cap) {
    await env.DB.prepare(Q.STAT_CAPPED).bind(dayNum(kstDay(now))).run();
    console.log("alerts watched: the list was cut at PAIR_CAP");
    return { pairs, next: null, capped: true };
  }
  return { pairs, next: more ? end : null };
}

// POST /v1/internal/digest {run, entries} → {saved, skipped}. A pair not in snap yet is added only while snap holds fewer than
// PAIR_CAP rows (sql.js DIGEST), with today (the Worker's clock) as its first day; one left out (skipped) waits for a row a
// finish frees, and stamps stat 'capped' (GET /health "pairs": "capped") — the list is at its cap.
async function digest(request, env, now) {
  const body = await readJson(request, INTERNAL_MAX);
  if (!body || !validRun(body.run) || !Array.isArray(body.entries) || body.entries.length > DIGEST_MAX) throw new Bad(400, "BAD_DIGEST");
  const entries = body.entries.map(cleanEntry);
  if (entries.some((e) => !e)) throw new Bad(400, "BAD_DIGEST");
  if (!entries.length) return { saved: 0, skipped: 0 };
  const res = await env.DB.prepare(Q.DIGEST).bind(body.run, JSON.stringify(entries), num(env.PAIR_CAP, PAIR_CAP), kstDay(now)).run();
  const saved = Math.min(entries.length, (res && res.meta && res.meta.changes) || 0), skipped = entries.length - saved;
  if (skipped) {
    await env.DB.prepare(Q.STAT_CAPPED).bind(dayNum(kstDay(now))).run();
    console.log("alerts digest: new pairs wait for room under PAIR_CAP");
  }
  return { saved, skipped };
}

// POST /v1/internal/finish {run, today, data?} → {weekly, expiring, changed}. One atomic batch: mark the phones, THEN
// promote the pending numbers to the baseline (a failure promotes nothing), and note the day and the data.json (data = its
// sha256; stat 'finish' + 'data': watched answers done to the same data the same day).
// Every date here comes from the Worker's own clock (today = kstDay(now)): the body's `today` and the run's day part only
// have to agree with it (calendar dates within FINISH_SLACK_DAYS, else 400 BAD_FINISH and nothing is touched), so the
// factory token can neither wipe past days' budgets with a far-future day nor pin /health "finished".
async function finish(request, env, now) {
  const body = await readJson(request, INTERNAL_MAX);
  const today = kstDay(now);
  if (!body || !validRun(body.run) || !validDay(body.today) || (body.data != null && !SHA_RE.test(body.data))) throw new Bad(400, "BAD_FINISH");
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
    body.data ? env.DB.prepare(Q.STAT_DATA).bind(dataTag(body.data)) : env.DB.prepare(Q.CLEAR_DATA),
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
export async function send(env, nowMs = Date.now(), { fetch: f = fetch, clock, waits = RESULT_WAITS } = {}) {
  const started = Date.now();
  const now = clock || (() => nowMs + (Date.now() - started));
  const out = { sent: 0, gone: 0, retry: 0, refused: 0, stopped: 0, held: 0 };
  if (!inWindow(nowMs)) { console.log("alerts send: outside 08:00-20:45 KST"); return { ...out, skipped: "window" }; }
  // the key, checked BEFORE any row is claimed (push.js vapidKey): the public key comes from the secret VAPID_PRIVATE_JWK
  // itself (VAPID_PUBLIC_KEY, when set, must be that same key) and one test signature must verify with it. A secret that
  // is missing, broken or cannot sign locks no row and costs no push.
  const v = await vapidKey(env, nowMs);
  if (!v.key) {
    if (v.why === "missing") console.log("alerts send: VAPID_PRIVATE_JWK not set");
    else if (v.why === "mismatch") console.error("alerts send: VAPID_PUBLIC_KEY is set and is not the public key of VAPID_PRIVATE_JWK");
    else console.error("alerts send: VAPID_PRIVATE_JWK is not a P-256 private key that signs");
    return { ...out, skipped: "keys" };
  }
  const pub = v.key, priv = env.VAPID_PRIVATE_JWK;
  const today = kstDay(nowMs), todayN = dayNum(today), minute = Math.floor(nowMs / 60e3), nowS = Math.floor(nowMs / 1000);
  const limit = num(env.SEND_LIMIT, SEND_LIMIT), weekAgo = addDays(today, -7);
  // the key's tag (a new key never uses an old token, nor an old key's per-origin records)
  const tag = pub.slice(0, 12);
  // the probes (held rows whose minute has come, a few per push origin: sql.js CLAIM_P) first, then the queue in what is left
  const [, , cache, origins, cp, cx, cw, cf] = await env.DB.batch([
    env.DB.prepare(Q.RESET_STALE).bind(minute),
    env.DB.prepare(Q.DROP_ENDED).bind(today),
    env.DB.prepare(Q.VAPID_CACHE),
    env.DB.prepare(Q.ORIGIN_STATS).bind(`${tag} `),
    env.DB.prepare(Q.CLAIM_P).bind(minute, PROBES, Math.min(PROBE_SLOTS, limit)),
    env.DB.prepare(Q.CLAIM_X).bind(minute, weekAgo, today, limit),
    env.DB.prepare(Q.CLAIM_W).bind(minute, weekAgo, today, limit),
    env.DB.prepare(Q.CLAIM_F).bind(minute, weekAgo, today, limit, FAIL_SLOTS),
  ]);
  // RETURNING gives rows in table order, not in the ORDER BY of the claim: sort again (the probes, then the nearest deadline,
  // then the weekly queue longest wait first, then the few rows that failed before: fewest failures first)
  const by = (...f) => (a, b) => { for (const g of f) { const x = g(a), y = g(b); if (x !== y) return x < y ? -1 : 1; } return 0; };
  const probes = cp.results || [];
  const subs = [...probes,
    ...(cx.results || []).sort(by((r) => r.pend_x)),
    ...(cw.results || []).sort(by((r) => r.last_w || "")),
    ...(cf.results || []).sort(by((r) => r.fails, (r) => r.last_w || ""))];
  if (!subs.length) return out;
  if (probes.length) out.probes = probes.length;
  const originOf = (s) => { try { return new URL(s.endpoint).origin; } catch { return ""; } };
  // push origins that have held rows (a probe was claimed there in this run)
  const probed = new Set(probes.map(originOf));

  // per push origin (sql.js ORIGIN_STATS): okEver = it answered 2xx to a push of ours under some key; for THIS key: okSince
  // = the first day this key went through there; stretchFrom / stretchLast = the first / last day of the current stretch of
  // refusals that may be our own setup's fault
  const okSince = new Map(), okEver = new Set(), stretchFrom = new Map(), stretchLast = new Map();
  for (const o of origins.results || []) {
    const kind = o.k.slice(0, 3), origin = o.k.slice(3 + tag.length + 1), d = dayOfNum(o.n);
    if (kind === "ok:") okEver.add(origin);
    if (d && o.k.slice(3, 3 + tag.length) === tag) (kind === "ok:" ? okSince : kind === "rs:" ? stretchFrom : stretchLast).set(origin, d);
  }
  const took = (s) => !!(s.last_w || s.last_x);
  // one JWT per push origin, cached in D1 (keyed with the public key, so a new key never uses an old token)
  const jwts = new Map(), fresh = [];
  for (const c of cache.results || []) if (c.aud.startsWith(tag + " ") && c.exp - nowS > 3600) jwts.set(c.aud.slice(tag.length + 1), c.jwt);
  const stmts = [], slowHosts = new Set(), refused = [], trouble = [], okOrigins = new Set();
  // queued: rows whose result statement is in stmts (or already written); waiting: rows decided after the loop (refused,
  // push-service trouble). Every claimed row ends this run with a statement (the finally below).
  const queued = new Set(), waiting = new Set();
  let closed = false, stalled = false;
  const release = (s) => env.DB.prepare(Q.RELEASE).bind(s.id, minute);
  // held back (rules.js HOLD): out of the queue — back as a probe from that minute on, or when its push origin answers 2xx
  const hold = (s, minutes) => env.DB.prepare(Q.HOLD).bind(s.id, minute, minute + minutes);
  const q = (s, ...st) => { queued.add(s.id); stmts.push(...st); };
  const result = (s, what, due) => {
    if (what === "sent") { out.sent++; q(s, env.DB.prepare(Q.SENT).bind(s.id, due.weekly ? 1 : 0, due.expiring ? 1 : 0, today, s.pend_x ?? null, s.pend_xl ?? null, minute)); }
    else if (what === "gone") { out.gone++; q(s, env.DB.prepare(Q.GONE).bind(s.id)); }
    else if (what === "retry") { out.retry++; q(s, env.DB.prepare(Q.RETRY).bind(s.id, minute), env.DB.prepare(Q.DROP_FAILING).bind(s.id, RETRY_DROP, NEVER_DROP)); }
    else if (what === "slowed") { out.stopped++; q(s, hold(s, SLOW_HOLD_MINUTES)); }   // that push service said 429
    else { out.stopped++; q(s, release(s)); }
  };
  // Results are written AS THE RUN GOES: after every parallel group, what it decided (sent, gone, counted failures, stopped
  // rows, new JWTs) goes to D1 in one batch, tried up to 3 times (RESULT_WAITS). A run cut short loses at most one group's
  // records, and a batch that committed but whose answer was lost is harmless to write again (sql.js SENT/RETRY/RELEASE/HOLD
  // only touch a row that still holds THIS run's claim). If D1 still refuses, the run sends nothing more (stalled) and the batch
  // is tried once more at the end with everything else. Left: when that last try fails too (D1 down for the whole run) or
  // the Worker is stopped mid-group, the pushes of that group are unrecorded — their rows stay claimed, the run after next
  // frees them (RESET_STALE, 15 minutes) and those phones get the same push again about 20 minutes later.
  const write = async (list) => {
    for (let i = 0; ; i++) {
      try { return await env.DB.batch(list); }
      catch (e) { if (i >= waits.length) throw e; await new Promise((ok) => setTimeout(ok, waits[i])); }
    }
  };
  let unwritten = [];
  const flush = async () => {
    const list = [...unwritten, ...fresh.splice(0), ...stmts.splice(0)];
    unwritten = [];
    if (!list.length) return;
    try { await write(list); }
    catch {
      unwritten = list;
      if (!stalled) { stalled = true; out.stalled = true; console.error("alerts send: D1 did not take the results batch — no more pushes in this run"); }
    }
  };
  async function one(s) {
    let due = { weekly: false, expiring: false };
    try {
      due = dueKinds(s, today);
      if (!due.weekly && !due.expiring) return result(s, "stopped", due);       // claimed but nothing due after all
      let origin;
      try { origin = new URL(s.endpoint).origin; } catch { return result(s, "gone", due); }
      if (closed || stalled) return result(s, "stopped", due);
      if (slowHosts.has(origin)) return result(s, "slowed", due);
      if (!jwts.has(origin))   // a promise, so parallel pushes to one origin sign once
        jwts.set(origin, vapidJwt(origin, priv, env.VAPID_SUBJECT || env.ALLOWED_ORIGIN, nowMs).then((t) => {
          fresh.push(env.DB.prepare(Q.SAVE_JWT).bind(`${tag} ${origin}`, t.jwt, t.exp));
          return t.jwt;
        }));
      const jwt = await jwts.get(origin);
      // the window is checked again right before this push, and the TTL is computed from this moment: a run that is
      // still going at 20:45 stops, and no push can arrive after 21:00
      const t = now();
      if (closed || !inWindow(t)) { if (!closed) { closed = true; out.closed = true; } return result(s, "stopped", due); }
      if (stalled) return result(s, "stopped", due);                            // decided while this one signed
      if (slowHosts.has(origin)) return result(s, "slowed", due);
      const req = pushRequest(s.endpoint, jwt, pub, pushTtl(t));
      let status = 0;
      try { status = (await f(req.url, { ...req.init, signal: AbortSignal.timeout(8000) })).status; } catch { status = 0; }
      const what = outcome(status);
      if (what === "sent" && !okOrigins.has(origin)) {
        // this origin's first 2xx in the run: the day this key went through there (kept if older) and the end of any refusal
        // stretch go into the SAME results batch as this SENT, so a recorded push never lacks them (sql.js STAT_OK_SINCE).
        // When that origin has held rows (a probe of it in this run, or a refusal stretch — the rows spared there), they are
        // freed in the same batch (sql.js RELEASE_HELD: the rows that received a push before)
        okOrigins.add(origin);
        stmts.push(env.DB.prepare(Q.STAT_OK_SINCE).bind(`${tag} ${origin}`, todayN), env.DB.prepare(Q.CLEAR_RS).bind(`${tag} ${origin}`));
        if (probed.has(origin) || stretchFrom.has(origin)) stmts.push(env.DB.prepare(Q.RELEASE_HELD).bind(origin));
      }
      if (what === "slow") { slowHosts.add(origin); return result(s, "slowed", due); }
      // 401/403 and push-service trouble (5xx, redirect, timeout) are decided after the run (below), once every push of the
      // run has answered: whether that push service took another push 2xx in this run is part of the decision. A refusal
      // never stops the run for that service — a 2xx later in the same run (a phone that subscribed with the current key)
      // is what tells an old subscription's refusal from a broken setup.
      if (what === "refused") { waiting.add(s.id); refused.push({ s, origin }); return; }
      if (what === "retry" && hostTrouble(status)) { waiting.add(s.id); trouble.push({ s, origin, due }); return; }
      return result(s, what, due);
    } catch {
      // anything unexpected (a signature that fails after the check above, …): this row is released unchanged — never
      // counted against it — and the run goes on. Counted in the run's log line, the error itself is not logged (a JSON
      // or key error may quote what it parsed).
      out.errors = (out.errors || 0) + 1;
      if (!queued.has(s.id) && !waiting.has(s.id)) result(s, "stopped", due);
    }
  }
  try {
    for (let i = 0; i < subs.length; i += PARALLEL) {
      await Promise.all(subs.slice(i, i + PARALLEL).map(one));
      await flush();
    }
    // a push origin that answered 5xx / a redirect / timed out for a row but took another push 2xx in this run: the service
    // was up, so that failure is the row's (counted, RETRY_DROP / NEVER_DROP). So is it for a row that never received a push
    // at an origin that never answered 2xx to any push of ours under any key (no 'ok:'): nothing says a push service is
    // there (a made-up host that cannot answer — 4th review), and the row goes after NEVER_DROP tries. Otherwise the origin
    // may simply be down: the row is held back unchanged (rules.js HOLD; fails does not move) — an outage deletes nobody,
    // and while it lasts its rows come back only as probes, so the other services' phones get the runs' slots.
    for (const t of trouble) {
      if (okOrigins.has(t.origin) || (!took(t.s) && !okEver.has(t.origin))) result(t.s, "retry", t.due);
      else { out.held++; q(t.s, hold(t.s, HOLD_MINUTES)); }
    }
    // 401/403. A row is counted (one more failure, removed after REFUSED_DROP in a row; a row that never received a push at
    // its first refusal) unless OUR setup may be what is broken at that push origin. That is the case ("suspect") when a
    // phone that took our pushes under THIS key refuses there and the origin took no push 2xx in this run. It starts a
    // stretch (stat 'rs:' first day, 'rl:' last day of such runs), which ends at the origin's next 2xx, or when its last
    // day is older than yesterday (it ended without a 2xx: those phones stopped being due) — a new incident weeks later
    // starts its own grace days. For up to REFUSING_GRACE_DAYS from the first day of the stretch, at an origin that took
    // nothing 2xx in the run and is suspect in it or has a stretch going: a phone that took our pushes is held back
    // unchanged (rules.js HOLD; fails stays; held, not released, so these rows never keep the other push services' phones
    // waiting — they come back as probes, a few a run, and all at once at that origin's next 2xx — and so most runs of a
    // stretch try only a few of them, which is why a stretch going is enough), and a row that never took one gets one
    // failure and stays. Only a phone that took our pushes makes a run suspect and moves 'rl:'
    // (planted rows can neither start nor prolong a stretch). Judged per run and per origin from one such phone on, so a
    // quiet day with few phones due deletes nobody either.
    // A row last reached BEFORE this key first went through that origin (stat 'ok:') is an old subscription made under an
    // earlier key: its refusal is its own — counted, never suspect — so after a key change the phones that subscribed again
    // are not held up by the ones that did not, and the old rows go. A row last reached ON that day counts as reached under
    // this key (last_w/last_x hold the day only): on the day of a key change, a phone that got its last push under the old
    // key before the new one first went through is protected like the others. A planted subscription never took a push, so
    // it can neither make an origin suspect nor be spared. Suspect origins → stat 'refusing' → GET /health "refusing": true
    // → a Telegram line every day of the stretch.
    const lastPush = (s) => ((s.last_w || "") > (s.last_x || "") ? s.last_w : s.last_x) || "";
    const oldKey = (s, origin) => okSince.has(origin) && lastPush(s) < okSince.get(origin);
    const suspect = new Set(refused.filter(({ s, origin }) => took(s) && !okOrigins.has(origin) && !oldKey(s, origin)).map((x) => x.origin));
    const yesterday = addDays(today, -1);
    const stretchSince = (origin) => { const f = stretchFrom.get(origin), l = stretchLast.get(origin); return f && l && l >= yesterday ? f : null; };
    const careful = (origin) => !okOrigins.has(origin) && (suspect.has(origin) || !!stretchSince(origin));
    const graceOver = (origin) => { const f = stretchSince(origin); return !!f && daysBetween(today, f) >= REFUSING_GRACE_DAYS; };
    for (const { s, origin } of refused) {
      out.refused++;
      if (!careful(origin) || graceOver(origin) || (took(s) && oldKey(s, origin)))
        q(s, env.DB.prepare(Q.RETRY).bind(s.id, minute), env.DB.prepare(Q.DROP_REFUSED).bind(s.id, REFUSED_DROP));
      else if (took(s)) { out.spared = (out.spared || 0) + 1; q(s, hold(s, HOLD_MINUTES)); }
      else q(s, env.DB.prepare(Q.RETRY).bind(s.id, minute));
    }
    if (suspect.size) {
      out.refusing = suspect.size;
      for (const o of suspect) {
        if (!stretchSince(o)) stmts.push(env.DB.prepare(Q.STAT_RS_START).bind(`${tag} ${o}`, todayN));
        stmts.push(env.DB.prepare(Q.STAT_RL).bind(`${tag} ${o}`, todayN));
      }
      stmts.push(env.DB.prepare(Q.STAT_REFUSING).bind(todayN));
      console.error("alerts send: phones that took our pushes refuse the VAPID token where nothing else went through — kept, not counted (within the grace days)");
    }
  } finally {
    // a claimed row left without a statement (an exception above) is released, not left claimed for 15 minutes
    for (const s of subs) if (!queued.has(s.id)) { out.stopped++; q(s, release(s)); }
    await write([...unwritten, ...fresh, ...stmts, env.DB.prepare(Q.DROP_OTHER_TAGS).bind(`${tag} `), env.DB.prepare(Q.DROP_OLD_JWT).bind(nowS)]);
  }
  console.log("alerts send", JSON.stringify(out));
  return out;
}

// GET /health — what the daily monitor (.github/scripts/health_check.py) reads; words, days and the public key only:
//   sending   a push could go out now: VAPID_PRIVATE_JWK signs, and VAPID_PUBLIC_KEY (when set) is its key (push.js vapidKey)
//   key       the VAPID public key pushes go out with (public information; null while sending is false) — the monitor
//             compares it with app/config.js pushPublicKey, the key phones subscribe with
//   finished  KST day of the last factory finish (null before the first)
//   stale     that finish is more than STALE_DAYS days old, or — no finish ever — subscriptions exist and the first is more
//             than STALE_DAYS days old (the factory → Worker link stopped or never worked; notify.mjs fails quietly)
//   refusing  a send run today or yesterday (REFUSING_DAYS) found phones that took our pushes refusing our VAPID token at a
//             push service that took nothing else — kept, not counted, for up to REFUSING_GRACE_DAYS (send above)
//   capacity  'ok' | 'nearly_full' (≥ 80% of MAX_SUBS) | 'full' — nothing is evicted, a person must purge or raise MAX_SUBS
//   pairs     'ok' | 'capped': the factory's watched list was cut at PAIR_CAP today or yesterday (CAPPED_DAYS) — some pairs
//             were not computed (planted subscriptions, or more real ones than the cap: purge or raise PAIR_CAP)
async function health(env, now) {
  const h = { "cache-control": "no-store" };
  let row;
  try { row = await env.DB.prepare(Q.HEALTH).first(); }
  catch { console.error("alerts health: D1 did not answer"); return json({ ok: false }, 503, h); }
  const v = await vapidKey(env, now);
  const today = kstDay(now);
  const within = (d, days) => !!d && daysBetween(today, d) >= 0 && daysBetween(today, d) <= days;
  const finished = dayOfNum(row && row.fin), refusedOn = dayOfNum(row && row.ref), cappedOn = dayOfNum(row && row.cap);
  const firstNew = row && validDay(row.first_new) ? row.first_new : null;
  const stale = finished ? daysBetween(today, finished) > STALE_DAYS
    : Number(row && row.subs) > 0 && !!firstNew && daysBetween(today, firstNew) > STALE_DAYS;
  const refusing = within(refusedOn, REFUSING_DAYS);
  const capacity = capacityOf(row && row.subs, num(env.MAX_SUBS, MAX_SUBS));
  const pairs = within(cappedOn, CAPPED_DAYS) ? "capped" : "ok";
  return json({ ok: true, window: "08-21 KST", sending: !!v.key, key: v.key || null, finished, stale, refusing, capacity, pairs }, 200, h);
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
      if (m === "POST" && path === "/v1/internal/keys") return json(await storeKeys(request, env));
      if (m === "GET" && path === "/v1/internal/watched") return json(await watched(env, url, now));
      if (m === "POST" && path === "/v1/internal/digest") return json(await digest(request, env, now));
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
