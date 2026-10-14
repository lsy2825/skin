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
  // THE median every screen, report, Jomi answer and push notice prints (round-2 review R03: one rule everywhere):
  // any order in, the mean of the two middle values for an even count, rounded to whole won; null when empty
  const median = (xs) => { const s = [...xs].filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? Math.round(medianSorted(s)) : null; };

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

  // price observations of one group over time (round-2 R13: a snapshot is NOT a week). dates: ['YYYY-MM-DD'] (collection
  // dates), vals: [[median, min, n] | null] aligned with dates → { n: observations, first, last, spanDays, weeks: distinct
  // ISO weeks observed, maxGapWeeks, minBranches }. Two snapshots a day apart are 2 observations in 1 week.
  function isoWeek(d) {
    const t = new Date(d + "T00:00:00Z"), day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    const y = t.getUTCFullYear(), first = new Date(Date.UTC(y, 0, 4));
    return `${y}-W${String(1 + Math.round(((t - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7)).padStart(2, "0")}`;
  }
  function observations(dates, vals) {
    const pts = (dates || []).map((d, i) => vals && vals[i] ? { d, n: vals[i][2] || 0 } : null).filter(Boolean);
    if (!pts.length) return { n: 0, first: null, last: null, spanDays: 0, weeks: 0, maxGapWeeks: 0, minBranches: 0 };
    const wk = [...new Set(pts.map((p) => isoWeek(p.d)))].sort();
    const wnum = (w) => { const [y, n] = w.split("-W").map(Number); return y * 53 + n; };
    let gap = 0; for (let i = 1; i < wk.length; i++) gap = Math.max(gap, wnum(wk[i]) - wnum(wk[i - 1]));
    const first = pts[0].d, last = pts[pts.length - 1].d;
    return { n: pts.length, first, last, spanDays: Math.round((Date.parse(last) - Date.parse(first)) / 86400000), weeks: wk.length, maxGapWeeks: gap,
      minBranches: Math.min(...pts.map((p) => p.n)) };
  }
  // a short honest label: '관측 2회 · 10/13~10/14' (never 'N주' unless N distinct weeks were observed)
  const obsLabel = (o) => !o.n ? "관측 없음" : o.n === 1 ? `관측 1회 · ${o.first.slice(5).replace("-", "/")}`
    : `관측 ${o.n}회 · ${o.first.slice(5).replace("-", "/")}~${o.last.slice(5).replace("-", "/")}${o.weeks >= 2 ? ` (서로 다른 ${o.weeks}주)` : ""}`;

  return { median, observations, obsLabel, isoWeek, medianSorted, groupStat, position, byLevel, order, SORTS };
});
