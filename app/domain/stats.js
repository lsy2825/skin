// Comparison statistics and list orders: per-branch lowest price of one option, where a price stands among branches,
// branch price levels, and the orders a branch list can take (docs/OBJECTIVE_DISPLAY_POLICY.md). Pure functions, no DOM.
// window.Stats in the app, require()d by tests/stats.test.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Stats = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // middle value of numbers sorted ascending (the mean of the two middle ones for an even count); 0 when empty
  const medianSorted = (s) => { const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

  // rows of one option at many branches → { per: Map(branch → {p, i}) lowest price per branch, prices ascending, med }.
  // idxs: row indexes; row(i) → [branch, , , price, …]; keep(i) → false to leave a row out (event over, 특가 off …)
  function groupStat(idxs, row, keep = () => true) {
    const per = new Map();
    for (const i of idxs) {
      if (!keep(i)) continue;
      const r = row(i), cur = per.get(r[0]);
      if (!cur || r[3] < cur.p) per.set(r[0], { p: r[3], i });
    }
    const prices = [...per.values()].map((x) => x.p).sort((a, b) => a - b);
    return { per, prices, med: medianSorted(prices) };
  }

  // where one price stands among the branches of a groupStat: {rank (1 = lowest, ties share), n, vsMed (−0.12 = 12% below
  // the median)}; null with fewer than 3 branches (too few to say anything)
  function position(price, stat) {
    if (!stat || stat.prices.length < 3) return null;
    return { rank: stat.prices.filter((p) => p < price).length + 1, n: stat.prices.length, vsMed: stat.med ? price / stat.med - 1 : 0 };
  }

  // branches with a price level (geometric mean of price / median: 0.81 = 19% below the middle branch) → lowest level
  // first; branches without a level are left out
  const byLevel = (list) => list.filter((x) => x.lv != null).sort((a, b) => a.lv - b.lv);

  // the orders a branch list can take. list items: {b: branch, p: price, d: km or null}. ctx: regionCmp(b1, b2) (region,
  // then name), verified(b) → 'YYYY-MM-DD', hasLoc (a place to measure from is set).
  // 'region' (default view) · 'near' · 'recent' (newest check first) · 'priceDesc' · anything else = price ascending,
  // equal prices newer check first, then nearer. Never reorders by anything a clinic could pay for.
  const SORTS = ["region", "near", "recent", "price", "priceDesc"];
  function order(list, sort, ctx) {
    const { regionCmp, verified, hasLoc } = ctx;
    const cmp = {
      near: (x, y) => (hasLoc ? (x.d ?? 1e9) - (y.d ?? 1e9) : 0) || regionCmp(x.b, y.b),
      region: (x, y) => regionCmp(x.b, y.b),
      recent: (x, y) => verified(y.b).localeCompare(verified(x.b)) || regionCmp(x.b, y.b),
      priceDesc: (x, y) => y.p - x.p || regionCmp(x.b, y.b),
    }[sort] || ((x, y) => x.p - y.p || verified(y.b).localeCompare(verified(x.b)) || (x.d ?? 1e9) - (y.d ?? 1e9));
    return list.sort(cmp);
  }

  return { medianSorted, groupStat, position, byLevel, order, SORTS };
});
