// node --test cf/alerts/test/*.test.mjs — the factory side (notify.mjs) against the Worker with a small data.json-shaped
// fixture: first sight only stores baselines; a changed published data.json marks target/watch/newmatch/expiring for
// exactly the phones whose rules match, on the price basis of the app's alert engine (병원 표시가); news is sticky across a
// failed run and never repeats, and a rebuild without a scrape is never news; what leaves the runner is (key, region)
// pairs and numbers — never ids or endpoints.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import worker from "../src/worker.js";
import { notify as notifyReal, listedPrice, reclDate, shapeProblems, checkUrl, fingerprint } from "../notify.mjs";
import { REGION_GROUPS } from "../src/rules.js";
import { SKIP_SQL, makeDb, makeEnv, call, subscription, SECRET_VALUE } from "./helpers.mjs";

const URL_ = "https://yoonsiljang-alerts.lsy2825.workers.dev";
const T = { skip: SKIP_SQL };
// every line notify.mjs logs in ANY test of this file (the last test asserts none of them holds a secret, URL, id or endpoint)
const ALL_LOGS = [];
const notify = (o) => notifyReal({ ...o, log: (l) => { ALL_LOGS.push(String(l)); if (o.log) o.log(l); } });

// s: string table; branches[5] = region (s index); rows: [branch, , name, listed price, , kind, cond, keys(s idx), , ,
// until(s idx), , VAT (1 포함 · 2 별도), waiting-review]
function data(updated, rows, extraBranches = []) {
  const s = ["", "X24", "X01", "X02", "서울", "부산", "2026-10-21", "9999-12-31", "posted:2", "2026-10-01", "2026-10-19", "경기", "X03", "인천"];
  return {
    meta: { updated, brands: [["브랜드A"], ["브랜드B"], ["브랜드C"]] },
    s,
    branches: [[0, 0, 0, 37.5, 127, 4], [1, 0, 0, 37.5, 127, 4], [0, 0, 0, 35.1, 129, 5], [1, 0, 0, 37.3, 127, 11], ...extraBranches],
    keys: [["X24", "g", "리쥬란"], ["X01", "g", "보톡스"], ["X02", "g", "울쎄라"], ["X03", "g", "슈링크"]],
    trend: { dates: [], k: {} },
    rows: rows.map(([b, p, key, until = 0, review = 0, vat = 1]) => [b, 0, 0, p, 0, 0, 0, key, 0, 0, until, 0, vat, review]),
  };
}
const WEEK1 = data("2026-10-12", [
  [0, 100000, 1], [1, 120000, 1], [2, 110000, 1],
  [0, 50000, 2],
  [0, 200000, 3],
]);
const WEEK2 = data("2026-10-19", [
  [0, 90000, 1, 6], [1, 120000, 1, 7], [2, 110000, 1, 8],      // X24: lowest 90,000 now, and it ends 10-21 (서울)
  [1, 10000, 1, 0, 1],                                          // waiting for review → ignored
  [0, 50000, 2], [1, 40000, 2],                                 // X01: median 50,000 → 45,000 (−10%), new low 40,000
  [0, 200000, 3], [2, 210000, 3],                               // X02: one more branch
]);

// the Worker, with its clock at 06:00 KST of `today` (finish checks the factory's today against its own clock)
function wire(env, failWhen = () => false, today) {
  const sent = [];
  const f = async (url, init) => {
    sent.push({ url, body: init.body || "" });
    if (failWhen(new URL(url).pathname)) return new Response("{}", { status: 503 });
    return worker.fetch(new Request(url, init), env, { waitUntil() {} }, today ? Date.parse(`${today}T06:00:00+09:00`) : undefined);
  };
  return { f, sent };
}
async function phonesWith(env, db, rules) {
  const phones = {};
  for (const [name, r] of Object.entries(rules)) {
    const s = subscription();
    const res = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: s, rules: r });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    phones[name] = { id: res.body.id, endpoint: s.endpoint };
  }
  const state = () => Object.fromEntries(Object.entries(phones).map(([n, p]) => {
    const r = db.rows("SELECT pend_w, pend_x FROM subs WHERE id = ?", p.id)[0];
    return [n, `${r.pend_w}|${r.pend_x || ""}`];
  }));
  const clear = () => db.raw.prepare("UPDATE subs SET pend_w = 0, pend_x = NULL").run();
  return { phones, state, clear };
}
const run = (env, d, today, extra = {}) => notify({ data: d, today, url: URL_, secret: SECRET_VALUE, fetch: wire(env, undefined, today).f, log: () => {}, waitMs: 0, ...extra });

test("notify: baselines first, then target/watch/newmatch/expiring news for exactly the matching phones", T, async () => {
  const db = makeDb(), env = makeEnv(db);
  const { phones, state, clear } = await phonesWith(env, db, {
    A: [{ kind: "target", key: "X24", max: 95000 }],
    B: [{ kind: "watch", key: "X01" }],
    C: [{ kind: "newmatch", key: "X02" }],
    D: [{ kind: "expiring", key: "X24", region: "서울" }],
    E: [{ kind: "watch", key: "X02", region: "부산" }, { kind: "target", key: "X24", max: 80000 }],
  });
  const logs = [];
  const w1 = wire(env, undefined, "2026-10-12");
  const r1 = await notify({ data: WEEK1, today: "2026-10-12", url: URL_ + "/", secret: SECRET_VALUE, fetch: w1.f, log: (l) => logs.push(l) });
  assert.equal(r1.pairs, 5);                       // X01, X02, X02|부산, X24, X24|서울
  assert.deepEqual([r1.weekly, r1.expiring], [0, 0], "first sight only stores baselines");
  assert.deepEqual(Object.values(state()), ["0|", "0|", "0|", "0|", "0|"]);

  const w2 = wire(env, undefined, "2026-10-19");
  const r2 = await notify({ data: WEEK2, today: "2026-10-19", url: URL_, secret: SECRET_VALUE, fetch: w2.f, log: (l) => logs.push(l) });
  assert.deepEqual(state(), { A: "1|", B: "1|", C: "1|", D: "0|2026-10-21", E: "0|" });
  assert.deepEqual([r2.weekly, r2.expiring], [3, 1]);
  const x24 = r2.entries.find((e) => e.k === "X24" && e.r === "");
  assert.deepEqual([x24.m, x24.n, x24.med], [90000, 3, 110000]);
  const seoul = r2.entries.find((e) => e.k === "X24" && e.r === "서울");
  assert.deepEqual([seoul.e, seoul.s, seoul.u], [90000, 120000, "2026-10-21"], "posted:/9999 rows count as staying; review rows ignored");

  // the same data again (a code-only rebuild the next day): no new weekly news; expiring is recomputed daily
  clear();
  const r3 = await run(env, WEEK2, "2026-10-20");
  assert.equal(r3.weekly, 0);
  assert.equal(r3.expiring, 1, "expiring is recomputed every day (exp_sent decides whether it was already announced)");

  // what left the runner: pairs and numbers, never ids or endpoints; logs are counts only
  const out = JSON.stringify([...w1.sent, ...w2.sent]) + logs.join("\n");
  for (const p of Object.values(phones)) { assert.equal(out.includes(p.id), false); assert.equal(out.includes(p.endpoint), false); }
  assert.equal(/fcm\.googleapis|p256dh/.test(out), false);
  assert.equal(/X24|X01|서울/.test(logs.join("\n")), false);
  assert.match(logs[1], /^price alerts: 5 watched pairs \(0 skipped, \d+ changed/);
});

test("(i) a failed finish, then the next run: the news is still delivered, once", T, async () => {
  const db = makeDb(), env = makeEnv(db);
  const { state } = await phonesWith(env, db, { B: [{ kind: "watch", key: "X01" }], C: [{ kind: "newmatch", key: "X02" }] });
  await run(env, WEEK1, "2026-10-12");
  await assert.rejects(run(env, WEEK2, "2026-10-19", { fetch: wire(env, (p) => p === "/v1/internal/finish", "2026-10-19").f }), /finish answered 503/);
  assert.deepEqual(state(), { B: "0|", C: "0|" }, "nothing marked yet");
  const r = await run(env, WEEK2, "2026-10-20");                 // next day, same published data
  assert.equal(r.weekly, 2);
  assert.deepEqual(state(), { B: "1|", C: "1|" });
  db.raw.prepare("UPDATE subs SET pend_w = 0").run();
  assert.equal((await run(env, WEEK2, "2026-10-21")).weekly, 0, "and only once");
  // a failed later digest chunk: same story (the first chunks' pending numbers wait, nothing is lost)
  const WEEK3 = data("2026-10-26", [[0, 30000, 2], [1, 40000, 2], [3, 50000, 2], [0, 200000, 3], [2, 210000, 3], [3, 190000, 3]]);
  await assert.rejects(run(env, WEEK3, "2026-10-26", { fetch: wire(env, (p) => p === "/v1/internal/finish", "2026-10-26").f }));
  assert.equal((await run(env, WEEK3, "2026-10-27")).weekly, 2);
});

test("(ii) the same data twice → no second news; (iii) a no-scrape day with ended events → no watch/newmatch/target news", T, async () => {
  const db = makeDb(), env = makeEnv(db);
  const { state, clear } = await phonesWith(env, db, {
    A: [{ kind: "target", key: "X24", max: 95000 }], B: [{ kind: "watch", key: "X24" }], C: [{ kind: "newmatch", key: "X24" }],
  });
  await run(env, WEEK1, "2026-10-12");
  assert.equal((await run(env, WEEK2, "2026-10-19")).weekly, 2, "target crossed + new low; X24 still has 3 branches");
  assert.deepEqual(state(), { A: "1|", B: "1|", C: "0|" });
  clear();
  assert.deepEqual(await run(env, WEEK2, "2026-10-19"), { go: "done" }, "(ii) same data, same day: not computed again");
  // (iii) days later, nothing scraped: data.json is unchanged but the 90,000 event (until 10-21) and the 10-01 row are over.
  // The baseline is not recomputed from 'today', so no price 'moves' and nobody is told anything.
  for (const day of ["2026-10-22", "2026-10-23", "2026-10-25"]) {
    const r = await run(env, WEEK2, day);
    assert.deepEqual([r.weekly, r.changed], [0, 0], day);
  }
  assert.deepEqual(state(), { A: "0|", B: "0|", C: "0|" });
});

test("(iv) a brand added mid-week without a meta.updated change → newmatch news", T, async () => {
  const db = makeDb(), env = makeEnv(db);
  const { state } = await phonesWith(env, db, { C: [{ kind: "newmatch", key: "X03" }], W: [{ kind: "watch", key: "X03" }] });
  const before = data("2026-10-19", [[0, 70000, 12], [1, 72000, 12]]);
  await run(env, before, "2026-10-19");
  // the same meta.updated, one more branch of a new brand (index 4) with the treatment
  const after = data("2026-10-19", [[0, 70000, 12], [1, 72000, 12], [4, 71000, 12]], [[2, 0, 0, 37.4, 126.7, 13]]);
  const r = await run(env, after, "2026-10-21");
  assert.equal(r.weekly, 1);
  assert.deepEqual(state(), { C: "1|", W: "0|" }, "newmatch only: the median moved < 5% and no new low");
});

test("price basis: max is compared with the clinics' listed price (병원 표시가), the app's alert engine basis — never the VAT display", T, async () => {
  // the app's alert engine (app/app.js watchNow) compares ROWS[i][14] = the raw listed price kept before the VAT display,
  // specials as the alert was made (default: included); docs/ALERT_ENGINE_SPEC.md §3 says so. Any change here fails.
  const app = readFileSync(new URL("../../../app/app.js", import.meta.url), "utf8");
  const watchNow = /function watchNow\(a\) \{[\s\S]*?\n  \}\n/.exec(app);
  assert.ok(watchNow, "app/app.js watchNow() not found");
  assert.match(watchNow[0], /ROWS\[i\]\[14\] < ROWS\[x\]\[14\]/, "watchNow compares r[14]");
  assert.match(watchNow[0], /ROWS\[best\]\[14\] < low/);
  assert.match(watchNow[0], /a\.sp !== false \|\| !isSpecial/, "specials follow the alert's own setting");
  assert.match(app, /r\[14\] = r\[3\]; r\[16\] = r\[4\];/, "r[14] is the raw listed price");
  assert.match(app, /if \(al\.sp == null\) al\.sp = st\.special;/);
  assert.match(app, /special: store\.get\("special", true\)/, "specials included by default");
  const spec = readFileSync(new URL("../../../docs/ALERT_ENGINE_SPEC.md", import.meta.url), "utf8");
  assert.match(/## 3\. 값의 기준[\s\S]*?\n## 4/.exec(spec)[0], /값은 \*\*병원 표시가\*\*/);
  assert.equal(listedPrice([0, 0, 0, 86000, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0]), 86000, "VAT 별도: the listed number, no +10%");

  const db = makeDb(), env = makeEnv(db);
  const { state, clear } = await phonesWith(env, db, {
    T85: [{ kind: "target", key: "X01", max: 85000 }],
    T90: [{ kind: "target", key: "X01", max: 90000 }],
    X85: [{ kind: "expiring", key: "X01", max: 85000 }],
    X90: [{ kind: "expiring", key: "X01", max: 90000 }],
    W: [{ kind: "watch", key: "X01" }],
  });
  await run(env, data("2026-10-12", [[0, 100000, 2], [1, 120000, 2]]), "2026-10-12");
  // listed 86,000 'VAT 별도' (94,600 on the app's default VAT screen), ending 10-21: under 90,000, not under 85,000
  const r = await run(env, data("2026-10-19", [[0, 86000, 2, 6, 0, 2], [1, 120000, 2]]), "2026-10-19");
  assert.equal(r.entries.find((e) => e.k === "X01" && e.r === "").m, 86000);
  assert.deepEqual(state(), { T85: "0|", T90: "1|", X85: "0|", X90: "0|2026-10-21", W: "1|" });
  // the VAT flag of the same rows flips (data2/vat_policy.json changed), prices as listed unchanged: nothing moves
  clear();
  const flipped = await run(env, data("2026-10-26", [[0, 86000, 2, 0, 0, 1], [1, 120000, 2, 0, 0, 1]]), "2026-10-26");
  assert.deepEqual([flipped.weekly, flipped.changed], [0, 0]);
  // specials (체험가 · 첫 방문 …, r[5] / r[6]) count, as in the app's alert engine by default
  const sp = data("2026-11-02", [[0, 86000, 2], [1, 120000, 2], [1, 70000, 2]]);
  sp.rows[2][5] = 1;                                              // a 체험가 row
  assert.equal((await run(env, sp, "2026-11-02")).entries.find((e) => e.k === "X01" && e.r === "").m, 70000);
});

test("a rebuild without a scrape (same meta.updated) drops ended rows: not news; the same rows coming back with the next scrape: not news", T, async () => {
  const db = makeDb(), env = makeEnv(db);
  const { state } = await phonesWith(env, db, {
    W: [{ kind: "watch", key: "X24" }],
    N: [{ kind: "newmatch", key: "X24" }],
    T: [{ kind: "target", key: "X24", max: 90000 }],              // already at max before the rebuild
    TS: [{ kind: "target", key: "X24", max: 90000, region: "서울" }],
  });
  // collection 10-17: 서울 branch 0 has a 90,000 event ending 10-19 (s[10]); branch 1 only 120,000; 부산 110,000
  const scraped = (updated, until) => data(updated, [[0, 90000, 1, until], [1, 120000, 1], [2, 110000, 1], [3, 95000, 1, until]]);
  await run(env, scraped("2026-10-17", 10), "2026-10-17");
  // 10-20 rebuild, nothing scraped: build2/clean.py dropped the ended rows (branch 0 and 3 lose X24) → fewer branches,
  // higher lowest and median. Same collection → the baseline does not move the bad way, nobody is told anything
  const rebuilt = data("2026-10-17", [[1, 120000, 1], [2, 110000, 1]]);
  const r1 = await run(env, rebuilt, "2026-10-20");
  assert.deepEqual([r1.weekly, r1.changed], [0, 0]);
  assert.deepEqual(db.rows("SELECT m, n FROM snap WHERE k = 'X24' AND r = ''")[0], { m: 90000, n: 4 }, "baseline kept");
  // 10-21 the next scrape brings the same events back (extended to 10-21): same prices as before → no news at all
  const r2 = await run(env, scraped("2026-10-21", 6), "2026-10-21");
  assert.deepEqual([r2.weekly], [0]);
  assert.deepEqual(state(), { W: "0|", N: "0|", T: "0|", TS: "0|" });
  // that scrape had the very same numbers as the baseline, so the baseline now belongs to collection 10-21: a rebuild of it
  // (10-22, ended rows dropped) and the next scrape bringing them back (10-23) are again not news
  assert.equal(db.rows("SELECT bu FROM snap WHERE k = 'X24' AND r = ''")[0].bu, "2026-10-21");
  assert.deepEqual([(await run(env, data("2026-10-21", [[1, 120000, 1], [2, 110000, 1]]), "2026-10-22")).weekly], [0]);
  assert.deepEqual([(await run(env, scraped("2026-10-23", 6), "2026-10-23")).weekly], [0]);
  assert.deepEqual(state(), { W: "0|", N: "0|", T: "0|", TS: "0|" });
  // a real rise (the events did not come back) is taken only when TWO new collections show it — never news by itself; a
  // drop back to 90,000 after ONE such collection is not news either (the baseline still said 90,000)
  const risen = (updated) => data(updated, [[0, 100000, 1], [1, 120000, 1], [2, 110000, 1], [3, 99000, 1]]);
  await run(env, risen("2026-10-28"), "2026-10-28");
  assert.deepEqual(state(), { W: "0|", N: "0|", T: "0|", TS: "0|" });
  assert.deepEqual(db.rows("SELECT m, cb, cu FROM snap WHERE k = 'X24' AND r = ''")[0], { m: 90000, cb: 5, cu: "2026-10-28" }, "lowest and median held, 4 branches still");
  assert.equal((await run(env, scraped("2026-11-04", 0), "2026-11-04")).weekly, 0, "back after one collection: nothing happened");
  assert.deepEqual(db.rows("SELECT m, cb FROM snap WHERE k = 'X24' AND r = ''")[0], { m: 90000, cb: 0 });
  await run(env, risen("2026-11-11"), "2026-11-11");
  await run(env, risen("2026-11-18"), "2026-11-18");
  assert.deepEqual(state(), { W: "0|", N: "0|", T: "0|", TS: "0|" }, "a rise is never news");
  assert.deepEqual(db.rows("SELECT m, cb FROM snap WHERE k = 'X24' AND r = ''")[0], { m: 99000, cb: 0 }, "seen twice: the rise is the baseline");
  // the next drop to 90,000 is then a real crossing of max
  const r3 = await run(env, scraped("2026-11-25", 0), "2026-11-25");
  assert.equal(r3.weekly, 3);
  assert.deepEqual(state(), { W: "1|", N: "0|", T: "1|", TS: "1|" }, "new low and both targets cross 90,000; still 4 branches");
});

test("region 수도권 = 서울 + 경기 + 인천 (the app's CAPITAL list), its own pair", T, async () => {
  const app = readFileSync(new URL("../../../app/app.js", import.meta.url), "utf8");
  const capital = /const CAPITAL = (\[[^\]]*\]);/.exec(app);
  assert.ok(capital, "app/app.js CAPITAL not found");
  assert.deepEqual(JSON.parse(capital[1]), REGION_GROUPS["수도권"]);
  const db = makeDb(), env = makeEnv(db);
  const { state } = await phonesWith(env, db, { M: [{ kind: "target", key: "X24", max: 95000, region: "수도권" }], S: [{ kind: "target", key: "X24", max: 95000, region: "서울" }] });
  // branch 3 is 경기, branch 2 is 부산
  await run(env, data("2026-10-12", [[0, 100000, 1], [3, 99000, 1], [2, 50000, 1]]), "2026-10-12");
  const r = await run(env, data("2026-10-19", [[0, 100000, 1], [3, 93000, 1], [2, 50000, 1]]), "2026-10-19");
  const m = r.entries.find((e) => e.r === "수도권");
  assert.deepEqual([m.m, m.n], [93000, 2], "부산 not counted; 서울 + 경기 are");
  assert.deepEqual(state(), { M: "1|", S: "0|" });
});

test("notify: nobody watching → no digest, finish still runs; wrong secret fails (4xx not retried)", T, async () => {
  const db = makeDb(), env = makeEnv(db);
  const w = wire(env, undefined, "2026-10-12");
  const r = await notify({ data: WEEK1, today: "2026-10-12", url: URL_, secret: SECRET_VALUE, fetch: w.f, log: () => {} });
  assert.equal(r.pairs, 0);
  assert.deepEqual(w.sent.map((x) => new URL(x.url).pathname), ["/v1/internal/start", "/v1/internal/keys", "/v1/internal/watched", "/v1/internal/finish"]);
  assert.deepEqual(JSON.parse(w.sent[1].body), { keys: ["X01", "X02", "X03", "X24"] }, "the data.json's keys, ascending, each once");
  assert.deepEqual(db.rows("SELECT keys FROM keyset"), [{ keys: '["X01","X02","X03","X24"]' }]);
  const bad = wire(env, undefined, "2026-10-12");
  await assert.rejects(notify({ data: WEEK1, today: "2026-10-12", url: URL_, secret: "nope", fetch: bad.f, log: () => {}, waitMs: 0 }), /401/);
  assert.equal(bad.sent.length, 1);
});

test("CLI: never fails the price build — unset env skips, a failure is a ::warning with exit 0", () => {
  const cli = fileURLToPath(new URL("../notify.mjs", import.meta.url));
  const skip = spawnSync(process.execPath, [cli, "/nonexistent/data.json"], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(skip.status, 0);
  assert.match(skip.stdout, /^::notice title=price alerts::ALERTS_URL and ALERTS_SECRET are not set — price alerts skipped$/m);
  const down = spawnSync(process.execPath, [cli, "/nonexistent/data.json"], { env: { PATH: process.env.PATH, ALERTS_URL: "http://127.0.0.1:9", ALERTS_SECRET: "x" }, encoding: "utf8" });
  assert.equal(down.status, 0);
  assert.match(down.stdout, /^::warning title=price alerts::/m);
  assert.equal(down.stdout.includes("ALERTS_SECRET=x"), false);
});

test("cf-alerts.yml runs these tests whenever a file they import or guard changes (app/domain chain, app.js, spec)", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const yml = readFileSync(new URL("../../../.github/workflows/cf-alerts.yml", import.meta.url), "utf8");
  const paths = JSON.parse("[" + /paths: \[([\s\S]*?)\]/.exec(yml)[1] + "]");
  const covered = (f) => paths.some((p) => (p.endsWith("/**") ? f.startsWith(p.slice(0, -2)) : f === p));
  // everything notify.mjs loads from the app (the whole require chain of pricectx.js, stats.js, pricing.js; the cache is
  // shared with notify.mjs's own require)
  const require = createRequire(import.meta.url);
  for (const m of ["pricectx", "stats", "pricing"]) require(`../../../app/domain/${m}.js`);
  const loaded = Object.keys(require.cache).filter((k) => k.startsWith(root + "app/")).map((k) => k.slice(root.length));
  assert.ok(loaded.length >= 7, loaded.join(" "));
  for (const f of loaded) assert.ok(covered(f), `${f} is not in cf-alerts.yml paths`);
  // what the guards read, and what makes the compare keys and branch regions that rules.js KEY_RE/REGIONS must match
  for (const f of ["app/app.js", "docs/ALERT_ENGINE_SPEC.md", "build2/appdata.py", "cf/alerts/notify.mjs", "build2/taxonomy.py", "build2/xkeys.py", "data2/branch_region_hint.json"]) {
    assert.ok(existsSync(new URL(f, "file://" + root)), `${f} exists`);
    assert.ok(covered(f), `${f} is not in cf-alerts.yml paths`);
  }
});

test("cf-alerts.yml: wrangler is installed in a step WITHOUT the token; only the pinned copy sees it (same pattern as cf-workers.yml)", () => {
  const yml = readFileSync(new URL("../../../.github/workflows/cf-alerts.yml", import.meta.url), "utf8");
  const code = yml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.equal(/\bnpx\b/.test(code), false, "no npx: it would resolve and run wrangler's dependencies with the token in the environment");
  const steps = code.split(/\n {6}- /).slice(1);
  const install = steps.find((st) => /name: Install wrangler/.test(st));
  assert.ok(install, "an install step");
  assert.match(install, /npm install --no-save --no-fund --no-audit --prefix "\$RUNNER_TEMP\/wr" wrangler@4\.145\.0/);
  assert.equal(/secrets\.|env:|CLOUDFLARE_/.test(install), false, "no secret and no env in the install step");
  // the token's VALUE reaches exactly five steps (migrations, deploy, and three of the one-time key setup); the 'Ready to
  // deploy?' step only learns whether it is set (a boolean) and runs grep
  const withToken = steps.filter((st) => /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/.test(st));
  assert.deepEqual(withToken.map((st) => /name: ([^\n]*)/.exec(st)[1]), ["Apply D1 migrations", "Deploy the Worker",
    "Key setup — does the Worker already have a VAPID key?", "Key setup — store ALERTS_SECRET (through stdin)",
    "Key setup — make the VAPID key pair here, store the private key (through stdin)"]);
  const ready = steps.find((st) => /id: ready/.test(st));
  assert.match(ready, /HAS_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN != '' \}\}/);
  assert.equal(/\bnpm\b|\bnpx\b|node_modules|\bnode\b|\bwrangler\b [a-z]/.test(ready.replace(/::notice[^\n]*/g, "")), false, "the ready step runs no package code");
  const WR = '"\\$RUNNER_TEMP/wr/node_modules/\\.bin/wrangler"';
  for (const st of withToken.slice(0, 2)) assert.match(st, new RegExp(`run: '${WR} (d1 migrations apply DB --remote|deploy) --config cf/alerts/wrangler\\.jsonc'`));
  for (const st of withToken) {
    assert.match(st, /WRANGLER_SEND_METRICS: "false"/);
    // the only package code run with the token is the pinned copy (and, in the key step, cf/alerts/vapid-keygen.mjs from this checkout)
    assert.ok(st.includes('"$RUNNER_TEMP/wr/node_modules/.bin/wrangler"'), "the pinned wrangler");
  }
  // green is not deployed: the header says how to tell
  assert.match(yml, /A GREEN run is NOT proof the Worker was deployed/);
});

test("a regroup (data.json meta.recl) re-bases the pair silently — in a rebuild or a new collection — like the app's checkAlerts", T, async () => {
  const db = makeDb(), env = makeEnv(db);
  const { state, clear } = await phonesWith(env, db, {
    N: [{ kind: "newmatch", key: "X24" }], W: [{ kind: "watch", key: "X24" }], T: [{ kind: "target", key: "X24", max: 75000 }],
    O: [{ kind: "watch", key: "X01" }],
  });
  // the real order of things: collection 10-14 published; a rule fix the same week moves rows into X24 (more branches, a
  // new low, the median down) in a rebuild with the SAME meta.updated and meta.recl = [["2026-10-14", ["X24"]]]
  const before = data("2026-10-14", [[0, 100000, 1], [1, 120000, 1], [0, 50000, 2]]);
  await run(env, before, "2026-10-14");
  assert.deepEqual(db.rows("SELECT g FROM snap WHERE k = 'X24'")[0], { g: "" });
  const regrouped = data("2026-10-14", [[0, 100000, 1], [1, 120000, 1], [2, 80000, 1], [3, 90000, 1], [0, 50000, 2]]);
  regrouped.meta.recl = [["2026-10-14", ["X24"]]];
  const r1 = await run(env, regrouped, "2026-10-16");
  assert.deepEqual([r1.weekly, r1.changed], [0, 0], "a new mix of rows is not a price change");
  assert.deepEqual(state(), { N: "0|", W: "0|", T: "0|", O: "0|" });
  assert.deepEqual(db.rows("SELECT m, n, med, p, g, cb FROM snap WHERE k = 'X24'")[0], { m: 80000, n: 4, med: 95000, p: 0, g: "2026-10-14", cb: 0 }, "re-based to the new numbers");
  // the next collection with the same regroup day: ordinary comparison again — a real new low is news
  const r2 = await run(env, { ...data("2026-10-21", [[0, 100000, 1], [1, 120000, 1], [2, 70000, 1], [3, 90000, 1], [0, 50000, 2]]), meta: { ...regrouped.meta, updated: "2026-10-21" } }, "2026-10-21");
  assert.equal(r2.weekly, 2);
  assert.deepEqual(state(), { N: "0|", W: "1|", T: "1|", O: "0|" }, "watch (new low) and target (crossed 75,000) — not newmatch");
  clear();
  // a regroup that comes WITH a new collection, moving rows out (fewer branches, higher lowest): re-based, no news, no
  // held candidate either; the next collection is compared with these numbers
  const out = data("2026-10-28", [[0, 100000, 1], [1, 120000, 1], [0, 50000, 2]]);
  out.meta.recl = [["2026-10-14", ["X24"]], ["2026-10-28", ["X24", "X01"]]];
  const r3 = await run(env, out, "2026-10-28");
  assert.deepEqual([r3.weekly, r3.changed], [0, 0]);
  assert.deepEqual(db.rows("SELECT m, n, p, g, cb, cu FROM snap WHERE k = 'X24'")[0], { m: 100000, n: 2, p: 0, g: "2026-10-28", cb: 0, cu: null });
  assert.deepEqual(db.rows("SELECT g FROM snap WHERE k = 'X01'")[0], { g: "2026-10-28" });
  const r4 = await run(env, { ...out, meta: { ...out.meta, updated: "2026-11-04" }, rows: data("2026-11-04", [[0, 100000, 1], [1, 120000, 1], [2, 70000, 1], [0, 50000, 2]]).rows }, "2026-11-04");
  assert.equal(r4.weekly, 3, "after the regroup, a brand joining IS newmatch (and a new low, and target)");
  assert.deepEqual(state(), { N: "1|", W: "1|", T: "1|", O: "0|" });
  // what the Worker checks: g must be '' or a calendar day
  assert.equal(reclDate(regrouped, "X24"), "2026-10-14");
  assert.equal(reclDate(out, "X24"), "2026-10-28");
  assert.equal(reclDate(regrouped, "X01"), "");
  assert.equal(reclDate({ meta: {} }, "X01"), "");
});

test("a brand that vanishes for one collection (its scrape failed) and is back at the same prices: no news at all; a real new low: news once", T, async () => {
  const db = makeDb(), env = makeEnv(db);
  const { state, clear } = await phonesWith(env, db, {
    N: [{ kind: "newmatch", key: "X24" }], W: [{ kind: "watch", key: "X24" }], T: [{ kind: "target", key: "X24", max: 75000 }], TS: [{ kind: "target", key: "X24", max: 75000, region: "서울" }],
  });
  // 브랜드A: branches 0 (서울) and 2 (부산); 브랜드B: branches 1 (서울) and 3 (경기). Collection 1: all four
  const all = (updated) => data(updated, [[0, 80000, 1], [2, 90000, 1], [1, 120000, 1], [3, 150000, 1]]);
  await run(env, all("2026-10-12"), "2026-10-12");
  // collection 2: 브랜드A's scrape failed — weekly.py kept its last accepted file, clean.py dropped its (ended) rows: the brand
  // is gone from data.json → 2 branches, lowest 120,000, median 135,000. Held, not news
  const r2 = await run(env, data("2026-10-19", [[1, 120000, 1], [3, 150000, 1]]), "2026-10-19");
  assert.deepEqual([r2.weekly, r2.changed], [0, 0]);
  assert.deepEqual(db.rows("SELECT m, n, med, cb, cu FROM snap WHERE k = 'X24' AND r = ''")[0], { m: 80000, n: 4, med: 105000, cb: 7, cu: "2026-10-19" }, "baseline kept, the drop remembered");
  // collection 3: back at the same prices → the brand's return is NOT newmatch, NOT a new low, NOT a target crossing
  const r3 = await run(env, all("2026-10-26"), "2026-10-26");
  assert.deepEqual([r3.weekly, r3.changed], [0, 0]);
  assert.deepEqual(state(), { N: "0|", W: "0|", T: "0|", TS: "0|" });
  assert.deepEqual(db.rows("SELECT cb FROM snap WHERE k = 'X24' AND r = ''")[0], { cb: 0 });
  // a real new low (브랜드B drops to 70,000 in 서울): news, once
  const r4 = await run(env, data("2026-11-02", [[0, 80000, 1], [2, 90000, 1], [1, 70000, 1], [3, 150000, 1]]), "2026-11-02");
  assert.equal(r4.weekly, 3);
  assert.deepEqual(state(), { N: "0|", W: "1|", T: "1|", TS: "1|" });
  clear();
  assert.equal((await run(env, data("2026-11-09", [[0, 80000, 1], [2, 90000, 1], [1, 70000, 1], [3, 150000, 1]]), "2026-11-09")).weekly, 0, "once");
  // left (documented): the brand missing in TWO collections in a row is taken as gone — a watch rule hears of the median's
  // rise then (one collection late; watch is both directions) — and its return is newmatch/watch news
  assert.equal((await run(env, data("2026-11-16", [[1, 70000, 1], [3, 150000, 1]]), "2026-11-16")).weekly, 0, "first time: held");
  assert.equal((await run(env, data("2026-11-23", [[1, 70000, 1], [3, 150000, 1]]), "2026-11-23")).weekly, 1, "second time: taken, the median rose ≥ 5% → watch");
  assert.deepEqual(state(), { N: "0|", W: "1|", T: "0|", TS: "0|" });
  assert.deepEqual(db.rows("SELECT n, med FROM snap WHERE k = 'X24' AND r = ''")[0], { n: 2, med: 110000 });
  clear();
  assert.equal((await run(env, data("2026-11-30", [[0, 80000, 1], [2, 90000, 1], [1, 70000, 1], [3, 150000, 1]]), "2026-11-30")).weekly, 2, "newmatch, and watch (the median moves back)");
  assert.deepEqual(state(), { N: "1|", W: "1|", T: "0|", TS: "0|" });
});

test("data.json whose keys or regions the Worker would refuse: a ::warning, nothing sent (no finish: /health finished stalls, after 2 days stale:true makes the monitor warn)", T, async () => {
  const db = makeDb(), env = makeEnv(db);
  await phonesWith(env, db, { W: [{ kind: "watch", key: "X24" }] });
  const logs = [];
  const w = wire(env, undefined, "2026-10-12");
  const badKey = data("2026-10-12", [[0, 100000, 1]]);
  badKey.keys.push(["Z1", "g", "새 형식"]);
  const r = await notify({ data: badKey, today: "2026-10-12", url: URL_, secret: SECRET_VALUE, fetch: w.f, log: (l) => logs.push(l) });
  assert.equal(r.skipped, "shape");
  assert.equal(w.sent.length, 0, "the Worker was not called at all");
  assert.match(logs[0], /^::warning title=price alerts::app\/data\.json shape changed \(1 of 5 compare keys do not match KEY_RE\)/);
  assert.equal(/Z1|새 형식/.test(logs.join("\n")), false, "counts only");
  const badRegion = data("2026-10-12", [[0, 100000, 1]], [[2, 0, 0, 37, 127, 3]]);     // region = s[3] = 'X02'
  assert.equal((await notify({ data: badRegion, today: "2026-10-12", url: URL_, secret: SECRET_VALUE, fetch: w.f, log: (l) => logs.push(l) })).skipped, "shape");
  assert.match(logs[1], /1 of 5 branches have a region not in REGIONS/);
  const badRecl = data("2026-10-12", [[0, 100000, 1]]);
  badRecl.meta.recl = [["2026-13-45", ["X24"]]];
  assert.equal((await notify({ data: badRecl, today: "2026-10-12", url: URL_, secret: SECRET_VALUE, fetch: w.f, log: (l) => logs.push(l) })).skipped, "shape");
  assert.equal(w.sent.length, 0);
  assert.equal((await call(worker, env, "GET", "/health")).body.finished, null, "no finish went through");
  assert.deepEqual(shapeProblems(data("2026-10-12", [])), []);
  assert.deepEqual(shapeProblems(null), ["not a data.json"]);
  // and the real app/data.json passes (the same check rules.test.mjs makes)
  const real = JSON.parse(readFileSync(new URL("../../../app/data.json", import.meta.url), "utf8"));
  assert.deepEqual(shapeProblems(real), []);
  assert.ok(real.meta.recl.length >= 1 && reclDate(real, real.meta.recl[0][1][0]) === real.meta.recl[0][0]);
});

test("ALERTS_URL must be https (the first request carries the bearer token); http only for this machine", async () => {
  for (const u of ["http://yoonsiljang-alerts.lsy2825.workers.dev", "http://example.com/", "ftp://x", "yoonsiljang-alerts.lsy2825.workers.dev", ""])
    await assert.rejects(notify({ data: WEEK1, today: "2026-10-12", url: u, secret: SECRET_VALUE, fetch: async () => { throw new Error("must not be called"); }, log: () => {} }), /ALERTS_URL (must be https|is not a URL)/, u);
  for (const u of ["https://yoonsiljang-alerts.lsy2825.workers.dev", "http://127.0.0.1:8795", "http://localhost:8795/"]) assert.equal(checkUrl(u), undefined, u);
  const cli = fileURLToPath(new URL("../notify.mjs", import.meta.url));
  const plain = spawnSync(process.execPath, [cli, "/nonexistent/data.json"], { env: { PATH: process.env.PATH, ALERTS_URL: "http://yoonsiljang-alerts.lsy2825.workers.dev", ALERTS_SECRET: "x" }, encoding: "utf8" });
  assert.equal(plain.status, 0, "never fails the build");
  assert.match(plain.stdout, /^::warning title=price alerts::.*ALERTS_URL must be https/m);
});

test("a regroup entry that falls off meta.recl (build2/appdata.py keeps 12 days) re-bases nothing: the real price change of that collection is news once, g stays", T, async () => {
  const db = makeDb(), env = makeEnv(db);
  const { state, clear } = await phonesWith(env, db, {
    W: [{ kind: "watch", key: "X24" }], T: [{ kind: "target", key: "X24", max: 90000 }], N: [{ kind: "newmatch", key: "X24" }],
  });
  const regrouped = data("2026-10-14", [[0, 100000, 1], [1, 120000, 1]]);
  regrouped.meta.recl = [["2026-10-14", ["X24"]]];
  await run(env, regrouped, "2026-10-14");
  assert.deepEqual(db.rows("SELECT g, m FROM snap WHERE k = 'X24'")[0], { g: "2026-10-14", m: 100000 });
  // the next collection: the old regroup entry has dropped off the list (no entry holds X24 → g '') AND a real new low
  const later = data("2026-10-21", [[0, 80000, 1], [1, 120000, 1]]);
  later.meta.recl = [["2026-10-20", ["X01"]]];
  assert.equal(reclDate(later, "X24"), "");
  const r = await run(env, later, "2026-10-21");
  assert.equal(r.weekly, 2, "watch (new low) and target (crossed 90,000) — the change is not swallowed by a re-base");
  assert.deepEqual(state(), { W: "1|", T: "1|", N: "0|" });
  assert.deepEqual(db.rows("SELECT m, g FROM snap WHERE k = 'X24'")[0], { m: 80000, g: "2026-10-14" }, "the stored regroup day never goes back");
  clear();
  // the same data again: no second news; and a NEWER regroup day still re-bases silently
  assert.equal((await run(env, later, "2026-10-22")).weekly, 0);
  const regroup2 = data("2026-10-28", [[0, 60000, 1], [1, 120000, 1], [2, 70000, 1]]);
  regroup2.meta.recl = [["2026-10-28", ["X24"]]];
  const r2 = await run(env, regroup2, "2026-10-28");
  assert.deepEqual([r2.weekly, r2.changed], [0, 0], "a newer regroup day: silent re-base");
  assert.deepEqual(db.rows("SELECT m, n, g FROM snap WHERE k = 'X24'")[0], { m: 60000, n: 3, g: "2026-10-28" });
});

test("CLI: a data file that is not JSON is reported without echoing its content (a symlink to a secret file must not leak into the log)", () => {
  const cli = fileURLToPath(new URL("../notify.mjs", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "notify-cli-"));
  try {
    const file = join(dir, "data.json");
    writeFileSync(file, "ALERTS_SECRET=hunter2-super-secret\nPATH=/usr/bin\n");
    const r = spawnSync(process.execPath, [cli, file], { env: { PATH: process.env.PATH, ALERTS_URL: "https://alerts.example.workers.dev", ALERTS_SECRET: "hunter2-super-secret" }, encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^::warning title=price alerts::price alert check failed \(the data file is not readable JSON\) — the next alerts-catchup run \(every hour\) computes again$/m);
    assert.equal((r.stdout + r.stderr).includes("hunter2"), false, "neither the file's content nor the secret is printed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI: ALERTS_URL / ALERTS_SECRET — neither set is a ::notice, one without the other a ::warning; exit 0, no value printed", () => {
  const cli = fileURLToPath(new URL("../notify.mjs", import.meta.url));
  const run = (env) => spawnSync(process.execPath, [cli, "/nonexistent/data.json"], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  const none = run({});
  assert.equal(none.status, 0);
  assert.equal(none.stdout, "::notice title=price alerts::ALERTS_URL and ALERTS_SECRET are not set — price alerts skipped\n");
  // weekly.yml gives ALERTS_URL a default, so a missing repository secret is this warning — it says what to create, and where
  const noSecret = run({ ALERTS_URL: "https://alerts.example.workers.dev" });
  assert.equal(noSecret.status, 0);
  assert.match(noSecret.stdout, /^::warning title=price alerts::ALERTS_SECRET is not set \(ALERTS_URL is\) — price alerts skipped\. Create the repository secret ALERTS_SECRET \(Settings → Secrets and variables → Actions → New repository secret\), then run the cf-alerts workflow \(Run workflow, branch main\) so the Worker gets the same value: setup_keys the first time, sync_secret afterwards/);
  assert.equal(noSecret.stdout.split("\n").filter(Boolean).length, 1);
  assert.equal(noSecret.stdout.includes("alerts.example"), false, "the address is not printed");
  const noUrl = run({ ALERTS_SECRET: "hunter2-super-secret-value-0123456789" });
  assert.equal(noUrl.status, 0);
  assert.match(noUrl.stdout, /^::warning title=price alerts::ALERTS_URL is not set \(ALERTS_SECRET is\) — price alerts skipped\./);
  assert.equal((noUrl.stdout + noUrl.stderr).includes("hunter2"), false, "the secret is never printed");
  // the source: one notice and two warnings, all exit 0, none prints a value
  const src = readFileSync(new URL("../notify.mjs", import.meta.url), "utf8");
  const skips = src.split("\n").filter((l) => /process\.exit\(0\); \}$/.test(l) && /not set/.test(l));
  assert.equal(skips.length, 3);
  for (const l of skips) assert.equal(/\$\{/.test(l), false, `no value in: ${l.trim().slice(0, 60)}`);
});

// ---- the one-time key setup (cf-alerts.yml, Run workflow → setup_keys) and cf/alerts/vapid-keygen.mjs.
// The repository and its Actions logs are PUBLIC: these tests run the steps as written, with a fake wrangler and curl, and
// check that no secret value is ever printed, put in an argument or left in a file.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CF_ALERTS_YML = readFileSync(new URL("../../../.github/workflows/cf-alerts.yml", import.meta.url), "utf8");
const KEYGEN = fileURLToPath(new URL("../vapid-keygen.mjs", import.meta.url));
const KEY_STEPS = ["Key setup — check before storing anything", "Key setup — does the Worker already have a VAPID key?",
  "Key setup — store ALERTS_SECRET (through stdin)", "Key setup — make the VAPID key pair here, store the private key (through stdin)",
  "Key setup — the public key (for app/config.js pushPublicKey)", "Key setup — GET /health answers sending:true with this key"];
const stepsOf = (yml) => yml.split(/\n {6}- /).slice(1);
const stepNamed = (name) => { const st = stepsOf(CF_ALERTS_YML).find((s) => s.startsWith(`name: ${name}\n`)); assert.ok(st, `step ${name}`); return st; };
// the run script as the runner gets it: a block scalar without its 10-space indent, or the one-line value
function runOf(st) {
  const lines = st.split("\n");
  const i = lines.findIndex((l) => /^ {8}run: /.test(l));
  assert.ok(i > 0, "a run line");
  const head = lines[i].slice(13);
  if (head !== "|") return head.startsWith("'") ? head.slice(1, -1).replace(/''/g, "'") : head;
  const body = [];
  for (const l of lines.slice(i + 1)) { if (l.trim() && !l.startsWith("          ")) break; body.push(l.slice(10)); }
  return body.join("\n").replace(/\n+$/, "") + "\n";
}
const envNames = (st) => { const m = /\n {8}env:\n((?: {10}[^\n]*\n?)*)/.exec(st); return m ? m[1].split("\n").filter((l) => /^ {10}\w+:/.test(l)).map((l) => l.trim().split(":")[0]) : []; };
// a sandbox: a fake wrangler at $RUNNER_TEMP/wr/node_modules/.bin/wrangler (logs its arguments; `secret put NAME` keeps what
// came through stdin in $STORE/NAME; `secret list` prints $FAKE_LIST; exits $FAKE_RC), fake curl (prints $HEALTH_FILE for
// /health; FAKE_CURL=fail → exit 22) and sleep, a GitHub output and summary file
function keySandbox() {
  const dir = mkdtempSync(join(tmpdir(), "alerts-keys-"));
  const rt = join(dir, "rt"), bin = join(dir, "bin"), store = join(dir, "store"), wrbin = join(rt, "wr/node_modules/.bin");
  for (const d of [bin, store, wrbin]) mkdirSync(d, { recursive: true });
  writeFileSync(join(wrbin, "wrangler"), [
    "#!/usr/bin/env bash",
    'printf "%s\\n" "$*" >> "$WR_LOG"',
    'if [ "$1 $2" = "secret put" ]; then cat > "$STORE/$3"; echo "✨ Success! Uploaded secret $3"; fi',
    'if [ "$1 $2" = "secret list" ]; then printf "%s\\n" "${FAKE_LIST:-[]}"; fi',
    'exit "${FAKE_RC:-0}"',
  ].join("\n") + "\n", { mode: 0o755 });
  writeFileSync(join(bin, "curl"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$CURL_LOG"\n[ "${FAKE_CURL:-}" = fail ] && { echo "curl: (22) fake 503" >&2; exit 22; }\ncat "$HEALTH_FILE"\n', { mode: 0o755 });
  writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  const files = { WR_LOG: join(dir, "wr.log"), CURL_LOG: join(dir, "curl.log"), GITHUB_OUTPUT: join(dir, "output"), GITHUB_STEP_SUMMARY: join(dir, "summary"), HEALTH_FILE: join(dir, "health.json") };
  for (const f of Object.values(files)) writeFileSync(f, "");
  const run = (name, env = {}, cwd = ROOT) => {
    const r = spawnSync("bash", ["-e", "-c", runOf(stepNamed(name))], { cwd, encoding: "utf8",
      env: { PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`, HOME: dir, RUNNER_TEMP: rt, STORE: store, ...files, ...env } });
    return { status: r.status, stdout: r.stdout, all: r.stdout + r.stderr };
  };
  const read = (k) => readFileSync(files[k], "utf8");
  return { dir, rt, store, run, read, files, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("cf-alerts.yml key setup: Run workflow only (setup_keys / sync_secret), after the deploy steps, in a fixed order; replace_keys is a separate choice; only main deploys", () => {
  assert.match(CF_ALERTS_YML, /\n  workflow_dispatch:\n    inputs:\n      setup_keys:\n(?: {8}[^\n]*\n)*? {8}type: boolean\n {8}default: false\n      replace_keys:\n(?: {8}[^\n]*\n)*? {8}type: boolean\n {8}default: false\n      sync_secret:\n(?: {8}[^\n]*\n)*? {8}type: boolean\n {8}default: false\n/);
  const names = stepsOf(CF_ALERTS_YML).map((s) => (/^name: ([^\n]*)/.exec(s) || [])[1]).filter(Boolean);
  const deploy = names.indexOf("Deploy the Worker");
  assert.ok(deploy > 0);
  assert.deepEqual(names.slice(deploy + 1), ["replace_keys alone does nothing", ...KEY_STEPS, "ALERTS_SECRET sync — summary", "Key setup — say why in the summary (red run)"],
    "the key steps come after the deploy, in this order");
  // every key step runs only on Run workflow (setup_keys; the check and the ALERTS_SECRET put also for sync_secret, which
  // leaves the VAPID keys alone), and only when every step before it succeeded (no always(), no failure(), no
  // continue-on-error): a refusal stops everything after it
  const both = ["Key setup — check before storing anything", "Key setup — store ALERTS_SECRET (through stdin)"];
  for (const n of KEY_STEPS) {
    const st = stepNamed(n);
    if (both.includes(n)) assert.match(st, /\n {8}if: github\.event_name == 'workflow_dispatch' && \(inputs\.setup_keys \|\| inputs\.sync_secret\)\n/, n);
    else assert.match(st, /\n {8}if: github\.event_name == 'workflow_dispatch' && inputs\.setup_keys\n/, n);
    assert.equal(/always\(\)|failure\(\)|continue-on-error/.test(st), false, n);
  }
  assert.match(stepNamed("Key setup — say why in the summary (red run)"), /\n {8}if: failure\(\) && github\.event_name == 'workflow_dispatch' && \(inputs\.setup_keys \|\| inputs\.sync_secret\)\n/);
  // only main is deployed (and so only main can get keys): a Run workflow on another branch only tests
  const ready = runOf(stepNamed("Ready to deploy?"));
  assert.match(ready, /^if \[ "\$GITHUB_REF" != "refs\/heads\/main" \]; then\n[^\n]*echo "go=false" >> "\$GITHUB_OUTPUT"\n/);
});

test("cf-alerts.yml key setup: secrets reach the steps only through env, ALERTS_SECRET only the check and the stdin put; nothing turns on tracing", () => {
  const code = CF_ALERTS_YML.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  for (const st of stepsOf(code)) if (/\n {8}run: /.test(st)) assert.equal(runOf(st).includes("${{"), false, `no expression inside a run script: ${st.split("\n")[0]}`);
  assert.deepEqual(code.match(/^ {10}ALERTS_SECRET: \$\{\{ secrets\.ALERTS_SECRET \}\}$/gm).length, 2);
  assert.equal((code.match(/secrets\.ALERTS_SECRET\b/g) || []).length, 2, "the check and the put step only");
  assert.ok(envNames(stepNamed("Key setup — check before storing anything")).includes("ALERTS_SECRET"));
  assert.ok(envNames(stepNamed("Key setup — store ALERTS_SECRET (through stdin)")).includes("ALERTS_SECRET"));
  assert.equal(/set -x|set -o xtrace|xtrace|ACTIONS_STEP_DEBUG|ACTIONS_RUNNER_DEBUG|WRANGLER_LOG|NODE_DEBUG|\btee\b/.test(code), false, "nothing that echoes commands or logs requests");
  // $ALERTS_SECRET: tested in the check step, piped by printf (a shell builtin: no process argument) in the put step — never echoed
  const check = runOf(stepNamed("Key setup — check before storing anything"));
  const put = runOf(stepNamed("Key setup — store ALERTS_SECRET (through stdin)"));
  assert.deepEqual(check.match(/[^\n]*\$\{?ALERTS_SECRET[^\n]*/g).map((l) => l.trim()), ['if [ -z "$ALERTS_SECRET" ]; then', "if ! [[ $ALERTS_SECRET =~ ^[[:graph:]]{32,}$ ]]; then"]);
  assert.equal(put, `set -euo pipefail\nprintf '%s' "$ALERTS_SECRET" | "$RUNNER_TEMP/wr/node_modules/.bin/wrangler" secret put ALERTS_SECRET --config cf/alerts/wrangler.jsonc\n`);
  // the private key never has a name in the workflow: it is made and handed over inside cf/alerts/vapid-keygen.mjs
  const keygen = stepNamed("Key setup — make the VAPID key pair here, store the private key (through stdin)");
  assert.equal(runOf(keygen), 'node cf/alerts/vapid-keygen.mjs --put "$RUNNER_TEMP/wr/node_modules/.bin/wrangler" cf/alerts/wrangler.jsonc "$RUNNER_TEMP/vapid-public-key"');
  assert.deepEqual(envNames(keygen), ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "WRANGLER_SEND_METRICS"]);
  assert.equal(/JWK|PRIVATE/.test(code.replace(/VAPID_PRIVATE_JWK/g, "")), false, "no variable or env holds the private key");
  // the public key and /health steps get no secret but the alerts address
  assert.equal(/secrets\./.test(stepNamed("Key setup — the public key (for app/config.js pushPublicKey)")), false);
  assert.deepEqual(stepNamed("Key setup — GET /health answers sending:true with this key").match(/secrets\.\w+/g), ["secrets.ALERTS_URL"]);
  // vapid-keygen.mjs --put: the masks go out first, the JWK only through stdin, only the public key goes to a file
  const src = readFileSync(KEYGEN, "utf8");
  const put2 = src.slice(src.indexOf('if (args[0] === "--put")'), src.indexOf("} else if (args.length)"));
  assert.ok(put2.indexOf('if (process.env.GITHUB_ACTIONS === "true") writeSync(1, `::add-mask::${jwk}\\n::add-mask::${d}\\n`)') > 0, "::add-mask:: for the JWK and its d (on Actions)");
  assert.ok(put2.indexOf("::add-mask::") < put2.indexOf("spawnSync("), "masked before wrangler starts");
  assert.match(put2, /spawnSync\(wrangler, \["secret", "put", "VAPID_PRIVATE_JWK", "--config", config\], \{ input: jwk, /);
  assert.equal(/console\.(log|error)\([^)]*\b(jwk|d)\b/.test(put2), false, "the JWK and d are never logged");
  assert.deepEqual(put2.match(/writeFileSync\([^)]*\)/g), ["writeFileSync(pubFile, `${pub}\\n`)"], "only the public key is written to a file");
});

test("cf-alerts.yml key setup, check step (run as written): refuses without a deploy, without ALERTS_SECRET (saying what to create, and where), with a malformed one or a set VAPID_PUBLIC_KEY", () => {
  const sb = keySandbox();
  try {
    const cwd = join(sb.dir, "repo");
    mkdirSync(join(cwd, "cf/alerts"), { recursive: true });
    const cfg = readFileSync(join(ROOT, "cf/alerts/wrangler.jsonc"), "utf8");
    assert.match(cfg, /"VAPID_PUBLIC_KEY": ""/, "the repository's wrangler.jsonc leaves VAPID_PUBLIC_KEY empty");
    writeFileSync(join(cwd, "cf/alerts/wrangler.jsonc"), cfg);
    const GOOD = "Qx7-pL2_vR9+zT4/wK8=mN3#bJ6@cH1!fG5~";       // 36 printable characters, no space
    const check = (env) => sb.run("Key setup — check before storing anything", { LC_ALL: "C", GO: "true", ALERTS_SECRET: GOOD, SETUP: "true", ...env }, cwd);
    let r = check({});
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, /key setup: checks passed/);
    r = check({ GO: "false" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^::error title=cf-alerts key setup::이번 실행에서 Worker를 배포하지 않아서 키를 넣지 않았어요/m);
    r = check({ ALERTS_SECRET: "" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^::error title=cf-alerts key setup::저장소 비밀값 ALERTS_SECRET이 없어요\. Settings → Secrets and variables → Actions → New repository secret에서 이름은 ALERTS_SECRET/m);
    assert.match(sb.read("GITHUB_STEP_SUMMARY"), /ALERTS_SECRET이 없어요/, "the reason is in the run's summary too");
    for (const bad of ["short-secret", "with a space but long enough to pass 32", `${GOOD}\nsecond-line`, `${GOOD}é`]) {
      r = check({ ALERTS_SECRET: bad });
      assert.equal(r.status, 1, JSON.stringify(bad));
      assert.match(r.stdout, /ALERTS_SECRET이 32자보다 짧거나/);
      assert.equal(r.all.includes(bad.split("\n")[0]), false, "the value is never printed");
    }
    writeFileSync(join(cwd, "cf/alerts/wrangler.jsonc"), cfg.replace('"VAPID_PUBLIC_KEY": ""', '"VAPID_PUBLIC_KEY": "BOld"'));
    r = check({});
    assert.equal(r.status, 1);
    assert.match(r.stdout, /VAPID_PUBLIC_KEY가 비어 있지 않아요/);
    // sync_secret alone (SETUP false) makes no key, so a filled VAPID_PUBLIC_KEY does not stop it; ALERTS_SECRET is checked the same
    assert.equal(check({ SETUP: "false" }).status, 0);
    assert.match(check({ SETUP: "false", ALERTS_SECRET: "short" }).stdout, /ALERTS_SECRET이 32자보다 짧거나/);
    assert.equal(sb.read("WR_LOG"), "", "the check step calls no wrangler");
    assert.equal(sb.read("GITHUB_STEP_SUMMARY").includes(GOOD), false);
  } finally { sb.done(); }
});

test("cf-alerts.yml key setup, 'already has a VAPID key?' step (run as written): refuses when VAPID_PRIVATE_JWK exists unless replace_keys; an unreadable list stops the run", () => {
  const sb = keySandbox();
  try {
    const list = (names) => JSON.stringify(names.map((name) => ({ name, type: "secret_text" })), null, "  ");
    const step = (env) => sb.run("Key setup — does the Worker already have a VAPID key?", { REPLACE: "false", ...env });
    let r = step({ FAKE_LIST: list(["ALERTS_SECRET"]) });
    assert.equal(r.status, 0, r.all);
    assert.equal(sb.read("WR_LOG"), "secret list --format json --config cf/alerts/wrangler.jsonc\n");
    assert.equal(step({ FAKE_LIST: "[]" }).status, 0);
    // a line before the list that starts with '[' (a warning) does not confuse it
    assert.equal(step({ FAKE_LIST: `[WARNING] something\n${list(["X"])}` }).status, 0);
    r = step({ FAKE_LIST: list(["ALERTS_SECRET", "VAPID_PRIVATE_JWK"]) });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^::error title=cf-alerts key setup::이 Worker에는 이미 VAPID_PRIVATE_JWK가 있어요[^\n]*ALERTS_SECRET만 바꾸려면 setup_keys 대신 sync_secret만 고르세요/m);
    r = step({ FAKE_LIST: list(["VAPID_PRIVATE_JWK"]), REPLACE: "true" });
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, /^::warning title=cf-alerts key setup::replace_keys: the VAPID key pair is replaced/m);
    // never "no key" by mistake: wrangler failing, or output that is not the list, fails the step (nothing stored after it)
    assert.notEqual(step({ FAKE_RC: "1" }).status, 0);
    r = step({ FAKE_LIST: "Authentication error" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /could not read the secret names from wrangler secret list — nothing stored/);
    assert.deepEqual(readdirSync(sb.store), [], "this step stores nothing");
  } finally { sb.done(); }
});

test("cf-alerts.yml key setup, put + key pair + public key + /health (run as written, fake wrangler and curl): secrets only through stdin, masks first, only the public key printed, /health must show that key", async () => {
  const { publicKeyOf } = await import("../src/push.js");
  const sb = keySandbox();
  try {
    const FAKE_ALERTS_VALUE = "Zt5-hunter2_super+secret/value=0123456789";
    // 1. ALERTS_SECRET: through stdin, exactly (no newline added), never in an argument or the log
    let r = sb.run("Key setup — store ALERTS_SECRET (through stdin)", { ALERTS_SECRET: FAKE_ALERTS_VALUE, CLOUDFLARE_API_TOKEN: "tok" });
    assert.equal(r.status, 0, r.all);
    assert.equal(readFileSync(join(sb.store, "ALERTS_SECRET"), "utf8"), FAKE_ALERTS_VALUE);
    assert.equal(sb.read("WR_LOG"), "secret put ALERTS_SECRET --config cf/alerts/wrangler.jsonc\n");
    assert.equal(r.all.includes("hunter2"), false);
    // 2. the key pair: made here, ::add-mask:: for the JWK and d before anything else, the JWK only through wrangler's stdin
    r = sb.run("Key setup — make the VAPID key pair here, store the private key (through stdin)", { CLOUDFLARE_API_TOKEN: "tok", GITHUB_ACTIONS: "true" });
    assert.equal(r.status, 0, r.all);
    const jwkText = readFileSync(join(sb.store, "VAPID_PRIVATE_JWK"), "utf8");
    const jwk = JSON.parse(jwkText);
    assert.deepEqual(Object.keys(jwk), ["kty", "crv", "x", "y", "d"]);
    assert.equal(jwk.kty + jwk.crv, "ECP-256");
    const lines = r.stdout.split("\n");
    assert.deepEqual(lines.slice(0, 2), [`::add-mask::${jwkText}`, `::add-mask::${jwk.d}`], "the masks are the first output, before wrangler starts");
    const rest = [lines.slice(2).join("\n"), r.all.slice(r.stdout.length)].join("\n");
    assert.equal(rest.includes(jwk.d), false, "the private key is never printed (only inside the two mask commands)");
    assert.match(rest, /✨ Success! Uploaded secret VAPID_PRIVATE_JWK/);
    assert.equal(sb.read("WR_LOG").split("\n")[1], "secret put VAPID_PRIVATE_JWK --config cf/alerts/wrangler.jsonc", "no key in wrangler's arguments");
    const pub = readFileSync(join(sb.rt, "vapid-public-key"), "utf8").trim();
    assert.match(pub, /^[A-Za-z0-9_-]{87}$/);
    assert.equal(pub, publicKeyOf(jwkText), "the public key written out is the one the Worker derives from the stored JWK");
    // the keygen left no file holding the private key ($STORE is the fake Cloudflare)
    const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
    for (const f of files(sb.dir).filter((f) => !f.startsWith(sb.store + "/"))) assert.equal(readFileSync(f, "utf8").includes(jwk.d), false, `${f} holds the private key`);
    // 3. the public key: to GITHUB_OUTPUT, a ::notice and the summary — and nothing else
    r = sb.run("Key setup — the public key (for app/config.js pushPublicKey)");
    assert.equal(r.status, 0, r.all);
    assert.equal(r.stdout, `::notice title=VAPID public key (app/config.js pushPublicKey)::${pub}\n`);
    assert.equal(sb.read("GITHUB_OUTPUT"), `key=${pub}\n`);
    const summary = sb.read("GITHUB_STEP_SUMMARY");
    assert.ok(summary.includes(pub));
    for (const v of [jwk.d, FAKE_ALERTS_VALUE]) assert.equal(summary.includes(v), false);
    // 4. GET /health: sending:true with that same key passes; anything else fails the run (after a few tries)
    const health = (o) => writeFileSync(sb.files.HEALTH_FILE, JSON.stringify({ ok: true, window: "08-21 KST", sending: true, key: publicKeyOf(jwkText), ...o }));
    const check = (env = {}) => sb.run("Key setup — GET /health answers sending:true with this key", { ALERTS_URL: "https://alerts.example.test/", PUB: pub, LC_ALL: "C", ...env });
    health({});
    r = check();
    assert.equal(r.status, 0, r.all);
    assert.match(r.stdout, /key setup: GET \/health: sending true, the same public key/);
    assert.match(sb.read("CURL_LOG"), /--fail --proto =https --max-redirs 0 --max-time 20 --max-filesize 100000 https:\/\/alerts\.example\.test\/health\n/);
    for (const [o, why] of [[{ sending: false, key: null }, /sending is not true/], [{ key: "B".repeat(87) }, /a different public key/], [{ ok: false }, /is not ok/]]) {
      health(o);
      r = check();
      assert.equal(r.status, 1, JSON.stringify(o));
      assert.match(r.stdout, new RegExp(`::error title=cf-alerts key setup::the keys were stored, but GET /health [^\n]*${why.source}`));
    }
    health({});
    assert.equal(check({ FAKE_CURL: "fail" }).status, 1);
    r = check({ ALERTS_URL: "http://alerts.example.test" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ALERTS_URL is not an https address/);
    assert.equal(r.all.includes(FAKE_ALERTS_VALUE) || r.all.includes(jwk.d), false);
  } finally { sb.done(); }
});

test("cf-alerts.yml: tests run in a job with no secret; only the deploy job (needs: test, main only) names the GitHub Environment 'cloudflare' and gets the token; a set D1 id without the token is red", () => {
  const code = CF_ALERTS_YML.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const jobs = code.slice(code.indexOf("\njobs:\n")).split(/\n  (?=[a-z_]+:\n)/).slice(1);
  assert.deepEqual(jobs.map((j) => j.split(":")[0]), ["test", "deploy"]);
  const [testJob, deployJob] = jobs;
  assert.equal(/secrets\.|environment:/.test(testJob), false, "the test job gets no secret and names no Environment");
  assert.match(testJob, /node --test cf\/alerts\/test\/\*\.test\.mjs/);
  assert.match(deployJob, /^deploy:\n    needs: test\n    if: github\.ref == 'refs\/heads\/main'\n(?: {4}[^\n]*\n)*? {4}environment: cloudflare\n/);
  assert.equal((code.match(/CLOUDFLARE_API_TOKEN/g) || []).length, (deployJob.match(/CLOUDFLARE_API_TOKEN/g) || []).length, "every use of the token is in the deploy job");
  const ready = runOf(stepNamed("Ready to deploy?"));
  assert.match(ready, /elif \[ "\$HAS_TOKEN" != "true" \] \|\| \[ "\$HAS_ACCOUNT" != "true" \]; then\n(?:[^\n]*\n)*?\s*echo "::error title=cf-alerts::[^\n]*environment: cloudflare[^\n]*"\n\s*echo "go=false" >> "\$GITHUB_OUTPUT"\n\s*exit 1\n/);
  // run as written: the repository's id (set 2026-10-16), no token → ::error, exit 1; a placeholder id put back → notice (green)
  const sb = keySandbox();
  try {
    const cwd = join(sb.dir, "repo");
    mkdirSync(join(cwd, "cf/alerts"), { recursive: true });
    const cfg = readFileSync(join(ROOT, "cf/alerts/wrangler.jsonc"), "utf8");
    assert.match(cfg, /\n {6}"database_id": "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",\n/, "the D1 database id is set (a UUID, not secret)");
    assert.equal(cfg.includes('"REPLACE_WITH_D1_ID"'), false);
    const go = (env) => sb.run("Ready to deploy?", { GITHUB_REF: "refs/heads/main", HAS_TOKEN: "true", HAS_ACCOUNT: "true", ...env }, cwd);
    writeFileSync(join(cwd, "cf/alerts/wrangler.jsonc"), cfg.replace(/"database_id": "[^"]*"/, '"database_id": "REPLACE_WITH_D1_ID"'));
    let r = go({ HAS_TOKEN: "false" });
    assert.equal(r.status, 0, "a placeholder id comes first: a notice");
    assert.match(r.stdout, /D1 database id not set/);
    writeFileSync(join(cwd, "cf/alerts/wrangler.jsonc"), cfg);
    r = go({ HAS_TOKEN: "false" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^::error title=cf-alerts::CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not available to this job/m);
    assert.equal(go({}).status, 0);
    assert.match(sb.read("GITHUB_OUTPUT"), /go=true\n$/);
  } finally { sb.done(); }
});

test("cf-alerts.yml: a key run on another branch is red (nothing stored); sync_secret alone says what to check next; any red key run leaves a Korean line in the summary", () => {
  const sb = keySandbox();
  try {
    let r = sb.run("Only main deploys", { KEYS: "true", GITHUB_REF: "refs/heads/x" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^::error title=cf-alerts key setup::키 설정\(setup_keys\)과 ALERTS_SECRET 넣기\(sync_secret\)는 main 브랜치에서만 해요/m);
    assert.match(sb.read("GITHUB_STEP_SUMMARY"), /main 브랜치에서만 해요/);
    r = sb.run("Only main deploys", { KEYS: "false", GITHUB_REF: "refs/heads/x" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /tested, not deployed/);
    r = sb.run("ALERTS_SECRET sync — summary");
    assert.equal(r.status, 0);
    assert.match(sb.read("GITHUB_STEP_SUMMARY"), /ALERTS_SECRET: Worker에 다시 넣었어요[\s\S]*price_alerts에 401 경고가 없으면 끝/);
    r = sb.run("Key setup — say why in the summary (red run)");
    assert.equal(r.status, 0);
    assert.match(sb.read("GITHUB_STEP_SUMMARY"), /알림 키 설정: 실패[\s\S]*Annotations[\s\S]*replace_keys로 다시 돌리지 않아요/);
    assert.equal(sb.read("WR_LOG"), "", "none of them calls wrangler");
    assert.equal(/secrets\./.test(stepNamed("ALERTS_SECRET sync — summary") + stepNamed("Key setup — say why in the summary (red run)") + stepNamed("Only main deploys")), false);
  } finally { sb.done(); }
});

test("vapid-keygen.mjs: a failed wrangler drops the key (exit 1, no public key file, nothing printed but the masks); without --put it refuses to print keys on GitHub Actions", () => {
  const sb = keySandbox();
  try {
    const r = sb.run("Key setup — make the VAPID key pair here, store the private key (through stdin)", { FAKE_RC: "1", GITHUB_ACTIONS: "true" });
    assert.equal(r.status, 1);
    assert.equal(existsSync(join(sb.rt, "vapid-public-key")), false);
    const jwkText = readFileSync(join(sb.store, "VAPID_PRIVATE_JWK"), "utf8");
    const { d } = JSON.parse(jwkText);
    const lines = r.stdout.split("\n");
    assert.deepEqual(lines.slice(0, 2), [`::add-mask::${jwkText}`, `::add-mask::${d}`]);
    assert.equal([lines.slice(2).join("\n"), r.all.slice(r.stdout.length)].join("\n").includes(d), false);
    assert.match(r.all, /wrangler secret put VAPID_PRIVATE_JWK failed \(exit 1\) — the new key was dropped/);
    // the plain mode prints the private key, so it never runs on Actions (public logs)
    const plain = spawnSync(process.execPath, [KEYGEN], { env: { PATH: process.env.PATH, GITHUB_ACTIONS: "true" }, encoding: "utf8" });
    assert.equal(plain.status, 1);
    assert.equal(plain.stdout, "");
    assert.match(plain.stderr, /the logs of this repository are public — on GitHub Actions use --put/);
    // --put off Actions (someone's own computer): no mask lines, so nothing at all shows the private key
    const local = sb.run("Key setup — make the VAPID key pair here, store the private key (through stdin)", { FAKE_RC: "0" });
    assert.equal(local.status, 0, local.all);
    const localD = JSON.parse(readFileSync(join(sb.store, "VAPID_PRIVATE_JWK"), "utf8")).d;
    assert.equal(local.all.includes(localD), false);
    assert.equal(local.all.includes("::add-mask::"), false);
    const bad = spawnSync(process.execPath, [KEYGEN, "--put", "x"], { env: { PATH: process.env.PATH }, encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, "");
  } finally { sb.done(); }
});

test("review finding (D1 write limit) + 5th/6th review: made-up keys cost no D1 writes and take no place in the list — planted before the first key set, watched by more phones than the real pairs; a real phone that never took a push is computed the same day; afterwards a made-up key is stored, answered {id} as 약속 1 says (7th review), and still takes no place", T, async () => {
  const db = makeDb(), env = makeEnv(db, { PAIR_CAP: "4" });
  // 2 × 4 phones × 20 rules on keys of the right shape that data.json does not have (one POST each, no browser), before
  // the factory ever stored a key set (accepted as before): each made-up pair is watched by 2 phones
  for (let rep = 0; rep < 2; rep++) for (let p = 0; p < 4; p++) {
    const res = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: Array.from({ length: 20 }, (_, i) => ({ kind: "target", key: `T${String(p * 20 + i).padStart(7, "0")}`, max: 1 })) });
    assert.equal(res.status, 201);
  }
  // a real phone that never took a push (each of its pairs watched by 1 phone)
  const real = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: [{ kind: "watch", key: "X24" }, { kind: "watch", key: "X01" }] });
  assert.equal(real.status, 201);
  const logs = [];
  const r = await run(env, WEEK1, "2026-10-12", { log: (l) => logs.push(l) });
  assert.equal(r.pairs, 2, "X24 and X01 (in data.json) are digested");
  assert.deepEqual(db.rows("SELECT k FROM snap ORDER BY k").map((x) => x.k), ["X01", "X24"], "D1 holds rows for the real pairs only");
  assert.deepEqual(logs, [logs.find((l) => l.startsWith("price alerts: 2 watched pairs (0 skipped, "))], "the list was not cut: no ::warning, nothing skipped");
  assert.equal((await call(worker, env, "GET", "/health", undefined, { now: Date.parse("2026-10-12T09:30:00+09:00") })).body.pairs, "ok");
  // the key set is stored now: a rule naming a made-up key is stored all the same (6th review: B's app treats any non-2xx
  // as a failure, so nothing is refused) and answered {id} like any other (7th review: 약속 1 word for word); its pair is
  // never ranked, the real one is computed the next day
  const mixed = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: [{ kind: "watch", key: "X02" }, { kind: "watch", key: "T0000099" }] });
  assert.deepEqual([mixed.status, Object.keys(mixed.body)], [201, ["id"]]);
  const plain = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: [{ kind: "watch", key: "X02" }] });
  assert.deepEqual([plain.status, Object.keys(plain.body)], [201, ["id"]]);
  assert.equal((await run(env, WEEK1, "2026-10-13")).pairs, 3);
  assert.deepEqual(db.rows("SELECT k FROM snap ORDER BY k").map((x) => x.k), ["X01", "X02", "X24"], "the made-up pair never reaches D1");
});

test("review finding (D1 budget): a pair new to the Worker waits for a row the finish frees when its table is at PAIR_CAP — the day's run says so (::warning, /health pairs: capped), the next day computes it", T, async () => {
  const db = makeDb(), env = makeEnv(db, { PAIR_CAP: "1" });
  const res = await call(worker, env, "POST", "/v1/push/subscribe", { subscription: subscription(), rules: [{ kind: "watch", key: "X24" }] });
  assert.equal(res.status, 201);
  await run(env, WEEK1, "2026-10-12");
  assert.deepEqual(db.rows("SELECT k FROM snap").map((x) => x.k), ["X24"]);
  // the phone moves to X01: the list (one pair) is not cut, but the table still holds X24 until today's finish prunes it
  assert.equal((await call(worker, env, "PUT", `/v1/push/rules/${res.body.id}`, { rules: [{ kind: "watch", key: "X01" }] })).status, 200);
  const logs = [];
  await run(env, WEEK1, "2026-10-13", { log: (l) => logs.push(l) });
  assert.match(logs[0], /^::warning title=price alerts::new pairs wait for a free row under the Worker's PAIR_CAP/);
  assert.deepEqual(db.rows("SELECT k FROM snap").map((x) => x.k), [], "X24 pruned, X01 not added the same day");
  assert.equal((await call(worker, env, "GET", "/health", undefined, { now: Date.parse("2026-10-13T09:30:00+09:00") })).body.pairs, "capped");
  const next = [];
  await run(env, WEEK1, "2026-10-14", { log: (l) => next.push(l) });
  assert.deepEqual(db.rows("SELECT k FROM snap").map((x) => x.k), ["X01"], "the freed row takes it the next day");
  assert.equal(next.some((l) => l.startsWith("::warning")), false);
});

// ---- 6th → 9th review (D1 budget): weekly.yml runs on every push to main (26–29 runs a day were counted on 2026-10-15/16),
// and alerts-catchup.yml every hour. Every run starts with the fingerprint: prices already finished today stop there; at
// most COMPUTES_PER_DAY computations a D1 day. D1 rows written are counted with sqlite's total_changes() (row changes, not
// index entries — the local workerd D1 measurement is in src/worker.js).
const changes = (db) => db.raw.prepare("SELECT total_changes() AS c").get().c;

// 9th review (alerts within 2 hours of new prices, a user decision of 2026-10-16): every run that deployed data, and the
// hourly catch-up, starts with POST /v1/internal/start {fp}. The fingerprint is of the numbers a digest can be computed
// from, so a rebuild that changes no price is 'done' — one request, nothing written — while changed prices are computed at
// once, whatever started the run.
test("9th review (start): the same prices → done (one request, nothing written) — also a rebuild with other bytes, row order, names or timestamps; changed prices → computed at once; the next KST day → computed; before 06:00 KST an earlier day's finish of the same prices is enough", T, async () => {
  const db = makeDb(), env = makeEnv(db);
  const { phones } = await phonesWith(env, db, { A: [{ kind: "watch", key: "X01" }], D: [{ kind: "expiring", key: "X24", region: "서울" }] });
  await run(env, WEEK1, "2026-10-12");
  const first = await run(env, WEEK2, "2026-10-19");
  assert.deepEqual([first.go, first.weekly, first.expiring], ["compute", 1, 1]);
  assert.deepEqual(db.rows("SELECT k, n FROM stat WHERE k IN ('finish', 'data') ORDER BY k"), [{ k: "data", n: parseInt(fingerprint(WEEK2).slice(0, 13), 16) }, { k: "finish", n: 20261019 }]);
  assert.deepEqual(db.rows("SELECT count(*) AS c FROM stat WHERE k = 'lease'"), [{ c: 0 }], "the finish freed the lease");
  // a rebuild that changes no number: other row order, another name and condition text, a new build time — done
  const rebuilt = structuredClone(WEEK2);
  rebuilt.rows.reverse();
  rebuilt.meta.built = "2026-10-19T09:00:00Z";
  rebuilt.keys = rebuilt.keys.map(([id, g, l]) => [id, g, l + " (새 이름)"]);
  for (const d of [WEEK2, rebuilt]) {
    const w = wire(env, undefined, "2026-10-19");
    const c = changes(db), logs = [];
    const again = await notify({ data: d, today: "2026-10-19", url: URL_, secret: SECRET_VALUE, fetch: w.f, log: (l) => logs.push(l), waitMs: 0 });
    assert.deepEqual(again, { go: "done" });
    assert.deepEqual(w.sent.map((x) => new URL(x.url).pathname), ["/v1/internal/start"], "one request");
    assert.deepEqual(JSON.parse(w.sent[0].body), { fp: fingerprint(WEEK2) });
    assert.equal(changes(db) - c, 0, "nothing written: no key set, no pair, no finish, no lease");
    assert.deepEqual(logs, ["price alerts: these prices were already computed (same fingerprint) — nothing to do"]);
  }
  // another price the same day (a price re-check rebuilt it): computed at once — its fingerprint is the one now noted
  const fixed = data("2026-10-19", [[0, 90000, 1, 6], [1, 120000, 1, 7], [2, 110000, 1, 8], [0, 50000, 2], [1, 30000, 2], [0, 200000, 3], [2, 210000, 3]]);
  const other = await run(env, fixed, "2026-10-19");
  assert.equal(other.go, "compute");
  assert.ok(other.pairs > 0);
  assert.equal(db.rows("SELECT n FROM stat WHERE k = 'data'")[0].n, parseInt(fingerprint(fixed).slice(0, 13), 16));
  // the next KST day from 06:00, the same data: computed again (ending prices count days), D's ending price still pending
  const next = wire(env, undefined, "2026-10-20");
  const r3 = await notify({ data: fixed, today: "2026-10-20", url: URL_, secret: SECRET_VALUE, fetch: next.f, log: () => {}, waitMs: 0 });
  assert.equal(r3.go, "compute");
  assert.equal(db.rows("SELECT pend_x FROM subs WHERE id = ?", phones.D.id)[0].pend_x, "2026-10-21");
  // the night after (00:00–06:00 KST): the same prices are done though the last finish was yesterday (the 06:00 run computes
  // the day); changed prices are computed at night all the same
  const night = (d) => {
    const sent = [];
    const f = async (url, init) => { sent.push(new URL(url).pathname); return worker.fetch(new Request(url, init), env, { waitUntil() {} }, Date.parse("2026-10-21T03:00:00+09:00")); };
    return notify({ data: d, today: "2026-10-21", url: URL_, secret: SECRET_VALUE, fetch: f, log: () => {}, waitMs: 0 }).then((r) => ({ r, sent }));
  };
  const quiet = await night(fixed);
  assert.deepEqual([quiet.r, quiet.sent], [{ go: "done" }, ["/v1/internal/start"]]);
  const changed = await night(data("2026-10-19", [[0, 90000, 1, 6], [1, 120000, 1, 7], [2, 100000, 1, 8], [0, 50000, 2], [1, 30000, 2], [0, 200000, 3], [2, 210000, 3]]));
  assert.equal(changed.r.go, "compute");
  assert.deepEqual(changed.sent.slice(0, 2), ["/v1/internal/start", "/v1/internal/keys"]);
});

test("9th review (fingerprint): the same for every rebuild that changes no number; different for each change a digest could see — a listed price, a branch's region, a key's rows, an end date, a review flag, the collection date, a regroup day, the key set", () => {
  const base = fingerprint(WEEK2);
  assert.match(base, /^[0-9a-f]{64}$/);
  const same = [
    (d) => { d.rows.reverse(); },                                                // row order
    (d) => { d.meta.built = "x"; d.trend = { dates: ["2026-10-01"], k: {} }; },  // timestamps, trend
    (d) => { d.keys = d.keys.map(([id, g, l]) => [id, g, `${l}!`]); },           // names
  ];
  for (const [i, f] of same.entries()) {
    const d = structuredClone(WEEK2);
    f(d);
    assert.equal(fingerprint(d), base, `rebuild ${i}`);
  }
  // a dearer row at a branch that has a cheaper one moves no lowest price, but it is a row the ending-price numbers (e, s,
  // u) read on some day: a new fingerprint — one computation more, never a change missed
  const dearer = structuredClone(WEEK2);
  dearer.rows.push([1, 0, 0, 125000, 0, 0, 0, 1, 0, 0, 7, 0, 1, 0]);
  assert.notEqual(fingerprint(dearer), base);
  const changed = {
    price: (d) => { d.rows[0][3] = 91000; },
    region: (d) => { d.branches[2][5] = 11; },
    keyRows: (d) => { d.rows[4][7] = 3; },                                        // an X01 row now classified X02
    until: (d) => { d.rows[0][10] = 10; },
    review: (d) => { d.rows[3][13] = 0; },
    updated: (d) => { d.meta.updated = "2026-10-20"; },
    recl: (d) => { d.meta.recl = [["2026-10-19", ["X24"]]]; },
    keySet: (d) => { d.keys = d.keys.slice(0, 3); },
  };
  const seen = new Set([base]);
  for (const [name, f] of Object.entries(changed)) {
    const d = structuredClone(WEEK2);
    f(d);
    const fp = fingerprint(d);
    assert.ok(!seen.has(fp), name);
    seen.add(fp);
  }
  // the real data.json: a fingerprint in well under a second (the factory runs it on every deploy and every catch-up)
  const real = JSON.parse(readFileSync(new URL("../../../app/data.json", import.meta.url), "utf8"));
  const t = Date.now();
  assert.match(fingerprint(real), /^[0-9a-f]{64}$/);
  assert.ok(Date.now() - t < 5000, `fingerprint of app/data.json took ${Date.now() - t} ms`);
});

test("9th review (CLI): start first — done calls nothing more; deferred writes deferred=true to $GITHUB_OUTPUT (the alert job's Telegram line); ALERTS_MODE is not read any more", T, async () => {
  const db = makeDb(), env = makeEnv(db, { COMPUTES_PER_DAY: "1" });
  await phonesWith(env, db, { A: [{ kind: "watch", key: "X24" }] });
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    seen.push(req.url);
    const r = await worker.fetch(new Request(`https://alerts.local${req.url}`, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : Buffer.concat(chunks) }), env, { waitUntil() {} });
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(await r.text());
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const cli = fileURLToPath(new URL("../notify.mjs", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "notify-cli9-"));
  const out = join(dir, "github-output");
  const runCli = (file, extra = {}) => new Promise((ok) => {
    writeFileSync(out, "");
    const child = spawn(process.execPath, [cli, file], { env: { PATH: process.env.PATH, ALERTS_URL: `http://127.0.0.1:${server.address().port}`, ALERTS_SECRET: SECRET_VALUE, GITHUB_OUTPUT: out, ...extra } });
    let text = "";
    child.stdout.on("data", (d) => { text += d; });
    child.on("close", (code) => ok({ code, out: text, output: readFileSync(out, "utf8") }));
  });
  try {
    writeFileSync(join(dir, "w1.json"), JSON.stringify(WEEK1, null, 1) + "\n");
    writeFileSync(join(dir, "w2.json"), JSON.stringify(WEEK2));
    // ALERTS_MODE=keys from an older weekly.yml changes nothing: the run starts and computes
    const f = await runCli(join(dir, "w1.json"), { ALERTS_MODE: "keys" });
    assert.equal(f.code, 0);
    assert.deepEqual(seen.splice(0).map((u) => u.split("?")[0]), ["/v1/internal/start", "/v1/internal/keys", "/v1/internal/watched", "/v1/internal/digest", "/v1/internal/finish"]);
    assert.equal(f.output, "");
    assert.deepEqual(db.rows("SELECT n FROM stat WHERE k = 'data'"), [{ n: parseInt(fingerprint(WEEK1).slice(0, 13), 16) }], "the tag of the data's fingerprint");
    // the same prices in other bytes: done after one request
    writeFileSync(join(dir, "w1b.json"), JSON.stringify(WEEK1));
    const again = await runCli(join(dir, "w1b.json"));
    assert.match(again.out, /^price alerts: these prices were already computed \(same fingerprint\) — nothing to do$/m);
    assert.deepEqual(seen.splice(0), ["/v1/internal/start"]);
    // new prices past COMPUTES_PER_DAY (1 here) this UTC day: deferred — a ::warning and deferred=true for the workflow
    const later = await runCli(join(dir, "w2.json"));
    assert.equal(later.code, 0);
    assert.match(later.out, /^::warning title=price alerts::today's full computations \(the Worker's COMPUTES_PER_DAY, the D1 write budget\) are used up — these prices are computed by the first alerts-catchup run after 09:00 KST$/m);
    assert.equal(later.output, "deferred=true\n");
    assert.deepEqual(seen.splice(0), ["/v1/internal/start"]);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("everything notify.mjs logged in this file holds counts only: no secret, URL, host, id, endpoint, key or region name", () => {
  assert.ok(ALL_LOGS.length >= 8, `only ${ALL_LOGS.length} log lines were collected`);
  const text = ALL_LOGS.join("\n");
  for (const v of [SECRET_VALUE, URL_, "yoonsiljang", "workers.dev", "https://", "fcm.googleapis", "fcm/send", "Bearer", "X24", "X01", "X02", "서울", "부산"])
    assert.equal(text.includes(v), false, `a log line shows ${v}`);
  assert.equal(/(?<![\w-])[A-Za-z0-9_-]{22}(?![\w-])/.test(text), false, "no id-shaped (22 characters) token in any log line");
  for (const l of ALL_LOGS) assert.match(l, /^(price alerts: these prices were already computed \(same fingerprint\) — nothing to do|::notice title=price alerts::another run is computing alerts right now — the hourly alerts-catchup run checks these prices again|::warning title=price alerts::today's full computations \(the Worker's COMPUTES_PER_DAY, the D1 write budget\) are used up — these prices are computed by the first alerts-catchup run after 09:00 KST|price alerts: \d+ watched pairs \(\d+ skipped, \d+ changed, \d+ ending soon\), marked \d+ weekly \+ \d+ expiring \(\d+ stale expiring cleared\)|::warning title=price alerts::the Worker cut the watched list at PAIR_CAP — some pairs were not computed \(GET \/health pairs: capped\)|::warning title=price alerts::new pairs wait for a free row under the Worker's PAIR_CAP — not computed today \(GET \/health pairs: capped\)|::warning title=price alerts::app\/data\.json shape changed \((\d+ of \d+ [^;()]*|meta\.recl is not \[\[day, \[keys\]\]\]|not a data\.json)(; [^()]*)*\) — nothing sent until cf\/alerts\/src\/rules\.js KEY_RE\/REGIONS follow)$/, `unexpected log line shape: ${l}`);
});
