// Comparison statistics and list orders: per-branch lowest price of one option, where a price stands among branches,
// branch price levels, the orders a branch list can take (docs/OBJECTIVE_DISPLAY_POLICY.md) and how long a list is (the
// shared '더 보기', groups, one end date for a whole list). Pure functions, no DOM.
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
  const obsLabel = (o) => !o.n ? "기록 없음" : o.n === 1 ? `기록 1번 · ${md(o.first)}`
    : `기록 ${o.n}번 · ${md(o.first)}~${md(o.last)}${o.weeks >= 2 ? ` (서로 다른 ${o.weeks}주)` : ""}`;   // dates as md (U04)

  // a price history is drawn (line, 'N% 변동', 최저가 변동 횟수) only after this many distinct weeks were observed: one or
  // two snapshots read as a trend they are not (audit U13·U20, improvement report stage 1)
  const HISTORY_MIN_WEEKS = 8;
  const historyReady = (o) => !!o && o.weeks >= HISTORY_MIN_WEEKS;

  // ---- list order and length (2026-10-16 hierarchy audit 5·6·7·11, 6.0 규칙 4 '모든 더 보기는 같은 모양'·규칙 6 길이 예산)

  // 시·도 order inside the neutral '지역·이름순' (audit 7 · L3, user decision 2026-10-19): 수도권's own order 서울 → 경기 →
  // 인천 first, every other 시·도 after them in 가나다 order. Only the order of the 시·도 changes — the sort's name, its
  // words and everything after the 시·도 (branch name, brand) stay as they were; nothing about price
  const SIDO_FIRST = ["서울", "경기", "인천"];
  function sidoCmp(a, b) {
    const x = String(a || ""), y = String(b || "");
    if (x === y) return 0;
    const i = SIDO_FIRST.indexOf(x), j = SIDO_FIRST.indexOf(y);
    if (i >= 0 || j >= 0) return (i < 0 ? SIDO_FIRST.length : i) - (j < 0 ? SIDO_FIRST.length : j);
    return x.localeCompare(y, "ko");
  }

  // one '더 보기' for every list: a list shows its first rows, then this many more per tap (audit 11 · L7 · MORE-1)
  const MORE_STEP = 20;
  const commas = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // shown of total rows on screen → what the next tap shows: { next: rows on screen after it, add, left: rows not shown
  // yet, label: '20곳 더 보기 (165곳 남음)' }; null when every row is shown. unit is the list's own word: 곳 (clinics) or 개
  function more(shown, total, unit = "개", step = MORE_STEP) {
    const s = Math.max(0, Math.floor(+shown || 0)), t = Math.max(0, Math.floor(+total || 0)), k = Math.max(1, Math.floor(+step || MORE_STEP));
    if (t <= s) return null;
    const left = t - s, add = Math.min(k, left);
    return { next: s + add, add, left, label: `${commas(add)}${unit} 더 보기 (${commas(left)}${unit} 남음)` };
  }

  // rows in groups of one key, in the order the groups first appear (a branch's price list by 분야, audit 6 2단계): each
  // group's key, its row count and its first n rows
  function groups(items, keyOf, n = 5) {
    const m = new Map();
    for (const x of items) { const k = keyOf(x); let g = m.get(k); if (!g) m.set(k, (g = { key: k, total: 0, first: [] })); g.total++; if (g.first.length < n) g.first.push(x); }
    return [...m.values()];
  }

  // the end date nearly every row of a list carries (블리비's '~10/31까지' on 849 of 851 lines, audit 6 · BR-1): said once
  // above the list instead of on each line. dates: one per row ('' or null = no date). The date at least `share` of ALL the
  // rows carry (rows with no date count against it), on at least `min` rows → { date, n, total }; otherwise null
  function commonDate(dates, share = 0.8, min = 10) {
    const c = new Map(); let total = 0;
    for (const d of dates || []) { total++; if (d) c.set(d, (c.get(d) || 0) + 1); }
    let best = null;
    for (const [date, n] of c) if (!best || n > best.n) best = { date, n };
    return best && best.n >= min && best.n >= share * total ? { date: best.date, n: best.n, total } : null;
  }

  // do these price rows compare as one spec? keyLists: per row the comparison keys (ids) it belongs to. The first key every
  // row shares, or null — a row with no key, or two rows with no key in common, make the list a mix of specs (audit 5 ③:
  // one range over 2cc 1회, 3회 packages and '+ 크라이오셀' bundles is not a price anyone pays)
  function sharedKey(keyLists) {
    let common = null;
    for (const ks of keyLists || []) {
      const set = new Set((ks || []).filter(Boolean));
      common = common ? new Set([...common].filter((k) => set.has(k))) : set;
      if (!common.size) return null;
    }
    return common && common.size ? [...common][0] : null;
  }

  // one way to write a date or a time on a screen (2026-10-20 디자인 통일 U04 — '2026-10-19 기준', '10/19 수집', '확인 2026-10-19',
  // '10. 20. 오전 04:33' and '04:14 UTC' were all on screen): a date is 'M/D' with no leading zero ('10/19', '1/5' — the top bar
  // and the period badge '~10/31까지' already were), a time is Korea time 'M/D HH:MM'. Copied text and reports keep the year
  // (they leave the app). Not a date / not a time → ''
  function md(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso == null ? "" : iso)); return m ? `${+m[2]}/${+m[3]}` : ""; }
  function mdhm(t) {
    const d = t instanceof Date ? t : new Date(t == null ? NaN : t);
    if (!isFinite(d.getTime())) return "";
    const k = new Date(d.getTime() + 9 * 3600000), p2 = (n) => String(n).padStart(2, "0");   // Korea has no summer time: UTC+9 always
    return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${p2(k.getUTCHours())}:${p2(k.getUTCMinutes())}`;
  }
  // a price that moved, in one shape on every screen (U08; DESIGN_SYSTEM §2 '가격 방향은 늘 ▼▲와 함께'): '▼ 80%' · '▲ 124%' — the
  // mark, a space, the size (digits after the point: 0, or 1 for a trend's small moves). A move that rounds to 0 is '0%' with no
  // mark. pct: −0.8 for −80% (a fraction); not a number → ''
  function moveText(pct, digits = 0) {
    if (pct == null || !isFinite(pct)) return "";
    const v = Math.abs(pct * 100), s = v.toFixed(digits);
    return +s === 0 ? `${(0).toFixed(digits)}%` : `${pct < 0 ? "▼" : "▲"} ${s}%`;
  }

  return { median, observations, obsLabel, historyReady, HISTORY_MIN_WEEKS, isoWeek, medianSorted, groupStat, position, byLevel, order, SORTS,
    SIDO_FIRST, sidoCmp, MORE_STEP, more, groups, commonDate, sharedKey, md, mdhm, moveText };
});
