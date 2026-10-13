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
