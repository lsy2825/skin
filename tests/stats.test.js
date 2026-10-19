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

test("historyReady: a price history is shown only after 8 distinct weeks", () => {
  const days = (n, step) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 9, 13 + i * step)).toISOString().slice(0, 10));
  const obs = (dates) => S.observations(dates, dates.map(() => [100, 90, 5]));
  assert.equal(S.HISTORY_MIN_WEEKS, 8);
  assert.equal(S.historyReady(obs(["2026-10-13", "2026-10-14"])), false);   // two snapshots a day apart: 1 week, not '2주'
  assert.equal(S.historyReady(obs(days(30, 1))), false);                     // a month of daily snapshots: 5 weeks
  assert.equal(S.historyReady(obs(days(7, 7))), false);                      // 7 weekly snapshots
  assert.equal(S.historyReady(obs(days(8, 7))), true);                       // 8 weekly snapshots
  assert.equal(S.historyReady(S.observations(days(8, 7), [null, null, null, null, null, null, [1, 1, 1], [1, 1, 1]])), false);   // a key seen twice
  assert.equal(S.historyReady(null), false);
  assert.match(S.obsLabel(obs(["2026-10-13", "2026-10-14"])), /^관측 2회 · 10\/13~10\/14$/);
});

// ---- list order and length (2026-10-16 hierarchy audit 5·6·7·11)
test("sidoCmp: 서울 → 경기 → 인천 first, every other 시·도 after them in 가나다 order", () => {
  const sidos = ["인천", "부산", "경기", "강원", "서울", "경남", "", "제주", "대구"];
  assert.deepEqual([...sidos].sort(S.sidoCmp), ["서울", "경기", "인천", "", "강원", "경남", "대구", "부산", "제주"]);
  assert.deepEqual(S.SIDO_FIRST, ["서울", "경기", "인천"]);
  assert.equal(S.sidoCmp("경기", "경기"), 0);
  assert.equal(S.sidoCmp(null, undefined), 0);
  assert.ok(S.sidoCmp("인천", "강원") < 0);   // 수도권 before the rest even where 가나다 would put it later
  assert.ok(S.sidoCmp("부산", "경기") > 0);
  // the list order itself still falls back on names within one 시·도 (regionCmp in app.js: 시·도, then branch name)
  const br = [["경기", "광주점"], ["서울", "홍대점"], ["인천", "부평점"], ["서울", "강남역점"], ["부산", "서면점"]];
  const cmp = (a, b) => S.sidoCmp(a[0], b[0]) || a[1].localeCompare(b[1], "ko");
  assert.deepEqual([...br].sort(cmp).map((x) => x[1]), ["강남역점", "홍대점", "광주점", "부평점", "서면점"]);
});

test("more: '20곳 더 보기 (165곳 남음)', 20 at a time, the last step shows what is left, null when all are shown", () => {
  assert.equal(S.MORE_STEP, 20);
  assert.deepEqual(S.more(20, 185, "곳"), { next: 40, add: 20, left: 165, label: "20곳 더 보기 (165곳 남음)" });
  assert.deepEqual(S.more(40, 113, "곳"), { next: 60, add: 20, left: 73, label: "20곳 더 보기 (73곳 남음)" });
  assert.deepEqual(S.more(180, 185, "곳"), { next: 185, add: 5, left: 5, label: "5곳 더 보기 (5곳 남음)" });
  assert.equal(S.more(185, 185, "곳"), null);
  assert.equal(S.more(200, 185, "곳"), null);
  assert.equal(S.more(0, 0), null);
  assert.equal(S.more(20, 1591).label, "20개 더 보기 (1,571개 남음)");   // the default word is 개, thousands with commas
  assert.equal(S.more(30, 851, "개", 30).next, 60);                       // a list may take its own step
  assert.equal(S.more("x", 3).next, 3);                                     // nonsense counts read as 0
});

test("groups: groups in first-seen order with their counts and first n rows", () => {
  const rows = [["톡신", 1], ["톡신", 2], ["필러", 3], ["톡신", 4], ["리프팅", 5], ["필러", 6], ["톡신", 7], ["톡신", 8], ["톡신", 9]];
  const g = S.groups(rows, (r) => r[0], 3);
  assert.deepEqual(g.map((x) => [x.key, x.total, x.first.map((r) => r[1])]), [["톡신", 6, [1, 2, 4]], ["필러", 2, [3, 6]], ["리프팅", 1, [5]]]);
  assert.deepEqual(S.groups([], (r) => r), []);
  assert.equal(S.groups(rows, (r) => r[0])[0].first.length, 5);   // 5 by default
});

test("commonDate: one end date on nearly every row is said once; mixed or sparse dates are not", () => {
  const many = (d, n) => Array.from({ length: n }, () => d);
  assert.deepEqual(S.commonDate([...many("2026-10-31", 849), "2026-11-30", ""]), { date: "2026-10-31", n: 849, total: 851 });
  assert.equal(S.commonDate([...many("2026-10-31", 70), ...many("", 30)]), null);              // 70%: rows with no date count against it
  assert.equal(S.commonDate([...many("2026-10-31", 50), ...many("2026-11-30", 50)]), null);    // two dates, neither on most rows
  assert.equal(S.commonDate(many("2026-10-31", 9)), null);                                       // too few rows to bother
  assert.deepEqual(S.commonDate(many("2026-10-31", 10)), { date: "2026-10-31", n: 10, total: 10 });
  assert.equal(S.commonDate([]), null);
  assert.equal(S.commonDate(null), null);
  assert.deepEqual(S.commonDate([...many("a", 6), ...many("", 4)], 0.6, 5), { date: "a", n: 6, total: 10 });
});

test("sharedKey: rows compare as one spec only when every row shares a key", () => {
  assert.equal(S.sharedKey([["X01", "T9"], ["T9", "X01"], ["X01"]]), "X01");
  assert.equal(S.sharedKey([["X01"], ["X02"]]), null);          // 2cc 1회 and a 3회 package
  assert.equal(S.sharedKey([["X01"], []]), null);               // a row no spec takes (a '+' bundle)
  assert.equal(S.sharedKey([["X01"], [""]]), null);
  assert.equal(S.sharedKey([]), null);
  assert.equal(S.sharedKey(null), null);
  assert.equal(S.sharedKey([["T9", "X01"]]), "T9");
});
