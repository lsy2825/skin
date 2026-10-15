// node --test tests/*.test.js — search normalization, aliases, typo correction, unit prices (app/domain/search.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../app/domain/search.js");

const names = ["리쥬란힐러/리제반PN 2cc 체험가", "주름톡신(국산) 1부위", "슈링크 유니버스 리프팅 300샷", "울쎄라피 프라임 100샷",
  "피코토닝 1회", "사각턱보톡스 시술(국산 일반형) 50유닛", "써마지 FLX 600샷", "아쿠아필 1회"];
const idx = S.buildIndex(names, ["리쥬란힐러 2cc", "슈링크 유니버스 300샷"]);
const find = (q) => { const { tokens, fixes } = S.parse(q, idx); return { hits: names.filter((n, i) => S.matches(idx.normNames[i], tokens)), fixes }; };

test("aliases: English, spacing and variants find the same names", () => {
  assert.deepEqual(find("rejuran").hits, [names[0]]);
  assert.deepEqual(find("Shurink 300shot").hits, [names[2]]);
  assert.deepEqual(find("피코 토닝").hits, [names[4]]);
  assert.deepEqual(find("ulthera").hits, [names[3]]);
  assert.deepEqual(find("보톡스").hits, [names[1], names[5]]);       // 톡신 / 보톡스 are one term
  assert.deepEqual(find("사각턱 50u").hits, [names[5]]);              // 50유닛 → 50u
  assert.deepEqual(find("thermage flx").hits, [names[6]]);
});

test("typo correction by jamo distance", () => {
  const r = find("슈링그");
  assert.deepEqual(r.hits, [names[2]]);
  assert.deepEqual(r.fixes, [["슈링그", "슈링크"]]);
  assert.deepEqual(find("아쿠아필").fixes, []);                       // correct words are left alone
  assert.deepEqual(find("리쥬랑").hits, [names[0]]);
});

test("no forced match for unrelated words", () => {
  assert.deepEqual(find("햄버거").hits, []);
});

test("autocomplete", () => {
  const s = S.suggest("슈링", idx, ["슈링크 유니버스 300샷"]);
  assert.equal(s[0], "슈링크 유니버스 300샷");
  assert.ok(S.suggest("리쥬", idx).some((x) => x.includes("리쥬란")));
  assert.deepEqual(S.suggest("", idx), []);
});

test("unit price is a reference: per 100샷 / 1cc / 10U, none for bundles", () => {
  assert.deepEqual(S.unitPrice("슈링크 300샷", 69000), { unit: "샷", per: 100, price: 23000, qty: 300 });
  assert.deepEqual(S.unitPrice("슈링크 100샷", 53900), { unit: "샷", per: 100, price: 53900, qty: 100 });
  assert.equal(S.unitPrice("리쥬란 2cc", 300000).price, 150000);
  assert.equal(S.unitPrice("사각턱보톡스 50유닛", 19000).price, 3800);
  assert.equal(S.unitPrice("슈링크 300샷 + 리쥬란 2cc", 300000), null);
  assert.equal(S.unitPrice("아쿠아필 1회", 30000), null);
  assert.equal(S.unitOf("온다 리프팅 10,000KJ").qty, 10000);
  assert.equal(S.unitOf("온다 리프팅 10만줄").qty, 100);
});

test("natural language: price limits, area, brand, kind, sort; amounts are not prices", () => {
  const ctx = { brands: ["블리비", "쁨", "톡스앤필", "리엔장"], sido: ["서울", "경기", "인천"], areas: ["강남", "홍대", "잠실"] };
  let r = S.interpret("강남 슈링크 300샷 10만원 이하 체험가", ctx);
  assert.equal(r.q, "슈링크 300샷"); assert.equal(r.area, "강남"); assert.equal(r.max, 100000); assert.equal(r.kind, "체험가");
  r = S.interpret("리쥬란 2cc 15만원 미만 제일 싼 곳", ctx);
  assert.equal(r.q, "리쥬란 2cc"); assert.equal(r.max, 149999); assert.equal(r.sort, "price");
  r = S.interpret("블리비 홍대점 울쎄라 5만~10만", ctx);
  assert.equal(r.brand, "블리비"); assert.equal(r.area, "홍대"); assert.equal(r.min, 50000); assert.equal(r.max, 100000); assert.equal(r.q, "울쎄라");
  r = S.interpret("서울 써마지 600샷 패키지 20만원대", ctx);
  assert.equal(r.region, "서울"); assert.equal(r.sess, "pkg"); assert.equal(r.min, 200000); assert.equal(r.max, 399999); assert.equal(r.q, "써마지 600샷");
  r = S.interpret("슈링크 300샷", ctx);
  assert.deepEqual([r.q, r.max, r.min, r.chips.length], ["슈링크 300샷", undefined, undefined, 0]);
  r = S.interpret("잠실 근처 리쥬란 어디 싸?", ctx);
  assert.equal(r.area, "잠실");
});

test("natural language: filler words dropped", () => {
  const ctx = { brands: ["블리비"], sido: ["서울"], areas: ["잠실"] };
  assert.equal(S.interpret("잠실 근처 리쥬란 어디 싸?", ctx).q, "리쥬란");
  assert.equal(S.interpret("제일 싼 곳 피코토닝", ctx).q, "피코토닝");
});

// ---- search operators (docs/ADVANCED_SEARCH_SPEC.md)
const opNames = ["슈링크 유니버스 300샷", "슈링크 유니버스 1300샷", "슈링크 300샷 3회", "슈링크 300샷 1회", "슈링크 1,300샷 1회",
  "사각턱보톡스(국산) 50유닛", "사각턱보톡스(국산) 150U", "파워 사각턱 보톡스 50U", "제오민 사각턱 50U", "독일산 톡신 50U (제오민)",
  "코어톡스 사각턱 50u", "리쥬란힐러 2cc", "리쥬란힐러 12cc", "아쿠아필", "점빼기 12개월 이용권", "점빼기 1개"];
const opIdx = S.buildIndex(opNames);
const run = (q) => { const c = S.compile(q, opIdx); return opNames.filter((n, i) => c.test(opIdx.normNames[i])); };

test("operators: AND — every word must match", () => {
  assert.deepEqual(run("보톡스 50u"), ["사각턱보톡스(국산) 50유닛", "파워 사각턱 보톡스 50U"]);   // 보톡스 = 톡신 (alias); '독일산 톡신' is an alias of 제오민
  assert.deepEqual(run("슈링크 1회"), ["슈링크 300샷 1회", "슈링크 1,300샷 1회"]);
});
test("operators: exact number+unit — 300샷 never matches 1300샷, 2cc never 12cc, 50U never 150U", () => {
  assert.deepEqual(run("300샷"), ["슈링크 유니버스 300샷", "슈링크 300샷 3회", "슈링크 300샷 1회"]);
  assert.deepEqual(run("1300샷"), ["슈링크 유니버스 1300샷", "슈링크 1,300샷 1회"]);
  assert.deepEqual(run("리쥬란 2cc"), ["리쥬란힐러 2cc"]);
  assert.ok(!run("50u").includes("사각턱보톡스(국산) 150U"));
  assert.ok(run("50u").includes("사각턱보톡스(국산) 50유닛"));          // 50유닛 = 50U
  assert.deepEqual(run("점빼기 12개"), []);                            // '12개월' is not 12개
  assert.deepEqual(run("점빼기 1개"), ["점빼기 1개"]);
});
test("operators: exclusion drops the word and its aliases", () => {
  assert.ok(!run("사각턱 50u -파워").some((n) => n.includes("파워")));
  assert.deepEqual(run("사각턱 50u -제오민 -독일 -파워"), ["사각턱보톡스(국산) 50유닛", "코어톡스 사각턱 50u"]);
  assert.ok(!run("톡신 -보톡스").length);                              // 보톡스 = 톡신 (alias): nothing left
  assert.deepEqual(run("슈링크 -1300샷"), ["슈링크 유니버스 300샷", "슈링크 300샷 3회", "슈링크 300샷 1회"]);
});
test("operators: OR inside one word", () => {
  assert.deepEqual(run("제오민|독일 50u"), ["제오민 사각턱 50U", "독일산 톡신 50U (제오민)"]);
  assert.deepEqual(run("리쥬란|아쿠아필"), ["리쥬란힐러 2cc", "리쥬란힐러 12cc", "아쿠아필"]);
  assert.deepEqual(run("300샷|1300샷 1회"), ["슈링크 300샷 1회", "슈링크 1,300샷 1회"]);
});
test("operators: 1회? keeps names without a count but never calls them 1회; plain 1회 needs it written", () => {
  assert.deepEqual(run("슈링크 300샷 1회?"), ["슈링크 유니버스 300샷", "슈링크 300샷 1회"]);
  const c = S.compile("슈링크 300샷 1회?", opIdx);
  assert.deepEqual(c.unstated(S.norm("슈링크 유니버스 300샷")), ["횟수 표기 없음"]);
  assert.deepEqual(c.unstated(S.norm("슈링크 300샷 1회")), []);
  assert.deepEqual(run("슈링크 300샷 1회"), ["슈링크 300샷 1회"]);
  assert.deepEqual(run("슈링크 3회?"), ["슈링크 유니버스 300샷", "슈링크 유니버스 1300샷", "슈링크 300샷 3회"]);
  assert.deepEqual(run("사각턱 50u?"), ["사각턱보톡스(국산) 50유닛", "파워 사각턱 보톡스 50U", "제오민 사각턱 50U", "코어톡스 사각턱 50u"]);
});
test("operators: bad or empty input is ignored with a note, never throws", () => {
  for (const q of ["", "   ", "-", "--", "|", "a||b", "?", "-?", "슈링크 -", "슈링크 |", "샷?", "슈링크?", "-300샷?", "((", "%%", "🙂", "1회??", "－파워"]) {
    const c = S.compile(q, opIdx);
    assert.equal(typeof c.test("슈링크300샷"), "boolean", q);
  }
  assert.ok(S.compile("-", opIdx).empty && S.compile("-", opIdx).warn.length);
  assert.ok(S.compile("슈링크?", opIdx).warn.length);                   // '?' only after number+unit
  assert.deepEqual(run("슈링크 -"), run("슈링크"));
  assert.deepEqual(run("a||리쥬란"), run("a|리쥬란"));
  assert.equal(S.compile("", opIdx).empty, true);
});
test("operators: typo fix still works for plain words, not for excluded ones", () => {
  const c = S.compile("슈링그 300샷", opIdx);
  assert.deepEqual(c.fixes, [["슈링그", "슈링크"]]);
  assert.equal(S.compile("슈링크 -파어", opIdx).fixes.length, 0);
});
test("operators: hasOps detects operator use (natural-language reading is skipped then)", () => {
  assert.ok(S.hasOps("보톡스 -파워") && S.hasOps("제오민|독일") && S.hasOps("슈링크 1회?"));
  assert.ok(!S.hasOps("강남 슈링크 10만원 이하") && !S.hasOps("필러-1cc") && !S.hasOps("강남 슈링크 어디가 싸?"));
  assert.ok(S.hasOps("사각턱 50U?") && S.hasOps("슈링크 300 샷?"));
});
test("operators: speed — 60k names in well under a second", () => {
  const many = Array.from({ length: 60000 }, (_, i) => S.norm(`${opNames[i % opNames.length]} ${i}`));
  const c = S.compile("슈링크 300샷 1회? -아이", null);
  const t0 = Date.now(); let n = 0;
  for (const x of many) if (c.test(x)) n++;
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  assert.ok(n > 0);
});

test("uniqueRows: the same branch, product and price is one line; spacing and case do not make a new line", () => {
  const rows = [[0, "리쥬란 힐러 2cc", 200000], [0, "리쥬란힐러 2cc", 200000], [0, "리쥬란 힐러 2CC", 200000], [0, "리쥬란 힐러 2cc", 210000],
    [1, "리쥬란 힐러 2cc", 200000], [0, "리쥬란 힐러 4cc", 200000]];
  assert.deepEqual(S.uniqueRows([0, 1, 2, 3, 4, 5], (i) => rows[i]), [0, 3, 4, 5]);
  assert.deepEqual(S.uniqueRows([3, 1, 0], (i) => rows[i]), [3, 1]);   // order kept, the first one wins
  assert.deepEqual(S.uniqueRows([], (i) => rows[i]), []);
});
