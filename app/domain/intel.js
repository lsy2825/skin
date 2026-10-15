// Price history statistics and price-alert rules (requirements 5.2 and 6). Pure functions, no DOM.
// window.Intel in the app, require()d by tests/intel.test.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./stats.js"));
  else root.Intel = factory(root.Stats);
})(typeof self !== "undefined" ? self : this, function (Stats) {
  "use strict";

  const median = Stats.median;                                     // one median everywhere (round-2 R03)

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
          out.fire = true; out.text = `내 견적 한 곳 합계 ${won(v)}${alert.target ? ` (목표 ${won(alert.target)})` : ` (전 ${won(alert.base)})`}`; out.patch = { last: v, base: v };
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

  // ---- watch (docs/ALERT_ENGINE_SPEC.md): one watched treatment, several kinds of change at once. Values are the clinics'
  // listed prices (병원 표시가) over the watch's own region and all brands — never the screen's VAT mode or filters, so
  // switching a display setting can never look like a price change. Only differences between two observations count.
  // base / now: { low, lowB (branch key), lowName, lowRow: 'branch key|option name' of the lowest, count, set: [branch keys],
  //               rowState: {[lowRow]: 'live' | 'expired' | 'gone'}, recheck: '' | reason }
  // w.on: { drop, target, lowbranch, newmatch, lowended, recheck } (true = on); w.target: won or null
  // → { events: [{t, before, after, b, text}], patch: { base } }
  const WATCH_T = { drop: "가격 하락", target: "목표가 이하", lowbranch: "최저가 지점 변경", newmatch: "새 비교 가능 지점", lowended: "최저가 이벤트 종료", recheck: "재확인 필요" };
  function evalWatch(w, now, today) {
    const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
    const out = { events: [], patch: {} };
    if (!now) return out;
    const b = w.base;
    const on = (t) => !w.on || w.on[t] !== false;
    const ev = (t, x) => out.events.push({ t, ...x });
    if (b && b.low != null && now.low != null) {
      if (on("drop") && now.low < b.low) ev("drop", { before: b.low, after: now.low, b: now.lowB, text: `최저 ${won(b.low)} → ${won(now.low)}` });
      if (on("lowbranch") && b.lowB && now.lowB && now.lowB !== b.lowB && now.low !== b.low)
        ev("lowbranch", { before: b.low, after: now.low, b: now.lowB, from: b.lowB, text: `${b.lowName || b.lowB} → ${now.lowName || now.lowB}` });
    }
    if (on("target") && w.target && now.low != null && now.low <= w.target && !(b && b.low != null && b.low <= w.target))
      ev("target", { before: b ? b.low : null, after: now.low, b: now.lowB, text: `목표가 ${won(w.target)} 이하: ${won(now.low)}` });
    if (on("newmatch") && b && Array.isArray(b.set) && Array.isArray(now.set)) {
      const added = now.set.filter((x) => !b.set.includes(x));
      if (added.length) ev("newmatch", { before: b.set.length, after: now.set.length, b: added[0], added, text: `파는 지점 ${b.set.length}곳 → ${now.set.length}곳` });
    }
    if (on("lowended") && b && b.lowRow && now.rowState && now.rowState[b.lowRow] && now.rowState[b.lowRow] !== "live")
      ev("lowended", { before: b.low, after: now.low, b: b.lowB, text: now.rowState[b.lowRow] === "expired" ? "최저가였던 가격의 이벤트 기간이 끝났어요" : "최저가였던 가격이 병원 가격표에서 빠졌어요" });
    if (on("recheck") && now.recheck && !(b && b.recheck)) ev("recheck", { before: null, after: now.low, b: now.lowB, text: now.recheck });
    out.patch = { base: { low: now.low, lowB: now.lowB, lowName: now.lowName, lowRow: now.lowRow, count: now.count, set: now.set, recheck: now.recheck || "" }, seen: today };
    return out;
  }

  return { median, historyStats, daysBefore, evalAlert, evalWatch, WATCH_T };
});
