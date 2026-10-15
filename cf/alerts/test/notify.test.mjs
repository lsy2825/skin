// node --test cf/alerts/test/*.test.mjs — the factory side (notify.mjs) against the Worker with a small data.json-shaped
// fixture: first sight only stores baselines; a changed published data.json marks target/watch/newmatch/expiring for
// exactly the phones whose rules match, on the price basis of the app's alert engine (병원 표시가); news is sticky across a
// failed run and never repeats, and a rebuild without a scrape is never news; what leaves the runner is (key, region)
// pairs and numbers — never ids or endpoints.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import worker from "../src/worker.js";
import { notify as notifyReal, listedPrice, reclDate, shapeProblems, checkUrl } from "../notify.mjs";
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
  assert.match(logs[1], /^price alerts: 5 watched pairs \(\d+ changed/);
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
  assert.equal((await run(env, WEEK2, "2026-10-19")).weekly, 0, "(ii) same data, same day");
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
  assert.deepEqual(w.sent.map((x) => new URL(x.url).pathname), ["/v1/internal/watched", "/v1/internal/finish"]);
  const bad = wire(env, undefined, "2026-10-12");
  await assert.rejects(notify({ data: WEEK1, today: "2026-10-12", url: URL_, secret: "nope", fetch: bad.f, log: () => {}, waitMs: 0 }), /401/);
  assert.equal(bad.sent.length, 1);
});

test("CLI: never fails the price build — unset env skips, a failure is a ::warning with exit 0", () => {
  const cli = fileURLToPath(new URL("../notify.mjs", import.meta.url));
  const skip = spawnSync(process.execPath, [cli, "/nonexistent/data.json"], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(skip.status, 0);
  assert.match(skip.stdout, /not set — skipped/);
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
  // the token's VALUE reaches exactly two steps; the 'Ready to deploy?' step only learns whether it is set (a boolean) and runs grep
  const withToken = steps.filter((st) => /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/.test(st));
  assert.equal(withToken.length, 2, "migrations and deploy only");
  const ready = steps.find((st) => /id: ready/.test(st));
  assert.match(ready, /HAS_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN != '' \}\}/);
  assert.equal(/\bnpm\b|\bnpx\b|node_modules|\bnode\b|\bwrangler\b [a-z]/.test(ready.replace(/::notice[^\n]*/g, "")), false, "the ready step runs no package code");
  for (const st of withToken) {
    assert.match(st, /run: '"\$RUNNER_TEMP\/wr\/node_modules\/\.bin\/wrangler" (d1 migrations apply DB --remote|deploy) --config cf\/alerts\/wrangler\.jsonc'/);
    assert.match(st, /WRANGLER_SEND_METRICS: "false"/);
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
    assert.match(r.stdout, /^::warning title=price alerts::price alert check failed \(the data file is not readable JSON\)/m);
    assert.equal((r.stdout + r.stderr).includes("hunter2"), false, "neither the file's content nor the secret is printed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("everything notify.mjs logged in this file holds counts only: no secret, URL, host, id, endpoint, key or region name", () => {
  assert.ok(ALL_LOGS.length >= 8, `only ${ALL_LOGS.length} log lines were collected`);
  const text = ALL_LOGS.join("\n");
  for (const v of [SECRET_VALUE, URL_, "yoonsiljang", "workers.dev", "https://", "fcm.googleapis", "fcm/send", "Bearer", "X24", "X01", "X02", "서울", "부산"])
    assert.equal(text.includes(v), false, `a log line shows ${v}`);
  assert.equal(/(?<![\w-])[A-Za-z0-9_-]{22}(?![\w-])/.test(text), false, "no id-shaped (22 characters) token in any log line");
  for (const l of ALL_LOGS) assert.match(l, /^(price alerts: \d+ watched pairs \(\d+ changed, \d+ ending soon\), marked \d+ weekly \+ \d+ expiring|::warning title=price alerts::app\/data\.json shape changed \((\d+ of \d+ [^;()]*|meta\.recl is not \[\[day, \[keys\]\]\]|not a data\.json)(; [^()]*)*\) — nothing sent until cf\/alerts\/src\/rules\.js KEY_RE\/REGIONS follow)$/, `unexpected log line shape: ${l}`);
});
