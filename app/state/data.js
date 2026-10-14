// 가격 데이터 받기·저장·검증 (docs/APP_JS_SPLIT_PLAN.md 2단계, moved out of app.js unchanged). The screen side is reached
// only through hooks: apply(json) puts a checked data.json into the app, paint(parsing) redraws the sync status.
// window.App.Data = { SYNC, loadData, abort, cacheClear, cacheInfo, canCache, setHooks }; io holds the network/storage calls
// so a unit test can replace them (tests/round2.test.js R09).
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  const Sync = window.Sync;
  const hooks = { apply() {}, paint() {} };
  // price data sync (docs/PRICE_SYNC_ARCHITECTURE.md): the phone's saved copy first; data-meta.json (tiny)
  // says whether a newer data.json exists; a download shows real progress, is checked (layout, counts, SHA-256) before it is
  // saved, and replaces the saved copy only when it passed. A newer version found while the old one is on screen waits for
  // the user ('새 가격 보기' = reopen with the new copy). Offline: the saved copy with "저장된 가격 정보입니다…".
  // round-2 O2: with no saved copy, home.json (the home screen's rows, ~1/10 of the size, same build — its checksum is in
  // data-meta.json) is read first and shown (SYNC.partial); data.json follows and replaces it. home.json is never saved.
  const DATA_CACHE = "pc-data-v1";
  const SYNC = { have: false, loading: false, fromCache: false, metaOk: false, newer: false, failed: "", got: 0, total: 0, version: "", local: null, server: null, ready: false, at: "", tries: 0, partial: false };
  let loadP = null, loadCtl = null;
  const canCache = () => typeof caches !== "undefined" && window.isSecureContext !== false;
  async function cacheGet() {
    if (!canCache()) return null;
    try {
      const c = await caches.open(DATA_CACHE), mr = await c.match("current-meta");
      if (!mr) return null;
      const m = await mr.json();
      if (Sync.checkMeta(m).length) return null;
      const dr = await c.match(`data-${m.version}`);
      return dr ? { meta: m, text: await dr.text() } : null;
    } catch (e) { return null; }
  }
  async function cachePut(m, bytes) {
    if (!canCache()) return false;
    try {
      const c = await caches.open(DATA_CACHE), json = { headers: { "content-type": "application/json" } };
      await c.put(`data-${m.version}`, new Response(bytes, json));            // the file first …
      await c.put("current-meta", new Response(JSON.stringify(m), json));     // … then the pointer: never a pointer to a missing file
      for (const k of await c.keys()) { const n = new URL(k.url).pathname.split("/").pop(); if (n.startsWith("data-") && n !== `data-${m.version}`) await c.delete(k); }
      return true;
    } catch (e) { return false; }   // storage full or blocked: the app still works, it just downloads next time
  }
  async function cacheClear() { if (canCache()) { try { await caches.delete(DATA_CACHE); } catch (e) { /* nothing saved */ } } }
  async function cacheInfo() {
    if (!canCache()) return null;
    try { const c = await caches.open(DATA_CACHE), mr = await c.match("current-meta"); return mr ? await mr.json() : null; } catch (e) { return null; }
  }
  async function fetchMeta(signal, ms = 8000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    const stop = () => ctl.abort();
    if (signal) signal.addEventListener("abort", stop, { once: true });
    try {
      const r = await fetch("data-meta.json", { cache: "no-store", signal: ctl.signal });
      if (!r.ok) return { ok: false, missing: r.status === 404 };
      const m = await r.json(), bad = Sync.checkMeta(m);
      return bad.length ? { ok: false, bad } : { ok: true, m };
    } catch (e) { return { ok: false, net: true, timeout: ctl.signal.aborted && !(signal && signal.aborted) }; }
    finally { clearTimeout(t); if (signal) signal.removeEventListener("abort", stop); }
  }
  // first visit: gate.js already started home.json (round-2 O2) — taken here once, whatever happens to it
  async function earlyHome() { const e = window.__pcEarly ? await window.__pcEarly : null; window.__pcEarly = null; return e; }
  async function downloadHome(signal) {
    const early = await earlyHome();
    const r = early && early.ok ? early : await fetch("home.json", { cache: "no-cache", signal });
    if (!r.ok) throw new Error(`홈 요약 응답 ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async function download(total, signal) {
    await earlyHome();
    const early = window.__pcEarlyFull ? await window.__pcEarlyFull : null;   // gate.js started it right after home.json
    window.__pcEarlyFull = null;
    const r = early && early.ok ? early : await fetch("data.json", { cache: "no-cache", signal });
    if (!r.ok) throw new Error(`가격 파일 응답 ${r.status}`);
    if (!r.body || !r.body.getReader) return new Uint8Array(await r.arrayBuffer());
    const rd = r.body.getReader(), parts = [];
    let got = 0, last = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); got += value.length;
      if (got - last > 65536) { last = got; SYNC.got = got; SYNC.total = total; hooks.paint(); }
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
  }
  async function sha256(bytes) {
    try { const d = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); } catch (e) { return ""; }
  }
  const tick = () => new Promise((res) => setTimeout(res, 0));   // let the progress text paint before a long synchronous step
  // resolves as soon as prices are on screen (saved copy or first download); a newer version keeps downloading after that
  function loadData() {
    if (loadP) return loadP;   // one load at a time: a second '다시 시도' joins the running one (request de-duplication)
    loadCtl = new AbortController();
    const sig = loadCtl.signal;
    let done = false;
    loadP = new Promise((resolve, reject) => {
      const ready = () => { if (!done) { done = true; resolve(); } };
      (async () => {
        SYNC.loading = true; SYNC.failed = ""; SYNC.got = 0; SYNC.total = 0; hooks.paint();
        // round-2 R09/O1: the saved copy is checked and SHOWN first; the version check (data-meta.json) runs alongside with its
        // own deadline and never holds the screen — a connection that answers slowly (or never) cannot keep a revisit waiting
        const metaP = io.fetchMeta(sig, 8000);
        const cached = SYNC.have ? null : await io.cacheGet();
        if (cached) {
          try {
            const d = JSON.parse(cached.text);
            if (!Sync.checkData(d, cached.meta).length) { hooks.apply(d); Object.assign(SYNC, { have: true, fromCache: true, version: cached.meta.version, local: cached.meta }); hooks.paint(); ready(); }
          } catch (e) { await cacheClear(); }   // a broken saved copy is dropped, never shown
        }
        const mr = await metaP;
        SYNC.metaOk = mr.ok; SYNC.server = mr.ok ? mr.m : null; SYNC.at = new Date().toISOString();
        if (SYNC.have && (!mr.ok || mr.m.version === SYNC.version)) { SYNC.loading = false; hooks.paint(); ready(); return; }   // up to date, or offline / slow
        const m = mr.ok ? mr.m : null;
        if (SYNC.have) { SYNC.newer = true; hooks.paint(); ready(); }   // old prices stay on screen while the new file comes
        // nothing on screen yet: the home screen's rows first (same build as the meta), then the full file below
        if (!SYNC.have && !SYNC.partial && m && m.home) {
          try {
            const hb = await io.downloadHome(sig), hsha = await sha256(hb), hd = JSON.parse(new TextDecoder().decode(hb));
            if (!Sync.checkHome(hd, m, hsha).length && !sig.aborted) { SYNC.partial = true; hooks.apply(hd); hooks.paint(); ready(); }
          } catch (e) { console.warn("home.json not used:", e); }   // no home.json, or a broken one: the full file comes next anyway
        }
        let err = null;
        for (let t = 0; t <= Sync.RETRY_MS.length; t++) {
          if (t) await new Promise((res) => setTimeout(res, Sync.RETRY_MS[t - 1]));
          if (sig.aborted) { err = new Error("취소했어요"); break; }
          SYNC.tries = t + 1;
          try {
            SYNC.got = 0; SYNC.total = m ? m.bytes : 0; hooks.paint();
            const bytes = await io.download(m ? m.bytes : 0, sig);
            SYNC.got = bytes.length; hooks.paint(true); await tick();
            const sha = m ? await sha256(bytes) : "";
            const d = JSON.parse(new TextDecoder().decode(bytes));
            const bad = Sync.checkData(d, m, sha);
            if (bad.length) { err = new Error(bad.join(" · ")); continue; }       // broken transfer: try again; the saved copy stays
            if (m) await cachePut(m, bytes);
            if (SYNC.have) { Object.assign(SYNC, { loading: false, newer: false, ready: true }); hooks.paint(); return; }   // '새 가격 보기' reopens with it
            Object.assign(SYNC, { have: true, partial: false, fromCache: false, version: m ? m.version : "", local: m, loading: false, newer: false });
            hooks.apply(d);
            hooks.paint(); ready(); return;
          } catch (e) { err = e.name === "AbortError" ? new Error("취소했어요") : e; if (sig.aborted) break; }
        }
        Object.assign(SYNC, { loading: false, newer: false, failed: err ? String(err.message || err) : "알 수 없는 오류" }); hooks.paint();
        if (!SYNC.have) { done = true; reject(err || new Error("load failed")); }
      })().catch((e) => { SYNC.loading = false; hooks.paint(); if (!done) { done = true; reject(e); } }).finally(() => { loadP = null; });
    });
    return loadP;
  }
  const io = { cacheGet, fetchMeta, download, downloadHome };
  const abort = () => { if (loadCtl) loadCtl.abort(); };
  App.Data = { SYNC, loadData, abort, cacheClear, cacheInfo, canCache, io, setHooks: (x) => Object.assign(hooks, x) };
})();
