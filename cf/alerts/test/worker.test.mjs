// node --test cf/alerts/test/*.test.mjs — the Worker (src/worker.js) on the real schema with node:sqlite standing in for D1:
// promise-1 shapes with chat B, CORS, abuse guards, factory endpoints need the secret, nothing personal stored or logged,
// sticky news in snap, and the send rules (08–21 KST checked before every push, one push per phone per 7 days, expiring once
// per end date, 404/410 removes, 3xx never followed, ≤ SEND_LIMIT per run, longest-waiting first).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto as wc } from "node:crypto";
import worker, { send, SEND_LIMIT, MAX_SUBS, NEW_PER_DAY, PAIR_CAP } from "../src/worker.js";
import { dueKinds, unb64u, addDays, daysBetween, inWindow, clientKey, REFUSED_DROP, RETRY_DROP, NEVER_DROP, FAIL_SLOTS, REFUSING_GRACE_DAYS, HOLD_MINUTES,
  SLOW_HOLD_MINUTES, PROBES, PROBE_SLOTS, PAIR_KEEP_DAYS } from "../src/rules.js";
import { watchMoved, vapidJwt } from "../src/push.js";
import * as Q from "../src/sql.js";
import { SKIP_SQL, makeDb, makeEnv, call, subscription, pushService, vapidKeys, kst, SECRET_VALUE, spyConsole, rateLimiter } from "./helpers.mjs";

const T = { skip: SKIP_SQL };
const AUTH = { authorization: `Bearer ${SECRET_VALUE}` };
const APP = "https://yoonsiljang.lsy2825.workers.dev";
const internal = (env, method, path, body, now) => call(worker, env, method, path, body, { headers: { ...AUTH, origin: null }, now });
const setup = async (extra) => { const db = makeDb(); const k = await vapidKeys(); return { db, k, env: makeEnv(db, { VAPID_PUBLIC_KEY: k.pub, VAPID_PRIVATE_JWK: k.jwk, ...extra }) }; };
const sub = async (env, rules, s = subscription(), opts) => {
  const r = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: s, rules }, opts);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.id, endpoint: s.endpoint };
};
const st = (k, m, n, med, r = "") => ({ k, r, m, n, med });
// a bare factory finish on `today` (06:00 KST of that day) → HTTP status
const finishDay = async (env, today) => (await internal(env, "POST", "/v1/internal/finish", { run: `${today}|${today}`, today }, kst(`${today}T06:00:00`))).status;
// what the factory does after a run: digest entries for every watched pair, then finish. Pairs the test does not name are
// sent again with their stored baseline (notify.mjs always sends every watched pair).
// The Worker's clock is 06:00 KST of `today` (the factory runs at 06:00; finish takes the day from its own clock and only
// checks the body's today against it).
const at = (today) => kst(`${today}T06:00:00`);
async function mark(env, today, entries, updated = today) {
  const run = `${updated}|${today}`;
  const given = new Set(entries.map((e) => `${e.k}|${e.r}`));
  const rest = env.DB.rows("SELECT k, r, m, n, med, g FROM snap WHERE p = 0").filter((x) => !given.has(`${x.k}|${x.r}`));
  const d = await internal(env, "POST", "/v1/internal/digest", { run, entries: [...entries, ...rest] }, at(today));
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const f = await internal(env, "POST", "/v1/internal/finish", { run, today }, at(today));
  assert.equal(f.status, 200, JSON.stringify(f.body));
  return f.body;
}
// watch news for k: a baseline if there is none yet, then a new lowest price (10% down) in a NEW collection (meta.updated):
// a good move is taken at once, whereas a rise or a higher median is held until the next collection shows it too (sql.js
// DIGEST), and within one collection the baseline only moves the good way
let collection = 0;
const nextCollection = () => addDays("2030-01-01", collection++);
async function news(env, today, k = "X24", r = "") {
  let b = env.DB.rows("SELECT m, n, med FROM snap WHERE k = ? AND r = ?", k, r)[0];
  if (!b) { b = { m: 100000, n: 5, med: 120000 }; await mark(env, today, [st(k, b.m, b.n, b.med, r)], nextCollection()); }
  return mark(env, today, [st(k, Math.round(b.m * 0.9), b.n, b.med, r)], nextCollection());
}

// stat 'ok:<tag> <origin>' = the first day the key (by its public key's first 12 characters) went through that push origin
const okSince = (db, pub, origin, day) => db.raw.prepare("INSERT INTO stat (k, n) VALUES (?, ?)").run(`ok:${pub.slice(0, 12)} ${origin}`, Number(day.replace(/-/g, "")));

test("promise 1: subscribe → 201 {id}; PUT rules → 200; DELETE → 204; unknown id → 404", T, async () => {
  const { env, db } = await setup();
  const s = subscription();
  const r = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: s, rules: [{ kind: "target", key: "X24", max: 150000 }] });
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.body), ["id"]);
  assert.match(r.body.id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(r.headers.get("access-control-allow-origin"), APP);
  const row = db.rows("SELECT * FROM subs")[0];
  assert.equal(row.endpoint, s.endpoint);
  assert.equal(row.rules, '[{"kind":"target","key":"X24","max":150000}]');
  assert.equal(JSON.stringify(row).includes(s.keys.p256dh), false, "p256dh is not stored");
  assert.equal(JSON.stringify(row).includes(s.keys.auth), false, "auth is not stored");

  const put = await call(worker, env, "PUT", `/v1/push/rules/${r.body.id}`, { rules: [{ kind: "watch", key: "T0000ABC", region: "부산" }] });
  assert.deepEqual([put.status, put.body], [200, { ok: true }]);
  assert.equal(db.rows("SELECT rules FROM subs")[0].rules, '[{"kind":"watch","key":"T0000ABC","region":"부산"}]');
  const capital = await call(worker, env, "PUT", `/v1/push/rules/${r.body.id}`, { rules: [{ kind: "watch", key: "X24", region: "수도권" }] });
  assert.equal(capital.status, 200, "수도권 (the app's default region view) is a valid region");
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${"A".repeat(22)}`, { rules: [] })).status, 404);
  assert.equal((await call(worker, env, "PUT", "/v1/push/rules/not-an-id", { rules: [] })).status, 404);
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${r.body.id}`, { rules: [{ kind: "ad", key: "X24" }] })).body.error, "BAD_RULES");

  const del = await call(worker, env, "DELETE", `/v1/push/subscribe/${r.body.id}`);
  assert.deepEqual([del.status, del.body], [204, null]);
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 0);
  assert.equal((await call(worker, env, "DELETE", `/v1/push/subscribe/${r.body.id}`)).status, 204);      // idempotent
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${r.body.id}`, { rules: [] })).status, 404);
  assert.equal(db.rows("SELECT n FROM stat WHERE k = 'subs'")[0].n, 0, "subscription counter follows deletes");
});

test("promise 1: 21 rules, empty rules, bad kinds/keys/max, unknown push hosts, #fragments, bad JSON, big bodies are refused", T, async () => {
  const { env, db } = await setup();
  const post = (body, opts) => call(worker, env, "POST", "/v1/push/subscribe", body, opts);
  const W = [{ kind: "watch", key: "X24" }];
  const many = Array.from({ length: 21 }, (_, i) => ({ kind: "watch", key: `X${String(i + 1).padStart(2, "0")}` }));
  const r21 = await post({ subscription: subscription(), rules: many });
  assert.deepEqual([r21.status, r21.body], [400, { error: "BAD_RULES" }]);
  // an empty subscription would never send and would sit in the table for ever
  const empty = await post({ subscription: subscription(), rules: [] });
  assert.deepEqual([empty.status, empty.body], [400, { error: "BAD_RULES" }]);
  for (const rules of [[{ kind: "price", key: "X24" }], [{ kind: "watch", key: "../etc" }], [{ kind: "target", key: "X24" }], [{ kind: "target", key: "X24", max: -5 }], "watch"])
    assert.equal((await post({ subscription: subscription(), rules })).body.error, "BAD_RULES", JSON.stringify(rules));
  for (const host of ["evil.example", "127.0.0.1", "push.example.com"])
    assert.deepEqual((await post({ subscription: subscription(host), rules: W })).body, { error: "BAD_SUBSCRIPTION" });
  const frag = subscription("fcm.googleapis.com", "fcm/send/abc#x");
  assert.deepEqual((await post({ subscription: frag, rules: W })).body, { error: "BAD_SUBSCRIPTION" }, "#fragment refused");
  assert.equal((await post({ subscription: subscription("wns2-par02p.notify.windows.com", "w/?token=AbC"), rules: W })).status, 201, "query string kept");
  assert.equal(db.rows("SELECT endpoint FROM subs")[0].endpoint, "https://wns2-par02p.notify.windows.com/w/?token=AbC");
  assert.deepEqual((await post(undefined, { raw: "{nope", headers: { "content-type": "application/json" } })).body, { error: "BAD_JSON" });
  assert.equal((await post(undefined, { raw: "{}", headers: { "content-type": "application/x-www-form-urlencoded" } })).status, 400);
  const big = await post({ subscription: subscription(), rules: W, pad: "x".repeat(9000) });
  assert.equal(big.status, 413);
  assert.equal((await post(undefined, { raw: "{}", headers: { "content-type": "application/json", "content-length": "9000" } })).status, 413, "declared length");
  // text/plain (a CORS simple request) is fine
  const plain = await post(undefined, { raw: JSON.stringify({ subscription: subscription(), rules: W }), headers: { "content-type": "text/plain;charset=UTF-8" } });
  assert.equal(plain.status, 201);
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 2);
});

test("bodies without Content-Length: read with a running cap (413, stream cancelled) and read errors → 400", { ...T, timeout: 5000 }, async () => {
  const { env, db } = await setup();
  const ctx = { waitUntil() {} };
  let pulls = 0, cancelled = false;
  const endless = new ReadableStream({ pull(c) { pulls++; c.enqueue(new Uint8Array(1024).fill(32)); }, cancel() { cancelled = true; } });
  const req = (body) => new Request(`${APP.replace("yoonsiljang", "yoonsiljang-alerts")}/v1/push/subscribe`, { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body, duplex: "half" });
  const r1 = await worker.fetch(req(endless), env, ctx);
  assert.equal(r1.status, 413);
  assert.ok(pulls <= 12, `stopped reading after the cap (${pulls} KB pulled)`);
  assert.equal(cancelled, true, "the stream was cancelled");
  const broken = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"subscription"')); c.error(new Error("client went away")); } });
  const r2 = await worker.fetch(req(broken), env, ctx);
  assert.deepEqual([r2.status, await r2.json()], [400, { error: "BAD_JSON" }]);
  // the same on the factory side
  const r3 = await worker.fetch(new Request(`${APP}/v1/internal/digest`, { method: "POST", headers: { ...AUTH, "content-type": "application/json" },
    body: new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(64 * 1024).fill(32)); } }), duplex: "half" }), env, ctx);
  assert.equal(r3.status, 413);
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 0);
});

test("rule change (PUT or subscribing again) resets pending marks, keeps the send history; same rules keep them; old id dead", T, async () => {
  const { env, db } = await setup();
  const s = subscription();
  const a = await sub(env, [{ kind: "watch", key: "X24" }], s);
  const hist = "last_w = '2026-10-19', last_x = '2026-10-18', exp_sent = '2026-10-20'";
  db.raw.prepare(`UPDATE subs SET pend_w = 1, pend_x = '2026-10-22', ${hist}`).run();
  const row = () => db.rows("SELECT pend_w, pend_x, last_w, last_x, exp_sent, rules FROM subs")[0];
  // same rules again → nothing changes
  const a2 = await sub(env, [{ kind: "watch", key: "X24" }], s);
  assert.deepEqual([row().pend_w, row().pend_x], [1, "2026-10-22"]);
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${a2.id}`, { rules: [{ kind: "watch", key: "X24" }] })).status, 200);
  assert.deepEqual([row().pend_w, row().pend_x], [1, "2026-10-22"], "PUT with the same rules keeps the marks");
  // the same rules in another order, or a rule ADDED: marks kept (only a removed rule can make pending news stale)
  const two = [{ kind: "watch", key: "X24" }, { kind: "target", key: "X01", max: 50000 }];
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${a2.id}`, { rules: two })).status, 200);
  assert.deepEqual([row().pend_w, row().pend_x], [1, "2026-10-22"], "adding a rule keeps the marks");
  const stored = row().rules;
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${a2.id}`, { rules: [...two].reverse() })).status, 200);
  assert.deepEqual([row().pend_w, row().pend_x, row().rules], [1, "2026-10-22", stored], "another order = the same stored text, marks kept");
  const a3 = await sub(env, [...two].reverse(), s);
  assert.deepEqual([row().pend_w, row().pend_x], [1, "2026-10-22"], "subscribing again with the same rules reordered keeps them");
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${a3.id}`, { rules: [{ kind: "watch", key: "X24" }] })).status, 200);
  assert.deepEqual([row().pend_w, row().pend_x], [0, null], "a removed rule resets them");
  db.raw.prepare("UPDATE subs SET pend_w = 1, pend_x = '2026-10-22'").run();
  // new rules by subscribing again: new id, old id dead, marks reset, history kept
  const b = await sub(env, [{ kind: "watch", key: "X01" }], s);
  assert.notEqual(a.id, b.id);
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${a.id}`, { rules: [] })).status, 404);
  assert.deepEqual(row(), { pend_w: 0, pend_x: null, last_w: "2026-10-19", last_x: "2026-10-18", exp_sent: "2026-10-20", rules: '[{"kind":"watch","key":"X01"}]' });
  // new rules by PUT: the same
  db.raw.prepare("UPDATE subs SET pend_w = 1, pend_x = '2026-10-22'").run();
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${b.id}`, { rules: [{ kind: "newmatch", key: "X02" }] })).status, 200);
  assert.deepEqual([row().pend_w, row().pend_x, row().last_w, row().last_x, row().exp_sent], [0, null, "2026-10-19", "2026-10-18", "2026-10-20"]);
  assert.equal(db.rows("SELECT n FROM stat WHERE k = 'subs'")[0].n, 1);
});

test("CORS: only the app origin (and DEV_ORIGINS); a foreign site is refused; preflight answers", T, async () => {
  const { env } = await setup({ DEV_ORIGINS: "http://localhost:8766" });
  const pre = await call(worker, env, "OPTIONS", "/v1/push/subscribe", undefined, { headers: { "access-control-request-method": "POST" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-methods"), "POST, PUT, DELETE");
  assert.equal(pre.headers.get("access-control-allow-headers"), "content-type");
  assert.equal((await call(worker, env, "OPTIONS", "/v1/push/subscribe", undefined, { headers: { origin: "http://localhost:8766" } })).status, 204);
  const evil = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: [{ kind: "watch", key: "X24" }] }, { headers: { origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
});

test("abuse guards: per-IP rate limit (3/60 s, key = cf-connecting-ip, only in the binding), daily budget (429), MAX_SUBS (503)", T, async () => {
  const W = [{ kind: "watch", key: "X24" }];
  // (a) rate limit keyed per client
  const rl = rateLimiter(3);
  const { env } = await setup({ SUBS_RL: rl });
  const ip = (v) => ({ headers: { "cf-connecting-ip": v } });
  for (let i = 0; i < 3; i++) await sub(env, W, subscription(), ip("203.0.113.5"));
  const fourth = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, ip("203.0.113.5"));
  assert.deepEqual([fourth.status, fourth.body], [429, { error: "RATE_LIMITED" }]);
  await sub(env, W, subscription(), ip("198.51.100.7"));                   // another client is not affected
  assert.equal((await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription("evil.example"), rules: W }, ip("192.0.2.1"))).status, 400);
  assert.deepEqual([...rl.seen.keys()], ["203.0.113.5", "198.51.100.7"], "junk requests do not use up the limit; the key is the IP");
  // IPv6: one client holds a whole /64 — four different addresses in it share one counter, another /64 does not
  for (const v of ["2001:db8:aa:bb::1", "2001:db8:aa:bb:1234::9", "2001:0db8:00aa:00bb:ffff:ffff:ffff:fffe"]) await sub(env, W, subscription(), ip(v));
  const v6 = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, ip("2001:db8:aa:bb:5:6:7:8"));
  assert.deepEqual([v6.status, v6.body], [429, { error: "RATE_LIMITED" }], "4th address of the same /64");
  await sub(env, W, subscription(), ip("2001:db8:aa:bc::1"));             // the next /64 is another client
  await sub(env, W, subscription(), ip("::ffff:192.0.2.44"));             // IPv4-mapped = that IPv4 client
  assert.deepEqual([...rl.seen.keys()].slice(2), ["2001:db8:aa:bb::/64", "2001:db8:aa:bc::/64", "192.0.2.44"]);
  assert.equal(clientKey(undefined), "no-ip");
  assert.equal(clientKey("2001:db8:aa:bb::1%eth0"), "2001:db8:aa:bb::/64");
  const stored = JSON.stringify(env.DB.binds) + JSON.stringify(env.DB.rows("SELECT * FROM subs")) + JSON.stringify(env.DB.rows("SELECT * FROM stat"));
  assert.equal(/203\.0\.113|198\.51\.100|2001:db8|192\.0\.2/.test(stored), false, "the IP never reaches D1");
  const cfg = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(cfg, /"simple": \{ "limit": 3, "period": 60 \}/);

  // (b) daily budget of new subscriptions (KST day); subscribing again with a known endpoint stays allowed
  const { env: e2, db: d2 } = await setup({ NEW_PER_DAY: "2" });
  const day1 = kst("2026-10-19T10:00:00"), day2 = kst("2026-10-20T00:30:00");
  const s1 = subscription();
  await sub(e2, W, s1, { now: day1 });
  await sub(e2, W, subscription(), { now: day1 });
  const over = await call(worker, e2, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { now: day1 });
  assert.deepEqual([over.status, over.body], [429, { error: "RATE_LIMITED" }]);
  await sub(e2, [{ kind: "watch", key: "X01" }], s1, { now: day1 });
  await sub(e2, W, subscription(), { now: day2 });                         // a new KST day, a new budget
  // 'day' = the Worker's own KST day of the last subscribe (the trigger names today's counter from it); a re-subscribe of a known
  // endpoint (s1 again, above) is no new row and counts for nothing
  assert.deepEqual(d2.rows("SELECT k, n FROM stat ORDER BY k"), [{ k: "day", n: 20261020 }, { k: "new:2026-10-19", n: 2 }, { k: "new:2026-10-20", n: 1 }, { k: "subs", n: 3 }]);
  await mark(e2, "2026-10-20", []);
  assert.deepEqual(d2.rows("SELECT k FROM stat ORDER BY k").map((x) => x.k), ["day", "finish", "new:2026-10-20", "subs"], "finish drops past days");
  assert.ok(NEW_PER_DAY * 5 <= 100000 / 5, "the budget is far below D1 Free's 100,000 writes a day");

  // (c) MAX_SUBS: full → 503; subscribing again with a known endpoint still works
  const { env: e3 } = await setup({ MAX_SUBS: "2" });
  const s3 = subscription();
  await sub(e3, W, s3);
  await sub(e3, W, subscription());
  const full = await call(worker, e3, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W });
  assert.deepEqual([full.status, full.body], [503, { error: "FULL" }]);
  await sub(e3, [{ kind: "watch", key: "X02" }], s3);

  // (d) nothing is ever evicted to make room: a full table stays full (503 FULL) however idle its rows are and however many
  // days pass — the operator reads GET /health "capacity" (see the health test) and purges or raises MAX_SUBS.
  const { env: e4, db: d4 } = await setup({ MAX_SUBS: "3" });
  const t0 = kst("2026-10-01T10:00:00"), t9 = kst("2026-10-10T10:00:00"), tYear = kst("2027-12-01T10:00:00");
  const pushed = await sub(e4, W, subscription(), { now: t0 });
  const idleOld = await sub(e4, W, subscription(), { now: t0 });
  const idleNew = await sub(e4, W, subscription(), { now: kst("2026-10-02T10:00:00") });
  d4.raw.prepare("UPDATE subs SET last_w = '2026-10-05' WHERE id = ?").run(pushed.id);
  const ids = () => d4.rows("SELECT id FROM subs").map((x) => x.id).sort();
  const all3 = [pushed.id, idleOld.id, idleNew.id].sort();
  for (const now of [t0, t9, tYear]) {
    const stuck = await call(worker, e4, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { now });
    assert.deepEqual([stuck.status, stuck.body], [503, { error: "FULL" }], "full stays full");
    assert.deepEqual(ids(), all3, "nobody was pushed out");
  }
  assert.equal(d4.rows("SELECT n FROM stat WHERE k = 'subs'")[0].n, 3);
  assert.equal((await call(worker, e4, "PUT", `/v1/push/rules/${idleOld.id}`, { rules: W }, { now: tYear })).status, 200, "an idle row from 14 months ago still works: nothing expires");
  assert.equal(await finishDay(e4, "2027-12-01"), 200);               // a factory finish a year on removes no subscription either
  assert.deepEqual(ids(), all3, "no retention rule: the finish prunes no subscription");
  // a seat is made only by a delete: the phone's own DELETE, a PUT with no rules, or the push service saying 404/410
  await call(worker, e4, "DELETE", `/v1/push/subscribe/${idleOld.id}`);
  const fresh = await sub(e4, W, subscription(), { now: tYear });
  assert.deepEqual(ids(), [pushed.id, idleNew.id, fresh.id].sort());

  // (e) full AND today's budget used up: 429 (the budget is looked at first, so a flood does not read as "full"), rows unchanged
  const { env: e5, db: d5 } = await setup({ MAX_SUBS: "2", NEW_PER_DAY: "1" });
  const one = await sub(e5, W, subscription(), { now: t0 });
  d5.raw.prepare("INSERT INTO subs (id, endpoint, rules) VALUES ('second-row-not-counted', 'https://fcm.googleapis.com/fcm/send/older', '[]')").run();
  assert.equal(d5.rows("SELECT n FROM stat WHERE k = 'subs'")[0].n, 2, "full");
  const r5 = await call(worker, e5, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { now: t0 });
  assert.deepEqual([r5.status, r5.body], [429, { error: "RATE_LIMITED" }], "budget first");
  const r6 = await call(worker, e5, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { now: t9 });
  assert.deepEqual([r6.status, r6.body], [503, { error: "FULL" }], "the next day the budget is back, the table is still full");
  assert.deepEqual(d5.rows("SELECT id FROM subs ORDER BY id").map((x) => x.id).sort(), ["second-row-not-counted", one.id].sort(), "nothing evicted");
});

test("nothing IP/UA-like is stored or logged; logs never show ids or endpoints (subscribe, PUT, finish, send)", T, async () => {
  const { env, db } = await setup({ SUBS_RL: rateLimiter(100) });
  const headers = { "cf-connecting-ip": "203.0.113.77", "x-forwarded-for": "198.51.100.9", "user-agent": "Mozilla/5.0 (iPhone; TESTUA)", "cf-ipcountry": "KR", "accept-language": "ko-KR,ko;q=0.9" };
  const subs = [];
  const logs = await spyConsole(async () => {
    const a = await sub(env, [{ kind: "watch", key: "X24" }], subscription(), { headers });
    const b = await sub(env, [{ kind: "watch", key: "X24" }], subscription("web.push.apple.com", "apple-ep-1"), { headers });
    const c = await sub(env, [{ kind: "watch", key: "X24" }], subscription("updates.push.services.mozilla.com", "wpush/v2/moz-ep-1"), { headers });
    subs.push(a, b, c);
    await call(worker, env, "PUT", `/v1/push/rules/${a.id}`, { rules: [{ kind: "watch", key: "X24" }, { kind: "watch", key: "X01" }] }, { headers });
    await call(worker, env, "PUT", `/v1/push/rules/${a.id}`, { rules: [{ kind: "watch", key: "X24" }] }, { headers });
    await news(env, "2026-10-19");                                           // finish
    // send: one sent, one retry (503), one 403 (a refusal counted against that row); outside the window; window closing
    const push = pushService((u) => (u.includes("apple") ? 503 : u.includes("moz") ? 403 : 201));
    await send(env, kst("2026-10-19T09:00:00"), { fetch: push.f });
    await send(env, kst("2026-10-19T07:00:00"), { fetch: push.f });
    await send(env, kst("2026-10-19T09:10:00"), { fetch: push.f, clock: () => kst("2026-10-19T20:59:00") });
    await call(worker, env, "DELETE", `/v1/push/subscribe/${c.id}`, undefined, { headers });
  });
  assert.match(logs, /alerts finish/);
  assert.match(logs, /alerts send/);
  assert.match(logs, /"refused":1/);
  for (const v of ["203.0.113.77", "198.51.100.9", "TESTUA", "Mozilla", "ko-KR", "KR\"", ...subs.flatMap((s) => [s.id, s.endpoint, new URL(s.endpoint).pathname])])
    assert.equal(logs.includes(v), false, `console shows ${v}`);
  assert.equal(/fcm\.googleapis|apple-ep|moz-ep|fcm\/send/.test(logs), false);
  // a run in which phones that took our pushes before refuse the token (kept, not counted): still counts only
  db.raw.prepare("UPDATE subs SET pend_w = 1, last_w = '2026-10-01', fails = 0").run();
  for (let i = 0; i < 3; i++) await sub(env, [{ kind: "watch", key: "X24" }], subscription("web.push.apple.com", `apple-old-${i}`), { headers });
  db.raw.prepare("UPDATE subs SET pend_w = 1, last_w = '2026-10-01', fails = 0").run();
  const stopLogs = await spyConsole(async () => { await send(env, kst("2026-10-20T09:00:00"), { fetch: pushService(() => 403).f }); });
  assert.match(stopLogs, /refuse the VAPID token where nothing else went through — kept, not counted/);
  for (const v of db.rows("SELECT id, endpoint FROM subs").flatMap((r) => [r.id, r.endpoint])) assert.equal(stopLogs.includes(v), false);
  const all = JSON.stringify(db.binds) + JSON.stringify(db.rows("SELECT * FROM subs"));
  for (const v of ["203.0.113.77", "198.51.100.9", "TESTUA", "Mozilla", "ko-KR"]) assert.equal(all.includes(v), false, v);
  // the columns are exactly the documented ones
  assert.deepEqual(db.rows("PRAGMA table_info(subs)").map((c) => c.name), ["id", "endpoint", "rules", "pend_w", "last_w", "pend_x", "pend_xl", "exp_sent", "last_x", "fails", "claim"]);
});

test("the log spy sees inside objects (Headers, Request, Error, nested), as a log viewer that expands them would", async () => {
  const req = new Request("https://yoonsiljang-alerts.lsy2825.workers.dev/v1/push/rules/SECRETID_abcdefghijklm", { method: "PUT", headers: { "cf-connecting-ip": "203.0.113.99", "user-agent": "SPYUA/1.0" } });
  const logs = await spyConsole(async () => {
    console.log("subscribe", req.headers);
    console.error("push failed", new Error("https://fcm.googleapis.com/fcm/send/ENDPOINT1"));
    console.log("req", { m: "PUT", request: req });
    console.info({ deep: { deeper: { deepest: { ip: "198.51.100.42" } } } });
    console.trace("t", "TRACE-ONLY");
    console.dir({ dirIp: "192.0.2.77" });
  });
  for (const v of ["203.0.113.99", "SPYUA", "ENDPOINT1", "SECRETID_abcdefghijklm", "198.51.100.42", "TRACE-ONLY", "192.0.2.77"]) assert.ok(logs.includes(v), `spy missed ${v}`);
});

test("factory endpoints need the secret (constant-time compare); watched returns pairs only (no ids, endpoints or numbers)", T, async () => {
  const { env, db } = await setup();
  const a = await sub(env, [{ kind: "watch", key: "X24" }, { kind: "target", key: "X24", max: 90000, region: "서울" }, { kind: "newmatch", key: "T0000ABC" }, { kind: "watch", key: "X24", region: "수도권" }]);
  await sub(env, [{ kind: "watch", key: "X24" }]);
  for (const h of [{}, { authorization: "Bearer wrong" }, { authorization: `Bearer ${SECRET_VALUE}x` }, { authorization: `Basic ${SECRET_VALUE}` }]) {
    assert.equal((await call(worker, env, "GET", "/v1/internal/watched", undefined, { headers: { ...h, origin: null } })).status, 401);
    assert.equal((await call(worker, env, "POST", "/v1/internal/finish", { run: "2026-10-19|2026-10-19", today: "2026-10-19" }, { headers: { ...h, origin: null } })).status, 401);
    assert.equal((await call(worker, env, "POST", "/v1/internal/digest", { run: "2026-10-19|2026-10-19", entries: [] }, { headers: { ...h, origin: null } })).status, 401);
    assert.equal((await call(worker, env, "POST", "/v1/internal/keys", { keys: ["X24"] }, { headers: { ...h, origin: null } })).status, 401);
  }
  assert.deepEqual(db.rows("SELECT * FROM keyset"), [], "nothing stored without the secret");
  assert.equal((await internal({ ...env, ALERTS_SECRET: "" }, "GET", "/v1/internal/watched")).status, 503);
  await mark(env, "2026-10-19", [st("X24", 100000, 5, 120000)]);
  const w = await internal(env, "GET", "/v1/internal/watched?at=0");
  assert.equal(w.status, 200);
  // most-watched first (X24 nationwide: two phones), then (k, r)
  assert.deepEqual(w.body.pairs, [{ k: "X24", r: "" }, { k: "T0000ABC", r: "" }, { k: "X24", r: "서울" }, { k: "X24", r: "수도권" }]);
  assert.deepEqual((await internal(env, "GET", "/v1/internal/watched")).body, w.body, "no at = from the start");
  assert.equal(w.body.next, null);
  const text = JSON.stringify(w.body);
  assert.equal(text.includes(a.id), false);
  assert.equal(text.includes(a.endpoint), false);
  assert.equal(/fcm|endpoint|p256dh|auth|"id"|100000/.test(text), false);
  // digest entries are checked one by one (and carry numbers only)
  for (const e of [{ ...st("X24", 1, 1, 1), k: "X24'; DROP TABLE subs;--" }, { ...st("X24", 1, 1, 1), w: 1 }, { ...st("X24", 1, 1, 1), r: "Seoul" }]) {
    const bad = await internal(env, "POST", "/v1/internal/digest", { run: "2026-10-19|2026-10-19", entries: [e] });
    assert.deepEqual([bad.status, bad.body], [400, { error: "BAD_DIGEST" }]);
  }
});

test("quiet hours: nothing at 07:59, 20:50 or 21:00 KST, sent at 08:00", T, async () => {
  const { env, db } = await setup();
  await sub(env, [{ kind: "watch", key: "X24" }]);
  await news(env, "2026-10-19");
  const push = pushService();
  assert.equal((await send(env, kst("2026-10-19T07:59:00"), { fetch: push.f })).skipped, "window");
  assert.equal((await send(env, kst("2026-10-19T21:00:00"), { fetch: push.f })).skipped, "window");
  assert.equal((await send(env, kst("2026-10-19T20:50:00"), { fetch: push.f })).skipped, "window");
  assert.equal(push.calls.length, 0);
  assert.equal((await send(env, kst("2026-10-19T08:00:00"), { fetch: push.f })).sent, 1);
  assert.equal(push.calls.length, 1);
  assert.equal(db.rows("SELECT pend_w, last_w FROM subs")[0].last_w, "2026-10-19");
  // the scheduled handler uses the same path
  let waited;
  await worker.scheduled({ scheduledTime: kst("2026-10-19T07:50:00") }, env, { waitUntil: (p) => { waited = p; } });
  assert.equal((await waited).skipped, "window");
});

test("send window per push: a run whose clock crosses 20:45 / 21:00 stops; each TTL is computed from that push's own clock", T, async () => {
  const { env, db } = await setup();
  for (let i = 0; i < 10; i++) await sub(env, [{ kind: "watch", key: "X24" }]);
  await news(env, "2026-10-19");
  // the clock moves 30 s each time the Worker reads it: 20:42:30, 20:43:00 … 20:45:00 (last allowed), 20:45:30 → stop
  let t = kst("2026-10-19T20:42:00");
  const seen = [];
  const clock = () => { t += 30e3; seen.push(t); return t; };
  const push = pushService();
  const r = await send(env, kst("2026-10-19T20:40:00"), { fetch: push.f, clock });
  assert.equal(r.sent, 6);
  assert.equal(r.closed, true);
  assert.equal(r.stopped, 4);
  for (const [i, c] of push.calls.entries()) {
    const expected = Math.floor((kst("2026-10-19T21:00:00") - seen[i]) / 1000) - 60;
    assert.equal(c.init.headers.ttl, String(expected), `push ${i} TTL from its own clock`);
  }
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE pend_w = 1 AND claim IS NULL")[0].c, 4, "the rest wait for tomorrow, unclaimed");
  // a clock that jumps past 21:00 mid-run: nothing is sent after it
  const { env: e2 } = await setup();
  for (let i = 0; i < 4; i++) await sub(e2, [{ kind: "watch", key: "X24" }]);
  await news(e2, "2026-10-19");
  const times = [kst("2026-10-19T20:44:00"), kst("2026-10-19T21:00:30"), kst("2026-10-19T21:01:00"), kst("2026-10-19T21:02:00")];
  const p2 = pushService();
  const r2 = await send(e2, kst("2026-10-19T20:40:00"), { fetch: p2.f, clock: () => times.shift() ?? kst("2026-10-19T21:05:00") });
  assert.deepEqual([r2.sent, r2.stopped, p2.calls.length], [1, 3, 1]);
  assert.equal(p2.calls[0].init.headers.ttl, String(16 * 60 - 60));
});

test("weekly bundle: ONE push per phone per 7 days however many news marks (watch, target, newmatch, several days)", T, async () => {
  const { env, db } = await setup();
  await sub(env, [{ kind: "watch", key: "X24" }, { kind: "target", key: "X01", max: 90000 }, { kind: "newmatch", key: "X02" }]);
  const push = pushService();
  const day = (d) => addDays("2026-10-19", d);
  await mark(env, day(0), [st("X24", 100000, 5, 120000), st("X01", 95000, 5, 120000), st("X02", 100000, 5, 120000)]);
  await news(env, day(0), "X24");
  for (const t of ["09:00", "09:10", "15:00"]) await send(env, kst(`${day(0)}T${t}:00`), { fetch: push.f });
  assert.equal(push.calls.length, 1);
  assert.equal((await mark(env, day(1), [st("X01", 85000, 5, 120000)])).weekly, 1, "target crossed");
  await mark(env, day(3), [st("X02", 100000, 7, 120000)]);                 // more branches
  await news(env, day(5), "X24");
  for (let d = 0; d <= 6; d++) for (const t of ["08:00", "12:00", "20:40"]) await send(env, kst(`${day(d)}T${t}:00`), { fetch: push.f });
  assert.equal(push.calls.length, 1, "still one push in days 0–6");
  assert.equal(db.rows("SELECT pend_w FROM subs")[0].pend_w, 1, "the news waits");
  await send(env, kst(`${day(7)}T08:00:00`), { fetch: push.f });
  await send(env, kst(`${day(7)}T09:00:00`), { fetch: push.f });
  assert.equal(push.calls.length, 2, "day 7: the bundled news goes out once");
  assert.equal(db.rows("SELECT pend_w FROM subs")[0].pend_w, 0);
});

test("target: only the moment the lowest price crosses max (or a first price at/below it); no news → no push", T, async () => {
  const { env, db } = await setup();
  await sub(env, [{ kind: "target", key: "X24", max: 90000 }]);
  const reset = () => db.raw.prepare("UPDATE subs SET pend_w = 0").run();
  await mark(env, "2026-10-19", [st("X24", 95000, 5, 120000)]);              // first sight: baseline only
  assert.equal((await mark(env, "2026-10-20", [st("X24", 99000, 5, 120000)])).weekly, 0, "above, going up");
  assert.equal((await mark(env, "2026-10-21", [st("X24", 92000, 5, 120000)])).weekly, 0, "still above");
  assert.equal((await mark(env, "2026-10-22", [st("X24", 92000, 5, 120000)])).weekly, 0, "no change");
  assert.equal((await mark(env, "2026-10-23", [st("X24", 90000, 5, 120000)])).weekly, 1, "crossed: at max");
  reset();
  assert.equal((await mark(env, "2026-10-24", [st("X24", 85000, 5, 120000)])).weekly, 0, "already below");
  // the price vanishes for ONE collection and is back below max: the baseline (85,000, below max) was held, so this is
  // not a crossing (sql.js DIGEST: a bad move needs two collections)
  assert.equal((await mark(env, "2026-10-25", [st("X24", null, 0, null)])).weekly, 0, "no price any more");
  assert.equal((await mark(env, "2026-10-26", [st("X24", 89000, 1, 89000)])).weekly, 0, "back below max after one empty collection: not a crossing");
  assert.deepEqual(db.rows("SELECT m FROM snap")[0], { m: 89000 }, "a rise seen in two collections (none, then 89,000) is the baseline now — without news");
  // no price in two collections in a row: taken; the first price after that, below max, is a crossing
  assert.equal((await mark(env, "2026-10-27", [st("X24", null, 0, null)])).weekly, 0);
  assert.equal((await mark(env, "2026-10-28", [st("X24", null, 0, null)])).weekly, 0);
  assert.deepEqual(db.rows("SELECT m, n FROM snap")[0], { m: null, n: 0 });
  assert.equal((await mark(env, "2026-10-29", [st("X24", 89000, 1, 89000)])).weekly, 1, "first price after none, below max");
});

test("news is sticky: a failed finish keeps it, a rerun delivers it once, the same data twice gives no second news", T, async () => {
  const { env, db } = await setup();
  await sub(env, [{ kind: "watch", key: "X24" }]);
  await mark(env, "2026-10-19", [st("X24", 100000, 5, 120000)]);
  const run = "2026-10-26|2026-10-26";
  // digest with news (the median 1/6 down — a good move, taken at once), then the finish fails (e.g. D1 hiccup): nothing
  // promoted, nothing marked
  assert.equal((await internal(env, "POST", "/v1/internal/digest", { run, entries: [st("X24", 100000, 5, 100000)] })).status, 200);
  const realBatch = env.DB.batch;
  env.DB.batch = async () => { throw new Error("D1 is having a bad day"); };
  assert.equal((await internal(env, "POST", "/v1/internal/finish", { run, today: "2026-10-26" }, at("2026-10-26"))).status, 500);
  env.DB.batch = realBatch;
  assert.deepEqual(db.rows("SELECT med, p, pmed FROM snap"), [{ med: 120000, p: 1, pmed: 100000 }], "baseline untouched, news pending");
  assert.equal(db.rows("SELECT pend_w FROM subs")[0].pend_w, 0);
  // the next run (same data) digests again and finishes: the news is delivered once
  assert.equal((await mark(env, "2026-10-27", [st("X24", 100000, 5, 100000)], "2026-10-26")).weekly, 1);
  assert.deepEqual(db.rows("SELECT med, p FROM snap"), [{ med: 100000, p: 0 }], "promoted after marking");
  db.raw.prepare("UPDATE subs SET pend_w = 0").run();
  assert.equal((await mark(env, "2026-10-28", [st("X24", 100000, 5, 100000)], "2026-10-26")).weekly, 0, "same data again: no news");
  // two digests before one finish (a failed later chunk, then a rerun): still one news
  await internal(env, "POST", "/v1/internal/digest", { run: "2026-11-02|2026-11-02", entries: [st("X24", 100000, 5, 90000)] });
  assert.equal((await mark(env, "2026-11-02", [st("X24", 100000, 5, 90000)], "2026-11-02")).weekly, 1);
  // prices back to the baseline before any finish → no longer news
  db.raw.prepare("UPDATE subs SET pend_w = 0").run();
  await internal(env, "POST", "/v1/internal/digest", { run: "2026-11-09|2026-11-09", entries: [st("X24", 100000, 5, 80000)] });
  assert.equal((await mark(env, "2026-11-10", [st("X24", 100000, 5, 90000)], "2026-11-09")).weekly, 0);
});

test("watch news in SQL = push.js watchMoved() (random numbers)", T, async () => {
  const { db } = await setup();
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const prices = [null, 0, 90000, 95000, 99999, 100000, 104999, 105000, 110000, 120000];
  db.raw.prepare("INSERT INTO subs (id, endpoint, rules) VALUES ('i', 'https://fcm.googleapis.com/x', '[{\"kind\":\"watch\",\"key\":\"X24\"}]')").run();
  for (let i = 0; i < 400; i++) {
    const b = { m: rnd(prices), med: rnd(prices) }, now = { m: rnd(prices), med: rnd(prices) };
    db.raw.exec("DELETE FROM snap; UPDATE subs SET pend_w = 0");
    db.raw.prepare("INSERT INTO snap (k, r, m, n, med, bu, p, pm, pn, pmed, run) VALUES ('X24', '', ?, 5, ?, 'u', 1, ?, 5, ?, 'r')").run(b.m, b.med, now.m, now.med);
    db.raw.prepare(Q.MARK_WEEKLY).run();
    assert.equal(db.rows("SELECT pend_w FROM subs")[0].pend_w === 1, watchMoved(b, now), JSON.stringify([b, now]));
  }
});

test("expiring: once per end date, at most one stand-alone a day, rides along with weekly, ended dates dropped", T, async () => {
  const { env, db } = await setup();
  await sub(env, [{ kind: "expiring", key: "X24", max: 80000 }, { kind: "watch", key: "X01" }]);
  const push = pushService();
  const ending = (u, e = 75000, s = 90000) => ({ ...st("X24", 75000, 5, 90000), e, s, u });
  await mark(env, "2026-10-18", [st("X01", 50000, 4, 60000), st("X24", 75000, 5, 90000)]);
  // a price ≤ max ends but another ≤ max stays → nothing to say
  assert.equal((await mark(env, "2026-10-19", [ending("2026-10-21", 75000, 79000)])).expiring, 0);
  // the only price ≤ max ends on 10-21
  assert.equal((await mark(env, "2026-10-19", [ending("2026-10-21")])).expiring, 1);
  await send(env, kst("2026-10-19T09:00:00"), { fetch: push.f });
  assert.equal(push.calls.length, 1);
  await mark(env, "2026-10-20", [ending("2026-10-21")]);                       // same end date the next day
  await send(env, kst("2026-10-20T09:00:00"), { fetch: push.f });
  assert.equal(push.calls.length, 1, "same end date only once");
  await mark(env, "2026-10-20", [ending("2026-10-23")]);                       // a new end date; last push was 10-19
  await send(env, kst("2026-10-20T09:10:00"), { fetch: push.f });
  assert.equal(push.calls.length, 2);
  await mark(env, "2026-10-20", [ending("2026-10-24")]);                       // another one the same day → waits for tomorrow
  await send(env, kst("2026-10-20T10:00:00"), { fetch: push.f });
  assert.equal(push.calls.length, 2, "one stand-alone expiring push a day");
  // tomorrow: weekly news (X01's median 10% down) + the waiting expiring → one push clears both
  await mark(env, "2026-10-21", [ending("2026-10-24"), st("X01", 50000, 4, 54000)]);
  await send(env, kst("2026-10-21T08:00:00"), { fetch: push.f });
  await send(env, kst("2026-10-21T08:10:00"), { fetch: push.f });
  assert.equal(push.calls.length, 3, "weekly + expiring together = one push");
  const row = db.rows("SELECT * FROM subs")[0];
  assert.deepEqual([row.pend_w, row.pend_x, row.pend_xl, JSON.parse(row.exp_sent), row.last_w],
    [0, null, null, ["X24||2026-10-21", "X24||2026-10-23", "X24||2026-10-24"], "2026-10-21"], "every announced (pair, end date) is remembered");
  // the factory's finish forgets announced entries whose end date passed (today 10-24: 10-21 and 10-23 are over)
  await mark(env, "2026-10-24", [ending("2026-10-24")]);
  assert.deepEqual(JSON.parse(db.rows("SELECT exp_sent FROM subs")[0].exp_sent), ["X24||2026-10-24"]);
  await mark(env, "2026-10-25", [st("X24", 75000, 5, 90000)]);
  assert.equal(db.rows("SELECT exp_sent FROM subs")[0].exp_sent, null, "nothing left to remember");
  // an end date that passed before it could be sent is dropped
  db.raw.prepare("UPDATE subs SET pend_x = '2026-10-25', last_x = '2026-10-26'").run();
  await send(env, kst("2026-10-26T09:00:00"), { fetch: push.f });
  assert.equal(push.calls.length, 3);
  assert.equal(db.rows("SELECT pend_x FROM subs")[0].pend_x, null);
});

test("push service answers: 404/410 delete, a 4xx-style failure retries (10 in a row deletes), 429 stops that host, 401/403 count against the row", T, async () => {
  const { env, db } = await setup();
  await sub(env, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/gone"));
  await sub(env, [{ kind: "watch", key: "X24" }], subscription("updates.push.services.mozilla.com", "wpush/v2/g410"));
  const flaky = await sub(env, [{ kind: "watch", key: "X24" }], subscription("web.push.apple.com", "flaky"));
  await news(env, "2026-10-19");
  // 400 = this row's own failure (a 5xx/redirect/timeout is the push service's: see the host-trouble tests below)
  const push = pushService((u) => (u.includes("/gone") ? 404 : u.includes("g410") ? 410 : 400));
  const r = await send(env, kst("2026-10-19T09:00:00"), { fetch: push.f });
  assert.deepEqual([r.sent, r.gone, r.retry], [0, 2, 1]);
  assert.deepEqual(db.rows("SELECT id, fails, claim FROM subs"), [{ id: flaky.id, fails: 1, claim: null }]);
  // a row that took our pushes before (last_w set) gets RETRY_DROP tries; one that never did (planted, or a dead
  // endpoint from the start) only NEVER_DROP
  db.raw.prepare("UPDATE subs SET last_w = '2026-10-01'").run();
  for (let i = 1; i < RETRY_DROP - 1; i++) await send(env, kst("2026-10-19T09:00:00") + i * 20 * 60e3, { fetch: push.f });
  assert.deepEqual(db.rows("SELECT fails FROM subs"), [{ fails: RETRY_DROP - 1 }], "still there one failure before RETRY_DROP");
  await send(env, kst("2026-10-19T09:00:00") + (RETRY_DROP - 1) * 20 * 60e3, { fetch: push.f });
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 0, `${RETRY_DROP} failures in a row → removed`);
  const never = await sub(env, [{ kind: "watch", key: "X24" }], subscription("web.push.apple.com", "never-took-one"));
  await news(env, "2026-10-20");
  for (let i = 0; i < NEVER_DROP - 1; i++) await send(env, kst("2026-10-20T09:00:00") + i * 20 * 60e3, { fetch: push.f });
  assert.deepEqual(db.rows("SELECT id, fails FROM subs"), [{ id: never.id, fails: NEVER_DROP - 1 }]);
  await send(env, kst("2026-10-20T09:00:00") + (NEVER_DROP - 1) * 20 * 60e3, { fetch: push.f });
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 0, `a row that never received a push: removed after ${NEVER_DROP} failures of any kind`);

  // 429: the rest of that host waits
  const { env: env2, db: db2 } = await setup();
  for (let i = 0; i < 5; i++) await sub(env2, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", `fcm/send/s${i}`));
  await news(env2, "2026-10-19");
  const slow = pushService(() => 429);
  const r2 = await send(env2, kst("2026-10-19T09:00:00"), { fetch: slow.f });
  assert.equal(r2.sent, 0);
  assert.ok(slow.calls.length <= 6, "no more than one parallel group hits a slow host");
  assert.equal(db2.rows("SELECT count(*) c FROM subs WHERE pend_w = 1 AND claim < 0 AND fails = 0")[0].c, 5, "held back unchanged (SLOW_HOLD_MINUTES)");
  assert.equal((await send(env2, kst("2026-10-19T09:10:00"), { fetch: slow.f })).sent, 0);
  assert.ok(slow.calls.length <= 6, "a held row is not claimed again before its hold ends");
  // 401/403 from phones that never took a push (made with another key, or planted): refused for ever, so removed at the FIRST
  // refusal — a planted refusing row costs one try, not three. After SLOW_HOLD_MINUTES the held rows come back as probes,
  // PROBES a run (nothing 2xx from that host frees the rest at once)
  const refused = pushService(() => 403);
  const r3 = [];
  for (let i = 0; i < 3; i++) r3.push(await send(env2, kst("2026-10-19T09:00:00") + (SLOW_HOLD_MINUTES + 10 * i) * 60e3, { fetch: refused.f }));
  assert.deepEqual(r3.map((r) => [r.refused, r.probes]), [[PROBES, PROBES], [PROBES, PROBES], [5 - 2 * PROBES, 5 - 2 * PROBES]], "held rows come back PROBES a run");
  assert.equal(r3.some((r) => r.spared || r.refusing), false, "planted rows never make a service suspect");
  assert.equal(refused.calls.length, 5, "every row tried once");
  assert.equal(db2.rows("SELECT count(*) c FROM subs")[0].c, 0, "never-pushed rows are removed at their first 401/403");
  // phones that DID take a push before, at a push service that took another push 2xx in the same run: one failure each, and
  // in later runs (only they are due) they were last reached before this key first went through there (stat 'ok:', written
  // by that 2xx): still their own refusals — removed after REFUSED_DROP in a row
  const { env: env4, db: db4 } = await setup();
  for (let i = 0; i < 2; i++) await sub(env4, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", `fcm/send/took${i}`));
  await sub(env4, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/works"));
  await news(env4, "2026-10-19");
  db4.raw.prepare("UPDATE subs SET last_w = '2026-10-01'").run();
  const refused4 = pushService((u) => (u.endsWith("/works") ? 201 : 403));
  const r4 = await send(env4, kst("2026-10-19T09:10:00"), { fetch: refused4.f });
  assert.deepEqual([r4.sent, r4.refused, r4.spared, r4.refusing], [1, 2, undefined, undefined], "a service that took a push in the run is not suspect");
  assert.deepEqual(db4.rows("SELECT DISTINCT fails, claim FROM subs WHERE endpoint NOT LIKE '%works'"), [{ fails: 1, claim: null }]);
  for (let i = 2; i <= REFUSED_DROP; i++) await send(env4, kst("2026-10-19T09:10:00") + i * 20 * 60e3, { fetch: refused4.f });
  assert.equal(db4.rows("SELECT count(*) c FROM subs WHERE endpoint NOT LIKE '%works'")[0].c, 0, `${REFUSED_DROP} refusals in a row → removed`);
  // a 401 counts the same; a success in between resets the count (an old subscription: last reached before this key first
  // went through Apple)
  const { env: env3, db: db3, k: k3 } = await setup();
  await sub(env3, [{ kind: "watch", key: "X24" }], subscription("web.push.apple.com", "a401"));
  await news(env3, "2026-10-19");
  db3.raw.prepare("UPDATE subs SET last_w = '2026-10-01'").run();
  okSince(db3, k3.pub, "https://web.push.apple.com", "2026-10-10");
  await send(env3, kst("2026-10-19T09:00:00"), { fetch: pushService(() => 401).f });
  assert.equal(db3.rows("SELECT fails FROM subs")[0].fails, 1);
  await send(env3, kst("2026-10-19T09:10:00"), { fetch: pushService(() => 201).f });
  assert.equal(db3.rows("SELECT fails FROM subs")[0].fails, 0);
});

test("planted 403 subscriptions cannot stop everyone's pushes: 6 refusing + 30 real phones, one day of cron runs", T, async () => {
  const { env, db } = await setup();
  // the attacker's six come first (subscribed first, never sent: the front of the queue), from two push services
  const bad = [];
  for (let i = 0; i < 6; i++) bad.push(await sub(env, [{ kind: "watch", key: "X24" }], subscription(i % 2 ? "updates.push.services.mozilla.com" : "fcm.googleapis.com", `bad/${i}`)));
  const good = [];
  for (let i = 0; i < 30; i++) good.push(await sub(env, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", `fcm/send/good${i}`)));
  await news(env, "2026-10-19");
  const push = pushService((u) => (u.includes("/bad/") ? 403 : 201));
  // the very first run (the six refusing rows in its first parallel group) is not stopped: everyone else is sent
  const first = await send(env, kst("2026-10-19T08:00:00"), { fetch: push.f });
  assert.deepEqual([first.sent, first.refused, first.spared, first.refusing], [30, 6, undefined, undefined]);
  let runs = 1;
  for (let m = 8 * 60 + 10; m <= 20 * 60 + 40; m += 10, runs++) await send(env, kst("2026-10-19T00:00:00") + m * 60e3, { fetch: push.f });
  assert.equal(runs, 77);
  const sentTo = new Set(push.calls.filter((c) => c.url.includes("good")).map((c) => c.url));
  assert.equal(sentTo.size, 30, "all 30 real phones got their push that day");
  assert.equal(push.calls.filter((c) => c.url.includes("good")).length, 30, "once each");
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE pend_w = 1")[0].c, 0);
  const left = new Set(db.rows("SELECT id FROM subs").map((r) => r.id));
  assert.equal(bad.filter((b) => left.has(b.id)).length, 0, "the refusing rows are removed");
  assert.equal(good.filter((g) => left.has(g.id)).length, 30);
  assert.equal(push.calls.filter((c) => c.url.includes("/bad/")).length, 6, "each planted refusing row cost exactly one try: removed at its first 401/403");
});

test("401/403 where our setup may be broken (a phone that took our pushes under this key refuses, nothing went through there): every row still tried, nobody removed; one 2xx from that service in the run → counted", T, async () => {
  const { env, db } = await setup();
  for (let i = 0; i < 10; i++) await sub(env, [{ kind: "watch", key: "X24" }], subscription(i % 2 ? "web.push.apple.com" : "fcm.googleapis.com", `old/${i}`));
  await news(env, "2026-10-19");
  db.raw.prepare("UPDATE subs SET last_w = '2026-10-01'").run();      // all of them took our pushes before
  const refused = pushService(() => 403);
  const r = await send(env, kst("2026-10-19T09:00:00"), { fetch: refused.f });
  assert.deepEqual([r.sent, r.refused, r.spared, r.refusing], [0, 10, 10, 2], JSON.stringify(r));
  assert.equal(refused.calls.length, 10, "no early stop: a 2xx later in the run would tell an old subscription from a broken setup");
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 10, "nobody removed");
  assert.deepEqual(db.rows("SELECT DISTINCT fails, claim < 0 AS held, pend_w FROM subs"), [{ fails: 0, held: 1, pend_w: 1 }], "held back unchanged (HOLD_MINUTES), the news waits");
  assert.equal((await call(worker, env, "GET", "/health", undefined, { now: kst("2026-10-19T10:00:00") })).body.refusing, true);
  // one success from that push service in the run → the refusals there are those phones' own
  const { env: e2 } = await setup();
  for (let i = 0; i < 4; i++) await sub(e2, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", `mix/${i}`));
  await news(e2, "2026-10-19");
  e2.DB.raw.prepare("UPDATE subs SET last_w = '2026-10-01'").run();
  const r2 = await send(e2, kst("2026-10-19T09:00:00"), { fetch: pushService((u) => (u.endsWith("/mix/0") ? 201 : 403)).f });
  assert.deepEqual([r2.sent, r2.refused, r2.spared, r2.refusing], [1, 3, undefined, undefined]);
  assert.deepEqual(e2.DB.rows("SELECT fails FROM subs WHERE endpoint NOT LIKE '%/mix/0' GROUP BY fails"), [{ fails: 1 }]);
});

test("review finding (refusal threshold per run): Apple refuses our token, only 1 or 2 of its 30 phones have news that day — nobody is removed, /health refusing:true", T, async () => {
  for (const due of [1, 2, 3]) {
    const { env, db } = await setup();
    const phones = [];
    for (let i = 0; i < 30; i++) phones.push(await sub(env, [{ kind: "watch", key: i < due ? "X24" : "X01" }], subscription("web.push.apple.com", `a/${i}`)));
    await news(env, "2026-10-19");                                     // news for X24 only: `due` phones
    db.raw.prepare("UPDATE subs SET last_w = '2026-10-01'").run();     // all 30 took our pushes before
    const push = pushService(() => 403);
    for (let m = 8 * 60; m <= 20 * 60 + 40; m += 10) await send(env, kst("2026-10-19T00:00:00") + m * 60e3, { fetch: push.f });
    assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 30, `${due} due: all 30 phones are still there`);
    assert.equal(db.rows("SELECT count(*) c FROM subs WHERE fails > 0")[0].c, 0, `${due} due: nobody counted`);
    assert.equal((await call(worker, env, "GET", "/health", undefined, { now: kst("2026-10-20T09:30:00") })).body.refusing, true, `${due} due: the monitor is told`);
  }
});

test("a cron run that starts late is judged by the real clock: nothing after the window, TTL from the real time", T, async () => {
  const { env } = await setup();
  for (let i = 0; i < 2; i++) await sub(env, [{ kind: "watch", key: "X24" }]);
  await news(env, "2026-10-19");
  const realNow = Date.now, realFetch = globalThis.fetch;
  const push = pushService();
  const scheduled = async (scheduledIso, nowIso) => {
    Date.now = () => kst(nowIso);
    globalThis.fetch = push.f;
    try {
      let waited;
      await worker.scheduled({ scheduledTime: kst(scheduledIso) }, env, { waitUntil: (p) => { waited = p; } });
      return await waited;
    } finally { Date.now = realNow; globalThis.fetch = realFetch; }
  };
  // scheduled for 20:40, started at 21:05: outside the window, nothing sent
  const late = await scheduled("2026-10-19T20:40:00", "2026-10-19T21:05:00");
  assert.equal(late.skipped, "window");
  assert.equal(push.calls.length, 0);
  // scheduled for 20:40, started at 20:42:30: sent, TTL counted from 20:42:30 (ends 60 s before 21:00)
  const r = await scheduled("2026-10-19T20:40:00", "2026-10-19T20:42:30");
  assert.equal(r.sent, 2);
  for (const c of push.calls) {
    assert.equal(c.init.headers.ttl, String((17 * 60 + 30) - 60));
    assert.ok(kst("2026-10-19T20:42:30") + Number(c.init.headers.ttl) * 1000 <= kst("2026-10-19T21:00:00") - 60e3);
  }
});

test("redirects are never followed: a 302 from the push service = one request; it counts against the row only when that service took another push in the run", T, async () => {
  const { env, db, k } = await setup();
  okSince(db, k.pub, "https://fcm.googleapis.com", "2026-10-01");     // FCM took our pushes before: a push service is there
  await sub(env, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/moved"));
  await news(env, "2026-10-19");
  const push = pushService(() => 302);
  const r = await send(env, kst("2026-10-19T09:00:00"), { fetch: push.f });
  assert.equal(push.calls.length, 1, "exactly one request");
  assert.equal(push.calls[0].init.redirect, "manual");
  assert.deepEqual([r.sent, r.retry, r.held], [0, 0, 1], "a redirect and nothing else answered: the service, not the row — held back, not counted");
  assert.deepEqual(db.rows("SELECT pend_w, fails, claim < 0 AS held FROM subs"), [{ pend_w: 1, fails: 0, held: 1 }]);
  // the same origin took another push 2xx in that run: the redirect was this row's
  await sub(env, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/fine"));
  await news(env, "2026-10-20");
  const mixed = pushService((u) => (u.endsWith("/moved") ? 302 : 201));
  const r2 = await send(env, kst("2026-10-20T09:00:00"), { fetch: mixed.f });
  assert.deepEqual([r2.sent, r2.retry, r2.held], [1, 1, 0]);
  assert.deepEqual(db.rows("SELECT fails FROM subs WHERE endpoint LIKE '%moved'"), [{ fails: 1 }]);
});

test(`at most SEND_LIMIT (${SEND_LIMIT}) pushes per run; the rest wait; overlapping runs never double-send; longest wait first`, T, async () => {
  const { env, db } = await setup();
  for (let i = 0; i < SEND_LIMIT + 5; i++) await sub(env, [{ kind: "watch", key: "X24" }]);
  await news(env, "2026-10-19");
  const push = pushService();
  const [a, b] = await Promise.all([send(env, kst("2026-10-19T09:00:00"), { fetch: push.f }), send(env, kst("2026-10-19T09:00:00"), { fetch: push.f })]);
  assert.equal(a.sent + b.sent, SEND_LIMIT, "two runs in the same minute share one limit (CLAIM_W counts that minute's claims)");
  assert.equal(new Set(push.calls.map((c) => c.url)).size, push.calls.length, "no phone twice");
  const c = await send(env, kst("2026-10-19T09:10:00"), { fetch: push.f });
  assert.equal(c.sent, 5);
  assert.equal(new Set(push.calls.map((x) => x.url)).size, SEND_LIMIT + 5, "no phone twice");
  assert.equal((await send(env, kst("2026-10-19T09:20:00"), { fetch: push.f })).sent, 0);
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE pend_w = 1")[0].c, 0);
  // one run alone stops at the limit
  const { env: env2 } = await setup();
  for (let i = 0; i < SEND_LIMIT + 5; i++) await sub(env2, [{ kind: "watch", key: "X24" }]);
  await news(env2, "2026-10-19");
  const p2 = pushService();
  assert.equal((await send(env2, kst("2026-10-19T09:00:00"), { fetch: p2.f })).sent, SEND_LIMIT);
  assert.equal((await send(env2, kst("2026-10-19T09:10:00"), { fetch: p2.f })).sent, 5);
  // longest-waiting first: never sent, then the oldest last_w
  const { env: env3, db: db3 } = await setup({ SEND_LIMIT: "2" });
  const recent = await sub(env3, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/recent"));
  const old = await sub(env3, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/old"));
  const never = await sub(env3, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/never"));
  db3.raw.prepare("UPDATE subs SET last_w = ? WHERE id = ?").run("2026-10-11", recent.id);
  db3.raw.prepare("UPDATE subs SET last_w = ? WHERE id = ?").run("2026-09-01", old.id);
  await news(env3, "2026-10-19");
  const p3 = pushService();
  await send(env3, kst("2026-10-19T09:00:00"), { fetch: p3.f });
  assert.deepEqual(p3.calls.map((x) => x.url).sort(), [never.endpoint, old.endpoint].sort());
  // rows that keep failing go last: a never-sent row with fails = 2 waits behind one that was sent a week ago
  const { env: env4, db: db4 } = await setup({ SEND_LIMIT: "1" });
  const failing = await sub(env4, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/failing"));
  const fine = await sub(env4, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/fine"));
  db4.raw.prepare("UPDATE subs SET fails = 2 WHERE id = ?").run(failing.id);
  db4.raw.prepare("UPDATE subs SET last_w = '2026-10-11' WHERE id = ?").run(fine.id);
  await news(env4, "2026-10-19");
  const p4 = pushService();
  await send(env4, kst("2026-10-19T09:00:00"), { fetch: p4.f });
  assert.deepEqual(p4.calls.map((x) => x.url), [fine.endpoint]);
});

test("a full day: expiring deadlines are sent before weekly news (nearest end date first), even when the limit is short", T, async () => {
  const { env, db } = await setup({ SEND_LIMIT: "3" });
  const weekly = [];
  for (let i = 0; i < 4; i++) weekly.push(await sub(env, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", `fcm/send/w${i}`)));
  const x21 = await sub(env, [{ kind: "watch", key: "X01" }], subscription("fcm.googleapis.com", "fcm/send/x21"));
  const x20 = await sub(env, [{ kind: "watch", key: "X01" }], subscription("fcm.googleapis.com", "fcm/send/x20"));
  await news(env, "2026-10-19");
  // the two expiring phones got their weekly bundle yesterday (the back of the weekly queue), their deadlines are near
  db.raw.prepare(`UPDATE subs SET last_w = '2026-10-18', pend_x = '2026-10-21', pend_xl = '["X01||2026-10-21"]' WHERE id = ?`).run(x21.id);
  db.raw.prepare(`UPDATE subs SET last_w = '2026-10-18', pend_x = '2026-10-20', pend_xl = '["X01||2026-10-20"]' WHERE id = ?`).run(x20.id);
  const push = pushService();
  await send(env, kst("2026-10-19T09:00:00"), { fetch: push.f });
  assert.deepEqual(push.calls.map((c) => c.url).slice(0, 2), [x20.endpoint, x21.endpoint], "deadlines first, nearest first");
  assert.equal(push.calls.length, 3, "then weekly news fills the rest of the limit");
  assert.deepEqual(db.rows("SELECT exp_sent FROM subs WHERE id IN (?, ?) ORDER BY exp_sent", x20.id, x21.id).map((r) => r.exp_sent), ['["X01||2026-10-20"]', '["X01||2026-10-21"]']);
});

test("stale claims: a send run clears claims older than 15 minutes (claim is kept only while sending)", T, async () => {
  const { env, db } = await setup();
  const a = await sub(env, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/a"));
  const b = await sub(env, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/b"));
  const c = await sub(env, [{ kind: "watch", key: "X01" }], subscription("fcm.googleapis.com", "fcm/send/c"));
  await news(env, "2026-10-19");
  const now = kst("2026-10-19T10:00:00"), minute = Math.floor(now / 60e3);
  const set = db.raw.prepare("UPDATE subs SET claim = ? WHERE id = ?");
  set.run(minute - 20, a.id);          // a run that died 20 minutes ago (news waiting)
  set.run(minute - 5, b.id);           // a run still going
  set.run(minute - 600, c.id);         // nothing due, claim left behind
  const push = pushService();
  const r = await send(env, now, { fetch: push.f });
  assert.equal(r.sent, 1);
  assert.deepEqual(push.calls.map((x) => x.url), [a.endpoint]);
  assert.deepEqual(db.rows("SELECT id, claim FROM subs ORDER BY id").map((x) => [x.id, x.claim]).sort(),
    [[a.id, null], [b.id, minute - 5], [c.id, null]].sort());
});

test("the push: empty body, TTL until 21:00 minus 60 s, VAPID JWT that verifies (aud = push origin, sub = app URL), cached per origin", T, async () => {
  const { env, db, k } = await setup();
  await sub(env, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/one"));
  await sub(env, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/two"));
  await news(env, "2026-10-19");
  const push = pushService();
  const now = kst("2026-10-19T20:00:00");
  await send(env, now, { fetch: push.f, clock: () => now });
  assert.equal(push.calls.length, 2);
  const { init } = push.calls[0];
  assert.equal(init.method, "POST");
  assert.equal(init.body.byteLength, 0);
  assert.equal(init.headers.ttl, "3540");
  assert.equal(init.headers.urgency, "normal");
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(init.headers.authorization);
  assert.ok(m);
  assert.equal(m[2], k.pub);
  const [h, p, s] = m[1].split(".");
  const ok = await wc.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k.publicKey, unb64u(s), new TextEncoder().encode(`${h}.${p}`));
  assert.equal(ok, true, "signature verifies with the public key");
  const claims = JSON.parse(new TextDecoder().decode(unb64u(p)));
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, APP);
  assert.ok(claims.exp - now / 1000 <= 24 * 3600);
  assert.equal(push.calls[1].init.headers.authorization, init.headers.authorization, "one JWT per origin");
  assert.equal(db.rows("SELECT count(*) c FROM vapid")[0].c, 1);
  // a later run the same evening reuses the token cached in D1 (Apple: do not mint more than one an hour)
  await sub(env, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/three"));
  await news(env, "2026-10-19");
  const later = kst("2026-10-19T20:20:00");
  await send(env, later, { fetch: push.f, clock: () => later });
  assert.equal(push.calls.length, 3);
  assert.equal(push.calls[2].init.headers.authorization.split(", k=")[0], init.headers.authorization.split(", k=")[0]);
  assert.equal(push.calls[2].init.headers.ttl, String(40 * 60 - 60));
});

test("health: GET /health → 200 {ok:true,…} (what the monitor counts as alive); D1 failing → 503 {ok:false}; keys reported", T, async () => {
  const { env, k } = await setup();
  const other = await vapidKeys();
  await sub(env, [{ kind: "watch", key: "X24" }]);
  await news(env, "2026-10-19");
  const push = pushService();
  assert.equal((await send({ ...env, VAPID_PRIVATE_JWK: "" }, kst("2026-10-19T09:00:00"), { fetch: push.f })).skipped, "keys");
  assert.equal((await send({ ...env, VAPID_PRIVATE_JWK: other.jwk }, kst("2026-10-19T09:00:00"), { fetch: push.f })).skipped, "keys");
  assert.equal(push.calls.length, 0);
  for (const path of ["/health", "/v1/health"]) {
    const h = await call(worker, env, "GET", path, undefined, { headers: { origin: null } });
    assert.equal(h.status, 200);
    assert.deepEqual(h.body, { ok: true, window: "08-21 KST", sending: true, key: k.pub, finished: "2026-10-19", stale: false, refusing: false, capacity: "ok", pairs: "ok" });
    assert.equal(h.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(h.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual((({ sending, key }) => ({ sending, key }))((await call(worker, { ...env, VAPID_PRIVATE_JWK: other.jwk }, "GET", "/health")).body),
    { sending: false, key: null }, "VAPID_PUBLIC_KEY set to another key: nothing is sent and no key is shown");
  assert.deepEqual((({ sending, key }) => ({ sending, key }))((await call(worker, { ...env, VAPID_PRIVATE_JWK: "" }, "GET", "/health")).body), { sending: false, key: null });
  // finished = the KST day of the factory's last finish (so a monitor sees the factory → Worker link stop); null before any
  await mark(env, "2026-10-21", []);
  assert.equal((await call(worker, env, "GET", "/health")).body.finished, "2026-10-21");
  const { env: blank, k: kb } = await setup();
  assert.deepEqual((await call(worker, blank, "GET", "/health")).body, { ok: true, window: "08-21 KST", sending: true, key: kb.pub, finished: null, stale: false, refusing: false, capacity: "ok", pairs: "ok" });
  const down = { ...env, DB: { prepare: () => ({ bind() { return this; }, first: async () => { throw new Error("D1_ERROR: unavailable"); } }) } };
  const logs = await spyConsole(async () => {
    const h = await call(worker, down, "GET", "/health", undefined, { headers: { origin: null } });
    assert.deepEqual([h.status, h.body], [503, { ok: false }]);
  });
  assert.match(logs, /D1 did not answer/);
  const noDb = await call(worker, { ...env, DB: undefined }, "GET", "/health");
  assert.deepEqual([noDb.status, noDb.body], [503, { ok: false }]);
});

test("the claim query picks exactly the rows dueKinds() calls due (random rows)", T, async () => {
  const { db } = await setup();
  const today = "2026-10-19", days = [null, "2026-10-10", "2026-10-12", "2026-10-13", "2026-10-18", today, "2026-10-21"];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const ins = db.raw.prepare("INSERT INTO subs (id, endpoint, rules, pend_w, last_w, pend_x, exp_sent, last_x, fails) VALUES (?, ?, '[]', ?, ?, ?, ?, ?, ?)");
  const rows = [];
  for (let i = 0; i < 400; i++) {
    const r = { id: `id${i}`.padEnd(22, "x"), pend_w: pick([0, 1]), last_w: pick(days), pend_x: pick([null, today, "2026-10-20", "2026-10-22"]), exp_sent: pick([null, '["X24||2026-10-20"]']), last_x: pick(days), fails: pick([0, 0, 1, 4]) };
    ins.run(r.id, `https://fcm.googleapis.com/${i}`, r.pend_w, r.last_w, r.pend_x, r.exp_sent, r.last_x, r.fails);
    rows.push(r);
  }
  const x = db.rows(Q.CLAIM_X, 1000, addDays(today, -7), today, 1000), w = db.rows(Q.CLAIM_W, 1000, addDays(today, -7), today, 1000),
    f = db.rows(Q.CLAIM_F, 1000, addDays(today, -7), today, 1000, 1000);
  const claimed = new Set([...x, ...w, ...f].map((r) => r.id));
  assert.equal(claimed.size, x.length + w.length + f.length, "no row claimed twice");
  for (const r of x) assert.equal(dueKinds(rows.find((y) => y.id === r.id), today).expiring, true, "CLAIM_X: expiring due only");
  for (const r of [...x, ...w]) assert.equal(r.fails, 0, "CLAIM_X/CLAIM_W: rows that never failed only");
  for (const r of f) assert.ok(r.fails > 0, "CLAIM_F: rows that failed before only");
  for (const r of rows) {
    const d = dueKinds(r, today);
    assert.equal(claimed.has(r.id), d.weekly || d.expiring, JSON.stringify(r));
  }
});

test("index-friendly send queries (EXPLAIN QUERY PLAN) and capacity: MAX_SUBS fits what the cron can send", T, async () => {
  const { db } = await setup();
  const plan = (sql, ...a) => db.rows("EXPLAIN QUERY PLAN " + sql, ...a).map((r) => r.detail).join(" | ");
  assert.match(Q.CLAIM_W, /fails = 0 AND claim IS NULL[\s\S]*ORDER BY coalesce\(last_w, ''\) ASC LIMIT/, "rows that never failed, longest-waiting first — stated, not left to the planner");
  assert.match(Q.CLAIM_X, /fails = 0 AND claim IS NULL[\s\S]*ORDER BY pend_x LIMIT max\(0, \?4 - \(SELECT count\(\*\) FROM subs WHERE claim = \?1\)\)/, "rows that never failed, nearest deadline first, in what the probes left");
  assert.match(Q.CLAIM_F, /fails > 0 AND claim IS NULL[\s\S]*ORDER BY \(last_w IS NULL AND last_x IS NULL\), fails, coalesce\(last_w, ''\) ASC LIMIT max\(0, min\(\?5,/, "rows that failed before: rows that took a push before first, then fewest failures, FAIL_SLOTS at most");
  const claim = plan(Q.CLAIM_W, 1, "2026-10-12", "2026-10-19", 40);
  assert.match(claim, /USING INDEX subs_due \(fails=\?\)/);
  assert.equal(/TEMP B-TREE/.test(claim), false, `no sort for ORDER BY: ${claim}`);
  const claimX = plan(Q.CLAIM_X, 1, "2026-10-12", "2026-10-19", 40);
  assert.match(claimX, /USING INDEX subs_x \(fails=\? AND pend_x>\?\)/, "the index seeks past rows that failed and past ended dates");
  assert.equal(/TEMP B-TREE/.test(claimX), false, `no sort for ORDER BY: ${claimX}`);
  const claimF = plan(Q.CLAIM_F, 1, "2026-10-12", "2026-10-19", 40, FAIL_SLOTS);
  assert.match(claimF, /USING INDEX subs_fail/, "the partial index in exactly this order");
  assert.equal(/TEMP B-TREE/.test(claimF), false, `no sort for ORDER BY: ${claimF}`);
  assert.equal(/EVICT_IDLE|PRUNE_SUBS/.test(Object.keys(Q).join()), false, "no eviction and no retention statement exists");
  assert.match(plan(Q.RESET_STALE, 100), /USING INDEX subs_claim/);
  assert.match(plan(Q.CLAIM_P, 100, PROBES, PROBE_SLOTS), /USING INDEX subs_claim \(claim>\? AND claim<\?\)/, "the probes read the held rows only");
  assert.match(plan(Q.RELEASE_HELD, "https://fcm.googleapis.com"), /USING INDEX subs_claim \(claim<\?\)/, "a push origin's release walks the held rows only");
  assert.match(plan(Q.DROP_ENDED, "2026-10-19"), /USING INDEX subs_x/, "the partial index: rows with a pending expiring only");
  // the watched list reads the factory's key set once per statement (an uncorrelated list subquery over json_each of the one
  // keyset row), never once per rule; subscribe/PUT search the one keyset row and never walk the set row by row
  const watchedPlan = plan(Q.WATCHED, 2001, 0, "2026-10-12");
  assert.match(watchedPlan, /LIST SUBQUERY \d+/, watchedPlan);
  assert.equal(/CORRELATED/.test(watchedPlan), false, watchedPlan);
  for (const k of ["SUBSCRIBE", "PUT_RULES", "UNKNOWN_KEYS"]) assert.equal(/json_each\((ks|keyset)\.keys\)/.test(Q[k]), false, k);
  assert.match(plan(Q.UNKNOWN_KEYS, '[{"kind":"watch","key":"X24"}]'), /SCAN ks/);
  // sending runs a day: every cron minute of wrangler.jsonc that inWindow() accepts
  const cfg = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const cron = /"crons": \["([^"]+)"\]/.exec(cfg)[1];
  assert.equal(cron, "*/10 23,0-11 * * *");
  let runs = 0;
  for (const h of [23, ...Array.from({ length: 12 }, (_, i) => i)])
    for (let m = 0; m < 60; m += 10) if (inWindow(Date.UTC(2026, 9, h === 23 ? 18 : 19, h, m))) runs++;
  assert.equal(runs, 77);
  const perWeek = runs * SEND_LIMIT * 7;
  assert.equal(perWeek, 21560);
  assert.ok(MAX_SUBS * 2 <= perWeek * 0.8, "≈ 2 pushes per phone a week with ≥ 20% headroom");
  assert.match(cfg, new RegExp(`"MAX_SUBS": "${MAX_SUBS}"`));
  assert.match(cfg, new RegExp(`"NEW_PER_DAY": "${NEW_PER_DAY}"`));
});

test("planted failing expiring rows (the earliest end dates) cannot hold the queue: real phones are sent, planted rows go after 3 failures", T, async () => {
  // 12 planted subscriptions on an allowed host whose endpoint fails (400), all with the earliest end date; one real
  // phone with a later one; SEND_LIMIT 5. Day 1 run 1 and 2: the planted rows' first tries (every new row gets one),
  // run 3: the real phone — the failed rows now wait behind every row that never failed, FAIL_SLOTS at a time.
  const { env, db } = await setup({ SEND_LIMIT: "5" });
  const planted = [];
  for (let i = 0; i < 12; i++) planted.push(await sub(env, [{ kind: "expiring", key: "X24" }], subscription("fcm.googleapis.com", `fcm/send/planted${i}`)));
  const real = await sub(env, [{ kind: "expiring", key: "X01" }], subscription("fcm.googleapis.com", "fcm/send/real"));
  const soon = { ...st("X24", 50000, 3, 60000), e: 50000, s: null, u: "2026-10-20" }, later = { ...st("X01", 50000, 3, 60000), e: 50000, s: null, u: "2026-10-22" };
  await mark(env, "2026-10-19", [soon, later]);
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE pend_x IS NOT NULL")[0].c, 13);
  const push = pushService((u) => (u.includes("planted") ? 400 : 201));
  const r1 = await send(env, kst("2026-10-19T08:00:00"), { fetch: push.f });
  assert.deepEqual([r1.sent, r1.retry], [0, 5], "run 1: five planted rows (nearest end date), all fail");
  const r2 = await send(env, kst("2026-10-19T08:10:00"), { fetch: push.f });
  assert.deepEqual([r2.sent, r2.retry], [0, 5]);
  const r3 = await send(env, kst("2026-10-19T08:20:00"), { fetch: push.f });
  assert.equal(push.calls.some((c) => c.url.endsWith("/real")), true, "run 3: the real phone is sent although 10 planted rows with an earlier end date are waiting");
  assert.deepEqual([r3.sent, r3.retry], [1, 4], "2 planted first tries + the real phone, then 2 of the failed ones");
  assert.equal(db.rows("SELECT exp_sent FROM subs WHERE id = ?", real.id)[0].exp_sent, '["X01||2026-10-22"]');
  // the rest of the day: each failed row gets at most FAIL_SLOTS per run and is removed at NEVER_DROP failures
  for (let m = 8 * 60 + 30; m <= 20 * 60 + 40; m += 10) await send(env, kst("2026-10-19T00:00:00") + m * 60e3, { fetch: push.f });
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 1, "every planted row is gone");
  assert.equal(push.calls.filter((c) => c.url.includes("planted")).length, 12 * NEVER_DROP, `each planted row was tried ${NEVER_DROP} times, not ${RETRY_DROP}`);
  // a run never gives failed rows more than FAIL_SLOTS of its limit
  const { env: e2 } = await setup({ SEND_LIMIT: String(FAIL_SLOTS + 5) });
  for (let i = 0; i < FAIL_SLOTS + 20; i++) await sub(e2, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", `fcm/send/f${i}`));
  await news(e2, "2026-10-19");
  e2.DB.raw.prepare("UPDATE subs SET fails = 1, last_w = '2026-10-01'").run();
  const p2 = pushService();
  const r4 = await send(e2, kst("2026-10-19T09:00:00"), { fetch: p2.f });
  assert.equal(r4.sent, FAIL_SLOTS, "only FAIL_SLOTS rows that failed before, even with room left");
});

test("finish: dates come from the Worker's clock; the factory's today must be a calendar date within a day of it, else 400 and nothing is touched", T, async () => {
  const { env, db } = await setup();
  const a = await sub(env, [{ kind: "watch", key: "X24" }], subscription(), { now: kst("2025-11-01T10:00:00") });   // 352 days ago
  await sub(env, [{ kind: "watch", key: "X24" }], subscription(), { now: kst("2026-10-19T10:00:00") });
  const now = kst("2026-10-19T06:00:00");
  const fin = (run, today, at = now) => internal(env, "POST", "/v1/internal/finish", { run, today }, at);
  const count = () => db.rows("SELECT count(*) c FROM subs")[0].c;
  // a far-future day would pin /health "finished" and wipe past days' budgets: refused, nothing touched
  assert.deepEqual((await fin("2026-10-19|9999-12-31", "9999-12-31")).body, { error: "BAD_FINISH" });
  assert.equal(count(), 2);
  for (const [run, today] of [["2026-10-19|2026-13-45", "2026-13-45"], ["2026-13-45|2026-10-19", "2026-10-19"], ["2026-10-19|2026-10-21", "2026-10-21"],
    ["2026-10-19|2026-10-17", "2026-10-17"], ["2026-10-19|2026-10-18", "2026-10-19"], ["2026-10-19|2026-10-19", 20261019], ["2026-10-19", "2026-10-19"]]) {
    const r = await fin(run, today);
    assert.deepEqual([r.status, r.body], [400, { error: "BAD_FINISH" }], `${run} / ${today}`);
  }
  assert.equal(count(), 2);
  assert.equal((await call(worker, env, "GET", "/health")).body.finished, null, "no finish went through");
  // a day of slack either way (the factory's clock vs ours), the Worker's own day is what gets stored and used
  assert.equal((await fin("2026-10-19|2026-10-20", "2026-10-20")).status, 200);
  assert.equal((await fin("2026-10-19|2026-10-18", "2026-10-18")).status, 200);
  assert.equal((await call(worker, env, "GET", "/health")).body.finished, "2026-10-19", "the Worker's day, not the body's");
  assert.equal(count(), 2);
  // the Worker's own clock a year on: still no subscription is removed (no retention rule), and the day-old budgets go
  assert.equal((await fin("2027-01-11|2027-01-11", "2027-01-11", kst("2027-01-11T06:00:00"))).status, 200);
  assert.equal(db.rows("SELECT id FROM subs").map((x) => x.id).includes(a.id), true, "the 14-month-old row stays: nothing expires");
  assert.equal(count(), 2);
  assert.deepEqual(db.rows("SELECT k FROM stat WHERE k LIKE 'new:%'"), [], "past days' budgets are dropped by the Worker's day");
  // digest: the run must be calendar dates too (its first part becomes the baseline's collection date)
  assert.equal((await internal(env, "POST", "/v1/internal/digest", { run: "2026-02-30|2026-10-19", entries: [] }, now)).body.error, "BAD_DIGEST");
});

test("expiring per (pair, end date): a later end date already announced never hides an earlier new one; several rules", T, async () => {
  const { env, db } = await setup();
  await sub(env, [{ kind: "expiring", key: "X24" }, { kind: "expiring", key: "X01" }, { kind: "expiring", key: "X01", max: 40000 }]);
  const push = pushService();
  const x24 = (u) => ({ ...st("X24", 50000, 3, 60000), e: 50000, s: null, u });
  const x01 = (u, e = 30000) => ({ ...st("X01", 30000, 3, 60000), e, s: null, u });
  await mark(env, "2026-10-18", [st("X24", 50000, 3, 60000), st("X01", 30000, 3, 60000)]);
  // X24 ends 10-25: announced
  assert.equal((await mark(env, "2026-10-22", [x24("2026-10-25")])).expiring, 1);
  await send(env, kst("2026-10-22T09:00:00"), { fetch: push.f });
  assert.equal(push.calls.length, 1);
  assert.deepEqual(JSON.parse(db.rows("SELECT exp_sent FROM subs")[0].exp_sent), ["X24||2026-10-25"]);
  // the next day X01 turns out to end 10-24 — EARLIER than the date already announced: still news (both X01 rules match
  // the same pair and date: one entry)
  assert.equal((await mark(env, "2026-10-23", [x24("2026-10-25"), x01("2026-10-24")])).expiring, 1, "an earlier new end date after a later announced one");
  assert.deepEqual(db.rows("SELECT pend_x, pend_xl FROM subs")[0], { pend_x: "2026-10-24", pend_xl: '["X01||2026-10-24"]' });
  await send(env, kst("2026-10-23T09:00:00"), { fetch: push.f });
  assert.equal(push.calls.length, 2);
  assert.deepEqual(JSON.parse(db.rows("SELECT exp_sent FROM subs")[0].exp_sent), ["X01||2026-10-24", "X24||2026-10-25"]);
  // the same two again: nothing; a third pair/date: the earliest unannounced one becomes pend_x
  assert.equal((await mark(env, "2026-10-24", [x24("2026-10-25"), x01("2026-10-24")])).expiring, 0, "both announced");
  await send(env, kst("2026-10-24T09:00:00"), { fetch: push.f });
  assert.equal(push.calls.length, 2);
  assert.equal((await mark(env, "2026-10-24", [x24("2026-10-27"), x01("2026-10-24")])).expiring, 1, "X24 now ends 10-27 instead: a new (pair, end date)");
  assert.equal(db.rows("SELECT pend_x FROM subs")[0].pend_x, "2026-10-27");
});

test("logs stay counts-only in every error and abuse branch too (429 rate limit/budget, 503 full, 403 origin, 400s, 413, PUT 404, push 404/410/429/3xx, D1 error)", T, async () => {
  const ip = "203.0.113.77", ua = "Mozilla/5.0 (iPhone; TESTUA)";
  const headers = { "cf-connecting-ip": ip, "x-forwarded-for": "198.51.100.9", "user-agent": ua, "cf-ipcountry": "KR", "accept-language": "ko-KR" };
  const W = [{ kind: "watch", key: "X24" }];
  const ids = [], endpoints = [];
  const logs = await spyConsole(async () => {
    // rate limit (binding) and daily budget
    const { env: e1 } = await setup({ SUBS_RL: rateLimiter(1), NEW_PER_DAY: "1" });
    const s1 = subscription("fcm.googleapis.com", "fcm/send/abuse-ep-1");
    endpoints.push(s1.endpoint);
    const first = await call(worker, e1, "POST", "/v1/push/subscribe", { subscription: s1, rules: W }, { headers });
    ids.push(first.body.id);
    assert.equal((await call(worker, e1, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { headers })).status, 429);
    // PUT with no rules deletes the row (and the same id is 404 afterwards); /health with its capacity word
    assert.equal((await call(worker, e1, "PUT", `/v1/push/rules/${first.body.id}`, { rules: [] }, { headers })).status, 200);
    assert.equal((await call(worker, e1, "PUT", `/v1/push/rules/${first.body.id}`, { rules: [] }, { headers })).status, 404);
    assert.equal((await call(worker, e1, "GET", "/health", undefined, { headers })).status, 200);
    const { env: e2 } = await setup({ NEW_PER_DAY: "1" });
    await call(worker, e2, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { headers });
    assert.equal((await call(worker, e2, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { headers })).status, 429);
    // full (nothing is evicted, a day later it is still full)
    const { env: e3 } = await setup({ MAX_SUBS: "1" });
    await call(worker, e3, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { headers, now: kst("2026-10-01T10:00:00") });
    assert.equal((await call(worker, e3, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { headers, now: kst("2026-10-01T10:00:00") })).status, 503);
    assert.equal((await call(worker, e3, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { headers, now: kst("2026-10-19T10:00:00") })).status, 503);
    // origin, bad bodies, size, unknown id, unknown path
    const { env } = await setup();
    assert.equal((await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { headers: { ...headers, origin: "https://evil.example" } })).status, 403);
    assert.equal((await call(worker, env, "POST", "/v1/push/subscribe", undefined, { headers: { ...headers, "content-type": "application/json" }, raw: "{nope" })).body.error, "BAD_JSON");
    assert.equal((await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription("evil.example"), rules: W }, { headers })).body.error, "BAD_SUBSCRIPTION");
    assert.equal((await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: [{ kind: "ad", key: "X24" }] }, { headers })).body.error, "BAD_RULES");
    assert.equal((await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W, pad: "x".repeat(9000) }, { headers })).status, 413);
    assert.equal((await call(worker, env, "PUT", "/v1/push/rules/UNKNOWNID_abcdefghijk", { rules: W }, { headers })).status, 404);
    assert.equal((await call(worker, env, "GET", "/v1/push/nothing/UNKNOWNID_abcdefghijk", undefined, { headers })).status, 404);
    assert.equal((await call(worker, env, "POST", "/v1/internal/finish", { run: "2026-10-19|9999-12-31", today: "9999-12-31" }, { headers: { ...headers, ...AUTH, origin: null } })).status, 400);
    assert.equal((await call(worker, env, "POST", "/v1/internal/digest", { run: "2026-10-19|2026-10-19", entries: [{ k: "X24", r: "", id: "LEAKID" }] }, { headers: { ...headers, ...AUTH, origin: null } })).status, 400);
    // the factory's key set: a malformed one (400 BAD_KEYS), then rules naming a key outside it (400 UNKNOWN_KEY)
    assert.equal((await call(worker, env, "POST", "/v1/internal/keys", { keys: ["X24", "TLEAKKEY"] }, { headers: { ...headers, ...AUTH, origin: null } })).body.error, "BAD_KEYS");
    assert.equal((await call(worker, env, "POST", "/v1/internal/keys", { keys: ["X24"] }, { headers: { ...headers, ...AUTH, origin: null } })).status, 200);
    assert.equal((await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: [{ kind: "watch", key: "TLEAKKEY" }] }, { headers })).body.error, "UNKNOWN_KEY");
    assert.equal((await call(worker, env, "PUT", "/v1/push/rules/UNKNOWNID_abcdefghijkl", { rules: [{ kind: "watch", key: "TLEAKKEY" }] }, { headers })).body.error, "UNKNOWN_KEY");
    // push service answers 404 / 410 / 429 / 302 / network error
    for (const [i, host] of ["fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com", "wns2-par02p.notify.windows.com", "fcm.googleapis.com"].entries()) {
      const s = subscription(host, `push/abuse-ep-${i + 2}`);
      endpoints.push(s.endpoint);
      const r = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: s, rules: W }, { headers });
      ids.push(r.body.id);
    }
    await news(env, "2026-10-19");
    const answers = [404, 410, 429, 302, "throw"];
    await send(env, kst("2026-10-19T09:00:00"), { fetch: pushService((u) => answers[Number(/ep-(\d)/.exec(u)[1]) - 2]).f });
    // D1 throws inside a request whose URL holds a subscription id (PUT) and inside the cron
    const broken = { ...env, DB: { prepare: () => ({ bind() { return this; }, first: async () => { throw new Error("D1_ERROR: storage caused object reset"); }, run: async () => { throw new Error("D1_ERROR"); }, all: async () => { throw new Error("D1_ERROR"); } }), batch: async () => { throw new Error("D1_ERROR: too many requests"); } } };
    assert.equal((await call(worker, broken, "PUT", `/v1/push/rules/${ids[0]}`, { rules: W }, { headers })).status, 500);
    assert.equal((await call(worker, broken, "DELETE", `/v1/push/subscribe/${ids[0]}`, undefined, { headers })).status, 500);
    assert.equal((await call(worker, broken, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: W }, { headers })).status, 500);
    let waited;
    await worker.scheduled({ scheduledTime: kst("2026-10-19T09:00:00") }, broken, { waitUntil: (p) => { waited = p; } });
    await waited;
  });
  assert.match(logs, /alerts error/);
  assert.match(logs, /alerts send failed/);
  assert.match(logs, /"gone":2/);
  for (const v of [ip, "198.51.100.9", "TESTUA", "Mozilla", "ko-KR", "LEAKID", "TLEAKKEY", "UNKNOWNID", "evil.example", "abuse-ep", "fcm.googleapis", "apple.com", "mozilla.com", "windows.com", "/push/", "/fcm/", ...ids, ...endpoints])
    assert.equal(logs.includes(v), false, `console shows ${v}`);
});

// ---- 6.0 round 3: delete-on-empty PUT, no retention/eviction/per-row date, capacity, host trouble, claim order, stale marks

test("PUT with no rules deletes the subscription: 200 {ok:true}, then that id is 404; POST with no rules stays 400; counters follow", T, async () => {
  const { env, db } = await setup();
  const a = await sub(env, [{ kind: "watch", key: "X24" }]);
  const b = await sub(env, [{ kind: "watch", key: "X01" }]);
  assert.equal(db.rows("SELECT n FROM stat WHERE k = 'subs'")[0].n, 2);
  const off = await call(worker, env, "PUT", `/v1/push/rules/${a.id}`, { rules: [] });
  assert.deepEqual([off.status, off.body], [200, { ok: true }]);
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE id = ?", a.id)[0].c, 0, "the row is gone, not emptied");
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 1);
  assert.equal(db.rows("SELECT n FROM stat WHERE k = 'subs'")[0].n, 1, "the subscription counter follows the delete-on-empty path");
  const again = await call(worker, env, "PUT", `/v1/push/rules/${a.id}`, { rules: [] });
  assert.deepEqual([again.status, again.body], [404, { error: "NOT_FOUND" }], "afterwards that id answers 404 (the app subscribes again)");
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${a.id}`, { rules: [{ kind: "watch", key: "X24" }] })).status, 404);
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${"Z".repeat(22)}`, { rules: [] })).status, 404, "unknown id");
  // the other phone is untouched; POST with no rules is still refused
  assert.equal(db.rows("SELECT id FROM subs")[0].id, b.id);
  const post = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: [] });
  assert.deepEqual([post.status, post.body], [400, { error: "BAD_RULES" }]);
  // the same endpoint can subscribe again afterwards (a new row, a new id, counted as new)
  const s = subscription();
  const c1 = await sub(env, [{ kind: "watch", key: "X24" }], s, { now: kst("2026-10-19T10:00:00") });
  await call(worker, env, "PUT", `/v1/push/rules/${c1.id}`, { rules: [] }, { now: kst("2026-10-19T10:01:00") });
  const c2 = await sub(env, [{ kind: "watch", key: "X24" }], s, { now: kst("2026-10-19T10:02:00") });
  assert.notEqual(c1.id, c2.id);
  assert.deepEqual(db.rows("SELECT n FROM stat WHERE k IN ('new:2026-10-19') ").map((x) => x.n), [2], "a delete does not give the day's budget back; the re-created row counts as new");
  assert.equal(db.rows("SELECT n FROM stat WHERE k = 'subs'")[0].n, 2);
  // a row claimed by a running send that is deleted meanwhile: the results are no-ops (nothing throws, nothing comes back)
  const d = await sub(env, [{ kind: "watch", key: "X24" }]);
  await news(env, "2026-10-20");
  db.raw.prepare("UPDATE subs SET claim = 1 WHERE id = ?").run(c2.id);
  await call(worker, env, "PUT", `/v1/push/rules/${c2.id}`, { rules: [] });
  const r = await send(env, kst("2026-10-20T09:00:00"), { fetch: pushService().f });
  assert.equal(r.sent, 1, "only the other phone");
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE id = ?", c2.id)[0].c, 0);
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE id = ? AND last_w = '2026-10-20'", d.id)[0].c, 1);
});

test("data minimisation: no per-row date, no retention, no eviction anywhere in the Worker (columns, SQL, source)", T, async () => {
  const { db } = await setup();
  assert.deepEqual(db.rows("PRAGMA table_info(subs)").map((c) => c.name), ["id", "endpoint", "rules", "pend_w", "last_w", "pend_x", "pend_xl", "exp_sent", "last_x", "fails", "claim"]);
  assert.deepEqual(db.rows("PRAGMA table_info(snap)").map((c) => c.name), ["k", "r", "m", "n", "med", "p", "pm", "pn", "pmed", "bu", "pu", "cb", "cu", "g", "run", "added", "e", "s", "u"]);
  assert.deepEqual(db.rows("SELECT k FROM stat").map((x) => x.k), ["subs"], "an empty database holds the one counter");
  assert.deepEqual(db.rows("PRAGMA table_info(keyset)").map((c) => c.name), ["id", "keys"], "the factory's key set: public treatment keys, one row");
  assert.deepEqual(db.rows("SELECT * FROM keyset"), [], "no key set until the factory sends one");
  assert.deepEqual(db.rows("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'subs' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((x) => x.name), ["subs_claim", "subs_due", "subs_fail", "subs_x"]);
  for (const f of ["../migrations/0001_init.sql", "../src/sql.js", "../src/worker.js", "../src/rules.js"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.equal(/touched_day|EVICT_IDLE|PRUNE_SUBS|subs_idle/.test(src), false, `${f} names a per-row date, eviction or the 365-day cleanup`);
  }
  // the only statements that remove a subscription: the phone's DELETE, a PUT with no rules, the push service's 404/410
  // (GONE = DELETE_SUB) and the consecutive-failure rules — nothing by age, nothing by table size
  const deletes = Object.entries(Q).filter(([, v]) => typeof v === "string" && /DELETE FROM subs/.test(v)).map(([k]) => k).sort();
  assert.deepEqual(deletes, ["DELETE_SUB", "DELETE_SUB_RETURNING", "DROP_FAILING", "DROP_REFUSED", "GONE"]);
  for (const k of deletes) assert.equal(/touched|<\s*\?\d.*(day|today)/i.test(Q[k]), false, k);
  // behaviour: a year of nothing (no subscribe/PUT, no finish) and then a send: nothing was removed by age
  const { env, db: d2 } = await setup();
  const a = await sub(env, [{ kind: "watch", key: "X24" }], subscription(), { now: kst("2025-01-05T10:00:00") });
  await news(env, "2026-10-19");
  const r = await send(env, kst("2026-10-19T09:00:00"), { fetch: pushService().f });
  assert.equal(r.sent, 1, "a 21-month-old subscription that never touched the server again still gets its push");
  assert.equal(d2.rows("SELECT count(*) c FROM subs WHERE id = ?", a.id)[0].c, 1);
});

test("health capacity: ok → nearly_full (≥ 80% of MAX_SUBS) → full (at the cap); words only, no numbers; deletes bring it back; 503 FULL at the cap", T, async () => {
  const { env, db } = await setup({ MAX_SUBS: "10" });
  const cap = async () => (await call(worker, env, "GET", "/health", undefined, { headers: { origin: null } })).body;
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push((await sub(env, [{ kind: "watch", key: "X24" }])).id);
  assert.equal((await cap()).capacity, "ok", "7 of 10");
  ids.push((await sub(env, [{ kind: "watch", key: "X24" }])).id);
  let h = await cap();
  assert.equal(h.capacity, "nearly_full", "8 of 10 = 80%");
  assert.equal(h.ok, true, "still alive: A7's monitor counts 200 {ok:true}");
  for (let i = 0; i < 2; i++) ids.push((await sub(env, [{ kind: "watch", key: "X24" }])).id);
  assert.equal((await cap()).capacity, "full");
  const refused = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: [{ kind: "watch", key: "X24" }] });
  assert.deepEqual([refused.status, refused.body], [503, { error: "FULL" }]);
  h = await cap();
  assert.deepEqual(Object.keys(h).sort(), ["capacity", "finished", "key", "ok", "pairs", "refusing", "sending", "stale", "window"], "exactly these fields");
  assert.match(h.key, /^[A-Za-z0-9_-]{87}$/, "the VAPID public key (public information)");
  assert.equal(JSON.stringify(h).replace(h.key, "").replace(/2026-\d\d-\d\d|08-21/g, "").match(/\d/g), null, "no numbers in the body (counts, limits)");
  await call(worker, env, "PUT", `/v1/push/rules/${ids[0]}`, { rules: [] });          // a delete-on-empty makes a seat
  assert.equal((await cap()).capacity, "nearly_full");
  await call(worker, env, "DELETE", `/v1/push/subscribe/${ids[1]}`);
  await call(worker, env, "DELETE", `/v1/push/subscribe/${ids[2]}`);
  assert.equal((await cap()).capacity, "ok", "7 of 10 again");
  assert.equal(db.rows("SELECT n FROM stat WHERE k = 'subs'")[0].n, 7);
  // MAX_SUBS unset → the default (8,000): a table of a few rows is ok
  assert.equal((await call(worker, { ...env, MAX_SUBS: undefined }, "GET", "/health")).body.capacity, "ok");
  // the word is computed from the counter alone
  const { capacityOf } = await import("../src/rules.js");
  assert.deepEqual([[0, 8000], [6399, 8000], [6400, 8000], [7999, 8000], [8000, 8000], [9000, 8000], [null, 8000]].map(([n, m]) => capacityOf(n, m)),
    ["ok", "ok", "nearly_full", "nearly_full", "full", "full", "ok"]);
});

test("health stale: no factory finish for more than 2 KST days → stale:true (the monitor warns); a fresh or missing finish → false", T, async () => {
  const { env } = await setup();
  const stale = async (now) => (await call(worker, env, "GET", "/health", undefined, { headers: { origin: null }, now })).body.stale;
  assert.equal(await stale(kst("2026-10-30T10:00:00")), false, "no finish yet and no subscription: nothing to be late");
  // no finish EVER but phones subscribed: the factory → Worker link never worked (ALERTS_URL/ALERTS_SECRET/ALERTS_CODE_SHA
  // missing, notify.mjs skipping quietly) — stale once the first subscription is more than 2 KST days old, never on day one
  const { env: e2, db: d2 } = await setup();
  const stale2 = async (now) => (await call(worker, e2, "GET", "/health", undefined, { headers: { origin: null }, now })).body.stale;
  const first = await sub(e2, [{ kind: "watch", key: "X24" }], subscription(), { now: kst("2026-10-19T22:00:00") });
  await sub(e2, [{ kind: "watch", key: "X01" }], subscription(), { now: kst("2026-10-21T10:00:00") });
  assert.equal(await stale2(kst("2026-10-19T23:00:00")), false, "the evening a phone subscribes, before any 06:00 factory run");
  assert.equal(await stale2(kst("2026-10-20T09:30:00")), false, "the next morning's monitor");
  assert.equal(await stale2(kst("2026-10-21T23:59:00")), false, "two days");
  assert.equal(await stale2(kst("2026-10-22T00:01:00")), true, "three KST days after the first subscription and still no finish");
  assert.deepEqual(d2.rows("SELECT k FROM stat WHERE k LIKE 'new:%' ORDER BY k").map((r) => r.k), ["new:2026-10-19", "new:2026-10-21"]);
  await call(worker, e2, "DELETE", `/v1/push/subscribe/${first.id}`);
  assert.equal(await stale2(kst("2026-10-22T00:01:00")), true, "the earliest day counts even when that phone left (the link is what is late)");
  assert.equal(await finishDay(e2, "2026-10-22"), 200);
  assert.equal(await stale2(kst("2026-10-22T09:30:00")), false, "the first finish clears it (and prunes past days' counters)");
  d2.raw.prepare("DELETE FROM subs").run();
  d2.raw.prepare("DELETE FROM stat WHERE k = 'finish'").run();
  assert.equal(await stale2(kst("2026-11-30T09:30:00")), false, "no finish and no subscription left: nothing to be late");
  await mark(env, "2026-10-19", []);
  assert.equal(await stale(kst("2026-10-19T12:00:00")), false);
  assert.equal(await stale(kst("2026-10-21T23:59:00")), false, "two days");
  assert.equal(await stale(kst("2026-10-22T00:01:00")), true, "three KST days");
  await mark(env, "2026-10-22", []);
  assert.equal(await stale(kst("2026-10-22T12:00:00")), false, "a new finish clears it");
});

test("push-service trouble (5xx, redirect, timeout) deletes nobody: counted against a row only when that origin took another push 2xx in the run", T, async () => {
  const { env, db } = await setup();
  const real = await sub(env, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/real"));
  const fresh = await sub(env, [{ kind: "watch", key: "X24" }], subscription("web.push.apple.com", "fresh"));
  await news(env, "2026-10-19");
  db.raw.prepare("UPDATE subs SET last_w = '2026-10-01' WHERE id = ?").run(real.id);
  // Apple took a push of ours before — under ANOTHER key (an 'ok:' row of any key says a push service is there), so the
  // never-pushed row there is protected during an outage too
  okSince(db, "OTHERKEYTAG0" + "x".repeat(75), "https://web.push.apple.com", "2026-09-01");
  // an incident longer than every drop limit: 503, 302 and a timeout, try after try, to the only origin each row has. A row
  // whose service gave nothing 2xx is held back HOLD_MINUTES and then comes back as a probe: four tries a day (08:00, 11:00,
  // 14:00, 17:00), and a run in between does not touch it
  const kinds = [503, 302, "throw"];
  const slot = (i) => kst(`${addDays("2026-10-19", Math.floor(i / 4))}T08:00:00`) + (i % 4) * HOLD_MINUTES * 60e3;
  let held = 0;
  for (let i = 0; i < RETRY_DROP + 5; i++) {
    const p = pushService(() => kinds[i % 3]);
    const r = await send(env, slot(i), { fetch: p.f });
    held += r.held;
    assert.deepEqual([r.sent, r.retry, r.gone, p.calls.length], [0, 0, 0, 2]);
    const between = pushService(() => kinds[i % 3]);
    assert.deepEqual([(await send(env, slot(i) + 10 * 60e3, { fetch: between.f })).held, between.calls.length], [0, 0], "held rows wait");
  }
  assert.equal(held, 2 * (RETRY_DROP + 5), "every try of both rows was held back, not counted");
  assert.deepEqual(db.rows("SELECT id, fails, pend_w, claim < 0 AS held FROM subs ORDER BY id").sort((a, b) => a.id.localeCompare(b.id)),
    [{ id: real.id, fails: 0, pend_w: 1, held: 1 }, { id: fresh.id, fails: 0, pend_w: 1, held: 1 }].sort((a, b) => a.id.localeCompare(b.id)), "both rows survive, fails untouched (a never-pushed row too)");
  // the service is back: both are sent at the first run after the hold
  const ok = await send(env, slot(RETRY_DROP + 5), { fetch: pushService().f });
  assert.equal(ok.sent, 2);

  // the same origin took another push 2xx in that run → the failure is the row's and counts (RETRY_DROP / NEVER_DROP)
  const { env: e2, db: d2 } = await setup();
  okSince(d2, "OTHERKEYTAG0" + "x".repeat(75), "https://web.push.apple.com", "2026-09-01");
  const good = await sub(e2, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/good"));
  const bad = await sub(e2, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/bad"));
  const other = await sub(e2, [{ kind: "watch", key: "X24" }], subscription("web.push.apple.com", "other-origin"));
  await news(e2, "2026-10-19");
  const answer = (u) => (u.endsWith("/bad") ? 503 : u.endsWith("other-origin") ? 503 : 201);
  const arm = () => d2.raw.prepare("UPDATE subs SET pend_w = 1, last_w = NULL, fails = fails WHERE id = ?").run(good.id);
  const r1 = await send(e2, kst("2026-10-19T09:00:00"), { fetch: pushService(answer).f });
  assert.deepEqual([r1.sent, r1.retry, r1.held], [1, 1, 1], "fcm: one 2xx → its 503 counts; apple: nothing took a push → released");
  assert.deepEqual(d2.rows("SELECT id, fails FROM subs WHERE id IN (?, ?)", bad.id, other.id).sort((a, b) => a.id.localeCompare(b.id)),
    [{ id: bad.id, fails: 1 }, { id: other.id, fails: 0 }].sort((a, b) => a.id.localeCompare(b.id)));
  for (let i = 1; i < NEVER_DROP; i++) { arm(); await send(e2, kst("2026-10-19T09:00:00") + i * 20 * 60e3, { fetch: pushService(answer).f }); }
  assert.equal(d2.rows("SELECT count(*) c FROM subs WHERE id = ?", bad.id)[0].c, 0, `the never-pushed row whose service was up is removed after ${NEVER_DROP} counted failures`);
  assert.equal(d2.rows("SELECT fails FROM subs WHERE id = ?", other.id)[0].fails, 0, "the other origin's row was never counted");

  // 4th review: a row that never received a push, at a push origin that never answered 2xx to any push of ours (no 'ok:' for
  // any key — e.g. a made-up host that cannot answer): nothing says a push service is there, so its trouble counts and the
  // row goes after NEVER_DROP tries. A phone that took our pushes is never counted for an outage, 'ok:' or not
  const { env: e3, db: d3 } = await setup();
  const planted = await sub(e3, [{ kind: "watch", key: "X24" }], subscription("wns2-zz9.notify.windows.com", "w/?token=planted"));
  const reached = await sub(e3, [{ kind: "watch", key: "X24" }], subscription("wns2-zz8.notify.windows.com", "w/?token=reached"));
  await news(e3, "2026-10-19");
  d3.raw.prepare("UPDATE subs SET last_w = '2026-10-01' WHERE id = ?").run(reached.id);
  for (let i = 0; i < NEVER_DROP; i++) {
    const r = await send(e3, kst("2026-10-19T08:00:00") + i * HOLD_MINUTES * 60e3, { fetch: pushService(() => kinds[i % 3]).f });
    assert.deepEqual([r.retry, r.held], [1, 1], `try ${i + 1}: the never-pushed row is counted, the reached phone held`);
  }
  assert.deepEqual(d3.rows("SELECT id, fails FROM subs"), [{ id: reached.id, fails: 0 }], `the planted row is gone after ${NEVER_DROP} tries`);
  assert.equal(planted.id.length, 22);
});

test("CLAIM_F: a real phone that took pushes before and has failed once comes before never-pushed rows with the same failures", T, async () => {
  const { db } = await setup();
  const ins = db.raw.prepare("INSERT INTO subs (id, endpoint, rules, pend_w, last_w, last_x, fails) VALUES (?, ?, '[]', 1, ?, ?, ?)");
  for (let i = 0; i < 30; i++) ins.run(`never${i}`.padEnd(22, "x"), `https://fcm.googleapis.com/n${i}`, null, null, 1 + (i % 2));
  ins.run("realA".padEnd(22, "x"), "https://fcm.googleapis.com/rA", "2026-09-01", null, 1);
  ins.run("realB".padEnd(22, "x"), "https://fcm.googleapis.com/rB", null, "2026-09-02", 2);
  ins.run("realC".padEnd(22, "x"), "https://fcm.googleapis.com/rC", "2026-08-01", null, 1);
  const rows = db.rows(Q.CLAIM_F, 1, "2026-10-12", "2026-10-19", 40, 3);
  const got = new Set(rows.map((r) => r.id.replace(/x+$/, "")));
  assert.deepEqual([...got].sort(), ["realA", "realB", "realC"], "with 3 slots the three real phones win over 30 never-pushed rows (fails 1 and 2)");
});

test("sustained planting at the daily budget: real phones with one failure are still tried every day, planted rows leave quickly", T, async () => {
  // Three days; every day 1,000 never-pushed rows are planted (half answer 403 — a key mismatch FCM never heals — half 400),
  // 20 real phones (they took pushes before) start the day with one failure and news waiting. The real phones must be sent
  // in the day's first runs whatever the planted queue looks like, and the planted rows must not pile up.
  const { env, db } = await setup();
  const insP = db.raw.prepare("INSERT INTO subs (id, endpoint, rules, pend_w) VALUES (?, ?, '[{\"kind\":\"watch\",\"key\":\"X24\"}]', 1)");
  const insR = db.raw.prepare("INSERT INTO subs (id, endpoint, rules, pend_w, last_w, fails) VALUES (?, ?, '[{\"kind\":\"watch\",\"key\":\"X24\"}]', 1, '2026-09-01', 1)");
  let planted = 0, peak = 0;
  const push = pushService((u) => (u.includes("/real") ? 201 : u.includes("/plant403") ? 403 : 400));
  for (const day of ["2026-10-19", "2026-10-20", "2026-10-21"]) {
    for (let i = 0; i < 1000; i++, planted++) insP.run(`p${planted}`.padEnd(22, "x"), `https://fcm.googleapis.com/${i % 2 ? "plant403" : "plant400"}/${planted}`);
    for (let i = 0; i < 20; i++) insR.run(`r${day}-${i}`.padEnd(22, "y"), `https://fcm.googleapis.com/real/${day}/${i}`);
    const firstRun = kst(`${day}T08:00:00`);
    const triedAt = new Map();                                            // real phone → first run index that pushed to it
    let sentReal = 0;
    for (let run = 0, m = 8 * 60; m <= 20 * 60 + 40; m += 10, run++) {
      const before = push.calls.length;
      await send(env, kst(`${day}T00:00:00`) + m * 60e3, { fetch: push.f });
      for (const c of push.calls.slice(before)) if (c.url.includes(`/real/${day}/`) && !triedAt.has(c.url)) { triedAt.set(c.url, run); sentReal++; }
    }
    assert.equal(sentReal, 20, `${day}: all 20 real phones were pushed`);
    // the cost that cannot be removed without logins: every NEW row gets one first try ahead of rows that failed before, so
    // 1,000 planted rows (25 runs of 40) delay them by that much — the same day, never "from tomorrow"
    assert.ok(Math.max(...triedAt.values()) <= 30, `${day}: the real phones were pushed after the planted first tries (runs ${[...triedAt.values()].join(",")})`);
    assert.equal(db.rows("SELECT count(*) c FROM subs WHERE id LIKE 'r2026%' AND pend_w = 1")[0].c, 0, `${day}: no real phone is still waiting`);
    peak = Math.max(peak, db.rows("SELECT count(*) c FROM subs WHERE id LIKE 'p%'")[0].c);
    assert.equal(firstRun > 0, true);
  }
  // the planted rows: every 403 one cost exactly one try, the 400 ones NEVER_DROP; the table does not fill up with them
  const tries403 = push.calls.filter((c) => c.url.includes("/plant403/")).length;
  assert.ok(tries403 <= 1500, `403 rows: one try each (${tries403} tries for 1,500 rows)`);
  const left = db.rows("SELECT count(*) c FROM subs WHERE id LIKE 'p%'")[0].c;
  assert.ok(left < 3000, `planted rows do not accumulate unboundedly (${left} of 3,000 left, peak ${peak})`);
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE id LIKE 'p%' AND endpoint LIKE '%plant403%'")[0].c, 0, "every refusing planted row is gone");
});

test("a phone's pending expiring mark is cleared when the next finish finds nothing ending for it (extended event) — no stale 'ending soon' push", T, async () => {
  const { env, db, k } = await setup();
  okSince(db, k.pub, "https://fcm.googleapis.com", "2026-10-01");     // a push service that took our pushes before, down for a day
  const a = await sub(env, [{ kind: "expiring", key: "X24" }]);
  const b = await sub(env, [{ kind: "expiring", key: "X01" }]);
  const ending = (k, u) => ({ ...st(k, 75000, 5, 90000), e: 75000, s: null, u });
  const calm = (k) => st(k, 75000, 5, 90000);
  await mark(env, "2026-10-19", [ending("X24", "2026-10-21"), ending("X01", "2026-10-22")]);
  assert.deepEqual(db.rows("SELECT id, pend_x FROM subs ORDER BY pend_x"), [{ id: a.id, pend_x: "2026-10-21" }, { id: b.id, pend_x: "2026-10-22" }]);
  // every send of the day fails (the push service is down all day): the marks stay
  const down = pushService(() => 503);
  for (let i = 0; i < 3; i++) await send(env, kst("2026-10-19T09:00:00") + i * 600e3, { fetch: down.f });
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE pend_x IS NOT NULL")[0].c, 2);
  // the next day the clinic extended X24's event (no price ends any more); X01 still ends
  await mark(env, "2026-10-20", [calm("X24"), ending("X01", "2026-10-22")]);
  assert.deepEqual(db.rows("SELECT id, pend_x, pend_xl FROM subs ORDER BY id").sort((p, q) => p.id.localeCompare(q.id)),
    [{ id: a.id, pend_x: null, pend_xl: null }, { id: b.id, pend_x: "2026-10-22", pend_xl: '["X01||2026-10-22"]' }].sort((p, q) => p.id.localeCompare(q.id)), "X24's mark is gone, X01's stays");
  const push = pushService();
  const r = await send(env, kst("2026-10-20T09:00:00"), { fetch: push.f });
  assert.equal(r.sent, 1, "only the phone whose price still ends");
  assert.equal(push.calls.length, 1);
  assert.equal(db.rows("SELECT exp_sent FROM subs WHERE id = ?", a.id)[0].exp_sent, null, "nothing was announced for the extended event");
  // the pair itself leaving the data (not in this run's digest) also clears it
  db.raw.prepare("UPDATE subs SET pend_x = '2026-10-23', pend_xl = '[\"X01||2026-10-23\"]', last_x = NULL WHERE id = ?").run(b.id);
  await mark(env, "2026-10-21", [calm("X24"), calm("X01")]);
  assert.equal(db.rows("SELECT pend_x FROM subs WHERE id = ?", b.id)[0].pend_x, null);
});

// ---- 6.0 round 4 (review findings 5/13/14, 7, 8, 9, 15): stale with no finish ever (above), expiring once a day, a broken
// VAPID setup over many runs, exceptions inside a run, the public key derived from the secret

test("expiring: at most ONE push with an expiring notice a day — one that rode along with the weekly bundle counts too", T, async () => {
  const { env, db } = await setup();
  await sub(env, [{ kind: "expiring", key: "X24", max: 80000 }, { kind: "watch", key: "X01" }]);
  const push = pushService();
  const ending = (u) => ({ ...st("X24", 75000, 5, 90000), e: 75000, s: 90000, u });
  await mark(env, "2026-10-18", [st("X01", 50000, 4, 60000), st("X24", 75000, 5, 90000)]);
  // 06:00: weekly news (X01's median 10% down) and an ending price → one push at 08:00 carries both
  await mark(env, "2026-10-19", [ending("2026-10-21"), st("X01", 50000, 4, 54000)]);
  assert.equal((await send(env, kst("2026-10-19T08:00:00"), { fetch: push.f })).sent, 1);
  assert.deepEqual(db.rows("SELECT last_w, last_x, pend_w, pend_x FROM subs")[0], { last_w: "2026-10-19", last_x: "2026-10-19", pend_w: 0, pend_x: null },
    "the weekly push carried the expiring notice: last_x is today as well");
  // a second finish later the same day (a manual rerun) finds another end date: it waits for tomorrow
  await mark(env, "2026-10-19", [ending("2026-10-22")]);
  assert.equal(db.rows("SELECT pend_x FROM subs")[0].pend_x, "2026-10-22");
  for (const t of ["11:00", "15:00", "20:40"]) await send(env, kst(`2026-10-19T${t}:00`), { fetch: push.f });
  assert.equal(push.calls.length, 1, "no stand-alone expiring push on the day the weekly bundle carried one");
  await send(env, kst("2026-10-20T08:00:00"), { fetch: push.f });
  assert.equal(push.calls.length, 2, "the next day it goes, once");
  assert.deepEqual(db.rows("SELECT last_w, last_x, pend_x FROM subs")[0], { last_w: "2026-10-19", last_x: "2026-10-20", pend_x: null });
  // and the claim queries still pick exactly what dueKinds() calls due for such rows
  const row = { pend_w: 0, last_w: "2026-10-19", pend_x: "2026-10-22", last_x: "2026-10-19" };
  assert.deepEqual(dueKinds(row, "2026-10-19"), { weekly: false, expiring: false });
  assert.deepEqual(dueKinds(row, "2026-10-20"), { weekly: false, expiring: true });
});

test("a push service refusing our VAPID token for days: kept for REFUSING_GRACE_DAYS (every run tries, nobody removed, /health refusing:true, other services unaffected), then counted as usual", T, async () => {
  const { env, db, k } = await setup();
  const W = [{ kind: "watch", key: "X24" }];
  // Apple refuses everything (our token is broken there); FCM works. 8 Apple phones took our pushes before, 2 never did.
  const pushed = [], never = [], fcm = [];
  for (let i = 0; i < 2; i++) never.push(await sub(env, W, subscription("web.push.apple.com", `never/${i}`)));
  for (let i = 0; i < 8; i++) pushed.push(await sub(env, W, subscription("web.push.apple.com", `took/${i}`)));
  for (let i = 0; i < 5; i++) fcm.push(await sub(env, W, subscription("fcm.googleapis.com", `fcm/send/ok${i}`)));
  await news(env, "2026-10-19");
  const took = [...pushed, ...fcm].map((x) => x.id);
  db.raw.prepare(`UPDATE subs SET last_w = '2026-10-01' WHERE id IN (${took.map(() => "?").join(",")})`).run(...took);
  const push = pushService((u) => (u.includes("apple") ? 403 : 201));
  const health = async (iso) => (await call(worker, env, "GET", "/health", undefined, { headers: { origin: null }, now: kst(iso) })).body;
  assert.equal((await health("2026-10-19T07:00:00")).refusing, false);
  // every run of two days; a spared phone is held back HOLD_MINUTES between its tries (never at the front of every run)
  let runs = 0, applePerRun = 0;
  const lastTry = new Map(), tries = new Map();
  for (const day of ["2026-10-19", "2026-10-20"]) {
    for (let m = 8 * 60; m <= 20 * 60 + 40; m += 10, runs++) {
      const t = kst(`${day}T00:00:00`) + m * 60e3, before = push.calls.length;
      const r = await send(env, t, { fetch: push.f });
      const apple = push.calls.slice(before).filter((c) => c.url.includes("apple"));
      applePerRun = Math.max(applePerRun, apple.length);
      for (const c of apple.filter((x) => x.url.includes("/took/"))) {
        if (lastTry.has(c.url)) assert.ok(t - lastTry.get(c.url) >= HOLD_MINUTES * 60e3, "a spared phone waits HOLD_MINUTES before its next try");
        lastTry.set(c.url, t);
        tries.set(c.url, (tries.get(c.url) || 0) + 1);
      }
      if (apple.some((x) => x.url.includes("/took/"))) assert.equal(r.refusing, 1, `${day} run ${runs}: Apple is suspect`);
      assert.equal(r.gone, 0);
    }
    assert.equal(db.rows("SELECT count(*) c FROM subs WHERE claim > 0")[0].c, 0, "no row is left claimed by a run");
    if (day === "2026-10-19") assert.equal((await health("2026-10-20T07:00:00")).refusing, true, "the next morning (before any run) the monitor still sees it");
  }
  assert.equal(runs, 154);
  assert.ok(applePerRun <= 10, `each claimed Apple row is tried once a run (${applePerRun})`);
  assert.equal(tries.size, 8);
  for (const [u, n] of tries) assert.ok(n >= 8 && n <= 10, `${u}: tried every HOLD_MINUTES through both days (${n} tries)`);
  // nobody was removed; the phones that took pushes before were never counted
  const left = new Map(db.rows("SELECT id, fails, pend_w FROM subs").map((r) => [r.id, r]));
  assert.equal(left.size, 15, "all 15 rows are still there after two days of refusals");
  for (const p of pushed) assert.deepEqual([left.get(p.id).fails, left.get(p.id).pend_w], [0, 1], "released unchanged: fails 0, news waiting");
  for (const n of never) assert.ok(left.get(n.id).fails >= 1, "a never-pushed row gets failures but is not removed at a suspect service");
  // FCM was not stopped by Apple's refusals: all five got their push in the first run, once
  assert.equal(push.calls.filter((c) => c.url.includes("fcm")).length, 5);
  for (const x of fcm) assert.equal(left.get(x.id).pend_w, 0);
  const h = await health("2026-10-20T21:00:00");
  assert.deepEqual([h.ok, h.refusing, h.sending], [true, true, true]);
  const rs = `rs:${k.pub.slice(0, 12)} https://web.push.apple.com`;
  assert.deepEqual(db.rows("SELECT n FROM stat WHERE k = ?", rs), [{ n: 20261019 }], "the stretch started on the first refusing day");
  // still refusing one run a day: kept until REFUSING_GRACE_DAYS after the first day, then counted as usual (3 in a row
  // removes a phone that took pushes before; a never-pushed one goes at its first counted refusal)
  for (let d = 2; d < REFUSING_GRACE_DAYS; d++) await send(env, kst(`${addDays("2026-10-19", d)}T09:00:00`), { fetch: push.f });
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE endpoint LIKE '%apple%'")[0].c, 10, `day ${REFUSING_GRACE_DAYS - 1} of the stretch: all 10 Apple rows still there`);
  // the held phones come back PROBES a run; once counted (fails > 0) they are tried in the FAIL_SLOTS of every run
  const over = addDays("2026-10-19", REFUSING_GRACE_DAYS);
  const bound = REFUSED_DROP - 1 + Math.ceil(pushed.length / PROBES);
  for (let i = 0; i < bound; i++) await send(env, kst(`${over}T09:00:00`) + i * 10 * 60e3, { fetch: push.f });
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE endpoint LIKE '%apple%'")[0].c, 0, `after the grace days the refusing subscriptions are removed within ${bound} runs (the policy: delivery keeps failing → deleted)`);
  assert.equal((await health(`${over}T21:00:00`)).refusing, true, "and the monitor still says so");
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 5, "the FCM phones are untouched");

  // Apple works again within the stretch: everyone waiting is sent and the stretch ends
  const { env: e2, db: d2, k: k2 } = await setup();
  for (let i = 0; i < 3; i++) await sub(e2, W, subscription("web.push.apple.com", `back/${i}`));
  await news(e2, "2026-10-19");
  d2.raw.prepare("UPDATE subs SET last_w = '2026-10-01'").run();
  const r1 = await send(e2, kst("2026-10-19T09:00:00"), { fetch: pushService(() => 403).f });
  assert.deepEqual([r1.refused, r1.spared, r1.refusing], [3, 3, 1], "one phone is enough to be careful (never a count per run)");
  // the probes go through: the stretch ends and the other held phone is freed in the same batch, sent by the next run
  const fixed = pushService();
  assert.equal((await send(e2, kst("2026-10-21T09:00:00"), { fetch: fixed.f })).sent, PROBES);
  assert.deepEqual(d2.rows("SELECT count(*) c FROM subs WHERE claim IS NOT NULL"), [{ c: 0 }], "nothing is held any more (RELEASE_HELD with the 2xx)");
  assert.equal((await send(e2, kst("2026-10-21T09:10:00"), { fetch: fixed.f })).sent, 3 - PROBES);
  assert.equal(fixed.calls.length, 3);
  assert.deepEqual(d2.rows("SELECT k FROM stat WHERE k LIKE 'rs:%' OR k LIKE 'rl:%'"), [], "a 2xx from Apple ends the stretch");
  assert.deepEqual(d2.rows("SELECT k, n FROM stat WHERE k LIKE 'ok:%'"), [{ k: `ok:${k2.pub.slice(0, 12)} https://web.push.apple.com`, n: 20261021 }], "and records the first day this key went through Apple");
  assert.equal((await call(worker, e2, "GET", "/health", undefined, { now: kst("2026-10-23T09:30:00") })).body.refusing, false, "two days after the last refusing run");
});

test("review findings (key change): after a VAPID key change the phones that subscribed again get their pushes, and the old subscriptions that never did are removed — a push service that checks the key, API calls only", T, async () => {
  const db = makeDb();
  const k1 = await vapidKeys(), k2 = await vapidKeys();
  const env1 = makeEnv(db, { VAPID_PRIVATE_JWK: k1.jwk }), env2 = makeEnv(db, { VAPID_PRIVATE_JWK: k2.jwk });
  // FCM's behaviour: a subscription made with one applicationServerKey refuses a push signed with another (403)
  const madeWith = new Map();
  const fcm = pushService((url, n) => (madeWith.get(url) === /k=([^,]+)$/.exec(fcm.calls[n - 1].init.headers.authorization)[1] ? 201 : 403));
  const subWith = async (env, key, path, rules) => { const s = subscription("fcm.googleapis.com", path); madeWith.set(s.endpoint, key.pub); return { ...(await sub(env, rules, s)), endpoint: s.endpoint }; };
  const W = [{ kind: "watch", key: "X24" }];
  const sleeping = [], active = [];
  for (let i = 0; i < 8; i++) sleeping.push(await subWith(env1, k1, `fcm/send/sleep${i}`, W));
  for (let i = 0; i < 20; i++) active.push(await subWith(env1, k1, `fcm/send/active${i}`, W));
  const day = async (env, d) => { for (let m = 8 * 60; m <= 9 * 60; m += 10) await send(env, kst(`${d}T00:00:00`) + m * 60e3, { fetch: fcm.f }); };
  await news(env1, "2026-11-02");
  await day(env1, "2026-11-02");
  assert.equal(new Set(fcm.calls.map((c) => c.url)).size, 28, "11-02: all 28 phones got the K1 push");
  // 11-03: the key is changed (INCIDENT_RESPONSE_PLAN §2 VAPID ①); the 20 active phones subscribe again with the new key
  // (the app: a different key → subscribe again, DELETE the old id), the 8 sleeping phones never open the app
  const again = [];
  for (const [i, a] of active.entries()) {
    assert.equal((await call(worker, env2, "DELETE", `/v1/push/subscribe/${a.id}`)).status, 204);
    again.push(await subWith(env2, k2, `fcm/send/again${i}`, W));
  }
  await news(env2, "2026-11-04");
  const before = fcm.calls.length;
  await day(env2, "2026-11-04");
  assert.equal(fcm.calls.slice(before).filter((c) => c.url.includes("/again")).length, 20, "11-04: the 20 phones that subscribed again got their K2 push");
  assert.equal(db.rows("SELECT count(*) c FROM stat WHERE k LIKE ? OR k LIKE ?", `rs:${k1.pub.slice(0, 12)} %`, `rl:${k1.pub.slice(0, 12)} %`)[0].c, 0, "the old key's refusal stretches are gone");
  assert.equal(db.rows("SELECT count(*) c FROM stat WHERE k LIKE ?", `ok:${k1.pub.slice(0, 12)} %`)[0].c, 1, "its first-2xx day stays (one small row; never read under K2)");
  // every day from here on brings news; the sleeping K1 rows are due again from 11-09 (7 days after their last push)
  for (const d of ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]) {
    await news(env2, d);
    const n = fcm.calls.length;
    await day(env2, d);
    if (d === "2026-11-11") assert.equal(fcm.calls.slice(n).filter((c) => c.url.includes("/again")).length, 20, "11-11: the weekly push reaches the 20 phones again — the old rows do not hold FCM up");
  }
  const left = new Set(db.rows("SELECT endpoint FROM subs").map((r) => r.endpoint));
  assert.equal(sleeping.filter((s) => left.has(s.endpoint)).length, 0, "the 8 old K1 subscriptions are removed (last reached before K2 first went through FCM)");
  assert.equal(again.filter((s) => left.has(s.endpoint)).length, 20);
  assert.equal(fcm.calls.filter((c) => c.url.includes("/sleep")).length, 8 + 8 * REFUSED_DROP, "each old row: its K1 push, then REFUSED_DROP refusals");
  assert.equal((await call(worker, env2, "GET", "/health", undefined, { now: kst("2026-11-12T09:30:00") })).body.refusing, false, "never suspect: no Telegram line for the old rows");
});

test("a private JWK whose d is not the key's own (x, y match VAPID_PUBLIC_KEY), or that is not a P-256 private key: skipped 'keys' before anything is claimed", T, async () => {
  const { env, db, k } = await setup();
  const other = await vapidKeys();
  for (let i = 0; i < 3; i++) await sub(env, [{ kind: "watch", key: "X24" }]);
  await news(env, "2026-10-19");
  const good = JSON.parse(k.jwk), otherD = JSON.parse(other.jwk).d;
  const bad = [
    JSON.stringify({ ...good, d: otherD }),                     // x, y = VAPID_PUBLIC_KEY, d from another key
    JSON.stringify({ ...good, d: good.d.slice(0, 20) }),        // a cut d
    JSON.stringify({ ...good, d: "A".repeat(43) }),             // d = 0
    JSON.stringify({ ...good, crv: "P-384" }),
    JSON.stringify({ kty: "EC", crv: "P-256", x: good.x, y: good.y }),   // the PUBLIC key only
    "{not json " + good.d,                                      // a broken paste (its text must never reach the logs)
  ];
  const push = pushService();
  const logs = await spyConsole(async () => {
    for (const jwk of bad) {
      for (const pubVar of [k.pub, ""]) {
        const e = { ...env, VAPID_PRIVATE_JWK: jwk, VAPID_PUBLIC_KEY: pubVar };
        assert.equal((await send(e, kst("2026-10-19T09:00:00"), { fetch: push.f })).skipped, "keys", jwk.slice(0, 40));
        const h = (await call(worker, e, "GET", "/health")).body;
        assert.deepEqual([h.ok, h.sending, h.key], [true, false, null]);
      }
    }
  });
  assert.equal(push.calls.length, 0, "no push");
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE claim IS NOT NULL")[0].c, 0, "nothing claimed, nothing locked");
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE pend_w = 1 AND fails = 0")[0].c, 3, "the news waits, nobody counted");
  assert.equal(logs.includes(good.d) || logs.includes(otherD) || logs.includes(good.d.slice(0, 20)), false, "the private key never reaches the logs");
  assert.match(logs, /cannot|not a P-256 private key/);
  // a runtime that imports such a pair without complaint (signs with d, the signature does not verify with x, y): the
  // test signature is verified, so it is caught as well
  const realVerify = globalThis.crypto.subtle.verify;
  globalThis.crypto.subtle.verify = async () => false;
  try { assert.equal((await send(env, kst("2026-10-19T09:00:00"), { fetch: push.f })).skipped, "keys"); }
  finally { globalThis.crypto.subtle.verify = realVerify; }
  assert.equal(push.calls.length, 0);
  // the good key sends at once
  assert.equal((await send(env, kst("2026-10-19T09:10:00"), { fetch: push.f })).sent, 3);
});

test("an exception inside a run never loses a SENT record: signing fails for one push service mid-run, a D1 statement throws after the pushes", T, async () => {
  const { env, db, k } = await setup();
  const W = [{ kind: "watch", key: "X24" }];
  const apple = [], fcm = [];
  for (let i = 0; i < 4; i++) apple.push(await sub(env, W, subscription("web.push.apple.com", `a/${i}`)));
  for (let i = 0; i < 4; i++) fcm.push(await sub(env, W, subscription("fcm.googleapis.com", `fcm/send/f${i}`)));
  await news(env, "2026-10-19");
  // FCM's token is cached in D1 (an earlier run); Apple needs a new signature — and every signature after the key check fails
  const now = kst("2026-10-19T09:00:00");
  const t = await vapidJwt("https://fcm.googleapis.com", k.jwk, APP, now);
  db.raw.prepare(Q.SAVE_JWT).run(`${k.pub.slice(0, 12)} https://fcm.googleapis.com`, t.jwt, t.exp);
  const realSign = globalThis.crypto.subtle.sign;
  let signs = 0;
  globalThis.crypto.subtle.sign = async (...a) => { if (++signs > 1) throw new Error("sign failed"); return realSign.apply(globalThis.crypto.subtle, a); };
  const push = pushService();
  let r;
  const logs = await spyConsole(async () => {
    try { r = await send(env, now, { fetch: push.f }); } finally { globalThis.crypto.subtle.sign = realSign; }
  });
  assert.deepEqual([r.sent, r.stopped, r.errors], [4, 4, 4], JSON.stringify(r));
  assert.equal(push.calls.length, 4);
  assert.ok(push.calls.every((c) => c.url.includes("fcm")));
  assert.equal(logs.includes("sign failed"), false, "the error itself is not logged");
  const rows = new Map(db.rows("SELECT id, pend_w, last_w, fails, claim FROM subs").map((x) => [x.id, x]));
  for (const x of fcm) assert.deepEqual([rows.get(x.id).pend_w, rows.get(x.id).last_w], [0, "2026-10-19"], "the pushes that went out are recorded");
  for (const x of apple) assert.deepEqual([rows.get(x.id).pend_w, rows.get(x.id).fails, rows.get(x.id).claim], [1, 0, null], "released unchanged");
  // 20 minutes later: only the Apple phones get a push (no FCM phone twice)
  const p2 = pushService();
  assert.equal((await send(env, now + 20 * 60e3, { fetch: p2.f })).sent, 4);
  assert.ok(p2.calls.every((c) => c.url.includes("apple")));

  // a D1 statement that throws AFTER the pushes (while the run decides the refused rows): the run fails, but the batch
  // still records what was sent and releases every other claimed row
  const { env: e3, db: d3 } = await setup();
  for (let i = 0; i < 3; i++) await sub(e3, W, subscription("fcm.googleapis.com", `fcm/send/g${i}`));
  await sub(e3, W, subscription("web.push.apple.com", "refuses"));
  await news(e3, "2026-10-19");
  const prepare = e3.DB.prepare;
  const env3 = { ...e3, DB: { ...e3.DB, prepare: (sql) => { if (sql === Q.DROP_REFUSED) throw new Error("D1_ERROR"); return prepare(sql); } } };
  const p3 = pushService((u) => (u.includes("refuses") ? 403 : 201));
  await assert.rejects(send(env3, now, { fetch: p3.f }), /D1_ERROR/);
  assert.equal(p3.calls.length, 4);
  assert.equal(d3.rows("SELECT count(*) c FROM subs WHERE pend_w = 0 AND last_w = '2026-10-19'")[0].c, 3, "the three sent pushes are recorded");
  assert.equal(d3.rows("SELECT count(*) c FROM subs WHERE claim IS NOT NULL")[0].c, 0, "the refused row is released, not left claimed");
  const p4 = pushService();
  await send(e3, now + 20 * 60e3, { fetch: p4.f });
  assert.deepEqual(p4.calls.map((c) => c.url.includes("refuses")), [true], "only the row whose outcome was lost is tried again");
});

test("VAPID public key derived from the secret: VAPID_PUBLIC_KEY empty → the JWK's own key is used (push header, /health key); set → it must match", T, async () => {
  const { env, k } = await setup({ VAPID_PUBLIC_KEY: "" });
  await sub(env, [{ kind: "watch", key: "X24" }]);
  await news(env, "2026-10-19");
  const h = (await call(worker, env, "GET", "/health")).body;
  assert.deepEqual([h.sending, h.key], [true, k.pub]);
  const push = pushService();
  assert.equal((await send(env, kst("2026-10-19T09:00:00"), { fetch: push.f })).sent, 1);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(push.calls[0].init.headers.authorization);
  assert.equal(m[2], k.pub, "the push carries the derived public key");
  const [hh, pp, ss] = m[1].split(".");
  assert.equal(await wc.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k.publicKey, unb64u(ss), new TextEncoder().encode(`${hh}.${pp}`)), true);
  // set to the same key → used; the same key written with a base64 padding character is still that key (/health shows the
  // canonical form); another key → nothing is sent
  for (const v of [k.pub, k.pub + "="]) {
    const set = (await call(worker, { ...env, VAPID_PUBLIC_KEY: v }, "GET", "/health")).body;
    assert.deepEqual([set.sending, set.key], [true, k.pub]);
  }
  const other = await vapidKeys();
  assert.equal((await send({ ...env, VAPID_PUBLIC_KEY: other.pub }, kst("2026-10-19T09:10:00"), { fetch: push.f })).skipped, "keys");
});

test("static: wrangler.jsonc VAPID_PUBLIC_KEY (optional) and app/config.js pushPublicKey are the same key when both are set", () => {
  const cfg = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../../app/config.js", import.meta.url), "utf8");
  const w = /"VAPID_PUBLIC_KEY":\s*"([^"]*)"/.exec(cfg), a = /\bpushPublicKey:\s*"([^"]*)"/.exec(app);
  assert.ok(w, "wrangler.jsonc vars.VAPID_PUBLIC_KEY is written as a string (empty = derived from VAPID_PRIVATE_JWK)");
  assert.ok(a, "app/config.js has pushPublicKey");
  for (const v of [w[1], a[1]]) if (v) assert.match(v, /^[A-Za-z0-9_-]{87}$/, "a P-256 public key, base64url without padding");
  if (w[1] && a[1]) assert.equal(w[1], a[1], "phones subscribe with app/config.js pushPublicKey; the Worker pushes with VAPID_PUBLIC_KEY — they must be one key");
  // the Worker address the app calls is this Worker (when set)
  const api = /\balertsApi:\s*"([^"]*)"/.exec(app);
  assert.ok(api);
  if (api[1]) assert.equal(new URL(api[1]).origin, "https://yoonsiljang-alerts.lsy2825.workers.dev");
});

// ---- 6.0 round 5 (review findings): the factory's D1 writes are bounded (PAIR_CAP), results written as the run goes and
// safely retried

test("review finding (D1 write limit): watched is cut at PAIR_CAP — pairs of phones that took a push first, then the most-watched; /health pairs:capped; pages by offset", T, async () => {
  const { env, db } = await setup({ PAIR_CAP: "5" });
  const keys = (from, n) => Array.from({ length: n }, (_, i) => ({ kind: "target", key: `T${String(from + i).padStart(7, "0")}`, max: 1 }));
  // a flood of made-up pairs (one POST each, no browser): 3 phones × 20 rules on keys that sort first
  for (let i = 0; i < 3; i++) await sub(env, keys(i * 20, 20));
  // a real phone that took a push before, watching X24 in two regions; two more phones on X01
  const real = await sub(env, [{ kind: "watch", key: "X24" }, { kind: "watch", key: "X24", region: "서울" }]);
  db.raw.prepare("UPDATE subs SET last_w = '2026-10-10' WHERE id = ?").run(real.id);
  for (let i = 0; i < 2; i++) await sub(env, [{ kind: "watch", key: "X01" }, { kind: "target", key: "X01", max: 5 }]);
  const now = kst("2026-10-19T06:00:00");
  const w = await internal(env, "GET", "/v1/internal/watched?at=0", undefined, now);
  assert.equal(w.status, 200);
  assert.deepEqual(w.body.pairs.slice(0, 3), [{ k: "X24", r: "" }, { k: "X24", r: "서울" }, { k: "X01", r: "" }],
    "the pairs of a phone that took a push first, then a pair two phones watch (one phone's two rules on a pair count once)");
  assert.equal(w.body.pairs.length, 5);
  assert.deepEqual([w.body.next, w.body.capped], [null, true]);
  const h = async (iso) => (await call(worker, env, "GET", "/health", undefined, { now: kst(iso) })).body.pairs;
  assert.equal(await h("2026-10-19T09:30:00"), "capped");
  assert.equal(await h("2026-10-20T09:30:00"), "capped", "the next morning too");
  assert.equal(await h("2026-10-21T09:30:00"), "ok", "two days later");
  // under the cap: no stamp, no capped
  const { env: e2 } = await setup();
  await sub(e2, [{ kind: "watch", key: "X24" }]);
  const w2 = await internal(e2, "GET", "/v1/internal/watched?at=0");
  assert.deepEqual(w2.body, { pairs: [{ k: "X24", r: "" }], next: null });
  assert.equal((await call(worker, e2, "GET", "/health")).body.pairs, "ok");
  for (const bad of ["-1", "abc", "1.5", "6", "1e3"]) assert.deepEqual((await internal(env, "GET", `/v1/internal/watched?at=${bad}`)).body, { error: "BAD_PAGE" }, bad);
  // more than one page (PAGE 2,000): 105 phones × 20 distinct pairs = 2,100 pairs, read in two pages, nothing twice
  const { env: e3 } = await setup();
  for (let i = 0; i < 105; i++) await sub(e3, keys(1000 + i * 20, 20));
  const p1 = await internal(e3, "GET", "/v1/internal/watched?at=0");
  assert.deepEqual([p1.body.pairs.length, p1.body.next], [2000, 2000]);
  const p2 = await internal(e3, "GET", `/v1/internal/watched?at=${p1.body.next}`);
  assert.deepEqual([p2.body.pairs.length, p2.body.next, p2.body.capped], [100, null, undefined]);
  assert.equal(new Set([...p1.body.pairs, ...p2.body.pairs].map((p) => p.k + p.r)).size, 2100);
  assert.ok(PAIR_CAP >= 2100 && PAIR_CAP <= 5000, `PAIR_CAP ${PAIR_CAP}`);
  // the arithmetic (src/worker.js, rows written per statement measured on a local D1): pushes (≤ 8 a push: claim 2 +
  // RETRY of a row with pend_w 1 and pend_x set 4 + a delete 2) + new subscriptions (5 each; a D1 day spans two KST budget
  // days) + the finish's marks on a full table (≤ 5 per row) + the snap side of a factory run (≤ 2 × (PAIR_CAP + 500))
  // stays under D1 Free's 100,000 rows a day, a manual re-run included (cf/metrics shares the limit: not in this sum)
  const worst = 77 * SEND_LIMIT * 8 + 2 * NEW_PER_DAY * 5 + MAX_SUBS * 5 + 2 * (PAIR_CAP + 500);
  assert.equal(worst, 91640, "the worst D1 day the docs quote (≈ 91,600)");
  assert.ok(worst + 2 * (PAIR_CAP + 500) < 100000, "a second factory run the same day still fits");
  const cfg = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.equal(/"PAIR_CAP":\s*"(\d+)"/.exec(cfg)[1], String(PAIR_CAP), "wrangler.jsonc vars.PAIR_CAP = the code's default");
});

test("review finding (results batch): a results batch D1 refuses is tried again — a batch that committed but whose answer was lost changes nothing the second time; D1 refusing for good stops the pushes", T, async () => {
  const W = [{ kind: "watch", key: "X24" }];
  // (a) the first results batch commits, then the answer is lost ("Network connection lost.") → tried again: the SENT and the
  // counted failure are recorded once
  const { env, db } = await setup();
  for (let i = 0; i < 3; i++) await sub(env, W, subscription("fcm.googleapis.com", `fcm/send/ok${i}`));
  await sub(env, W, subscription("fcm.googleapis.com", "fcm/send/bad400"));
  await news(env, "2026-10-19");
  db.raw.prepare("UPDATE subs SET last_w = '2026-10-01'").run();
  const realBatch = env.DB.batch;
  let calls = 0;
  const lossy = { ...env, DB: { ...env.DB, batch: async (list) => { calls++; const r = await realBatch(list); if (calls === 2) throw new Error("D1_ERROR: Network connection lost."); return r; } } };
  const push = pushService((u) => (u.endsWith("bad400") ? 400 : 201));
  const r = await send(lossy, kst("2026-10-19T09:00:00"), { fetch: push.f, waits: [0, 0] });
  assert.deepEqual([r.sent, r.retry, r.stalled], [3, 1, undefined]);
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE pend_w = 0 AND last_w = '2026-10-19' AND claim IS NULL")[0].c, 3);
  assert.deepEqual(db.rows("SELECT fails, claim FROM subs WHERE endpoint LIKE '%bad400'"), [{ fails: 1, claim: null }], "one failure, not two");
  const p2 = pushService();
  await send(env, kst("2026-10-19T09:20:00"), { fetch: p2.f });
  assert.deepEqual(p2.calls.map((c) => c.url.endsWith("bad400")), [true], "20 minutes later nobody gets the same push again");
  // (b) the claim guard itself: SENT / RETRY / RELEASE do nothing to a row that no longer holds that claim
  const id = db.rows("SELECT id FROM subs LIMIT 1")[0].id;
  db.raw.prepare("UPDATE subs SET claim = 100, fails = 0 WHERE id = ?").run(id);
  db.raw.prepare(Q.RETRY).run(id, 99);
  db.raw.prepare(Q.RELEASE).run(id, 99);
  db.raw.prepare(Q.SENT).run(id, 1, 0, "2026-10-30", null, null, 99);
  assert.deepEqual(db.rows("SELECT claim, fails, last_w FROM subs WHERE id = ?", id), [{ claim: 100, fails: 0, last_w: "2026-10-19" }]);
  // (c) D1 refuses every results batch: after the first group (6 pushes) the run sends nothing more, and fails
  const { env: e3, db: d3 } = await setup();
  for (let i = 0; i < 10; i++) await sub(e3, W, subscription("fcm.googleapis.com", `fcm/send/x${i}`));
  await news(e3, "2026-10-19");
  let n3 = 0;
  const down = { ...e3, DB: { ...e3.DB, batch: async (list) => { if (++n3 > 1) throw new Error("D1_ERROR: D1 DB is overloaded."); return e3.DB.batch(list); } } };
  const p3 = pushService();
  await assert.rejects(send(down, kst("2026-10-19T09:00:00"), { fetch: p3.f, waits: [0, 0] }), /overloaded/);
  assert.equal(p3.calls.length, 6, "no more pushes once D1 does not take the results");
  assert.equal(d3.rows("SELECT count(*) c FROM subs WHERE claim IS NOT NULL")[0].c, 10, "the rows stay claimed (RESET_STALE frees them after 15 minutes)");
});

test("review finding (queue): rows held back at a push service that refuses, is down or says 429 never keep the other services' phones waiting — SEND_LIMIT + 5 Apple phones first in the queue, the FCM phones are sent in the next run", T, async () => {
  for (const status of [403, 503, 429]) {
    const { env, db } = await setup();
    const W = [{ kind: "watch", key: "X24" }];
    const apple = [], fcm = [];
    for (let i = 0; i < SEND_LIMIT + 5; i++) apple.push(await sub(env, W, subscription("web.push.apple.com", `a/${i}`)));
    for (let i = 0; i < 10; i++) fcm.push(await sub(env, W, subscription("fcm.googleapis.com", `fcm/send/f${i}`)));
    await news(env, "2026-10-19");
    // every phone took our pushes before; the Apple phones waited longest, so they are the front of the weekly queue
    const lastW = (xs, d) => db.raw.prepare(`UPDATE subs SET last_w = ? WHERE id IN (${xs.map(() => "?").join(",")})`).run(d, ...xs.map((x) => x.id));
    lastW(apple, "2026-10-01"); lastW(fcm, "2026-10-05");
    const push = pushService((u) => (u.includes("apple") ? status : 201));
    const fcmCalls = () => push.calls.filter((c) => c.url.includes("fcm")).length;
    const r1 = await send(env, kst("2026-10-19T08:00:00"), { fetch: push.f });
    assert.equal(fcmCalls(), 0, `${status}: run 1 holds SEND_LIMIT Apple rows`);
    assert.equal(r1.sent, 0);
    await send(env, kst("2026-10-19T08:10:00"), { fetch: push.f });
    assert.equal(fcmCalls(), 10, `${status}: the FCM phones are sent in the next run, not after the hold or the grace days`);
    assert.equal(db.rows("SELECT count(*) c FROM subs WHERE endpoint LIKE '%fcm%' AND pend_w = 1")[0].c, 0);
    assert.equal(db.rows("SELECT count(*) c FROM subs WHERE endpoint LIKE '%apple%' AND fails = 0 AND pend_w = 1")[0].c, SEND_LIMIT + 5,
      `${status}: no Apple phone was counted or removed — held back, the news waits`);
    const wait = status === 429 ? SLOW_HOLD_MINUTES : HOLD_MINUTES;
    const held = db.rows("SELECT DISTINCT -claim - ? AS d FROM subs WHERE endpoint LIKE '%apple%' AND claim < 0", Math.floor(kst("2026-10-19T08:00:00") / 60e3));
    assert.equal(held.some((x) => x.d === wait), true, `${status}: held until ${wait} minutes after the run`);
  }
});

test("review finding (D1 budget): the watched list cannot be replaced in a day — new pairs never push out pairs already computed, a new pair only takes a row a finish freed, and a factory run writes ≤ 2 × (PAIR_CAP + 500) snap rows", T, async () => {
  const CAP = 200;
  const { env, db } = await setup({ PAIR_CAP: String(CAP) });
  const key = (i) => "T" + String(i).padStart(7, "0");
  // CAP pairs from CAP / 20 subscriptions with 20 rules each (one POST each, no browser)
  const plant = async (from) => {
    const ids = [];
    for (let s = 0; s < CAP / 20; s++) ids.push((await sub(env, Array.from({ length: 20 }, (_, j) => ({ kind: "newmatch", key: key(from + s * 20 + j) })))).id);
    return ids;
  };
  const snapKeys = () => new Set(db.rows("SELECT k FROM snap").map((x) => x.k));
  const health = async (iso) => (await call(worker, env, "GET", "/health", undefined, { now: kst(iso) })).body.pairs;
  // one factory run as notify.mjs does it; a NEW collection every day (the costly case: every kept pair is rolled too)
  const factory = async (today) => {
    const before = snapKeys(), now = kst(`${today}T06:00:00`), run = `${today}|${today}`;
    const pairs = [];
    let at = 0, capped = false, skipped = 0;
    for (;;) {
      const w = (await internal(env, "GET", `/v1/internal/watched?at=${at}`, undefined, now)).body;
      pairs.push(...w.pairs); capped = capped || w.capped === true;
      if (w.next === null) break;
      at = w.next;
    }
    for (let i = 0; i < pairs.length; i += 500) {
      const d = await internal(env, "POST", "/v1/internal/digest", { run, entries: pairs.slice(i, i + 500).map((p) => ({ k: p.k, r: p.r, m: 1000, n: 1, med: 1000 })) }, now);
      assert.equal(d.status, 200);
      skipped += d.body.skipped;
    }
    assert.equal((await internal(env, "POST", "/v1/internal/finish", { run, today }, now)).status, 200);
    const after = snapKeys();
    const added = [...after].filter((k) => !before.has(k)).length, pruned = [...before].filter((k) => !after.has(k)).length;
    const kept = [...after].filter((k) => before.has(k)).length;
    // D1 rows of the snap side: a new pair 2, a pruned pair 2, a pair digested again 1 + its ROLL_BU/PROMOTE 1
    const rows = 2 * added + 2 * pruned + 2 * kept;
    assert.ok(rows <= 2 * (CAP + 500), `${today}: ${rows} snap rows written`);
    return { added, pruned, capped, skipped };
  };
  const first = await plant(5000);                                  // keys that sort last
  assert.deepEqual(await factory("2026-10-19"), { added: CAP, pruned: 0, capped: false, skipped: 0 });
  // day 2: CAP more pairs whose keys sort first (by name they would have replaced the whole list): the pairs computed
  // yesterday stay, the new ones are cut — nothing added, nothing pruned
  await plant(0);
  assert.deepEqual(await factory("2026-10-20"), { added: 0, pruned: 0, capped: true, skipped: 0 });
  assert.equal(await health("2026-10-20T09:30:00"), "capped");
  // day 3: the planter deletes yesterday's list (its own ids) — the new pairs still cannot come in the same day: the rows
  // are pruned today and free tomorrow
  for (const id of first) assert.equal((await call(worker, env, "DELETE", `/v1/push/subscribe/${id}`)).status, 204);
  assert.deepEqual(await factory("2026-10-21"), { added: 0, pruned: CAP, capped: false, skipped: CAP });
  assert.equal(await health("2026-10-21T09:30:00"), "capped", "a pair waiting for a free row is reported too");
  // day 4: the freed rows take the new pairs
  assert.deepEqual(await factory("2026-10-22"), { added: CAP, pruned: 0, capped: false, skipped: 0 });
  // one chunk can pass the room check (it is counted once per statement): snap ≤ PAIR_CAP + 500
  const { env: e2, db: d2 } = await setup({ PAIR_CAP: String(CAP) });
  const many = Array.from({ length: 1000 }, (_, i) => ({ k: key(i), r: "", m: 1000, n: 1, med: 1000 }));
  for (let i = 0; i < many.length; i += 500) await internal(e2, "POST", "/v1/internal/digest", { run: "2026-10-19|2026-10-19", entries: many.slice(i, i + 500) }, kst("2026-10-19T06:00:00"));
  assert.ok(d2.rows("SELECT count(*) c FROM snap")[0].c <= CAP + 500);
});

test("review finding (stale stretch): a refusal stretch that ended without a 2xx does not shorten the next one — a new incident weeks later still gets the 7-day grace", T, async () => {
  const { env, db } = await setup();
  const W = [{ kind: "watch", key: "X24" }];
  const a = await sub(env, W, subscription("web.push.apple.com", "a/0"));
  await news(env, "2026-10-01");
  db.raw.prepare("UPDATE subs SET last_w = '2026-09-01'").run();
  const r1 = await send(env, kst("2026-10-01T09:00:00"), { fetch: pushService(() => 403).f });
  assert.deepEqual([r1.refused, r1.spared, r1.refusing], [1, 1, 1], "one phone that took our pushes refuses: a stretch starts");
  // the phone drops that rule (its news goes): nothing is due at Apple any more, and no 2xx ever ends the stretch
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${a.id}`, { rules: [{ kind: "newmatch", key: "X01" }] })).status, 200);
  assert.deepEqual(db.rows("SELECT n FROM stat WHERE k LIKE 'rs:%' OR k LIKE 'rl:%'").map((x) => x.n), [20261001, 20261001]);
  // two weeks later: three Apple phones that took our pushes, and our setup breaks at Apple
  const bs = [];
  for (let i = 0; i < 3; i++) bs.push(await sub(env, W, subscription("web.push.apple.com", `b/${i}`)));
  await news(env, "2026-10-15");
  for (const b of bs) db.raw.prepare("UPDATE subs SET last_w = '2026-10-02' WHERE id = ?").run(b.id);
  const push = pushService(() => 403);
  for (let i = 0; i <= REFUSED_DROP; i++) {
    const r = await send(env, kst("2026-10-15T09:00:00") + i * HOLD_MINUTES * 60e3, { fetch: push.f });
    const n = i === 0 ? 3 : PROBES;                                    // then the held phones come back PROBES a run
    assert.deepEqual([r.refused, r.spared], [n, n], `try ${i + 1}: spared, not counted`);
  }
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 4, "nobody removed");
  assert.deepEqual(db.rows("SELECT n FROM stat WHERE k LIKE 'rs:%'"), [{ n: 20261015 }], "the new stretch starts on its own first day");
  // the grace days still end: counted from 10-15, then removed after REFUSED_DROP refusals in a row
  for (let d = 1; d < REFUSING_GRACE_DAYS; d++) await send(env, kst(`${addDays("2026-10-15", d)}T09:00:00`), { fetch: push.f });
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 4, `day ${REFUSING_GRACE_DAYS - 1} of the stretch: still all there`);
  const over = addDays("2026-10-15", REFUSING_GRACE_DAYS);
  for (let i = 0; i < REFUSED_DROP - 1 + Math.ceil(bs.length / PROBES); i++) await send(env, kst(`${over}T09:00:00`) + i * 10 * 60e3, { fetch: push.f });
  assert.deepEqual(db.rows("SELECT id FROM subs").map((x) => x.id), [a.id], "after the grace days the refusing phones are removed (the one with nothing due stays)");
});

test("review finding (key records): one run with a wrong key does not erase the right key's first day at a push service — after going back, the phones it reached are still protected; that day is written with the push that proves it", T, async () => {
  const db = makeDb();
  const k1 = await vapidKeys(), k2 = await vapidKeys();
  const e1 = makeEnv(db, { VAPID_PRIVATE_JWK: k1.jwk }), e2 = makeEnv(db, { VAPID_PRIVATE_JWK: k2.jwk });
  // six Apple phones subscribed with K1 (three watch X01, three X02); Apple takes a push only when it is signed with K1
  const x01 = [], x02 = [];
  for (let i = 0; i < 6; i++) (i < 3 ? x01 : x02).push(await sub(e1, [{ kind: "watch", key: i < 3 ? "X01" : "X02" }], subscription("web.push.apple.com", `p/${i}`)));
  const keyOf = (c) => /k=([^,]+)$/.exec(c.init.headers.authorization)[1];
  let broken = false;
  const apple = pushService((u, n) => (!broken && keyOf(apple.calls[n - 1]) === k1.pub ? 201 : 403));
  await news(e1, "2026-10-01", "X01"); await news(e1, "2026-10-01", "X02");
  assert.equal((await send(e1, kst("2026-10-01T09:00:00"), { fetch: apple.f })).sent, 6);
  const ok1 = `ok:${k1.pub.slice(0, 12)} https://web.push.apple.com`;
  assert.deepEqual(db.rows("SELECT n FROM stat WHERE k = ?", ok1), [{ n: 20261001 }]);
  // 10-09: news for the X01 phones; ONE run with a wrong secret (K2): refused, spared — and K1's day stays
  await news(e1, "2026-10-09", "X01");
  const wrong = await send(e2, kst("2026-10-09T09:00:00"), { fetch: apple.f });
  assert.deepEqual([wrong.refused, wrong.spared], [3, 3]);
  assert.deepEqual(db.rows("SELECT n FROM stat WHERE k = ?", ok1), [{ n: 20261001 }], "the right key's first day survives a wrong-key run");
  // back to K1 (after the hold): the X01 phones get their push — PROBES of them as probes, and their 2xx frees the third,
  // which the next run sends; K2's stretch records go
  assert.equal((await send(e1, kst("2026-10-09T09:00:00") + HOLD_MINUTES * 60e3, { fetch: apple.f })).sent, PROBES);
  assert.equal((await send(e1, kst("2026-10-09T09:10:00") + HOLD_MINUTES * 60e3, { fetch: apple.f })).sent, 3 - PROBES);
  assert.deepEqual(db.rows("SELECT n FROM stat WHERE k = ?", ok1), [{ n: 20261001 }]);
  assert.deepEqual(db.rows("SELECT k FROM stat WHERE k LIKE 'rs:%' OR k LIKE 'rl:%'"), []);
  // 10-12: our setup breaks at Apple; news for the X02 phones (last reached 10-01 = K1's first day: reached under K1)
  await news(e1, "2026-10-12", "X02");
  broken = true;
  for (let i = 0; i < REFUSED_DROP; i++) {
    const r = await send(e1, kst("2026-10-12T09:00:00") + i * HOLD_MINUTES * 60e3, { fetch: apple.f });
    const n = i === 0 ? 3 : PROBES;
    assert.deepEqual([r.refused, r.spared, r.refusing], [n, n, 1], `try ${i + 1}: suspect, spared`);
  }
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE fails = 0")[0].c, 6, "all six phones are still there, none counted");
  assert.equal((await call(worker, e1, "GET", "/health", undefined, { now: kst("2026-10-12T21:00:00") })).body.refusing, true, "and the monitor is told");

  // the first 2xx's day goes into the same results batch as that SENT: a run whose closing batch fails still has it
  const { env: e3, db: d3, k: k3 } = await setup();
  await sub(e3, [{ kind: "watch", key: "X24" }], subscription("fcm.googleapis.com", "fcm/send/one"));
  await news(e3, "2026-10-19");
  const realBatch = e3.DB.batch;
  let n3 = 0;
  const closingFails = { ...e3, DB: { ...e3.DB, batch: async (list) => { if (++n3 > 2) throw new Error("D1_ERROR: Network connection lost."); return realBatch(list); } } };
  await assert.rejects(send(closingFails, kst("2026-10-19T09:00:00"), { fetch: pushService().f, waits: [0, 0] }), /Network connection lost/);
  assert.deepEqual(d3.rows("SELECT last_w FROM subs"), [{ last_w: "2026-10-19" }], "the push is recorded");
  assert.deepEqual(d3.rows("SELECT n FROM stat WHERE k = ?", `ok:${k3.pub.slice(0, 12)} https://fcm.googleapis.com`), [{ n: 20261019 }], "and so is the day it proves");
});

// ---- 4th review: an unreachable-host flood, held rows taking the queue back, the first filler keeping the pair list, the
// documented cleanup query

test("4th review (unreachable hosts): planted rows on push hosts that never answered 2xx are counted and removed — more than SEND_LIMIT × HOLD_MINUTES / 10 of them never keep the real phones waiting; deeper host names are refused", T, async () => {
  const W = [{ kind: "watch", key: "X24" }];
  // a name with more than one label in front of notify.windows.com / push.services.mozilla.com is refused at subscribe
  const { env: e0 } = await setup();
  for (const h of ["p1.x.notify.windows.com", "a.b.push.services.mozilla.com"])
    assert.equal((await call(worker, e0, "POST", "/v1/push/subscribe", { subscription: subscription(h, "w/?token=1"), rules: W })).status, 400, h);
  const P = SEND_LIMIT * HOLD_MINUTES / 10 + 40;                      // 760: past what held (not counted) rows would block
  for (const [label, answer, host] of [["network error, 760 hosts", "throw", (i) => `p${i}.notify.windows.com`], ["503, 7 hosts", 503, (i) => `p${i % 7}.notify.windows.com`]]) {
    const { env, db } = await setup({ NEW_PER_DAY: "5000" });
    for (let i = 0; i < 10; i++) await sub(env, W, subscription("fcm.googleapis.com", `fcm/send/f${i}`));
    for (let i = 0; i < P; i++) await sub(env, W, subscription(host(i), `w/?token=${i}`));
    await news(env, "2026-10-19");
    db.raw.prepare("UPDATE subs SET last_w = '2026-10-05' WHERE endpoint LIKE '%fcm%'").run();
    const push = pushService((u) => (u.includes("notify.windows.com") ? answer : 201));
    const fcmCalls = () => push.calls.filter((c) => c.url.includes("fcm")).length;
    let run = 0, firstFcm = -1, held = 0;
    for (let d = 0; d < 3; d++) {
      for (let m = 8 * 60; m <= 20 * 60 + 40; m += 10, run++) {
        held += (await send(env, kst(`${addDays("2026-10-19", d)}T00:00:00`) + m * 60e3, { fetch: push.f })).held;
        if (firstFcm < 0 && fcmCalls()) firstFcm = run;
      }
      if (d === 0) assert.equal(fcmCalls(), 10, `${label}: all 10 FCM phones were sent on the first day`);
    }
    assert.ok(firstFcm >= 0 && firstFcm <= P / SEND_LIMIT, `${label}: right after the planted rows' first tries (run ${firstFcm})`);
    assert.equal(held, 0, `${label}: nothing held — no push service ever answered 2xx there`);
    assert.equal(db.rows("SELECT count(*) c FROM subs WHERE endpoint LIKE '%windows%'")[0].c, 0, `${label}: every planted row is removed`);
    assert.equal(push.calls.length - fcmCalls(), P * NEVER_DROP, `${label}: each planted row cost NEVER_DROP tries`);
  }
});

test("4th review (held rows): 760 phones held at one push service (our setup refused there, it is down, or it says 429) never take the queue back — the other services' phones are sent the same day, the held ones come back PROBES a run, and all at once when that service answers 2xx again", T, async () => {
  const W = [{ kind: "watch", key: "X24" }];
  const NA = SEND_LIMIT * HOLD_MINUTES / 10 + 40;
  for (const status of [403, 503, 429]) {
    const { env, db, k } = await setup({ NEW_PER_DAY: "5000" });
    okSince(db, k.pub, "https://web.push.apple.com", "2026-09-01");   // Apple took this key's pushes before
    for (let i = 0; i < NA; i++) await sub(env, W, subscription("web.push.apple.com", `a/${i}`));
    for (let i = 0; i < 10; i++) await sub(env, W, subscription("fcm.googleapis.com", `fcm/send/f${i}`));
    await news(env, "2026-10-19");
    // every phone took our pushes before; the Apple phones waited longest: the front of the weekly queue
    db.raw.prepare("UPDATE subs SET last_w = CASE WHEN endpoint LIKE '%apple%' THEN '2026-10-01' ELSE '2026-10-05' END").run();
    let broken = true;
    const push = pushService((u) => (u.includes("apple") && broken ? status : 201));
    const appleCalls = () => push.calls.filter((c) => c.url.includes("apple")).length;
    // one day of cron runs from `from` (minutes after 00:00 KST) → the most Apple pushes any one run made
    const day = async (d, from = 8 * 60) => {
      let most = 0;
      for (let m = from; m <= 20 * 60 + 40; m += 10) {
        const before = appleCalls();
        await send(env, kst(`${d}T00:00:00`) + m * 60e3, { fetch: push.f });
        most = Math.max(most, appleCalls() - before);
      }
      return most;
    };
    // day 1: each Apple phone is tried once (nothing tells the queue the service is broken before that), then the FCM phones
    await day("2026-10-19");
    assert.equal(push.calls.filter((c) => c.url.includes("fcm")).length, 10, `${status}: the FCM phones were sent on the first day`);
    // day 2: the held Apple phones come back PROBES a run at most; nobody is counted or removed
    const most = await day("2026-10-20");
    assert.ok(most <= PROBES, `${status}: day 2: at most PROBES Apple tries a run (${most})`);
    assert.equal(db.rows("SELECT count(*) c FROM subs WHERE endpoint LIKE '%apple%' AND fails = 0 AND pend_w = 1")[0].c, NA, `${status}: nobody counted or removed`);
    // a phone of another service with news on day 2 is not held up either
    const late = await sub(env, W, subscription("fcm.googleapis.com", "fcm/send/late"));
    db.raw.prepare("UPDATE subs SET pend_w = 1, last_w = '2026-10-10' WHERE id = ?").run(late.id);
    const r0 = await send(env, kst("2026-10-20T20:40:00"), { fetch: push.f });
    assert.equal(r0.sent, 1, `${status}: sent in the next run`);
    // Apple works again: the first probe that goes through frees every held Apple phone in the same batch, and the queue
    // sends them that day
    broken = false;
    const r1 = await send(env, kst("2026-10-21T08:00:00"), { fetch: push.f });
    assert.deepEqual([r1.probes, r1.sent], [PROBES, PROBES], `${status}: the probes go through`);
    assert.equal(db.rows("SELECT count(*) c FROM subs WHERE claim < 0")[0].c, 0, `${status}: nothing is held any more`);
    await day("2026-10-21", 8 * 60 + 10);
    assert.equal(db.rows("SELECT count(*) c FROM subs WHERE pend_w = 1")[0].c, 0, `${status}: all ${NA} Apple phones got their push that day`);
    assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, NA + 11);
  }
});

test("4th review (first come keeps the list): pairs that filled the list first make way after PAIR_KEEP_DAYS — a real phone that subscribes later is computed within days, stays computed and gets its news; a factory run still writes ≤ 2 × (PAIR_CAP + 500) snap rows", T, async () => {
  const CAP = 200;
  const { env, db } = await setup({ PAIR_CAP: String(CAP) });
  const key = (i) => "T" + String(i).padStart(7, "0");
  // CAP pairs from CAP / 20 subscriptions × 20 newmatch rules (one POST each, no browser) — never news, never a push
  for (let s = 0; s < CAP / 20; s++) await sub(env, Array.from({ length: 20 }, (_, j) => ({ kind: "newmatch", key: key(s * 20 + j) })));
  const inSnap = () => db.rows("SELECT count(*) c FROM snap WHERE k = 'X24'")[0].c === 1;
  // one factory run as notify.mjs does it, a NEW collection every day; X24's lowest price is `x24m`
  const factory = async (today, x24m = 100000) => {
    const before = new Set(db.rows("SELECT k || '|' || r AS p FROM snap").map((x) => x.p));
    const now = kst(`${today}T06:00:00`), run = `${today}|${today}`, pairs = [];
    for (let at = 0; ;) {
      const w = (await internal(env, "GET", `/v1/internal/watched?at=${at}`, undefined, now)).body;
      pairs.push(...w.pairs);
      if (w.next === null) break;
      at = w.next;
    }
    for (let i = 0; i < pairs.length; i += 500) {
      const entries = pairs.slice(i, i + 500).map((p) => ({ k: p.k, r: p.r, m: p.k === "X24" ? x24m : 1000, n: 5, med: 120000 }));
      assert.equal((await internal(env, "POST", "/v1/internal/digest", { run, entries }, now)).status, 200);
    }
    assert.equal((await internal(env, "POST", "/v1/internal/finish", { run, today }, now)).status, 200);
    const after = new Set(db.rows("SELECT k || '|' || r AS p FROM snap").map((x) => x.p));
    const added = [...after].filter((p) => !before.has(p)).length, pruned = [...before].filter((p) => !after.has(p)).length;
    assert.ok(2 * added + 2 * pruned + 2 * (after.size - added) <= 2 * (CAP + 500), `${today}: snap rows written`);
    assert.ok(after.size <= CAP + 500, "the room check holds");
  };
  await factory("2026-10-19");
  assert.equal(db.rows("SELECT count(*) c FROM snap")[0].c, CAP, "the planted pairs fill the list");
  // 10-20: a real phone subscribes (X24 nationwide); the factory runs every day
  const real = await sub(env, [{ kind: "newmatch", key: "X24" }, { kind: "watch", key: "X24" }]);
  let d = "2026-10-20", first = null;
  for (; !first && d <= "2026-11-10"; d = addDays(d, 1)) { await factory(d); if (inSnap()) first = d; }
  assert.ok(first, "the real phone's pair is computed");
  assert.ok(daysBetween(first, "2026-10-19") <= PAIR_KEEP_DAYS + 1, `${first}: within PAIR_KEEP_DAYS + 1 days of the list being filled`);
  assert.equal(db.rows("SELECT added FROM snap WHERE k = 'X24'")[0].added, first, "its first day is the Worker's day");
  // it stays computed (the planted pairs that came first make way, not the newest), and its news arrives
  for (let i = 0; i < PAIR_KEEP_DAYS + 3; i++, d = addDays(d, 1)) { await factory(d); assert.ok(inSnap(), `${d}: X24 still computed`); }
  await factory(d, 90000);                                            // a 10% lower lowest price in a new collection
  assert.equal(db.rows("SELECT pend_w FROM subs WHERE id = ?", real.id)[0].pend_w, 1, "the real phone has its news");
  assert.equal((await send(env, kst(`${d}T09:00:00`), { fetch: pushService().f })).sent, 1);
  const w = (await internal(env, "GET", "/v1/internal/watched?at=0", undefined, kst(`${d}T10:00:00`))).body;
  assert.deepEqual(w.pairs[0], { k: "X24", r: "" }, "a phone that took a push puts its pair first for good");
});

test("4th/5th review (cleanup queries): the narrow query the docs give first (SECURITY_ARCHITECTURE §4) removes only never-pushed subscriptions none of whose keys is in the factory's key set — nothing while no set is stored; the wide one (a user decision) removes every subscription that never received a push; neither touches a row a send run holds or a phone that took a push", T, async () => {
  const doc = readFileSync(new URL("../../../docs/SECURITY_ARCHITECTURE.md", import.meta.url), "utf8");
  const all = (re) => [...doc.matchAll(re)].map((m) => m[1]);
  const dels = all(/`(DELETE FROM subs WHERE [^`]+)`/g), counts = all(/`(SELECT count\(\*\) FROM subs WHERE [^`]+)`/g);
  const narrowDel = dels.find((q) => q.includes("keyset")), narrowCount = counts.find((q) => q.includes("keyset"));
  const wideDel = dels.find((q) => /WHERE last_w IS NULL AND last_x IS NULL AND \(claim IS NULL OR claim < 0\);$/.test(q));
  const wideCount = counts.find((q) => /WHERE last_w IS NULL AND last_x IS NULL AND \(claim IS NULL OR claim < 0\);$/.test(q));
  assert.ok(narrowDel && narrowCount && wideDel && wideCount, "all four queries are in the doc");
  assert.ok(doc.indexOf(narrowDel) < doc.indexOf(wideDel), "the narrow one comes first");
  assert.match(doc, /넓은 쿼리[^\n]*사용자 결정/, "the doc says the wide one needs a user decision");
  for (const [c, d] of [[narrowCount, narrowDel], [wideCount, wideDel]])
    assert.equal(c.replace(/^SELECT count\(\*\)/, "").trim(), d.replace(/^DELETE/, "").trim(), "the count and the delete name the same rows");
  const run = (db, sql) => db.rows(sql.replace(/;$/, ""))[0]["count(*)"];
  // narrow: [id, rules' keys, last_w, claim]
  const { db, env } = await setup();
  const ins = db.raw.prepare("INSERT INTO subs (id, endpoint, rules, pend_w, last_w, claim) VALUES (?, ?, ?, 1, ?, ?)");
  const rk = (...keys) => JSON.stringify(keys.map((key) => ({ kind: "newmatch", key })));
  const rows = [["plantUnknown", rk("T0000001", "T0000002"), null, null], ["plantUnknownHeld", rk("T0000003"), null, -29000000],
    ["plantMixed", rk("T0000001", "X24"), null, null], ["realNeverPushed", rk("X24"), null, null],
    ["realTookPushKeyGone", rk("T0000004"), "2026-10-01", null], ["sendingNow", rk("T0000005"), null, 29000000]];
  for (const [id, rules, lastW, claim] of rows) ins.run(id.padEnd(22, "x"), `https://fcm.googleapis.com/${id}`, rules, lastW, claim);
  assert.equal(run(db, narrowCount), 0, "no key set stored yet: the narrow query names nothing");
  assert.equal((await internal(env, "POST", "/v1/internal/keys", { keys: ["X01", "X24"] })).status, 200);
  assert.equal(run(db, narrowCount), 2);
  db.raw.exec(narrowDel);
  assert.deepEqual(db.rows("SELECT id FROM subs ORDER BY id").map((x) => x.id.replace(/x+$/, "")), ["plantMixed", "realNeverPushed", "realTookPushKeyGone", "sendingNow"]);
  assert.equal(db.rows("SELECT n FROM stat WHERE k = 'subs'")[0].n, 4, "the counter follows (trigger)");
  // wide
  const { db: d2 } = await setup();
  const ins2 = d2.raw.prepare("INSERT INTO subs (id, endpoint, rules, pend_w, last_w, fails, claim) VALUES (?, ?, '[]', ?, ?, ?, ?)");
  const rows2 = [["heldPlant", 1, null, 0, -29000000], ["duePlant", 1, null, 0, null], ["idlePlant", 0, null, 0, null], ["failedPlant", 1, null, 2, null],
    ["sendingNow", 1, null, 0, 29000000], ["realHeld", 1, "2026-10-01", 0, -29000000], ["realIdle", 0, "2026-10-01", 0, null]];
  for (const [id, pend, lastW, fails, claim] of rows2) ins2.run(id.padEnd(22, "x"), `https://fcm.googleapis.com/${id}`, pend, lastW, fails, claim);
  assert.equal(run(d2, wideCount), 4);
  d2.raw.exec(wideDel);
  assert.deepEqual(d2.rows("SELECT id FROM subs ORDER BY id").map((x) => x.id.replace(/x+$/, "")), ["realHeld", "realIdle", "sendingNow"]);
  assert.equal(d2.rows("SELECT n FROM stat WHERE k = 'subs'")[0].n, 3, "the counter follows (trigger)");
});

// ---- 5th review: keys the factory cannot compute (not in the data.json it reads) never take a place in the watched list;
// once the factory's key set is stored, subscribe/PUT refuse them (400 UNKNOWN_KEY); the set is one row written on change

const putKeys = (env, keys, now) => internal(env, "POST", "/v1/internal/keys", { keys }, now);
const written = (db) => db.raw.prepare("SELECT total_changes() AS c").get().c;
// made-up keys of the right shape (T + 7), none in any data.json of the tests
const fake = (i) => "T" + String(i).padStart(7, "0");

test("5th review (key set): POST /v1/internal/keys stores ONE row, rewritten only when the set changes; a malformed set is 400 BAD_KEYS and changes nothing; MAX_KEYS keys fit the body cap", T, async () => {
  const { env, db } = await setup();
  let w = written(db);
  const r1 = await putKeys(env, ["T0000ABC", "X01", "X24"]);
  assert.deepEqual([r1.status, r1.body], [200, { keys: 3, changed: true }]);
  assert.deepEqual(db.rows("SELECT id, keys FROM keyset"), [{ id: 1, keys: '["T0000ABC","X01","X24"]' }]);
  assert.equal(written(db) - w, 1, "one row written");
  // the same set again (every factory run of an unchanged data.json): nothing written
  w = written(db);
  assert.deepEqual((await putKeys(env, ["T0000ABC", "X01", "X24"])).body, { keys: 3, changed: false });
  assert.equal(written(db) - w, 0, "an unchanged set writes no row");
  // a changed set: the one row is rewritten
  w = written(db);
  assert.deepEqual((await putKeys(env, ["X01", "X24"])).body, { keys: 2, changed: true });
  assert.equal(written(db) - w, 1);
  assert.deepEqual(db.rows("SELECT id, keys FROM keyset"), [{ id: 1, keys: '["X01","X24"]' }]);
  // malformed: refused, the stored set stays
  for (const keys of [undefined, [], ["X24", "X01"], ["X01", "X01"], ["X1"], ["x24"], [24], "X24", Array.from({ length: 20001 }, (_, i) => "T" + i.toString(36).toUpperCase().padStart(7, "0")).sort()]) {
    const r = await internal(env, "POST", "/v1/internal/keys", keys === undefined ? {} : { keys });
    assert.deepEqual([r.status, r.body], [400, { error: "BAD_KEYS" }], String(JSON.stringify(keys)).slice(0, 40));
  }
  assert.deepEqual(db.rows("SELECT keys FROM keyset"), [{ keys: '["X01","X24"]' }]);
  // MAX_KEYS keys (≈ 220 KB) are taken: the cap holds ~3.5 × today's data.json
  const max = Array.from({ length: 20000 }, (_, i) => "T" + i.toString(36).toUpperCase().padStart(7, "0")).sort();
  assert.deepEqual((await putKeys(env, max)).body, { keys: 20000, changed: true });
});

test("5th review (subscribe/PUT): before the first key set every key of the right shape is taken; afterwards a rule naming a key outside it is 400 UNKNOWN_KEY {keys} — nothing written, the budget untouched, the same endpoint keeps its row and id; PUT [] still deletes; an unknown id with known keys is still 404", T, async () => {
  const { env, db } = await setup();
  const now = kst("2026-10-19T12:00:00");
  const sa = subscription();
  const a = await sub(env, [{ kind: "watch", key: "T0000ABC" }], sa, { now });
  assert.ok(a.id, "no key set yet: accepted as before");
  assert.equal((await putKeys(env, ["X01", "X24"], now)).status, 200);
  const w = written(db), budget = () => db.rows("SELECT n FROM stat WHERE k = 'new:2026-10-19'")[0].n;
  // a new phone naming unknown keys (with a known one): refused, every unknown key listed once
  const s = subscription();
  const rules = [{ kind: "watch", key: "X24" }, { kind: "target", key: "T0000ZZZ", max: 1 }, { kind: "newmatch", key: "T0000AAA" }, { kind: "watch", key: "T0000ZZZ", region: "부산" }];
  const r = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: s, rules }, { now });
  assert.deepEqual([r.status, r.body], [400, { error: "UNKNOWN_KEY", keys: ["T0000AAA", "T0000ZZZ"] }]);
  assert.equal(r.headers.get("access-control-allow-origin"), APP, "the app can read the answer");
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE endpoint = ?", s.endpoint)[0].c, 0);
  assert.equal(budget(), 1, "today's budget is not used");
  // the same endpoint as phone a again, with an unknown key: refused, a keeps its id and rules
  assert.equal((await call(worker, env, "POST", "/v1/push/subscribe", { subscription: sa, rules: [{ kind: "watch", key: "T0000AAA" }] }, { now })).body.error, "UNKNOWN_KEY");
  assert.deepEqual(db.rows("SELECT id, rules FROM subs WHERE endpoint = ?", sa.endpoint), [{ id: a.id, rules: '[{"kind":"watch","key":"T0000ABC"}]' }]);
  // PUT: its old rule (its key is no longer in the set) plus a known one → refused, the row unchanged; the known one alone → 200
  const p1 = await call(worker, env, "PUT", `/v1/push/rules/${a.id}`, { rules: [{ kind: "watch", key: "T0000ABC" }, { kind: "watch", key: "X24" }] }, { now });
  assert.deepEqual([p1.status, p1.body], [400, { error: "UNKNOWN_KEY", keys: ["T0000ABC"] }]);
  assert.equal(db.rows("SELECT rules FROM subs WHERE id = ?", a.id)[0].rules, '[{"kind":"watch","key":"T0000ABC"}]');
  assert.equal(written(db) - w, 0, "the refused requests wrote nothing");
  assert.deepEqual((await call(worker, env, "PUT", `/v1/push/rules/${a.id}`, { rules: [{ kind: "watch", key: "X24" }] }, { now })).body, { ok: true });
  // an unknown id: known keys → 404 (subscribe again), unknown keys → 400 (subscribing again would be refused too)
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${"A".repeat(22)}`, { rules: [{ kind: "watch", key: "X01" }] }, { now })).status, 404);
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${"A".repeat(22)}`, { rules: [{ kind: "watch", key: "T0000AAA" }] }, { now })).body.error, "UNKNOWN_KEY");
  // known keys: subscribe works as before; PUT [] deletes whatever the stored rules name
  const b = await sub(env, [{ kind: "watch", key: "X01" }, { kind: "target", key: "X24", max: 100000, region: "수도권" }], subscription(), { now });
  db.raw.prepare("UPDATE subs SET rules = ? WHERE id = ?").run('[{"kind":"watch","key":"T0000ABC"}]', b.id);
  assert.deepEqual((await call(worker, env, "PUT", `/v1/push/rules/${b.id}`, { rules: [] }, { now })).body, { ok: true });
  assert.equal(db.rows("SELECT count(*) c FROM subs WHERE id = ?", b.id)[0].c, 0);
});

test("5th review (no cap slot): pairs of keys outside the factory's key set are never ranked — planted before the first set, watched by more phones than the real pairs, they no longer cut the list or come first", T, async () => {
  const { env, db } = await setup({ PAIR_CAP: "3" });
  // before any key set: 2 × 5 subscriptions × 20 made-up keys (each made-up pair watched by 2 phones) are accepted
  for (let rep = 0; rep < 2; rep++) for (let s = 0; s < 5; s++) await sub(env, Array.from({ length: 20 }, (_, j) => ({ kind: "newmatch", key: fake(s * 20 + j) })));
  // a planted row that names one real key too: only that pair counts
  await sub(env, [{ kind: "newmatch", key: fake(500) }, { kind: "newmatch", key: "X01" }]);
  // a real phone that never took a push
  await sub(env, [{ kind: "watch", key: "X24" }, { kind: "watch", key: "X24", region: "서울" }]);
  // what the 5th review found: without the key set the made-up pairs take the whole list (2 phones each, never computed)
  const w0 = (await internal(env, "GET", "/v1/internal/watched?at=0")).body;
  assert.equal(w0.capped, true);
  assert.ok(w0.pairs.every((p) => p.k.startsWith("T000")), JSON.stringify(w0.pairs));
  db.raw.exec("DELETE FROM stat WHERE k = 'capped'");
  // the factory's key set: only real pairs are ranked, the list is not cut
  assert.equal((await putKeys(env, ["X01", "X24"])).status, 200);
  const w = (await internal(env, "GET", "/v1/internal/watched?at=0")).body;
  assert.deepEqual(w, { pairs: [{ k: "X01", r: "" }, { k: "X24", r: "" }, { k: "X24", r: "서울" }], next: null });
  assert.equal((await call(worker, env, "GET", "/health")).body.pairs, "ok");
  // pages: a later page never shows a made-up pair either
  assert.deepEqual((await internal(env, "GET", "/v1/internal/watched?at=2")).body, { pairs: [{ k: "X24", r: "서울" }], next: null });
});

test("5th review (flood + new real pair): a flood of unknown-key pairs planted before the first key set (more than PAIR_CAP, 2 phones each) and a real phone that subscribes the next day — its pair is computed on that day's factory run and gets its news; the flood never enters snap; /health pairs stays ok", T, async () => {
  const CAP = 200;
  const { env, db } = await setup({ PAIR_CAP: String(CAP) });
  for (let rep = 0; rep < 2; rep++) for (let s = 0; s < CAP / 20 + 2; s++) await sub(env, Array.from({ length: 20 }, (_, j) => ({ kind: "newmatch", key: fake(s * 20 + j) })), subscription(), { now: kst("2026-10-18T12:00:00") });
  // one factory run as notify.mjs does it: the key set of its data.json first, then the watched pages, digest, finish
  const KEYS = ["X01", "X07", "X24"];
  const factory = async (today, x24m = 100000) => {
    const now = kst(`${today}T06:00:00`), run = `${today}|${today}`, pairs = [];
    assert.equal((await putKeys(env, KEYS, now)).status, 200);
    for (let at = 0; ;) {
      const w = (await internal(env, "GET", `/v1/internal/watched?at=${at}`, undefined, now)).body;
      assert.notEqual(w.capped, true, `${today}: the list is not cut`);
      pairs.push(...w.pairs);
      if (w.next === null) break;
      at = w.next;
    }
    assert.ok(pairs.every((p) => KEYS.includes(p.k)), "only keys the factory can compute");
    if (pairs.length) {
      const entries = pairs.map((p) => ({ k: p.k, r: p.r, m: p.k === "X24" ? x24m : 1000, n: 5, med: 120000 }));
      const d = await internal(env, "POST", "/v1/internal/digest", { run, entries }, now);
      assert.deepEqual(d.body, { saved: entries.length, skipped: 0 });
    }
    assert.equal((await internal(env, "POST", "/v1/internal/finish", { run, today }, now)).status, 200);
    return pairs;
  };
  assert.deepEqual(await factory("2026-10-19"), [], "day 1: the flood is not in the list");
  // day 2: a real phone subscribes (X24 nationwide); planting more made-up keys is refused now
  const real = await sub(env, [{ kind: "newmatch", key: "X24" }, { kind: "watch", key: "X24" }], subscription(), { now: kst("2026-10-19T12:00:00") });
  assert.equal((await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: [{ kind: "newmatch", key: fake(9999) }] }, { now: kst("2026-10-19T12:00:00") })).body.error, "UNKNOWN_KEY");
  assert.deepEqual(await factory("2026-10-20"), [{ k: "X24", r: "" }]);
  assert.deepEqual(db.rows("SELECT k, added FROM snap"), [{ k: "X24", added: "2026-10-20" }], "computed the next morning; nothing of the flood in snap");
  await factory("2026-10-21", 90000);                                   // a 10% lower lowest price
  assert.equal(db.rows("SELECT pend_w FROM subs WHERE id = ?", real.id)[0].pend_w, 1, "the real phone has its news");
  assert.equal((await send(env, kst("2026-10-21T09:00:00"), { fetch: pushService().f })).sent, 1);
  for (const d of ["2026-10-19", "2026-10-20", "2026-10-21"]) assert.equal((await call(worker, env, "GET", "/health", undefined, { now: kst(`${d}T09:30:00`) })).body.pairs, "ok", d);
  assert.equal(db.rows("SELECT count(*) c FROM subs")[0].c, 2 * (CAP / 20 + 2) + 1, "the flood rows stay until a person runs the narrow cleanup query");
});
