// domain/rowid.js — 가격 줄 번호 (지시서 C8, C의 PR #54): the app's copy of build2/rowid.py. C's 72 rows with their ids
// (tests/fixtures/rowid_vectors.json), then each step of the rule on its own: the space list, A-Z only, the hash and the
// 10 letters, the price reading, code-point order, the clash 'x', the '~N' order and ids() on a column-packed data.json.
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../app/domain/rowid.js");
const V = require("./fixtures/rowid_vectors.json");

test("C's 72 vector rows: every id exactly as build2/rowid.py gives it", () => {
  assert.equal(V.rows.length, 72);
  const got = R.rowIds(V.rows);
  V.rows.forEach((r, i) => assert.equal(got[i], r.id, `row ${i}: ${r.brand}|${r.branch}|${r.name}`));
  assert.ok(got.some((x) => /^[0-9a-z]{10}x(~\d+)?$/.test(x)) && got.some((x) => /~8$/.test(x)), "the vectors hold a clash and a '~8'");
});

test("FNV-1a 64-bit: the published test values, and the root is the top 51 bits in base 36, 10 letters", () => {
  assert.equal(R.fnv1a64(""), BigInt("0xcbf29ce484222325"));
  assert.equal(R.fnv1a64("a"), BigInt("0xaf63dc4c8601ec8c"));
  assert.equal(R.fnv1a64("foobar"), BigInt("0x85944171f73967e8"));
  assert.equal(R.fnv1a64("가"), BigInt.asUintN(64, ((BigInt.asUintN(64, ((BigInt.asUintN(64, (BigInt("0xcbf29ce484222325") ^ BigInt(0xea)) * BigInt("0x100000001b3")))
    ^ BigInt(0xb0)) * BigInt("0x100000001b3"))) ^ BigInt(0x80)) * BigInt("0x100000001b3")), "UTF-8 bytes (EA B0 80), not UTF-16 units");
  assert.equal(R.rootOfHash(BigInt(0)), "0000000000");
  assert.equal(R.rootOfHash(BigInt(8191)), "0000000000", "the low 13 bits are dropped");
  assert.equal(R.rootOfHash(BigInt(8192)), "0000000001");
  assert.equal(R.rootOfHash(BigInt.asUintN(64, BigInt(-1))), (2 ** 51 - 1).toString(36));
  assert.equal(R.rootOfHash(BigInt.asUintN(64, BigInt(-1))).length, 10);
  assert.equal(R.rootOf(""), "hnwe1ar575");   // python: rowid.short_id("")
});

test("spaces: exactly JavaScript's /\\s/ over every code point — not Python's \\s, not U+200B", () => {
  const listed = [0x9, 0xa, 0xb, 0xc, 0xd, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
    0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];
  const found = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    const ch = String.fromCodePoint(cp);
    if (R.SPACE.test(ch)) found.push(cp);
    if (cp < 0xd800 || cp > 0xdfff) assert.equal(R.SPACE.test(ch), /\s/.test(ch), `U+${cp.toString(16)}`);
  }
  assert.deepEqual(found, listed);
  for (const cp of [0x1c, 0x1d, 0x1e, 0x1f, 0x85, 0x180e, 0x200b, 0x2060]) assert.equal(R.loose(`a${String.fromCodePoint(cp)}b`).length, 3, `U+${cp.toString(16)} stays`);
  assert.equal(R.loose("리쥬란　HB\tPLUS\n2cc﻿   "), "리쥬란hbplus2cc");
  assert.equal(R.loose(null), "");
  assert.equal(R.base("블리비", "강남역점", " 리쥬란 HB 2cc ", "일반"), "블리비|강남역점|리쥬란hb2cc|일반", "only the name is loosened");
  assert.equal(R.base("블리비 ", "강남 역점", "x", "체험가"), "블리비 |강남 역점|x|체험가");
});

test("lower case: only A-Z — not İ, Ä, Σ or full-width Ｈ (toLowerCase would change them)", () => {
  assert.equal(R.loose("ABC xyz"), "abcxyz");
  assert.equal(R.loose("ＨＢ 리쥬란 İ Ä Σ 2CC"), "ＨＢ리쥬란İÄΣ2cc");
  assert.notEqual(R.loose("İ"), "İ".toLowerCase());
  assert.equal(R.loose("@[`{"), "@[`{", "the neighbours of A-Z stay");
});

test("price: the leading whole won after ',' and the spaces — the rule's examples and the edges", () => {
  const cases = [[23000, 23000], ["1,200,000", 1200000], [" 5", 5], ["", 0], [null, 0], [undefined, 0], [0, 0],
    ["　 7", 7], ["﻿9", 9], ["12만원", 12], ["원 12", 0], ["abc", 0], ["-5", 0], ["+5", 0], ["1e3", 1], ["1.9", 1],
    ["٣", 0], ["３", 0], ["\u0085 5", 0], ["​5", 0], [false, 0], [true, 0], [23000.0, 23000], ["007", 7]];
  for (const [x, want] of cases) assert.equal(R.price(x), want, JSON.stringify(x));
  // above 2^53 the digits stay exact (Python reads them as an int), and the order with a Number is exact too
  assert.equal(R.price("99999999999999999999"), BigInt("99999999999999999999"));
  assert.ok(R.price("9007199254740993") > R.price("9007199254740992"));
  assert.ok(R.price("9007199254740993") > 9007199254740991);
});

// the code points of a string as Python sees them (a lone surrogate is one code point)
const cps = (s) => Array.from(s, (c) => c.codePointAt(0));
function refCmp(a, b) {
  const x = cps(a), y = cps(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

test("code-point order: a character above U+FFFF sorts after U+FF5E, unlike '<', sort() and localeCompare", () => {
  const emoji = "😀clash", wave = "～clash";   // U+1F600 (UTF-16 D83D DE00) vs U+FF5E
  assert.equal(R.cmp(emoji, wave), 1);
  assert.equal(R.cmp(wave, emoji), -1);
  assert.ok(emoji < wave, "UTF-16 order is the other way — the mistake the rule warns about");
  assert.deepEqual([emoji, wave].sort(), [emoji, wave]);
  assert.deepEqual([emoji, wave, "a", "가"].sort(R.cmp), ["a", "가", wave, emoji]);
  assert.equal(R.cmp("B", "a"), -1, "upper case before lower case");
  assert.equal(R.cmp("abc", "abc"), 0);
  assert.equal(R.cmp("ab", "abc"), -1);
  assert.equal(R.cmp("😀", "😁"), -1, "pairs that differ in the low half");
  assert.equal(R.cmp("\ud800", ""), -1, "a lone surrogate is the code point U+D800");
  assert.equal(R.cmp("\ud800a", "\ud800b"), -1, "two lone high surrogates, then the next code point");
  assert.equal(R.cmp("\ud83d", "😀"), -1);
  assert.equal(R.cmp("\ud83d", "😀"), -1, "lone U+D83D then U+E000 vs U+1F600");
  // against the code points themselves, on strings made of the units where UTF-16 and code-point order part
  const units = ["a", "B", "가", "", "～", "￿", "\ud83d", "\ude00", "😀", "😁", "􏿿", "\ud800"];
  let x = 2463534242;   // xorshift32: the same words on every run
  const rnd = (n) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
  const word = () => Array.from({ length: 1 + rnd(6) }, () => units[rnd(units.length)]).join("");
  const seen = new Set();
  for (let k = 0; k < 20000; k++) {
    const a = word(), b = rnd(3) ? word() : a + word();
    seen.add(a);
    assert.equal(R.cmp(a, b), refCmp(a, b), JSON.stringify([a, b]));
  }
  assert.ok(seen.size > 10000, `${seen.size} different words`);
});

test("clash: bases in code-point order, the later base gets 'x' (again until free) — with an injected root", () => {
  const same = () => "aaaaaaaaaa";
  const r = R.roots(["b", "😀", "～", "a", "b"], same);
  assert.deepEqual([...r], [["a", "aaaaaaaaaa"], ["b", "aaaaaaaaaax"], ["～", "aaaaaaaaaaxx"], ["😀", "aaaaaaaaaaxxx"]]);
  // a base whose own root is an 'x' name another base already took
  const r2 = R.roots(["p", "q", "r"], (b) => ({ p: "k", q: "k", r: "kx" })[b]);
  assert.deepEqual([...r2], [["p", "k"], ["q", "kx"], ["r", "kxx"]]);
  // and the ids: every row of the later base carries the 'x', its repeats '~2'
  const rows = [{ brand: "B", branch: "b", name: "q", kind: "일반", sale: 1 }, { brand: "B", branch: "b", name: "p", kind: "일반", sale: 1 },
    { brand: "B", branch: "b", name: "q", kind: "일반", sale: 2 }];
  assert.deepEqual(R.rowIds(rows, () => "rrrrrrrrrr"), ["rrrrrrrrrrx", "rrrrrrrrrr", "rrrrrrrrrrx~2"]);
  // the real clashes C made for the vectors: one root for two bases, and the emoji pair settled by code point
  const b1 = R.base("블리비", "강남역점", "clash85a7i8h9pp", "일반"), b2 = R.base("블리비", "강남역점", "clash2i7gye1en7", "일반");
  assert.equal(R.rootOf(b1), R.rootOf(b2));
  assert.equal(R.roots([b1, b2]).get(b1), R.rootOf(b1) + "x");
  const e1 = R.base("블리비", "강남역점", "😀clash3vzmqfaprv", "일반"), e2 = R.base("블리비", "강남역점", "～clash81k65u12pm", "일반");
  assert.equal(R.rootOf(e1), R.rootOf(e2));
  assert.deepEqual([...R.roots([e1, e2]).values()], ["2c670k18z2", "2c670k18z2x"]);
  assert.equal(R.roots([e1, e2]).get(e1), "2c670k18z2x", "U+1F600 after U+FF5E: the emoji base carries the 'x'");
});

test("repeat '~N': address (code point) → list price (none = 0 first) → sale price → data order", () => {
  const row = (url, orig, sale) => ({ brand: "블리비", branch: "강남역점", name: "같은 이름", kind: "일반", url, orig, sale });
  const rows = [row("https://e.test/b", 0, 1), row("https://e.test/B", 50, 9), row("https://e.test/a", 30, 5), row("https://e.test/a", 30, 4),
    row("https://e.test/a", null, 8), row("https://e.test/a", 30, 4), row(undefined, 99, 99), row("https://e.test/a", "1,000", 1)];
  const id = R.rowIds(rows), r = R.rootOf(R.base("블리비", "강남역점", "같은이름", "일반"));
  // order: '' (no address) · B · a: none(8) · 30:4 (row 3) · 30:4 (row 5) · 30:5 · 1000:1 · b
  assert.deepEqual(id, [`${r}~8`, `${r}~2`, `${r}~6`, `${r}~4`, `${r}~3`, `${r}~5`, r, `${r}~7`]);
  assert.equal(new Set(R.rowIds([row("u", 1, 1), row("u", 1, 1)])).size, 2, "two equal rows still get two ids");
  assert.deepEqual(R.rowIds([row("u", 0, 10), row("u", 0, 9)]).map((x) => x.slice(10)), ["~2", ""], "prices compare as numbers, not text");
  assert.deepEqual(R.rowIds([row("u", 0, "10"), row("u", 0, 2)]).map((x) => x.slice(10)), ["~2", ""]);
  assert.deepEqual(R.rowIds([row("https://e.test/😀", 0, 1), row("https://e.test/～", 0, 2)]).map((x) => x.slice(10)), ["~2", ""], "addresses by code point too");
});

// a small data.json the way build2/appdata.py writes it: rows as columns, field 2 (name) as differences from the row before
function packed() {
  const s = ["강남역점", "https://e.test/a", "리쥬란 HB 2cc", "리쥬란HB 2cc", "https://e.test/B", "홍대점", "여드름 관리"];
  const rows = [[0, 0, 2, 290000, 0, 0], [0, 0, 3, 250000, 300000, 0], [1, 0, 6, 59000, 0, 1], [0, 0, 2, 250000, 0, 0], [0, 0, 3, 250000, 0, 0]]
    .map(([b, , n, sale, orig, kind], j) => [b, 0, n, sale, orig, kind, 0, 0, 1, -1, 0, j === 1 ? 4 : 1, 2, 0, 0, 0]);
  const cols = rows[0].map((_, f) => rows.map((r) => r[f]));
  cols[2] = cols[2].map((x, j) => x - (j ? cols[2][j - 1] : 0));
  return { meta: { brands: [["블리비", "#000", ""], ["쁨", "#111", ""]], kinds: ["일반", "체험가", "한정가", "구독권", "고시가"] },
    branches: [[0, 0, 0, 37.5, 127, 0, 0, 0, 0, 0], [1, 5, 0, 37.5, 127, 0, 0, 0, 0, 0]], cols, colDelta: [2], s, keys: [] };
}

test("ids(data): a column-packed data.json read as the rule's rows, and the file left as it was", () => {
  const D = packed(), before = JSON.stringify(D);
  const id = R.ids(D);
  assert.equal(JSON.stringify(D), before, "columns not decoded in place (app.js applyData does that later)");
  const objects = [
    { brand: "블리비", branch: "강남역점", name: "리쥬란 HB 2cc", kind: "일반", orig: 0, sale: 290000, url: "https://e.test/a" },
    { brand: "블리비", branch: "강남역점", name: "리쥬란HB 2cc", kind: "일반", orig: 300000, sale: 250000, url: "https://e.test/B" },
    { brand: "쁨", branch: "홍대점", name: "여드름 관리", kind: "체험가", orig: 0, sale: 59000, url: "https://e.test/a" },
    { brand: "블리비", branch: "강남역점", name: "리쥬란 HB 2cc", kind: "일반", orig: 0, sale: 250000, url: "https://e.test/a" },
    { brand: "블리비", branch: "강남역점", name: "리쥬란HB 2cc", kind: "일반", orig: 0, sale: 250000, url: "https://e.test/a" }];
  assert.deepEqual(id, R.rowIds(objects));
  const r = R.rootOf("블리비|강남역점|리쥬란hb2cc|일반");
  assert.deepEqual(id, [`${r}~4`, r, R.rootOf("쁨|홍대점|여드름관리|체험가"), `${r}~2`, `${r}~3`]);
  // already decoded rows (tests/e2e/rows.js) give the same ids
  const rows = require("./e2e/rows.js")(packed());
  assert.deepEqual(R.ids(rows), id);
  // the prices are read from r[3] (sale) and r[4] (list) as given — prices changed in place (applyData adds VAT) can move
  // the '~N' ids, so ids() runs on the file as it came
  const moved = require("./e2e/rows.js")(packed());
  moved.rows[0][3] = 1;
  assert.deepEqual(R.ids(moved), [`${r}~2`, r, id[2], `${r}~3`, `${r}~4`]);
  moved.rows[3][4] = 5;
  assert.deepEqual(R.ids(moved), [`${r}~2`, r, id[2], `${r}~4`, `${r}~3`]);
  // one address where list-price order and sale order part: catches reading r[3] and r[4] the wrong way round
  const swap = packed(); swap.cols[3][4] = 260000; swap.cols[4][3] = 280000;
  assert.deepEqual(R.ids(swap), [`${r}~3`, r, id[2], `${r}~4`, `${r}~2`], "orig is r[4], sale is r[3]");   // python: the same
});

test("ids(data): refuses home.json (only some rows) and what is not a data.json", () => {
  const D = packed();
  D.meta.partial = { rows: 5, keys: [], cats: [], fn: [] };
  assert.throws(() => R.ids(D), /home\.json/);
  assert.throws(() => R.ids(null), TypeError);
  assert.throws(() => R.ids({ meta: {}, branches: [], s: [] }), TypeError);
});
