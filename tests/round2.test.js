// Round-2 review regressions (review package 2026-10-14, evidence/reproduce.mjs): each probe that showed a defect is kept
// here with the CORRECT expectation, so the defect cannot come back. Pure modules + the real data.json; no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PC = require("../app/domain/pricectx.js");
const J = require("../app/domain/jomiqa.js");
const P = require("../app/domain/premium.js");
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
  for (const m of [PC.median, P.median, Intel.median]) assert.equal(m([100, 200]), 150);
  assert.equal(Match.compare(150, [100, 200, 300, 400]).median, 250);
  // the Jomi answer uses it too
  const ctx = { keys: [{ id: "k", label: "리쥬란", words: ["리쥬란"], sess: 1 }], prices: () => [{ p: 100 }, { p: 200 }], trend: { k: {} }, updated: "2026-10-14" };
  assert.equal(J.facts("리쥬란", ctx).groups[0].median, 150);
  // the real data: 국산 필러 1cc over 110 branches is 74,500원 (the old upper-middle code said 79,000원)
  const k = CTX.keys.find((x) => x.label === "국산 필러 1cc");
  const ps = CTX.prices(k.id, "").map((x) => x.p);
  assert.equal(ps.length, 110);
  assert.equal(Stats.median(ps), 74500);
  assert.equal(J.facts("국산 필러 1cc", CTX).groups.find((g) => g.id === k.id).median, 74500);
});

test("R04: row index 0 is a real row — the lowest price wins whatever the row order", () => {
  const synthetic = { S: ["", "K1", "서울"], branches: [[0, 0, 0, 0, 0, 2]], keys: [["K1", "", "리쥬란 힐러 2cc"]], brands: [["B"]], today: "2026-10-14", updated: "2026-10-14",
    rows: [[0, 0, 0, 100, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0], [0, 0, 0, 200, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0]] };
  assert.equal(PC.build(synthetic).prices("K1", "")[0].p, 100);
  const flipped = { ...synthetic, rows: [synthetic.rows[1], synthetic.rows[0]] };
  assert.equal(PC.build(flipped).prices("K1", "")[0].p, 100);
});

test("R02: Jomi answers the asked spec only — 2cc is never answered with 4cc; packages are labelled", () => {
  const f = J.facts("리쥬란힐러 2cc 가격대가 어때요?", CTX);
  assert.ok(f.groups.length);
  for (const g of f.groups) assert.match(g.label, /2cc/, g.label);
  assert.ok(!f.groups.some((g) => /4cc/.test(g.label)));
  // sessions not asked: the single-session group comes first; any package is flagged as a package, never the answer alone
  assert.equal(f.groups[0].sessions, 1);
  for (const g of f.groups) if (g.sessions > 1) assert.equal(g.bundle, true);
  assert.match(J.deterministicAnswer(f), /3회 묶음 가격/);
  // sessions asked: only that count
  const f3 = J.facts("리쥬란힐러 2cc 3회", CTX);
  assert.ok(f3.groups.length && f3.groups.every((g) => g.sessions === 3));
  // a spec nobody sells: no substitute, an honest 'not found'
  const f7 = J.facts("리쥬란힐러 7cc 얼마예요", CTX);
  assert.equal(f7.groups.length, 0); assert.equal(f7.noSpecMatch, true);
  assert.match(J.deterministicAnswer(f7), /대신 답하지 않아요/);
  // sex: a 남성 group is not used for a 여성 question
  const ctx = { keys: [{ id: "a", label: "제모 겨드랑이 남성", words: ["제모", "겨드랑이"], sess: 1 }, { id: "b", label: "제모 겨드랑이 여성", words: ["제모", "겨드랑이"], sess: 1 }],
    prices: () => [{ p: 1000 }], trend: { k: {} }, updated: "2026-10-14" };
  assert.deepEqual(J.facts("여성 겨드랑이 제모", ctx).groups.map((g) => g.id), ["b"]);
  // only-packages: the answer says no single-session price exists
  const pk = { keys: [{ id: "p", label: "리쥬란 힐러 2cc 3회", words: ["리쥬란", "힐러"], unit: "cc", qty: 2, sess: 3 }], prices: () => [{ p: 500000 }], trend: { k: {} }, updated: "2026-10-14" };
  assert.match(J.deterministicAnswer(J.facts("리쥬란 힐러 2cc", pk)), /1회 가격 묶음은 모은 자료에 없어요/);
});

test("Jomi guard: an amount must sit next to the right word (max written as 'lowest' is refused)", () => {
  const f = { groups: [{ label: "리쥬란", min: 100, median: 150, max: 200 }] };
  assert.equal(J.check("리쥬란 최저가는 200원이에요.", f).ok, false);
  assert.equal(J.check("가장 낮은 100원 · 중간값 150원 · 가장 높은 200원", f).ok, true);
  assert.equal(J.check("중간값은 200원이에요", f).ok, false);
  assert.equal(J.check("보통 77,000원이에요", f).ok, false);
});

test("R13: snapshots are not weeks — 4 days of data is 4 observations in 1 week and sells nothing", () => {
  const o = Stats.observations(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"], [[100, 90, 9], [100, 90, 9], [100, 90, 9], [100, 90, 9]]);
  assert.equal(o.n, 4); assert.ok(o.weeks <= 2); assert.equal(o.spanDays, 3);
  const short = { ...CTX, trend: { dates: ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"], k: { X01: [[100, 90, 9], [100, 90, 9], [100, 90, 9], [100, 90, 9]] } } };
  assert.equal(P.available("PRICE_HISTORY_REPORT", { key: "X01" }, short).ok, false);
  assert.doesNotMatch(P.build("PRICE_HISTORY_REPORT", { key: "X01" }, short).title, /4주/);
  assert.equal(P.usable(P.build("PRICE_HISTORY_REPORT", { key: "X01" }, short)), false);
  // the real data has two collection dates: '관측 2회', never '2주'
  assert.deepEqual(D.trend.dates, ["2026-10-13", "2026-10-14"]);
  const real = Stats.observations(D.trend.dates, [[1, 1, 9], [1, 1, 9]]);
  assert.equal(Stats.obsLabel(real), "관측 2회 · 10/13~10/14");
  // even with 8 distinct weeks, sales stay off until the operator turns them on (no automatic sale with time)
  const dates = Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(2026, 7, 3 + i * 7)).toISOString().slice(0, 10));
  const long = { ...CTX, trend: { dates, k: { X01: dates.map(() => [100, 90, 9]) } } };
  assert.equal(P.available("PRICE_HISTORY_REPORT", { key: "X01" }, long).ok, false);
  assert.equal(P.available("PRICE_HISTORY_REPORT", { key: "X01" }, { ...long, historySales: true }).ok, true);
  // a week priced at too few branches blocks it (sample bias)
  const thin = { ...long, historySales: true, trend: { dates, k: { X01: dates.map((_, i) => [100, 90, i === 3 ? 2 : 9]) } } };
  assert.equal(P.available("PRICE_HISTORY_REPORT", { key: "X01" }, thin).ok, false);
});

test("R05: a paid result with nothing to compare is not usable (never charged)", () => {
  const multiInput = { texts: ["외계시술알파 10000원", "외계시술베타 20000원"] };
  const multi = P.build("MULTI_EVENT_COMPARE", multiInput, CTX);
  assert.equal(multi.payload.groups.length, 0);
  assert.equal(P.usable(multi), false);
  // one event only: refused before reserving
  assert.equal(P.available("MULTI_EVENT_COMPARE", { texts: ["국산 사각턱 보톡스 50U 19000원"] }, CTX).ok, false);
  // the same exact group in two events: usable
  const two = P.build("MULTI_EVENT_COMPARE", { texts: ["국산 사각턱 보톡스 50U 19000원", "국산 사각턱 보톡스 50U 25000원"] }, CTX);
  assert.equal(P.usable(two), two.payload.groups.some((g) => new Set(g.offers.map((o) => o.event)).size >= 2));
  // a plan whose A/B/C totals are all missing: not usable even though input items exist
  const missingPlanCtx = { ...CTX, cart: () => ({ full: [], partial: [], mix: { missing: 1, places: 0, total: 0 }, pair: null }) };
  const plan = P.build("ADVANCED_CART_PLANNER", { items: [{ k: "X01", q: 1 }] }, missingPlanCtx);
  assert.ok(plan.payload.plans.every((x) => x.total == null));
  assert.equal(P.usable(plan), false);
  // an event decode with no exact match is not usable; with an exact market comparison it is
  assert.equal(P.usable(P.build("EVENT_URL_DECODER", { text: "외계시술알파 10000원" }, CTX)), false);
  const ok = P.build("EVENT_URL_DECODER", { text: "국산 사각턱 보톡스 50U 19000원" }, CTX);
  assert.equal(P.usable(ok), ok.payload.items.some((d) => d.match.status === "EXACT_MATCH" && d.compare && d.compare.verdict !== "FEW"));
  assert.equal(P.usable({ title: "x", payload: { items: [1] } }), false, "no kind → not usable");
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

test("R11: the CSP allows exactly the origins the config calls (an API origin missing from connect-src is caught)", () => {
  const { check } = require("../tools/check_csp.js");
  const html = fs.readFileSync(path.join(__dirname, "../app/index.html"), "utf8"), cfg = fs.readFileSync(path.join(__dirname, "../app/config.js"), "utf8");
  assert.equal(check(html, cfg).ok, true, JSON.stringify(check(html, cfg).problems));
  const withApi = cfg.replace('apiBase: ""', 'apiBase: "https://api.yoonsiljang.example"');
  const r = check(html, withApi);
  assert.equal(r.ok, false); assert.match(r.problems.join(" "), /connect-src is missing the API origin/);
  const fixed = html.replace("connect-src 'self'", "connect-src 'self' https://api.yoonsiljang.example");
  assert.equal(check(fixed, withApi).ok, true);
  assert.equal(check(fixed, withApi.replace('mode: "DEMO"', 'mode: "WEB_PG"')).ok, false, "Toss origins required for web payments");
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
  const vm = require("node:vm");
  const app = fs.readFileSync(path.join(__dirname, "../app/app.js"), "utf8");
  const src = app.slice(app.indexOf("  function loadData()"), app.indexOf("  // state → header"));
  let resolveMeta, applied = 0;
  const box = { AbortController, Promise, Date, JSON, Object, Error, setTimeout, TextDecoder, Uint8Array, SYNC: { have: false }, loadP: null, loadCtl: null, paintSync() {},
    cacheGet: async () => ({ meta: { version: "v" }, text: "{}" }), fetchMeta: () => new Promise((r) => { resolveMeta = r; }), Sync: { checkData: () => [] },
    applyData: () => applied++, cacheClear: async () => {}, tick: async () => {} };
  vm.createContext(box); vm.runInContext(src, box);
  let readyAt = null;
  const lp = box.loadData().then(() => { readyAt = applied; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(applied, 1, "cached data applied before the meta answer");
  assert.equal(readyAt, 1, "the app was released (ready) before the meta answer");
  resolveMeta({ ok: true, m: { version: "v" } });
  await lp;
  assert.equal(applied, 1, "same version: nothing applied twice");
  // fetchMeta has its own deadline
  assert.match(app, /async function fetchMeta\(signal, ms = 8000\)/);
});
