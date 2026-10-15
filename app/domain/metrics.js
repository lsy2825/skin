// 단계별 익명 집계 (6.0 지시서 약속 2, 채팅 B5): which step of 'open → first price → price range → keep → come back' to
// report, and when. The app sends only the body {"s":"<step>"} with navigator.sendBeacon to {metricsApi}/v1/m — no date,
// no id, no page, no search words, no device. Off unless app/config.js sets metrics: true and an https metricsApi (C writes
// the privacy text, the user approves, then it is turned on); while off nothing is stored and nothing is sent.
// A step goes at most once a day per phone. return_7d: this phone was last used 1–7 days ago — decided on the phone from the
// day it keeps; that day never leaves the phone. window.Metrics in the app, require()d by tests/metrics.test.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Metrics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // the only step names the metrics Worker (chat A, cf/metrics) accepts — the same list, same order as the contract
  const STAGES = ["open", "first_price", "compare_open", "keep_cart", "keep_fav", "keep_alert", "cart_open", "return_7d"];
  const RETURN_DAYS = 7;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;

  // {metricsApi}/v1/m, or null when metrics is off or the address is not a plain https URL (no query, fragment or login)
  function endpoint(cfg) {
    if (!cfg || cfg.metrics !== true || typeof cfg.metricsApi !== "string" || !cfg.metricsApi) return null;
    let u;
    try { u = new URL(cfg.metricsApi); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.search || u.hash || u.username || u.password) return null;
    return u.origin + u.pathname.replace(/\/+$/, "") + "/v1/m";
  }
  const body = (step) => JSON.stringify({ s: step });
  // whole days from day a to day b (both YYYY-MM-DD, the phone's own calendar)
  const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

  // what this phone keeps: { d: the last day the app was used, s: the steps already sent that day }. Anything else
  // (nothing yet, an old or broken value) counts as no visit before.
  const clean = (state) => state && typeof state.d === "string" && DAY.test(state.d) && Array.isArray(state.s)
    ? { d: state.d, s: state.s.filter((x) => STAGES.includes(x)) } : null;
  // one step on day `today`: send it unless it already went today. Returns the state to keep (a new day starts with no
  // steps sent) and whether it differs from what was kept. A name outside STAGES is never sent.
  function step(state, name, today) {
    const was = clean(state), cur = was && was.d === today ? was : { d: today, s: [] }, moved = cur !== was;
    if (!STAGES.includes(name) || cur.s.includes(name)) return { send: false, next: cur, moved };
    return { send: true, next: { d: today, s: [...cur.s, name] }, moved: true };
  }
  // the steps of opening the app: 'open', and 'return_7d' when the last day kept is 1–7 days before today
  function opening(state, today) {
    const was = clean(state), gap = was ? days(was.d, today) : null;
    return gap != null && gap >= 1 && gap <= RETURN_DAYS ? ["open", "return_7d"] : ["open"];
  }

  // the sender the app uses. io = { load(), save(state), beacon(url, body) → true when queued, today() → YYYY-MM-DD }.
  // Off (no endpoint): every call returns at once — load, save and beacon are never called.
  function make(cfg, io) {
    const url = endpoint(cfg);
    const hit = (name) => {
      if (!url) return false;
      const day = io.today(), r = step(io.load(), name, day);
      if (!r.send) { if (r.moved) io.save(r.next); return false; }
      let ok = false;
      try { ok = !!io.beacon(url, body(name)); } catch (e) { ok = false; }
      // a beacon the browser did not queue is tried again next time; the day is kept either way
      io.save(ok ? r.next : { d: day, s: r.next.s.filter((x) => x !== name) });
      return ok;
    };
    return {
      on: !!url,
      hit,
      // app start: 'open' (+ 'return_7d') — the gap is read before 'open' moves the kept day to today
      opened() { if (!url) return; for (const n of opening(io.load(), io.today())) hit(n); },
      // true while this step has not gone out today — lets the app skip work (the first-price check) when it has, or when off
      pending(name) { if (!url) return false; const s = clean(io.load()); return !(s && s.d === io.today() && s.s.includes(name)); },
    };
  }

  return { STAGES, RETURN_DAYS, endpoint, body, days, step, opening, make };
});
