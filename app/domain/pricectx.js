// The price context (once read by the 5.0 premium reports, removed in 6.0; now by Jomi's chat checks in node — jomichat.js
// ctxFromData, tools/jomi_chat_eval.js — and tests): built from data.json or from the app's
// already-loaded rows (the app passes its own accessors). Only collected prices: no estimate, no fill-in, no model output.
// Raw data.json row (build2/appdata.py ROW_FIELDS): 0 branch · 2 name · 3 listed price · 5 kind (1/2 special) · 6 conditions ·
// 7 key ids (space separated) · 8 sessions · 10 until · 12 VAT (1 included, 2 별도) · 13 jump waiting for review.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./pricing.js"), require("./match.js"), require("./stats.js"));
  else root.PriceCtx = factory(root.Pricing, root.Match, root.Stats);
})(typeof self !== "undefined" ? self : this, function (Pricing, Match, Stats) {
  "use strict";
  const median = Stats.median;                                 // one median for every screen (round-2 R03)

  // data.json columns → rows (same as app.js rowsOf, without touching the input)
  function rowsOf(d) {
    if (d.rows) return d.rows;
    const c = d.cols.map((x) => x.slice()), n = c[0].length, rows = new Array(n);
    for (const f of d.colDelta || []) { let a = 0; const x = c[f]; for (let j = 0; j < n; j++) x[j] = a += x[j]; }
    for (let j = 0; j < n; j++) { const r = new Array(c.length); for (let f = 0; f < c.length; f++) r[f] = c[f][j]; rows[j] = r; }
    return rows;
  }

  // opts: { rows, S, branches, keys, trend, updated, today, brands, price(r), live(r) } — price/live default to the raw layout
  function build(o) {
    const S = o.S, td = o.today;
    const price = o.price || ((r) => r[3]);
    const live = o.live || ((r) => !r[13] && !Pricing.isExpired(S[r[10]] || "", td));
    const special = (r) => r[5] === 1 || r[5] === 2 || (S[r[6]] || "") !== "";
    const firstVisit = (r) => (S[r[6]] || "").split("·").includes("첫 방문");
    const region = (b) => S[o.branches[b][5]] || "";
    const label = new Map(o.keys.map(([id, , l]) => [id, l]));
    const byKey = new Map();                                   // key → branch → [row index]
    o.rows.forEach((r, i) => {
      const ks = S[r[7]];
      if (!ks || !live(r)) return;
      for (const id of ks.split(" ")) { if (!byKey.has(id)) byKey.set(id, new Map()); const m = byKey.get(id); if (!m.has(r[0])) m.set(r[0], []); m.get(r[0]).push(i); }
    });
    // each branch's lowest live price for the key (one number per branch: a branch with ten options does not count ten times)
    function prices(id, reg) {
      const m = byKey.get(id), out = [];
      if (!m) return out;
      for (const [b, ids] of m) {
        if (reg && region(b) !== reg) continue;
        let best = null;                                       // a row index: 0 is a real row, so test for null (round-2 R04)
        for (const i of ids) if (best === null || price(o.rows[i]) < price(o.rows[best])) best = i;
        out.push({ b, p: price(o.rows[best]), region: region(b), vat: o.rows[best][12], row: best });
      }
      return out;
    }
    function brandStats(id) {
      const by = new Map();
      for (const x of prices(id, "")) { const br = o.branches[x.b][0]; if (!by.has(br)) by.set(br, []); by.get(br).push(x.p); }
      return [...by].map(([br, v]) => ({ brand: (o.brands[br] || [])[0] || String(br), n: v.length, min: Math.min(...v), median: median(v) })).sort((a, b) => b.n - a.n);
    }
    // the free cart engine, unchanged (Pricing.lineCost / limitOnce / compareClinics); items [{k, q}]
    function cart(items, reg) {
      const cands = (k, b, noOnce) => ((byKey.get(k) || new Map()).get(b) || []).filter((i) => !noOnce || !firstVisit(o.rows[i]))
        .map((i) => ({ i, p: price(o.rows[i]), special: special(o.rows[i]) }));
      const line = (it, b, noOnce) => { const c = cands(it.k, b, noOnce); return Pricing.lineCost(c, c.filter((x) => !x.special), it.q || 1, null); };
      const matrix = [];
      for (let b = 0; b < o.branches.length; b++) {
        if (reg && region(b) !== reg) continue;
        let lines = items.map((it) => line(it, b, false));
        if (!lines.some(Boolean)) continue;
        lines = Pricing.limitOnce(lines, lines.map((l) => !!l && firstVisit(o.rows[l.rows[0]])), (j) => line(items[j], b, true));
        matrix.push({ b, lines });
      }
      return Pricing.compareClinics(matrix);
    }
    const regions = () => [...new Set(o.branches.map((_, b) => region(b)))].filter(Boolean);
    return {
      today: td, updated: o.updated, trend: o.trend || { dates: [], k: {} }, brands: (o.brands || []).map((x) => x[0]),
      keys: Match.catalog(o.keys.filter(([id]) => byKey.has(id))), label: (id) => label.get(id) || id,
      prices, brandStats, cart, regions,
    };
  }
  function fromData(d, today) {
    return build({ rows: rowsOf(d), S: d.s, branches: d.branches, keys: d.keys, trend: d.trend, updated: d.meta.updated, today, brands: d.meta.brands });
  }
  return { build, fromData, rowsOf, median };
});
