// 단계별 익명 집계 (6.0 지시서 약속 2, 채팅 B5): which step of 'open → first price → price range → keep → come back' to
// report, and when. The app sends only the body {"s":"<step>"} with navigator.sendBeacon to {metricsApi}/v1/m — no date,
// no id, no page, no search words, no device. Off unless app/config.js sets metrics: true and an https metricsApi (C writes
// the privacy text, the user approves, then it is turned on); while off nothing is stored and nothing is sent.
// A step goes at most once a day per phone. The first step of a day (a fresh start, or a tab left open overnight) sends the
// day's 'open' first, and 'return_7d' when the last day kept is 1–7 days before — decided on the phone; that day never
// leaves the phone. window.Metrics in the app, require()d by tests/metrics.test.js.
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
  // the day the metrics Worker counts in: the KST (Asia/Seoul, UTC+9, no daylight saving) calendar date, whatever the phone's
  // time zone — 'once a day' then turns over at the same midnight as the server's table (chat A's memo, PR #15)
  const kstDay = (now = Date.now()) => new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  // whole days from day a to day b (both YYYY-MM-DD)
  const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

  // what this phone keeps: { d: the last day the app was used, s: the steps already sent that day }. Anything else
  // (nothing yet, an old or broken value) counts as no visit before.
  const clean = (state) => state && typeof state.d === "string" && DAY.test(state.d) && Array.isArray(state.s)
    ? { d: state.d, s: state.s.filter((x) => STAGES.includes(x)) } : null;
  // today against the day kept: 'same'; 'new' (a later day, or nothing kept); 'back' — the clock or time zone went back by
  // a day: hold and send nothing, so the same real day is not counted twice. Further back than that the kept day was
  // wrong (a clock set far ahead): a new day, without return_7d.
  function when(state, today) {
    const s = clean(state);
    if (!s) return "new";
    const gap = days(s.d, today);
    return gap === 0 ? "same" : gap === -1 ? "back" : "new";
  }
  // the steps that open a new day: 'open', and 'return_7d' first when the last day kept is 1–7 days before today
  function opening(state, today) {
    const s = clean(state), gap = s ? days(s.d, today) : null;
    return gap != null && gap >= 1 && gap <= RETURN_DAYS ? ["return_7d", "open"] : ["open"];
  }

  // the sender the app uses. io = { load(), save(state), beacon(url, body) → true when queued, today() → YYYY-MM-DD,
  // off() → true when the person switched it off on this phone (마이 → 내 설정; user decision 2026-10-15: the switch
  // exists, on by default) }. Off — no endpoint, or switched off — every call returns at once: load, save and beacon are
  // never called.
  function make(cfg, io) {
    const url = endpoint(cfg);
    const optedOut = () => { try { return !!(io.off && io.off()); } catch (e) { return false; } };
    const live = () => !!url && !optedOut();
    // a copy in memory as well: storage that is blocked or full (io.load gives nothing back) must not turn 'once a day' into
    // 'on every scroll' — without storage it is once per page load
    let mem = null;
    // storage that reads but cannot write (full) would hand back an old value forever: the stored value and the memory copy
    // are merged — the later day wins, the same day keeps the steps of both
    const load = () => {
      let v = null;
      try { v = clean(io.load()); } catch (e) { v = null; }
      if (!v || !mem) return v || mem;
      if (v.d !== mem.d) return days(v.d, mem.d) > 0 ? mem : v;
      return { d: v.d, s: [...new Set([...v.s, ...mem.s])] };
    };
    const save = (v) => { mem = v; try { io.save(v); } catch (e) { /* storage unavailable: memory only */ } };
    const send = (name) => { try { return !!io.beacon(url, body(name)); } catch (e) { return false; } };
    // send `name` unless it went today; true when it went now. A beacon the browser did not queue is tried again next time.
    const hit = (name) => {
      if (!live() || !STAGES.includes(name)) return false;
      const day = io.today();
      let s = load();
      const w = when(s, day);
      if (w === "back") return false;
      let went = false;
      if (w === "new") {
        // return_7d goes before open: when it is not queued nothing is kept, and both are tried again on the next step
        const sent = [];
        for (const n of opening(s, day)) {
          if (!send(n)) { if (sent.length) save({ d: day, s: sent }); return false; }
          sent.push(n);
        }
        s = { d: day, s: sent }; save(s);
        went = sent.includes(name);
      } else if (name !== "open" && !s.s.includes("open") && send("open")) {
        // a day whose 'open' was not queued: it still goes before this step
        s = { d: day, s: [...s.s, "open"] }; save(s);
      }
      if (s.s.includes(name)) return went;
      if (!send(name)) return false;
      save({ d: day, s: [...s.s, name] });
      return true;
    };
    return {
      // sending now (set up and not switched off on this phone)
      get on() { return live(); },
      // set up by the operator (config.js) — the phone's switch is shown only then
      available: !!url,
      hit,
      // app start, or the app shown again (a tab or a home-screen app left open since an earlier day)
      opened() { return hit("open"); },
      // true while this step has not gone out today — lets the app skip work (the first-price check) when it has, or when off
      pending(name) {
        if (!live()) return false;
        const s = load(), w = when(s, io.today());
        return w === "new" || (w === "same" && !s.s.includes(name));
      },
    };
  }

  return { STAGES, RETURN_DAYS, endpoint, body, days, kstDay, when, opening, make };
});
