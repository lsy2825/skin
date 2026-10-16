// 가격 줄 번호 (지시서 C8, C의 PR #54): the app-side copy of build2/rowid.py — the same id for a price row in every build
// while the clinic lists the same option, so that a later 'send only the rows that changed' update can name rows. The rule
// is C's, spelled out in the header of build2/rowid.py; this file follows it to the character and tests/rowid.test.js
// checks it against C's 72 rows (tests/fixtures/rowid_vectors.json). Change the rule there first, never only here.
//   base   = brand|branch|name|price kind, the name without the spaces of JavaScript's /\s/ (SPACE below, written out so
//            it cannot drift with a newer Unicode) and with only A-Z lower-cased (not toLowerCase: 'İ', 'Ä', 'Ｈ' stay)
//   root   = FNV-1a 64-bit (BigInt) over the UTF-8 bytes of base, its top 51 bits in base 36, left-padded to 10 letters
//   clash  = distinct bases in code-point order; a base whose root an earlier one owns gets 'x' (again until free)
//   repeat = rows of one base by address (url), list price (none = 0), sale price, data order → root, root~2, root~3 …
// Strings are compared by code point (cmp below), not with '<', sort() or localeCompare: those order by UTF-16 units
// (names hold emoji above U+FFFF) or by locale, and Python orders by code point.
//
// Not used by any screen yet, and not loaded in index.html (C: no screen needs it until the changed-rows update). An id is
// NOT a key for anything a person saves — favourites, carts and alerts keep comparison keys: a '~N' id moves when a row of
// its base is added, removed or moved, and two rows of one page can swap ids (build2/rowid.py 'When an id moves').
// ids(data) numbers every row of a parsed data.json in its order with the prices as the file has them. app.js applyData()
// adds VAT to the prices in place (and decodes the columns in place), so call ids() on the parsed file before applyData,
// or on a copy — never on home.json (only some rows: '~N' and 'x' look at all rows of a base; ids() refuses meta.partial).
// It reads row fields 0, 2-5 and 11 only, so files from before the 2026-10-15 fields (15-16 per row) number the same way.
// About 1 s for all 142,580 rows in Node 22 (about a third of it the BigInt hash): when a screen uses it, run it in a worker.
// Needs BigInt (Chrome 67, Firefox 68, Safari 14) and TextEncoder. window.RowId in a browser, require()d by tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RowId = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // exactly JavaScript's /\s/ (U+0009-000D, U+0020, U+00A0, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000,
  // U+FEFF) — the same list as build2/rowid.py SPACE. Not Python's \s (that also takes U+001C-001F and U+0085)
  const SPACE_SET = "[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";
  const SPACE = new RegExp(SPACE_SET), SPACES = new RegExp(SPACE_SET, "g");
  const PRICE = new RegExp("^" + SPACE_SET + "*([0-9]+)");   // the leading whole won: 0-9 only, after the same spaces
  const OFFSET = BigInt("0xcbf29ce484222325"), PRIME = BigInt("0x100000001b3"), SHIFT = BigInt(13);
  const BYTE = Array.from({ length: 256 }, (_, i) => BigInt(i));
  const UTF8 = new TextEncoder();

  // option name → the name the id reads: the spaces above removed, only A-Z lower-cased
  function loose(name) {
    return String(name || "").replace(SPACES, "").replace(/[A-Z]/g, (c) => c.toLowerCase());
  }
  function base(brand, branch, name, kind) {
    return `${brand}|${branch}|${loose(name)}|${kind}`;
  }

  // FNV-1a 64-bit over the UTF-8 bytes of s → BigInt. (A lone surrogate becomes U+FFFD here; Python would refuse it.
  // data.json is written by json.dump from valid text, so it has none.)
  function fnv1a64(s) {
    let h = OFFSET;
    for (const b of UTF8.encode(s)) h = BigInt.asUintN(64, (h ^ BYTE[b]) * PRIME);
    return h;
  }
  // the top 51 bits of a 64-bit hash in base 36 (0-9a-z), left-padded with '0' to 10 letters
  const rootOfHash = (h) => (h >> SHIFT).toString(36).padStart(10, "0");
  const rootOf = (b) => rootOfHash(fnv1a64(b));

  // code-point order of two strings (Python's str order): -1, 0 or 1. At the first UTF-16 unit that differs, read the
  // whole code point there; a high surrogate just before it (equal in both) starts that code point
  function cmp(a, b) {
    if (a === b) return 0;
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    if (i === n) return a.length < b.length ? -1 : 1;
    if (i > 0) {
      const p = a.charCodeAt(i - 1);
      if (p >= 0xd800 && p <= 0xdbff) {
        const x = a.codePointAt(i - 1), y = b.codePointAt(i - 1);
        if (x !== y) return x < y ? -1 : 1;   // equal only when both are a lone high surrogate: the next code point decides
      }
    }
    return a.codePointAt(i) < b.codePointAt(i) ? -1 : 1;
  }

  // a price as whole won: ',' removed, the spaces above skipped, then the leading digits 0-9; none = 0.
  // 23000 → 23000, '1,200,000' → 1200000, ' 5' → 5, '' → 0, null → 0. A Number, or a BigInt above 2^53 so the order stays
  // exact like Python's int (data.json prices are whole numbers far below that; '<' compares a BigInt with a Number exactly).
  // Only prices written as text keep that: a JSON number above 2^53 is already rounded by JSON.parse (Python's json keeps it),
  // and a number in exponent form reads differently (Python str(1e16) '1e+16' → 1, JS '10000000000000000'; 0.00001 → 1 vs 0)
  function price(x) {
    const m = PRICE.exec(String(x ?? 0).replace(/,/g, ""));
    if (!m) return 0;
    const v = Number(m[1]);
    return Number.isSafeInteger(v) ? v : BigInt(m[1]);
  }
  const order = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

  // distinct bases → Map(base → root), a clash settled in code-point order ('x' for the later base, again until free).
  // root(base) is rootOf unless a test gives another
  function roots(bases, root = rootOf) {
    const out = new Map(), owner = new Set();
    for (const b of [...new Set(bases)].sort(cmp)) {
      let h = root(b);
      while (owner.has(h)) h += "x";
      owner.add(h);
      out.set(b, h);
    }
    return out;
  }

  // the ids of n rows: bases[i], urls[i] (string), origs[i] and sales[i] (from price) → ids in the same order
  function number(bases, urls, origs, sales, root) {
    const n = bases.length, rt = roots(bases, root), byBase = new Map(), out = new Array(n);
    for (let i = 0; i < n; i++) {
      const g = byBase.get(bases[i]);
      if (g) g.push(i); else byBase.set(bases[i], [i]);
    }
    for (const [b, g] of byBase) {
      const r = rt.get(b);
      if (g.length > 1) g.sort((i, j) => cmp(urls[i], urls[j]) || order(origs[i], origs[j]) || order(sales[i], sales[j]) || i - j);
      g.forEach((i, k) => { out[i] = k ? `${r}~${k + 1}` : r; });
    }
    return out;
  }

  // rows as objects { brand, branch, name, kind, orig, sale, url } (tests/fixtures/rowid_vectors.json) → ids, in order
  function rowIds(rows, root) {
    return number(rows.map((r) => base(r.brand, r.branch, r.name, r.kind)), rows.map((r) => String(r.url || "")),
      rows.map((r) => price(r.orig)), rows.map((r) => price(r.sale)), root);
  }

  // a parsed data.json (columns as the file has them, or already decoded rows) → the id of every row, in data order.
  // Reads only; the columns are not decoded in place. Row r: brand meta.brands[branches[r[0]][0]][0], branch
  // s[branches[r[0]][1]], name s[r[2]], kind meta.kinds[r[5]] (the name), orig r[4], sale r[3], url s[r[11]]
  function ids(data) {
    if (!data || !data.meta || !Array.isArray(data.branches) || !Array.isArray(data.s)) throw new TypeError("RowId.ids: data.json이 아니에요");
    if (data.meta.partial) throw new Error("RowId.ids: home.json(일부 줄)이에요 — 번호는 data.json 전체 줄로 매겨요");
    const field = fields(data), s = data.s, br = data.branches, brands = data.meta.brands, kinds = data.meta.kinds;
    const bi = field(0), nm = field(2), sale = field(3), orig = field(4), kd = field(5), url = field(11), n = bi.length;
    const bases = new Array(n), urls = new Array(n), origs = new Array(n), sales = new Array(n);
    for (let j = 0; j < n; j++) {
      const b = br[bi[j]];
      bases[j] = base(brands[b[0]][0], s[b[1]], s[nm[j]], kinds[kd[j]]);
      urls[j] = String(s[url[j]] || "");
      origs[j] = price(orig[j]);
      sales[j] = price(sale[j]);
    }
    return number(bases, urls, origs, sales);
  }
  // field f of every row: from data.rows, or from data.cols (fields in colDelta are differences from the row before —
  // summed into a new list, the file's own list is left as it is)
  function fields(data) {
    if (Array.isArray(data.rows)) return (f) => data.rows.map((r) => r[f]);
    if (!Array.isArray(data.cols)) throw new TypeError("RowId.ids: rows도 cols도 없어요");
    const delta = new Set(data.colDelta || []);
    return (f) => {
      const c = data.cols[f];
      if (!delta.has(f)) return c;
      const out = new Array(c.length);
      let a = 0;
      for (let j = 0; j < c.length; j++) out[j] = a += c[j];
      return out;
    };
  }

  return { SPACE, loose, base, fnv1a64, rootOfHash, rootOf, cmp, price, roots, rowIds, ids };
});
