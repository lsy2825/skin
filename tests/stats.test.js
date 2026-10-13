// app/domain/stats.js: per-branch lowest price of one option, a price's position, branch levels, list orders
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../app/domain/stats.js");

// row = [branch, , , price]
const R = [[0, 0, 0, 30000], [0, 0, 0, 25000], [1, 0, 0, 40000], [2, 0, 0, 10000], [3, 0, 0, 50000], [3, 0, 0, 99000]];
const row = (i) => R[i];

test("groupStat: each branch counts once, with its lowest price", () => {
  const g = S.groupStat(R.keys(), row);
  assert.deepEqual([...g.per].map(([b, x]) => [b, x.p, x.i]), [[0, 25000, 1], [1, 40000, 2], [2, 10000, 3], [3, 50000, 4]]);
  assert.deepEqual(g.prices, [10000, 25000, 40000, 50000]);
  assert.equal(g.med, 32500);   // even count: mean of the two middle prices
});

test("groupStat: rows left out by keep() never count", () => {
  const g = S.groupStat(R.keys(), row, (i) => i !== 3);   // branch 2's only row is gone (e.g. its event ended)
  assert.deepEqual(g.prices, [25000, 40000, 50000]);
  assert.equal(g.med, 40000);
  assert.deepEqual(S.groupStat([], row), { per: new Map(), prices: [], med: 0 });
});

test("position: rank among branches, ties share a rank, null with fewer than 3", () => {
  const g = S.groupStat(R.keys(), row);
  assert.deepEqual(S.position(10000, g), { rank: 1, n: 4, vsMed: 10000 / 32500 - 1 });
  assert.equal(S.position(25000, g).rank, 2);
  assert.equal(S.position(45000, g).rank, 4);
  const two = S.groupStat([0, 2], row);
  assert.equal(S.position(30000, two), null);
  assert.equal(S.position(1, null), null);
});

test("byLevel: lowest level first, branches without a level left out", () => {
  assert.deepEqual(S.byLevel([{ b: 1, lv: 1.2 }, { b: 2, lv: null }, { b: 3, lv: 0.8 }, { b: 4, lv: 1 }]).map((x) => x.b), [3, 4, 1]);
});

// list orders (docs/OBJECTIVE_DISPLAY_POLICY.md): the default 'region' order has nothing to do with price
const NAMES = { 1: "서울 강남점", 2: "부산 서면점", 3: "서울 건대점", 4: "대구 동성로점" };
const VER = { 1: "2026-10-06", 2: "2026-10-13", 3: "2026-10-13", 4: "2026-09-29" };
const ctx = (hasLoc = true) => ({ regionCmp: (a, b) => NAMES[a].localeCompare(NAMES[b], "ko"), verified: (b) => VER[b], hasLoc });
const L = () => [{ b: 1, p: 20000, d: 3 }, { b: 2, p: 9000, d: 320 }, { b: 3, p: 20000, d: 1 }, { b: 4, p: 50000, d: null }];
const ids = (l) => l.map((x) => x.b);

test("order: region (default) ignores price", () => {
  assert.deepEqual(ids(S.order(L(), "region", ctx())), [4, 2, 1, 3]);   // 대구, 부산, 서울 강남, 서울 건대
});

test("order: near uses distance (unknown last), region order when no place is set", () => {
  assert.deepEqual(ids(S.order(L(), "near", ctx())), [3, 1, 2, 4]);
  assert.deepEqual(ids(S.order(L(), "near", ctx(false))), ids(S.order(L(), "region", ctx())));
});

test("order: recent = newest check first", () => {
  assert.deepEqual(ids(S.order(L(), "recent", ctx())), [2, 3, 1, 4]);
});

test("order: price ascending (equal prices: newer check, then nearer) and descending", () => {
  assert.deepEqual(ids(S.order(L(), "price", ctx())), [2, 3, 1, 4]);
  assert.deepEqual(ids(S.order(L(), "priceDesc", ctx())), [4, 1, 3, 2]);   // equal prices by region
});

test("order: every listed sort exists and none is a review or recommendation order", () => {
  assert.deepEqual(S.SORTS, ["region", "near", "recent", "price", "priceDesc"]);
  assert.ok(!S.SORTS.some((x) => /review|recommend|ad|sponsor/i.test(x)));
});

test("medianSorted", () => {
  assert.equal(S.medianSorted([]), 0);
  assert.equal(S.medianSorted([5]), 5);
  assert.equal(S.medianSorted([1, 2, 9]), 2);
  assert.equal(S.medianSorted([1, 2, 3, 9]), 2.5);
});
