// Price calculation domain logic, independent of the UI (requirement 4.3). Loaded as window.Pricing in the app and
// with require() in tests (tests/pricing.test.js). No DOM, no globals; prices are integer KRW.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Pricing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- VAT: listed price → price on the chosen basis. vat: 0 unknown · 1 포함 · 2 별도. mode: "incl" | "listed"
  function vatPrice(listed, vat, mode) {
    return mode === "incl" && vat === 2 ? Math.round(listed * 1.1) : listed;
  }

  // ---- event end date: "YYYY-MM-DD" before today (also "YYYY-MM-DD") = over; other values ('', 'posted:…') never expire
  function isExpired(until, today) {
    return /^\d{4}-\d{2}-\d{2}$/.test(until || "") && until < today;
  }

  // ---- visit date/time conditions
  // Public holidays incl. substitute days, compiled 2026-10-13 (verify against the government notice; see docs).
  const KR_HOLIDAYS = {
    "2026-12-25": "성탄절", "2027-01-01": "신정", "2027-02-05": "설 연휴", "2027-02-06": "설날", "2027-02-07": "설 연휴",
    "2027-02-08": "대체공휴일", "2027-03-01": "삼일절", "2027-05-05": "어린이날", "2027-05-13": "부처님오신날", "2027-06-06": "현충일",
  };
  // '[평일5시이전]' / '평일 오후 2시 이전' → minutes from midnight (hours 1–8 read as afternoon); null = not stated
  function parseCutoff(name) {
    const m = /(?:평일|프라임)[^0-9]{0,8}(\d{1,2})\s*시\s*(\d{1,2}\s*분)?\s*(?:이전|전|까지)/.exec(name || "");
    if (!m) return null;
    let hr = +m[1];
    if (hr >= 1 && hr <= 8) hr += 12;
    return hr * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  }
  // tags: "평일 낮·일요일·…" ; when: {date: "YYYY-MM-DD", time: "HH:MM" | ""} or null.
  // returns 0 ok · 1 not valid on that visit · 2 valid by day but the time window isn't stated (check with the clinic)
  function condState(tags, name, when, holidays = KR_HOLIDAYS) {
    if (!when || !when.date || !tags) return 0;
    const t = tags.split("·");
    const day = new Date(when.date + "T12:00:00Z").getUTCDay();      // 0 = Sunday
    const holiday = !!holidays[when.date];
    const weekday = day >= 1 && day <= 5 && !holiday;
    let state = 0;
    if (t.includes("평일 낮")) {
      if (!weekday) return 1;
      const cut = parseCutoff(name);
      if (when.time) {
        const [hh, mm] = when.time.split(":").map(Number);
        if (cut == null) state = 2;
        else if (hh * 60 + mm >= cut) return 1;
      }
    }
    if (t.includes("일요일") && day !== 0) return 1;
    if (t.includes("타임세일") && when.time) state = 2;
    return state;
  }

  // ---- one cart line: q sessions of one item at one branch
  // cands / regular: [{i, p, special}] (regular = cands without special prices); override: {i, p, sess} chosen by the user
  const better = (a, b) => !b || a.p < b.p || (a.p === b.p && b.special && !a.special);
  function cheapest(list) {
    let best = null;
    for (const x of list) if (better(x, best)) best = x;
    return best;
  }
  function lineCost(cands, regular, q, override) {
    q = Math.max(1, q || 1);
    if (override) {
      const units = override.sess >= 99 ? 1 : Math.ceil(q / Math.max(1, override.sess || 1));
      return { total: override.p * units, rows: [override.i], units, ov: true, special: !!override.special };
    }
    const first = cheapest(cands);
    if (!first) return null;
    if (q === 1) return { total: first.p, rows: [first.i], units: 1, special: !!first.special };
    const rest = cheapest(regular) || first;      // a special price counts once; later sessions use the regular price
    return { total: first.p + rest.p * (q - 1), rows: first.i === rest.i ? [first.i] : [first.i, rest.i], units: q, special: !!first.special };
  }

  // ---- whole cart across branches
  // matrix: [{b, lines: [line | null per item]}]. Missing prices are never counted as 0.
  // returns full (every item priced, cheapest first), partial (some items), mix (each item at its cheapest branch,
  // ties go to a branch already on the route), pair (best two-branch plan), savings vs the best single branch.
  function compareClinics(matrix) {
    const m = matrix.length ? matrix[0].lines.length : 0;
    const full = [], partial = [];
    for (const row of matrix) {
      const have = row.lines.filter(Boolean);
      const total = have.reduce((s, l) => s + l.total, 0);
      const out = { b: row.b, total, lines: row.lines, n: have.length, missing: row.lines.map((l, j) => (l ? -1 : j)).filter((j) => j >= 0) };
      if (m && have.length === m) full.push(out);
      else if (have.length) partial.push(out);
    }
    full.sort((x, y) => x.total - y.total);
    partial.sort((x, y) => y.n - x.n || x.total - y.total);
    // mix: two passes so ties prefer branches already chosen for another item
    const picks = [];
    for (let j = 0; j < m; j++) {
      let best = null;
      for (const row of matrix) { const l = row.lines[j]; if (l && (!best || l.total < best.line.total)) best = { b: row.b, line: l }; }
      picks.push(best);
    }
    const chosen = new Set(picks.filter(Boolean).map((p) => p.b));
    for (let j = 0; j < m; j++) {
      const p = picks[j];
      if (!p) continue;
      for (const row of matrix) { const l = row.lines[j]; if (l && l.total === p.line.total && row.b !== p.b && chosen.has(row.b)) { picks[j] = { b: row.b, line: l }; break; } }
    }
    const mixTotal = picks.reduce((s, p) => s + (p ? p.line.total : 0), 0);
    const mix = { picks, total: mixTotal, places: new Set(picks.filter(Boolean).map((p) => p.b)).size, missing: picks.filter((p) => !p).length };
    // best plan with at most two branches (both actually used)
    let pair = null;
    for (let x = 0; x < matrix.length; x++) for (let y = x + 1; y < matrix.length; y++) {
      const A = matrix[x], B = matrix[y];
      let total = 0, ok = true, useA = 0, useB = 0;
      const assign = [];
      for (let j = 0; j < m; j++) {
        const la = A.lines[j], lb = B.lines[j];
        if (!la && !lb) { ok = false; break; }
        if (la && (!lb || la.total <= lb.total)) { total += la.total; useA++; assign.push(A.b); } else { total += lb.total; useB++; assign.push(B.b); }
      }
      if (ok && useA && useB && (!pair || total < pair.total)) pair = { a: A.b, b: B.b, total, assign };
    }
    if (pair && full.length && pair.total >= full[0].total) pair = null;     // two visits only if it saves money
    return { full, partial, mix, pair, savings: full.length && !mix.missing ? full[0].total - mix.total : null };
  }

  // ---- 'first visit' prices are often one per visit: keep at most one such line per branch (the one that saves most);
  // the others fall back to their next price (recompute(j) = the line without first-visit rows). A line with no fallback
  // stays but is flagged, because the clinic may not allow it.
  function limitOnce(lines, onceFlags, recompute) {
    const idx = lines.map((l, j) => (l && onceFlags[j] ? j : -1)).filter((j) => j >= 0);
    if (idx.length <= 1) return lines.map((l) => l);
    const alt = new Map(idx.map((j) => [j, recompute(j)]));
    const saving = (j) => (alt.get(j) ? alt.get(j).total : Infinity) - lines[j].total;
    const keep = idx.reduce((a, j) => (saving(j) > saving(a) ? j : a), idx[0]);
    return lines.map((l, j) => {
      if (!alt.has(j) || j === keep) return l;
      const a = alt.get(j);
      return a ? { ...a, restacked: true } : { ...l, stackWarn: true };
    });
  }

  // ---- clinic package vs. the cart (mode C). name: package option name ('슈링크 300샷 + 리쥬란 2cc'),
  // items: [{fam: RegExp for the procedure family, spec: '300샷' | '', key: comparison id | undefined}],
  // partKeys: per '+' part, the comparison ids that part is (from build2 xkeys rules, 'X12;X24'), norm: Search.norm.
  // Each item: 'match' (the part is the same procedure: same key, or same family and amount), 'spec' (same family,
  // different amount/area/product), 'check' (same family, nothing to compare). extras = parts matching no cart item.
  function matchPackage(name, items, norm, partKeys = "") {
    const parts = (name || "").split(/\s*\+\s*/).map((s) => s.replace(/\[[^\]]*\]\s*/g, "").trim());
    const keysOf = partKeys ? partKeys.split(";").map((s) => s.split(",").filter(Boolean)) : [];
    const used = new Set();
    const matched = [];
    items.forEach((it, j) => {
      let k = it.key ? parts.findIndex((p, n) => !used.has(n) && (keysOf[n] || []).includes(it.key)) : -1;
      if (k < 0) k = parts.findIndex((p, n) => p && !used.has(n) && it.fam.test(p));
      if (k < 0) return;
      used.add(k);
      let state;
      if (it.key && keysOf.length) state = (keysOf[k] || []).includes(it.key) ? "match" : "spec";
      else {
        const pn = norm(parts[k]);
        const amount = /\d+(샷|cc|u|kj)/.exec(pn);
        state = !it.spec ? "check" : pn.includes(norm(it.spec)) ? "match" : amount ? "spec" : "check";
      }
      matched.push({ j, state, part: parts[k] });
    });
    const extras = parts.filter((p, n) => p && !used.has(n));
    return { parts, matched, extras, full: matched.length > 0 && matched.every((m) => m.state === "match") && !extras.length };
  }

  return { vatPrice, isExpired, KR_HOLIDAYS, parseCutoff, condState, cheapest, lineCost, compareClinics, limitOnce, matchPackage };
});
