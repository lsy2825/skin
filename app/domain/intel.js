// Price history statistics and price-alert rules (requirements 5.2 and 6). Pure functions, no DOM.
// window.Intel in the app, require()d by tests/intel.test.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Intel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const median = (v) => { const s = [...v].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[n >> 1] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2)) : null; };

  // dates: snapshot dates (ascending), values: price per date or null (not observed). Only observed points count —
  // nothing is filled in. from: first date to include ("" = all). Returns null when nothing was observed.
  function historyStats(dates, values, from = "") {
    const pts = dates.map((d, i) => [d, values[i]]).filter(([d, v]) => v != null && d >= from);
    if (!pts.length) return null;
    let changes = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i][1] !== pts[i - 1][1]) changes++;
    const vals = pts.map((p) => p[1]);
    const cur = vals[vals.length - 1];
    const min = Math.min(...vals), max = Math.max(...vals);
    return { points: pts.length, first: pts[0][0], last: pts[pts.length - 1][0], cur, min, max, median: median(vals), changes,
             minLast: [...pts].reverse().find((p) => p[1] === min)[0] };
  }
  // 'YYYY-MM-DD' minus n days
  function daysBefore(today, n) {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }

  // ---- alerts. alert: {type, target?, base?, last?, lastAt?}, now: {value, count?, until?}, today 'YYYY-MM-DD'.
  // Types: target (value ≤ target), newlow (value < base), cartdrop (total ≤ target, or < base when no target),
  // expiring (until within 3 days), newmatch (more branches than base). At most one notice per alert per day, and only
  // when the value moved further in the alert's direction since the last notice (no repeats for the same price).
  // returns {fire: bool, text, patch} — patch updates the stored alert.
  function evalAlert(alert, now, today) {
    const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
    const out = { fire: false, text: "", patch: {} };
    if (!now || (now.value == null && alert.type !== "expiring")) return out;
    if (alert.lastAt === today) return out;
    const v = now.value;
    const better = (x) => alert.last == null || x < alert.last;
    switch (alert.type) {
      case "target":
        if (v <= alert.target && better(v)) { out.fire = true; out.text = `목표가 ${won(alert.target)} 이하: 지금 ${won(v)}`; out.patch = { last: v }; }
        break;
      case "newlow":
        if (alert.base != null && v < alert.base) { out.fire = true; out.text = `새 최저가 ${won(v)} (전 ${won(alert.base)})`; out.patch = { base: v, last: v }; }
        else if (alert.base == null) out.patch = { base: v };
        break;
      case "cartdrop":
        if (alert.target ? v <= alert.target && better(v) : alert.base != null && v < alert.base) {
          out.fire = true; out.text = `장바구니 한 곳 합계 ${won(v)}${alert.target ? ` (목표 ${won(alert.target)})` : ` (전 ${won(alert.base)})`}`; out.patch = { last: v, base: v };
        } else if (alert.base == null) out.patch = { base: v };
        break;
      case "expiring": {
        if (!now.until || !/^\d{4}-\d{2}-\d{2}$/.test(now.until) || alert.last === now.until) break;
        const left = Math.round((new Date(now.until + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 86400000);
        if (left >= 0 && left <= 3) { out.fire = true; out.text = left === 0 ? "오늘 이벤트가 끝나요" : `이벤트가 ${left}일 뒤(${now.until}) 끝나요`; out.patch = { last: now.until }; }
        break;
      }
      case "newmatch":
        if (alert.base != null && now.count > alert.base) { out.fire = true; out.text = `파는 지점이 ${alert.base}곳 → ${now.count}곳으로 늘었어요`; out.patch = { base: now.count }; }
        else if (alert.base == null || now.count < alert.base) out.patch = { base: now.count };
        break;
      default:
        break;
    }
    if (out.fire) out.patch.lastAt = today;
    return out;
  }

  return { median, historyStats, daysBefore, evalAlert };
});
