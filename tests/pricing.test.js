// node --test tests/*.test.js   (Node 18+). Domain rules of app/domain/pricing.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../app/domain/pricing.js");

test("VAT: 별도 prices get 10% in 'incl' mode, others unchanged", () => {
  assert.equal(P.vatPrice(49000, 2, "incl"), 53900);
  assert.equal(P.vatPrice(49000, 2, "listed"), 49000);
  assert.equal(P.vatPrice(69000, 1, "incl"), 69000);   // already VAT 포함
  assert.equal(P.vatPrice(69000, 0, "incl"), 69000);   // unknown: never guessed
  assert.equal(P.vatPrice(1900, 2, "incl"), 2090);
});

test("expired events: only real dates before today", () => {
  assert.equal(P.isExpired("2026-10-17", "2026-10-18"), true);
  assert.equal(P.isExpired("2026-10-17", "2026-10-17"), false);  // last day still valid
  assert.equal(P.isExpired("posted:2024-10-25", "2026-10-18"), false);
  assert.equal(P.isExpired("", "2026-10-18"), false);
  assert.equal(P.isExpired("9999-12-31", "2026-10-18"), false);
});

test("time cutoff parsing", () => {
  assert.equal(P.parseCutoff("[평일5시이전] 슈링크 300샷"), 17 * 60);
  assert.equal(P.parseCutoff("프라임 타임 오후 2시 이전"), 14 * 60);
  assert.equal(P.parseCutoff("[프라임 타임] 울쎄라 300샷"), null);
});

test("visit conditions: weekday-daytime, Sunday, holidays", () => {
  const tue = { date: "2026-10-20", time: "" }, sun = { date: "2026-10-18", time: "" };
  assert.equal(P.condState("평일 낮", "x", tue), 0);
  assert.equal(P.condState("평일 낮", "x", sun), 1);
  assert.equal(P.condState("평일 낮", "x", { date: "2026-12-25", time: "" }), 1);          // holiday (Friday)
  assert.equal(P.condState("평일 낮", "[평일5시이전] x", { date: "2026-10-20", time: "16:30" }), 0);
  assert.equal(P.condState("평일 낮", "[평일5시이전] x", { date: "2026-10-20", time: "17:00" }), 1);
  assert.equal(P.condState("평일 낮", "[프라임 타임] x", { date: "2026-10-20", time: "18:00" }), 2);  // window unknown
  assert.equal(P.condState("일요일", "x", sun), 0);
  assert.equal(P.condState("일요일", "x", tue), 1);
  assert.equal(P.condState("", "x", tue), 0);
  assert.equal(P.condState("평일 낮", "x", null), 0);
});

const row = (i, p, special = false) => ({ i, p, special });

test("line: cheapest, tie prefers regular price, special only for the first session", () => {
  assert.equal(P.lineCost([], [], 1, null), null);
  assert.deepEqual(P.lineCost([row(1, 900, true), row(2, 900)], [row(2, 900)], 1, null).rows, [2]);
  const l = P.lineCost([row(1, 500, true), row(2, 900)], [row(2, 900)], 3, null);
  assert.equal(l.total, 500 + 900 * 2);
  assert.deepEqual(l.rows, [1, 2]);
  assert.equal(l.special, true);
  // only special prices exist: all sessions at that price
  assert.equal(P.lineCost([row(1, 500, true)], [], 2, null).total, 1000);
});

test("line: user-chosen package covers sessions in bundles", () => {
  assert.equal(P.lineCost([], [], 5, { i: 9, p: 300000, sess: 3 }).total, 600000);   // 5 sessions → two 3-session packages
  assert.equal(P.lineCost([], [], 5, { i: 9, p: 300000, sess: 99 }).total, 300000);  // unlimited pass
});

test("cart: single clinic needs every item, missing prices never count as 0", () => {
  const L = (t) => (t == null ? null : { total: t, rows: [0], units: 1 });
  const r = P.compareClinics([
    { b: "A", lines: [L(100), L(200)] },
    { b: "B", lines: [L(50), null] },
    { b: "C", lines: [L(120), L(150)] },
  ]);
  assert.deepEqual(r.full.map((x) => [x.b, x.total]), [["C", 270], ["A", 300]]);
  assert.deepEqual(r.partial.map((x) => [x.b, x.n, x.missing]), [["B", 1, [1]]]);
  assert.equal(r.mix.total, 200);                 // 50 at B + 150 at C
  assert.equal(r.savings, 70);
  assert.deepEqual([r.pair.a, r.pair.b, r.pair.total], ["B", "C", 200]);
});

test("cart: mix ties go to a branch already on the route; no pair when one branch is as cheap", () => {
  const L = (t) => ({ total: t, rows: [0], units: 1 });
  const r = P.compareClinics([
    { b: "A", lines: [L(100), L(100)] },
    { b: "B", lines: [L(100), L(120)] },
  ]);
  assert.deepEqual(r.mix.picks.map((p) => p.b), ["A", "A"]);
  assert.equal(r.mix.places, 1);
  assert.equal(r.pair, null);
});

test("cart: item nobody sells", () => {
  const r = P.compareClinics([{ b: "A", lines: [{ total: 10, rows: [0] }, null] }]);
  assert.equal(r.full.length, 0);
  assert.equal(r.mix.missing, 1);
  assert.equal(r.savings, null);
});

test("first-visit prices: one per branch, the biggest saving stays", () => {
  const L = (t, extra = {}) => ({ total: t, rows: [0], units: 1, ...extra });
  const lines = [L(5000), L(9000), L(30000)];
  const alts = [L(20000), L(10000), null];
  const out = P.limitOnce(lines, [true, true, false], (j) => alts[j]);
  assert.deepEqual(out.map((l) => l.total), [5000, 10000, 30000]);   // item 0 saves 15,000 → keeps; item 1 falls back
  assert.equal(out[1].restacked, true);
  const noAlt = P.limitOnce([L(5000), L(9000)], [true, true], (j) => (j === 0 ? L(20000) : null));
  assert.equal(noAlt[1].total, 9000);                                  // no other price: kept (only option) …
  assert.equal(noAlt[1].stackWarn, undefined);                         // … because it saves most (Infinity)
  assert.equal(noAlt[0].restacked, true);
  assert.deepEqual(P.limitOnce([L(1), null], [true, false], () => null).map((l) => l && l.total), [1, null]);
});

test("package match: spec equal / different / unknown, extra parts", () => {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, "");
  const items = [{ fam: /슈링크/, spec: "300샷" }, { fam: /리쥬란/, spec: "2cc" }, { fam: /아쿠아필/, spec: "" }];
  let m = P.matchPackage("슈링크 300샷 + 리쥬란 2cc", items, norm);
  assert.deepEqual(m.matched.map((x) => [x.j, x.state]), [[0, "match"], [1, "match"]]);
  assert.equal(m.full, true);
  m = P.matchPackage("슈링크 100샷 + 리쥬란 2cc + 크라이오셀", items, norm);
  assert.deepEqual(m.matched.map((x) => x.state), ["spec", "match"]);
  assert.deepEqual(m.extras, ["크라이오셀"]);
  assert.equal(m.full, false);
  m = P.matchPackage("아쿠아필 + 리쥬란 2cc", items, norm);
  assert.deepEqual(m.matched.map((x) => [x.j, x.state]), [[1, "match"], [2, "check"]]);
});

test("package match with per-part comparison keys (from xkeys)", () => {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, "");
  const items = [{ fam: /톡신|보톡스/, spec: "50U", key: "X01" }, { fam: /톡신|보톡스/, spec: "", key: "X02" }];
  let m = P.matchPackage("[EVENT] 국산 사각턱보톡스 50U + 국산 주름보톡스 1부위", items, norm, "X01;X02");
  assert.deepEqual(m.matched.map((x) => [x.j, x.state]), [[0, "match"], [1, "match"]]);
  assert.equal(m.full, true);
  m = P.matchPackage("국산 턱보톡스 100U + 침샘보톡스", items, norm, ";");
  assert.deepEqual(m.matched.map((x) => x.state), ["spec", "spec"]);   // toxin, but not the same procedure
  assert.equal(m.full, false);
});
