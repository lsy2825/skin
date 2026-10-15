// domain/classify.js — comparability classes A–J (docs/TREATMENT_TAXONOMY.md §3)
const test = require("node:test");
const assert = require("node:assert");
global.Search = require("../app/domain/search.js");
const Classify = require("../app/domain/classify.js");

const c = (o) => Classify.row(o).c;

test("products: devices under one name, products from Spec.PRODUCTS", () => {
  assert.deepStrictEqual(Classify.products("(남자) 겨드랑이 제모(아포지 플러스) 체험가"), ["아포지 플러스"]);
  assert.deepStrictEqual(Classify.products("[여성] 젠틀맥스 프로 플러스 · 허벅지/종아리"), ["젠틀맥스 프로 플러스"]);
  assert.deepStrictEqual(Classify.products("(여자) 비키니라인 제모(포토나 아발란체) 1회"), ["포토나 아발란체"]);
  assert.deepStrictEqual(Classify.products("리쥬란힐러 2cc"), ["리쥬란"]);
  assert.deepStrictEqual(Classify.products("리쥬하이 4cc (리쥬란 2cc)"), ["리쥬하이"]);   // a mix product, not 리쥬란
  assert.deepStrictEqual(Classify.products("레이저토닝 1회"), []);
});

test("mixOf: several products in one group", () => {
  const m = Classify.mixOf(["겨드랑이 제모(아포지 플러스)", "겨드랑이 제모(클라리티Ⅱ)", "겨드랑이 제모 1회"]);
  assert.strictEqual(m.mixed, true);
  assert.strictEqual(m.none, 1);
  assert.strictEqual(m.named.get("아포지 플러스"), 1);
});

test("row: A direct, B no product, C other product, D no amount", () => {
  const mix = Classify.mixOf(["겨드랑이 제모(아포지 플러스)", "겨드랑이 제모(클라리티Ⅱ)", "겨드랑이 제모 1회"]);
  assert.strictEqual(c({ name: "리쥬란힐러 2cc", keyLabel: "리쥬란힐러 2cc", mix: Classify.mixOf(["리쥬란힐러 2cc", "리쥬란 힐러 2cc 1회"]) }), "A");
  assert.strictEqual(c({ name: "겨드랑이 제모 1회", keyLabel: "(여) 겨드랑이 제모 1회", mix }), "B");
  assert.strictEqual(c({ name: "겨드랑이 제모(클라리티Ⅱ)", keyLabel: "(여) 겨드랑이 제모 1회", mix }), "C");
  assert.strictEqual(c({ name: "슈링크 유니버스", keyLabel: "슈링크 유니버스 300샷" }), "D");
});

test("row: E conditional, F bundle, G pass, H add-on, I posted price", () => {
  assert.strictEqual(c({ name: "슈링크 300샷 체험가", kind: 1, keyLabel: "슈링크 유니버스 300샷" }), "E");
  assert.strictEqual(c({ name: "슈링크 300샷", tags: ["첫 방문"], keyLabel: "슈링크 유니버스 300샷" }), "E");
  assert.strictEqual(c({ name: "슈링크 300샷 + 리쥬란 2cc", keyLabel: "슈링크 유니버스 300샷" }), "F");
  assert.strictEqual(c({ name: "피코토닝 + 진정관리", keyLabel: "피코토닝 1회" }), "A");   // a free extra is not a bundle
  assert.strictEqual(c({ name: "레이저토닝 이용권", sess: 99, keyLabel: "레이저토닝 1회" }), "G");
  assert.strictEqual(c({ name: "옵션2) 큐어스템 엑소좀 1회 추가", keyLabel: "엑소좀" }), "H");
  assert.strictEqual(c({ name: "인모드(1부위)", kind: 4, keyLabel: "인모드 1부위" }), "I");
});

test("row: R far from the group's middle, but a 체험가 below it is an event", () => {
  assert.strictEqual(c({ name: "점 빼기 1개", keyLabel: "점 빼기 1개 (2mm 이하)", price: 590000, median: 10000 }), "R");
  assert.strictEqual(c({ name: "점 빼기 1개 체험가", kind: 1, keyLabel: "점 빼기 1개 (2mm 이하)", price: 100, median: 10000 }), "E");
  assert.strictEqual(c({ name: "점 빼기 1개", keyLabel: "점 빼기 1개 (2mm 이하)", price: 9000, median: 10000 }), "A");
  assert.ok(Classify.row({ name: "x", price: 590000, median: 10000 }).why.includes("59.0배"));
});

test("every class has a label, a comparison level and a sentence", () => {
  for (const [k, v] of Object.entries(Classify.CLASSES)) {
    assert.ok(v.label && v.say, k);
    assert.ok(["direct", "caution", "reference", "never"].includes(v.cmp), k);
  }
});

test("isAddon: options sold only with another treatment stay out of a group's range and middle", () => {
  for (const n of ["옵션)히알라제(필러 녹이는 주사) 추가", "옵션) 항문 제모 1회 추가", "옵션2) 큐어스템 엑소좀 1회 추가",
    "포텐자 · 옵션1) 일반 팁 추가", "보톡스(국산 일반형) · 옵션)수면마취 추가", "[추가] 이마 보톡스"]) assert.equal(Classify.isAddon(n), true, n);
  for (const n of ["히알라제(필러 녹이는 주사)", "리쥬란 HB 플러스 2cc", "포텐자 1회", "", undefined]) assert.equal(Classify.isAddon(n), false, String(n));
});

test("hasAddonField: the build's add-on field (row field 15, 2026-10-15) is read once per file, older files fall back to the name", () => {
  // build2 C2 example rows: field 15 = 1 add-on, 0 not
  const rows = [[0, 0, 972, 100000, 0, 0, 546, 546, 1, -1, 707, 739, 2, 0, 546, 1], [0, 1, 705, 23000, 45500, 2, 546, 706, 1, 4604, 707, 708, 2, 0, 546, 0]];
  const cols = rows[0].map((_, f) => rows.map((r) => r[f]));
  assert.equal(Classify.ADDON_FIELD, 15);
  assert.equal(Classify.hasAddonField({ cols }), true);
  assert.equal(Classify.hasAddonField({ cols: cols.slice(0, 15) }), false);   // data.json from before: 15 fields
  assert.equal(Classify.hasAddonField({ rows }), true);                       // the older row form
  assert.equal(Classify.hasAddonField({ rows: rows.map((r) => r.slice(0, 15)) }), false);
  for (const d of [null, undefined, {}, { rows: [] }, { cols: [] }]) assert.equal(Classify.hasAddonField(d), false, JSON.stringify(d));
  // the decoded rows keep the field where the app moves it from (app.js applyData: r[19] = r[15] || 0); 15 fields read as 0
  const { rowsOf } = require("../app/domain/pricectx.js");
  assert.deepStrictEqual(rowsOf({ cols, colDelta: [] }).map((r) => r[15] || 0), [1, 0]);
  assert.deepStrictEqual(rowsOf({ cols: cols.slice(0, 15), colDelta: [] }).map((r) => r[15] || 0), [0, 0]);
});

test("row: the data's add-on call (o.addon) wins over the name rule; without it the name decides as before", () => {
  // '비용추가)' is a note inside a procedure price, not an add-on — the name rule calls it one, the build does not
  const note = "[국산] 헤어라인 다한증 보톡스 (면적에 따라 비용추가)";
  assert.equal(Classify.isAddon(note), true);
  assert.equal(c({ name: note, keyLabel: "다한증" }), "H");
  assert.notEqual(c({ name: note, keyLabel: "다한증", addon: false }), "H");
  // an add-on the site marks without the words the rule knows ('시술옵션 · 촉촉팩')
  assert.equal(Classify.isAddon("실펌 팁"), false);
  assert.equal(c({ name: "실펌 팁", addon: true }), "H");
  assert.equal(c({ name: "실펌 팁" }), c({ name: "실펌 팁", addon: undefined }));
  // the price-jump check still comes first
  assert.equal(c({ name: "실펌 팁", addon: true, price: 1000, median: 100000 }), "R");
});
