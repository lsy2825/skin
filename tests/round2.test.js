// Round-2 review regressions (review package 2026-10-14, evidence/reproduce.mjs): each probe that showed a defect is kept
// here with the CORRECT expectation, so the defect cannot come back. Pure modules + the real data.json; no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PC = require("../app/domain/pricectx.js");
const Pricing = require("../app/domain/pricing.js");
const Stats = require("../app/domain/stats.js");
const Intel = require("../app/domain/intel.js");
const Match = require("../app/domain/match.js");

const D = JSON.parse(fs.readFileSync(path.join(__dirname, "../app/data.json"), "utf8"));
const CTX = PC.fromData(D, "2026-10-14");

test("R03: one median everywhere — even counts average the middle two", () => {
  assert.equal(Stats.median([100, 200]), 150);
  assert.equal(Stats.median([200, 100, 300]), 200);
  assert.equal(Stats.median([]), null);
  assert.equal(Stats.median([5, 5, 5, 5]), 5);
  assert.equal(Stats.median([1, 2]), 2, "rounded to whole won (1.5 → 2)");
  for (const m of [PC.median, Intel.median]) assert.equal(m([100, 200]), 150);
  assert.equal(Match.compare(150, [100, 200, 300, 400]).median, 250);
  // the real data (count changes as brands are added — 110 branches on 2026-10-14 before the four new chains, 210 after):
  // whatever the count, the shared median of the same prices (the paid Jomi Q&A that also read it went with the credits, 6.0)
  // a group with many prices and an even count (which group that is changes with the data: '국산 필러 1cc' until 셀린 joined)
  const k = ["국산 필러 1cc", ...CTX.keys.map((x) => x.label)].map((l) => CTX.keys.find((x) => x.label === l))
    .find((x) => { const n = CTX.prices(x.id, "").length; return n >= 110 && n % 2 === 0; });
  assert.ok(k, "no group with 110+ prices and an even count");
  const ps = CTX.prices(k.id, "").map((x) => x.p);
  const sorted = [...ps].sort((a, b) => a - b), mid = Math.round((sorted[ps.length / 2 - 1] + sorted[ps.length / 2]) / 2);
  assert.equal(Stats.median(ps), mid, "even count: the middle two averaged");
});

test("R04: row index 0 is a real row — the lowest price wins whatever the row order", () => {
  const synthetic = { S: ["", "K1", "서울"], branches: [[0, 0, 0, 0, 0, 2]], keys: [["K1", "", "리쥬란 힐러 2cc"]], brands: [["B"]], today: "2026-10-14", updated: "2026-10-14",
    rows: [[0, 0, 0, 100, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0], [0, 0, 0, 200, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0]] };
  assert.equal(PC.build(synthetic).prices("K1", "")[0].p, 100);
  const flipped = { ...synthetic, rows: [synthetic.rows[1], synthetic.rows[0]] };
  assert.equal(PC.build(flipped).prices("K1", "")[0].p, 100);
});

test("R14: a one-time special with no regular price is never multiplied into a firm total", () => {
  const l = Pricing.lineCost([{ i: 1, p: 100, special: true }], [], 3, null);
  assert.notEqual(l.total, 300);
  assert.equal(l.incomplete, true); assert.equal(l.unpriced, 2);
  const c = Pricing.compareClinics([{ b: 0, lines: [l] }]);
  assert.equal(c.full.length, 0); assert.equal(c.mix.missing, 1);
  // with a regular price the later sessions use it and the line says so
  const r = Pricing.lineCost([{ i: 1, p: 100, special: true }, { i: 2, p: 300 }], [{ i: 2, p: 300 }], 3, null);
  assert.equal(r.total, 700); assert.equal(r.laterRegular, true);
});

test("R11: the CSP allows exactly the origins the config calls (a metrics address missing from connect-src is caught)", () => {
  const { check } = require("../tools/check_csp.js");
  const html = fs.readFileSync(path.join(__dirname, "../app/index.html"), "utf8"), cfg = fs.readFileSync(path.join(__dirname, "../app/config.js"), "utf8");
  assert.equal(check(html, cfg).ok, true, JSON.stringify(check(html, cfg).problems));
  assert.match(cfg, /metrics: false,/, "anonymous metrics ship off (6.0 약속 2: on only after C's privacy text and the user's approval)");
  const withApi = cfg.replace('metricsApi: ""', 'metricsApi: "https://m.yoonsiljang.example/"');
  const r = check(html, withApi);
  assert.equal(r.ok, false); assert.match(r.problems.join(" "), /connect-src is missing the metricsApi origin https:\/\/m\.yoonsiljang\.example/);
  const fixed = html.replace("connect-src 'self'", "connect-src 'self' https://m.yoonsiljang.example");
  assert.equal(check(fixed, withApi).ok, true);
  assert.match(check(fixed, cfg.replace('metricsApi: ""', 'metricsApi: "http://m.yoonsiljang.example"')).problems.join(" "), /must be https/);
  // an opening nothing uses: the metrics origin left in the CSP after the address is taken out of config.js
  assert.match(check(fixed, cfg).problems.join(" "), /allows https:\/\/m\.yoonsiljang\.example but no config\.js address uses it/);
  // metrics on with an address the app refuses (it would send nothing): caught before deploy
  const on = (api) => check(fixed, cfg.replace('metrics: false', 'metrics: true').replace('metricsApi: ""', `metricsApi: "${api}"`));
  assert.equal(on("https://m.yoonsiljang.example").ok, true);
  for (const bad of ["https://m.yoonsiljang.example/?k=1", "https://u:p@m.yoonsiljang.example", ""]) assert.match(on(bad).problems.join(" "), /not a plain https address/, bad);
  // the alerts Worker (6.0 contract 1, B6): the same rules
  const withAlerts = cfg.replace('alertsApi: ""', 'alertsApi: "https://alerts.yoonsiljang.example/"');
  assert.match(check(html, withAlerts).problems.join(" "), /connect-src is missing the alertsApi origin https:\/\/alerts\.yoonsiljang\.example/);
  assert.equal(check(html.replace("connect-src 'self'", "connect-src 'self' https://alerts.yoonsiljang.example"), withAlerts).problems.some((x) => /connect-src/.test(x)), false);
  assert.match(check(html, cfg.replace('alertsApi: ""', 'alertsApi: "http://alerts.yoonsiljang.example"')).problems.join(" "), /alertsApi must be https/);
  // half set up (address without key) or a key the app refuses: the push button would never show — caught
  const csp = html.replace("connect-src 'self'", "connect-src 'self' https://alerts.yoonsiljang.example");
  const KEY = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url");
  assert.match(check(csp, withAlerts).problems.join(" "), /push is set up but the app would hide it/);
  assert.equal(check(csp, withAlerts.replace('pushPublicKey: ""', `pushPublicKey: "${KEY}"`)).ok, true);
  assert.match(check(csp, withAlerts.replace('pushPublicKey: ""', 'pushPublicKey: "not-a-key"')).problems.join(" "), /push is set up but the app would hide it/);
  assert.equal(/commerce|apiBase/.test(cfg), false, "the credit/commerce settings are gone (6.0: no credits)");
});

test("Jomi lines engine: conditions + priority, no immediate repeat, fixed safety lines never vary, copy rules hold", () => {
  const L = require("../app/domain/jomilines.js");
  assert.deepEqual(L.check(), [], "no line breaks the copy rules (amounts, dose, diagnosis, guarantees, clinic picks, length)");
  const st = L.stats();
  assert.ok(st.variants >= 40 && st.intents >= 10, JSON.stringify(st));
  // counts are reported separately — variants are not 'unique answers'
  assert.ok(st.records < st.variants);
  assert.match(L.pick("home", { visits: 1 }).id, /^home\.first/);
  assert.match(L.pick("home", { visits: 3, hour: 23 }).id, /^home\.night/);
  assert.match(L.pick("error", { offline: true }).id, /^offline/);
  for (const intent of ["home", "loading", "emptySearch", "saved", "added"]) {
    const recent = []; let prev = null, repeats = 0;
    for (let i = 0; i < 30; i++) { const p = L.pick(intent, { visits: 3, hour: 14 }, recent); if (p.id === prev) repeats++; prev = p.id; recent.push(p.id); }
    assert.equal(repeats, 0, intent);
  }
  for (const r of L.RECORDS.filter((x) => x.fixed)) assert.equal(r.variants.length, 1, r.id);
  assert.equal(L.pick("concernFound").text, "적어 준 말과 관련된 정보를 찾아봤어. 결정은 꼭 의료진과 상담해서 해 줘.");
});

test("D5/D8: a prototype name is an unknown key; 초성 and typed operator words are read sensibly", () => {
  const Search = require("../app/domain/search.js");
  const KI = Object.assign(Object.create(null), { X01: 0 });
  assert.equal(KI["__proto__"], undefined); assert.equal(KI.constructor, undefined);
  assert.deepEqual(Search.compile("ㅂㅌㅅ", null).fixes, [["ㅂㅌㅅ", "보톡스"]]);
  const and = Search.compile("보톡스 AND", null);
  assert.equal(and.parts.length, 1); assert.match(and.warn[0], /쓰지 않아도/);
});

test("R09/O1: the saved copy is shown while the version check is still pending (a stalled data-meta request cannot hold the screen)", async () => {
  // app/state/data.js (split from app.js, docs/APP_JS_SPLIT_PLAN.md 2단계) runs in a VM; its network/storage calls are replaced through App.Data.io
  const vm = require("node:vm");
  const src = fs.readFileSync(path.join(__dirname, "../app/state/data.js"), "utf8");
  let resolveMeta, applied = 0;
  const win = { App: {}, Sync: { checkData: () => [], checkMeta: () => [], RETRY_MS: [] }, isSecureContext: true };
  const box = { window: win, AbortController, Promise, Date, JSON, Object, Error, URL, setTimeout, clearTimeout, TextDecoder, Uint8Array };
  vm.createContext(box); vm.runInContext(src, box);
  const Data = win.App.Data;
  Data.io.cacheGet = async () => ({ meta: { version: "v" }, text: "{}" });
  Data.io.fetchMeta = () => new Promise((r) => { resolveMeta = r; });
  Data.setHooks({ apply: () => applied++, paint() {} });
  let readyAt = null;
  const lp = Data.loadData().then(() => { readyAt = applied; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(applied, 1, "cached data applied before the meta answer");
  assert.equal(readyAt, 1, "the app was released (ready) before the meta answer");
  resolveMeta({ ok: true, m: { version: "v" } });
  await lp;
  assert.equal(applied, 1, "same version: nothing applied twice");
  // fetchMeta has its own deadline
  assert.match(src, /async function fetchMeta\(signal, ms = 8000\)/);
});
