// 윤실장 (피부과 가격비교) — app logic. Data: data.json (built by build2/appdata.py). No framework.
(function () {
  "use strict";
  if (document.documentElement.hasAttribute("data-framed")) return;   // shown inside another site's frame (gate.js clickjacking guard)
  // shared helpers, storage and toasts live in core.js (docs/APP_JS_SPLIT_PLAN.md 1단계)
  const { $, h, fill, icon, won, km, PERSONAL, store, toast, toastStop, toastTimer, undoToast, actToast, copyText } = window.App;
  // one icon per procedure category (both the compare categories and the data categories)
  const CAT_IC = { "톡신": "syringe", "보톡스·필러": "syringe", "윤곽·필러": "droplet", "리프팅": "sparkles", "부스터": "leaf", "스킨부스터": "leaf", "피부": "sun",
    "피부·레이저": "sun", "제모·바디": "zap", "제모": "zap", "바디": "flower-2", "패키지": "gift", "기타": "circle-plus" };
  const catIcon = (c, cls = "") => icon(CAT_IC[c] || "circle-dot", cls);
  // ---------------- 죠미 (app/jomi.js registry): one image per expression; an expression without its own artwork yet
  // shows its fallback expression, then the default. Text always goes with her — she never carries meaning alone.
  const J = window.JOMI || { name: "죠미", en: "Jomi", role: "", files: {}, expressions: {}, lines: {} };
  const jomiSrc = (expr, kind) => { const e = J.expressions[expr] || {}; return e[kind] || (J.expressions[e.fallback] || {})[kind] || J.files[kind]; };
  const jomiImg = (expr = "default", kind = "face", size = 32, alt = "") => h("img", { class: `mascot jomi${kind === "portrait" ? " portrait" : ""}`, src: jomiSrc(expr, kind),
    alt, width: size, height: size, decoding: "async", "data-expr": expr });
  const jomiSay = (expr, text, ...more) => h("div", { class: "jomi-say" }, jprefs().freq === "off" ? null : jomiImg(expr, "face", 32), h("div", { class: "bub" }, h("p", {}, text), ...more));
  // one line for a situation from the line engine (app/domain/jomilines.js): conditions, priority, no recent repeats.
  // Falls back to the fixed registry (app/jomi.js) when the engine is missing. The recent-use memory is a device setting.
  const jline = (intent) => {
    const L = window.JomiLines, fb = () => { const v = (window.JOMI && window.JOMI.lines[intent === "home" ? "homeBack" : intent]); return Array.isArray(v) ? v[0] : v || ""; };
    if (!L) return fb();
    let recent = []; try { recent = JSON.parse(localStorage.getItem("pc:jomiRecent") || "[]"); } catch (e) { /* ignore */ }
    let visits = 1; try { visits = +localStorage.getItem("pc:visits") || 1; } catch (e) { /* ignore */ }
    // visits are counted once per tab; someone who has already met 죠미 (intro seen) is not greeted as a first-timer again
    try { if (visits <= 1 && localStorage.getItem("pc:jomiSeen")) visits = 2; } catch (e) { /* ignore */ }
    const p = L.pick(intent, { visits, hour: new Date().getHours(), offline: typeof navigator !== "undefined" && navigator.onLine === false }, recent);
    if (!p) return fb();
    try { localStorage.setItem("pc:jomiRecent", JSON.stringify([...recent, p.id].slice(-20))); } catch (e) { /* ignore */ }
    return p.text;
  };
  try { if (!sessionStorage.getItem("pc:counted")) { sessionStorage.setItem("pc:counted", "1"); localStorage.setItem("pc:visits", String((+localStorage.getItem("pc:visits") || 0) + 1)); } } catch (e) { /* ignore */ }
  const jomiEmpty = (expr, title, ...kids) => h("div", { class: "empty jomi-empty" }, jomiImg(expr, "portrait", 88), h("b", {}, title), ...kids);
  // a link to this exact screen (the receiver still needs the PIN); the phone's share sheet when there is one
  async function shareLink(title, hash) {
    const url = `${location.origin}${location.pathname}#${hash}`;
    try { if (navigator.share) { await navigator.share({ title, url }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
    copyText(url, "링크를 복사했어요 — 받는 사람도 비밀번호가 필요해요");
  }
  // 죠미's toast: her face, one short line, optionally one action (되돌리기 / 관심 보기 / 알림 관리). One toast at a time:
  // a new one replaces the last, so the same success is never stacked.
  function jomiToast(expr, text, act) {
    const el = $("#toast");
    const kids = [jprefs().freq === "off" ? null : h("img", { class: "mascot", src: jomiSrc(expr, "face"), alt: "", width: 24, height: 24, "data-expr": expr }), h("span", { class: "tt" }, text)].filter(Boolean);   // 죠미 설정: 끄기 → no face
    if (act) kids.push(h("button", { type: "button", onclick: () => { el.classList.remove("on", "act"); toastStop(); act[1](); } }, act[0]));
    el.replaceChildren(...kids); el.classList.add("on", "jt"); el.classList.toggle("act", !!act);
    toastTimer(act ? 5000 : 2600, ["on", "act"]);
  }

  // feature flags (app/config.js): features that need legal review stay off until it is done
  const FLAGS = Object.assign({ ops: true, ads: false, booking: false, emailAlerts: false, publicIndex: false, concernSearch: true, concernGenerativeAI: false,
    concernPriceLink: true, showDraftKnowledge: true, lowestHighlight: false, branchRanking: false, discountEmphasis: false }, (window.APP_CONFIG || {}).flags || {});
  // ---------------- state
  const st = {
    special: store.get("special", true),          // include 체험가 · 한정가 · 시간 조건 prices
    vat: store.get("vat", "incl"),                // "incl" VAT 포함 예상가 · "listed" 병원 표시가
    brands: store.get("brands", null),             // null = all
    carts: loadCarts(),                            // [{name, items: [{t:"k", k: key id, q, ov} | {t:"r", n: row name, br, p, q, ov}]}]
    ci: 0,                                         // current cart
    cartTab: "one", cartCmp: false, cartAdv: false, open: new Set(), showPart: false, maxKm: 0, maxPlaces: 0, noStack: store.get("noStack", true), inBudget: false, vsDiff: false, when: store.get("when", null),
    hcat: null, hmove: "down", cbr: null, tf: null, rcat: -1, vsA: null, vsB: null, vcat: -1, vsort: "diff", bsort: "cat", ccat: -1, csort: "pct", cdir: "all",
    alerts: store.get("alerts", []), notes: store.get("notes", []), hrange: "",
    me: store.get("me", { nick: "", gender: "", age: "" }), recs: store.get("recs", []), allRecs: false, tcat: null,
    loc: null, locName: "",
    sort: store.get("sort", null) || "region", cat: 0, key: null, mapKey: null, bcat: -1, region: "",
    cview: store.get("cmpView", "list") === "cards" ? "cards" : "list",   // compare: clinic list as rows or as swipe cards
    cmpMode: store.get("cmpMode", "easy") === "detail" ? "detail" : "easy",   // compare: options as steps (쉬운 보기) or all (자세히)
    prod: null, prodK: null,                       // compare: product / device filter of the clinic list (key it belongs to)
  };
  let CHK = new Map();
  let CONC = { concerns: [], safety: { rules: [], personal: { pattern: "(?!)" } } }, concernText = "", concernPick = null;
  let D, S, BR, KEYS, ROWS, KI, byKB, byB, nameIdx, FAM, famOf, BK, SI, byName, GR, byG, gcache, KB, kbByFam, kbByFid;
  // carts: old single cart [{k, q}] becomes the first saved cart
  function newId() { return crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (Math.random() * 16) >> (c / 4)).toString(16)); }
  function loadCarts() {
    const c = store.get("carts", null);
    const list = Array.isArray(c) && c.length ? c : [{ name: "내 장바구니", items: store.get("cart", []).map((x) => ({ t: "k", k: x.k, q: x.q || 1 })) }];
    const moved = list !== c;
    let stamped = false;
    for (const x of list) if (!x.id) { x.id = newId(); stamped = true; }      // stable id so a signed-in cart can be merged with the server copy
    if (moved ? list[0].items.length : stamped) store.set("carts", list);     // save the moved/stamped carts once so the ids stay stable
    return list;
  }

  // ---------------- data
  // data.json keeps the price rows as columns (one list per field: a quarter smaller once gzipped); fields in colDelta
  // are differences from the row before. → the row arrays the rest of the app reads (build2/appdata.py rows_of)
  function rowsOf(d) {
    if (d.rows) return d.rows;
    const c = d.cols, n = c[0].length, rows = new Array(n);
    for (const f of d.colDelta || []) { let a = 0; const x = c[f]; for (let j = 0; j < n; j++) x[j] = a += x[j]; }
    for (let j = 0; j < n; j++) { const r = new Array(c.length); for (let f = 0; f < c.length; f++) r[f] = c[f][j]; rows[j] = r; }
    return rows;
  }
  // ---------------- price data sync (docs/PRICE_SYNC_ARCHITECTURE.md): the phone's saved copy first; data-meta.json (tiny)
  // says whether a newer data.json exists; a download shows real progress, is checked (layout, counts, SHA-256) before it is
  // saved, and replaces the saved copy only when it passed. A newer version found while the old one is on screen waits for
  // the user ('새 가격 보기' = reopen with the new copy). Offline: the saved copy with "저장된 가격 정보입니다…".
  const DATA_CACHE = "pc-data-v1";
  const SYNC = { have: false, loading: false, fromCache: false, metaOk: false, newer: false, failed: "", got: 0, total: 0, version: "", local: null, server: null, ready: false, at: "", tries: 0 };
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
  async function download(total, signal) {
    const early = window.__pcEarly ? await window.__pcEarly : null;   // first visit: gate.js already started it
    window.__pcEarly = null;
    const r = early && early.ok ? early : await fetch("data.json", { cache: "no-cache", signal });
    if (!r.ok) throw new Error(`가격 파일 응답 ${r.status}`);
    if (!r.body || !r.body.getReader) return new Uint8Array(await r.arrayBuffer());
    const rd = r.body.getReader(), parts = [];
    let got = 0, last = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); got += value.length;
      if (got - last > 65536) { last = got; SYNC.got = got; SYNC.total = total; paintSync(); }
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
        SYNC.loading = true; SYNC.failed = ""; SYNC.got = 0; SYNC.total = 0; paintSync();
        // round-2 R09/O1: the saved copy is checked and SHOWN first; the version check (data-meta.json) runs alongside with its
        // own deadline and never holds the screen — a connection that answers slowly (or never) cannot keep a revisit waiting
        const metaP = fetchMeta(sig, 8000);
        const cached = SYNC.have ? null : await cacheGet();
        if (cached) {
          try {
            const d = JSON.parse(cached.text);
            if (!Sync.checkData(d, cached.meta).length) { applyData(d); Object.assign(SYNC, { have: true, fromCache: true, version: cached.meta.version, local: cached.meta }); paintSync(); ready(); }
          } catch (e) { await cacheClear(); }   // a broken saved copy is dropped, never shown
        }
        const mr = await metaP;
        SYNC.metaOk = mr.ok; SYNC.server = mr.ok ? mr.m : null; SYNC.at = new Date().toISOString();
        if (SYNC.have && (!mr.ok || mr.m.version === SYNC.version)) { SYNC.loading = false; paintSync(); ready(); return; }   // up to date, or offline / slow
        const m = mr.ok ? mr.m : null;
        if (SYNC.have) { SYNC.newer = true; paintSync(); ready(); }   // old prices stay on screen while the new file comes
        let err = null;
        for (let t = 0; t <= Sync.RETRY_MS.length; t++) {
          if (t) await new Promise((res) => setTimeout(res, Sync.RETRY_MS[t - 1]));
          if (sig.aborted) { err = new Error("취소했어요"); break; }
          SYNC.tries = t + 1;
          try {
            SYNC.got = 0; SYNC.total = m ? m.bytes : 0; paintSync();
            const bytes = await download(m ? m.bytes : 0, sig);
            SYNC.got = bytes.length; paintSync(true); await tick();
            const sha = m ? await sha256(bytes) : "";
            const d = JSON.parse(new TextDecoder().decode(bytes));
            const bad = Sync.checkData(d, m, sha);
            if (bad.length) { err = new Error(bad.join(" · ")); continue; }       // broken transfer: try again; the saved copy stays
            if (m) await cachePut(m, bytes);
            if (SYNC.have) { Object.assign(SYNC, { loading: false, newer: false, ready: true }); paintSync(); return; }   // '새 가격 보기' reopens with it
            applyData(d); Object.assign(SYNC, { have: true, fromCache: false, version: m ? m.version : "", local: m, loading: false, newer: false });
            paintSync(); ready(); return;
          } catch (e) { err = e.name === "AbortError" ? new Error("취소했어요") : e; if (sig.aborted) break; }
        }
        Object.assign(SYNC, { loading: false, newer: false, failed: err ? String(err.message || err) : "알 수 없는 오류" }); paintSync();
        if (!SYNC.have) { done = true; reject(err || new Error("load failed")); }
      })().catch((e) => { SYNC.loading = false; paintSync(); if (!done) { done = true; reject(e); } }).finally(() => { loadP = null; });
    });
    return loadP;
  }
  // state → header dot + text, the loading line, and the notice bar under the header (offline / new prices ready / failed)
  function syncState() { return Sync.stateOf({ ...SYNC, updated: D ? D.meta.updated : "", today: today(), stale: D ? BR.filter((b) => fresh(b.i).stale).length : 0 }); }
  function paintSync(parsing) {
    const ss = syncState(), up = $("#upd");
    if (up) up.dataset.state = ss.state;
    const lm = $("#load-msg");
    const jl = jline("loading") || "오늘의 가격을 살펴보는 중…";   // 죠미's line first, the real progress after it
    if (lm && !D) lm.textContent = parsing ? "받은 가격을 정리하는 중…" : SYNC.total ? `${jl} ${Math.min(99, Math.floor((SYNC.got / SYNC.total) * 100))}% (${(SYNC.got / 1e6).toFixed(1)}/${(SYNC.total / 1e6).toFixed(1)}MB)` : SYNC.got ? `${jl} ${(SYNC.got / 1e6).toFixed(1)}MB` : jl;
    const bar = $("#netbar");
    if (!bar || !D) return;
    let kids = null;
    if (ss.offline) kids = [icon("wifi-off", "sm"), h("span", {}, `저장된 가격 정보입니다. 현재 가격과 다를 수 있습니다. (${D.meta.updated} 수집)`)];
    else if (SYNC.ready) kids = [icon("refresh-cw", "sm"), h("span", {}, `새 가격(${SYNC.server ? SYNC.server.updated : ""})이 준비됐어요`), h("button", { type: "button", class: "nb-act", onclick: () => location.reload() }, "새 가격 보기")];
    else if (ss.state === "PARTIALLY_READY") kids = [h("span", { class: "nb-dot" }), h("span", {}, Sync.label(ss, SYNC))];
    else if (SYNC.failed && SYNC.have) kids = [icon("triangle-alert", "sm"), h("span", {}, "새 가격을 받지 못해 저장된 가격을 보여줘요"), h("button", { type: "button", class: "nb-act", onclick: () => { loadData().catch(() => {}); } }, "다시 시도")];
    else if (ss.state === "STALE") kids = [icon("clock", "sm"), h("span", {}, `가격이 ${Sync.days(D.meta.updated, today())}일 전 것이에요. 예약 전 병원에 꼭 확인하세요.`)];
    bar.hidden = !kids;
    if (kids) bar.replaceChildren(...kids); else bar.replaceChildren();
    bar.dataset.state = ss.state;
  }
  window.addEventListener("online", () => { if (D && !SYNC.metaOk) loadData().catch(() => {}); else paintSync(); });
  window.addEventListener("offline", () => { SYNC.metaOk = false; paintSync(); });
  function applyData(json) {
    D = json;
    D.rows = rowsOf(D); delete D.cols;
    S = D.s;
    BR = D.branches.map((b, i) => ({ i, brand: b[0], name: S[b[1]], addr: S[b[2]], lat: b[3], lng: b[4], region: S[b[5]], site: S[b[6]], geo: b[9] ?? 0 }));
    KEYS = D.keys.map(([id, cat, label], i) => ({ i, id, cat, label }));
    KI = Object.assign(Object.create(null), Object.fromEntries(KEYS.map((k) => [k.id, k.i])));   // no prototype: '#compare?k=__proto__' is just unknown (round-2 D5)
    ROWS = D.rows;
    // source re-checks of low prices (scrape/verify_prices.py): row → { s: 1 found · 2 name only · 3 not found · 4 fetch error · 5 in the same block, d: date }
    CHK = new Map((D.meta.checks || []).map(([i, s, d]) => [i, { s, d }]));
    // r[15] = 0 live · 1 event over (until < today) · 2 price jump waiting for review; r[14] = listed price when VAT 별도
    const td = today();
    for (const r of ROWS) {
      const u = S[r[10]] || "";
      r[18] = r[14] || 0;                 // per-'+'-part comparison keys (data.json) moved out of the runtime slots
      r[15] = Pricing.isExpired(u, td) ? 1 : r[13] ? 2 : 0;
      r[14] = r[3]; r[16] = r[4];        // the clinic's listed price / list price, kept for the 'VAT 포함' switch
    }
    applyVat();
    applyWhen();
    byKB = KEYS.map(() => new Map());
    byB = BR.map(() => []);
    ROWS.forEach((r, i) => {
      byB[r[0]].push(i);
      const ks = S[r[7]];
      if (ks) for (const id of ks.split(" ")) { const m = byKB[KI[id]]; if (!m.has(r[0])) m.set(r[0], []); m.get(r[0]).push(i); }
    });
    nameIdx = null; prodIdx = null;
    GR = (D.groups || []).map(([s, cat, nb, med, mn, mx], i) => ({ i, label: S[s], cat, nb, med, mn, mx }));
    byG = GR.map(() => []);
    ROWS.forEach((r, i) => { if (r[9] != null && r[9] >= 0) byG[r[9]].push(i); });
    gcache = new Map();
    mixMemo.clear(); medMemo.clear();
    // procedure families (option picker) and lookups for cart items stored by name
    // families (build2/taxonomy.py): name, regex for related rows (written for names without spaces), variants, compare
    // category, base family id, the clinics' own explanations. n = branches selling any variant, main = default variant
    const spaceless = (src) => { let re; try { re = new RegExp(src); } catch (e) { re = /$^/; } return { source: src, test: (x) => re.test(x) || re.test(String(x).replace(/\s+/g, "")) }; };
    FAM = (D.meta.fam || []).map(([name, rx, vs, cat, fid, desc]) => ({ name, rx: spaceless(rx), cat: cat || "", fid: fid || "", desc: desc || [],
      vs: vs.map(([id, label]) => ({ k: KI[id], label })).filter((v) => v.k != null) })).filter((f) => f.vs.length);
    famOf = KEYS.map(() => null);
    FAM.forEach((f) => f.vs.forEach((v) => { if (!famOf[v.k]) famOf[v.k] = { f, label: v.label }; }));
    FAM.forEach((f, i) => { f.idx = i; });
    for (const f of FAM) {
      f.n = new Set(f.vs.flatMap((v) => [...byKB[v.k].keys()])).size;
      const one = f.vs.filter((v) => !/\d+회$/.test(v.label));
      f.main = (one.length ? one : f.vs).reduce((a, v) => (byKB[v.k].size > byKB[a.k].size ? v : a)).k;
      if (!f.cat) f.cat = KEYS[f.main].cat;
    }
    // Treatment Knowledge Base (knowledge/treatments.json): entries matched to families by name, else by base family id
    KB = D.meta.kb || { entries: [], statuses: {} };
    kbByFam = new Map(); kbByFid = new Map();
    for (const e of KB.entries) { for (const n of e.families) if (!kbByFam.has(n)) kbByFam.set(n, e); for (const x of e.fids) if (!kbByFid.has(x)) kbByFid.set(x, e); }
    // concern taxonomy (knowledge/concerns.json) for '피부 고민으로 찾기'
    CONC = D.meta.concerns || CONC;
    BK = new Map(BR.map((b) => [bkey(b.i), b.i]));
    SI = new Map(S.map((x, i) => [x, i]));
    byName = new Map();
    ROWS.forEach((r, i) => { if (!byName.has(r[2])) byName.set(r[2], []); byName.get(r[2]).push(i); });
    st.ci = Math.min(store.get("ci", 0), st.carts.length - 1);
    if (!st.brands) st.brands = D.meta.brands.map((_, i) => i);
    // a brand added after the filter was saved starts switched on (4 = brands before 포에버 was added)
    const added = D.meta.brands.map((_, i) => i).filter((i) => i >= store.get("nbrands", 4) && !st.brands.includes(i));
    if (added.length && store.get("brands", null)) { st.brands.push(...added); store.set("brands", st.brands); }
    store.set("nbrands", D.meta.brands.length);
    migrateKeys();
    paintUpd();
    paintSync();
  }
  // comparison ids that a rule fix or renamed options replaced (data.json meta.keymap: old → [new or "", old label]): saved
  // cart items, favourites, alerts and saved comparisons move to the successor; an id without one keeps its old label on
  // screen instead of a bare 'T1234567'. Regrouped ids (meta.recl) re-base alerts quietly in checkAlerts.
  const KMAP = () => D.meta.keymap || {};
  const goneLabel = (id) => (KMAP()[id] || [])[1];
  const successor = (id) => { let x = id, n = 0; while (x && KI[x] == null && n++ < 10) x = (KMAP()[x] || [])[0]; return x && KI[x] != null ? x : null; };
  function migrateKeys() {
    const mv = (id) => (id && KI[id] == null ? successor(id) : null);
    let c = 0;
    for (const cart of st.carts || []) for (const it of cart.items || []) { const n = it.t === "k" && mv(it.k); if (n) { it.k = n; c++; } }
    if (c) saveCarts();
    const F = favs(); let fc = 0;
    F.k = [...new Set(F.k.map((id) => { const n = mv(id); if (n) fc++; return n || id; }))];
    if (fc) store.set("favs", F);
    let ac = 0;
    for (const a of st.alerts || []) { const n = mv(a.k); if (n) { a.from = a.from || a.k; a.k = n; a.regroup = true; ac++; } }
    if (ac) saveAlerts();
    const L = store.get("snaps", []); let sc = 0;
    for (const x of L) { const n = mv(x.k); if (n) { x.k = n; sc++; } }
    if (sc) store.set("snaps", L);
    return c + fc + ac + sc;
  }
  // the date the rows of key id were last regrouped (data.json meta.recl), or ""
  const reclDate = (id) => { let d = ""; for (const [dt, ks] of D.meta.recl || []) if (ks.includes(id)) d = dt; return d; };
  const brandOf = (b) => D.meta.brands[BR[b].brand];
  const brandOn = (b) => st.brands.includes(BR[b].brand);
  // region view: "" = 전국, "수도권" = 서울·경기·인천, otherwise one 시·도 (data stays nationwide)
  const CAPITAL = ["서울", "경기", "인천"];
  const regionOk = (b) => !st.region || (st.region === "수도권" ? CAPITAL.includes(BR[b].region) : BR[b].region === st.region);
  const regionName = () => st.region || "전국";
  const isSpecial = (r) => r[5] === 1 || r[5] === 2 || S[r[6]] !== "";
  const isFirstVisit = (r) => (S[r[6]] || "").split("·").includes("첫 방문");
  const isBundle = (r) => (S[r[2]] || "").includes("+");          // several items in one price ('A+B'): 묶음
  const prodMemo = new Map();                                     // product / device names a clinic wrote in the option name
  const prodOf = (sid) => { let v = prodMemo.get(sid); if (!v) { const t = S[sid] || ""; v = Spec.PRODUCTS.filter((x) => t.includes(x)); prodMemo.set(sid, v); } return v; };
  const dist = (b) => {
    const x = BR[b];
    if (!st.loc || x.lat == null) return null;
    const R = 6371, rad = Math.PI / 180, dLat = (x.lat - st.loc.lat) * rad, dLng = (x.lng - st.loc.lng) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(st.loc.lat * rad) * Math.cos(x.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };
  // cheapest row for key k at branch b under the current settings (special: override st.special)
  // r[17] visit-condition state for the chosen visit date/time (Pricing.condState): 0 ok · 1 not valid then · 2 time unclear
  const live = (i) => !ROWS[i][15] && ROWS[i][17] !== 1;
  // price basis: "incl" = VAT 포함 예상가 (listed + 10% where the clinic says VAT 별도), "listed" = as shown on the site
  function applyVat() {
    for (const r of ROWS) {
      r[3] = Pricing.vatPrice(r[14], r[12], st.vat);
      r[4] = r[16] ? Pricing.vatPrice(r[16], r[12], st.vat) : 0;
    }
    if (gcache) gcache.clear();
  }
  function applyWhen() {
    for (const r of ROWS) r[17] = S[r[6]] ? Pricing.condState(S[r[6]], S[r[2]], st.when) : 0;
    if (gcache) gcache.clear();
  }
  const vatNote = () => st.vat === "incl" ? "가격은 부가세 10% 포함 예상가예요(병원 표시가 + 10%)." : "가격은 병원 사이트 표시가예요(대부분 부가세 10% 별도).";
  const listedTxt = (r) => st.vat === "incl" && r[12] === 2 ? `병원 표시 ${won(r[14])} + VAT` : st.vat === "listed" && r[12] === 2 ? "VAT 별도" : "";
  function bestAt(k, b, special = st.special) {
    let best = -1;
    for (const i of byKB[k].get(b) || []) {
      const r = ROWS[i];
      if (!live(i) || (!special && isSpecial(r))) continue;
      if (best < 0 || r[3] < ROWS[best][3] || (r[3] === ROWS[best][3] && isSpecial(ROWS[best]) && !isSpecial(r))) best = i;
    }
    return best;
  }
  // ---- product / device layer and comparability (docs/TREATMENT_TAXONOMY.md, domain/classify.js). mixFor(k): the products
  // the live rows of key k name; prodRank(k, p): ranking() restricted to rows naming product p ("" = rows naming none);
  // classOf(i, k): the A–J class of row i inside key k (the median is over the key's live plain prices per session)
  const mixMemo = new Map(), medMemo = new Map();
  const rowProds = (i) => Classify.products(S[ROWS[i][2]]);
  function mixFor(k) {
    if (mixMemo.has(k)) return mixMemo.get(k);
    const names = [], per = new Map();
    for (const [b, ids] of byKB[k]) for (const i of ids) if (live(i)) { names.push(S[ROWS[i][2]]); for (const p of (rowProds(i).length ? rowProds(i) : [""])) { if (!per.has(p)) per.set(p, new Set()); per.get(p).add(b); } }
    const m = { ...Classify.mixOf(names), branches: per };
    mixMemo.set(k, m);
    return m;
  }
  function prodRank(k, p, sort = st.sort) {
    const out = [];
    for (const b of byKB[k].keys()) {
      if (!brandOn(b) || !regionOk(b)) continue;
      let best = -1;
      for (const i of byKB[k].get(b)) {
        const r = ROWS[i], ps = rowProds(i);
        if (!live(i) || (!st.special && isSpecial(r)) || (p ? !ps.includes(p) : ps.length)) continue;
        if (best < 0 || r[3] < ROWS[best][3]) best = i;
      }
      if (best >= 0) out.push({ b, i: best, p: ROWS[best][3], d: dist(b) });
    }
    return Stats.order(out, sort, { regionCmp, verified, hasLoc: !!st.loc });
  }
  function keyMed(k) {
    if (medMemo.has(k)) return medMemo.get(k);
    const all = [], plain = [];
    for (const ids of byKB[k].values()) for (const i of ids) if (live(i)) { const r = ROWS[i], v = r[14] / Math.min(r[8] || 1, 98); all.push(v); if (!r[5] && !S[r[6]]) plain.push(v); }
    const m = median(plain.length >= 3 ? plain : all) || 0;
    medMemo.set(k, m);
    return m;
  }
  function classOf(i, k) {
    const r = ROWS[i];
    if (k == null) { const id = (S[r[7]] || "").split(" ").find((x) => KI[x] != null); k = id ? KI[id] : null; }
    return Classify.row({ name: S[r[2]], sess: r[8], kind: r[5], tags: (S[r[6]] || "").split("·").filter(Boolean), keyLabel: k != null ? KEYS[k].label : "",
      mix: k != null ? mixFor(k) : null, price: r[14] / Math.min(r[8] || 1, 98), median: k != null ? keyMed(k) : 0 });
  }
  const CLS_K = { direct: "k ok", caution: "k kx", reference: "k k4", never: "k kx" };
  const classBadge = (c) => h("span", { class: `${CLS_K[c.cmp]} clsb`, title: c.why }, `${c.c} · ${c.label}`);
  // clinic order. The default is neutral — region, then branch name (nearest first once a location is set) — so the app
  // never pins one clinic on top as 'the lowest'; price order is one of the user's choices (docs/OBJECTIVE_DISPLAY_POLICY.md)
  const SORT_L = { region: "지역·이름순", near: "가까운순", recent: "최근 확인순", price: "낮은 가격순", priceDesc: "높은 가격순" };
  const regionCmp = (a, b) => (BR[a].region || "").localeCompare(BR[b].region || "", "ko") || BR[a].name.localeCompare(BR[b].name, "ko") || brandOf(a)[0].localeCompare(brandOf(b)[0], "ko");
  const sortChips = (curS, set, keys = Object.keys(SORT_L)) => h("div", { class: "chips sortchips", role: "radiogroup", "aria-label": "정렬" }, keys.map((v) =>
    h("button", { class: "chip", type: "button", role: "radio", "aria-checked": curS === v ? "true" : "false", onclick: () => set(v) }, v === "near" ? [icon("map-pin", "sm"), SORT_L[v]] : SORT_L[v])));
  // every branch selling key k, in the given order
  function ranking(k, sort = st.sort) {
    const out = [];
    for (const b of byKB[k].keys()) {
      if (!brandOn(b) || !regionOk(b)) continue;
      const i = bestAt(k, b);
      if (i >= 0) out.push({ b, i, p: ROWS[i][3], d: dist(b) });
    }
    return Stats.order(out, sort, { regionCmp, verified, hasLoc: !!st.loc });   // domain/stats.js (equal prices: newer check, then nearer)
  }
  // ---------------- auto groups (same option at several branches): per-branch lowest price, median, rank
  // gstat(g) → { per: Map(branch → {p, i}), sorted prices, med }  (respects 특가 포함; brand filter is applied by callers)
  function gstat(g, special = st.special) {
    const ck = g * 2 + (special ? 1 : 0);
    if (gcache.has(ck)) return gcache.get(ck);
    const out = Stats.groupStat(byG[g], (i) => ROWS[i], (i) => live(i) && (special || !isSpecial(ROWS[i])));
    gcache.set(ck, out);
    return out;
  }
  // where row i stands among branches selling the same option: {rank, n, vsMed (−0.12 = 12% below median)}
  function rowPos(i) {
    const r = ROWS[i];
    if (r[9] == null || r[9] < 0) return null;
    return Stats.position(r[3], gstat(r[9], true));
  }
  const lvText = (x) => x == null ? "-" : Math.abs(1 - x) < 0.005 ? "중간 수준" : x < 1 ? `${Math.round((1 - x) * 100)}% 싸요` : `${Math.round((x - 1) * 100)}% 비싸요`;
  const lvClass = (x) => x == null || Math.abs(1 - x) < 0.005 ? "" : x < 1 ? "down" : "up";
  const pctTxt = (v) => Math.abs(v) < 0.005 ? "중간값" : v < 0 ? `중간보다 ${Math.round(-v * 100)}% ↓` : `중간보다 ${Math.round(v * 100)}% ↑`;
  // diverging bar around the median (1.0); ±40% fills the half
  const divBar = (x) => { const v = Math.max(-0.4, Math.min(0.4, (x ?? 1) - 1)); const w = Math.abs(v) / 0.4 * 50;
    return h("span", { class: "dbar", "aria-hidden": "true" }, h("i", { class: v < 0 ? "neg" : "pos", style: v < 0 ? `right:50%;width:${w}%` : `left:50%;width:${w}%` })); };
  const levelOf = (b, cat = -1) => { const s = (D.bstat || [])[b]; if (!s) return null; if (cat >= 0) return s[5] ? s[5][cat] ?? null : null; return st.special ? s[1] : s[0]; };
  const branchRanks = (cat = -1) => Stats.byLevel(BR.filter((x) => brandOn(x.i) && regionOk(x.i)).map((x) => ({ b: x.i, lv: levelOf(x.i, cat) })));
  const brSelect = (val, set, label) => h("select", { class: "pick", "aria-label": label, onchange: (e) => set(+e.target.value) },
    D.meta.brands.map((bb, bi) => !BR.some((x) => x.brand === bi) ? null : h("optgroup", { label: bb[0] }, BR.filter((x) => x.brand === bi).sort((a, c) => a.name.localeCompare(c.name, "ko"))
      .map((x) => h("option", { value: x.i, selected: x.i === val }, `${bb[0]} ${x.name}`)))));

  // the clinic's struck-through list price next to a price reads as a discount pitch: only with flags.discountEmphasis
  // (otherwise 정가 is in the price evidence sheet, docs/OBJECTIVE_DISPLAY_POLICY.md)
  const listS = (r) => FLAGS.discountEmphasis && r[4] ? h("s", {}, won(r[4])) : null;
  const md2 = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  const kindBadge = (r) => {
    const out = [];
    if (r[15] === 1) out.push(h("span", { class: "k kx" }, "기간 끝남"));
    if (r[17] === 1) out.push(h("span", { class: "k kx" }, "방문일엔 안 됨"));
    if (r[17] === 2) out.push(h("span", { class: "k kx", title: "병원 사이트에 시간대가 적혀 있지 않아요" }, "시간 확인 필요"));
    if (r[15] === 2) out.push(h("span", { class: "k kx", title: "지난 수집보다 90% 넘게 내리거나 10배 넘게 올라 확인 중이에요" }, "급변·확인 중"));
    const u = S[r[10]] || "";
    if (!r[15] && /^\d{4}-\d{2}-\d{2}$/.test(u) && u < "2099") out.push(h("span", { class: "k k4" }, `~${md2(u)}까지`));
    if (u.startsWith("posted:")) out.push(h("span", { class: "k k4" }, `고시표 ${u.slice(7)}`));
    if (r[12] === 1 && st.vat === "listed") out.push(h("span", { class: "k k4" }, "VAT 포함가"));
    if (r[12] === 0) out.push(h("span", { class: "k k4" }, "VAT 표기 미확인"));
    if (r[5] === 1) out.push(h("span", { class: "k k1" }, "체험가"));
    if (r[5] === 2) out.push(h("span", { class: "k k2" }, "한정가"));
    if (r[5] === 4) out.push(h("span", { class: "k k4" }, "고시가"));
    const t = S[r[6]];
    if (t) for (const x of t.split("·")) out.push(h("span", { class: "k kt" }, x));
    return out;
  };
  const bname = (b) => `${D.meta.brands[BR[b].brand][0]} ${BR[b].name}`;
  // source page of a price + when it was last read
  const srcLink = (i, label = "출처") => S[ROWS[i][11]] ? h("a", { class: "linkbtn src", href: S[ROWS[i][11]], target: "_blank", rel: "noopener noreferrer", onclick: (e) => e.stopPropagation() }, label) : null;
  const verified = (b) => S[D.branches[b][7]] || "";
  const daysSince = (d) => d ? Math.round((new Date(today()) - new Date(d)) / 86400000) : null;
  const fresh = (b) => { const d = verified(b), n = daysSince(d), stale = S[D.branches[b][8]] === "STALE" || (n != null && n > 8); return { d, n, stale }; };
  const bdot = (b) => h("span", { class: "bdot", style: `background:${brandOf(b)[1]}` });

  // ---------------- visit date/time: hides prices whose day/time condition doesn't fit (Pricing.condState)
  const DOW = "일월화수목금토";
  const whenLabel = () => { const w = st.when; if (!w) return "방문일: 언제든"; const d = new Date(w.date + "T12:00:00Z");
    return `${+w.date.slice(5, 7)}/${+w.date.slice(8)}(${DOW[d.getUTCDay()]})${w.time ? " " + w.time : ""} 방문`; };
  const whenChip = () => h("button", { class: "chip", type: "button", "aria-pressed": st.when ? "true" : "false", onclick: whenSheet }, icon("calendar", "sm"), whenLabel());
  function setWhen(w) { st.when = w; store.set("when", w); applyWhen(); mixMemo.clear(); medMemo.clear(); render(); }
  function whenSheet() {
    const max = new Date(Date.now() + 120 * 86400000), maxS = new Date(max.getTime() - max.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    sheet("언제 갈 거예요?", (close) => {
      const date = h("input", { class: "field", type: "date", min: today(), max: maxS, value: st.when ? st.when.date : today(), "aria-label": "방문 날짜" });
      const times = ["", ...Array.from({ length: 25 }, (_, i) => `${String(9 + (i >> 1)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`)];
      const time = h("select", { class: "field", "aria-label": "방문 시간" }, times.map((x) => h("option", { value: x, selected: (st.when ? st.when.time : "") === x }, x || "시간 상관없음")));
      const info = h("div", { class: "sub", style: "margin-top:8px" });
      const paint = () => { const hol = Pricing.KR_HOLIDAYS[date.value]; const d = date.value ? new Date(date.value + "T12:00:00Z").getUTCDay() : null;
        info.textContent = date.value ? `${DOW[d]}요일${hol ? ` · 공휴일(${hol}) — 평일 가격은 빠져요` : d === 0 || d === 6 ? " · 주말 — 평일 낮 가격은 빠져요" : ""}` : ""; };
      date.addEventListener("input", paint); paint();
      return h("div", {}, h("div", { class: "sub" }, "평일 낮·일요일처럼 시간 조건이 붙은 가격을 방문일에 맞춰 걸러요. 시간대가 적혀 있지 않은 가격은 '시간 확인 필요'로 남겨요."),
        h("label", { class: "flabel" }, "날짜", date), h("label", { class: "flabel" }, "시간", time), info,
        h("div", { class: "sub", style: "margin-top:6px;font-size:12px" }, "공휴일 표는 2026-10-13에 정리했어요(대체공휴일 포함). 정부 발표가 바뀌면 다를 수 있어요."),
        h("div", { class: "row", style: "margin-top:14px" },
          st.when ? h("button", { class: "btn gray", type: "button", onclick: () => { setWhen(null); close(); } }, "지우기") : null,
          h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => { if (!date.value) return; setWhen({ date: date.value, time: time.value }); close(); } }, "적용")));
    });
  }

  // ---------------- region picker (header button + 내정보)
  function regionSelect(after) {
    const regions = [...new Set(BR.map((b) => b.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    const cnt = (f) => BR.filter(f).length;
    return h("select", { class: "pick", "aria-label": "지역", onchange: (e) => { setRegion(e.target.value); if (after) after(); } },
      h("option", { value: "수도권", selected: st.region === "수도권" }, `수도권 (서울·경기·인천) ${cnt((b) => CAPITAL.includes(b.region))}곳`),
      h("option", { value: "", selected: !st.region }, `전국 ${BR.length}곳`),
      regions.map((r) => h("option", { value: r, selected: r === st.region }, `${r} ${cnt((b) => b.region === r)}곳`)));
  }
  function setRegion(v) { st.region = v; store.set("region", v); gcache && gcache.clear(); paintRegion(); render(); }
  function paintRegion() { const el = $("#regbtn span"); if (el) el.textContent = regionName(); paintUpd(); }
  // branch counts: one wording everywhere — the region being shown first, the nationwide total after it
  const regionCount = () => BR.filter((b) => regionOk(b.i)).length;
  const branchCountText = () => (st.region ? `${regionName()} ${regionCount()}곳 · 전국 ${BR.length}곳` : `전국 ${BR.length}곳`);
  // header caption: short, so it fits the top bar on a phone (the region sheet and 내정보 show the nationwide totals)
  function paintUpd() { const el = $("#upd"); if (!el || !D) return; el.textContent = `${+D.meta.updated.slice(5, 7)}/${+D.meta.updated.slice(8, 10)} 기준 · ${regionCount()}곳`; el.title = `${D.meta.updated} 기준 · ${branchCountText()}`; }
  function regionSheet() { sheet("지역", (close) => h("div", {}, h("div", { class: "sub", style: "margin:4px 0 10px" }, "비교·장바구니·검색·순위에 이 지역 지점만 보여요"), regionSelect(close))); }

  // ---------------- location: GPS, or a saved place (집·직장) — set from GPS or the map centre
  const places = () => store.get("places", {});
  // places saved before at ~1 m precision are rounded once to ~100 m
  { const p = places(), r = (v) => +(+v).toFixed(3); let moved = false;
    for (const k of Object.keys(p)) if (p[k] && (r(p[k].lat) !== p[k].lat || r(p[k].lng) !== p[k].lng)) { p[k] = { lat: r(p[k].lat), lng: r(p[k].lng) }; moved = true; }
    if (moved) store.set("places", p); }
  function usePlace(name) {
    const p = places()[name];
    if (!p) return;
    st.loc = { lat: p.lat, lng: p.lng }; st.locName = name;
    $("#locbtn").classList.add("on"); $("#locbtn span").textContent = name;
    store.set("locPlace", name); render();
  }
  // saved on this phone at about 100 m (3 decimals): enough for distances, not an exact home address
  function savePlace(name, lat, lng) { const p = places(); p[name] = { lat: +lat.toFixed(3), lng: +lng.toFixed(3) }; store.set("places", p); toast(`'${name}' 위치를 저장했어요`); }
  function locSheet() {
    const p = places();
    sheet("거리 기준 위치", (close) => h("div", {},
      h("div", { class: "sub" }, "가까운 순·거리 제한·지도에 쓰는 기준이에요. 집·직장은 이 기기에만 저장돼요."),
      h("div", { class: "opts", style: "margin-top:10px" },
        h("button", { class: "opt", type: "button", onclick: () => { close(); locate(); } }, h("b", {}, icon("locate-fixed", "sm"), "현재 위치"), h("span", {}, "GPS 권한 필요")),
        ["집", "직장"].map((n) => h("button", { class: "opt", type: "button", "aria-pressed": st.locName === n ? "true" : "false", disabled: !p[n], onclick: () => { close(); usePlace(n); } },
          h("b", {}, icon(n === "집" ? "house" : "building-2", "sm"), n), h("span", {}, p[n] ? "저장됨" : "아직 없음")))),
      st.loc ? h("div", { class: "row", style: "margin-top:12px" },
        ["집", "직장"].map((n) => h("button", { class: "btn sm gray", type: "button", onclick: () => { savePlace(n, st.loc.lat, st.loc.lng); close(); render(); } }, `지금 기준을 ${n}으로 저장`)),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { st.loc = null; st.locName = ""; store.set("locPlace", ""); $("#locbtn").classList.remove("on"); $("#locbtn span").textContent = "내 위치"; close(); render(); } }, "위치 끄기")) : null,
      p["집"] || p["직장"] ? h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "linkbtn", type: "button", onclick: () => {
        const before = places(); store.set("places", {});
        if (st.locName === "집" || st.locName === "직장") { st.loc = null; st.locName = ""; store.set("locPlace", ""); $("#locbtn").classList.remove("on"); $("#locbtn span").textContent = "내 위치"; }
        close(); render(); undoToast("저장한 집·직장을 지웠어요", () => { store.set("places", before); render(); }); } }, "저장한 집·직장 지우기")) : null,
      h("div", { class: "flabel", style: "margin-top:12px" }, "동네·역 이름으로 (위치 권한 없이)"), areaSearch(close),
      h("div", { class: "sub", style: "margin-top:10px" }, "지도 탭에서 원하는 곳으로 옮긴 뒤 '지도 가운데를 집/직장으로'를 눌러도 돼요.")));
  }
  function locate(then) {
    if (!navigator.geolocation) { toast("이 브라우저는 위치를 지원하지 않아요"); return; }
    $("#locbtn span").textContent = "찾는 중…";
    navigator.geolocation.getCurrentPosition((p) => {
      st.loc = { lat: p.coords.latitude, lng: p.coords.longitude };
      const near = BR.filter((b) => b.lat != null).map((b) => ({ b, d: dist(b.i) })).sort((x, y) => x.d - y.d)[0];
      st.locName = near ? `${near.b.region || ""} · ${near.b.name} ${km(near.d)}` : "내 위치";
      $("#locbtn").classList.add("on");
      $("#locbtn span").textContent = "내 위치 켜짐";
      if ((st.sort === "price" || st.sort === "region") && then !== "keep") st.sort = "near";
      render();
      if (typeof then === "function") then();
    }, (e) => {
      $("#locbtn span").textContent = "내 위치";
      // no permission (or no fix): offer the same features by area name instead
      sheet("위치를 쓸 수 없어요", (close) => h("div", {}, h("div", { class: "sub" }, e.code === 1 ? "위치 권한이 꺼져 있어요. 동네나 역 이름으로 찾으면 그곳을 기준으로 가까운 지점과 거리를 보여줘요." : "위치를 찾지 못했어요. 동네나 역 이름으로 찾아보세요."),
        h("div", { style: "margin-top:10px" }, areaSearch(close))));
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  // ---------------- favorites (procedures and branches, this phone): pinned in comparisons and on 홈
  const favs = () => { const f = store.get("favs", null); return f && f.k && f.b ? f : { k: [], b: [] }; };
  const isFav = (kind, id) => favs()[kind].includes(id);
  function toggleFav(kind, id, label) {
    const f = favs(), on = f[kind].includes(id);
    f[kind] = on ? f[kind].filter((x) => x !== id) : [id, ...f[kind]].slice(0, 30);
    if (!on) favPop = `${kind}:${id}`;
    store.set("favs", f); render(); favPop = null;
    if (on) undoToast(`관심에서 뺐어요: ${label}`, () => { const g = favs(); g[kind] = [id, ...g[kind]]; store.set("favs", g); render(); });
    else jomiToast("happy", jline("saved") || "저장했어요", ["관심 보기", () => nav("saved")]);
  }
  let cartIO = null;   // the cart's sticky-summary observer (views.cart)
  let favPop = null;   // the heart just filled pops once
  const favBtn = (kind, id, label) => h("button", { class: favPop === `${kind}:${id}` ? "favbtn pop" : "favbtn", type: "button", "aria-pressed": isFav(kind, id) ? "true" : "false", "aria-label": isFav(kind, id) ? `${label} 관심 빼기` : `${label} 관심 등록`,
    onclick: (e) => { e.stopPropagation(); toggleFav(kind, id, label); } }, icon("heart"));

  // ---------------- cart
  const bkey = (b) => `${D.meta.brands[BR[b].brand][0]}|${BR[b].name}`;
  const cur = () => st.carts[st.ci];
  let cartPush = null;
  // account copy of the carts (round-2 R16): one save at a time per cart, each with the version it was based on; an older save
  // can never overwrite a newer one (the server answers VERSION_CONFLICT and the newer copy is pulled instead)
  const cartQ = new Map();
  function pushCart(A, c, uid) {
    const run = (cartQ.get(c.id) || Promise.resolve()).then(async () => {
      if (!A.user || A.user.id !== uid) return;                       // the account changed meanwhile: not this account's cart anymore
      try { const r = await A.saveCart(c, uid); if (r && r.version != null) { c.ver = r.version; store.set("carts", st.carts); } }
      catch (e) {
        if (!/VERSION_CONFLICT/.test(String(e && (e.message || e.code)))) throw e;
        const remote = (await A.pullCarts(uid)).find((x) => x.id === c.id);
        if (remote && A.user && A.user.id === uid) { Object.assign(c, { name: remote.name, items: remote.items, ver: remote.ver }); store.set("carts", st.carts); render(); toast("다른 기기에서 바뀐 장바구니를 불러왔어요"); }
      }
    });
    cartQ.set(c.id, run.catch(() => {}));
    return run;
  }
  const saveCarts = () => {
    for (const x of st.carts) if (!x.id) x.id = newId();
    store.set("carts", st.carts); store.set("ci", st.ci); paintCartN();
    const A = window.Auth && window.Auth.enabled ? window.Auth : null;
    if (A && A.user) { const uid = A.user.id; clearTimeout(cartPush); cartPush = setTimeout(() => Promise.all(st.carts.map((c) => pushCart(A, c, uid))).catch(() => toast("장바구니를 계정에 저장하지 못했어요(이 기기에는 저장됨)")), 800); }
  };
  const inCart = (k) => cur().items.some((c) => c.t === "k" && c.k === KEYS[k].id);
  const sessOf = (i) => ROWS[i][8] || 1;
  const itemLabel = (it) => it.t === "k" ? (KI[it.k] != null ? KEYS[KI[it.k]].label : goneLabel(it.k) ? `${goneLabel(it.k)} (지금은 비교 묶음 없음)` : it.k) : it.n;
  const itemOk = (it) => it.t === "k" ? KI[it.k] != null : SI.has(it.n);
  function paintCartN() {
    const n = st.carts[st.ci] ? st.carts[st.ci].items.length : 0, el = $("#cart-n");
    const more = n > (+el.textContent || 0) && !el.hidden;
    el.hidden = !n; el.textContent = n;
    if (more || (n && el.dataset.n === "0")) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
    el.dataset.n = n;
  }
  const addBtn = (k) => {
    const b = h("button", { class: "addbtn", type: "button", "aria-pressed": inCart(k) ? "true" : "false", "aria-label": `${KEYS[k].label} ${inCart(k) ? "담김 · 횟수 바꾸기" : "장바구니에 담기"}` },
      icon(inCart(k) ? "check" : "plus", "sm"), inCart(k) ? "담김" : "담기");
    b.addEventListener("click", (e) => { e.stopPropagation(); addKeySheet(k); });
    return b;
  };
  const rowAddBtn = (i) => h("button", { class: "addbtn", type: "button", onclick: (e) => { e.stopPropagation(); addRowSheet(i); } }, icon("plus", "sm"), "담기");

  // bottom sheet
  // keyboard: focus moves into the sheet, Tab stays inside, Esc closes, focus returns to the opener
  // keyboard focus survives a redraw: remember the focused control by what it is (tag + label, counts dropped) and
  // where it is, then focus the same control in the new page (or the one at the same position)
  const FOCUSABLE = "button, input, select, textarea, a[href]";
  const fsig = (e) => {
    const lab = e.closest("label");
    const t = e.getAttribute("aria-label") || (e.matches("input, select, textarea") ? (lab && lab.firstChild && lab.firstChild.textContent) || e.placeholder : e.textContent);
    return e.tagName + "|" + (t || "").trim().replace(/\s*\(\d[\d,]*\)$/, "").slice(0, 40);
  };
  function focusMark(root, el) {
    if (!el || el === root || !root.contains(el)) return null;
    const all = [...root.querySelectorAll(FOCUSABLE)], s = fsig(el);
    return { s, n: all.filter((e) => fsig(e) === s).indexOf(el), at: all.indexOf(el) };
  }
  function focusBack(root, m) {
    if (!m) return;
    const all = [...root.querySelectorAll(FOCUSABLE)].filter((e) => !e.disabled && e.offsetParent !== null);
    const same = all.filter((e) => fsig(e) === m.s);
    const el = same[Math.min(Math.max(m.n, 0), same.length - 1)] || all[Math.min(m.at, all.length - 1)];
    if (el) el.focus({ preventScroll: true });
  }
  const openSheets = new Set();   // closed when the page changes (back button, a link), so no sheet outlives its page
  function sheet(title, body) {
    const opener = document.activeElement, om = focusMark($("#main"), opener);
    const bg = h("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } });
    // the opener may have been redrawn while the sheet was open (e.g. '+ 담기' → '담김 ✓'): fall back to its twin
    const close = (quiet) => { if (!openSheets.delete(close)) return; bg.remove(); document.removeEventListener("keydown", key); if (!document.querySelector(".sheet-bg")) document.documentElement.classList.remove("sheet-open");
      if (quiet === true) return; if (opener && opener.isConnected) opener.focus(); else focusBack($("#main"), om); };
    openSheets.add(close);
    document.documentElement.classList.add("sheet-open");   // the page behind doesn't scroll while a sheet is open
    const key = (e) => {
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab") return;
      const f = [...bg.querySelectorAll("button, input, select, textarea, a[href]")].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { f[f.length - 1].focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { f[0].focus(); e.preventDefault(); }
    };
    document.addEventListener("keydown", key);
    const sh = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "row" }, h("h3", {}, title), h("span", { class: "sp" }), h("button", { class: "tbtn-i", type: "button", "aria-label": "닫기", style: "margin:-6px -8px 0 0", onclick: () => close() }, icon("x"))), body(close));
    bg.append(sh);
    document.body.append(bg);
    setTimeout(() => { const first = sh.querySelector("input, select, textarea") || sh.querySelectorAll("button")[1] || sh.querySelector("button"); if (first) first.focus(); }, 30);
    return close;
  }
  // small text-input sheet (cart names …) with inline validation instead of window.prompt
  function nameSheet(title, initial, save) {
    sheet(title, (close) => {
      const inp = h("input", { class: "field", value: initial || "", maxlength: "30", "aria-label": "이름" });
      const err = h("div", { class: "ferr", role: "alert", hidden: true }, "이름을 적어 주세요");
      const ok = () => { const v = inp.value.trim(); if (!v) { err.hidden = false; inp.setAttribute("aria-invalid", "true"); inp.focus(); return; } save(v.slice(0, 30)); close(); };
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } });   // preventDefault: the same Enter must not also press the button focus returns to
      return h("div", {}, inp, err, h("button", { class: "btn", type: "button", style: "width:100%;margin-top:12px", onclick: ok }, "저장"));
    });
  }
  const qtyEl = (get, set, max = 20) => h("span", { class: "qty" },
    h("button", { type: "button", "aria-label": "하나 빼기", disabled: get() <= 1, onclick: () => set(Math.max(1, get() - 1)) }, icon("minus", "sm")), h("b", { class: "num" }, get()),
    h("button", { type: "button", "aria-label": "하나 더", disabled: get() >= max, onclick: () => set(Math.min(max, get() + 1)) }, icon("plus", "sm")));
  function cartPicker(sel, set) {
    if (st.carts.length < 2) return null;
    return h("div", {}, h("div", { class: "sub", style: "margin:12px 0 6px" }, "담을 장바구니"),
      h("div", { class: "chips" }, st.carts.map((c, i) => h("button", { class: "chip", type: "button", "aria-pressed": i === sel ? "true" : "false", onclick: () => set(i) }, c.name))));
  }
  // add a comparable procedure: pick the option (variant), sessions and cart
  function addKeySheet(k0) {
    const s = { k: k0, q: 1, ci: st.ci };
    const fam = famOf[k0];
    sheet(fam ? fam.f.name : KEYS[k0].label, (close) => {
      const box = h("div", {});
      const paint = () => {
        const rk = ranking(s.k, "price"), top = FLAGS.lowestHighlight ? rk[0] : null, rp = rk.map((x) => x.p);   // ② off: range, no clinic named
        const have = st.carts[s.ci].items.find((c) => c.t === "k" && c.k === KEYS[s.k].id);
        fill(box,
          fam && fam.f.vs.length > 1 ? h("div", {}, h("div", { class: "sub", style: "margin:12px 0 6px" }, "옵션"),
            h("div", { class: "opts" }, fam.f.vs.map((v) => { const tp = ranking(v.k, "price")[0];
              return h("button", { class: "opt", type: "button", "aria-pressed": v.k === s.k ? "true" : "false", onclick: () => { s.k = v.k; paint(); } },
                h("b", {}, v.label), h("span", { class: "num" }, tp ? `최저 ${won(tp.p)}` : "가격 없음")); }))) : null,
          h("div", { class: "row", style: "margin-top:14px" }, h("div", {}, h("div", { class: "sub" }, "횟수(회차)"), h("div", { class: "sub", style: "font-size:12px" }, "2회째부터는 지점의 일반가로 계산")),
            h("span", { class: "sp" }), qtyEl(() => s.q, (v) => { s.q = v; paint(); })),
          cartPicker(s.ci, (i) => { s.ci = i; paint(); }),
          top ? h("div", { class: "hero", style: "margin-top:14px" }, h("span", { class: "hl" }, `${KEYS[s.k].label} · 가장 싼 곳`), h("span", { class: "hb" }, bname(top.b)),
            h("span", { class: "hp num" }, won(top.p)))
            : rp.length ? h("div", { class: "note", style: "margin-top:14px" }, `${KEYS[s.k].label} · ${regionName()} ${rp.length}곳 · ${won(Math.min(...rp))}~${won(Math.max(...rp))} · 중간값 ${won(median(rp))}`) : null,
          h("div", { class: "row", style: "margin-top:14px" },
            have ? h("button", { class: "btn gray", type: "button", onclick: () => { const c = st.carts[s.ci], pos = c.items.indexOf(have); c.items = c.items.filter((x) => x !== have); saveCarts(); close(); render();
              undoToast("장바구니에서 뺐어요", () => { c.items.splice(pos, 0, have); saveCarts(); render(); }); } }, "빼기") : null,
            h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => {
              const c = st.carts[s.ci], it = have || { t: "k", k: KEYS[s.k].id, q: s.q };
              if (have) have.q = s.q; else { c.items.push(it); track("cart_add", { k: it.k }); }
              saveCarts(); close(); render();
              if (have) toast("횟수를 바꿨어요");
              else jomiToast("happy", jline("added") || `'${c.name}'에 담았어요`, ["되돌리기", () => { c.items = c.items.filter((x) => x !== it); saveCarts(); render(); toast("되돌렸어요"); }]);
            } }, have ? `${s.q}회로 바꾸기` : `${s.q}회 담기`)));
      };
      paint();
      return box;
    });
  }
  // the knowledge-base entry for a price row (through its comparison key's treatment family), if there is a visible one
  const kbOfRow = (i) => { for (const id of (S[ROWS[i][7]] || "").split(" ")) { const fm = famOf[KI[id]]; if (fm && kbOf(fm.f)) return kbOf(fm.f); } return null; };
  // add one real price row of a branch, as it is (compared with rows of the same name elsewhere) or as its procedure
  // ---------------- price facts: why a price is what it is (conditions, VAT, source) — for the '가격 확인' sheet
  // conditions read from the clinic's own option name (and the tags clean.py found); nothing here is guessed
  const COND_WORDS = [[/(\d[\d,]*\s*만?\s*원)\s*이상\s*(결제|구매|시술|시)/, "최소 결제 금액 조건이 있어요"], [/\d+\s*(샷|cc|U|회|부위)\s*이상\s*(시|구매|결제)?/i, "최소 수량 조건이 있어요"],
    [/단독\s*(불가|시술\s*불가|사용\s*불가)/, "단독으로는 못 받아요(다른 시술과 함께)"], [/(^|\s|\(|\])옵션\s*\d*\)|추가\s*(시|구매|결제)|\d\s*(샷|cc|U)\s*추가|(^|\s)추가(\s|$)/, "추가 옵션이에요(본 시술과 함께)"],
    [/동시\s*시술|함께\s*시술|(진행|구매|결제|이용)\s*(고객|시)/, "다른 시술을 받거나 산 사람만"], [/첫\s*방문|신규|웰컴|첫\s*시술|첫\s*구매/, "첫 방문(신규) 조건"],
    [/1\s*인\s*(당\s*)?1\s*회/, "1인 1회"], [/선착순|한정\s*수량/, "선착순·수량 한정"], [/평일|주말|타임\s*세일|\d\s*시\s*(이전|전|까지)|프라임\s*타임/, "요일·시간 조건"],
    [/팁\s*(별도|미포함)|별도\s*(구매|비용)/, "추가 비용이 따로 있어요"]];
  function priceConds(i) {
    const r = ROWS[i], n = S[r[2]], out = new Set();
    for (const [rx, t] of COND_WORDS) if (rx.test(n)) out.add(t);
    for (const t of (S[r[6]] || "").split("·").filter(Boolean)) out.add(t === "첫 방문" ? "첫 방문(신규) 조건" : t === "1인 1회" ? "1인 1회" : `${t} 조건`);
    if (r[5] === 1) out.add("체험가(보통 1인 1회)");
    if (r[5] === 2) out.add("한정가(기간·수량·첫 방문 등 조건)");
    if (r[17] === 2) out.add("시간대가 사이트에 적혀 있지 않아요");
    return [...out];
  }
  // a price is 'normal' (shown as the plain lowest) only with no condition, at a branch read this week, valid on the chosen visit
  const plainOk = (i) => !isSpecial(ROWS[i]) && !ROWS[i][15] && !ROWS[i][17] && !fresh(ROWS[i][0]).stale && !priceConds(i).length;
  // same as ranking(k) but only plain prices (one per branch)
  function plainRanking(k) {
    const out = [];
    for (const [b, rows] of byKB[k]) {
      if (!brandOn(b) || !regionOk(b)) continue;
      let best = -1;
      for (const i of rows) if (live(i) && plainOk(i) && (best < 0 || ROWS[i][3] < ROWS[best][3])) best = i;
      if (best >= 0) out.push({ b, i: best, p: ROWS[best][3], d: dist(b) });
    }
    return out.sort((x, y) => x.p - y.p || verified(y.b).localeCompare(verified(x.b)));
  }
  const median = Stats.median;                                     // one median for screens, reports, Jomi and push (round-2 R03)
  // how a price sits among the same procedure's prices (each branch's lowest), for '중간보다 N%' texts
  function priceStats(i) {
    const r = ROWS[i], kid = (S[r[7]] || "").split(" ").map((x) => KI[x]).find((x) => x != null);
    if (kid != null) { const rk = ranking(kid, "price"), ps = rk.map((x) => x.p), med = median(ps);
      return { by: `같은 시술(${KEYS[kid].label})`, n: ps.length, med, rank: ps.filter((p) => p < r[3]).length + 1, special: st.special, k: kid }; }
    const pos = rowPos(i);
    if (pos) { const g = gstat(r[9], true); return { by: "이름이 같은 옵션", n: pos.n, med: g.med, rank: pos.rank, special: true }; }
    return null;
  }
  const LOW_SHARE = 0.3;
  const isLow = (i, stx = priceStats(i)) => !!stx && stx.n >= 3 && stx.med > 0 && ROWS[i][3] <= stx.med * LOW_SHARE;
  // a plain price at or below 30% of the median that only one or two branches show (a chain's usual price is shared by
  // many branches) has no condition words but is not verified either — an unmarked event, a per-spot price, a typo:
  // it stays out of '조건 없는 최저가' headlines and is shown apart as '확인 필요' until a source re-check finds it
  function splitLow(pl) {
    const med = median(pl.map((x) => x.p));
    if (pl.length < 3 || !med) return { normal: pl, lowp: [], med };
    const same = new Map(); for (const x of pl) same.set(x.p, (same.get(x.p) || 0) + 1);
    const low = (x) => x.p <= med * LOW_SHARE && same.get(x.p) < 3 && !checkedOk(x.i);
    return { normal: pl.filter((x) => !low(x)), lowp: pl.filter(low), med };
  }
  const checkedOk = (i) => (CHK.get(i) || {}).s === 1;
  const CHECK_TXT = { 1: "원본 페이지에서 같은 이름·가격을 다시 확인했어요", 2: "원본에 상품명은 있지만 이 가격은 옆에서 찾지 못했어요 — 바뀌었을 수 있어요",
    3: "원본 페이지에서 이 상품을 찾지 못했어요 — 행사가 끝났거나 이름이 바뀌었을 수 있어요", 4: "원본 페이지를 읽지 못했어요",
    5: "원본 페이지의 같은 상품 칸에서 이 가격을 찾았어요 (상품명 바로 옆은 아니에요)" };
  function priceSheet(i) {
    const r = ROWS[i], b = r[0], f = fresh(b), conds = priceConds(i), stx = priceStats(i), low = isLow(i, stx);
    const vatTxt = r[12] === 2 ? (st.vat === "incl" ? `병원 표시가 ${won(r[14])} + 부가세 10% = ${won(r[3])} (병원이 '부가세 별도'라고 적어 둠)` : `병원 표시가 ${won(r[14])} (부가세 별도, 결제 땐 10% 더 붙을 수 있어요)`)
      : r[12] === 1 ? `${won(r[3])} (병원이 '부가세 포함'이라고 적음)` : `${won(r[3])} (부가세 포함 여부를 사이트에서 찾지 못했어요)`;
    const u = S[r[10]] || "";
    const row = (k, v) => h("div", { class: "fact" }, h("dt", {}, k), h("dd", {}, v));
    sheet("가격 확인", (close) => h("div", {},
      h("div", { class: "item", style: "padding:6px 0 10px" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])), h("span", { class: "m" }, bdot(b), bname(b), kindBadge(r))),
      (() => { const c = classOf(i, ROWS[i] && (S[ROWS[i][7]] || "").split(" ").includes(KEYS[st.key] && KEYS[st.key].id) ? st.key : null);
        track("price_sheet", { cls: c.c });
        return h("div", { class: `clsbox cls-${c.cmp}` }, h("div", { class: "row", style: "gap:6px" }, h("b", { class: "sh", style: "margin:0" }, "비교 판정"), classBadge(c),
          h("span", { class: "sp" }), h("button", { class: "linkbtn", type: "button", onclick: () => clsSheet() }, "A~J 뜻")), h("p", { class: "sub", style: "margin:6px 0 0" }, c.why)); })(),
      h("div", { class: "elig-wrap" }, h("b", { class: "sh" }, "가격 적용 조건"), eligList(i)),
      h("details", { class: "fold small specfold" }, h("summary", {}, "시술 규격 확인"), specList(specOfRow(i)), h("p", { class: "tiny" }, "상품명에서 읽은 것만이에요. '미확인'은 이름에 없다는 뜻이에요.")),
      low ? h("div", { class: "warnnote" }, `아주 낮은 가격이에요: ${stx.by} ${stx.n}곳 중간값 ${won(stx.med)}의 ${Math.round(r[3] / stx.med * 100)}%예요. 첫 방문 체험가, 적은 용량, 추가 옵션인 경우가 많아요. 아래 조건과 원본 페이지를 꼭 확인하세요.`) : null,
      h("dl", { class: "facts" },
        row("가격과 부가세", vatTxt),
        row("가격 종류", { regular: "일반가 — 조건 문구가 없는 가격", event: `${r[5] === 1 ? "체험가" : "한정가"} — 보통 1인 1회·기간·수량 조건이 붙는 행사 가격`, cond: "조건부 — 첫 방문·요일·시간 같은 조건이 맞을 때만", posted: "고시가 — 병원 게시 비급여 가격표(정가), 행사 가격 아님", pass: "구독권·이용권" }[priceClass(r)]),
        row("조건", conds.length ? h("ul", { class: "warns" }, conds.map((c) => h("li", {}, c))) : "상품명에 조건 문구가 없어요. 그래도 실제 조건은 병원 원문으로 확인하세요."),
        row("회차", sessOf(i) >= 99 ? "이용권·무제한" : sessOf(i) > 1 ? `${sessOf(i)}회 묶음 가격` : "1회 가격(또는 회차 표기 없음)"),
        row("유효기간", /^\d{4}-\d{2}-\d{2}$/.test(u) ? `${u}까지${r[15] === 1 ? " (끝남 — 비교에서 빠져요)" : ""}` : u.startsWith("posted:") ? `고시표 게시일 ${u.slice(7)}` : "적혀 있지 않아요"),
        row("비교 기준", stx ? (FLAGS.lowestHighlight ? `${stx.by} ${stx.n}곳의 지점별 최저가 중 ${stx.rank}번째 · 중간값 ${won(stx.med)}` : `${stx.by} ${stx.n}곳 · 중간값 ${won(stx.med)}`) + (stx.special ? " (특가 포함)" : " (일반가만)") : "같이 비교할 지점이 3곳 미만이에요"),
        row("정가(병원 표기)", r[4] ? `${won(r[4])} → 할인율 ${Math.round((r[4] - r[3]) / r[4] * 100)}% · 병원이 적은 정가 기준이고, 가격 이력과는 별개예요` : "정가 표기 없음 — 할인율을 만들지 않아요"),
        row("확인일", `${f.d || "-"} 수집${f.stale ? " · 이번 주 수집 실패, 지난 자료라 최저가에서 빼요" : " · 이번 주 확인됨"}`),
        row("원본", S[r[11]] ? h("a", { href: S[r[11]], target: "_blank", rel: "noopener noreferrer" }, "병원 원본 페이지 열기 ", icon("external-link", "xs")) : "원본 링크 없음"),
        row("정품 표기", /정품/.test(S[r[2]]) ? "상품명에 '정품'이라고 적혀 있어요(병원 표기, 앱이 확인한 것 아님)" : "상품명에 정품 표기가 없어요. 앱은 장비·약제의 정품 여부를 확인하지 않아요"),
        row("시술 의료진", "앱은 의료진 정보를 모으지 않아요. 누가 시술하는지 병원에 확인하세요"),
        (() => { const e = kbOfRow(i); return row("부작용·주의사항", e ? h("span", {}, (e.side_effects || []).slice(0, 3).join(" / ") || "정리 중", " ", h("button", { class: "linkbtn", type: "button", onclick: () => { close(); kbSheet(e); } }, "자세히")) : "이 상품의 시술 설명이 아직 정리되지 않았어요. 상담 때 꼭 물어보세요"); })(),
        row("원본 대조", CHK.has(i) ? `${CHK.get(i).d} · ${CHECK_TXT[CHK.get(i).s]}` : low ? "아직 다시 확인하지 않았어요 (초저가 원본 대조는 운영자가 따로 돌려요)" : "대조 대상 아님 (초저가만 다시 확인해요)"),
        r[15] === 2 ? row("검토", "지난 수집보다 크게 바뀌어 운영자 확인 전이라 비교에서 빠져요") : null),
      h("div", { class: "row", style: "margin-top:14px;gap:8px" }, h("button", { class: "btn sm gray", type: "button", style: "flex:1", onclick: () => { close(); checklistSheet({ id: `r:${bkey(r[0])}|${S[r[2]]}`, title: `${bname(r[0])} · ${S[r[2]]}`, i }); } }, icon("list-checks", "sm"), "방문 전 체크리스트"),
        shortBtn(r[0], "btn sm gray")),
      h("button", { class: "btn gray", type: "button", style: "width:100%;margin-top:8px", onclick: () => { close(); recheckSheet(i); } }, icon("refresh-cw", "sm"), "이 가격 다시 확인하기"),
      h("button", { class: "btn gray", type: "button", style: "width:100%;margin-top:8px", onclick: () => { close(); reportSheet(i); } }, icon("flag", "sm"), "원본과 달라요 (가격 확인 요청)")));
  }
  // what the comparability classes mean (domain/classify.js CLASSES), the same sentences the price sheet uses
  function clsSheet() {
    const lv = { direct: "그대로 비교", caution: "비교하되 확인", reference: "참고만", never: "비교 안 함" };
    sheet("비교 판정 A~J", () => h("div", {}, h("p", { class: "sub" }, "가격 한 줄이 같은 묶음의 다른 가격과 얼마나 같은 시술인지, 병원이 적은 상품명만 보고 판정해요. 앱이 시술 내용을 직접 확인한 것은 아니에요."),
      h("dl", { class: "facts" }, Object.entries(Classify.CLASSES).map(([c, x]) => h("div", { class: "fact" }, h("dt", {}, `${c} · ${x.label}`), h("dd", {}, `${lv[x.cmp]} — ${x.say}`))))));
  }
  // ---- '이 가격 다시 확인하기' (docs/PRICE_REFRESH_DESIGN.md). No re-collection server yet, so nothing here pretends to re-read
  // the clinic site: it shows what 윤실장 has (collection date, this week's state, source re-check), opens the source page, and
  // sends a real re-check request (public GitHub issue) — at most once a day per price and 10 a day on this phone.
  const RECHECK_DAY = 10;
  const nextCollect = () => { const d = new Date(today() + "T00:00:00Z"); do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== 1); return d.toISOString().slice(0, 10); };
  function recheckSheet(i) {
    const r = ROWS[i], b = r[0], f = fresh(b), key = `${bkey(b)}|${S[r[2]]}|${r[14]}`;
    const log = store.get("rechecks", []).filter((x) => x.at >= Intel.daysBefore(today(), 30));
    const todayN = log.filter((x) => x.at === today()).length, mine = log.find((x) => x.key === key && x.at === today());
    const row = (k, v) => h("div", { class: "fact" }, h("dt", {}, k), h("dd", {}, v));
    const body = () => [`지점: ${bname(b)}`, `상품: ${S[r[2]]}`, `앱 표시: ${won(r[3])} (병원 표시 ${won(r[14])})`, `윤실장 수집일: ${f.d || "-"}${f.stale ? " (이번 주 수집 실패)" : ""}`,
      `원본: ${S[r[11]] || "-"}`, `앱 데이터: ${D.meta.updated}${SYNC.version ? ` (${SYNC.version})` : ""}`].join("\n");
    sheet("이 가격 다시 확인하기", (close) => h("div", {},
      h("div", { class: "item", style: "padding:6px 0 10px" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])), h("span", { class: "m" }, bdot(b), bname(b))),
      h("div", { class: "note" }, h("b", {}, "지금은 시연 단계예요. "), "버튼을 눌러도 병원 사이트를 바로 다시 읽지 않아요(재수집 서버가 아직 없어요). 아래는 윤실장이 가진 기록과, 직접 확인하거나 재확인을 요청하는 방법이에요."),
      h("h3", { style: "margin-top:14px" }, "윤실장이 가진 기록"),
      h("dl", { class: "facts" },
        row("병원 가격을 읽은 날", `${f.d || "-"}${f.n != null ? ` (${f.n === 0 ? "오늘" : `${f.n}일 전`})` : ""}`),
        row("이번 주 수집", f.stale ? "실패 — 지난 자료를 보여주고 있어요" : "성공"),
        row("원본 대조", CHK.has(i) ? `${CHK.get(i).d} · ${CHECK_TXT[CHK.get(i).s]}` : "이 가격은 따로 대조하지 않았어요(초저가만 대조)"),
        row("앱 데이터", `${D.meta.updated} 수집본${SYNC.version ? ` · 버전 ${SYNC.version}` : ""}${SYNC.at ? ` · 이 휴대폰이 서버 버전을 확인한 시각 ${SYNC.at.slice(11, 16)}(UTC)` : ""}`),
        row("다음 정기 수집", `${nextCollect()}(월) 06:00 무렵 · 이벤트가 끝난 다음 날에도 모아요`)),
      h("h3", { style: "margin-top:14px" }, "직접 확인"),
      S[r[11]] ? h("a", { class: "btn gray", style: "width:100%;text-align:center;text-decoration:none;margin-top:6px", href: S[r[11]], target: "_blank", rel: "noopener noreferrer" }, icon("external-link", "sm"), "병원 원본 페이지 열기")
        : h("div", { class: "sub" }, "원본 링크가 없어요."),
      h("h3", { style: "margin-top:14px" }, "재확인 요청 (실제 접수)"),
      h("div", { class: "sub" }, "운영자에게 공개 글(GitHub 이슈)로 가요. 운영자가 원본 대조를 돌리면 다음 빌드에 반영돼요. 같은 가격은 하루에 한 번, 이 휴대폰에서 하루 10번까지예요."),
      mine ? h("div", { class: "note", style: "margin-top:8px" }, `오늘 이미 요청했어요(${mine.at}). 같은 가격은 하루에 한 번만 보내요.`)
        : todayN >= RECHECK_DAY ? h("div", { class: "note", style: "margin-top:8px" }, `오늘 요청을 ${RECHECK_DAY}번 보냈어요. 내일 다시 보낼 수 있어요.`)
        : h("a", { class: "btn", style: "width:100%;text-align:center;text-decoration:none;margin-top:8px", target: "_blank", rel: "noopener",
          href: `https://github.com/lsy2825/skin/issues/new?${new URLSearchParams({ title: `[재확인 요청] ${bname(b)} ${S[r[2]]}`.slice(0, 120), body: body(), labels: "price-recheck" })}`,
          onclick: () => { store.set("rechecks", [{ at: today(), key, n: S[r[2]], br: bkey(b) }, ...log].slice(0, 100)); setTimeout(close, 100); } }, icon("send", "sm"), "GitHub로 재확인 요청"),
      h("p", { class: "tiny", style: "margin-top:6px" }, "GitHub 화면에서 '제출'을 눌러야 접수돼요. 공개 글이라 개인정보는 적지 마세요.")));
  }
  function addRowSheet(i) {
    const r = ROWS[i], n = S[r[2]], keys = S[r[7]] ? S[r[7]].split(" ").map((id) => KI[id]).filter((x) => x != null) : [];
    const s = { q: 1, ci: st.ci, how: "row" };
    const same = (byName.get(r[2]) || []).map((x) => ROWS[x][0]).filter((b, j, a) => a.indexOf(b) === j).length;
    sheet("장바구니에 담기", (close) => {
      const box = h("div", {});
      const paint = () => fill(box,
        h("div", { class: "item", style: "padding:10px 0" }, h("span", { class: "t" }, n), h("span", { class: "p num" }, won(r[3])),
          h("span", { class: "m" }, bdot(r[0]), bname(r[0]), listS(r), kindBadge(r), sessOf(i) > 1 ? h("span", { class: "k k4" }, sessOf(i) >= 99 ? "이용권" : `${sessOf(i)}회 가격`) : null)),
        h("div", { class: "opts" },
          h("button", { class: "opt", type: "button", "aria-pressed": s.how === "row" ? "true" : "false", onclick: () => { s.how = "row"; paint(); } },
            h("b", {}, "이 옵션 그대로"), h("span", {}, `같은 이름 상품이 있는 ${same}개 지점끼리 비교`)),
          keys.map((k) => h("button", { class: "opt", type: "button", "aria-pressed": s.how === k ? "true" : "false", onclick: () => { s.how = k; paint(); } },
            h("b", {}, `같은 시술로: ${KEYS[k].label}`), h("span", {}, "모든 브랜드·지점과 비교")))),
        h("div", { class: "row", style: "margin-top:14px" }, h("span", { class: "sub" }, "횟수(회차)"), h("span", { class: "sp" }), qtyEl(() => s.q, (v) => { s.q = v; paint(); })),
        cartPicker(s.ci, (x) => { s.ci = x; paint(); }),
        h("div", { class: "row", style: "margin-top:14px;gap:8px" },
          h("button", { class: "btn sm gray", type: "button", style: "flex:1", onclick: () => { close(); priceSheet(i); } }, icon("info", "sm"), "가격 근거"),
          h("button", { class: "btn sm gray", type: "button", style: "flex:1", onclick: () => { close(); alertSheet({ row: { n, br: bkey(r[0]) } }); } }, icon("bell", "sm"), /^\d{4}-\d{2}-\d{2}$/.test(S[r[10]] || "") ? "종료 전 알림" : "가격 알림"),
          h("button", { class: "btn sm gray", type: "button", style: "flex:1", onclick: () => { close(); reportSheet(i); } }, icon("flag", "sm"), "신고")),
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:12px", onclick: () => {
          const cart = st.carts[s.ci], items = cart.items;
          let added = null;
          if (s.how === "row") {
            const ov = {};
            added = { t: "r", n, br: bkey(r[0]), p: r[3], q: s.q, ov }; items.push(added);
          } else {
            const id = KEYS[s.how].id, have = items.find((c) => c.t === "k" && c.k === id);
            if (have) have.q = s.q; else { added = { t: "k", k: id, q: s.q, ov: { [bkey(r[0])]: n } }; items.push(added); }
          }
          saveCarts(); close(); render();
          if (!added) toast("횟수를 바꿨어요");
          else jomiToast("happy", jline("added") || `'${cart.name}'에 담았어요`, ["되돌리기", () => { cart.items = cart.items.filter((x) => x !== added); saveCarts(); render(); toast("되돌렸어요"); }]);
        } }, `${s.q}회 담기`));
      paint();
      return box;
    });
  }

  // rows of branch b that stand for the item (the default candidates)
  function itemRows(it, b, special = st.special) {
    let out;
    if (it.t === "k") out = KI[it.k] != null ? byKB[KI[it.k]].get(b) || [] : [];
    else out = (byName.get(SI.get(it.n)) || []).filter((i) => ROWS[i][0] === b);
    return out.filter((i) => live(i) && (special || !isSpecial(ROWS[i])));
  }
  // every row of branch b the user may pick instead (other doses, packages, special prices)
  function altRows(it, b) {
    const base = itemRows(it, b, true);
    let rx = null;
    if (it.t === "k" && famOf[KI[it.k]]) rx = famOf[KI[it.k]].f.rx;
    if (it.t === "r") { const w = it.n.replace(/^\[[^\]]*\]\s*/, "").split(/[\s(·]/).find((x) => x.length >= 2); if (w) rx = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); }
    const more = rx ? byB[b].filter((i) => live(i) && rx.test(S[ROWS[i][2]])) : [];
    return [...new Set([...base, ...more])].sort((a, c) => ROWS[a][3] - ROWS[c][3]).slice(0, 80);
  }
  const asC = (i) => ({ i, p: ROWS[i][3], special: isSpecial(ROWS[i]) });
  // price of q sessions of an item at branch b (Pricing.lineCost); it.sp overrides 특가 포함 for this line
  const hasTag = (i, tag) => (S[ROWS[i][6]] || "").split("·").includes(tag);
  function lineAt(it, b, noOnce = false) {
    const ovName = it.ov && it.ov[bkey(b)];
    let ov = null;
    if (ovName != null && SI.has(ovName)) {
      const i = (byName.get(SI.get(ovName)) || []).find((x) => ROWS[x][0] === b && live(x));
      if (i != null) ov = { i, p: ROWS[i][3], sess: sessOf(i), special: isSpecial(ROWS[i]) };
    }
    const sp = it.sp ?? st.special;
    const keep = (i) => !noOnce || !hasTag(i, "첫 방문");
    if (ov && !keep(ov.i)) ov = null;
    return Pricing.lineCost(itemRows(it, b, sp).filter(keep).map(asC), itemRows(it, b, false).filter(keep).map(asC), it.q || 1, ov);
  }
  const branchOk = (b) => brandOn(b) && regionOk(b) && (!st.maxKm || !st.loc || (dist(b) != null && dist(b) <= st.maxKm));
  // a line whose later sessions have no price (only a special exists, round-2 R14) is shown but never summed or compared
  const okL = (l) => !!l && !l.incomplete;
  const incTxt = (l) => `1회 ${won(l.total)}만 확인 · ${l.unpriced}회는 가격 없음(특가 반복 여부 미확인) — 합계에서 뺐어요`;
  // whole cart across branches (Pricing.compareClinics): full / partial / mix / pair / savings
  // first-visit prices: at most one per branch unless the user turns it off (st.noStack, Pricing.limitOnce)
  function cartPlan(items) {
    const matrix = BR.filter((x) => branchOk(x.i)).map((x) => {
      let lines = items.map((it) => lineAt(it, x.i));
      if (st.noStack) lines = Pricing.limitOnce(lines, lines.map((l) => !!l && hasTag(l.rows[0], "첫 방문")), (j) => lineAt(items[j], x.i, true));
      return { b: x.i, lines };
    });
    const r = Pricing.compareClinics(matrix);
    for (const x of [...r.full, ...r.partial]) x.d = dist(x.b);
    r.byB = new Map(matrix.map((m) => [m.b, m.lines]));
    return r;
  }
  // budget cap per cart: over-budget plans are marked, '예산 안만 보기' hides them
  function budgetEl(c) {
    // number box ↔ slider (live), quick amounts; applied when the value is valid and changed
    const MAX = 2000000;
    const inp = h("input", { class: "pick", type: "number", inputmode: "numeric", min: "0", step: "10000", value: c.budget || "", placeholder: "예: 300000", "aria-label": "예산 상한(원)", style: "max-width:150px" });
    const rng = h("input", { type: "range", min: "0", max: String(MAX), step: "10000", value: String(Math.min(c.budget || 0, MAX)), "aria-label": "예산 상한 슬라이더", "aria-valuetext": c.budget ? won(c.budget) : "없음" });
    const err = h("div", { class: "ferr", role: "alert", hidden: true }, "0보다 큰 금액을 적어 주세요");
    const shown = h("span", { class: "sub" }, c.budget ? won(c.budget) : "제한 없음");
    const valid = () => { const ok = !inp.value || +inp.value > 0; err.hidden = ok; inp.setAttribute("aria-invalid", ok ? "false" : "true"); return ok; };
    const apply = (v) => { if (!valid()) return; v = Math.round(v || 0) || null; if (v === (c.budget || null)) return; c.budget = v; saveCarts(); render(); };
    rng.addEventListener("input", () => { inp.value = +rng.value || ""; shown.textContent = +rng.value ? won(+rng.value) : "제한 없음"; rng.setAttribute("aria-valuetext", shown.textContent); valid(); });
    rng.addEventListener("change", () => apply(+rng.value));
    inp.addEventListener("input", () => { rng.value = String(Math.min(+inp.value || 0, MAX)); shown.textContent = +inp.value > 0 ? won(+inp.value) : "제한 없음"; valid(); });
    inp.addEventListener("change", () => apply(+inp.value));
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(+inp.value); });
    return h("div", { class: "budget" },
      h("div", { class: "row", style: "gap:8px" }, inp, h("span", { class: "sub" }, "원"), h("span", { class: "sp" }), shown),
      h("div", { class: "sliders" }, rng),
      err,
      h("div", { class: "chips wrapc", style: "margin-top:6px" }, [[100000, "10만"], [200000, "20만"], [300000, "30만"], [500000, "50만"], [1000000, "100만"], [0, "제한 없음"]].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": (c.budget || 0) === v ? "true" : "false", onclick: () => { inp.value = v || ""; apply(v); } }, l))),
      c.budget ? h("div", { style: "margin-top:6px" }, switchEl("예산 안만 보기", st.inBudget, (v) => { st.inBudget = v; render(); })) : null);
  }
  // conditions to check before visiting, for one branch's quote
  function quoteWarnings(x) {
    const w = [];
    const ls = x.lines.filter(Boolean);
    const sp = ls.filter((l) => isSpecial(ROWS[l.rows[0]])).length;
    if (sp) w.push(`체험가·한정가·시간 조건 가격 ${sp}개 — 1인 1회·첫 방문·시간대 조건을 병원에 확인하세요`);
    if (ls.some((l) => l.restacked)) w.push("첫 방문가가 여러 개라 하나만 첫 방문가로, 나머지는 다음 가격으로 계산했어요");
    if (ls.some((l) => l.stackWarn)) w.push("첫 방문가만 있는 시술이 여러 개예요 — 함께 적용되는지 병원에 확인하세요");
    if (ls.some((l) => ROWS[l.rows[0]][17] === 2)) w.push("방문 시간에 되는 가격인지 확인이 필요해요(시간대 미표기)");
    const low = ls.filter((l) => isLow(l.rows[0])).length;
    if (low) w.push(`같은 시술 중간값의 ${Math.round(LOW_SHARE * 100)}% 이하인 초저가 ${low}개 — 개당 가격·행사 조건일 수 있어요. '가격 근거'에서 원본을 확인하세요`);
    if (x.missing && x.missing.length) w.push(`이 지점에서 가격을 확인하지 못한 시술 ${x.missing.length}개 — 합계에 넣지 않았어요(0원 아님)`);
    if (fresh(x.b).stale) w.push(`가격 확인일 ${fresh(x.b).d} — 최신이 아닐 수 있어요`);
    // CART_INTELLIGENCE_REPORT.md: quantity limits, package conditions, combining promotions
    if (ls.some((l) => l.incomplete)) w.push("특가만 있는 시술은 2회째부터 가격이 없어 합계에서 뺐어요 — 반복 가격을 병원에 확인하세요");
    if (ls.some((l) => l.laterRegular)) w.push("특가는 첫 1회만, 2회째부터는 이 지점 일반가로 계산했어요 — 특가 반복 여부는 병원마다 달라요");
    const pk = ls.filter((l) => sessOf(l.rows[0]) > 1 && sessOf(l.rows[0]) < 99).length;
    if (pk) w.push(`여러 회 묶음 가격 ${pk}개 — 한 번에 결제하는지, 사용 기간이 있는지 확인하세요`);
    if (sp >= 2) w.push(`할인 가격 ${sp}개를 한 번에 받는 계산이에요 — 같은 날 중복 할인이 되는지 병원에 확인하세요`);
    return w;
  }
  // share: the cart travels in the link (#import/<base64url json>)
  const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
  function shareCart(c) {
    const items = c.items.filter(itemOk);
    const plan = items.length ? cartPlan(items) : null, best = plan && plan.full[0];
    const s = { from: store.get("sender", st.me.nick || ""), note: "" };
    sheet("장바구니 보내기", (close) => {
      const from = h("input", { class: "field", value: s.from, maxlength: "20", placeholder: "보내는 사람 (선택)", "aria-label": "보내는 사람" });
      const note = h("textarea", { class: "field", rows: "2", maxlength: "200", placeholder: "메모 (예: 이번 달에 같이 받자!)", "aria-label": "메모" });
      const preview = h("pre", { class: "preview" });
      const payload = () => ({ name: c.name, items: c.items, from: from.value.trim().slice(0, 20), note: note.value.trim().slice(0, 200),
        sent: best ? { total: best.total, b: bkey(best.b), date: today(), vat: st.vat } : null });
      const link = () => `${location.origin}${location.pathname}#import/${enc(payload())}`;
      const text = () => [`${from.value.trim() ? `${from.value.trim()}님이 보낸 ` : ""}윤실장 장바구니 '${c.name}'`,
        ...c.items.map((it) => `- ${itemLabel(it)} ×${it.q || 1}`),
        best ? (FLAGS.lowestHighlight ? `한 곳 최저: ${bname(best.b)} ${won(best.total)}` : (() => { const ts = plan.full.map((x) => x.total); return `한 곳에서 다 받을 때 예상 ${won(Math.min(...ts))} ~ ${won(Math.max(...ts))} (${ts.length}곳)`; })())
          + ` (${today()} 기준, ${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"})` : null,
        note.value.trim() || null].filter(Boolean).join("\n");
      const paint = () => { preview.textContent = text(); };
      from.addEventListener("input", paint); note.addEventListener("input", paint); paint();
      return h("div", {}, h("label", { class: "flabel" }, "보내는 사람", from), h("label", { class: "flabel" }, "메모", note),
        h("div", { class: "flabel" }, "미리보기"), preview,
        h("div", { class: "row", style: "margin-top:14px" },
          h("button", { class: "btn gray", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(link()); toast("링크만 복사했어요"); } catch (e) { toast("복사하지 못했어요"); } } }, "링크만 복사"),
          h("button", { class: "btn", type: "button", style: "flex:1", onclick: async () => {
            store.set("sender", from.value.trim());
            try {
              if (navigator.share) await navigator.share({ title: "윤실장 장바구니", text: text(), url: link() });
              else { await navigator.clipboard.writeText(`${text()}\n${link()}`); toast("메시지와 링크를 복사했어요"); }
              close();
            } catch (e) { if (e && e.name !== "AbortError") toast("보내지 못했어요"); }
          } }, "보내기")));
    });
  }
  function quoteText(x, items) {
    return [`[${bname(x.b)}] 예상 견적 (${D.meta.updated} 기준)`,
      ...items.map((it, j) => { const l = x.lines[j]; return l ? `- ${itemLabel(it)} ×${it.q || 1}: ${l.incomplete ? incTxt(l) : won(l.total)} (${S[ROWS[l.rows[0]][2]]})` : `- ${itemLabel(it)}: 이 지점에 없음`; }),
      `합계 ${won(x.total)} (${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가, 대부분 부가세 별도"}) · 가격 확인 ${fresh(x.b).d} · 방문 전 병원 확인`,
      ...quoteWarnings(x).map((s) => `※ ${s}`)].join("\n");
  }

  // ---------------- price trend (weekly snapshots of regular prices; data.json "trend")
  const TR = () => D.trend || { dates: [], k: {}, disc: {} };
  const md = (d) => d.slice(5).replace("-", "/");
  const man = (n) => n >= 10000 ? `${(n / 10000).toFixed(n % 10000 ? 1 : 0).replace(/\.0$/, "")}만` : n.toLocaleString();
  const svg = (tag, attrs, ...kids) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v); kids.forEach((c) => c && e.append(c)); return e; };
  // change of the median between the last two snapshots that have the key
  function keyChange(id) {
    const v = (TR().k[id] || []).map((x) => x && x[0]);
    const idx = v.map((x, i) => (x != null ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) return null;
    const a = v[idx[idx.length - 2]], b = v[idx[idx.length - 1]];
    return { a, b, pct: (b - a) / a * 100 };
  }
  const chg = (c) => !c ? h("span", { class: "sub" }, "변동 기록 전") : Math.abs(c.pct) < 0.5 ? h("span", { class: "sub" }, "지난 수집과 같음")
    : h("span", { class: c.pct < 0 ? "down" : "up" }, `${c.pct < 0 ? "▼" : "▲"} ${Math.abs(c.pct).toFixed(1)}%`);
  function sparkline(vals) {
    const pts = vals.map((v, i) => [i, v]).filter((p) => p[1] != null);
    if (pts.length < 2) return null;
    const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1])), n = vals.length - 1;
    const d = pts.map(([i, v], j) => `${j ? "L" : "M"}${(i / n * 56 + 2).toFixed(1)},${(hi === lo ? 11 : 20 - (v - lo) / (hi - lo) * 18).toFixed(1)}`).join("");
    return svg("svg", { viewBox: "0 0 60 22", width: 60, height: 22, class: "spark", "aria-hidden": "true" }, svg("path", { d }));
  }
  // monotone cubic path (Fritsch–Carlson): smooth, but never bends above or below the prices that were actually seen
  function smoothPath(pts) {
    const n = pts.length;
    if (n < 2) return "";
    if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < n - 1; i++) { const k = dx[i] / 3;
      d += `C${(pts[i][0] + k).toFixed(1)},${(pts[i][1] + t[i] * k).toFixed(1)} ${(pts[i + 1][0] - k).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * k).toFixed(1)} ${pts[i + 1][0]},${pts[i + 1][1]}`; }
    return d;
  }
  const niceStep = (span, n = 3) => { const raw = span / n || 1, mag = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= raw); };
  // line chart: one axis, 2px lines broken where a week has no record, end labels, crosshair tooltip (pointer, touch,
  // arrow keys), table view. Only observed points are drawn; nothing is filled in between records.
  function lineChart(dates, series, title) {
    const W = 340, H = 196, L = 40, R = 58, T = 16, B = 26;
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    const wrap = h("div", { class: "lc" });
    if (!all.length) return wrap;
    let lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.15 || hi * 0.1 || 1; lo = Math.max(0, lo - pad); hi += pad;
    const stepv = niceStep(hi - lo);
    lo = Math.floor(lo / stepv) * stepv; hi = lo + stepv * 3; while (hi < Math.max(...all)) hi += stepv;
    const x = (i) => dates.length < 2 ? L + (W - L - R) / 2 : L + i / (dates.length - 1) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "lcsvg", role: "img", "aria-label": title });
    for (let v = lo; v <= hi + 1e-6; v += stepv) {
      const yy = y(v);
      g.append(svg("line", { x1: L, x2: W - R + 8, y1: yy, y2: yy, class: v === lo ? "base" : "grid" }));
      const tx = svg("text", { x: L - 8, y: yy + 4, class: "ax", "text-anchor": "end" }); tx.textContent = man(Math.round(v)); g.append(tx);
    }
    const step = Math.max(1, Math.ceil(dates.length / 5));
    dates.forEach((d, i) => { if (i % step && i !== dates.length - 1) return; const tx = svg("text", { x: x(i), y: H - 6, class: "ax", "text-anchor": "middle" }); tx.textContent = md(d); g.append(tx); });
    const labels = [];
    series.forEach((s) => {
      // consecutive observed weeks form one segment; a missing week breaks the line
      const segs = []; let cur = [];
      s.values.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([+x(i).toFixed(1), +y(v).toFixed(1)]); });
      if (cur.length) segs.push(cur);
      for (const sg of segs) if (sg.length > 1) g.append(svg("path", { d: smoothPath(sg), class: "ln draw", pathLength: "1", style: `stroke:${s.color};--len:1` }));
      s.values.forEach((v, i) => { if (v != null) g.append(svg("circle", { cx: x(i), cy: y(v), r: dates.length > 26 ? 2.5 : 3.5, class: "mk", style: `fill:${s.color}` })); });
      const li = s.values.map((v, i) => [i, v]).filter((p) => p[1] != null).pop();
      if (li) labels.push({ s, x: x(li[0]) + 8, y: y(li[1]) + 4, v: li[1] });
    });
    // end labels: nudge apart when two series end close together
    labels.sort((p, q) => p.y - q.y).forEach((lb, j, arr) => { if (j && lb.y - arr[j - 1].y < 13) lb.y = arr[j - 1].y + 13; });
    for (const lb of labels) { const tx = svg("text", { x: lb.x, y: lb.y, class: "dl" }); tx.textContent = `${lb.s.name} ${man(lb.v)}`; g.append(tx); }
    // crosshair + tooltip
    const hair = svg("line", { y1: T, y2: H - B, class: "hair", visibility: "hidden" });
    const hit = svg("rect", { x: L - 12, y: 0, width: W - L - R + 24, height: H, fill: "transparent" });
    g.append(hair, hit);
    // keyboard: the chart box is one slider (arrow keys move the date); the drawing inside is a picture
    const kbox = h("div", { class: "lcbox", tabindex: "0", role: "slider", "aria-label": `${title} — 좌우 방향키로 날짜 이동`, "aria-valuemin": "0", "aria-valuemax": String(dates.length - 1),
      "aria-valuenow": String(dates.length - 1) });
    const tip = h("div", { class: "lctip", hidden: true });
    let at = dates.length - 1;
    const show = (i) => {
      at = i;
      hair.setAttribute("x1", x(i)); hair.setAttribute("x2", x(i)); hair.setAttribute("visibility", "visible");
      tip.replaceChildren(h("div", { class: "sub" }, dates[i]), ...series.map((s) => h("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" },
        h("span", { class: "key", style: `background:${s.color}` }), h("b", { class: "num" }, s.values[i] != null ? won(s.values[i]) : "기록 없음"), h("span", {}, s.name))));
      tip.hidden = false; tip.style.left = `${Math.min(84, Math.max(16, x(i) / W * 100))}%`;
      kbox.setAttribute("aria-valuenow", String(i)); kbox.setAttribute("aria-valuetext", `${dates[i]} ${series.map((s) => `${s.name} ${s.values[i] != null ? won(s.values[i]) : "기록 없음"}`).join(", ")}`);
    };
    const hide = () => { tip.hidden = true; hair.setAttribute("visibility", "hidden"); };
    const near = (e) => { const r = g.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W; let bi = 0; dates.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(bi) - px)) bi = i; }); return bi; };
    hit.addEventListener("pointermove", (e) => show(near(e)));
    hit.addEventListener("pointerdown", (e) => show(near(e)));
    hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    kbox.addEventListener("focus", () => show(at));
    kbox.addEventListener("blur", hide);
    kbox.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { show(Math.max(0, Math.min(dates.length - 1, at + (e.key === "ArrowLeft" ? -1 : 1)))); e.preventDefault(); } });
    const legend = series.length > 1 ? h("div", { class: "row lclegend" }, series.map((s) => h("span", { class: "row", style: "gap:6px" }, h("span", { class: "key", style: `background:${s.color}` }), s.name))) : null;
    const table = h("table", { class: "lctable", hidden: true }, h("thead", {}, h("tr", {}, h("th", {}, "날짜"), series.map((s) => h("th", {}, s.name)))),
      h("tbody", {}, dates.map((d, i) => h("tr", {}, h("td", {}, d), series.map((s) => h("td", { class: "num" }, s.values[i] != null ? won(s.values[i]) : "-"))))));
    const tbtn = h("button", { class: "linkbtn", type: "button", style: "min-height:28px", onclick: () => { table.hidden = !table.hidden; tbtn.lastChild.textContent = table.hidden ? "표로 보기" : "표 닫기"; } }, icon("table", "xs"), h("span", {}, "표로 보기"));
    kbox.append(g, tip);
    wrap.append(legend || "", kbox, h("div", { class: "row" }, h("span", { class: "sp" }), tbtn), table);
    return wrap;
  }
  // where each clinic's lowest price sits: one dot per branch on one price axis (dots stacked where they would overlap),
  // filled = no condition, ring = a conditional price (first visit, trial …), dark = the headline lowest; dashed = median
  function distChart(list, med, bestI, title, onPick) {
    const W = 340, R = 4.5, PL = 14, PR = 14, TOP = 24, AX = 24;
    const ps = list.map((x) => x.p);
    let lo = Math.min(...ps), hi = Math.max(...ps);
    if (hi === lo) { lo = Math.max(0, lo * 0.9); hi = hi * 1.1 || 1; }
    const stepv = niceStep(hi - lo, 4), t0 = Math.floor(lo / stepv) * stepv, t1 = Math.ceil(hi / stepv) * stepv;
    const x = (v) => PL + (v - t0) / (t1 - t0) * (W - PL - PR);
    const rows = [];
    const dots = [...list].sort((a, c) => a.p - c.p).map((it) => { const xx = x(it.p); let k = 0; while (rows[k] != null && xx - rows[k] < R * 2 + 1) k++; rows[k] = xx; return { ...it, x: xx, k }; });
    const nr = rows.length, dy = Math.min(R * 2 + 1.5, 132 / Math.max(1, nr));
    const H = TOP + nr * dy + 8 + AX, base = H - AX;
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "lcsvg", role: "img",
      "aria-label": `${title}: ${list.length}곳, 최저 ${won(Math.min(...ps))}, 중간값 ${won(med)}, 최고 ${won(Math.max(...ps))}` });
    g.append(svg("line", { x1: PL - 6, x2: W - PR + 6, y1: base, y2: base, class: "base" }));
    for (let v = t0; v <= t1 + 1e-6; v += stepv) {
      g.append(svg("line", { x1: x(v), x2: x(v), y1: base, y2: base + 4, class: "base" }));
      const tx = svg("text", { x: x(v), y: H - 6, class: "ax", "text-anchor": v === t0 ? "start" : v + stepv > t1 + 1e-6 ? "end" : "middle" }); tx.textContent = man(Math.round(v)); g.append(tx);
    }
    const mx = x(med);
    g.append(svg("line", { x1: mx, x2: mx, y1: 14, y2: base, class: "med" }));
    const mt = svg("text", { x: Math.min(W - PR, Math.max(PL, mx)), y: 10, class: "medt", "text-anchor": mx < 60 ? "start" : mx > W - 60 ? "end" : "middle" }); mt.textContent = `중간값 ${man(med)}`; g.append(mt);
    const els = dots.map((d, j) => { const c = svg("circle", { cx: d.x.toFixed(1), cy: (base - R - 2 - d.k * dy).toFixed(1), r: R, "data-b": d.b, class: `dot pop${d.cond ? " cond" : ""}${d.i === bestI ? " best" : ""}`,
      style: `animation-delay:${Math.min(j * 12, 400)}ms` }); g.append(c); return c; });
    const hit = svg("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" });
    g.append(hit);
    const kbox = h("div", { class: "lcbox", tabindex: "0", role: "slider", "aria-label": `${title} — 좌우 방향키로 지점 이동, Enter로 지점 보기`, "aria-valuemin": "0",
      "aria-valuemax": String(dots.length - 1), "aria-valuenow": "0" });
    const tip = h("div", { class: "lctip", hidden: true });
    let at = bestI != null ? Math.max(0, dots.findIndex((d) => d.i === bestI)) : 0;
    const show = (j) => {
      at = j; const d = dots[j];
      els.forEach((e, n) => e.classList.toggle("on", n === j));
      document.querySelectorAll("#clinics li[data-b].hl").forEach((x) => x.classList.remove("hl")); { const li = document.querySelector(`#clinics li[data-b="${d.b}"]`); if (li) li.classList.add("hl"); }
      tip.replaceChildren(h("div", { class: "sub" }, `${d.cond ? "조건부 가격" : "조건 없는 가격"}`), h("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, bdot(d.b), h("span", {}, bname(d.b))), h("b", { class: "num" }, won(d.p)));
      tip.hidden = false; tip.style.left = `${Math.min(80, Math.max(20, d.x / W * 100))}%`; tip.style.top = `${(base - R - d.k * dy - 8) / H * 100}%`;
      kbox.setAttribute("aria-valuenow", String(j)); kbox.setAttribute("aria-valuetext", `${bname(d.b)} ${won(d.p)}${d.cond ? " 조건부" : ""}`);
    };
    const hide = () => { tip.hidden = true; els.forEach((e) => e.classList.remove("on")); };
    const near = (e) => { const r = g.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, py = (e.clientY - r.top) / r.height * H; let bj = 0, bd = 1e9;
      dots.forEach((d, j) => { const dd = Math.abs(d.x - px) * 1.5 + Math.abs(base - R - d.k * dy - py) * 0.5; if (dd < bd) { bd = dd; bj = j; } }); return bj; };
    hit.addEventListener("pointermove", (e) => show(near(e)));
    hit.addEventListener("pointerdown", (e) => show(near(e)));
    hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    kbox.addEventListener("focus", () => show(at));
    kbox.addEventListener("blur", hide);
    kbox.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { show(Math.max(0, Math.min(dots.length - 1, at + (e.key === "ArrowLeft" ? -1 : 1)))); e.preventDefault(); }
      if (e.key === "Enter" && onPick) onPick(dots[at]);
    });
    const hasCond = dots.some((d) => d.cond), hasPlain = dots.some((d) => !d.cond);
    const legend = h("div", { class: "row lclegend" }, hasPlain ? h("span", { class: "row", style: "gap:6px" }, h("span", { class: "key solid", style: "background:var(--s1)" }), "조건 없는 가격") : null,
      hasCond ? h("span", { class: "row", style: "gap:6px" }, h("span", { class: "key ring" }), "조건부 가격") : null,
      bestI != null ? h("span", { class: "row", style: "gap:6px" }, h("span", { class: "key solid", style: "background:var(--ink)" }), "현재 최저가") : null);
    kbox.append(g, tip);
    return h("div", { class: "lc" }, legend, kbox);
  }
  function trendCard() {
    const tr = TR();
    if (!tr.dates.length) return null;
    const cats = CMP_CATS.filter((c) => FAM.some((f) => f.cat === c));
    if (!st.tcat || !cats.includes(st.tcat)) st.tcat = cats[0];
    // the main variant of the category's most-sold families (a category can hold hundreds of variants)
    const keys = famsIn(st.tcat).slice(0, 8).map((f) => KEYS[f.main]);
    const chs = keys.map((k) => keyChange(k.id)).filter(Boolean);
    const avg = chs.length ? chs.reduce((s, c) => s + c.pct, 0) / chs.length : null;
    const card = h("div", { class: "card flush" });
    card.append(h("div", { style: "padding:14px 14px 4px" }, h("div", { class: "row" }, h("h3", {}, "가격 동향"), h("span", { class: "sp" }),
      h("span", { class: "sub" }, tr.dates.length > 1 ? `${md(tr.dates[0])}~${md(tr.dates[tr.dates.length - 1])} · ${tr.dates.length}주` : `기록 시작 ${md(tr.dates[0])}`)),
      h("div", { class: "sub" }, "선과 '지난 수집 대비'는 실제로 모은 일반가 중간값의 변화(가격 이력)예요. '정가 표기 대비'는 이번 주 병원이 적은 정가에서 할인된 정도라 이력과 다른 숫자예요."),
      h("div", { class: "chips", style: "margin-top:10px" }, cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": c === st.tcat ? "true" : "false", onclick: () => { st.tcat = c; render(); } }, c))),
      h("div", { class: "row", style: "margin-top:10px" }, h("b", {}, `${st.tcat} 평균`), avg == null ? h("span", { class: "sub" }, tr.dates.length < 2 ? "다음 주 월요일부터 지난 수집 대비 변동이 보여요" : "변동 없음")
        : chg({ pct: avg }))),
      h("ul", { class: "list" }, keys.map((k) => { const v = (tr.k[k.id] || []).map((x) => x && x[0]); const now = v[v.length - 1]; const disc = tr.disc[k.id];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k.i; nav("compare"); } },
          h("span", { class: "t" }, k.label), h("span", { class: "p num" }, now != null ? won(now) : "-"),
          h("span", { class: "m" }, h("span", { class: "sub" }, "지난 수집 대비"), chg(keyChange(k.id)), disc != null ? h("span", { class: "k k4", title: "병원이 적은 정가와 판매가 비교(이번 주). 가격 이력과 별개" }, `정가 표기 대비 −${disc}%`) : null, h("span", { class: "sp" }), sparkline(v)))); })));
    return card;
  }
  function keyTrend(k) {
    const tr = TR(), v = tr.k[k.id];
    if (!v || !tr.dates.length) return null;
    const ranges = [["7", "7일"], ["30", "30일"], ["90", "90일"], ["", "전체"]];
    const from = st.hrange ? Intel.daysBefore(today(), +st.hrange) : "";
    const keep = tr.dates.map((d) => d >= from);
    const dates = tr.dates.filter((_, i) => keep[i]);
    const med = v.map((x) => x && x[0]).filter((_, i) => keep[i]), low = v.map((x) => x && x[1]).filter((_, i) => keep[i]);
    const s = Intel.historyStats(dates, low), sm = Intel.historyStats(dates, med);
    const card = h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "가격 이력"), h("span", { class: "sp" }), chg(keyChange(k.id))),
      h("div", { class: "sub" }, `${k.label} · 일반가, 전 브랜드 지점, 병원 표시가 기준 · 실제로 모은 날짜만`),
      reclDate(k.id) ? h("div", { class: "note recl" }, icon("info", "sm"), `${md(reclDate(k.id))}에 같은 시술로 묶는 기준을 고쳤어요(예: 10회 묶음·다른 장비가 섞이지 않게). 그 전 기록은 다른 상품이 섞인 값이라 빼고 보여줘요.`) : null,
      tr.dates.length > 1 ? h("div", { class: "chips", style: "margin-top:10px" }, ranges.map(([r, l]) => h("button", { class: "chip", type: "button", "aria-pressed": (st.hrange || "") === r ? "true" : "false", onclick: () => { st.hrange = r; render(); } }, l))) : null);
    if (!s) { card.append(h("div", { class: "empty" }, "이 기간에 관측된 가격이 없어요")); return card; }
    // one record is a point, not a trend: no line and no 'change' tiles until a second week is collected
    if (dates.length < 2) { card.append(h("div", { class: "chartempty" }, h("div", { class: "empty", style: "padding:8px 0 0" }, h("div", { class: "ei" }, icon("chart-line")),
      h("b", {}, `첫 기록 ${md(dates[0])} · 최저 ${won(s.cur)} · 중간값 ${won(sm ? sm.median : s.median)}`),
      "병원 표시가 기준이에요. 매주 월요일 가격을 모을 때마다 점이 하나씩 늘고, 두 번째 기록부터 선으로 이어져요. 기록이 없는 날은 채우지 않아요."))); return card; }
    card.append(h("div", { class: "tiles" },
      h("div", { class: "tile" }, h("span", { class: "k" }, "현재 최저가"), h("b", { class: "num" }, won(s.cur)), h("span", { class: "w" }, `${s.last} 확인`)),
      h("div", { class: "tile" }, h("span", { class: "k" }, "관측 최저 / 최고"), h("b", { class: "num" }, `${won(s.min)}`), h("span", { class: "w" }, `최고 ${won(s.max)} · 최저 마지막 ${s.minLast}`)),
      h("div", { class: "tile" }, h("span", { class: "k" }, "기간 중앙값"), h("b", { class: "num" }, won(sm ? sm.median : s.median)), h("span", { class: "w" }, "지점 중간값들의 중앙값")),
      h("div", { class: "tile" }, h("span", { class: "k" }, "최저가 변동"), h("b", { class: "num" }, `${s.changes}번`), h("span", { class: "w" }, `${s.points}번 관측 (${s.first}~)`))));
    card.append(lineChart(dates, [{ name: "중간값", color: "var(--s2)", values: med }, { name: "최저가", color: "var(--s1)", values: low }], `${k.label} 가격 이력`));
    return card;
  }
  // ---------------- saved treatments & price alerts (checked when the app opens; e-mail/push later with sign-in)
  const ALERT_TYPES = { watch: "지켜보기", target: "목표가 이하", newlow: "새 최저가", newmatch: "파는 지점이 늘면", cartdrop: "장바구니 합계", expiring: "이벤트 종료 3일 전" };
  // values for a treatment alert, independent of the screen (docs/ALERT_ENGINE_SPEC.md): the clinics' listed prices
  // (r[14], not the VAT display), all brands, the alert's own region (kept when it was made), specials as chosen then
  function watchNow(a) {
    const k = KI[a.k];
    if (k == null) return null;
    let low = null, lowB = "", lowRow = "";
    const set = [];
    for (const [b, rows] of byKB[k]) {
      if (!regOk(b, a.reg || "전국")) continue;
      const ok = rows.filter((i) => !ROWS[i][15] && (a.sp !== false || !isSpecial(ROWS[i])));
      if (!ok.length) continue;
      set.push(bkey(b));
      const best = ok.reduce((x, i) => (ROWS[i][14] < ROWS[x][14] ? i : x));
      if (low == null || ROWS[best][14] < low) { low = ROWS[best][14]; lowB = bkey(b); lowRow = `${bkey(b)}|${S[ROWS[best][2]]}`; }
    }
    const rowState = {};
    const prev = a.base && a.base.lowRow;
    if (prev) {
      const ps = prev.split("|"), b = BK.get(ps.slice(0, 2).join("|")), sid = SI.get(ps.slice(2).join("|"));
      const rows = b == null || sid == null ? [] : (byName.get(sid) || []).filter((i) => ROWS[i][0] === b && byKB[k].has(b));
      rowState[prev] = !rows.length ? "gone" : rows.every((i) => ROWS[i][15] === 1) ? "expired" : "live";
    }
    const lb = BK.get(lowB);
    const recheck = lb != null && fresh(lb).stale ? `최저가 지점(${bname(lb)})이 이번 주 수집에 실패해 지난 가격이에요` : "";
    return { low, lowB, lowName: lb != null ? bname(lb) : "", lowRow, count: set.length, set, rowState, recheck };
  }
  const saveAlerts = () => { store.set("alerts", st.alerts); store.set("notes", st.notes.slice(0, 30)); paintMeN(); };
  function paintMeN() { const el = $("#me-n"); if (!el) return; const n = st.notes.filter((x) => !x.read).length; el.hidden = !n; el.textContent = n; }
  function alertNow(a) {
    if (a.k) { const n = watchNow(a); return n && { value: n.low, count: n.count }; }
    if (a.cart != null) { const c = st.carts.find((x) => x.name === a.cart); if (!c) return null; const items = c.items.filter(itemOk); if (!items.length) return null; const b = cartPlan(items).full[0]; return { value: b ? b.total : null }; }
    if (a.row) { const sid = SI.get(a.row.n), b = BK.get(a.row.br); if (sid == null || b == null) return null; const i = (byName.get(sid) || []).find((x) => ROWS[x][0] === b); return i == null ? null : { value: ROWS[i][3], until: S[ROWS[i][10]] }; }
    return null;
  }
  const alertName = (a) => a.k ? (KI[a.k] != null ? KEYS[KI[a.k]].label : goneLabel(a.k) ? `${goneLabel(a.k)} (지금은 비교 묶음 없음)` : a.k) : a.cart != null ? `장바구니 '${a.cart}'` : a.row ? `${a.row.n} (${a.row.br.replace("|", " ")})` : "";
  // a structured record per alert event (알림 기록): type, treatment, real branch, before → after, data date, link
  const noteOf = (a, t, x) => ({ at: today(), obs: D.meta.updated, type: t, k: a.k || "", name: alertName(a), b: x.b || "", before: x.before ?? null, after: x.after ?? null,
    text: `${alertName(a)} — ${NOTE_T[t] || ""}: ${x.text}`, id: a.id, read: false });
  const NOTE_T = { ...ALERT_TYPES, ...Intel.WATCH_T, past: "지난 기록", test: "TEST" };
  function checkAlerts() {
    const td = today();
    let fired = 0;
    for (const a of st.alerts) {
      // alerts made before 2026-10-14 compared the screen's (VAT-mode, region-filtered) price: re-base once, silently
      // the treatment's rows were regrouped (a rule fix, meta.recl) or the alert moved to a successor id: a new mix of rows is
      // not a price change, so the baseline is set again without a notice
      const rd = a.k ? reclDate(a.k) : "";
      if (a.k && KI[a.k] != null && (a.regroup || (rd && rd > (a.rb || a.created || "")))) {
        a.rb = td; delete a.regroup;
        if (a.type === "watch") Object.assign(a, Intel.evalWatch({}, watchNow(a), td).patch);
        else { Object.assign(a, Intel.evalAlert({ ...a, lastAt: td, base: null, last: null }, alertNow(a), "0000-00-00").patch); delete a.lastAt; if (a.type === "target") delete a.last; }
        continue;
      }
      if (a.k && a.basis !== "listed") { a.basis = "listed"; a.reg = a.reg || st.region || "전국"; Object.assign(a, Intel.evalAlert({ ...a, lastAt: td, base: null, last: null }, alertNow(a), "0000-00-00").patch); delete a.lastAt; if (a.type === "target") delete a.last; continue; }
      if (a.type === "watch") {
        const r = Intel.evalWatch(a, watchNow(a), td);
        for (const e of r.events) { st.notes.unshift(noteOf(a, e.t, e)); fired++; }
        Object.assign(a, r.patch);
        continue;
      }
      const r = Intel.evalAlert(a, alertNow(a), td);
      Object.assign(a, r.patch);
      if (r.fire) { st.notes.unshift({ ...noteOf(a, a.type, { text: r.text, after: (alertNow(a) || {}).value }), text: `${alertName(a)} — ${r.text}` }); fired++; }
    }
    saveAlerts();
    if (fired) { toast(`가격 알림 ${fired}개 — 관심 탭에서 확인하세요`); deviceNotify(`가격 알림 ${fired}개`, st.notes[0].text); }
  }
  // 휴대폰 알림 (PWA_IMPLEMENTATION.md): only after the user taps '휴대폰 알림 켜기'; only while the app runs (no push server)
  const notifySupported = () => "Notification" in window && "serviceWorker" in navigator;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  async function deviceNotify(title, body, tag = "pc-alert") {
    if (!notifySupported() || Notification.permission !== "granted") return false;
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.showNotification(title, { body, tag, icon: "icons/icon-192.png", badge: "icons/favicon-32.png" }); else new Notification(title, { body, tag }); return true; } catch (e) { return false; }
  }
  function addAlert(a) {
    if (st.alerts.length >= 20) { toast("알림은 20개까지예요. 관심 탭에서 정리해 주세요"); return false; }
    const al = { id: uid(), created: today(), ...a };
    if (al.k) { al.basis = "listed"; al.rb = today(); al.reg = al.reg || st.region || "전국"; if (al.sp == null) al.sp = st.special; }
    if (al.type === "watch") Object.assign(al, Intel.evalWatch({}, watchNow(al), today()).patch);   // first look = the base, nothing fires
    else Object.assign(al, Intel.evalAlert({ ...al, lastAt: today() }, alertNow(al), "0000-00-00").patch);   // set the baseline only
    delete al.lastAt;
    // the real changes already recorded for this treatment (last weekly snapshot) go into 알림 기록 as '지난 기록'
    if (al.k && KI[al.k] != null) for (const [k, b, before, after] of D.changes || []) if (KEYS[k].id === al.k && BR[b] && regOk(b, al.reg)) st.notes.unshift({ ...noteOf(al, "past", { b: bkey(b), before, after, text: `${D.meta.prev} → ${D.meta.updated} ${bname(b)} ${won(before)} → ${won(after)}` }), read: true, past: true });
    if (al.type === "target" || al.type === "cartdrop") delete al.last;
    st.alerts.push(al); saveAlerts(); track("alert_set", { type: al.type });
    // 죠미 winks only once the alert is really stored; the toast repeats the condition that was saved
    const kinds = al.type === "watch" ? Object.keys(Intel.WATCH_T).filter((t) => !al.on || al.on[t] !== false).length : 0;
    if (store.get("alerts", []).some((x) => x.id === al.id)) jomiToast("wink", `${jline("alertSet") || "알림을 만들었어요"} ${alertName(al)} · ${ALERT_TYPES[al.type]}${kinds ? ` (${kinds}가지 변화)` : ""}${al.target ? ` · 목표가 ${won(al.target)}` : ""}`, ["알림 관리", () => nav("saved")]);
    else toast("알림을 저장하지 못했어요(이 기기의 저장 공간을 확인해 주세요)");
    return true;
  }
  function alertSheet(base) {
    const now = alertNow(base);
    sheet("가격 알림", (close) => {
      const box = h("div", {});
      const types = base.k ? ["watch", "target", "newlow", "newmatch"] : base.cart != null ? ["cartdrop"] : ["expiring", "target"];
      const s = { type: types[0], on: { drop: true, target: true, lowbranch: true, newmatch: true, lowended: true, recheck: true } };
      const tgt = h("input", { class: "field", type: "number", inputmode: "numeric", min: "0", step: "1000", value: now && now.value ? Math.floor(now.value * 0.9 / 1000) * 1000 : "", "aria-label": "목표 금액" });
      const paint = () => fill(box,
        h("div", { class: "sub" }, `${alertName(base)}${now && now.value ? ` · 지금 ${base.cart != null ? "한 곳 최저 합계" : `최저(병원 표시가, ${base.k ? (st.region || "전국") : ""})`} ${won(now.value)}` : ""}`),
        h("div", { class: "opts", style: "margin-top:10px" }, types.map((ty) => h("button", { class: "opt", type: "button", "aria-pressed": s.type === ty ? "true" : "false", onclick: () => { s.type = ty; paint(); } }, h("b", {}, ALERT_TYPES[ty]),
          ty === "watch" ? h("span", {}, "여러 변화를 한 번에") : null))),
        s.type === "watch" ? h("div", { class: "pcgrp", role: "group", "aria-label": "알려줄 변화" }, h("div", { class: "sub", style: "margin:12px 0 4px" }, "알려줄 변화"),
          Object.entries(Intel.WATCH_T).map(([t, l]) => h("label", { class: "row pctog", style: "margin-top:6px;gap:10px;flex-wrap:nowrap" },
            h("input", { type: "checkbox", checked: s.on[t], onchange: (e) => { s.on[t] = e.target.checked; paint(); } }), h("span", {}, h("b", {}, l), h("span", { class: "tiny", style: "display:block" }, WATCH_HELP[t])))),
          s.on.target ? h("label", { class: "flabel" }, "목표가 (이 금액 이하가 되면)", tgt) : null) : null,
        s.type === "target" || s.type === "cartdrop" ? h("label", { class: "flabel" }, s.type === "cartdrop" ? "이 금액 이하가 되면 (비우면 지금보다 내리면)" : "이 금액 이하가 되면", tgt) : null,
        h("div", { class: "sub", style: "margin-top:8px" }, "매주 실제로 모은 가격끼리 비교해서, 앱을 열 때 관심 탭과 위쪽 종 아이콘으로 알려요. 같은 변화는 다시 알리지 않아요. 값은 병원 표시가 기준이고, 화면의 부가세·지역 설정을 바꿔도 알림이 생기지 않아요."),
        h("div", { class: "tiny", style: "margin-top:4px" }, "휴대폰 알림을 켜 두면 앱을 열 때 찾은 변화를 휴대폰 알림으로도 보여줘요. 앱이 닫혀 있을 때 오는 푸시는 서버가 필요해서 아직 없어요."),
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:14px", onclick: () => {
          const v = Math.round(+tgt.value || 0);
          if (s.type === "target" && !v) { toast("목표 금액을 적어 주세요"); return; }
          if (s.type === "watch" && !Object.values(s.on).some(Boolean)) { toast("알려줄 변화를 하나 이상 골라 주세요"); return; }
          addAlert({ ...base, type: s.type, on: s.type === "watch" ? { ...s.on } : undefined, target: s.type === "target" || s.type === "cartdrop" || (s.type === "watch" && s.on.target) ? (v || null) : null }); close(); render();
        } }, "알림 만들기"));
      paint();
      return box;
    });
  }
  const WATCH_HELP = { drop: "최저가가 지난번보다 내려가면", target: "최저가가 정한 금액 이하가 되면(한 번)", lowbranch: "가장 싼 지점이 다른 곳으로 바뀌면", newmatch: "이 시술을 새로 파는 지점이 생기면",
    lowended: "최저가였던 가격이 이벤트 종료·가격표에서 빠지면", recheck: "최저가 지점의 이번 주 수집이 실패해 확인이 필요하면" };
  function alertsCard() {
    const card = h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:14px 14px 4px" }, h("h3", {}, "가격 알림"), h("span", { class: "sp" }),
      h("span", { class: "sub" }, `${st.alerts.length}/20`)));
    const unread = st.notes.filter((x) => !x.read);
    card.append(st.alerts.length ? h("ul", { class: "list" }, st.alerts.map((a) => { const now = alertNow(a);
      return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, alertName(a)), h("span", { class: "p num" }, now && now.value != null ? won(now.value) : "-"),
        h("span", { class: "m" }, h("span", { class: "k k4" }, ALERT_TYPES[a.type]), a.type === "watch" ? h("span", {}, Object.entries(Intel.WATCH_T).filter(([t]) => !a.on || a.on[t] !== false).map(([, l]) => l).join(" · ")) : null,
          a.target ? h("span", {}, `목표 ${won(a.target)}`) : null, a.base != null && typeof a.base !== "object" && a.type !== "newmatch" ? h("span", {}, `기준 ${won(a.base)}`) : null,
          a.type === "newmatch" && a.base != null ? h("span", {}, `기준 ${a.base}곳`) : null, a.reg ? h("span", {}, a.reg) : null, h("span", { class: "sp" }),
          h("button", { class: "addbtn", type: "button", "aria-label": `${alertName(a)} 알림 해지`, onclick: () => {
            const before = st.alerts.slice(); st.alerts = st.alerts.filter((x) => x !== a); saveAlerts(); render();
            undoToast("알림을 해지했어요", () => { st.alerts = before; saveAlerts(); render(); }); } }, "해지")))); }))
      : h("div", { class: "empty" }, h("div", { class: "ei" }, icon("bell-plus")), h("b", {}, "아직 알림이 없어요"), "시술 비교 화면이나 장바구니에서 '가격 알림'을 누르면 알림을 만들 수 있어요."));
    // 알림 기록: what fired (and the real past changes of a watched treatment), newest first
    card.append(h("div", { class: "row", style: "padding:12px 14px 2px" }, h("h3", { style: "font-size:15px" }, "알림 기록"), h("span", { class: "sp" }),
      st.notes.length ? h("button", { class: "linkbtn", type: "button", onclick: () => { const before = st.notes.slice(); st.notes = []; saveAlerts(); render(); undoToast("알림 기록을 지웠어요", () => { st.notes = before; saveAlerts(); render(); }); } }, "기록 지우기") : null));
    card.append(st.notes.length ? h("ul", { class: "list notes" }, st.notes.slice(0, 20).map((x) => {
      const b = x.b ? BK.get(x.b) : null, k = x.k && KI[x.k] != null ? x.k : null;
      return h("li", { "data-type": x.type || "" }, h("div", { class: "item" },
        h("span", { class: "t row", style: "gap:8px;flex-wrap:nowrap" }, x.read ? icon(x.past ? "history" : "bell", "sm") : h("span", { class: "dot", style: "background:var(--s2)", title: "새 알림" }),
          h("span", {}, x.type ? h("span", { class: `k ${x.type === "test" ? "kx" : x.past ? "k4" : "k1"}`, style: "margin-right:6px" }, NOTE_T[x.type] || x.type) : null, x.name || x.text)),
        h("span", { class: "sub" }, x.obs ? `관측 ${x.obs}` : x.at),
        x.type ? h("span", { class: "m" }, b != null ? h("span", { class: "row", style: "gap:4px" }, bdot(b), bname(b)) : x.b ? h("span", {}, x.b.replace("|", " ")) : null,
          x.before != null && x.after != null && typeof x.before === "number" ? h("span", { class: "num" }, `${won(x.before)} → ${won(x.after)}`) : x.after != null ? h("span", { class: "num" }, won(x.after)) : null,
          h("span", {}, (x.text || "").split(": ").slice(1).join(": ")), h("span", { class: "sp" }),
          k ? h("button", { class: "linkbtn", type: "button", onclick: () => nav(`compare?k=${k}`) }, "가격 보기") : null)
          : h("span", { class: "m" }, x.text))); }))
      : h("div", { class: "sub", style: "padding:4px 14px 12px" }, "아직 기록이 없어요. 알림을 만들면 지난 수집과 비교해 실제로 바뀐 가격만 여기에 남아요."));
    if (unread.length) setTimeout(() => { for (const x of unread) x.read = true; saveAlerts(); }, 1500);
    card.append(notifyPanel());
    return card;
  }
  // 휴대폰 알림 panel: real state of this browser; the permission prompt only after a tap
  function notifyPanel() {
    const box = h("div", { class: "nfp" });
    const paint = () => {
      const kids = [h("b", {}, icon("bell-ring", "sm"), " 휴대폰 알림")];
      if (!notifySupported()) kids.push(h("div", { class: "sub" }, "이 브라우저는 웹 알림을 지원하지 않아요. 앱 안의 알림(관심 탭·종 아이콘)은 그대로 돼요."));
      else if (isIOS() && !standalone()) kids.push(h("div", { class: "sub" }, "iPhone·iPad는 홈 화면에 설치한 앱에서만 알림을 켤 수 있어요(iOS 16.4 이상). ", h("button", { class: "linkbtn", type: "button", onclick: () => nav("about") }, "설치 방법")));
      else if (Notification.permission === "denied") kids.push(h("div", { class: "sub" }, "브라우저 설정에서 이 사이트의 알림이 꺼져 있어요. 켜려면 브라우저 설정에서 바꿔 주세요."));
      else if (Notification.permission === "granted") kids.push(h("div", { class: "sub" }, "켜짐 — 앱을 열 때 찾은 변화를 휴대폰 알림으로도 보여줘요. 앱이 닫혀 있을 때 오는 푸시는 서버가 필요해서 아직 없어요."),
        h("button", { class: "btn sm gray", type: "button", style: "margin-top:8px", onclick: async () => {
          const okN = await deviceNotify("[TEST] 윤실장 알림 시험", "시험용 알림이에요. 실제 가격 변화가 아니에요.", "pc-test");
          st.notes.unshift({ at: today(), obs: "", type: "test", name: "알림 시험", text: okN ? "시험 알림을 보냈어요(실제 가격 변화 아님)" : "시험 알림을 보내지 못했어요", read: true }); saveAlerts(); render();
          toast(okN ? "시험 알림을 보냈어요 — TEST라고 적혀 있어요" : "시험 알림을 보내지 못했어요"); } }, "테스트 알림 보내기 (TEST)"));
      else kids.push(h("div", { class: "sub" }, "켜면 앱을 열 때 찾은 가격 변화를 휴대폰 알림으로도 보여줘요. 누르기 전에는 권한을 묻지 않아요."),
        h("button", { class: "btn sm", type: "button", style: "margin-top:8px", onclick: async () => { try { await Notification.requestPermission(); } catch (e) { /* old Safari: callback form */ } paint(); } }, "휴대폰 알림 켜기"));
      fill(box, ...kids);
    };
    paint();
    return box;
  }

  // ---------------- views
  const views = {};
  let current = "home", lastPath = "";

  // ---------------- price changes since the previous weekly snapshot (listed prices): key + auto-group moves
  function changeItems() {
    const out = [], seen = new Set();
    for (const [k, b, a, c] of D.changes || []) { out.push({ name: KEYS[k].label, cat: ROWS[(byKB[k].get(b) || [0])[0]]?.[1] ?? 0, b, before: a, after: c, t: c < a ? "down" : "up" }); seen.add(`${KEYS[k].label}|${b}`); }
    const ac = D.achg || {};
    for (const [g, b, a, c] of ac.chg || []) if (GR[g]) out.push({ name: GR[g].label, cat: GR[g].cat, b, before: a, after: c, t: c < a ? "down" : "up", g });
    for (const [g, b, p] of ac.new || []) if (GR[g]) out.push({ name: GR[g].label, cat: GR[g].cat, b, before: null, after: p, t: "new", g });
    for (const [s, b, p] of ac.gone || []) out.push({ name: S[s], cat: -1, b, before: p, after: null, t: "gone" });
    return out.filter((x) => BR[x.b] && brandOn(x.b) && regionOk(x.b));
  }
  // recently viewed procedures / branches (this phone)
  // browsing history on this phone (최근 본 것, 최근 검색, 이어서 보기): the user can stop recording it or clear it (마이 → 내 설정)
  const HIST_KEYS = ["recent", "recentQ", "lastRoute"];
  const histOn = () => store.get("histOff", false) !== true;
  // 사용 통계 (docs/ADMIN_OPERATIONS_SPEC.md §6): off by default; when the user turns it on, events are kept on this phone
  // only (pc:events, last 500), every one marked demo — there is no server to send them to. Never the search text, a
  // concern, a place or anything personal: only the event name and app values (a comparison id, a class, a plan).
  const AN_EVENTS = { search: "검색", compare_view: "시술 비교 열기", option_mode: "옵션 보기 방식", option_step: "쉬운 보기 단계 선택", prod_filter: "제품·장비 거르기",
    price_sheet: "가격 근거 열기", cart_add: "장바구니 담기", scenario_open: "방문 계획 열기", alert_set: "알림 만들기" };
  const anOn = () => store.get("analytics", "off") === "on";
  function track(name, props) {
    if (!anOn() || !AN_EVENTS[name]) return;
    const L = store.get("events", []);
    L.push({ e: name, at: new Date().toISOString(), demo: true, ...(props || {}) });
    store.set("events", L.slice(-500));
  }
  function eventsSheet() {
    sheet("사용 통계 (이 기기)", (close) => { const L = store.get("events", []), n = {};
      for (const x of L) n[x.e] = (n[x.e] || 0) + 1;
      return h("div", {}, h("p", { class: "sub" }, "이 휴대폰에만 있는 시연 기록이에요. 서버로 보내지 않고, 검색어·고민·위치는 남기지 않아요."),
        L.length ? h("dl", { class: "facts" }, Object.entries(AN_EVENTS).map(([k, l]) => h("div", { class: "fact" }, h("dt", {}, l), h("dd", {}, `${n[k] || 0}번`))))
          : h("div", { class: "empty" }, "아직 기록이 없어요."),
        h("p", { class: "tiny" }, L.length ? `${L.length}개 · 첫 기록 ${L[0].at.slice(0, 10)} · 모두 demo 표시` : ""),
        h("button", { class: "btn gray", type: "button", style: "width:100%;margin-top:10px", onclick: () => { store.set("events", []); close(); toast("사용 통계를 지웠어요"); } }, "모두 지우기")); });
  }
  function remember(kind, id) {
    if (!histOn()) return;
    const v = `${kind}:${id}`;
    const list = [v, ...store.get("recent", []).filter((x) => x !== v)].slice(0, 8);
    store.set("recent", list);
  }
  function recentChips() {
    const items = store.get("recent", []).map((v) => {
      const [kind, ...rest] = v.split(":"), id = rest.join(":");
      if (kind === "k" && KI[id] != null) return h("button", { class: "chip", type: "button", onclick: () => { st.key = KI[id]; nav("compare"); } }, catIcon(KEYS[KI[id]].cat, "sm"), KEYS[KI[id]].label);
      if (kind === "b" && BK.has(id)) return h("button", { class: "chip", type: "button", onclick: () => nav(`branch/${BK.get(id)}`) }, bdot(BK.get(id)), bname(BK.get(id)));
      return null;
    }).filter(Boolean);
    return items.length ? h("div", { class: "chips wrapc" }, items) : null;
  }
  // the home box takes a concern ("이마 주름이 신경 쓰여요") or a treatment name ("리쥬란 2cc"): a name goes to the price
  // search; the words of a concern (or a warning sign) open the concern guide with the text in memory only (not the URL)
  function routeQuery(v) {
    const t = String(v || "").trim();
    if (!t) return;
    if (FLAGS.concernSearch && CONC.concerns.length && !famFind(t).length) {
      const r = Concern.classify(t, CONC);
      if (r.safety.length || r.matches.length) { concernText = t; nav("concern"); return; }
    }
    nav(`search/${encodeURIComponent(t)}`);
  }
  const secHead = (title, sub, more) => h("div", { class: "sec-h" }, h("h2", {}, title), sub ? h("span", { class: "sub" }, sub) : null, more || null);
  // treatments whose lowest plain price sits far below the middle of the same-condition prices (comparable sets only)
  function lowFinds(n = 4) {
    const out = [];
    // a gap of more than 70% usually means a different unit (per spot, per shot) or an unmarked condition, not a find
    for (const f of [...FAM].filter((x) => x.cat !== "기타").sort((a, c) => c.n - a.n).slice(0, 80)) {
      const pl = plainRanking(f.main); if (pl.length < 5) continue;
      const { normal } = splitLow(pl); if (normal.length < 5) continue;
      const med = median(pl.map((x) => x.p)), top = normal[0], below = med ? 1 - top.p / med : 0;
      if (below >= 0.15 && below <= 0.7) out.push({ k: f.main, top, med, below, lo: pl[0].p, hi: pl[pl.length - 1].p, n: pl.length });
    }
    return out.sort((a, c) => c.below - a.below).slice(0, n);
  }
  // same-condition treatments with the widest gap between the lowest and highest plain price (unverified ultra-lows left out)
  function spreadFinds(n = 4) {
    const out = [];
    for (const f of [...FAM].filter((x) => x.cat !== "기타").sort((a, c) => c.n - a.n).slice(0, 80)) {
      const pl = plainRanking(f.main); if (pl.length < 5) continue;
      const { normal } = splitLow(pl); if (normal.length < 5) continue;
      const ps = normal.map((x) => x.p), lo = Math.min(...ps), hi = Math.max(...ps), spread = lo ? hi / lo : 1;
      if (spread >= 1.5 && spread <= 10) out.push({ k: f.main, lo, hi, med: median(ps), spread, n: ps.length });
    }
    return out.sort((a, c) => c.spread - a.spread).slice(0, n);
  }
  const mrange = (lo, hi, at, med) => { const pos = (v) => `${hi > lo ? Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)) : 50}%`;
    return h("span", { class: "mrange", role: "img", "aria-label": `가격 범위 ${won(lo)}~${won(hi)} 중 ${won(at)}, 중간값 ${won(med)}` }, h("b", { style: `left:${pos(med)}` }), h("i", { style: `left:${pos(at)}` })); };

  views.home = () => {
    const box = h("div", { class: "view" });
    const q = h("input", { type: "search", placeholder: "시술 이름 (예: 리쥬란 2cc, 보톡스 50U)", "aria-label": "시술 이름으로 가격 찾기", enterkeyhint: "search" });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") routeQuery(q.value); });
    box.append(h("section", { class: "hero-home" },
      jprefs().freq === "often" ? h("button", { class: "jomi-hello", type: "button", "aria-haspopup": "dialog", onclick: () => jomiSheet() }, jomiImg("default", "face", 28),
        h("span", {}, jline("home")), h("span", { class: "sr" }, " — 죠미 소개 보기")) : null,
      // round-2 UX01: the promise the data can keep — same product, amount and sessions — and the collection range right under it
      h("h2", { class: "display" }, "같은 용량·횟수끼리,", h("br"), "피부과 가격을 비교해요."),
      h("p", { class: "lede" }, coverageLine()),
      h("div", { class: "search hsearch" }, icon("search"), withSuggest(q, routeQuery), h("button", { type: "button", onclick: () => routeQuery(q.value) }, "찾기"))));
    // two ways in
    const ent = (cls, ic, t, sub, go) => h("button", { class: `entry ${cls}`, type: "button", onclick: go }, h("span", { class: "ei" }, icon(ic)),
      h("span", {}, h("b", {}, t), h("small", {}, sub)), h("span", { class: "go" }, icon("arrow-up-right", "sm")));
    box.append(h("div", { class: "entries" },
      ent("e-price", "chart-column", "시술명으로 가격비교", `같은 조건끼리 ${regionName()} 지점 가격을 비교해요`, () => nav("compare")),
      FLAGS.concernSearch ? ent("e-concern", "message-circle", "시술 이름을 모르면", "고민을 적으면 관련 시술을 알려 드려요", () => nav("concern")) : null));
    box.append(h("button", { class: "trustline", type: "button", onclick: () => nav("principles") }, icon("shield-check", "sm"),
      h("span", {}, "병원에게 돈을 받고 순서를 바꾸지 않아요 · 수집 범위와 출처를 공개해요"), icon("chevron-right", "xs")));
    if (!FLAGS.concernSearch) box.lastChild.style.gridTemplateColumns = "1fr";
    const cont = continueChips();
    if (cont) box.append(secHead("이어서 보기"), cont);
    // 인기 시술: cheapest plain price per treatment, how far below the middle, + 담기
    const cats = [...new Set(KEYS.map((k) => k.cat))];
    if (st.hcat && !cats.includes(st.hcat)) st.hcat = null;
    const popular = [...KEYS].sort((a, b) => byKB[b.i].size - byKB[a.i].size).slice(0, 6);
    // a category tab: the main variant of its most-sold families (not every variant — 톡신 alone has 250+)
    const keys = st.hcat ? famsIn(st.hcat).slice(0, 6).map((f) => KEYS[f.main]) : popular;
    const basisL = FLAGS.lowestHighlight ? "최저가" : "중간값·가격 범위";
    box.append(secHead(st.loc ? "내 주변 인기 시술" : "인기 시술", st.loc ? `10km 안 · ${basisL}` : `${regionName()} · ${basisL}`));
    box.append(h("div", { class: "chips" }, h("button", { class: "chip", type: "button", "aria-pressed": !st.hcat ? "true" : "false", onclick: () => { st.hcat = null; render(); } }, "인기"),
      cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": st.hcat === c ? "true" : "false", onclick: () => { st.hcat = c; render(); } }, catIcon(c, "sm"), c))));
    // what '인기' means here: the most widely sold, not searches or bookings (the app has no such numbers)
    box.append(h("details", { class: "tiny fold small", style: "margin:-2px 2px 8px" }, h("summary", {}, "순서 기준"), st.hcat ? `${st.hcat}에서 파는 지점이 많은 시술 순이에요.` : "‘인기’는 파는 지점이 많은 순이에요. 검색량·예약 수가 아니에요(앱은 그런 숫자를 모으지 않아요)."));
    const grid = h("div", { class: "grid" });
    for (const k of keys) {
      let rk = ranking(k.i, "price"), pl = plainRanking(k.i);
      if (st.loc) { rk = rk.filter((x) => x.d != null && x.d <= 10); pl = pl.filter((x) => x.d != null && x.d <= 10); }
      if (!rk.length) continue;
      // headline: lowest plain price (no 첫 방문·체험가 condition, not far below the median); the median is over the plain set
      const { normal, lowp } = splitLow(pl), lowI = new Set(lowp.map((x) => x.i));
      const base = pl.length ? pl : rk, top = (normal.length ? normal : rk)[0], r = ROWS[top.i], med = median(base.map((x) => x.p));
      const below = med ? Math.round((1 - top.p / med) * 100) : 0, c0 = rk.find((x) => !lowI.has(x.i)), cond = c0 && c0.p < top.p ? c0 : null;
      // lowestHighlight off (default): the card shows the middle price and the range, no clinic name, no 'N% 싸요'
      const nps = (normal.length ? normal : rk).map((x) => x.p), nlo = Math.min(...nps), nhi = Math.max(...nps), HL = FLAGS.lowestHighlight;
      grid.append(h("div", { class: "pwrap" }, h("button", { class: "pc", type: "button", onclick: () => { st.key = k.i; nav("compare"); } },
        h("span", { class: "pico", "aria-hidden": "true" }, catIcon(k.cat)), h("span", { class: "l" }, k.label),
        HL ? null : h("span", { class: "pk" }, "중간값"), h("span", { class: "p num" }, won(HL ? top.p : med)),
        HL && FLAGS.discountEmphasis ? h("span", { class: below > 0 ? "save" : "save flat" }, below > 0 ? `중간보다 ${below}% 싸요` : `${base.length}곳 비교`)
          : h("span", { class: "save flat" }, nlo === nhi ? `${base.length}곳 같은 가격` : `${man(nlo)}~${man(nhi)}원 · ${base.length}곳`),
        HL ? h("span", { class: "basis" }, `${pl.length ? "조건 없는 가격" : "조건부 가격"} ${base.length}곳 · 중간 ${won(med)}`) : h("span", { class: "basis" }, pl.length ? "조건 없는 가격 기준" : "조건이 붙은 가격만 있어요"),
        cond ? h("span", { class: "basis" }, `조건부 ${won(cond.p)}~ (${priceConds(cond.i)[0] || "조건 있음"})`) : null,
        lowp.length ? h("span", { class: "basis" }, `확인 필요 초저가 ${won(lowp[0].p)} (중간값의 ${Math.round(lowp[0].p / med * 100)}%)`) : null,
        HL && kindBadge(r).length ? h("span", { class: "row", style: "gap:4px;margin-top:4px" }, kindBadge(r).slice(0, 2)) : null,
        HL ? h("span", { class: "w" }, `${bname(top.b)}${top.d != null ? " · " + km(top.d) : ""}`) : null), addBtn(k.i)));
    }
    box.append(grid, h("p", { class: "foot", style: "margin-top:-6px" }, "가격은 참고용이에요. 같은 시술도 병원마다 용량·조건·정품 여부·시술 의료진이 다를 수 있고, 부작용·주의사항이 있어요. 시술 화면에서 함께 확인하세요."),
      h("button", { class: "btn line block", type: "button", onclick: () => nav("compare") }, `시술 ${KEYS.length.toLocaleString()}개 전체 비교`, icon("chevron-right", "sm")));
    // 죠미의 오늘의 발견. Default: treatments whose same-condition prices differ most between clinics (no clinic named) —
    // 'compare before you choose'. With flags.discountEmphasis: the biggest gaps below the middle (the earlier list).
    const spreads = FLAGS.discountEmphasis ? [] : spreadFinds();
    if (spreads.length) box.append(secHead("죠미의 오늘의 발견", "병원마다 가격 차이가 큰 시술"), h("div", { class: "card flush" }, h("ul", { class: "list" }, spreads.map((x) =>
      h("li", {}, h("button", { class: "disc-row", type: "button", onclick: () => { st.key = x.k; nav("compare"); } },
        h("span", { class: "t" }, KEYS[x.k].label), h("span", { class: "p num" }, `최대 ${x.spread.toFixed(1)}배`),
        h("span", { class: "mrange", role: "img", "aria-label": `가격 범위 ${won(x.lo)}~${won(x.hi)}, 중간값 ${won(x.med)}` }, h("b", { style: `left:${x.hi > x.lo ? (x.med - x.lo) / (x.hi - x.lo) * 100 : 50}%` })),
        h("span", { class: "m" }, h("span", { class: "num" }, `${won(x.lo)} ~ ${won(x.hi)}`), h("span", {}, `중간값 ${won(x.med)}`), h("span", {}, `${x.n}곳`))))))),
      h("p", { class: "foot", style: "margin-top:-6px" }, "같은 용량·회차인데도 병원마다 가격이 이만큼 달라요. 막대는 가장 낮은 값부터 높은 값까지, 세로선은 중간값이에요. 가격 차이의 이유(조건·구성)는 시술 화면에서 확인하세요."),
      h("p", { class: "foot", style: "margin-top:-10px" }, `고르는 기준: 조건 없는 가격이 5곳 이상인 시술 중 '가장 높은 가격 ÷ 가장 낮은 가격'이 큰 순서(1.5~10배, 확인이 필요한 초저가는 뺌). ${D.meta.updated} 데이터로 자동으로 골라요 — 사람이 고르거나 광고로 정하지 않아요.`));
    const finds = FLAGS.discountEmphasis ? lowFinds() : [];
    if (finds.length) box.append(secHead("죠미의 오늘의 발견", "중간값보다 많이 낮은 곳"), h("div", { class: "card flush" }, h("ul", { class: "list" }, finds.map((x) =>
      h("li", {}, h("button", { class: "disc-row", type: "button", onclick: () => { st.key = x.k; nav("compare"); } },
        h("span", { class: "t" }, KEYS[x.k].label), h("span", { class: "p num" }, won(x.top.p)),
        mrange(x.lo, x.hi, x.top.p, x.med),
        h("span", { class: "m" }, bdot(x.top.b), h("span", {}, bname(x.top.b)), h("span", { class: "down" }, `중간값보다 ${Math.round(x.below * 100)}% ↓`), h("span", {}, `조건 없는 가격 ${x.n}곳`))))))),
      h("p", { class: "foot", style: "margin-top:-6px" }, "점은 이 가격, 세로선은 중간값이에요. 첫 방문가·체험가처럼 조건이 붙은 가격과 확인이 필요한 초저가는 빼고 골랐어요."));
    // 가격 변동 since last week (max 2 per branch); before the second collection: say when it starts, draw nothing
    const ch = changeItems(), dn = ch.filter((x) => x.t === "down").length, up = ch.filter((x) => x.t === "up").length;
    box.append(secHead("가격 변동", D.meta.prev ? `${md(D.meta.prev)} 대비` : "주간 기록"));
    const pick = (t) => { const per = new Map(); return ch.filter((x) => x.t === t).sort((a, b) => Math.abs(b.after - b.before) / b.before - Math.abs(a.after - a.before) / a.before)
      .filter((x) => { const n = per.get(x.b) || 0; per.set(x.b, n + 1); return n < 2; }).slice(0, 4); };
    if (D.meta.prev && (dn || up)) {
      const t = st.hmove || "down", list = pick(t);
      box.append(h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:12px 14px 4px" }, h("div", { class: "seg", role: "tablist", style: "flex:1" },
        [["down", `내렸어요 ${dn}`], ["up", `올랐어요 ${up}`]].map(([v, l]) => h("button", { type: "button", role: "tab", "aria-selected": t === v ? "true" : "false", onclick: () => { st.hmove = v; render(); } }, l)))),
        h("ul", { class: "list" }, list.map((x) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${x.b}`) },
          h("span", { class: "t" }, x.name), h("span", { class: `p num ${t}` }, won(x.after)),
          h("span", { class: "m" }, bdot(x.b), bname(x.b), h("s", {}, won(x.before)), h("span", { class: t }, `${t === "down" ? "▼" : "▲"} ${Math.round(Math.abs(x.after - x.before) / x.before * 100)}%`)))))),
        h("button", { class: "more-link", type: "button", onclick: () => nav("change") }, "가격 변동 전체", icon("chevron-right", "sm"))));
    } else box.append(h("div", { class: "card" }, h("div", { class: "empty", style: "padding:12px 4px" }, h("div", { class: "ei" }, icon("chart-line")),
      h("b", {}, D.meta.prev ? "지난 수집과 달라진 가격이 없어요" : "다음 수집부터 변동이 보여요"),
      D.meta.prev ? `${D.meta.prev} → ${D.meta.updated} 비교 결과예요.` : `첫 기록은 ${D.meta.updated}이에요. 매주 월요일 모은 가격끼리만 비교하고, 기록이 없는 기간은 채우지 않아요.`),
      h("button", { class: "btn gray block", type: "button", onclick: () => nav("change") }, "가격 변동 화면", icon("chevron-right", "sm"))));
    box.append(h("p", { class: "foot" }, `가격은 각 병원 홈페이지에 올라온 값을 매주 월요일(이벤트가 끝나면 그다음 날에도) 자동으로 모은 거예요. ${vatNote()} 체험가·한정가는 1인 1회예요. 방문 전에 병원에서 꼭 확인하세요. `,
      h("button", { class: "linkbtn", type: "button", onclick: () => nav("about") }, "알아두면 좋은 점", icon("chevron-right", "xs"))));
    return box;
  };

  // personal shortcuts on 홈: the screen left last time, saved treatments, recently viewed (this phone)
  const ROUTE_NAME = { cart: "장바구니", map: "지도", table: "전체 가격표", guide: "시술 사전", rank: "지점 순위", versus: "지점 비교", change: "가격 변동", quick: "빠른 비교", terms: "쉬운 용어" };
  function continueChips() {
    const out = [], seen = new Set();
    const add = (key, el) => { if (!seen.has(key) && out.length < 5) { seen.add(key); out.push(el); } };
    const last = store.get("lastRoute", ""), lv = last.split(/[/?]/)[0];
    if (lv === "branch" && BR[+last.split(/[/?]/)[1]]) { const b = +last.split(/[/?]/)[1]; add(`b:${bkey(b)}`, h("button", { class: "chip", type: "button", onclick: () => nav(last) }, icon("history", "sm"), bname(b))); }
    else if (ROUTE_NAME[lv] && (lv !== "cart" || cur().items.length)) add(`r:${lv}`, h("button", { class: "chip", type: "button", onclick: () => nav(last) }, icon("history", "sm"), lv === "cart" ? `장바구니 ${cur().items.length}개` : ROUTE_NAME[lv]));
    for (const id of favs().k.slice(0, 2)) if (KI[id] != null) add(`k:${id}`, h("button", { class: "chip", type: "button", onclick: () => nav(`compare?k=${id}`) }, icon("heart", "sm"), KEYS[KI[id]].label));
    for (const v of store.get("recent", [])) { const [kind, ...rest] = v.split(":"), id = rest.join(":"); if (kind === "k" && KI[id] != null) add(`k:${id}`, h("button", { class: "chip", type: "button", onclick: () => nav(`compare?k=${id}`) }, catIcon(KEYS[KI[id]].cat, "sm"), KEYS[KI[id]].label)); }
    return out.length ? h("div", { class: "chips" }, out) : null;
  }
  // 죠미's introduction: only when someone taps her (never pops up by itself). The full introduction the first time,
  // a short hello afterwards with a way back to the full one. Seen = a date on this phone, nothing else.
  function jomiSheet(full) {
    const first = full || !store.get("jomiSeen", null);
    if (!store.get("jomiSeen", null)) store.set("jomiSeen", today());
    let taps = 0;
    sheet(`${J.name} 소개`, (close) => {
      const pic = h("button", { class: "jomi-pic", type: "button", "aria-label": `${J.name} 쓰다듬기` }, jomiImg(first ? "welcome" : "default", "portrait", first ? 128 : 84, `윤실장 공식 안내냥 ${J.name}`));
      const quip = h("p", { class: "jomi-quip", "aria-live": "polite" });
      // a small discoverable touch: tapping her gets a hop and a line (only general app tips, nothing medical)
      pic.addEventListener("click", () => { const L = J.lines.easter || []; if (!L.length) return; quip.textContent = L[taps++ % L.length]; pic.classList.remove("hop"); void pic.offsetWidth; pic.classList.add("hop"); });
      const go = (route) => () => { close(); nav(route); };
      const actions = h("div", { class: "jomi-actions" },
        FLAGS.concernSearch ? h("button", { class: "btn soft", type: "button", onclick: go("concern") }, icon("message-circle", "sm"), "피부 고민 탐색") : null,
        h("button", { class: "btn", type: "button", onclick: go("compare") }, icon("chart-column", "sm"), "시술 가격비교"));
      const id = h("div", { class: "jomi-id" }, h("b", {}, J.name), h("span", { class: "en" }, J.en), h("span", { class: "infotag" }, J.role));
      return h("div", { class: `jomi-intro${first ? " first" : ""}` }, pic, quip, id,
        first ? [h("div", { class: "jomi-words" }, (J.lines.intro || []).map((t) => h("p", {}, t))),
          h("ul", { class: "jomi-does" }, (J.lines.does || []).map((t) => h("li", {}, icon("check", "xs"), t))), h("p", { class: "tiny" }, J.lines.doesNot || "")]
          : [h("p", { class: "jomi-back" }, J.lines.back || ""), h("button", { class: "linkbtn", type: "button", onclick: () => { close(); jomiSheet(true); } }, "전체 소개 다시 보기", icon("chevron-right", "xs"))],
        actions);
    });
  }

  // ---------------- 탐색: every way to look at prices and treatments
  views.explore = () => {
    const box = h("div", { class: "view" });
    const q = h("input", { type: "search", placeholder: "시술 이름 (예: 슈링크 300샷, 리쥬란)", "aria-label": "시술 검색", enterkeyhint: "search" });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter" && q.value.trim()) nav(`search/${encodeURIComponent(q.value.trim())}`); });
    box.append(h("div", { style: "padding:4px 4px 0" }, h("h2", { class: "display", style: "font-size:24px" }, "탐색"), h("p", { class: "sub", style: "margin:4px 0 0" }, `${regionName()} ${regionCount()}곳 · 가격 ${D.meta.rows.toLocaleString()}개 · ${D.meta.updated} 기준`)),
      h("div", { class: "search" }, icon("search"), withSuggest(q, (v) => nav(`search/${encodeURIComponent(v)}`))));
    const tile = (ic, t, sub, go, cls) => h("button", { type: "button", class: cls || null, onclick: go }, h("span", { class: "hi" }, icon(ic)), h("span", {}, h("b", {}, t), h("small", {}, sub)));
    const top1 = branchRanks()[0];
    box.append(h("div", { class: "hub" },
      tile("chart-column", "시술별 가격 비교", "같은 용량·회차끼리 가격 범위와 분포", () => nav("compare"), "feat"),
      tile("scale", "빠른 비교", shortKeys().length ? `비교함 ${shortKeys().length}/${SHORT_MAX}곳` : "지점 2~4곳을 같은 사양으로", () => nav("quick")),
      FLAGS.concernSearch ? tile("message-circle", "피부 고민 가이드", "고민별 일반 정보와 관련 시술", () => nav("concern")) : null,
      tile("book-open", "시술 사전", "헷갈리는 시술의 차이", () => nav("guide")),
      tile("map", "지도", "가까운 지점과 가격", () => nav("map")),
      FLAGS.branchRanking ? tile("trophy", "지점 순위", top1 ? `1위 ${BR[top1.b].name}` : "같은 상품 기준", () => nav("rank")) : null,
      tile("scale", "지점 비교", "두 지점 나란히", () => nav("versus")),
      tile("table", "전체 가격표", "조건으로 모든 가격 찾기", () => nav("table")),
      tile("circle-help", "쉬운 용어", "체험가·샷·U가 뭔지", () => nav("terms")),
      tile("trending-down", "가격 변동", D.meta.prev ? "지난 수집 대비" : "다음 수집부터", () => nav("change")),
      tile("info", "데이터 상태·기준", "수집 상태·가격 종류·비교 기준·설치", () => nav("data"))));
    box.append(secHead("카테고리로 바로 비교"), h("div", { class: "chips wrapc" }, CMP_CATS.filter((c) => FAM.some((f) => f.cat === c)).map((c) =>
      h("button", { class: "chip", type: "button", onclick: () => nav(`compare?k=${KEYS[KI[CAT_START[c]] ?? famsIn(c)[0].main].id}`) }, catIcon(c, "sm"), c))));
    const tops = FLAGS.branchRanking ? branchRanks().slice(0, 5) : [];
    if (tops.length) box.append(secHead("가격 착한 지점 TOP 5", regionName()), h("div", { class: "card flush" },
      h("ul", { class: "list" }, tops.map((x, n) => h("li", {}, h("button", { class: "rank top", type: "button", onclick: () => nav(`branch/${x.b}`) },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))), h("span", { class: `p ${lvClass(x.lv)}` }, lvText(x.lv)),
        h("span", { class: "m" }, divBar(x.lv), h("span", {}, `제일 싼 시술 ${D.bstat[x.b][3]}개`), dist(x.b) != null ? h("b", {}, km(dist(x.b))) : null))))),
      h("button", { class: "more-link", type: "button", onclick: () => nav("rank") }, "지점 순위 전체", icon("chevron-right", "sm"))));
    box.append(trendCard() || "");
    return box;
  };

  // ---------------- 관심: favourites, price alerts and what was viewed lately (this phone)
  views.saved = () => {
    const box = h("div", { class: "view" });
    box.append(h("div", { style: "padding:4px 4px 0" }, h("h2", { class: "display", style: "font-size:24px" }, "관심"), h("p", { class: "sub", style: "margin:4px 0 0" }, "관심 시술·지점과 가격 알림이 이 기기에 모여요")));
    box.append(alertsCard());
    const F = favs();
    const favK = F.k.map((id) => KI[id]).filter((k) => k != null), favB = F.b.map((id) => BK.get(id)).filter((b) => b != null);
    // 관심 시술: price range / middle price / observed change / last check — no 'lowest clinic' (docs/OBJECTIVE_DISPLAY_POLICY.md)
    if (favK.length) box.append(watchCard(favK));
    box.append(feedCard(favK));
    box.append(h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:14px 14px 4px" }, h("h3", {}, "관심 지점"), h("span", { class: "sp" }), h("span", { class: "sub" }, `${favB.length}곳`)),
      favB.length ? h("ul", { class: "list" }, favB.map((b) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b}`) }, h("span", { class: "t row", style: "gap:10px;flex-wrap:nowrap" }, icon("store", "sm"), bname(b)),
          h("span", { class: "sub" }, dist(b) != null ? km(dist(b)) : BR[b].region), h("span", { class: "m" }, `가격 ${byB[b].length}개 · 확인 ${verified(b)}`)))))
        : favK.length ? h("p", { class: "sub", style: "padding:0 14px 14px" }, "지점 화면에서 하트를 누르면 여기에 모여요.")
          : jomiEmpty("empty", "관심 시술이 없어요", "시술 비교나 지점 화면에서 하트를 누르면 여기에 모이고, 가격 변화도 여기서 봐요.")));
    { const sc = snapsCard(); if (sc) box.append(sc); }
    const rc = recentChips();
    box.append(h("div", { class: "card" }, h("h3", {}, "최근 본 것"), rc ? h("div", { style: "margin-top:12px" }, rc) : h("p", { class: "sub", style: "margin:6px 0 0" }, "시술이나 지점을 보면 여기에 남아요(이 기기).")));
    const presets = store.get("presets", []);
    if (presets.length) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:14px 14px 4px" }, h("h3", {}, "저장한 검색 조건")),
      h("ul", { class: "list" }, presets.map((x) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`${x.route}${x.qs ? "?" + x.qs : ""}`) },
        h("span", { class: "t row", style: "gap:10px;flex-wrap:nowrap" }, icon("sliders-horizontal", "sm"), x.name), icon("chevron-right", "sm")))))));
    { const mr = myReportsCard(); if (mr) box.append(mr); }
    return box;
  };

  // ---------------- 가격 변동: everything that moved since the previous snapshot
  views.change = () => {
    const box = h("div", { class: "view" });
    const all = changeItems();
    box.append(h("div", { class: "card" }, h("h2", {}, "가격 변동"),
      h("div", { class: "sub", style: "margin-top:4px" }, D.meta.prev ? `${D.meta.prev} → ${D.meta.updated} · 일반가(병원 표시가) 기준 · ${regionName()}` : "지난 수집 기록과 비교해요. 첫 기록이 2026-10-13이라 다음 갱신(10/19 월)부터 보여요."),
      h("div", { class: "tiles" }, [["down", "내렸어요"], ["up", "올랐어요"], ["new", "새로 생겼어요"], ["gone", "없어졌어요"]].map(([v, l]) =>
        h("button", { class: "tile tbtn", type: "button", "aria-pressed": st.cdir === v ? "true" : "false", onclick: () => { st.cdir = st.cdir === v ? "all" : v; render(); } },
          h("span", { class: "k" }, l), h("b", { class: `num ${v === "down" ? "down" : v === "up" ? "up" : ""}` }, all.filter((x) => x.t === v).length), h("span", { class: "w" }, st.cdir === v ? "선택됨 · 다시 누르면 전체" : "눌러서 보기"))))));
    if (!all.length) { box.append(h("div", { class: "card empty" }, D.meta.prev ? "지난 수집과 달라진 가격이 없어요." : "아직 비교할 지난 기록이 없어요. 다음 주 월요일 갱신 뒤에 보여요.")); return box; }
    // per-branch bars: how many went down vs up
    const per = new Map();
    for (const x of all) { if (x.t !== "down" && x.t !== "up") continue; const v = per.get(x.b) || { d: 0, u: 0 }; v[x.t === "down" ? "d" : "u"]++; per.set(x.b, v); }
    const pmax = Math.max(1, ...[...per.values()].map((v) => Math.max(v.d, v.u)));
    if (per.size) box.append(h("div", { class: "card" }, h("h3", {}, "지점별 내린·오른 개수"), h("div", { class: "row lclegend", style: "margin-top:6px" },
      h("span", { class: "row", style: "gap:6px" }, h("span", { class: "key", style: "background:var(--good)" }), "내림"), h("span", { class: "row", style: "gap:6px" }, h("span", { class: "key", style: "background:var(--pricey)" }), "오름")),
      h("ul", { class: "list cbars" }, [...per.entries()].sort((a, b) => (b[1].d + b[1].u) - (a[1].d + a[1].u)).slice(0, 15).map(([b, v]) => h("li", {}, h("button", { class: "cbar", type: "button", "aria-pressed": st.cbr === b ? "true" : "false",
        onclick: () => { st.cbr = st.cbr === b ? null : b; render(); }, "aria-label": `${bname(b)} 내림 ${v.d}개 오름 ${v.u}개` },
        h("span", { class: "bn" }, BR[b].name), h("span", { class: "side l" }, h("b", {}, v.d || ""), h("i", { style: `width:${v.d / pmax * 100}%` })), h("span", { class: "side r" }, h("i", { style: `width:${v.u / pmax * 100}%` }), h("b", {}, v.u || "")))))) ));
    const q = h("input", { type: "search", placeholder: "시술 이름으로 찾기", "aria-label": "시술 찾기" });
    const list = h("ul", { class: "list" });
    const paint = () => {
      const w = q.value.trim().toLowerCase();
      const pct = (x) => x.before && x.after ? (x.after - x.before) / x.before : 0;
      let shown = all.filter((x) => (st.cdir === "all" || x.t === st.cdir) && (st.ccat < 0 || x.cat === st.ccat) && (st.cbr == null || x.b === st.cbr) && (!w || x.name.toLowerCase().includes(w)));
      shown.sort({ pct: (a, b) => Math.abs(pct(b)) - Math.abs(pct(a)), amount: (a, b) => Math.abs((b.after || 0) - (b.before || 0)) - Math.abs((a.after || 0) - (a.before || 0)), branch: (a, b) => a.b - b.b || a.name.localeCompare(b.name, "ko"), price: (a, b) => (a.after ?? a.before) - (b.after ?? b.before) }[st.csort]);
      list.replaceChildren(...shown.slice(0, 300).map((x) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${x.b}`) },
        h("span", { class: "t" }, x.name), h("span", { class: `p num ${x.t === "down" ? "down" : x.t === "up" ? "up" : ""}` }, x.after != null ? won(x.after) : "없어짐"),
        h("span", { class: "m" }, bdot(x.b), h("span", {}, bname(x.b)), x.before != null && x.after != null ? [h("s", {}, won(x.before)), h("span", { class: x.t }, `${pct(x) < 0 ? "−" : "+"}${Math.round(Math.abs(pct(x)) * 100)}%`)] : null,
          x.t === "new" ? h("span", { class: "k k1" }, "새로 생김") : null, x.t === "gone" ? h("span", { class: "k k4" }, `지난 수집 ${won(x.before)}`) : null)))));
      if (!shown.length) list.replaceChildren(h("div", { class: "empty" }, "조건에 맞는 변동이 없어요"));
      else if (shown.length > 300) list.append(h("div", { class: "empty" }, `${shown.length}개 중 300개만 보여요`));
    };
    q.addEventListener("input", paint);
    const cats = [...new Set(all.map((x) => x.cat).filter((c) => c >= 0))].sort((a, b) => a - b);
    box.append(h("div", { class: "card" }, h("div", { class: "search", style: "box-shadow:none;background:var(--fill)" }, q),
      h("div", { class: "chips", style: "margin-top:10px" }, h("button", { class: "chip", type: "button", "aria-pressed": st.ccat < 0 ? "true" : "false", onclick: () => { st.ccat = -1; render(); } }, "전체"),
        cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": st.ccat === c ? "true" : "false", onclick: () => { st.ccat = c; render(); } }, D.meta.cats[c]))),
      h("div", { class: "chips", style: "margin-top:8px" }, [["pct", "변동률 큰 순"], ["amount", "금액 큰 순"], ["price", "싼 순"], ["branch", "지점별"]].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": st.csort === v ? "true" : "false", onclick: () => { st.csort = v; render(); } }, l))),
      st.cbr != null ? h("div", { class: "row", style: "margin-top:8px" }, h("span", { class: "sub" }, `지점: ${bname(st.cbr)}`), h("button", { class: "linkbtn", type: "button", onclick: () => { st.cbr = null; render(); } }, "해제")) : null));
    box.append(h("div", { class: "card flush" }, list));
    paint();
    return box;
  };

  // ---------------- search index (aliases, typo correction, autocomplete — app/domain/search.js), built on first use
  let SIDX = null, normBySid = null;
  function searchIndex() {
    if (SIDX) return SIDX;
    const sids = [...new Set(ROWS.map((r) => r[2]))];
    SIDX = Search.buildIndex(sids.map((i) => S[i]), [...KEYS.map((k) => k.label), ...FAM.map((f) => f.name)]);
    normBySid = new Map(sids.map((sid, n) => [sid, SIDX.normNames[n]]));
    return SIDX;
  }
  const suggestTerms = () => [...KEYS.map((k) => k.label), ...FAM.map((f) => f.name)];
  // popular = procedure families sold at the most branches
  let POP = null;
  const popularTerms = () => POP || (POP = FAM.map((f) => [f.name, new Set(f.vs.flatMap((v) => [...byKB[v.k].keys()])).size]).sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0]));
  function rememberQuery(q) { if (!q || !histOn()) return; store.set("recentQ", [q, ...store.get("recentQ", []).filter((x) => x !== q)].slice(0, 8)); }
  // words the natural-language search recognises as places: branch names and 구 names in addresses
  let NLCTX = null;
  function nlCtx() {
    if (NLCTX) return NLCTX;
    const brands = D.meta.brands.map((b) => b[0]).filter((b, i) => BR.some((x) => x.brand === i));
    const sido = [...new Set(BR.map((b) => b.region).filter(Boolean))];
    const areas = new Set();
    for (const b of BR) {
      for (const w of b.name.replace(/점$/, "").split(/\s+/)) { const a = w.replace(/(역|점)$/, ""); if (a.length >= 2) areas.add(a); }
      const m = /([가-힣]{2,})구\s/.exec(b.addr || ""); if (m) areas.add(m[1]);
    }
    for (const x of [...brands, ...sido, "리저브", "본점"]) areas.delete(x);
    return (NLCTX = { brands, sido, areas: [...areas] });
  }
  // autocomplete dropdown under a search input; pick(text) runs the search
  function withSuggest(input, pick) {
    const list = h("ul", { class: "suggest", role: "listbox", hidden: true });
    let n = -1;
    const opt = (x) => h("li", { role: "option" }, h("button", { type: "button", onmousedown: (e) => e.preventDefault(), onclick: () => { input.value = x; list.hidden = true; pick(x); } }, x));
    const show = () => {
      const v = input.value.trim();
      n = -1;
      if (v) {
        const items = Search.suggest(v, searchIndex(), suggestTerms());
        list.replaceChildren(...items.map(opt));
        list.hidden = !items.length;
        return;
      }
      // empty box: recent searches (this phone) + popular procedures
      const rec = store.get("recentQ", []);
      list.replaceChildren(
        ...(rec.length ? [h("li", { class: "sugsec row" }, "최근 검색", h("span", { class: "sp" }), h("button", { type: "button", class: "linkbtn", style: "padding:0", onmousedown: (e) => e.preventDefault(), onclick: () => { store.set("recentQ", []); show(); } }, "지우기")), ...rec.map(opt)] : []),
        h("li", { class: "sugsec" }, "많이 찾는 시술"), ...popularTerms().map(opt));
      list.hidden = false;
    };
    input.setAttribute("autocomplete", "off");
    input.addEventListener("input", show);
    input.addEventListener("focus", () => { if (!input.value.trim()) show(); });
    input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));
    input.addEventListener("keydown", (e) => {
      const bs = [...list.querySelectorAll("button")];
      if (e.key === "ArrowDown" && bs.length) { n = Math.min(bs.length - 1, n + 1); bs[n].focus(); e.preventDefault(); }
    });
    list.addEventListener("keydown", (e) => {
      const bs = [...list.querySelectorAll("button")], k = bs.indexOf(document.activeElement);
      if (e.key === "ArrowDown" && k < bs.length - 1) { bs[k + 1].focus(); e.preventDefault(); }
      if (e.key === "ArrowUp") { (k > 0 ? bs[k - 1] : input).focus(); e.preventDefault(); }
      if (e.key === "Escape") { list.hidden = true; input.focus(); }
    });
    return h("div", { class: "sugwrap" }, input, list);
  }

  // ---------------- price list with filters, shared by 전체 가격표 (#table) and search (#search/<q>); filter state lives in the URL
  // sorts for every price list: neutral ones first; discount-led sorts only with flags.discountEmphasis
  const SORTS = () => [["region", "지역·이름순"], ["recent", "최근 확인순"], ["near", "가까운 순"], ["price", "낮은 가격순"], ["priceDesc", "높은 가격순"], ["unit", "단위당 가격"], ["name", "상품명순"],
    ...(FLAGS.discountEmphasis ? [["disc", "할인율 큰 순"], ["pos", "중간보다 싼 순"]] : [])];
  const SESS_L = { "1": "1회 가격", pkg: "2회 이상 패키지", pass: "이용권·무제한" }, COND_L = { plain: "조건 없는 가격만", special: "체험가·한정가·시간 조건만" };
  const amtOf = (i) => { const u = Search.unitOf(S[ROWS[i][2]]); return u && !/\+/.test(S[ROWS[i][2]]) ? `${u.qty}${u.unit}` : ""; };
  // treatment attributes (origin · sex · area · grade) of a price, from the labels of its comparison keys (Search.attrsOf);
  // cached per key set — many prices share one
  const attrCache = new Map();
  const attrsOfRow = (i) => { const ks = ROWS[i][7]; let a = attrCache.get(ks);
    if (!a) { a = Search.attrsOf(S[ks].split(" ").filter(Boolean).map((k) => KI[k] != null ? KEYS[KI[k]].label : "")); attrCache.set(ks, a); } return a; };
  // selected attributes: one per group (원산지 · 성별 · 부위 · 등급), all of them must hold
  const attOk = (i, atts, skipGroup = "") => { if (!atts.length) return true; const a = attrsOfRow(i); return atts.every((x) => Search.attrGroup(x) === skipGroup || a.includes(x)); };
  const areaOk = (b, area) => !area || BR[b].name.includes(area) || (BR[b].addr || "").includes(area);
  const regOk = (b, reg) => !reg ? regionOk(b) : reg === "수도권" ? CAPITAL.includes(BR[b].region) : reg === "전국" ? true : BR[b].region === reg;
  function readFilters(params, q) {
    const P = (k, d = "") => params.get(k) ?? d;
    return { q: q ?? P("q"), cat: +P("cat", -1), brand: +P("brand", -1), b: +P("b", -1), kind: +P("kind", -1), sort: (() => { const v = P("sort", "") || store.get("tableSort", "region"); return SORTS().some(([k]) => k === v) ? v : "region"; })(),
      min: +P("min", 0) || 0, max: +P("max", 0) || 0, sess: P("sess", ""), cond: P("cond", ""), unit: P("unit", ""), amt: P("amt", ""), area: P("area", ""), reg: P("reg", ""),
      atts: P("att", "").split(",").filter((x) => Search.attrGroup(x)),
      fv: P("fv", ""), bun: P("bun", ""), old: P("old") === "1", vu: P("vu", ""), prod: P("prod", ""),   // 가격 조건 sheet + 제품·장비 chips
      exact: P("exact") === "1", n: +P("n", 100) };
  }
  // every filter as a predicate; skip = one dimension to ignore (for 'how many results would this option give')
  // cq = Search.compile(query) or null (docs/ADVANCED_SEARCH_SPEC.md: words, -뺄 낱말, a|b, 300샷, 1회?)
  function rowPasses(i, f, cq, skip = "") {
    const r = ROWS[i];
    if (!(f.old ? r[17] !== 1 : live(i)) || !brandOn(r[0]) || (!st.special && isSpecial(r))) return false;
    if (skip !== "fv" && f.fv && (f.fv === "only") !== isFirstVisit(r)) return false;
    if (skip !== "bun" && f.bun && (f.bun === "only") !== isBundle(r)) return false;
    if (skip !== "vu" && f.vu === "no" && r[12] === 0) return false;
    if (skip !== "prod" && f.prod && !prodOf(r[2]).includes(f.prod)) return false;
    if (skip !== "reg" && !regOk(r[0], f.reg)) return false;
    if (skip !== "area" && !areaOk(r[0], f.area)) return false;
    if (skip !== "cat" && f.cat >= 0 && r[1] !== f.cat) return false;
    if (skip !== "brand" && f.brand >= 0 && BR[r[0]].brand !== f.brand) return false;
    if (skip !== "b" && f.b >= 0 && r[0] !== f.b) return false;
    if (skip !== "kind" && f.kind >= 0 && r[5] !== f.kind) return false;
    if (skip !== "range" && ((f.min && r[3] < f.min) || (f.max && r[3] > f.max))) return false;
    if (skip !== "sess") { const ss = sessOf(i); if ((f.sess === "1" && ss !== 1) || (f.sess === "pkg" && (ss < 2 || ss >= 99)) || (f.sess === "pass" && ss < 99)) return false; }
    if (skip !== "cond" && ((f.cond === "plain" && isSpecial(r)) || (f.cond === "special" && !isSpecial(r)))) return false;
    if (skip !== "amt" && f.amt && amtOf(i) !== f.amt) return false;
    if (skip !== "att" && !attOk(i, f.atts || [])) return false;
    if (skip !== "q" && cq && !cq.empty && !cq.test(normBySid.get(r[2]))) return false;
    return true;
  }
  // ---- 가격 조건 (one sheet for every price condition: 조건부·종류·첫 방문·묶음·회차·부가세·만료/미확인)
  const FV_L = { only: "첫 방문가만", no: "첫 방문가 빼기" }, BUN_L = { only: "묶음(+) 가격만", no: "묶음(+) 빼기" };
  const condActive = (f) => [f.cond ? COND_L[f.cond] : "", f.kind >= 0 ? D.meta.kinds[f.kind] : "", f.fv ? FV_L[f.fv] : "", f.bun ? BUN_L[f.bun] : "", f.sess ? SESS_L[f.sess] : "",
    f.old ? "지난 이벤트·확인 중 포함" : "", f.vu ? "부가세 미확인 빼기" : "", st.special ? "" : "특가 빼기(앱 전체)", st.vat === "listed" ? "병원 표시가" : ""].filter(Boolean);
  function priceCondSheet(f, go, cnt) {
    const s0 = { cond: f.cond, kind: f.kind, fv: f.fv, bun: f.bun, sess: f.sess, old: f.old, vu: f.vu, special: st.special, vat: st.vat };
    const s = { ...s0 };
    sheet("가격 조건", (close) => {
      const box = h("div", {});
      const opts = (label, key, list, note) => h("div", { class: "pcgrp", role: "group", "aria-label": label }, h("div", { class: "sub", style: "margin:12px 0 6px" }, label),
        h("div", { class: "opts" }, list.map(([v, l, n]) => h("button", { class: "opt", type: "button", "aria-pressed": String(s[key]) === String(v) ? "true" : "false", onclick: () => { s[key] = v; paint(); } },
          h("b", {}, l), n != null ? h("span", { class: "num" }, `${n.toLocaleString()}개`) : null))), note ? h("div", { class: "tiny", style: "margin-top:4px" }, note) : null);
      const tog = (label, key, help) => h("label", { class: "row pctog", style: "margin-top:10px;gap:10px;flex-wrap:nowrap" }, h("input", { type: "checkbox", checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; } }),
        h("span", {}, h("b", {}, label), help ? h("span", { class: "tiny", style: "display:block" }, help) : null));
      const paint = () => fill(box,
        h("div", { class: "sub" }, "고르고 '적용'을 누르면 가격표에 바로 반영돼요. 숫자는 지금 다른 조건을 그대로 둘 때의 가격 수예요."),
        opts("조건부 가격(체험가·한정가·첫 방문·시간 조건)", "cond", [["", "모두", null], ["plain", "조건 없는 가격만", cnt.cond.plain || 0], ["special", "조건부만", cnt.cond.special || 0]]),
        opts("가격 종류", "kind", [[-1, "전체", null], ...D.meta.kinds.map((k, i) => [i, k, cnt.kind[i] || 0])]),
        opts("첫 방문 가격", "fv", [["", "상관없음", null], ["only", "첫 방문가만", cnt.fv.only || 0], ["no", "첫 방문가 빼기", cnt.fv.no || 0]], "병원이 '첫 방문·신규'라고 적은 가격이에요. 두 번째부터는 보통 일반가예요."),
        opts("묶음 가격(A+B처럼 여러 시술을 한 값에)", "bun", [["", "포함", null], ["only", "묶음만", cnt.bun.only || 0], ["no", "묶음 빼기", cnt.bun.no || 0]], "묶음은 구성이 지점마다 달라서 시술별 비교에는 쓰지 않아요."),
        opts("회차·패키지", "sess", [["", "전체", null], ...Object.entries(SESS_L).map(([k, l]) => [k, l, cnt.sess[k] || 0])], "회차가 적혀 있지 않은 가격은 1회 가격으로 보지만, 상품명에 없다는 걸 함께 표시해요."),
        opts("부가세 표시(앱 전체)", "vat", [["incl", "부가세 포함 예상가", null], ["listed", "병원 표시가", null]], "병원이 '부가세 별도'라고 적은 가격에만 10%를 더해요. 부가세 표기를 못 찾은 가격은 더하지도 빼지도 않아요."),
        h("div", { class: "sub", style: "margin:14px 0 0" }, "확인이 필요한 가격"),
        tog("특가 포함(앱 전체)", "special", "끄면 체험가·한정가·시간 조건 가격이 모든 화면에서 빠져요."),
        tog("지난 이벤트·확인 중 가격도 보기", "old", "이벤트가 끝났거나 급변해서 확인 중인 가격이에요. 가격표에서만 보이고 비교·장바구니에는 쓰지 않아요."),
        tog("부가세 표기를 못 찾은 가격 빼기", "vu", null),
        h("div", { class: "row", style: "margin-top:16px;gap:8px" },
          h("button", { class: "btn gray", type: "button", onclick: () => { Object.assign(s, { cond: "", kind: -1, fv: "", bun: "", sess: "", old: false, vu: "" }); paint(); } }, "초기화"),
          h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => {
            if (s.special !== st.special) { st.special = s.special; store.set("special", s.special); }
            if (s.vat !== st.vat) { st.vat = s.vat; store.set("vat", s.vat); applyVat(); }
            close(); go({ cond: s.cond, kind: s.kind, fv: s.fv, bun: s.bun, sess: s.sess, old: s.old, vu: s.vu ? "no" : "" }); } }, "적용")));
      s.vu = s.vu === "no";
      paint();
      return box;
    });
  }
  // 제품·장비 chips: product / device names the clinics wrote in the option names (Spec.PRODUCTS), shown once narrowed
  function prodFacet(f, cnt, go) {
    const list = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (list.length < 2 && !f.prod) return null;
    return h("div", { class: "prodf" }, h("div", { class: "sub", style: "margin:8px 0 6px" }, "제품·장비"),
      h("div", { class: "chips", role: "group", "aria-label": "제품·장비" }, list.map(([n, c]) => h("button", { class: "chip", type: "button", "aria-pressed": f.prod === n ? "true" : "false", onclick: () => go({ prod: f.prod === n ? "" : n }) }, `${n} (${c.toLocaleString()})`))),
      h("div", { class: "sub", style: "margin-top:6px" }, "상품명에 제품·장비 이름을 적은 가격만 잡혀요. 적지 않은 가격은 이 필터를 고르면 빠져요."));
  }
  // '이렇게 찾았어요': how the query was read (operators), and what was ignored
  const QK = { and: "포함", exact: "", not: "빼기", or: "둘 중 하나", opt: "" };
  function queryCard(cq) {
    return h("div", { class: "card qcard" }, h("div", { class: "sub" }, "이렇게 찾았어요"),
      h("div", { class: "chips", style: "margin-top:6px" }, cq.parts.map((x) => h("span", { class: `chip qk-${x.kind}`, style: "cursor:default" }, QK[x.kind] ? `${QK[x.kind]}: ` : "", x.label))),
      cq.warn.map((w) => h("div", { class: "tiny", style: "margin-top:6px;color:var(--pricey)" }, w)));
  }
  // 검색 팁 — 죠미가 연산자를 짧게 설명 (몰라도 필터로 같은 조건을 고를 수 있어요)
  const TIPS = [["50U만 찾고 싶다면?", "사각턱 50U", "숫자와 단위를 붙여 써요. 150U·500U는 빠져요."],
    ["특정 단어를 빼려면?", "사각턱 50U -제오민", "빼고 싶은 말 앞에 - 를 붙여요."],
    ["두 제품 중 하나를 찾으려면?", "제오민|코어톡스", "| 로 이어 써요(띄우지 않기)."],
    ["횟수가 적힌 것 중 1회만?", "슈링크 300샷 1회?", "숫자+단위 뒤에 ? 를 붙여요. 횟수가 안 적힌 상품은 '횟수 표기 없음'으로 따로 표시해요."]];
  function searchTips(run) {
    return h("details", { class: "stips" }, h("summary", {}, icon("circle-help", "xs"), "검색 팁"),
      jomiSay("explaining", "기호를 붙이면 더 딱 맞게 찾을 수 있어. 몰라도 괜찮아 — 아래 '가격 조건'과 칩으로 똑같이 고를 수 있어!"),
      h("ul", { class: "tiplist" }, TIPS.map(([q, ex, how]) => h("li", {}, h("b", {}, q), h("button", { class: "chip", type: "button", onclick: () => run(ex) }, h("code", {}, ex)), h("span", { class: "tiny" }, how)))));
  }
  // 세부 구분 chips (원산지 · 성별 · 부위 · 등급) for the price table; picking one in a group replaces that group's pick
  function attFacet(f, cnt, go) {
    const groups = Search.ATTRS.map(([g, list]) => [g, list.map(([n]) => n).filter((n) => cnt[n] || f.atts.includes(n)).sort((a, b) => (cnt[b] || 0) - (cnt[a] || 0)).slice(0, 12)]).filter(([, l]) => l.length);
    if (groups.reduce((s, [, l]) => s + l.length, 0) < 2 && !f.atts.length) return null;
    const pick = (n) => { const g = Search.attrGroup(n), rest = f.atts.filter((x) => Search.attrGroup(x) !== g); go({ att: (f.atts.includes(n) ? rest : [...rest, n]).join(",") }); };
    return h("div", { class: "attf" }, h("div", { class: "sub", style: "margin:8px 0 2px" }, "세부 구분"),
      groups.map(([g, l]) => h("div", { class: "chips", role: "group", "aria-label": g, style: "margin-top:6px" }, h("span", { class: "sub", style: "align-self:center;flex:none;min-width:44px" }, g),
        l.map((n) => h("button", { class: "chip", type: "button", "aria-pressed": f.atts.includes(n) ? "true" : "false", onclick: () => pick(n) }, `${n} (${(cnt[n] || 0).toLocaleString()})`)))),
      h("div", { class: "sub", style: "margin-top:6px" }, "시술 분류표가 상품명에서 읽은 구분이에요. 분류되지 않은 가격은 이 필터를 고르면 빠져요."));
  }
  function priceTable(route, params, opt = {}) {
    const f = readFilters(params, opt.q);
    const go = (patch) => {
      const np = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) { if (v === "" || v == null || v === -1 || v === false || (k === "n" && v === 100)) np.delete(k); else np.set(k, v === true ? "1" : v); }
      if (!("n" in patch)) np.delete("n");
      if ("sort" in patch && patch.sort) store.set("tableSort", patch.sort);     // remember the sort for next time
      const s = np.toString();
      history.replaceState(null, "", `#${route}${s ? "?" + s : ""}`);    // filter change: same page, keep the scroll position
      render();
    };
    const idx = searchIndex();
    // the query with its operators; 'exact' = as typed, no typo fix
    const cq = f.q ? Search.compile(f.q, f.exact ? null : idx) : null;
    const toks = cq && !cq.empty ? cq.raw : [];
    // results + per-option counts (each count ignores its own filter)
    let hits = [];
    const cnt = { cat: {}, brand: {}, kind: {}, sess: {}, cond: {}, amt: {}, att: {}, prod: {}, fv: {}, bun: {} };
    const attOn = toks.length > 0 || f.cat >= 0 || f.atts.length > 0;   // the whole table's attributes say little; shown once narrowed
    const pr = [];
    for (let i = 0; i < ROWS.length; i++) {
      if (!(f.old ? ROWS[i][17] !== 1 : live(i)) || !brandOn(ROWS[i][0])) continue;
      const all = rowPasses(i, f, cq);
      if (all) hits.push(i);
      const r = ROWS[i];
      if (rowPasses(i, f, cq, "cat")) cnt.cat[r[1]] = (cnt.cat[r[1]] || 0) + 1;
      if (rowPasses(i, f, cq, "brand")) cnt.brand[BR[r[0]].brand] = (cnt.brand[BR[r[0]].brand] || 0) + 1;
      if (rowPasses(i, f, cq, "kind")) cnt.kind[r[5]] = (cnt.kind[r[5]] || 0) + 1;
      if (rowPasses(i, f, cq, "sess")) { const ss = sessOf(i), k = ss >= 99 ? "pass" : ss >= 2 ? "pkg" : "1"; cnt.sess[k] = (cnt.sess[k] || 0) + 1; }
      if (rowPasses(i, f, cq, "cond")) { const k = isSpecial(r) ? "special" : "plain"; cnt.cond[k] = (cnt.cond[k] || 0) + 1; }
      if (toks.length && rowPasses(i, f, cq, "amt")) { const a = amtOf(i); if (a) cnt.amt[a] = (cnt.amt[a] || 0) + 1; }
      // each attribute's count = results if it were picked (the pick in its own group is swapped, other groups still hold)
      if (attOn && rowPasses(i, f, cq, "att")) for (const a of attrsOfRow(i)) if (attOk(i, f.atts, Search.attrGroup(a))) cnt.att[a] = (cnt.att[a] || 0) + 1;
      if (rowPasses(i, f, cq, "range")) pr.push(r[3]);
      if (attOn && rowPasses(i, f, cq, "prod")) for (const x of prodOf(r[2])) cnt.prod[x] = (cnt.prod[x] || 0) + 1;
      if (rowPasses(i, f, cq, "fv")) { const k = isFirstVisit(r) ? "only" : "no"; cnt.fv[k] = (cnt.fv[k] || 0) + 1; }
      if (rowPasses(i, f, cq, "bun")) { const k = isBundle(r) ? "only" : "no"; cnt.bun[k] = (cnt.bun[k] || 0) + 1; }
    }
    const box = h("div", { class: "view", style: "animation:none" });
    const sel = (label, key, val, opts, extra = {}) => h("label", { class: "flabel" }, label, h("select", { class: "pick", onchange: (e) => go({ [key]: e.target.value, ...extra }) },
      opts.map(([v, l, n]) => h("option", { value: v, selected: String(v) === String(val), disabled: n === 0 && String(v) !== String(val) }, n == null ? l : `${l} (${n.toLocaleString()})`))));
    const brs = BR.filter((x) => (f.brand < 0 || x.brand === f.brand) && regOk(x.i, f.reg) && areaOk(x.i, f.area)).sort((a, b) => a.brand - b.brand || a.name.localeCompare(b.name, "ko"));
    // price range: number inputs ↔ sliders, live; applied on release; min > max is refused inline
    pr.sort((a, b) => a - b);
    const top = pr.length ? Math.ceil(pr[Math.min(pr.length - 1, Math.floor(pr.length * 0.98))] / 10000) * 10000 : 1000000;
    const smax = Math.max(top, f.max || 0, 10000);
    const mk = (v, lbl) => h("input", { class: "pick", type: "number", inputmode: "numeric", min: "0", step: "1000", value: v || "", placeholder: lbl, "aria-label": `${lbl} 가격` });
    const minIn = mk(f.min, "최소"), maxIn = mk(f.max, "최대");
    const rs = (v, lbl) => h("input", { type: "range", min: "0", max: String(smax), step: "1000", value: String(v), "aria-label": `${lbl} 가격 슬라이더` });
    const minR = rs(f.min || 0, "최소"), maxR = rs(f.max || smax, "최대");
    const err = h("div", { class: "ferr", role: "alert", hidden: true }, "최소 가격이 최대 가격보다 커요");
    const check = () => { const a = +minIn.value || 0, b = +maxIn.value || 0; const bad = b && a > b; err.hidden = !bad; minIn.setAttribute("aria-invalid", bad ? "true" : "false"); return !bad; };
    // only redraw when the range actually changed — tabbing through the boxes must not reset keyboard focus
    const commit = () => setTimeout(() => { if (!check()) return; const a = Math.max(0, Math.round(+minIn.value || 0)), b = Math.max(0, Math.round(+maxIn.value || 0)); if (a !== (f.min || 0) || b !== (f.max || 0)) go({ min: a || "", max: b || "" }); }, 0);
    minR.addEventListener("input", () => { if (+minR.value > +maxR.value) maxR.value = minR.value; minIn.value = +minR.value || ""; maxIn.value = +maxR.value >= smax ? "" : maxR.value; check(); });
    maxR.addEventListener("input", () => { if (+maxR.value < +minR.value) minR.value = maxR.value; maxIn.value = +maxR.value >= smax ? "" : maxR.value; minIn.value = +minR.value || ""; check(); });
    minIn.addEventListener("input", () => { minR.value = +minIn.value || 0; check(); }); maxIn.addEventListener("input", () => { maxR.value = +maxIn.value || smax; check(); });
    for (const el of [minR, maxR]) el.addEventListener("change", commit);
    // number boxes apply when focus leaves both of them (or Enter) — moving from 최소 to 최대 doesn't redraw the page
    const rangeBox = h("div", { class: "range" }, minIn, h("span", {}, "~"), maxIn);
    rangeBox.addEventListener("focusout", (e) => { if (!rangeBox.contains(e.relatedTarget)) commit(); });
    for (const el of [minIn, maxIn]) el.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
    // active filter chips (one-click removal) + presets
    const act = [];
    if (f.reg) act.push([`지역: ${f.reg}`, { reg: "" }]);
    if (f.area) act.push([`${f.area} 근처 지점`, { area: "" }]);
    if (f.cat >= 0) act.push([D.meta.cats[f.cat], { cat: -1 }]);
    if (f.brand >= 0) act.push([D.meta.brands[f.brand][0], { brand: -1, b: -1 }]);
    if (f.b >= 0) act.push([bname(f.b), { b: -1 }]);
    if (f.kind >= 0) act.push([D.meta.kinds[f.kind], { kind: -1 }]);
    if (f.sess) act.push([SESS_L[f.sess], { sess: "" }]);
    if (f.cond) act.push([COND_L[f.cond], { cond: "" }]);
    if (f.amt) act.push([f.amt, { amt: "" }]);
    for (const a of f.atts) act.push([a, { att: f.atts.filter((x) => x !== a).join(",") }]);
    if (f.min || f.max) act.push([`${f.min ? won(f.min) : "0원"} ~ ${f.max ? won(f.max) : "제한 없음"}`, { min: "", max: "" }]);
    if (f.fv) act.push([FV_L[f.fv], { fv: "" }]);
    if (f.bun) act.push([BUN_L[f.bun], { bun: "" }]);
    if (f.old) act.push(["지난 이벤트·확인 중 포함", { old: "" }]);
    if (f.vu) act.push(["부가세 미확인 빼기", { vu: "" }]);
    if (f.prod) act.push([`제품·장비: ${f.prod}`, { prod: "" }]);
    const presets = store.get("presets", []);
    const curQs = (() => { const np = new URLSearchParams(params); np.delete("n"); return np.toString(); })();
    // basic row: [지역] [가격 조건] [브랜드] [상세 필터]; 정렬 stays visible; chips (용량·세부 구분·제품) appear once narrowed
    const sidos = [...new Set(BR.map((x) => x.region))].map((rg) => [rg, BR.filter((x) => x.region === rg).length]).sort((a, b) => b[1] - a[1]);
    const regSel = sel("지역", "reg", f.reg, [["", `화면 위 지역 (${regionName()})`, null], ["전국", `전국 (${BR.length}곳)`, null], ["수도권", `수도권 (${BR.filter((x) => CAPITAL.includes(x.region)).length}곳)`, null], ...sidos.map(([rg, n]) => [rg, `${rg} (${n}곳)`, null])], { area: "" });
    const condN = condActive(f);
    const condBtn = h("div", { class: "flabel" }, "가격 조건", h("button", { class: "pick fbtn", type: "button", "aria-haspopup": "dialog", onclick: () => priceCondSheet(f, go, cnt) },
      h("span", {}, condN.length ? condN.join(" · ") : "기본(모두 포함)"), icon("chevron-down", "xs")));
    const advN = (f.cat >= 0) + (f.b >= 0) + (f.min || f.max ? 1 : 0);
    box.append(h("div", { class: "card" }, opt.head || null,
      presets.length ? h("div", { class: "chips", style: "margin-top:10px" }, h("span", { class: "sub", style: "align-self:center;flex:none" }, "내 필터"), presets.map((x) => h("span", { class: "chip pchip" },
        h("button", { type: "button", class: "plink", onclick: () => nav(`${x.route}${x.qs ? "?" + x.qs : ""}`) }, x.name),
        h("button", { type: "button", class: "px", "aria-label": `${x.name} 필터 지우기`, onclick: () => { const before = store.get("presets", []); store.set("presets", before.filter((y) => y.id !== x.id)); render(); undoToast(`'${x.name}' 필터를 지웠어요`, () => { store.set("presets", before); render(); }); } }, icon("x", "xs"))))) : null,
      act.length ? h("div", { class: "chips", style: "margin-top:10px" }, act.map(([l, patch]) => h("button", { class: "chip on", type: "button", "aria-label": `${l} 해제`, onclick: () => go(patch) }, l, icon("x", "xs"))),
        h("button", { class: "chip", type: "button", onclick: () => go({ reg: "", area: "", cat: -1, brand: -1, b: -1, kind: -1, sess: "", cond: "", amt: "", att: "", min: "", max: "", fv: "", bun: "", old: "", vu: "", prod: "" }) }, "모두 해제")) : null,
      h("div", { class: "fgrid fbar" }, regSel, condBtn,
        sel("브랜드", "brand", f.brand, [[-1, "전체", null], ...D.meta.brands.map((b, i) => BR.some((x) => x.brand === i) ? [i, b[0], cnt.brand[i] || 0] : null).filter(Boolean)], { b: "" }),
        sel("정렬", "sort", f.sort, SORTS().map(([v, l]) => [v, l, null]), { unit: "" })),
      h("details", { class: "fmore", open: advN > 0 }, h("summary", {}, "상세 필터", advN ? h("span", { class: "k k4" }, `${advN}개 사용 중`) : h("span", { class: "sub" }, "카테고리 · 지점 · 가격 범위")),
        h("div", { class: "fgrid" },
          sel("카테고리", "cat", f.cat, [[-1, "전체", null], ...D.meta.cats.map((c, i) => [i, c, cnt.cat[i] || 0])]),
          sel("지점", "b", f.b, [[-1, "전체", null], ...brs.map((x) => [x.i, bname(x.i), null])]),
          h("div", { class: "flabel wide" }, `가격 범위(원) · 최대 ${won(smax)}까지`, rangeBox, h("div", { class: "sliders" }, minR, maxR), err))),
      Object.keys(cnt.amt).length > 1 ? h("div", {}, h("div", { class: "sub", style: "margin:8px 0 6px" }, "용량·샷 수"), h("div", { class: "chips" },
        Object.entries(cnt.amt).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([a, n]) => h("button", { class: "chip", type: "button", "aria-pressed": f.amt === a ? "true" : "false", onclick: () => go({ amt: f.amt === a ? "" : a }) }, `${a} (${n})`)))) : null,
      prodFacet(f, cnt.prod, go),
      attFacet(f, cnt.att, go),
      h("div", { class: "row", style: "margin-top:4px" }, whenChip(),
        h("span", { class: "sp" }), curQs ? h("button", { class: "btn sm gray", type: "button", onclick: () => presetSheet(route, curQs) }, "조건 저장") : null)));
    // sort (equal prices: newer verification first, then regular before special)
    const disc = (i) => ROWS[i][4] ? (ROWS[i][4] - ROWS[i][3]) / ROWS[i][4] : 0;
    const ver = (i) => verified(ROWS[i][0]);
    const tie = (a, b) => ver(b).localeCompare(ver(a)) || (isSpecial(ROWS[a]) ? 1 : 0) - (isSpecial(ROWS[b]) ? 1 : 0);
    const notes = [];
    let unitInfo = null;
    if (f.sort === "unit") {
      const up = new Map(hits.map((i) => [i, Search.unitPrice(S[ROWS[i][2]], ROWS[i][3])]));
      const counts = {};
      for (const u of up.values()) if (u) counts[u.unit] = (counts[u.unit] || 0) + 1;
      const units = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const unit = f.unit && counts[f.unit] ? f.unit : units[0] ? units[0][0] : "";
      const without = hits.filter((i) => !up.get(i)).length, other = hits.filter((i) => up.get(i) && up.get(i).unit !== unit).length;
      hits = hits.filter((i) => up.get(i) && up.get(i).unit === unit).sort((a, b) => up.get(a).price - up.get(b).price || tie(a, b));
      unitInfo = { units, unit, up };
      notes.push(`단위당 가격은 참고용이에요. 샷 수·용량이 다르면 시술 구성이 달라요.${other ? ` 단위가 다른 ${other}개는 '조건 상이'라 빠졌어요.` : ""}${without ? ` 수량이 적혀 있지 않거나 묶음(+)인 ${without}개도 빠졌어요.` : ""}`);
    } else if (f.sort === "disc") {
      const before = hits.length;
      hits = hits.filter((i) => ROWS[i][4]).sort((a, b) => disc(b) - disc(a) || ROWS[a][3] - ROWS[b][3]);
      if (before > hits.length) notes.push(`할인율은 병원이 정가를 적은 가격만 계산해요(${(before - hits.length).toLocaleString()}개는 정가가 없어 빠짐).`);
    } else if (f.sort === "near") {
      if (!st.loc) notes.push("거리순은 기준 위치가 필요해요. 화면 위 '내 위치'에서 현재 위치나 집·직장을 고르세요.");
      hits.sort((a, b) => (dist(ROWS[a][0]) ?? 1e9) - (dist(ROWS[b][0]) ?? 1e9) || ROWS[a][3] - ROWS[b][3]);
    } else if (f.sort === "recent") hits.sort((a, b) => ver(b).localeCompare(ver(a)) || ROWS[a][3] - ROWS[b][3]);
    else if (f.sort === "name") hits.sort((a, b) => S[ROWS[a][2]].localeCompare(S[ROWS[b][2]], "ko") || ROWS[a][3] - ROWS[b][3]);
    else if (f.sort === "pos") { const pos = new Map(); const vm = (i) => { if (!pos.has(i)) { const x = rowPos(i); pos.set(i, x ? x.vsMed : 9); } return pos.get(i); }; hits.sort((a, b) => vm(a) - vm(b) || ROWS[a][3] - ROWS[b][3]); }
    else if (f.sort === "priceDesc") hits.sort((a, b) => ROWS[b][3] - ROWS[a][3] || tie(a, b));
    else if (f.sort === "region") hits.sort((a, b) => regionCmp(ROWS[a][0], ROWS[b][0]) || S[ROWS[a][2]].localeCompare(S[ROWS[b][2]], "ko") || ROWS[a][3] - ROWS[b][3]);
    else hits.sort((a, b) => ROWS[a][3] - ROWS[b][3] || tie(a, b));
    if (cq && (cq.ops || cq.warn.length)) box.append(queryCard(cq));
    if (cq && cq.fixes.length) box.append(h("div", { class: "note" }, cq.fixes.map(([a, b]) => `‘${a}’ 대신 ‘${b}’로 찾았어요. `), h("button", { class: "linkbtn", type: "button", onclick: () => go({ exact: true }) }, "입력한 그대로 찾기")));
    if (unitInfo && unitInfo.units.length > 1) box.append(h("div", { class: "chips" }, unitInfo.units.map(([u, n]) => h("button", { class: "chip", type: "button", "aria-pressed": u === unitInfo.unit ? "true" : "false", onclick: () => go({ unit: u, sort: "unit" }) }, `${u === "샷" ? "100샷" : u === "U" ? "10U" : "1" + u}당 · ${n}개`))));
    for (const n of notes) box.append(h("div", { class: "note" }, n));
    const minP = hits.length ? Math.min(...hits.map((i) => ROWS[i][3])) : 0;
    const maxP = hits.length ? Math.max(...hits.map((i) => ROWS[i][3])) : 0;
    box.append(h("div", { class: "searchstat", role: "status" }, hits.length ? (FLAGS.lowestHighlight ? `가격 ${hits.length.toLocaleString()}개 · 가장 싼 ${won(minP)} (${new Set(hits.filter((i) => ROWS[i][3] === minP).map((i) => ROWS[i][0])).size}개 지점)`
      : `가격 ${hits.length.toLocaleString()}개 · ${won(minP)} ~ ${won(maxP)} · ${(SORTS().find(([v]) => v === f.sort) || [, ""])[1]}`) : "조건에 맞는 가격이 없어요"));
    if (hits.length) box.append(h("p", { class: "note" }, "가격만으로 고르지 마세요. 이름이 같아도 용량·회차·조건·정품 여부·시술 의료진이 다를 수 있어요. 각 가격의 'i'(가격 근거)에서 조건과 부작용·주의사항을 함께 확인하세요."));
    if (!hits.length) { box.append(noResults(f, cq, go, route)); return box; }
    box.append(h("div", { class: "card flush" }, h("ul", { class: "list" }, hits.slice(0, f.n).map((i) => { const r = ROWS[i], x = rowPos(i), u = Search.unitPrice(S[r[2]], r[3]);
      return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
        h("span", { class: "m" }, h("button", { class: "linkbtn", type: "button", onclick: () => nav(`branch/${r[0]}`) }, bdot(r[0]), bname(r[0])), listS(r),
          r[4] && FLAGS.discountEmphasis ? h("span", { class: "k kt" }, `${Math.round(disc(i) * 100)}%↓`) : null, kindBadge(r),
          u ? h("span", { class: "unitp" }, `${u.unit === "샷" ? "100샷" : u.unit === "U" ? "10U" : "1" + u.unit}당 ${won(u.price)}`) : null,
          x && FLAGS.lowestHighlight ? h("span", { class: x.vsMed < -0.005 ? "down" : x.vsMed > 0.005 ? "up" : "" }, `${x.n}곳 중 ${x.rank}위`) : null,
          ...(cq ? cq.unstated(normBySid.get(r[2])).map((t) => h("span", { class: "k kx", title: "상품명에 적혀 있지 않아요. 1회로 단정하지 않아요" }, t)) : []),
          f.sort === "recent" ? h("span", {}, `${ver(i)} 확인`) : null, dist(r[0]) != null ? h("b", {}, km(dist(r[0]))) : null,
          h("button", { class: "linkbtn", type: "button", onclick: () => priceSheet(i) }, icon("info", "xs"), "가격 근거"), srcLink(i), h("span", { class: "sp" }), rowAddBtn(i)))); })),
      hits.length > f.n ? h("button", { class: "more-link", type: "button", onclick: () => go({ n: f.n + 200 }) }, `더 보기 (${(hits.length - f.n).toLocaleString()}개 남음)`) : null));
    return box;
  }
  // zero results: offer the nearest searches that do return something
  function noResults(f, cq, go, route = "") {
    const toks = cq && !cq.empty ? cq.raw : [];
    const count = (ff, c) => { let n = 0; for (let i = 0; i < ROWS.length; i++) if (rowPasses(i, ff, c)) n++; return n; };
    const reQ = (q) => route.startsWith("search/") ? nav(`search/${encodeURIComponent(q)}?nl=0`, true) : go({ q });
    const bare = { ...f, cat: -1, brand: -1, b: -1, kind: -1, sess: "", cond: "", amt: "", min: 0, max: 0, area: "", reg: "전국" };
    const tips = [];
    const hasF = f.cat >= 0 || f.brand >= 0 || f.b >= 0 || f.kind >= 0 || f.sess || f.cond || f.amt || f.min || f.max || f.area || f.reg;
    if (hasF) { const n = count(bare, cq); if (n) tips.push([`필터 모두 빼고 찾기 (${n.toLocaleString()}개)`, () => go({ reg: "전국", area: "", cat: -1, brand: -1, b: -1, kind: -1, sess: "", cond: "", amt: "", min: "", max: "" })]); }
    if (!f.reg || f.reg !== "전국") { const n = count({ ...f, reg: "전국" }, cq); if (n) tips.push([`전국에서 찾기 (${n.toLocaleString()}개)`, () => go({ reg: "전국" })]); }
    if (toks.length > 1) toks.forEach((tk, j) => { const rest = toks.filter((_, k) => k !== j).join(" "); const n = count(f, Search.compile(rest, searchIndex())); if (n) tips.push([`‘${tk}’ 빼고 찾기 (${n.toLocaleString()}개)`, () => reQ(rest)]); });
    if (toks.length) for (const s of Search.suggest(toks.find((t) => !/^[-−]|\||\?$/.test(t)) || "", searchIndex(), suggestTerms(), 3)) tips.push([`‘${s}’ 찾기`, () => nav(`search/${encodeURIComponent(s)}`)]);
    return h("div", { class: "card" }, jomiEmpty("empty", jline("emptySearch") || "찾지 못했어요", "이 조건으로는 가격이 없어요."),
      tips.length ? h("div", {}, h("div", { class: "sub", style: "margin-bottom:6px" }, "이렇게 찾아보면 있어요"), h("div", { class: "chips wrapc" }, tips.slice(0, 6).map(([l, fn]) => h("button", { class: "chip", type: "button", onclick: fn }, l))))
        : h("div", { class: "sub" }, "짧게 써 보세요(예: 슈링크)."));
  }
  function presetSheet(route, qs) {
    sheet("조건 저장", (close) => {
      const name = h("input", { class: "field", maxlength: "20", placeholder: "예: 강남 리프팅 10만원 이하", "aria-label": "필터 이름" });
      const err = h("div", { class: "ferr", role: "alert", hidden: true }, "이름을 적어 주세요");
      const save = () => {
        const v = name.value.trim();
        if (!v) { err.hidden = false; name.setAttribute("aria-invalid", "true"); name.focus(); return; }
        const list = store.get("presets", []).filter((x) => x.name !== v);
        list.unshift({ id: uid(), name: v, route: route.startsWith("search/") ? route : "table", qs });
        store.set("presets", list.slice(0, 10)); close(); render(); toast("필터를 저장했어요");
      };
      name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
      return h("div", {}, h("div", { class: "sub" }, "지금 고른 검색어·필터·정렬을 이름 붙여 저장해요(최대 10개, 이 기기)."), h("label", { class: "flabel" }, "이름", name), err,
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:14px", onclick: save }, "저장"));
    });
  }
  views.table = (arg, params) => {
    const box = h("div", { class: "view" });
    box.append(cmpNav("table"));
    const q = h("input", { type: "search", value: params.get("q") || "", placeholder: "이름에 들어간 말 (예: 리쥬란 2cc, rejuran)", "aria-label": "가격 검색", enterkeyhint: "search" });
    const run = (v) => { const np = new URLSearchParams(params); if (v) np.set("q", v); else np.delete("q"); np.delete("exact"); np.delete("n"); nav(`table?${np}`, true); };
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") run(q.value.trim()); });
    box.append(priceTable("table", params, { head: [h("h2", {}, "전체 가격표"), h("div", { class: "sub", style: "margin-top:4px" }, `모든 지점의 모든 가격 · ${regionName()} · ${vatNote()}`),
      h("div", { class: "search", style: "margin-top:10px;box-shadow:none;background:var(--fill)" }, withSuggest(q, run)), searchTips(run)] }));
    return box;
  };

  // ---------------- price error report: GitHub issue (prefilled) or copied text; kept in a local list
  function reportSheet(i) {
    const r = ROWS[i];
    const reasons = ["가격이 사이트와 달라요", "이벤트가 끝났어요", "없는 상품이에요", "조건(첫 방문·시간)이 달라요", "기타"];
    const s = { why: reasons[0] };
    sheet("가격 오류 신고", (close) => {
      const box = h("div", {});
      const note = h("textarea", { class: "field", rows: "2", maxlength: "300", placeholder: "예: 사이트에는 59,000원으로 나와요", "aria-label": "메모" });
      const body = () => [`지점: ${bname(r[0])}`, `상품: ${S[r[2]]}`, `앱 표시: ${won(r[3])} (${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"}, 병원 표시 ${won(r[14])})`,
        `사유: ${s.why}`, note.value.trim() ? `메모: ${note.value.trim()}` : "", `출처: ${S[r[11]] || "-"}`, `가격 확인일: ${verified(r[0])} · 앱 데이터 ${D.meta.updated}`].filter(Boolean).join("\n");
      const keep = (via) => { const list = store.get("reports", []); list.unshift({ at: today(), n: S[r[2]], br: bkey(r[0]), why: s.why, via, url: S[r[11]] || "" }); store.set("reports", list.slice(0, 50)); };
      const paint = () => fill(box,
        h("div", { class: "sub" }, `${bname(r[0])} · ${S[r[2]]} · ${won(r[3])}`),
        h("div", { class: "opts", style: "margin-top:10px" }, reasons.map((x) => h("button", { class: "opt", type: "button", "aria-pressed": s.why === x ? "true" : "false", onclick: () => { s.why = x; paint(); } }, h("b", {}, x)))),
        h("label", { class: "flabel" }, "메모 (선택)", note),
        h("dl", { class: "kv", style: "margin-top:8px" }, h("dt", {}, "원본 주소"), h("dd", {}, S[r[11]] ? h("a", { href: S[r[11]], target: "_blank", rel: "noopener noreferrer" }, S[r[11]].replace(/^https?:\/\//, "").slice(0, 60), icon("external-link", "xs")) : "원본 링크 없음"),
          h("dt", {}, "보낼 내용"), h("dd", {}, "지점·상품·앱 표시가·사유·메모·원본 주소·확인일")),
        h("div", { class: "sub", style: "margin-top:8px" }, "지금은 시연 단계라 윤실장 서버가 없어요. 실제로 운영자에게 닿는 건 'GitHub로 신고'(공개 글)뿐이에요."),
        h("div", { class: "sub", style: "margin-top:4px;color:var(--pricey)" }, "GitHub 신고는 누구나 볼 수 있는 공개 글이에요. 메모에 이름·연락처 같은 개인정보를 적지 마세요."),
        h("div", { class: "row", style: "margin-top:12px;gap:8px;flex-wrap:wrap" },
          h("button", { class: "btn gray", type: "button", onclick: () => { keep("demo"); close(); toast("이 휴대폰에만 저장했어요 — 서버로 보내지 않았어요(시연)"); } }, "기기에만 저장(시연)"),
          h("button", { class: "btn gray", type: "button", onclick: () => { keep("copy"); copyText(body(), "신고 내용을 복사했어요 — 직접 보내 주세요"); close(); } }, "내용 복사"),
          h("a", { class: "btn", style: "flex:1;text-align:center;text-decoration:none", target: "_blank", rel: "noopener",
            href: `https://github.com/lsy2825/skin/issues/new?${new URLSearchParams({ title: `[가격 신고] ${bname(r[0])} ${S[r[2]]}`.slice(0, 120), body: body(), labels: "price-report" })}`,
            onclick: () => { keep("github"); setTimeout(close, 100); } }, "GitHub로 신고(실제 접수)")),
        h("p", { class: "tiny", style: "margin-top:6px" }, "GitHub 화면이 열리면 거기서 '제출'을 눌러야 접수돼요. 보낸 내역은 관심 탭 '가격 확인 요청'에 상태와 함께 남아요."));
      paint();
      return box;
    });
  }

  // ---------------- 운영 현황 (ingestion status, freshness, review queue, source policy) — behind the PIN screen
  // 수집 실행 상태 (docs/ADMIN_OPERATIONS_SPEC.md §3): the last weekly-prices runs from GitHub's public API, asked only when
  // the button is pressed (60 requests an hour per IP without a token — no token is ever put in the app)
  const RUN_API = "https://api.github.com/repos/lsy2825/skin/actions/workflows/weekly.yml/runs?per_page=5";
  const runState = (r) => r.status === "in_progress" ? "RUNNING" : r.status !== "completed" ? "QUEUED" : r.conclusion === "success" ? "SUCCESS" : "FAILED";
  const RUN_EVT = { schedule: "예약", push: "코드 반영", workflow_dispatch: "수동" };
  function runStatusCard() {
    const out = h("div", { "aria-live": "polite" }, h("div", { class: "sub" }, "버튼을 누르면 GitHub에서 최근 실행 5개를 한 번 읽어 와요."));
    const btn = h("button", { class: "btn sm gray", type: "button", onclick: async () => {
      btn.disabled = true; fill(out, h("div", { class: "sub" }, "확인하는 중…"));
      try {
        const res = await fetch(RUN_API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
        if (res.status === 403 || res.status === 429) {
          const reset = +res.headers.get("x-ratelimit-reset"); const at = reset ? new Date(reset * 1000).toISOString().slice(11, 16) : "";
          fill(out, h("div", { class: "runst" }, h("span", { class: "k kx" }, "RATE_LIMITED"), h("span", { class: "sub" }, `GitHub 요청 한도(시간당 60번)를 다 썼어요.${at ? ` ${at}(UTC) 이후 다시 확인할 수 있어요.` : ""}`)));
        } else if (!res.ok) fill(out, h("div", { class: "sub" }, `확인하지 못했어요(HTTP ${res.status}). 상태를 짐작해서 보여주지 않아요.`));
        else {
          const runs = ((await res.json()).workflow_runs || []).slice(0, 5);
          fill(out, runs.length ? h("ul", { class: "plain runs" }, runs.map((r) => { const s2 = runState(r);
            return h("li", { class: "runst" }, h("span", { class: `k ${s2 === "SUCCESS" ? "ok" : s2 === "FAILED" ? "kx" : ""}` }, s2),
              h("span", {}, `${(r.run_started_at || r.created_at || "").replace("T", " ").slice(0, 16)} UTC · ${RUN_EVT[r.event] || r.event}`),
              h("a", { href: /^https:\/\/github\.com\//.test(r.html_url || "") ? r.html_url : "https://github.com/lsy2825/skin/actions", target: "_blank", rel: "noopener noreferrer" }, "자세히", icon("external-link", "xs"))); }))
            : h("div", { class: "sub" }, "실행 기록이 없어요."));
        }
      } catch (e) { fill(out, h("div", { class: "sub" }, "연결이 안 돼 확인하지 못했어요. 상태를 짐작해서 보여주지 않아요.")); }
      btn.disabled = false;
    } }, icon("refresh-cw", "sm"), "최근 수집 실행 확인");
    return h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "수집 실행 상태"), h("span", { class: "sp" }), btn),
      h("p", { class: "tiny", style: "margin:4px 0 8px" }, "QUEUED·RUNNING·SUCCESS·FAILED·RATE_LIMITED는 GitHub Actions가 알려준 그대로예요. 앱에서 수집을 시작하는 버튼은 없어요(저장소 권한이 필요해요)."), out);
  }
  // 분류 검토 센터 (docs/ADMIN_OPERATIONS_SPEC.md §4): app/review.json from tools/review_queue.js — read-only; decisions are
  // made in the repository files named in each item, and show up after the next build
  function reviewCenterCard() {
    const body = h("div", {}, h("div", { class: "sub" }, "불러오는 중…"));
    fetch("review.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((R) => {
      const total = Object.values(R.classes || {}).reduce((a, b) => a + b, 0) || 1;
      const tabs = [["R", "가격 확인"], ["C", "제품·장비 섞임"], ["J", "이름만 비슷"]];
      let cur = "R";
      const list = h("div", {});
      const paint = () => fill(list, (R.items[cur] || []).length ? h("ul", { class: "plain rvq" }, R.items[cur].map(([id, key, label, where, name, price, why]) =>
        h("li", {}, h("div", { class: "row", style: "gap:6px" }, h("span", { class: "k" }, id), h("b", {}, label || key), h("span", { class: "sp" }), h("span", { class: "tiny" }, where)),
          h("div", { class: "sub" }, `${name}${price ? ` · ${won(price)}` : ""}`), h("div", { class: "tiny" }, why)))) : h("div", { class: "empty" }, "대기 항목이 없어요."));
      fill(body,
        h("div", { class: "row", style: "gap:4px;flex-wrap:wrap" }, Object.entries(R.classes || {}).sort().map(([c, n]) => h("span", { class: "k", title: (Classify.CLASSES[c] || {}).label }, `${c} ${n.toLocaleString()} (${(n / total * 100).toFixed(1)}%)`))),
        h("p", { class: "tiny" }, `비교 묶음 안 가격 줄의 판정 분포 · ${R.updated} 빌드`),
        h("div", { class: "seg", role: "tablist", style: "margin-top:8px" }, tabs.map(([c, l]) => h("button", { type: "button", role: "tab", "aria-selected": c === cur ? "true" : "false",
          onclick: (e) => { cur = c; e.currentTarget.parentNode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b === e.currentTarget ? "true" : "false")); paint(); } }, `${l} ${(R.queue || {})[c] || 0}`))),
        list,
        h("p", { class: "tiny" }, "앱에서는 아무것도 바꾸지 않아요. 처리는 저장소에서: 가격 확인 → data2/review_ok.csv, 묶음 규칙 → build2/taxonomy.py·xkeys.py. 다음 빌드부터 반영돼요. 전체 목록: docs/CLASSIFICATION_REVIEW_QUEUE.csv"));
      paint();
    }).catch(() => fill(body, h("div", { class: "sub" }, "검토 목록(review.json)을 불러오지 못했어요. 빌드가 아직 만들지 않았을 수 있어요.")));
    return h("div", { class: "card" }, h("h3", {}, "분류 검토 센터"), body);
  }
  views.ops = () => {
    const box = h("div", { class: "view" });
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
    if (!FLAGS.ops) { box.append(h("div", { class: "card empty" }, "운영 현황이 꺼져 있어요(config.js flags.ops).")); return box; }
    const A = D.meta.about || {}, REPO = "https://github.com/lsy2825/skin";
    // collection report of the last run
    const lines = (A.report || "").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).replace(/\*\*/g, ""));
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, "운영 현황"), h("span", { class: "sp" }), h("a", { class: "btn sm gray", href: `${REPO}/actions`, target: "_blank", rel: "noopener" }, "실행 기록")),
      h("div", { class: "sub", style: "margin-top:4px" }, `마지막 빌드 ${D.meta.updated} · 매일 06:00 판단(월요일·이벤트 종료 다음 날 수집)`),
      h("ul", { class: "plain" }, lines.map((l) => h("li", { class: /유지|실패|막|검토/.test(l) ? "up" : "" }, l)))));
    // freshness per brand
    const per = D.meta.brands.map((b, bi) => {
      const brs = BR.filter((x) => x.brand === bi);
      if (!brs.length) return null;
      const rows = brs.reduce((s, x) => s + byB[x.i].length, 0);
      const stale = brs.filter((x) => fresh(x.i).stale).length;
      const latest = brs.map((x) => verified(x.i)).sort().pop();
      const expired = brs.reduce((s, x) => s + byB[x.i].filter((i) => ROWS[i][15] === 1).length, 0);
      const pending = brs.reduce((s, x) => s + byB[x.i].filter((i) => ROWS[i][15] === 2).length, 0);
      return { b, brs, rows, stale, latest, expired, pending };
    }).filter(Boolean);
    box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, "데이터 신선도")),
      h("ul", { class: "list" }, per.map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "dot bdot", style: `background:${x.b[1]}` }), x.b[0]),
        h("span", { class: "sub" }, `확인 ${x.latest}`),
        h("span", { class: "m" }, h("span", {}, `지점 ${x.brs.length}곳 · 가격 ${x.rows.toLocaleString()}개`), h("span", { class: x.stale ? "up" : "down" }, x.stale ? `STALE ${x.stale}곳` : "모두 VERIFIED"),
          x.expired ? h("span", { class: "up" }, `EXPIRED ${x.expired.toLocaleString()}개`) : null, x.pending ? h("span", { class: "up" }, `PENDING_REVIEW ${x.pending}개`) : null)))))));
    box.append(runStatusCard(), reviewCenterCard());
    // next-collection order (recheckQueue): what a re-collection server would read first
    const q = recheckQueue();
    box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, `재수집 순서 ${q.length}곳`),
      h("div", { class: "sub" }, "오래된 확인·수집 실패·7일 안에 끝나는 이벤트·급변 검토·원본 대조 불일치·지난 수집 이후 변동으로 점수를 매겨요. 지금 수집기는 매주 모든 지점을 읽고, 이 순서는 재수집 서버가 생기면 쓸 기준이에요.")),
      q.length ? h("ul", { class: "list" }, q.slice(0, 10).map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, bdot(x.b), bname(x.b)), h("span", { class: "sub num" }, `${x.sc}점`), h("span", { class: "m" }, x.why.join(" · ")))))) : h("div", { class: "empty" }, "먼저 볼 지점이 없어요")));
    // review queue
    const rv = A.review || [];
    box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, `검토 큐 ${rv.filter((x) => x.status === "검토 대기").length}개`),
      h("div", { class: "sub" }, "지난 수집보다 90% 넘게 내리거나 10배 넘게 오른 가격. 확인 전까지 비교에서 빠져요."),
      h("div", { class: "sub", style: "margin-top:4px" }, "승인: data2/review_ok.csv 에 brand,branch,name,price 한 줄을 추가 → 다음 빌드부터 반영(변경은 git 기록으로 남아요). ",
        h("a", { class: "linkbtn src", href: `${REPO}/blob/main/data2/review.csv`, target: "_blank", rel: "noopener" }, "review.csv"))),
      rv.length ? h("ul", { class: "list" }, rv.map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, x.name), h("span", { class: "p num" }, `${(+x.price).toLocaleString()}원`),
        h("span", { class: "m" }, h("span", {}, `${x.brand} ${x.branch}`), h("s", {}, `${(+x.before).toLocaleString()}원`), h("span", { class: "up" }, x.change), h("span", { class: x.status === "승인됨" ? "k k1" : "k kx" }, x.status),
          x.url ? h("a", { class: "linkbtn src", href: x.url, target: "_blank", rel: "noopener noreferrer" }, "출처") : null)))))
        : h("div", { class: "empty" }, D.meta.prev ? "검토할 가격이 없어요" : "지난 수집 기록이 생긴 뒤(다음 갱신)부터 확인해요")));
    // source policy
    const src = (A.sources || {}).brands || {};
    box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, "출처 정책 (Source Policy Registry)"), h("div", { class: "sub" }, `robots.txt 확인 ${((A.sources || {}).checked_at || "-").slice(0, 10)}`)),
      h("ul", { class: "list" }, Object.entries(src).map(([b, s]) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, b), h("span", { class: s.allowed ? "down" : "up" }, s.allowed ? "허용" : "막힘"),
        h("span", { class: "m" }, h("span", {}, s.method), s.crawl_delay ? h("span", {}, `crawl-delay ${s.crawl_delay}초`) : null,
          h("span", { class: s.terms_reviewed ? "" : "up" }, s.terms_reviewed ? `약관 검토 ${s.terms_reviewed}` : "약관 검토 필요")))))),
      h("div", { class: "sub", style: "padding:8px 12px 12px" }, "약관 검토일은 사람이 사이트 이용약관을 읽은 뒤 scrape/sources.py REGISTRY에 적어요.")));
    const reps = store.get("reports", []);
    // treatment knowledge base review state (knowledge/treatments.json)
    const kst = {}; for (const e of KB.entries) kst[e.review.status] = (kst[e.review.status] || 0) + 1;
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "시술 설명 검수 현황"), h("span", { class: "sp" }),
      h("a", { class: "btn sm gray", href: `${REPO}/blob/main/knowledge/README.md`, target: "_blank", rel: "noopener" }, "검수 방법")),
      h("div", { class: "sub" }, `항목 ${KB.entries.length}개 · ${Object.entries(kst).map(([k, v]) => `${(KB.statuses || {})[k] || k} ${v}`).join(" · ")} · 근거 출처 있음 ${KB.entries.filter((e) => e.sources.length).length} · 근거 자료 미정리 ${KB.entries.filter((e) => !e.sources.length).length}`),
      h("div", { class: "sub", style: "margin-top:4px" }, `설명이 없는 제품군 ${FAM.filter((f) => !kbOf(f)).length}개 (병원 설명만 보여줘요)`)));
    if (reps.length) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, `이 기기에서 보낸 가격 신고 ${reps.length}개`)),
      h("ul", { class: "list" }, reps.slice(0, 10).map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, x.n), h("span", { class: "sub" }, x.at), h("span", { class: "m" }, `${x.br.replace("|", " ")} · ${x.why}`)))))));
    box.append(h("div", { class: "card" }, h("h3", {}, "기능 플래그"), h("div", { class: "sub", style: "margin-top:4px" }, "법률 검토가 필요한 기능은 꺼 둬요(app/config.js flags)."),
      h("div", { class: "chips wrapc", style: "margin-top:8px" }, Object.entries({ ops: "운영 현황", ads: "광고", booking: "예약 연결", emailAlerts: "메일 알림", publicIndex: "검색 노출", lowestHighlight: "최저가 지점 강조", branchRanking: "지점 순위", discountEmphasis: "할인 강조" }).map(([k, l]) =>
        h("span", { class: "chip", style: "cursor:default" }, `${l}: ${FLAGS[k] ? "켬" : "끔"}`))),
      h("div", { class: "sub", style: "margin-top:8px" }, `로그인: ${window.Auth && window.Auth.enabled ? "켬" : "끔(키 없음)"}`)));
    if (window.Economics && window.DemoWallet) box.append(economicsCard());
    else { const slot = h("div", {}); box.append(slot); loadCommerce().then(() => { if (slot.isConnected) slot.replaceWith(economicsCard()); }).catch(() => {}); }
    box.append(h("div", { class: "card flush menu" }, h("ul", { class: "list" }, h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav("admin") },
      h("span", { class: "t" }, h("span", { class: "mi" }, icon("shield-check", "sm")), h("span", {}, h("span", { style: "display:block" }, "관리자 대시보드(서버)"),
        h("span", { class: "sub", style: "display:block;font-weight:500" }, "매출·결제·환불·크레딧·AI 비용 — 서버 연결 + 관리자 2단계 인증 필요"))), icon("chevron-right", "sm"))))));
    return box;
  };
  // unit economics (docs/PRICING_AND_UNIT_ECONOMICS.md): assumptions until the server's measured numbers exist
  function economicsCard() {
    const W = window.DemoWallet, fc = Object.fromEntries(Object.entries(W.FEATURES).map(([k, v]) => [k, v.credits]));
    const t = window.Economics.table(W.PRODUCTS, fc, "WEB_PG");
    return h("div", { class: "card", "data-testid": "economics" }, h("div", { class: "row" }, h("h3", {}, "크레딧 단위 경제성"), h("span", { class: "k k4" }, "가정")),
      h("div", { class: "sub", style: "margin-top:4px" }, "부가세·결제 수수료를 뺀 크레딧 1개의 순수익과 기능별 남는 돈. 수수료·AI 비용은 계약·청구서가 생기면 실제 값으로 바꿔요."),
      h("table", { class: "tbl", style: "margin-top:8px" }, h("thead", {}, h("tr", {}, ["묶음", "가격", "부가세", "수수료", "순수익", "크레딧당"].map((x) => h("th", {}, x)))),
        h("tbody", {}, t.packs.map((p) => h("tr", {}, h("td", {}, p.code), h("td", { class: "num" }, won(p.price_krw)), h("td", { class: "num" }, won(p.vat)), h("td", { class: "num" }, won(p.fee)), h("td", { class: "num" }, won(p.net)), h("td", { class: "num" }, `${p.net_per_credit}원`))))),
      h("div", { class: "tiny", style: "margin-top:4px" }, t.packs[0].fee_note),
      h("details", { class: "fold", style: "margin-top:8px" }, h("summary", {}, `기능별 (가장 싼 크레딧 ${t.worst_net_per_credit}원 기준)`),
        h("ul", { class: "plain" }, t.features.map((f) => h("li", {}, `${W.FEATURES[f.code].title}: ${f.credits}C → ${won(f.revenue)} − 비용 ${won(f.cost)}(가정) = ${won(f.margin)}`)))));
  }

  // ---------------- 알아두면 좋은 점: how prices are collected, compared and checked
  // ---------------- 데이터 상태 (docs/DATA_TRANSPARENCY_SPEC.md) · 앱 설치 · 이 기기 — on top of '알아두면 좋은 점' (#data, #about)
  let installEvt = null;   // Chrome/Edge/Android: the browser's own install prompt, kept until the user taps '이 기기에 설치하기'
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; if (current === "about") render(); });
  window.addEventListener("appinstalled", () => { installEvt = null; toast("홈 화면에 설치했어요"); });
  function dataStatusCard() {
    const ss = syncState(), m = SYNC.server || SYNC.local, A = D.meta.about || {};
    const ver = BR.filter((b) => !fresh(b.i).stale).length, stale = BR.length - ver;
    const ch = m && m.changes, cc = ch && ch.counts;
    const pri = recheckQueue();
    const row = (k, v) => h("div", { class: "fact" }, h("dt", {}, k), h("dd", {}, v));
    const local = SYNC.at ? new Date(SYNC.at) : null;
    return h("div", { class: "card", id: "data-status" }, h("div", { class: "row" }, h("h2", {}, "가격 데이터 상태"), h("span", { class: "sp" }), h("span", { class: `k ${ss.state === "READY" ? "k1" : "kx"}`, "data-state": ss.state }, Sync.label(ss, { ...SYNC, updated: D.meta.updated, stale }))),
      h("div", { class: "sub", style: "margin-top:4px" }, "병원 홈페이지에 공개된 가격을 매주 모은 자료예요. '실시간' 가격이 아니에요."),
      h("dl", { class: "facts", style: "margin-top:8px" },
        row("전체 등록 지점", `${BR.length}곳 (${D.meta.brands.filter((b, i) => BR.some((x) => x.brand === i)).map((b) => b[0]).join("·")})`),
        row("이번 수집에서 확인", `${ver}곳${stale ? ` · 수집 실패해 지난 가격을 쓰는 곳 ${stale}곳` : " · 실패 0곳"}`),
        row("다음 수집 때 먼저 볼 지점", pri.length ? `${pri.length}곳 (오래된 확인·끝나 가는 이벤트·급변 검토 등)` : "없음"),
        row("가격 수집일", `${D.meta.updated}${m && m.built ? ` · 파일 만든 시각 ${m.built.replace("T", " ").slice(0, 16)} UTC` : ""}`),
        row("마지막 동기화", local ? `${local.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} — 이 휴대폰이 서버의 데이터 버전을 확인한 시각${SYNC.metaOk ? "" : " (그때 서버에 닿지 못함)"}` : "-"),
        row("이번 갱신에서 바뀐 가격", cc ? `가격 바뀜 ${cc.price}개 · 새로 생김 ${cc.added}개 · 빠짐 ${cc.removed}개 (지난 수집본과 비교, 실제로 달라진 줄만)` : "비교할 지난 수집본 정보가 없어요"),
        row("갱신 실패", `${stale}곳${SYNC.failed ? ` · 이 휴대폰의 마지막 내려받기 실패: ${SYNC.failed}` : ""}`),
        row("데이터 원본", h("span", {}, Object.entries((A.sources || {}).brands || {}).map(([b, x]) => `${b}: ${x.method}`).join(" · ") || "병원 공식 홈페이지")),
        row("가격 비교 기준", "같은 시술·같은 용량(샷 수)·같은 회차·같은 원산지끼리만 비교해요. 다른 규격은 '조건 상이'로 따로 둬요."),
        row("부가세 처리", "병원이 '부가세 별도'라고 적은 가격에만 10%를 더해 '부가세 포함 예상가'로 보여줘요. 부가세 표기를 못 찾은 가격은 더하지도 빼지도 않아요. 마이 → 가격 표시에서 병원 표시가로 바꿀 수 있어요."),
        row("이벤트 가격 처리", "체험가·한정가·첫 방문·시간 조건 가격은 '조건부'로 표시해요. 종료일이 지난 가격은 비교에서 빠지고, 지난 수집보다 90% 넘게 내리거나 10배 넘게 오른 가격은 확인 전까지 빠져요."),
        row("가격 오류 신고", "각 가격의 'i'(가격 근거) → '원본과 달라요' 또는 '이 가격 다시 확인하기'. GitHub로 보내면 운영자에게 실제로 접수돼요.")),
      h("div", { class: "sub", style: "margin:10px 0 4px" }, "브랜드별 수집 상태"),
      h("ul", { class: "list" }, D.meta.brands.map((bb, bi) => { const brs = BR.filter((x) => x.brand === bi); if (!brs.length) return null;
        const ok = brs.filter((x) => !fresh(x.i).stale).length, ds = brs.map((x) => verified(x.i)).filter(Boolean).sort();
        return h("li", {}, h("div", { class: "item" }, h("span", { class: "t row", style: "gap:6px" }, h("span", { class: "bdot", style: `background:${bb[1]}` }), bb[0]),
          h("span", { class: "sub" }, `${ok}/${brs.length}곳 확인`), h("span", { class: "m" }, ds.length ? `가장 오래된 확인 ${ds[0]} · 가장 최근 ${ds[ds.length - 1]}` : "확인일 없음"))); })),
      ch && (ch.price.length || ch.added.length || ch.removed.length) ? h("details", { class: "fold small" }, h("summary", {}, "바뀐 가격 목록 보기"),
        h("ul", { class: "plain chlist" }, [...ch.price.map((x) => `${x[0]} ${x[1]} · ${x[2]} : ${won(x[3])} → ${won(x[4])}`), ...ch.added.map((x) => `새로 생김 · ${x[0]} ${x[1]} · ${x[2]} ${won(x[3])}`),
          ...ch.removed.map((x) => `빠짐 · ${x[0]} ${x[1]} · ${x[2]} ${won(x[3])}`)].slice(0, 40).map((t) => h("li", {}, t))), h("p", { class: "tiny" }, "병원 표시가 기준이에요. 40개까지 보여요.")) : null,
      FLAGS.ops ? h("button", { class: "linkbtn", type: "button", style: "margin-top:8px", onclick: () => nav("ops") }, "운영 현황(수집 보고·검토 큐·재수집 순서)", icon("chevron-right", "xs")) : null);
  }
  // next-collection order (PRICE_REFRESH_DESIGN.md §scheduling): old checks, failed runs, events ending soon, prices under
  // review, failed source re-checks, recent changes. The weekly collector still reads every branch; this is the order a
  // re-collection server would use.
  function recheckQueue() {
    const end7 = Intel.daysBefore(today(), -7), td = today();
    const changed = new Map();
    for (const [, b] of D.changes || []) changed.set(b, (changed.get(b) || 0) + 1);
    const out = [];
    for (const x of BR) {
      const f = fresh(x.i), why = [];
      let sc = 0;
      if (f.n != null && f.n > 7) { sc += f.n; why.push(`확인 ${f.n}일 전`); }
      if (f.stale) { sc += 10; why.push("이번 주 수집 실패"); }
      const ending = byB[x.i].filter((i) => { const u = S[ROWS[i][10]] || ""; return /^\d{4}-\d{2}-\d{2}$/.test(u) && u >= td && u <= end7; }).length;
      if (ending) { sc += Math.min(10, ending); why.push(`7일 안에 끝나는 이벤트 ${ending}개`); }
      const rev = byB[x.i].filter((i) => ROWS[i][15] === 2).length;
      if (rev) { sc += 3 * rev; why.push(`급변 검토 ${rev}개`); }
      const nf = byB[x.i].filter((i) => CHK.has(i) && [2, 3, 4].includes(CHK.get(i).s)).length;
      if (nf) { sc += 2 * nf; why.push(`원본 대조 불일치 ${nf}개`); }
      if (changed.get(x.i)) { sc += 1; why.push(`지난 수집 이후 가격 변동 ${changed.get(x.i)}개`); }
      if (sc > 0) out.push({ b: x.i, sc, why });
    }
    return out.sort((a, b) => b.sc - a.sc);
  }
  function installCard() {
    const ios = isIOS(), sa = standalone();
    const kids = [h("h3", {}, icon("smartphone", "sm"), " 홈 화면에 앱으로 설치")];
    if (sa) kids.push(h("div", { class: "sub" }, "지금 설치한 앱으로 열려 있어요."));
    else if (installEvt) kids.push(h("div", { class: "sub" }, "이 브라우저에서 바로 설치할 수 있어요. 설치하면 앱처럼 전체 화면으로 열리고, 저장된 가격으로 오프라인에서도 볼 수 있어요."),
      h("button", { class: "btn", type: "button", style: "margin-top:8px", onclick: async () => { const e = installEvt; installEvt = null; try { await e.prompt(); await e.userChoice; } catch (er) { /* closed */ } render(); } }, icon("download", "sm"), "이 기기에 설치하기"));
    else if (ios) kids.push(h("ol", { class: "steps" }, h("li", {}, "Safari로 이 페이지를 열어요."), h("li", {}, "아래쪽 공유 버튼(네모에 위 화살표)을 눌러요."), h("li", {}, "'홈 화면에 추가' → '추가'."),
      h("li", {}, "홈 화면 아이콘으로 열면 휴대폰 알림도 켤 수 있어요(iOS 16.4 이상).")));
    else kids.push(h("div", { class: "sub" }, "이 브라우저가 지금 설치 버튼을 주지 않았어요(이미 설치했거나, 지원하지 않는 브라우저일 수 있어요)."),
      h("ol", { class: "steps" }, h("li", {}, "Android Chrome: 오른쪽 위 ⋮ 메뉴 → '앱 설치' 또는 '홈 화면에 추가'."), h("li", {}, "PC Chrome·Edge: 주소창 오른쪽의 설치 아이콘."), h("li", {}, "iPhone: Safari 공유 버튼 → '홈 화면에 추가'.")));
    return h("div", { class: "card", id: "install" }, ...kids);
  }
  function deviceCard() {
    const box = h("div", { class: "card", id: "device" }, h("h3", {}, icon("database", "sm"), " 이 기기"));
    const dl = h("dl", { class: "facts" });
    box.append(dl, h("button", { class: "btn sm gray", type: "button", style: "margin-top:10px", onclick: async () => {
      if (loadCtl) loadCtl.abort();          // stop a running download first
      await cacheClear(); toast("저장된 가격을 지웠어요. 다시 받아요"); setTimeout(() => location.reload(), 400); } }, icon("refresh-cw", "sm"), "저장된 가격 지우고 다시 받기"),
      h("p", { class: "tiny" }, "관심·장바구니·설정은 그대로 두고 가격 파일만 지워요. 이 휴대폰에만 있는 정보예요."));
    (async () => {
      const m = await cacheInfo(), keys = canCache() ? await caches.keys().catch(() => []) : [];
      let est = null; try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { est = null; }
      const row = (k, v) => h("div", { class: "fact" }, h("dt", {}, k), h("dd", {}, v));
      fill(dl, row("앱으로 실행", standalone() ? "예 (설치한 앱)" : "아니요 (브라우저)"),
        row("저장된 가격", m ? `${m.updated} 수집본 · 지점 ${m.branches}곳 · 가격 ${m.rows.toLocaleString()}줄 · ${(m.bytes / 1e6).toFixed(1)}MB` : "저장된 사본 없음(다음에 열 때 다시 받아요)"),
        row("데이터 버전", SYNC.version || "-"),
        row("앱 버전", keys.find((k) => /^pc-v\d+$/.test(k)) || "서비스 워커 없음(이 브라우저는 오프라인 앱을 쓰지 않아요)"),
        est && est.usage ? row("이 사이트 저장 공간", `${(est.usage / 1e6).toFixed(1)}MB 사용`) : null,
        row("휴대폰 알림", !notifySupported() ? "지원 안 함" : Notification.permission === "granted" ? "켜짐(앱을 열 때만)" : Notification.permission === "denied" ? "꺼짐(브라우저 설정)" : "아직 안 켬"));
    })();
    return box;
  }
  // what the data covers, in one line (round-2 UX01/DATA): chains, branches, the collection date — so nobody reads '전국 최저가'
  function coverageLine() {
    const br = (D.meta.brands || []).map((b, i) => [b[0], BR.filter((x) => x.brand === i).length]).filter((x) => x[1] > 0);
    return `지금은 ${br.map((x) => x[0]).join("·")} ${br.length}개 체인 ${BR.length}곳의 공개 가격 · ${md(D.meta.updated)} 수집`;
  }
  // 운영 원칙 (round-2 FINAL §4, docs/PRODUCT_DECISIONS.md): what the app promises and what it does not. The wording promises
  // no paid ranking and disclosed interests — not 'we never take any money from clinics' (the owner has not decided on B2B)
  views.principles = () => {
    const box = h("div", { class: "view" });
    const br = (D.meta.brands || []).map((b, i) => ({ name: b[0], n: BR.filter((x) => x.brand === i).length, how: b[2] })).filter((x) => x.n);
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"),
      h("h2", { class: "title" }, "운영 원칙과 수집 범위"),
      h("div", { class: "card" }, h("h3", {}, "약속하는 것"),
        h("ul", { class: "plain" },
          h("li", {}, "돈을 받고 비교 순서를 바꾸지 않아요. 기본 순서는 지역·이름 순이고, 가격순은 직접 고를 때만이에요."),
          h("li", {}, "같은 제품·용량·횟수끼리만 나란히 놓아요. 규격이 다르면 다른 묶음이에요."),
          h("li", {}, "모든 가격에 병원 원본 링크와 수집일을 붙여요. 조건(첫 방문·체험가·부가세)은 가격 옆에 적어요."),
          h("li", {}, "광고·예약·쿠폰·병원 제휴는 지금 없어요. 생기면 이 화면에 먼저 적고, 가격 비교와 섞지 않아요."))),
      h("div", { class: "card" }, h("h3", {}, "수집 범위"),
        h("p", { class: "sub" }, `${md(D.meta.updated)} 수집 · ${br.length}개 체인 ${BR.length}곳. 전국 모든 피부과가 아니에요 — 동네 의원 대부분은 아직 없어요.`),
        h("ul", { class: "plain" }, br.map((x) => h("li", {}, h("b", {}, `${x.name} ${x.n}곳`), h("span", { class: "sub" }, ` — ${x.how}`))))),
      h("div", { class: "card" }, h("h3", {}, "이해관계"),
        h("p", { class: "sub" }, "지금 이 앱은 병원·제약사·장비 회사에서 받는 돈이 없어요. 크레딧 화면은 시연이고 실제 결제가 아니에요. 수익 방식이 정해지면(이용자 결제, 병원 대상 서비스 등) 여기에 날짜와 함께 적어요.")),
      h("div", { class: "card" }, h("h3", {}, "정정·삭제 요청"),
        h("p", { class: "sub" }, "가격이 틀렸거나 병원 정보를 빼 달라는 요청은 가격 근거 화면의 '신고'(가격 오류 신고)로 받아요. 지금은 GitHub 공개 글로 접수돼요. 병원이 요청하면 확인 후 수집에서 빼요(지금까지 1곳 중지). 운영자 연락처는 정식 공개 전에 확정해요."),
        h("button", { class: "btn line block", type: "button", onclick: () => nav("about") }, "데이터 상태와 출처 자세히", icon("chevron-right", "sm"))));
    return box;
  };
  views.about = () => {
    const box = h("div", { class: "view" });
    const A = D.meta.about || {}, src = A.sources || {};
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
    box.append(dataStatusCard(), installCard(), deviceCard());
    box.append(h("div", { class: "card" }, h("h2", {}, "알아두면 좋은 점"),
      h("div", { class: "note", style: "margin-top:10px" }, "이 앱은 병원 홈페이지에 공개된 가격을 모아 비교만 해요. 의료 상담·진단을 하지 않고 시술 효과나 안전을 보장하지 않아요. 예약·결제·광고·수수료가 없고, 어떤 병원과도 금전 관계가 없어요."),
      h("h3", { style: "margin-top:16px" }, "가격 종류"),
      h("dl", { class: "kv", style: "margin-top:8px" },
        h("dt", {}, h("span", { class: "k k1" }, "체험가")), h("dd", {}, "처음 한 번만 되는 가격(보통 1인 1회)"),
        h("dt", {}, h("span", { class: "k k2" }, "한정가")), h("dd", {}, "기간·수량·첫 방문 등 조건이 붙은 가격"),
        h("dt", {}, h("span", { class: "k kt" }, "평일 낮 등")), h("dd", {}, "그 시간·요일에만 되는 가격"),
        h("dt", {}, h("span", { class: "k k4" }, "고시가")), h("dd", {}, "리엔장 비급여 진료비 고시표(정가). 이벤트가가 아니에요"),
        h("dt", {}, h("span", { class: "k k4" }, "~10/17까지")), h("dd", {}, "병원이 적은 이벤트 종료일. 지나면 비교에서 빠지고, 다음 날 아침 다시 모아요"),
        h("dt", {}, h("span", { class: "k kx" }, "급변·확인 중")), h("dd", {}, "지난 수집보다 90% 넘게 내리거나 10배 넘게 오른 가격. 확인 전까지 비교에서 빠져요")),
      h("h3", { style: "margin-top:16px" }, "어떻게 비교하나요"),
      h("ul", { class: "plain" },
        h("li", {}, "같은 조건끼리만 비교해요. 브랜드가 다르면 용량·샷 수·회차·원산지가 같은 36개 시술만 맞대고, 그 밖은 이름이 똑같은 옵션을 3곳 이상이 팔 때만 묶어요. 비슷하지만 다른 상품은 묶지 않아요."),
        h("li", {}, "목록은 처음에 지역·지점 이름순이에요(기준 위치를 정하면 가까운순). 낮은·높은 가격순은 직접 고를 수 있고, 광고·제휴로 순서가 바뀌지 않아요. 특정 병원을 '최저가'로 앞세우지 않고 가격 범위와 중간값으로 요약해요."),
        h("li", {}, "가격과 함께 부작용·주의사항, 시술 조건을 보여줘요. 장비·약제의 정품 여부는 앱이 확인하지 않고, 의료진 정보는 모으지 않아요 — 병원에 확인하세요."),
        FLAGS.branchRanking ? h("li", {}, "지점 순위의 '몇 % 싸요'는 같은 옵션을 파는 지점들의 중간 가격 대비 평균(기하평균)이에요.") : null,
        h("li", {}, "할인율은 병원이 직접 적은 정가가 있을 때만 보여요."),
        h("li", {}, "가격 동향·변동은 매주 실제로 모은 기록만 써요. 빈 주를 채우지 않아요.")),
      h("h3", { style: "margin-top:16px" }, "부가세"),
      h("div", { class: "sub", style: "margin-top:4px" }, vatNote()),
      h("ul", { class: "list" }, Object.entries(A.vat || {}).map(([b, v]) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, b), h("span", { class: "sub" }, v.default === "excl" ? "별도" : v.default === "incl" ? "포함" : "-"),
        h("span", { class: "m" }, `“${v.evidence}” (${v.checked} 확인)`, v.url ? h("a", { class: "linkbtn src", href: v.url, target: "_blank", rel: "noopener noreferrer" }, "원문") : null))))),
      h("h3", { style: "margin-top:16px" }, "어디서 어떻게 모으나요"),
      h("div", { class: "sub", style: "margin-top:4px" }, `각 병원 사이트의 공개 페이지만 읽어요. 로그인·차단 우회는 하지 않고, 수집 전에 robots.txt를 확인해요${src.checked_at ? ` (마지막 확인 ${src.checked_at.slice(0, 10)})` : ""}.`),
      h("ul", { class: "list" }, D.meta.brands.map((b, i) => { const s = (src.brands || {})[b[0]]; if (!BR.some((x) => x.brand === i)) return null;
        return h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "dot bdot", style: `background:${b[1]}` }), b[0]),
          h("span", { class: "sub" }, s ? (s.allowed ? "robots.txt 허용" : "robots.txt 막힘") : "-"),
          h("span", { class: "m" }, b[2], s && s.crawl_delay ? ` · 사이트가 요청 간격 ${s.crawl_delay}초를 요구해서 지점마다 주 1회 한 페이지만 읽어요` : "", s && s.rate ? ` · ${s.rate}` : ""))); })),
      h("h3", { style: "margin-top:16px" }, "자동으로 정리한 것"),
      h("ul", { class: "list" }, Object.entries(A.issues || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, k), h("span", { class: "sub num" }, `${n}줄`))))),
      h("div", { class: "sub", style: "margin-top:12px" }, `기준일 ${D.meta.updated} · 가격 ${D.meta.rows.toLocaleString()}개 · ${branchCountText()}. 지도 © OpenStreetMap 기여자.`)));
    return box;
  };

  // 비교 tab sub-navigation: 시술별 / 지점 순위 / 지점 비교 / 전체 가격표
  const cmpNav = (cur) => h("div", { class: FLAGS.branchRanking ? "seg seg4" : "seg", role: "tablist" }, [["compare", "시술별"], FLAGS.branchRanking ? ["rank", "지점 순위"] : null, ["versus", "지점 비교"], ["table", "전체 가격표"]].filter(Boolean).map(([v, l]) =>
    h("button", { type: "button", role: "tab", "aria-selected": cur === v ? "true" : "false", onclick: () => nav(v) }, l)));
  // the chosen procedure lives in the URL (#compare?k=X12): change both, or the old ?k= wins on the next render
  function pickKey(i) { st.key = i; history.replaceState(null, "", `#compare?k=${KEYS[i].id}`); render(); }
  // how the compare numbers are computed, with the real counts of this view
  function basisSheet(k, rk, plain) {
    const ps = rk.map((x) => x.p), med = median(ps);
    sheet("가격 계산 기준", () => h("div", {}, h("dl", { class: "facts" },
      h("div", { class: "fact" }, h("dt", {}, "같은 시술"), h("dd", {}, `'${k.label}' — 용량·샷 수·회차·세부 구분(원산지·부위 등)이 같은 가격만 묶었어요. 다른 시술과 묶인 패키지와 추가 옵션은 빠져요.`)),
      h("div", { class: "fact" }, h("dt", {}, "비교한 지점"), h("dd", {}, `${regionName()} ${rk.length}곳 · 지점마다 가장 싼 가격 하나씩${st.special ? " (체험가·한정가 등 특가 포함)" : " (일반가만)"}`)),
      h("div", { class: "fact" }, h("dt", {}, "중간값"), h("dd", {}, plain.length
        ? `${won(median(plain.map((x) => x.p)))} — 조건 없는 가격 ${plain.length}곳의 지점별 최저가를 줄 세웠을 때 가운데 값이에요(위에 보이는 값). 특가까지 넣으면 ${rk.length}곳 중간값 ${won(med)}이에요.`
        : `${won(med)} — ${rk.length}곳의 지점별 최저가(조건부 가격 포함)를 줄 세웠을 때 가운데 값이에요.`, " '중간보다 N% 싸요'는 (중간값 − 가격) ÷ 중간값이에요.")),
      h("div", { class: "fact" }, h("dt", {}, "조건 없는 최저가"), h("dd", {}, `${plain.length}곳 — 특가·첫 방문·시간 조건이 없고, 이번 주 확인된 지점의 가격만이에요.`)),
      h("div", { class: "fact" }, h("dt", {}, "빼는 가격"), h("dd", {}, "기간이 끝난 이벤트, 지난 수집보다 급변해 확인 중인 가격, 고른 방문일에 안 되는 가격은 모든 계산에서 빼요. 수집에 실패한 지점은 '조건 없는 최저가'에서 빼요.")),
      h("div", { class: "fact" }, h("dt", {}, "초저가 표시"), h("dd", {}, `중간값의 ${Math.round(LOW_SHARE * 100)}% 이하인 가격에 '초저가·조건 확인'을 붙여요. 조건 문구가 없어도 이런 가격을 1~2곳만 내고 있으면 원본을 확인하기 전까지 '조건 없는 최저가'로 쓰지 않고 '확인 필요'로 따로 보여줘요(여러 지점이 같은 값이면 그 체인의 보통 가격으로 봐요). ⓘ를 누르면 조건·부가세·원본을 볼 수 있어요.`)))));
  }
  // ---------------- families and plain-language notes (시술 사전)
  const CMP_CATS = ["톡신", "윤곽·필러", "리프팅", "부스터", "피부", "제모·바디", "패키지", "기타"];
  const CAT_START = { "톡신": "X01", "윤곽·필러": "X09", "리프팅": "X12", "부스터": "X24", "피부": "X28", "제모·바디": "X35" };
  const famsIn = (c) => FAM.filter((f) => f.cat === c).sort((a, b) => b.n - a.n);
  const famNorm = (f) => f.norm || (f.norm = Search.norm(`${f.name} ${f.cat} ${f.vs.map((v) => v.label).join(" ")} ${KEYS[f.main].label}`));
  const famFind = (text) => { const c = text.trim() ? Search.compile(text, searchIndex()) : null; return c && !c.empty ? FAM.filter((f) => c.test(famNorm(f))).sort((a, b) => b.n - a.n) : []; };
  // only medically reviewed text is 'verified'; drafts are shown (labelled) only while flags.showDraftKnowledge is on
  const KB_STATE = () => (FLAGS.showDraftKnowledge ? "설명은 의료진 검수 전 초안이에요." : "의료진 검수를 마친 설명만 보여줘요.");
  const kbVisible = (e) => !!e && ((e.review || {}).status === "approved" || FLAGS.showDraftKnowledge);
  const kbOf = (f) => { const e = (f && (kbByFam.get(f.name) || kbByFid.get(f.fid))) || null; return kbVisible(e) ? e : null; };
  const famByName = (n) => FAM.find((f) => f.name === n);
  const MAIN_TYPES = { toxin: ["주름 보톡스", "사각턱 보톡스", "스킨보톡스", "다한증 보톡스", "바디 보톡스"], filler: ["코 필러", "턱끝 필러", "애교 필러", "눈밑 필러", "입술 필러"],
    lifting: ["슈링크 유니버스", "울쎄라", "써마지 FLX", "인모드", "올리지오"], toning: ["레이저토닝", "피코토닝", "제네시스", "착색토닝"] };
  const DISCLAIM = "일반적인 설명이에요. 진단이나 효과 보장이 아니고 특정 시술을 권하지 않아요. 나에게 맞는지는 의료진과 상담하세요.";
  const KB_REPO = "https://github.com/lsy2825/skin";
  const reviewBadge = (e) => { const r = e.review || {}; const t = (KB.statuses || {})[r.status] || r.status;
    return h("span", { class: `k ${r.status === "approved" ? "k1" : "kx"}`, title: r.status === "approved" ? `${r.reviewer} · ${r.reviewed_at}` : "의료진이 아직 확인하지 않은 초안이에요" }, r.status === "approved" ? `✓ ${t}` : t); };
  const evidenceBadge = (e) => h("span", { class: `k ${e.sources.length ? "k4" : "kx"}`, title: "근거 문서의 종류예요(효과의 크기를 뜻하지 않아요)" },
    e.sources.length ? `근거: ${(KB.evidence_levels || {})[e.evidence_level] || "출처"} ${e.sources.length}개` : "근거 자료 미정리");
  // short card on the compare tab: one line + purpose + how it differs, review state, quick view
  // compact: on top of the compare screen right under the picker — the one-liner shows, the rest folds
  function guideBox(f, compact = false) {
    const e = kbOf(f);
    if (!e && !f.desc.length) return null;
    if (compact) return h("div", { class: "guide gtop" },
      h("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, h("b", {}, `${f.name}, 뭐예요?`), h("span", { class: "sp" }),
        e ? h("button", { class: "linkbtn", type: "button", onclick: () => kbSheet(e, f) }, "자세히") : null),
      e ? h("p", {}, `${e.one_liner} ${e.purpose}`) : h("p", { class: "sub" }, `병원 설명: ${f.desc.join(" · ")}`),
      e && (e.method || f.desc.length) ? h("details", { class: "fold small" }, h("summary", {}, "더 보기 · 방식·병원 설명·검수 상태"),
        e.method ? h("p", { class: "sub" }, e.method) : null,
        f.desc.length ? h("p", { class: "sub" }, `병원 설명: ${f.desc.join(" · ")}`) : null,
        h("div", { class: "row", style: "gap:4px;margin-top:6px" }, reviewBadge(e), evidenceBadge(e)),
        h("button", { class: "linkbtn", type: "button", style: "margin-top:6px", onclick: () => nav(`guide?c=${encodeURIComponent(f.cat)}`) }, "시술 사전", icon("chevron-right", "xs"))) : null,
      h("p", { class: "tiny" }, e ? DISCLAIM : "병원이 상품 이름에 적은 설명이에요."));
    return h("div", { class: "guide" },
      h("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, h("b", {}, `${f.name}, 뭐예요?`), h("span", { class: "sp" }),
        e ? h("button", { class: "linkbtn", type: "button", onclick: () => kbSheet(e, f) }, "자세히") : null,
        h("button", { class: "linkbtn", type: "button", onclick: () => nav(`guide?c=${encodeURIComponent(f.cat)}`) }, "시술 사전", icon("chevron-right", "xs"))),
      e ? h("p", {}, `${e.one_liner} ${e.purpose}`) : null,
      e && e.method ? h("p", { class: "sub" }, e.method) : null,
      f.desc.length ? h("p", { class: "sub" }, `병원 설명: ${f.desc.join(" · ")}`) : null,
      e ? h("div", { class: "row", style: "gap:4px;margin-top:6px" }, reviewBadge(e), evidenceBadge(e)) : null,
      h("p", { class: "tiny" }, e ? DISCLAIM : "병원이 상품 이름에 적은 설명이에요."));
  }
  // what to check together with a price (docs/OBJECTIVE_DISPLAY_POLICY.md): the exact condition, genuine-product claims
  // (only what clinics wrote — the app does not verify devices or drugs), who treats (not collected), side effects, cautions
  // list row → the same clinic's dot in the distribution chart (and the chart's slider marks the row, see distChart)
  const dotHl = (b) => document.querySelectorAll(".lcsvg circle.dot").forEach((c) => c.classList.toggle("hl", b != null && +c.getAttribute("data-b") === b));
  function checkCard(k, fam, rk) {
    const e = fam ? kbOf(fam.f) : null;
    const genuine = rk.filter((x) => /정품/.test(S[ROWS[x.i][2]])).length;
    const row = (ic, t, ...v) => h("div", { class: "chk" }, h("span", { class: "chk-ic", "aria-hidden": "true" }, icon(ic, "sm")), h("div", { class: "chk-b" }, h("b", {}, t), h("div", { class: "sub" }, ...v)));
    return h("section", { class: "card checks", "aria-label": "가격과 함께 확인할 것" },
      h("div", { class: "row" }, h("h3", {}, "가격과 함께 꼭 확인하세요"), h("span", { class: "sp" }), e ? reviewBadge(e) : null),
      h("div", { class: "chks" },
        row("layers", "시술 조건", `${k.label} · 1회 가격 · ${st.vat === "incl" ? "부가세 포함 예상가" : "병원 표시가"}. 용량·샷 수·회차·세부 구분이 같은 가격만 묶었어요. 지점마다 상품 구성은 '가격 근거'에서 봐요.`),
        row("badge-check", "장비·약제 정품 여부", genuine ? `${rk.length}곳 중 ${genuine}곳이 상품명에 '정품'이라고 적었어요. 병원이 적은 것이고 앱이 확인한 것은 아니에요. 나머지는 표기가 없어요.`
          : "병원 상품명에 정품 표기가 없어요. 앱은 장비·약제의 정품 여부를 확인하지 않아요. 상담 때 확인하세요."),
        row("user", "시술 의료진", "앱은 의료진 이름·전공·자격 정보를 모으지 않아요. 누가 시술하는지 병원에 확인하세요."),
        row("triangle-alert", "주요 부작용", e && e.side_effects.length ? h("ul", { class: "plain" }, e.side_effects.slice(0, 4).map((x) => h("li", {}, x))) : "정리된 설명이 아직 없어요. 상담 때 꼭 물어보세요."),
        e && e.cautions.length ? row("info", "주의사항", h("ul", { class: "plain" }, e.cautions.slice(0, 3).map((x) => h("li", {}, x)))) : null),
      e ? h("button", { class: "linkbtn", type: "button", style: "margin-top:12px", onclick: () => kbSheet(e, fam.f) }, "부작용·주의사항·근거 자세히", icon("chevron-right", "xs")) : null,
      h("p", { class: "tiny" }, `${e ? `${DISCLAIM} ${KB_STATE()} ` : ""}가격이 낮다는 것만으로 고르지 마세요. 조건·의료진·부작용 설명을 함께 비교하세요.`));
  }
  // quick view: everything the knowledge base has for one treatment
  function kbSheet(e, f) {
    f = f || FAM.find((x) => kbOf(x) === e);
    const sec = (t, body) => body && (!Array.isArray(body) || body.length) ? h("div", { class: "fact" }, h("dt", {}, t), h("dd", {}, Array.isArray(body) ? h("ul", { class: "warns" }, body.map((x) => h("li", {}, x))) : body)) : null;
    const issue = `${KB_REPO}/issues/new?${new URLSearchParams({ template: "knowledge-review.md", title: `[검수] ${e.id} ${e.title}`, labels: "knowledge-review", body: `항목 id: ${e.id}\n\n고칠 내용:\n\n근거:\n` })}`;
    sheet(e.title, (close) => h("div", {},
      h("div", { class: "row", style: "gap:4px" }, reviewBadge(e), evidenceBadge(e), e.updated ? h("span", { class: "sub" }, `수정 ${e.updated}`) : null),
      h("p", { style: "margin:10px 0 0;font-weight:700;line-height:1.5" }, e.one_liner),
      h("dl", { class: "facts" },
        sec("주로 받는 이유", e.purpose), sec("사용 부위", e.areas), sec("시술 방식·비슷한 시술과 차이", e.method), sec("관련 브랜드·종류", e.kinds),
        sec("주요 부작용", e.side_effects), sec("주의사항", e.cautions),
        h("div", { class: "fact" }, h("dt", {}, "근거와 검수"), h("dd", {},
          e.sources.length ? h("ul", { class: "warns" }, e.sources.map((x) => h("li", {}, h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.title), ` — ${x.publisher} · ${x.checked} 확인 (${x.how})`))) : null,
          h("p", { class: "sub", style: "margin:6px 0 0" }, e.evidence_note || ""),
          h("p", { class: "sub", style: "margin:6px 0 0" }, e.review.status === "approved" ? `검수: ${e.review.reviewer} · ${e.review.reviewed_at}` : "의료진 검수 전 초안이에요. 틀린 곳이 있으면 알려 주세요.")))),
      h("p", { class: "tiny" }, DISCLAIM),
      h("div", { class: "row", style: "margin-top:12px;gap:8px" },
        f ? h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => { close(); nav(`compare?k=${KEYS[f.main].id}`); } }, `${f.name} 가격 비교`) : null,
        h("a", { class: "btn gray", href: issue, target: "_blank", rel: "noopener", style: "text-decoration:none" }, "검수 의견 보내기"))));
  }
  // type a name → matching families anywhere (all categories)
  function famFinder() {
    const inp = h("input", { type: "search", class: "field", placeholder: "다른 시술 찾기 (예: 리쥬란, 겨드랑이 제모)", "aria-label": "비교할 시술 찾기", style: "margin-top:10px" });
    const out = h("div", { class: "chips wrapc", style: "margin-top:6px" });
    let tm = 0;
    inp.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => { const r = famFind(inp.value);
      fill(out, inp.value.trim() && !r.length ? h("span", { class: "sub" }, "맞는 시술이 없어요. 짧게 써 보세요.") : null,
        r.slice(0, 12).map((f) => h("button", { class: "chip", type: "button", onclick: () => pickKey(f.main) }, `${f.name} · ${f.n}곳`))); }, 120); });
    return h("div", {}, inp, out);
  }
  const UNIT_RX = /(^|\s)(\d+(?:\.\d+)?(?:U|cc|ml|샷|KJ|부위|개|줄|시린지|vial|분|mm)|\d+회)(?=\s|$)/g;
  // variants grouped by kind ('힐러', 'HB 플러스' …), one chip per amount
  function variantGroups(vs) {
    const groups = new Map();
    for (const v of vs) {
      const amt = (v.label.match(UNIT_RX) || []).map((x) => x.trim()).join(" ");
      const g = v.label.replace(UNIT_RX, " ").replace(/\s+/g, " ").trim() || "기본";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ v, amt: amt || "1회" });
    }
    return [...groups];
  }
  // a variant label as its three choices: kind (제품·종류 words), amount (용량·부위·샷), sessions ('리쥬란 힐러 2cc 3회' →
  // 힐러 · 2cc · 3회). Only what the label says; a label without an amount is '표기 없음', without a count is 1회
  function variantParts(label) {
    const m = /(?:^|\s)(\d+)회$/.exec(label), sess = m ? +m[1] : 1;
    const rest = m ? label.slice(0, m.index) : label;
    const amt = (rest.match(UNIT_RX) || []).map((x) => x.trim()).filter((x) => !/회$/.test(x)).join(" ");
    const kind = rest.replace(UNIT_RX, " ").replace(/\s+/g, " ").trim() || "기본";
    return { kind, amt: amt || "표기 없음", sess };
  }
  function specSteps(f, cur) {
    const vs = f.vs.map((v) => ({ v, ...variantParts(v.label) }));
    const me = vs.find((x) => x.v.k === cur) || vs[0];
    const pick = (want) => {
      const score = (x) => (x.kind === want.kind ? 4 : 0) + (x.amt === want.amt ? 2 : 0) + (x.sess === want.sess ? 1 : 0) + (x.sess === 1 ? 0.5 : 0);
      const ok = vs.filter((x) => (want.fix || []).every((k) => x[k] === want[k]));
      const best = (ok.length ? ok : vs).reduce((a, x) => (score(x) > score(a) || (score(x) === score(a) && byKB[x.v.k].size > byKB[a.v.k].size) ? x : a));
      track("option_step", { k: KEYS[best.v.k].id });
      pickKey(best.v.k);
    };
    const uniq = (xs) => [...new Set(xs)];
    const step = (n, title, vals, cur, show, onPick) => vals.length < 2 ? null : h("div", { class: "vstep" },
      h("span", { class: "vg" }, h("b", { class: "stepn" }, n), title),
      h("div", { class: "vchips scroll", role: "radiogroup", "aria-label": title }, vals.map((v) => h("button", { class: "vchip", type: "button", role: "radio", "aria-checked": v === cur ? "true" : "false",
        onclick: () => onPick(v) }, h("b", {}, show(v))))));
    const kinds = uniq(vs.map((x) => x.kind));
    const inKind = vs.filter((x) => x.kind === me.kind), amts = uniq(inKind.map((x) => x.amt));
    const inAmt = inKind.filter((x) => x.amt === me.amt), sesss = uniq(inAmt.map((x) => x.sess)).sort((a, b) => a - b);
    let n = 0;
    const s1 = step(kinds.length > 1 ? ++n : n, "종류", kinds, me.kind, (v) => v, (v) => pick({ ...me, kind: v, fix: ["kind"] }));
    const s2 = step(amts.length > 1 ? ++n : n, "용량·부위", amts, me.amt, (v) => v, (v) => pick({ ...me, amt: v, fix: ["kind", "amt"] }));
    const s3 = step(sesss.length > 1 ? ++n : n, "횟수", sesss, me.sess, (v) => (v === 1 ? "1회" : `${v}회 묶음`), (v) => pick({ ...me, sess: v, fix: ["kind", "amt", "sess"] }));
    return h("div", { class: "vsteps" }, s1, s2, s3, !s1 && !s2 && !s3 ? h("div", { class: "sub" }, "고를 옵션이 하나뿐이에요.") : null,
      h("p", { class: "tiny", style: "margin:6px 0 0" }, `지금 비교: ${KEYS[cur].label} · ${byKB[cur].size}곳`));
  }
  function variantRows(groups, cur, scroll) {
    return h("div", { class: "vrows" }, groups.map(([g, xs]) => h("div", { class: "vrow" }, h("span", { class: "vg" }, g),
      h("div", { class: scroll ? "vchips scroll" : "vchips" }, xs.map(({ v, amt }) => { const rr = ranking(v.k, "price");
        return h("button", { class: "vchip", type: "button", "aria-pressed": v.k === cur ? "true" : "false", "aria-label": `${g} ${amt}${rr.length ? ` 최저 ${won(rr[0].p)}` : ""}`,
          onclick: () => pickKey(v.k) }, h("b", {}, amt), h("span", { class: "num" }, rr.length ? won(rr[0].p) : "없음")); })))));
  }
  views.guide = (arg, params) => {
    const box = h("div", { class: "view" });
    const c = params.get("c") || "";
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
    const q = h("input", { type: "search", class: "field", placeholder: "시술 이름으로 찾기 (예: 보톡스)", "aria-label": "시술 사전에서 찾기", value: params.get("q") || "" });
    const list = h("div", {});
    box.append(h("div", { class: "card" }, h("h2", {}, "시술 사전"),
      jprefs().freq === "often" ? jomiSay("explaining", jline("guideTip") || "이름이 비슷한 시술을 쉽게 정리했어요.") : null,
      h("div", { class: "sub" }, "이름이 비슷해서 헷갈리는 시술을 쉽게 정리했어요. '가격 비교'를 누르면 지점별 가격을 봐요."),
      h("div", { class: "chips", style: "margin-top:10px" }, ["", ...CMP_CATS].map((x) => h("button", { class: "chip", type: "button", "aria-pressed": x === c ? "true" : "false",
        onclick: () => nav(x ? `guide?c=${encodeURIComponent(x)}` : "guide", true) }, x || "전체"))),
      h("div", { style: "margin-top:10px" }, q), list));
    const entry = (f, members) => { const e = kbOf(f);
      return h("div", { class: "gitem" },
        h("div", { class: "row", style: "flex-wrap:nowrap;gap:8px" }, h("b", { style: "flex:1;min-width:0" }, members ? `${e ? e.title : f.name} · ${members.length}가지` : f.name),
          h("span", { class: "sub", style: "flex:none" }, `${members ? new Set(members.flatMap((m) => m.vs.flatMap((v) => [...byKB[v.k].keys()]))).size : f.n}곳`),
          members ? null : h("button", { class: "btn sm soft", type: "button", style: "flex:none", onclick: () => nav(`compare?k=${KEYS[f.main].id}`) }, "가격 비교")),
        e ? h("p", {}, `${e.one_liner} ${e.purpose}`) : null, e && e.method ? h("p", { class: "sub" }, e.method) : null,
        f.desc.length ? h("p", { class: "sub" }, `병원 설명: ${f.desc.join(" · ")}`) : null,
        e ? h("div", { class: "row", style: "gap:4px;margin-top:6px" }, reviewBadge(e), evidenceBadge(e), h("button", { class: "linkbtn", type: "button", onclick: () => kbSheet(e, members ? null : f) }, "부작용·주의사항·근거 보기")) : null,
        members ? h("div", { class: "chips wrapc", style: "margin-top:8px" }, members.map((m) => h("button", { class: "chip", type: "button", onclick: () => nav(`compare?k=${KEYS[m.main].id}`) }, m.name))) : null);
    };
    const paint = () => {
      let fams = q.value.trim() ? famFind(q.value) : FAM.slice().sort((a, b) => CMP_CATS.indexOf(a.cat) - CMP_CATS.indexOf(b.cat) || b.n - a.n);
      if (c) fams = fams.filter((f) => f.cat === c);
      // many families that share one note (제모: one per body area) → one entry with the areas as chips
      const byFid = new Map();
      for (const f of fams) if (!kbByFam.has(f.name) && kbByFid.has(f.fid)) byFid.set(f.fid, [...(byFid.get(f.fid) || []), f]);
      const done = new Set(), out = [];
      for (const f of fams) {
        const grp = byFid.get(f.fid);
        if (grp && grp.length > 6) { if (!done.has(f.fid)) { done.add(f.fid); out.push(entry(f, grp)); } continue; }
        out.push(entry(f));
      }
      fill(list, out.length ? out : h("div", { class: "empty" }, "맞는 시술이 없어요."), h("p", { class: "tiny", style: "margin-top:12px" }, DISCLAIM + " 설명이 없는 시술은 병원이 상품 이름에 적은 설명만 보여줘요. " + KB_STATE()));
    };
    let tm = 0;
    q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(paint, 150); });
    paint();
    return box;
  };
  // ---------------- 피부 고민으로 찾기 (app/domain/concern.js + knowledge/concerns.json), on this phone only
  // The typed words live in memory (concernText) for this visit: never in the URL, localStorage, recent searches or any
  // request. Every medical sentence on the page comes from the knowledge files; the page itself adds headings only.
  // It never diagnoses, judges suitability, decides doses, ranks treatments or names a clinic.
  const concernOf = (id) => CONC.concerns.find((c) => c.id === id);
  const concernVisible = (c) => !!c && ((c.review || {}).status === "approved" || FLAGS.showDraftKnowledge);
  const kbById = (id) => { const e = KB.entries.find((x) => x.id === id); return kbVisible(e) ? e : null; };
  const famsOfEntry = (e) => FAM.filter((f) => kbOf(f) === e).sort((a, b) => b.n - a.n);
  const draftTag = (o) => { const r = o.review || {}; return h("span", { class: `k ${r.status === "approved" ? "k1" : "kx"}` }, r.status === "approved" ? `의료진 검수 ${r.reviewed_at}` : (KB.statuses || {}).draft || "초안 · 전문가 검수 전"); };
  function concernCard(c, m) {
    const es = c.treatments.map(kbById).filter(Boolean);
    const sec = (n, t, ...kids) => h("section", { class: "csec" }, h("h4", {}, `${n}. ${t}`), ...kids);
    return h("div", { class: "card concern" },
      h("div", { class: "row", style: "gap:6px" }, h("h3", { style: "margin:0" }, c.name), h("span", { class: "sp" }), draftTag(c)),
      m.hits && m.hits.length ? h("div", { class: "sub" }, `적은 말에서 찾은 낱말: ${m.hits.join(", ")}`) : null,
      sec(1, "고민에 대한 일반적인 설명", h("p", {}, c.general)),
      sec(2, "관련 시술과 시술 말고 할 수 있는 관리",
        h("div", { class: "flabel" }, "시술 말고 할 수 있는 관리"), h("ul", { class: "warns" }, c.non_procedural.map((x) => h("li", {}, x))),
        h("div", { class: "flabel", style: "margin-top:8px" }, "관련 시술"),
        h("div", { class: "sub" }, es.length ? es.map((e) => e.title).join(" · ") : "보여드릴 수 있는 시술 설명이 아직 없어요(검수 전)."),
        h("p", { class: "tiny" }, "순서는 분류표에 적힌 순서예요. 추천 순위나 효과 순위가 아니에요.")),
      es.length ? sec(3, "시술별 목적과 차이", h("div", { class: "ttable", role: "table", "aria-label": `${c.name} 관련 시술 비교` },
        h("div", { class: "tr th", role: "row" }, h("span", { role: "columnheader" }, "시술"), h("span", { role: "columnheader" }, "주로 받는 이유"), h("span", { role: "columnheader" }, "방식·비슷한 시술과 차이")),
        es.map((e) => h("div", { class: "tr", role: "row" }, h("span", { role: "cell" }, h("b", {}, e.title)), h("span", { role: "cell" }, e.purpose), h("span", { role: "cell" }, e.method || e.one_liner))))) : null,
      es.length ? sec(4, "확인해야 할 위험과 한계", es.map((e) => h("div", { class: "crisk" },
        h("div", { class: "row", style: "gap:4px" }, h("b", {}, e.title), h("span", { class: "sp" }), reviewBadge(e), evidenceBadge(e)),
        e.side_effects.length ? h("div", { class: "sub" }, "주요 부작용: " + e.side_effects.slice(0, 3).join(" / ")) : null,
        e.limitations.length ? h("div", { class: "sub" }, "한계: " + e.limitations.join(" / ")) : h("div", { class: "sub" }, "한계: 정리 안 됨"),
        e.cautions.length ? h("div", { class: "sub" }, "주의: " + e.cautions.slice(0, 2).join(" / ")) : null))) : null,
      es.length ? sec(5, "관련 시술 자세히 보기", h("div", { class: "chips wrapc" },
        es.map((e) => h("button", { class: "chip", type: "button", onclick: () => kbSheet(e, famsOfEntry(e)[0] || null) }, icon("info", "sm"), e.title)))) : null,
      es.length && FLAGS.concernPriceLink ? sec(6, "직접 골라서 가격 비교하기",
        h("div", { class: "chips wrapc" }, es.flatMap((e) => famsOfEntry(e).slice(0, 4).map((f) =>
          h("button", { class: "chip", type: "button", onclick: () => nav(`compare?k=${KEYS[f.main].id}`) }, `${f.name} 가격`, icon("chevron-right", "sm"))))),
        h("p", { class: "tiny" }, "가격 비교는 이 고민 정보와 따로 계산해요. 같은 조건(용량·회차)끼리 싼 순으로 보여주고, 광고·협찬으로 순서가 바뀌지 않으며 특정 병원을 추천하지 않아요. 예약·결제·개인정보 전달 기능은 없어요.")) : null,
      h("div", { class: "csrc" },
        h("div", { class: "tiny" }, "고민 설명 근거: ", c.sources.length ? c.sources.flatMap((x, i) => [i ? ", " : "", h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.publisher)]) : "근거 자료 미정리"),
        h("p", { class: "tiny" }, "설명은 미리 정리해 둔 문장만 보여줘요(앱이 새로 지어낸 의학 문장은 없어요). 지금은 모두 의료진 검수 전 초안이에요. " + DISCLAIM)));
  }
  // chat-style layout for an information service: the guide's 'messages' are the knowledge files' own sentences,
  // the user's words stay in memory (this visit, this tab) and are shown back only on this screen
  const mascotImg = (size, expr = "curious") => jomiImg(expr, "face", size);
  views.concern = (arg, params) => {
    const box = h("div", { class: "view" });
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
    if (!FLAGS.concernSearch) { box.append(h("div", { class: "card empty" }, "피부 고민으로 찾기는 지금 꺼져 있어요.")); return box; }
    const picked = params.get("c");   // a concern id from a chip or the search page — never the typed words
    const ta = h("textarea", { rows: "1", maxlength: String(Concern.MAX_LEN), placeholder: "예: 이마랑 미간 주름이 신경 쓰여요", "aria-label": "피부 고민 적기" });
    ta.value = concernText;
    const grow = () => { ta.style.height = "auto"; ta.style.height = `${Math.min(132, ta.scrollHeight)}px`; };
    ta.addEventListener("input", grow);
    const thread = h("div", { class: "chat", "aria-live": "polite" });
    const out = h("div", { class: "cout answers" });
    const visible = CONC.concerns.filter(concernVisible);
    const intro = h("div", { class: "msg bot" }, mascotImg(32), h("div", { class: "bub" },
      h("p", {}, J.lines.concernAsk || "어떤 점이 신경 쓰이는지 편하게 적어 주세요."),
      h("p", { class: "tiny" }, "진단이나 상담이 아니고, 어떤 시술이 맞는지 정하거나 권하지 않아요. 생성형 AI가 아니라 낱말 사전으로 분류하고, 의학 설명은 지식 파일의 문장만 보여줘요."),
      visible.length ? h("div", { style: "margin-top:12px" }, h("div", { class: "eyebrow", style: "margin-bottom:8px" }, "고민 고르기"),
        h("div", { class: "chips wrapc" }, visible.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": picked === c.id ? "true" : "false", onclick: () => nav(`concern?c=${c.id}`, true) }, c.name)))) : null));
    const paint = (r, said) => {
      const me = said ? h("div", { class: "msg user" }, h("div", { class: "bub" }, said)) : null;
      if (r.empty) { fill(thread, intro); return; }
      let face = "thinking";   // 생각하는 죠미 while she shows what she found; 시무룩 when nothing matched
      const parts = r.safety.map((x) => h("div", { class: `card ${x.level === "emergency" ? "calert" : "cwarn"}`, role: "alert" },
        h("h3", {}, icon("triangle-alert", "sm"), x.title), h("p", {}, x.message)));
      // a warning sign of an emergency: the clinician comes first, so no treatment information at all
      if (!r.safety.some((x) => x.level === "emergency")) {
        if (r.personal) parts.push(h("div", { class: "card note" }, h("b", {}, "개인 맞춤 판단은 하지 않아요"), h("p", { style: "margin:4px 0 0" }, CONC.safety.personal.message)));
        if (r.clipped) parts.push(h("div", { class: "note" }, `앞 ${Concern.MAX_LEN}자만 분류했어요.`));
        const cs = r.matches.map((m) => [concernOf(m.id), m]).filter(([c]) => concernVisible(c));
        if (!cs.length) face = "empty";
        if (!cs.length) parts.push(h("div", { class: "card" }, h("h3", {}, "어떤 고민인지 찾지 못했어요"),
          h("p", { class: "sub" }, "'고민 고르기'에서 골라 보거나 낱말을 바꿔 적어 보세요(예: 주름, 기미, 여드름, 땀). 증상이 걱정되면 피부과 진료를 받아 보세요.")));
        if (cs.length > 1) parts.push(h("div", { class: "sub", style: "margin:0 4px" }, `적은 말과 관련된 고민 ${cs.length}가지예요(찾은 낱말이 많은 순).`));
        if (cs.length) parts.push(h("p", { class: "jomi-line" }, J.lines.concernFound || ""));
        for (const [c, m] of cs) parts.push(concernCard(c, m));
      }
      fill(out, parts);
      fill(thread, intro, me, h("div", { class: "msg bot" }, mascotImg(32, face), out));
    };
    const run = () => { concernText = ta.value; paint(Concern.classify(concernText, CONC), concernText.trim() || null); };
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); run(); } });
    box.append(h("div", { class: "cg-head", style: "padding:0 4px" }, mascotImg(44), h("div", { style: "min-width:0" }, h("h2", {}, "피부 고민 가이드"),
      h("span", { class: "infotag" }, icon("info", "xs"), "정보 안내 서비스 · 진단·의료 상담 아님"))));
    box.append(thread);
    box.append(h("div", { class: "composer" }, h("div", { class: "crow" }, ta, h("button", { class: "btn send", type: "button", onclick: run }, icon("send", "sm"), "찾기")),
      h("div", { class: "meta" }, icon("lock", "xs"), `저장·전송하지 않아요 · 주소와 검색 기록에도 남지 않아요 · ${Concern.MAX_LEN}자까지`)));
    if (picked && concernOf(picked)) paint({ safety: [], personal: false, matches: [{ id: picked, hits: [] }] }, concernOf(picked).name);
    else if (concernText.trim()) paint(Concern.classify(concernText, CONC), concernText);
    else paint({ empty: true });
    setTimeout(grow, 0);
    return box;
  };
  let lastHero = null;   // {k, p}: the headline price animates when a setting changes it for the same treatment
  // ---- brand overview for one comparison key (same dose · sessions · origin): rk = ranking(k) rows of the branches in view
  function brandCard(k, per) {
    const HLb = FLAGS.lowestHighlight;
    const list = HLb ? [...per].sort((p, q) => p.xs[0].p - q.xs[0].p) : per;
    return h("div", { class: "card bcard" }, h("div", { class: "row" }, h("h3", {}, HLb ? "브랜드별 최저가" : "브랜드별 비교"), h("span", { class: "sp" }), h("span", { class: "sub" }, `${per.length}개 브랜드`)),
      h("div", { class: "sub" }, `같은 시술(${k.label})만 · 지점마다 가장 싼 가격 하나 · ${regionName()} · ${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"}. 지점 수가 다르면 브랜드끼리 바로 견주기 어려워요.`),
      h("div", { class: "tiles" }, list.map((y, n, arr) => {
        const f0 = y.xs[0], fl = y.xs[y.xs.length - 1], ps = y.xs.map((x) => x.p), cond = y.xs.filter((x) => !plainOk(x.i)).length;
        const last = y.xs.map((x) => verified(x.b)).sort().pop() || "-";
        return h("button", { class: "tile tbtn", type: "button", "aria-haspopup": "dialog", onclick: () => brandSheet(k, y) },
          h("span", { class: "k row", style: "gap:6px" }, h("span", { class: "bdot", style: `background:${D.meta.brands[y.bi][1]}` }), D.meta.brands[y.bi][0], y.xs.length < 3 ? h("span", { class: "k k4" }, "표본 적음") : null),
          HLb ? [h("b", { class: "num" }, won(f0.p)), h("span", { class: "w" }, `${BR[f0.b].name}${n ? ` · +${won(f0.p - arr[0].xs[0].p)}` : " · 브랜드 중 최저"}`)]
            : h("b", { class: "num" }, f0.p === fl.p ? won(f0.p) : `${man(f0.p)}~${man(fl.p)}원`),
          h("span", { class: "w" }, `${y.xs.length}곳 · 중간값 ${won(median(ps))}`),
          h("span", { class: "w" }, `${cond ? `조건부 가격 ${cond}곳 · ` : "모두 조건 없는 가격 · "}확인 ${last}`));
      })),
      h("p", { class: "tiny" }, "카드를 누르면 그 브랜드 지점들의 같은 시술 가격을 모두 볼 수 있어요."));
  }
  function brandSheet(k, y) {
    const name = D.meta.brands[y.bi][0];
    const xs = FLAGS.lowestHighlight ? y.xs : [...y.xs].sort((a, b) => regionCmp(a.b, b.b) || BR[a.b].name.localeCompare(BR[b.b].name, "ko"));
    sheet(`${name} · ${k.label}`, (close) => h("div", {},
      h("div", { class: "sub" }, `${xs.length}곳 · ${regionName()} · 지점마다 가장 싼 가격 하나 · ${FLAGS.lowestHighlight ? "낮은 가격순" : "지역·이름순"}`),
      h("ul", { class: "list", style: "margin-top:6px" }, xs.map((x) => h("li", {}, h("div", { class: "item" },
        h("span", { class: "t row" }, bdot(x.b), bname(x.b)), h("span", { class: "p num" }, won(x.p)),
        h("span", { class: "m" }, S[ROWS[x.i][2]], kindBadge(ROWS[x.i]), h("span", {}, `확인 ${verified(x.b)}`), h("span", { class: "sp" }),
          h("button", { class: "linkbtn", type: "button", onclick: () => { close(); priceSheet(x.i); } }, icon("info", "xs"), "가격 근거"),
          h("button", { class: "linkbtn", type: "button", onclick: () => { close(); nav(`branch/${x.b}`); } }, "지점"))))))));
  }
  // price classes (docs/PRICING_ENGINE_QA.md §2): what kind of price a row is, from the clinic's own kind / tags
  const PCLS = [["regular", "일반가"], ["event", "이벤트가(체험·한정)"], ["cond", "조건부(첫 방문·요일·시간)"], ["posted", "고시가(정가표)"]];
  const priceClass = (r) => r[5] === 4 ? "posted" : r[5] === 1 || r[5] === 2 ? "event" : S[r[6]] ? "cond" : r[5] === 3 ? "pass" : "regular";
  // each class's range over the branches in view (each branch's lowest price of that class), on one shared axis — why a
  // group can span 100원 to 10만원: an event price and a regular price are different things. No clinic is named.
  function priceClassCard(k) {
    const per = new Map(PCLS.map(([c]) => [c, new Map()]));
    for (const [b, ids] of byKB[k]) {
      if (!brandOn(b) || !regionOk(b)) continue;
      for (const i of ids) { if (!live(i)) continue; const c = priceClass(ROWS[i]), m = per.get(c); if (!m) continue; if (!m.has(b) || ROWS[i][3] < m.get(b)) m.set(b, ROWS[i][3]); }
    }
    const rows = PCLS.map(([c, l]) => ({ c, l, v: [...per.get(c).values()].sort((a, b) => a - b) })).filter((x) => x.v.length);
    if (rows.length < 2) return null;
    const lo = Math.min(...rows.map((x) => x.v[0])), hi = Math.max(...rows.map((x) => x.v[x.v.length - 1])), span = hi - lo || 1;
    const pos = (v) => `${((v - lo) / span * 100).toFixed(1)}%`;
    return h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "가격 종류별 범위"), h("span", { class: "sp" }), h("span", { class: "sub" }, `${regionName()} · ${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"}`)),
      h("div", { class: "sub" }, "같은 시술이라도 일반가와 체험가·조건부 가격은 다른 가격이에요. 지점마다 종류별 가장 싼 가격 하나씩, 한 눈금 위에 놓았어요."),
      h("div", { class: "pcls", role: "list" }, rows.map((x) => { const med = median(x.v);
        return h("div", { class: `pcl pcl-${x.c}`, role: "listitem", "aria-label": `${x.l} ${x.v.length}곳, ${won(x.v[0])}부터 ${won(x.v[x.v.length - 1])}까지, 중간값 ${won(med)}` },
          h("div", { class: "row", style: "gap:6px" }, h("b", {}, x.l), h("span", { class: "sp" }), h("span", { class: "tiny num" }, `${x.v.length}곳 · ${x.v[0] === x.v[x.v.length - 1] ? won(x.v[0]) : `${man(x.v[0])}~${man(x.v[x.v.length - 1])}원`}`)),
          h("div", { class: "pcl-track", "aria-hidden": "true" }, h("span", { class: "pcl-bar", style: `left:${pos(x.v[0])};width:max(4px, calc(${pos(x.v[x.v.length - 1])} - ${pos(x.v[0])}))` }), h("span", { class: "pcl-med", style: `left:${pos(med)}` })),
          h("div", { class: "tiny" }, `중간값 ${won(med)}`)); })),
      h("div", { class: "row tiny", style: "margin-top:6px" }, h("span", {}, won(lo)), h("span", { class: "sp" }), h("span", {}, won(hi))));
  }
  // a group whose rows name different products / devices (or some name none): say so above the price, and let the list be
  // narrowed to one (docs/TREATMENT_TAXONOMY.md §4 — e.g. '(여) 겨드랑이 제모 1회' across 아포지 플러스·클라리티Ⅱ·젠틀맥스)
  function mixNote(k) {
    const m = mixFor(k), named = [...m.named.keys()];
    if (!m.mixed && !(named.length && m.none)) return null;
    return h("div", { class: "note mixnote" }, icon("info", "sm"), h("span", {},
      m.mixed ? `제품·장비가 서로 다른 가격이 함께 있어요: ${named.slice(0, 4).join(" · ")}${named.length > 4 ? " …" : ""}${m.none ? " · 표기 없음" : ""}. 제품이 다르면 효과·통증·유지 기간이 다를 수 있어요. 아래 목록에서 제품별로 볼 수 있어요.`
        : `${named[0]}라고 적은 곳과 제품명을 적지 않은 곳이 함께 있어요. 표기 없는 곳은 어떤 제품인지 병원에 확인하세요.`));
  }
  function mixChips(k, redraw) {
    const m = mixFor(k);
    if (!m.mixed && !(m.named.size && m.none)) return null;
    const opts = [...m.branches].sort((a, b) => (a[0] === "") - (b[0] === "") || b[1].size - a[1].size);
    const cur = st.prodK === k ? st.prod : null;
    const set = (p) => { st.prod = p; st.prodK = k; track("prod_filter", { k: KEYS[k].id, p: p == null ? "all" : p || "none" }); redraw(); };
    return h("div", { class: "prodmix" }, h("span", { class: "tiny" }, "제품·장비"),
      h("div", { class: "chips", role: "radiogroup", "aria-label": "제품·장비로 거르기" },
        h("button", { class: "chip", type: "button", role: "radio", "aria-checked": cur == null ? "true" : "false", onclick: () => set(null) }, "전체"),
        opts.map(([p, bs]) => h("button", { class: "chip", type: "button", role: "radio", "aria-checked": cur === p ? "true" : "false", onclick: () => set(p) }, `${p || "표기 없음"} ${bs.size}곳`))));
  }
  let lastCmpK = null;   // compare_view is counted once per treatment, not on every redraw
  views.compare = (arg, params) => {
    const box = h("div", { class: "view" });
    if (params && params.get("k") && KI[params.get("k")] != null) st.key = KI[params.get("k")];
    if (st.key == null) st.key = 0;
    if (KEYS[st.key] && (!params || params.get("k") !== KEYS[st.key].id)) history.replaceState(null, "", `#compare?k=${KEYS[st.key].id}`);
    if (st.key != null && KEYS[st.key]) remember("k", KEYS[st.key].id);
    if (KEYS[st.key] && lastCmpK !== st.key) { lastCmpK = st.key; track("compare_view", { k: KEYS[st.key].id }); }
    box.append(cmpNav("compare"));
    const k = KEYS[st.key];
    const fam = famOf[k.i];
    // category → family (제품군) → variant (용량·부위·횟수). Families are ordered by how many branches sell them.
    const cats = CMP_CATS.filter((c) => FAM.some((f) => f.cat === c));
    box.append(h("div", { class: "chips" }, cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": c === k.cat ? "true" : "false",
      onclick: () => pickKey(KI[CAT_START[c]] ?? famsIn(c)[0].main) }, catIcon(c, "sm"), `${c} ${famsIn(c).length}`))));
    const sel = h("select", { class: "pick", "aria-label": "시술 고르기", onchange: (e) => pickKey(FAM[+e.target.value].main) },
      fam ? null : h("option", { value: "", selected: true }, k.label),
      famsIn(k.cat).map((f) => h("option", { value: f.idx, selected: !!fam && f === fam.f }, `${f.name} · ${f.n}곳`)));
    const rk = ranking(k.i);
    // 1) what is compared: the treatment, its exact spec, the settings that change the numbers
    // round-2 UX02: the treatment picker, then the PRICE, then the options and the explanation — the first screen answers
    // 'how much is it?' instead of opening with a description and three option steps
    const headCard = h("div", { class: "card" }, h("div", { class: "keyhead" }, h("div", { class: "row", style: "flex-wrap:nowrap" }, sel, favBtn("k", k.id, k.label))),
      h("div", { class: "sub", style: "margin-top:6px" }, `지금 고른 규격: ${k.label}`));
    box.append(headCard);
    const card = h("div", { class: "card" });
    card.append(h("h3", { style: "margin:0 0 4px" }, "규격 바꾸기"));
    if (fam) { const gb = guideBox(fam.f, true); if (gb) card.append(h("details", { class: "fold small" }, h("summary", {}, `${fam.f.name}, 뭐예요? (설명 펼치기)`), gb)); }
    if (fam && fam.f.vs.length > 1) {
      // 쉬운 보기 (default): 종류 → 용량·부위 → 횟수, one step at a time. 자세히: every variant, grouped by kind (the earlier view)
      const easy = st.cmpMode !== "detail";
      card.append(h("div", { class: "row", style: "margin-top:14px;gap:8px" }, h("span", { class: "sub", style: "flex:1;min-width:0" }, `${fam.f.name} ${fam.f.vs.length}가지 · 용량·부위·횟수가 같은 것끼리만 비교해요`),
        h("div", { class: "seg modesw", role: "group", "aria-label": "옵션 보기 방식" }, [["easy", "쉬운 보기"], ["detail", "자세히"]].map(([v, l]) =>
          h("button", { type: "button", "aria-pressed": (easy ? "easy" : "detail") === v ? "true" : "false", onclick: () => { st.cmpMode = v; store.set("cmpMode", v); track("option_mode", { v }); render(); } }, l)))));
      if (easy) card.append(specSteps(fam.f, k.i));
      else {
        // the kind being compared as one row of amounts; the other kinds (and packages of several sessions) folded
        const one = fam.f.vs.filter((v) => !/\d+회$/.test(v.label)), many = fam.f.vs.filter((v) => /\d+회$/.test(v.label));
        const gs = [...variantGroups(one), ...variantGroups(many).map(([g, xs]) => [`${g} · 여러 회 묶음`, xs])];
        const curG = gs.find(([, xs]) => xs.some((x) => x.v.k === k.i)), rest = gs.filter((x) => x !== curG);
        if (curG) card.append(variantRows([curG], k.i, true));
        if (rest.length) card.append(h("details", { class: "fold small" }, h("summary", {}, `다른 종류 ${rest.length}가지 · ${rest.slice(0, 3).map(([g]) => g).join(", ")}${rest.length > 3 ? " …" : ""}`), variantRows(rest, k.i)));
      }
    }
    card.append(h("details", { class: "fold small" }, h("summary", {}, icon("search", "sm"), "다른 시술 이름으로 찾기"), famFinder()));
    card.append(h("div", { class: "row", style: "margin-top:16px;gap:10px" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }), h("span", { class: "sp" }), whenChip()),
      h("div", { style: "margin-top:10px" }, brandChips()));
    if (!rk.length) box.append(card);
    if (rk.length) {
      // 2) the price. With flags.lowestHighlight off (default) the summary is the range and the median of the same-condition
      // prices — no clinic is named on top as 'the lowest'; each clinic's price is in the list and the distribution below.
      // With it on: the lowest plain price and its clinic (the earlier headline). Conditional prices are shown apart either way.
      const plain = plainRanking(k.i), { normal, lowp } = splitLow(plain), ptop = normal[0], lowI = new Set(lowp.map((x) => x.i));
      const ctop = [...rk].filter((x) => !lowI.has(x.i)).sort((x, y) => x.p - y.p)[0];
      const top = ptop || ctop || lowp[0];
      // the median is taken over the same set as the headline (plain prices when there are any), so the two never disagree
      const prices = (ptop ? plain : rk).map((x) => x.p).sort((a, b) => a - b), med = median(prices);
      const shown = (ptop ? normal : rk.filter((x) => !lowI.has(x.i))).map((x) => x.p), lo = Math.min(...shown), hi = Math.max(...shown);
      const r0 = ROWS[top.i], HL = FLAGS.lowestHighlight;
      const key = HL ? top.p : `${lo}-${hi}`, tick = lastHero && lastHero.k === k.i && lastHero.p !== key;
      lastHero = { k: k.i, p: key };
      const stat = (l, v, sub) => h("div", {}, h("span", {}, l), h("b", { class: "num" }, v), sub ? h("span", { style: "font-weight:500" }, sub) : null);
      const spread = lo ? hi / lo : 1;
      const pc = h("section", { class: "card pricecard lift", "aria-label": "가격 요약" },
        h("div", { class: "spec" }, h("span", { class: "label" }, k.label), h("span", { class: "k ok" }, icon("check", "xs"), "같은 조건끼리 비교")),
        mixNote(k.i),
        HL ? h("div", { class: "hero" },
          h("span", { class: "hl" }, ptop ? `현재 최저가 · 조건 없는 가격 ${plain.length}곳 중` : `조건이 붙은 가격만 있어요 · ${rk.length}곳`),
          h("span", { class: `hp num${tick ? " tick" : ""}` }, won(top.p)),
          h("span", { class: "hb" }, bdot(top.b), bname(top.b), top.d != null ? h("span", { class: "sub" }, km(top.d)) : null),
          h("div", { class: "meta" }, h("span", {}, S[r0[2]]), kindBadge(r0).slice(0, 3), h("span", {}, listedTxt(r0) || (st.vat === "incl" ? "부가세 포함 예상가" : "병원 표시가")), h("span", {}, `${fresh(top.b).d} 확인`)),
          h("div", { class: "row", style: "gap:16px;margin-top:10px" },
            h("button", { class: "linkbtn", type: "button", onclick: () => priceSheet(top.i) }, icon("info", "xs"), "가격 근거"),
            srcLink(top.i, "병원 원본"),
            h("button", { class: "linkbtn", type: "button", onclick: () => basisSheet(k, rk, plain) }, icon("circle-help", "xs"), "계산 기준")))
        : h("div", { class: "hero" },
          h("span", { class: "hl" }, ptop ? `같은 조건 가격 범위 · 조건 없는 가격 ${shown.length}곳` : `조건이 붙은 가격만 있어요 · ${shown.length}곳`),
          h("span", { class: `hp range num${tick ? " tick" : ""}` }, lo === hi ? h("span", { class: "nw" }, won(lo)) : [h("span", { class: "nw" }, won(lo)), h("span", { class: "to" }, " ~ "), h("span", { class: "nw" }, won(hi))]),
          h("div", { class: "meta" }, h("span", {}, st.vat === "incl" ? "부가세 포함 예상가" : "병원 표시가"), h("span", {}, `${regionName()} · ${D.meta.updated} 수집`),
            h("span", {}, "지점별 가격은 아래 분포와 목록에서 봐요")),
          h("div", { class: "row", style: "gap:16px;margin-top:10px" },
            h("button", { class: "linkbtn", type: "button", onclick: () => basisSheet(k, rk, plain) }, icon("circle-help", "xs"), "계산 기준"),
            h("button", { class: "linkbtn", type: "button", onclick: () => { const el = $("#clinics"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); } }, icon("list", "xs"), "지점별 가격 보기"))),
        h("div", { class: "qstats" }, stat("중간값", won(med), ptop ? "조건 없는 가격" : null),
          HL ? stat("가장 비싼 곳", won(prices[prices.length - 1])) : stat("가격 차이", spread >= 1.05 ? `최대 ${spread.toFixed(1)}배` : "거의 없음"),
          stat("비교 지점", `${prices.length}곳`, HL ? (spread >= 1.05 ? `최대 ${spread.toFixed(1)}배 차이` : "차이 거의 없음") : null)));
      if (ptop && ctop.p < ptop.p) pc.append(h("div", { class: "condlow" },
        h("div", { class: "row", style: "gap:6px" }, h("b", { class: "num" }, HL ? `조건부 최저 ${won(ctop.p)}` : `조건부 가격 ${won(ctop.p)}~`), HL ? h("span", { class: "sub" }, bname(ctop.b)) : null, h("span", { class: "sp" }),
          h("button", { class: "linkbtn", type: "button", onclick: () => priceSheet(ctop.i) }, "조건 확인", icon("chevron-right", "xs"))),
        h("div", { class: "sub" }, (priceConds(ctop.i).join(" · ") || "이번 주 확인 안 된 지점") + " — 조건이 맞을 때만 이 가격이에요.")));
      if (ptop && lowp.length) pc.append(h("div", { class: "condlow" },
        h("div", { class: "row", style: "gap:6px" }, h("b", { class: "num" }, `확인 필요 초저가 ${won(lowp[0].p)}`), h("span", { class: "sub" }, HL ? `${bname(lowp[0].b)}${lowp.length > 1 ? ` 외 ${lowp.length - 1}곳` : ""}` : `${lowp.length}곳`), h("span", { class: "sp" }),
          h("button", { class: "linkbtn", type: "button", onclick: () => priceSheet(lowp[0].i) }, "가격 근거", icon("chevron-right", "xs"))),
        h("div", { class: "sub" }, `조건 문구는 없지만 중간값의 ${Math.round(lowp[0].p / med * 100)}%이고 이 가격인 지점이 ${lowp.filter((x) => x.p === lowp[0].p).length}곳뿐이에요. 표시 안 된 행사나 입력 오류일 수 있어서, 원본을 확인하기 전까지 ${HL ? "최저가로 쓰지 않아요" : "가격 범위에 넣지 않아요"}.`)));
      if (HL && r0[4] && FLAGS.discountEmphasis) pc.append(h("div", { class: "sub", style: "margin-top:12px" }, `최저가는 병원이 적은 정가보다 ${Math.round((r0[4] - r0[3]) / r0[4] * 100)}% 싸요(정가 표기 기준, 가격 이력과 별개).`));
      // 2b) what to check with the price comes right after the price (docs/OBJECTIVE_DISPLAY_POLICY.md), then the options card
      box.append(pc, checkCard(k, fam, rk), card);
      box.append(specCard(k.i));   // 시술 규격 확인: what the name says, what it doesn't, similar-but-different specs
      // 3) the distribution: every branch's lowest price on one axis
      const dl = rk.map((x) => ({ b: x.b, i: x.i, p: x.p, cond: !plainOk(x.i) })), dmed = median(rk.map((x) => x.p));
      box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "병원별 가격 분포"), h("span", { class: "sp" }), h("span", { class: "sub" }, `${rk.length}곳`)),
        h("div", { class: "sub" }, `지점마다 가장 싼 가격 하나씩 · ${regionName()} · ${st.special ? "특가 포함" : "일반가만"} · ${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"}`),
        rk.length >= 3 ? distChart(dl, dmed, HL ? top.i : null, `${k.label} 병원별 가격 분포`, (d) => nav(`branch/${d.b}`))
          : h("div", { class: "chartempty" }, "비교할 지점이 3곳 미만이라 분포를 그리지 않아요. 아래 목록을 보세요."),
        rk.length >= 3 && dmed !== med ? h("p", { class: "tiny" }, `점선은 이 그림에 있는 ${rk.length}곳 전체의 중간값이에요. 위 '중간값'은 조건 없는 가격 ${prices.length}곳 기준이라 다를 수 있어요.`) : null));
      { const pcc = priceClassCard(k.i); if (pcc) box.append(pcc); }
      { const rc = regionalCard(k.i); if (rc) box.append(rc); }
      // per brand (docs/BRAND_PRICE_COMPARISON.md): branches, range, median, conditional prices, last check — in brand order;
      // the cheapest branch of each brand only with lowestHighlight. A tap lists that brand's branches for this exact key.
      const per = D.meta.brands.map((bb, bi) => ({ bi, xs: rk.filter((y) => BR[y.b].brand === bi).sort((p, q) => p.p - q.p) })).filter((y) => y.xs.length);
      if (per.length > 1) box.append(brandCard(k, per));
    }
    // favourite branches pinned for this procedure (price or 'not offered'); the gap to the cheapest only with lowestHighlight
    const fb = favs().b.map((id) => BK.get(id)).filter((b) => b != null);
    if (fb.length && rk.length) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:14px 14px 4px" }, h("h3", {}, "관심 지점")),
      h("ul", { class: "list" }, fb.map((b) => { const x = rk.find((y) => y.b === b);
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b}`) }, h("span", { class: "t row" }, bdot(b), bname(b)),
          h("span", { class: "p num" }, x ? won(x.p) : "없음"),
          h("span", { class: "m" }, x ? (FLAGS.lowestHighlight ? (() => { const mn = Math.min(...rk.map((y) => y.p)); return x.p === mn ? h("span", { class: "down" }, "최저가와 같아요") : h("span", {}, `최저보다 +${won(x.p - mn)}`); })() : h("span", {}, S[ROWS[x.i][2]]))
            : h("span", {}, "이 지점은 이 시술 가격이 없어요"),
            x ? kindBadge(ROWS[x.i]) : null))); }))));
    // 4) how the price moved (only recorded weeks)
    box.append(keyTrend(k) || "");
    // list-price discount: a different thing from the price history above (clinics' own 정가 this week, not past prices)
    const trd = TR().disc[k.id];
    if (trd != null && FLAGS.discountEmphasis) box.append(h("div", { class: "card" }, h("h3", {}, "정가 대비 할인율 (이번 주)"),
      h("div", { class: "sub" }, `병원이 상품에 적은 정가와 판매가를 비교한 값이에요. 정가가 적힌 가격만 계산하고, 위 '가격 이력'(실제로 관측한 과거 가격)과는 다른 숫자예요.`),
      h("div", { class: "tiles", style: "margin-top:8px" }, h("div", { class: "tile" }, h("span", { class: "k" }, "할인율 중간값"), h("b", { class: "num" }, `${trd}%`), h("span", { class: "w" }, "병원 표기 정가 기준")))));
    // 5) every clinic, in the order the user picked (default: region · name; nearest once a location is set)
    // only this card is redrawn when the order or the view changes (the charts above stay): a quick tap response
    const curRk = () => (st.prodK === k.i && st.prod != null ? prodRank(k.i, st.prod) : ranking(k.i));
    const mixed = (() => { const m = mixFor(k.i); return m.mixed || (m.named.size > 0 && m.none > 0); })();
    const prodTag = (i) => mixed ? h("span", { class: "k prodk" }, rowProds(i).join("·") || "제품 표기 없음") : null;
    const clinicsCard = (rk) => {
      const medAll = median(rk.map((x) => x.p)), min0 = rk.length ? Math.min(...rk.map((x) => x.p)) : 0;
      // only the view on screen is built (list or cards)
      const buildList = () => { const list = h("ul", { class: "list" });
      rk.slice(0, 300).forEach((x, n) => {
        const r = ROWS[x.i], low = rk.length >= 3 && medAll && x.p <= medAll * LOW_SHARE;
        // positions (1, 2, 3 …) read as a ranking: shown only with flags.lowestHighlight
        list.append(h("li", { class: "rk", "data-b": x.b, onmouseenter: () => dotHl(x.b), onfocusin: () => dotHl(x.b), onmouseleave: () => dotHl(null) }, h("button", { class: "rank" + (FLAGS.lowestHighlight ? (n < 3 && st.sort === "price" ? " top" : "") : " nonum"), type: "button", onclick: () => nav(`branch/${x.b}`) },
          h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))),
          h("span", { class: "p num" }, won(x.p)),
          h("span", { class: "m" }, S[r[2]], listS(r), prodTag(x.i), low ? h("span", { class: checkedOk(x.i) ? "k ok" : "k kx", title: `중간값 ${won(medAll)}의 ${Math.round(x.p / medAll * 100)}%` }, checkedOk(x.i) ? `초저가·원본 확인 ${CHK.get(x.i).d.slice(5)}` : "초저가·조건 확인") : null,
            kindBadge(r), fresh(x.b).stale ? h("span", { class: "k kx" }, "지난 자료") : null, FLAGS.lowestHighlight && x.p > min0 ? h("span", { class: "gap" }, `최저 +${won(x.p - min0)}`) : null, x.d != null ? h("b", {}, km(x.d)) : null)),
          h("button", { class: "infob", type: "button", "aria-label": `${bname(x.b)} 가격 근거 보기`, onclick: () => priceSheet(x.i) }, icon("info"))));
      });
      return list; };
      // the same clinics, same order, as cards to swipe through (one clinic per card: price, conditions, checked date)
      const buildCards = () => { const cards = h("ul", { class: "ccards", "aria-label": "지점별 가격 카드" });
      rk.slice(0, 300).forEach((x, n) => {
        const r = ROWS[x.i], low = rk.length >= 3 && medAll && x.p <= medAll * LOW_SHARE;
        cards.append(h("li", { class: "ccard", "aria-label": `${n + 1} / ${Math.min(rk.length, 300)}: ${bname(x.b)}` },
          h("div", { class: "ccard-h" }, bdot(x.b), h("b", {}, bname(x.b)), h("span", { class: "sp" }), h("span", { class: "tiny num" }, `${n + 1}/${Math.min(rk.length, 300)}`)),
          h("div", { class: "ccard-p num" }, won(x.p), listS(r)),
          h("div", { class: "ccard-n" }, S[r[2]]),
          h("div", { class: "m" }, prodTag(x.i), low ? h("span", { class: checkedOk(x.i) ? "k ok" : "k kx" }, checkedOk(x.i) ? `초저가·원본 확인 ${CHK.get(x.i).d.slice(5)}` : "초저가·조건 확인") : null,
            kindBadge(r), fresh(x.b).stale ? h("span", { class: "k kx" }, "지난 자료") : null, x.d != null ? h("b", {}, km(x.d)) : null),
          h("div", { class: "tiny" }, `${BR[x.b].region || ""} · 가격 확인 ${verified(x.b)}`),
          h("div", { class: "row ccard-a" }, h("button", { class: "btn sm gray", type: "button", "aria-label": `${bname(x.b)} 가격 근거 보기`, onclick: () => priceSheet(x.i) }, icon("info", "sm"), "가격 근거"),
            h("button", { class: "btn sm gray", type: "button", onclick: () => nav(`branch/${x.b}`) }, "지점 보기"), shortBtn(x.b))));
      });
      const step = (d) => { const c = cards.querySelector(".ccard"); if (c) cards.scrollBy({ left: d * (c.offsetWidth + 10), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); };
      const cardBox = h("div", { class: "ccwrap" }, cards, rk.length > 1 ? h("div", { class: "row ccnav" }, h("span", { class: "tiny" }, "옆으로 넘겨 보세요"), h("span", { class: "sp" }),
        h("button", { class: "tbtn-i", type: "button", "aria-label": "이전 지점", onclick: () => step(-1) }, icon("chevron-left")),
        h("button", { class: "tbtn-i", type: "button", "aria-label": "다음 지점", onclick: () => step(1) }, icon("chevron-right"))) : null);
      return cardBox; };
      const setView = (v) => { st.cview = v; store.set("cmpView", v); redrawClinics(); };
      const viewSw = h("div", { class: "seg vsw", role: "group", "aria-label": "보기 방식" }, [["list", "목록"], ["cards", "카드"]].map(([v, l]) =>
        h("button", { type: "button", "aria-pressed": st.cview === v ? "true" : "false", onclick: () => { if (st.cview !== v) setView(v); } }, l)));
      const have = new Set(rk.map((y) => y.b));
      const none = BR.filter((y) => brandOn(y.i) && regionOk(y.i) && !have.has(y.i));
      const setSort = (v) => { if (v === "near" && !st.loc) locSheet(); st.sort = v; store.set("sort", v); redrawClinics(); };
      return h("div", { class: "card flush", id: "clinics" }, h("div", { style: "padding:14px 14px 6px" }, h("div", { class: "row" }, h("h3", {}, `지점별 가격 ${rk.length}곳`), h("span", { class: "sp" }), rk.length > 1 ? viewSw : null),
        shortLink(), mixChips(k.i, redrawClinics),
        h("div", { style: "margin-top:10px" }, sortChips(st.sort, setSort)),
        h("p", { class: "tiny", style: "margin-top:8px" }, `${SORT_L[st.sort] || "정렬"}으로 보여줘요${st.sort === "near" && !st.loc ? "(기준 위치를 정하면 가까운 순)" : ""}. 기본은 지역·이름순이고, 광고·제휴로 순서가 바뀌지 않아요. 같은 용량·회차의 1회 가격끼리예요.`)),
        rk.length ? (st.cview === "cards" && rk.length > 1 ? buildCards() : buildList()) : h("div", { class: "empty" }, h("div", { class: "ei" }, icon("search")), h("b", {}, "조건에 맞는 지점이 없어요"), "브랜드나 특가 설정을 바꿔 보세요."),
        none.length ? h("details", { class: "fold small", style: "padding:0 12px" }, h("summary", {}, `이 시술 가격이 없는 지점 ${none.length}곳`),
          h("div", { class: "sub", style: "padding:0 2px 12px" }, none.map((y) => bname(y.i)).join(", "), " — 같은 시술을 팔지 않거나, 용량·회차가 달라 묶지 않은 곳이에요.")) : null);
    };
    const redrawClinics = () => { const old = box.querySelector("#clinics"), lbl = document.activeElement && old && old.contains(document.activeElement) ? document.activeElement.textContent : null;
      if (!old) { render(); return; } const fresh = clinicsCard(curRk()); old.replaceWith(fresh);
      const again = lbl != null && [...fresh.querySelectorAll("button")].find((x) => x.textContent === lbl); if (again) again.focus({ preventScroll: true }); };
    box.append(clinicsCard(curRk()));
    if (rk.length) box.append(h("div", { class: "card tools", role: "group", "aria-label": "비교 도구" },
      h("button", { class: "btn sm gray", type: "button", onclick: () => checklistSheet({ id: `k:${k.id}`, title: k.label, k: k.i }) }, icon("list-checks", "sm"), "방문 전 체크리스트"),
      h("button", { class: "btn sm gray", type: "button", onclick: () => saveSnap(snapOfKey(k.i, null)) }, icon("bookmark", "sm"), "이 비교 저장"),
      h("button", { class: "btn sm gray", type: "button", onclick: () => { st.qk = k.i; nav(`quick?k=${encodeURIComponent(k.id)}`); } }, icon("scale", "sm"), shortKeys().length ? `빠른 비교 (${shortKeys().length}곳)` : "빠른 비교"),
      h("p", { class: "tiny", style: "flex-basis:100%;margin:2px 0 0" }, "카드 보기·가격 근거·지점 화면의 '비교함'으로 지점을 2~4곳 담으면 빠른 비교에서 같은 사양끼리 맞대요.")));
    box.append(h("p", { class: "foot" }, `${vatNote()} 같은 시술로 묶는 기준: 용량·샷 수·회차·원산지가 같은 1회 가격. 다른 시술과 묶인 패키지, 추가 옵션, 구독권은 빠져요. 종료일이 지난 이벤트와 확인 중인 급변 가격도 빠져요.`));
    // 6) actions, kept at the bottom of the screen while scrolling
    if (rk.length) box.append(h("div", { class: "actions" },
      h("button", { class: "btn gray", type: "button", "aria-label": "가격 알림", onclick: () => alertSheet({ k: k.id }) }, icon("bell", "sm"), h("span", { class: "bl", "aria-hidden": "true" }, "알림")),
      h("button", { class: "btn gray", type: "button", "aria-label": "지도에서 보기", title: "지도에서 보기", onclick: () => { st.mapKey = k.i; nav("map"); } }, icon("map", "sm")),
      h("button", { class: "btn gray", type: "button", "aria-label": "가격 요약 복사", title: "가격 요약 복사", onclick: () => { const ps = rk.map((x) => x.p).sort((a, c) => a - c);
        copyText(FLAGS.lowestHighlight ? [`[${k.label}] ${regionName()} 최저가 (${D.meta.updated} 기준, ${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"})`,
          ...[...rk].sort((x, y) => x.p - y.p).slice(0, 3).map((x, n) => `${n + 1}. ${bname(x.b)} ${won(x.p)} — ${S[ROWS[x.i][2]]}${S[ROWS[x.i][11]] ? ` (${S[ROWS[x.i][11]]})` : ""}`)].join("\n")
          : [`[${k.label}] ${regionName()} 가격 요약 (${D.meta.updated} 수집, ${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"})`,
            `${ps.length}곳 · ${won(ps[0])} ~ ${won(ps[ps.length - 1])} · 중간값 ${won(median(ps))}`, "용량·조건·정품 여부·시술 의료진·부작용은 병원에 확인하세요. — 윤실장"].join("\n"), "가격 요약을 복사했어요"); } }, icon("copy", "sm")),
      h("button", { class: "btn gray", type: "button", "aria-label": "이 비교 링크 공유", title: "이 비교 링크 공유", onclick: () => shareLink(`윤실장 · ${k.label}`, `compare?k=${encodeURIComponent(k.id)}`) }, icon("share-2", "sm")),
      addBtn(k.i)));
    return box;
  };

  function switchEl(label, on, set) {
    const inp = h("input", { type: "checkbox", checked: on, onchange: (e) => set(e.target.checked) });
    return h("label", { class: "switch" }, inp, h("span", { class: "tr", "aria-hidden": "true" }), label);
  }
  function brandChips() {
    return h("div", { class: "chips", style: "margin-top:10px" }, D.meta.brands.map((b, i) => !BR.some((x) => x.brand === i) ? null : h("button", {
      class: "chip bchip", type: "button", "aria-pressed": st.brands.includes(i) ? "true" : "false",
      onclick: () => {
        st.brands = st.brands.includes(i) ? st.brands.filter((x) => x !== i) : [...st.brands, i];
        if (!st.brands.length) st.brands = D.meta.brands.map((_, j) => j);
        store.set("brands", st.brands); render();
      } }, h("span", { class: "dot", style: `background:${b[1]}` }), b[0])));
  }

  // ---------------- map
  let map, layer, meMarker;
  // ---------------- area names (no GPS needed): 구·동·역 from addresses and branch names → branches there
  let AREAS = null;
  function areaIndex() {
    if (AREAS) return AREAS;
    const m = new Map();
    const add = (t, b) => { if (t.length < 2) return; if (!m.has(t)) m.set(t, new Set()); m.get(t).add(b); };
    for (const b of BR) {
      if (b.lat == null) continue;
      for (const w of (b.addr || "").split(/\s+/)) if (/[시군구동읍면]$|역$/.test(w) && !/^(서울|경기|인천|부산|대구|대전|광주|울산|세종)/.test(w)) add(w.replace(/특별시|광역시/, ""), b.i);
      const n = b.name.replace(/(본점|점)$/, "").replace(/^(경기|인천|부산|대구|대전|광주|울산)\s*/, "").trim();
      add(n, b.i); if (/역$/.test(n)) add(n.replace(/역$/, ""), b.i);
    }
    return (AREAS = m);
  }
  function areaFind(q) {
    const t = q.replace(/\s+/g, "");
    if (!t) return [];
    return [...areaIndex()].filter(([k]) => k.includes(t) || t.includes(k)).map(([k, v]) => ({ name: k, bs: [...v] }))
      .sort((x, y) => (x.name.startsWith(t) ? 0 : 1) - (y.name.startsWith(t) ? 0 : 1) || y.bs.length - x.bs.length).slice(0, 8);
  }
  // use an area as the distance basis (centre of its branches) — same as a saved place, without GPS
  function useArea(a) {
    const pts = a.bs.map((i) => BR[i]);
    st.loc = { lat: pts.reduce((s, b) => s + b.lat, 0) / pts.length, lng: pts.reduce((s, b) => s + b.lng, 0) / pts.length }; st.locName = a.name;
    $("#locbtn").classList.add("on"); $("#locbtn span").textContent = a.name; store.set("locPlace", "");
    render();
    if (map && pts.length) map.fitBounds(L.latLngBounds(pts.map((b) => [b.lat, b.lng])).pad(0.4), { maxZoom: 14 });
  }
  function areaSearch(after) {
    const inp = h("input", { type: "search", class: "field", placeholder: "동네·역 이름 (예: 강남, 홍대, 분당, 부평)", "aria-label": "지역 이름으로 찾기" });
    const out = h("div", { class: "chips wrapc", style: "margin-top:6px" });
    inp.addEventListener("input", () => { const r = areaFind(inp.value);
      fill(out, inp.value.trim() && !r.length ? h("span", { class: "sub" }, "그 이름의 지점·동네가 없어요") : null,
        r.map((a) => h("button", { class: "chip", type: "button", onclick: () => { useArea(a); if (after) after(); } }, `${a.name} · ${a.bs.length}곳`))); });
    return h("div", {}, inp, out);
  }
  views.map = () => {
    const box = h("div", { class: "view" });
    const keySel = h("select", { class: "pick", "aria-label": "지도에 표시할 시술", onchange: (e) => { st.mapKey = e.target.value === "" ? null : +e.target.value; st.mapSel = null; drawMap(); paintNear(); } },
      h("option", { value: "" }, "지점 위치만 보기"), KEYS.map((x) => h("option", { value: x.i, selected: x.i === st.mapKey }, `${x.cat} · ${x.label}`)));
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, "지도"), h("span", { class: "sp" }),
      h("button", { class: "btn sm gray", type: "button", onclick: () => locate(() => { if (map && st.loc) map.setView([st.loc.lat, st.loc.lng], 13); }) }, icon("locate-fixed", "sm"), "내 위치로")),
      h("div", { style: "margin-top:8px" }, areaSearch()),
      h("div", { class: "row", style: "margin-top:8px" }, ["집", "직장"].map((n) => h("button", { class: "btn sm gray", type: "button", onclick: () => { if (!map) return; const c = map.getCenter(); savePlace(n, c.lat, c.lng); usePlace(n); } }, icon(n === "집" ? "house" : "building-2", "sm"), `지도 가운데를 ${n}으로`))),
      h("div", { style: "margin-top:10px" }, keySel), brandChips()));
    // touch screens: the map starts locked so a finger scrolls the page; '지도 움직이기' unlocks one-finger panning
    const touch = typeof L !== "undefined" && L.Browser.mobile;
    const lockBtn = h("button", { class: "mapbtn", type: "button", "aria-pressed": "false", onclick: () => setMapLock(!st.mapLocked) }, "");
    const again = h("button", { class: "mapbtn again", type: "button", hidden: true, onclick: () => { again.hidden = true; paintNear(); } }, icon("refresh-cw", "sm"), "이 지역 재검색");
    box.append(h("div", { class: "mapwrap" }, h("div", { id: "map", role: "application", "aria-label": "지점 지도" }), h("div", { class: "mapbar" }, touch ? lockBtn : null, again)));
    box.append(h("div", { class: "card flush", id: "near" }));
    st.mapLocked = touch;
    setTimeout(() => { initMap(again); setMapLock(st.mapLocked, lockBtn); drawMap(); paintNear(); }, 0);
    return box;
  };
  function setMapLock(v, btn) {
    st.mapLocked = v; btn = btn || $(".mapbtn[aria-pressed]");
    if (map) { if (v) { map.dragging.disable(); } else { map.dragging.enable(); } }
    if (btn) { btn.setAttribute("aria-pressed", v ? "false" : "true"); btn.replaceChildren(icon(v ? "lock" : "check", "sm"), v ? "지도 움직이기" : "움직이는 중 · 잠그기"); }
  }
  // Leaflet loads the first time the map opens (round-2 O4: the free home no longer downloads and parses a map library)
  let leafletP = null, leafletFailed = false;
  function loadLeaflet() {
    if (typeof L !== "undefined") return Promise.resolve();
    if (!leafletP) leafletP = new Promise((ok, bad) => {
      const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "vendor/leaflet/leaflet.css"; document.head.append(css);
      const js = document.createElement("script"); js.src = "vendor/leaflet/leaflet.js"; js.onload = () => ok(); js.onerror = () => { leafletFailed = true; leafletP = null; bad(new Error("leaflet")); };
      document.head.append(js);
    });
    return leafletP;
  }
  function initMap(again) {
    if (typeof L === "undefined") {
      if (leafletFailed) { $("#map").replaceWith(h("div", { class: "card empty" }, "지도를 불러오지 못했어요(인터넷 연결 확인).")); return; }
      const el = $("#map"); if (el) el.replaceChildren(h("div", { class: "empty" }, "지도를 불러오는 중…"));
      loadLeaflet().then(() => { leafletFailed = false; if (current === "map") render(); }).catch(() => { if (current === "map") render(); });
      return;
    }
    if (map) { map.remove(); map = null; }
    map = L.map("map", { zoomControl: true, attributionControl: true, scrollWheelZoom: false, tap: false })
      .setView(st.loc ? [st.loc.lat, st.loc.lng] : st.region === "수도권" ? [37.5, 126.98] : [36.4, 127.8], st.loc ? 13 : st.region === "수도권" ? 10 : 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    // wheel zoom only after the user clicks the map (page scroll isn't hijacked); clusters are redrawn per zoom level
    map.on("click", () => map.scrollWheelZoom.enable());
    map.on("mouseout", () => map.scrollWheelZoom.disable());
    map.on("zoomend", drawMap);
    // the list below follows the map only when asked ('이 지역 재검색'), so it doesn't jump while panning
    map.on("moveend", () => { if (again) again.hidden = false; });
  }
  const priceLabel = (p) => p >= 10000 ? (p / 10000).toFixed(p % 10000 ? 1 : 0).replace(/\.0$/, "") + "만" : p.toLocaleString();
  function drawMap() {
    if (!map) return;
    layer.clearLayers();
    let prices = null, min = Infinity;
    if (st.mapKey != null) {
      prices = new Map(ranking(st.mapKey, "price").map((x) => [x.b, x]));
      for (const x of prices.values()) min = Math.min(min, x.p);
    }
    const pts = BR.filter((b) => b.lat != null && brandOn(b.i) && (!prices || prices.has(b.i)) && kmOk(b.i));
    // grid clustering in screen space: branches closer than ~48px at this zoom become one marker with a count
    const z = map.getZoom(), cell = 48, cells = new Map();
    for (const b of pts) { const q = map.project([b.lat, b.lng], z); const key = `${Math.floor(q.x / cell)}:${Math.floor(q.y / cell)}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(b); }
    for (const grp of cells.values()) {
      if (grp.length > 1 && z < 16) {
        const lat = grp.reduce((s, b) => s + b.lat, 0) / grp.length, lng = grp.reduce((s, b) => s + b.lng, 0) / grp.length;
        const lo = prices ? Math.min(...grp.map((b) => prices.get(b.i).p)) : null;
        const sel = grp.some((b) => b.i === st.mapSel);
        const m = L.marker([lat, lng], { icon: L.divIcon({ className: "", html: `<span class="pin-cluster${sel ? " sel" : ""}${lo === min && FLAGS.lowestHighlight ? " best" : ""}">${grp.length}곳${lo != null ? ` · ${priceLabel(lo)}~` : ""}</span>`, iconSize: [0, 0] }),
          keyboard: true, title: `${grp.length}개 지점 — 눌러서 확대` });
        m.on("click", () => map.fitBounds(L.latLngBounds(grp.map((b) => [b.lat, b.lng])).pad(0.3), { maxZoom: 16 }));
        layer.addLayer(m);
        continue;
      }
      // branches with the same coordinates (one building, or an address found only to the street): stack them a pin apart so each can be tapped
      const at = new Map();
      for (const b of grp) { const k = `${b.lat.toFixed(5)},${b.lng.toFixed(5)}`; if (!at.has(k)) at.set(k, []); at.get(k).push(b); }
      for (const same of at.values()) same.forEach((b, j) => {
        const dy = (j - (same.length - 1) / 2) * 28;
        const pos = dy ? map.unproject(map.project([b.lat, b.lng], z).add([0, dy]), z) : null;
        layer.addLayer(branchMarker(b, prices, min, pos, same.length));
      });
    }
    if (st.loc) {
      meMarker = L.marker([st.loc.lat, st.loc.lng], { icon: L.divIcon({ className: "", html: '<div class="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false });
      layer.addLayer(meMarker);
    }
  }
  function branchMarker(b, prices, min, pos, same) {
    const color = brandOf(b.i)[1], sel = b.i === st.mapSel, ll = pos || [b.lat, b.lng];
    let m;
    if (prices) {
      const x = prices.get(b.i);
      m = L.marker(ll, { icon: L.divIcon({ className: "", html: `<span class="pin-price${x.p === min && FLAGS.lowestHighlight ? " best" : ""}${sel ? " sel" : ""}" style="--c:${color}">${priceLabel(x.p)}</span>`, iconSize: [0, 0] }), keyboard: true, title: bname(b.i) });
    } else {
      m = L.circleMarker(ll, { radius: sel ? 11 : 8, color: sel ? "#111" : "#fff", weight: sel ? 3 : 2, fillColor: color, fillOpacity: 1 });
    }
    const pop = h("div", {}, h("b", {}, bname(b.i)), h("br"), h("span", { class: "sub" }, b.addr || ""),
      prices ? h("div", { style: "margin-top:4px;font-weight:800" }, won(prices.get(b.i).p)) : null,
      dist(b.i) != null ? h("div", { class: "sub" }, `기준 위치에서 ${km(dist(b.i))}`) : null,
      b.geo ? h("div", { class: "sub" }, `지도 위치는 주소의 ${b.geo === 1 ? "도로" : "구·동"}까지만 찾은 근사치예요 — 방문 전 주소를 확인하세요`) : null,
      same > 1 ? h("div", { class: "sub" }, `${b.geo ? "같은 좌표" : "같은 건물"}에 ${same}곳 — 지도에 위아래로 나란히 놓았어요`) : null,
      h("button", { class: "btn sm", type: "button", style: "margin-top:8px", onclick: () => nav(`branch/${b.i}`) }, "이 지점 가격 보기"));
    m.bindPopup(pop);
    m.bi = b.i;
    // marker → list: highlight and scroll to the same branch below the map
    // (a marker outside the area the list was drawn for — the map moved since — redraws the list first)
    m.on("click", () => { st.mapSel = b.i; if (!document.querySelector(`#near li[data-b="${b.i}"]`)) paintNear(); markListSel(true); });
    return m;
  }
  function markListSel(scroll) {
    document.querySelectorAll("#near li[data-b]").forEach((li) => li.classList.toggle("sel", +li.dataset.b === st.mapSel));
    const li = document.querySelector(`#near li[data-b="${st.mapSel}"]`);
    if (scroll && li) li.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  // list → marker: zoom to the branch and open its popup
  function focusBranch(i) {
    const b = BR[i]; if (!map || b.lat == null) return;
    st.mapSel = i;
    map.setView([b.lat, b.lng], Math.max(map.getZoom(), 16));
    // by branch id, not position: some branches share coordinates
    setTimeout(() => { layer.eachLayer((m) => { if (m.bi === i && m.getPopup) m.openPopup(); }); markListSel(false); }, 350);
    document.getElementById("map").scrollIntoView({ block: "center", behavior: "smooth" });
  }
  // distance limit for the map (pins and list), only once a place to measure from is set
  const kmOk = (b) => !st.mapKm || !st.loc || (dist(b) != null && dist(b) <= st.mapKm);
  const kmChips = () => !st.loc ? null : h("div", { class: "chips", role: "group", "aria-label": "거리", style: "margin-top:8px" },
    [[0, "거리 전체"], [1, "1km"], [3, "3km"], [5, "5km"], [10, "10km"]].map(([v, l]) => h("button", { class: "chip", type: "button", "aria-pressed": (st.mapKm || 0) === v ? "true" : "false",
      onclick: () => { st.mapKm = v; drawMap(); paintNear(); } }, l)));
  function paintNear() {
    const el = $("#near");
    if (!el || !map) return;
    const bounds = map.getBounds();
    let list = BR.filter((b) => b.lat != null && brandOn(b.i) && bounds.contains([b.lat, b.lng]) && kmOk(b.i));
    const price = st.mapKey != null ? new Map(ranking(st.mapKey, "price").map((x) => [x.b, x])) : null;
    if (price) list = list.filter((b) => price.has(b.i));
    list = list.map((b) => ({ b, d: dist(b.i), p: price ? price.get(b.i).p : null }))
      .sort((x, y) => st.loc ? (x.d - y.d) : price && FLAGS.lowestHighlight ? x.p - y.p : regionCmp(x.b.i, y.b.i));
    el.replaceChildren(h("div", { style: "padding:12px 12px 4px" }, h("h3", {}, st.loc ? `가까운 지점${st.locName ? ` · ${st.locName} 기준` : ""}` : "지도에 보이는 지점"),
      h("div", { class: "sub" }, `${list.length}곳${st.mapKm && st.loc ? ` · ${st.mapKm}km 안` : ""} · 지도를 옮긴 뒤 '이 지역 재검색'을 누르면 목록이 바뀌어요${st.loc ? "" : " · 위치나 동네를 정하면 거리순·거리 제한"}`), kmChips()),
      list.length ? h("ul", { class: "list" }, (() => { const top = list.slice(0, 40), sel = list.findIndex((x) => x.b.i === st.mapSel);   // the chosen marker's branch is always listed
        return sel >= 40 ? [...top, list[sel]] : top; })().map((x) => h("li", { class: "rk" + (x.b.i === st.mapSel ? " sel" : ""), "data-b": x.b.i },
        h("button", { class: "item", type: "button", onclick: () => nav(`branch/${x.b.i}`) },
          h("span", { class: "t row" }, bdot(x.b.i), bname(x.b.i)), h("span", { class: "p num" }, x.p != null ? won(x.p) : km(x.d)),
          h("span", { class: "m" }, x.b.addr, x.p != null && x.d != null ? h("b", {}, km(x.d)) : null)),
        h("button", { class: "infob", type: "button", "aria-label": `${bname(x.b.i)} 지도에서 보기`, onclick: () => focusBranch(x.b.i) }, icon("map-pin")))))
        : h("div", { class: "empty" }, "이 지역에 표시할 지점이 없어요. 지도를 넓히거나 동네 이름으로 찾아보세요."));
  }

  // ---------------- branch detail
  views.branch = (arg) => {
    const b = /^\d+$/.test(String(arg)) ? +arg : -1, x = BR[b];
    // an old or mistyped link says so instead of silently showing the home screen (round-2 D6)
    if (!x) return h("div", { class: "view" }, h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"),
      jomiEmpty("empty", "이 지점을 찾지 못했어요. 수집에서 빠졌거나 링크가 잘못됐을 수 있어요."),
      h("button", { class: "btn line block", type: "button", onclick: () => nav("map") }, "지점 목록 보기", icon("chevron-right", "sm")));
    remember("b", bkey(b));
    const box = h("div", { class: "view" });
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
    const d = dist(b);
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, bdot(b), h("span", { class: "sub" }, brandOf(b)[0])),
      (() => { const sib = BR.filter((y) => y.brand === x.brand && (regionOk(y.i) || y.i === b)).sort((p, q) => p.name.localeCompare(q.name, "ko")); const n = sib.findIndex((y) => y.i === b);
        const go = (d) => { const y = sib[(n + d + sib.length) % sib.length]; if (y) nav(`branch/${y.i}`, true); };
        return h("div", { class: "row", style: "margin-top:2px;flex-wrap:nowrap" }, h("h2", { style: "flex:1;min-width:0" }, `${brandOf(b)[0]} ${x.name}`), favBtn("b", bkey(b), bname(b)),
          sib.length > 1 && n >= 0 ? h("span", { class: "sibs" }, h("button", { type: "button", "aria-label": "같은 브랜드 이전 지점", onclick: () => go(-1) }, icon("chevron-left", "sm")), h("span", { class: "sub" }, `${n + 1}/${sib.length}`),
            h("button", { type: "button", "aria-label": "같은 브랜드 다음 지점", onclick: () => go(1) }, icon("chevron-right", "sm"))) : null); })(),
      h("dl", { class: "kv", style: "margin-top:10px" }, h("dt", {}, "주소"), h("dd", {}, x.addr || "확인 못 함"),
        d != null ? [h("dt", {}, "거리"), h("dd", {}, `내 위치에서 ${km(d)}`)] : null,
        (() => { const f = fresh(b); return [h("dt", {}, "가격 확인"), h("dd", { class: f.stale ? "up" : "" }, f.d ? `${f.d} (${f.n === 0 ? "오늘" : `${f.n}일 전`})${f.stale ? " · 최신이 아닐 수 있어요" : ""}` : "확인일 없음")]; })()),
      fresh(b).stale ? h("div", { class: "note", style: "margin-top:8px" }, "이번 수집에서 이 지점 가격을 새로 읽지 못해 지난 자료를 보여 주고 있어요. 방문 전에 병원에 꼭 확인하세요.") : null,
      h("div", { class: "row", style: "margin-top:12px" },
        x.lat != null ? h("button", { class: "btn sm gray", type: "button", onclick: () => { nav("map"); setTimeout(() => map && map.setView([x.lat, x.lng], 16), 50); } }, icon("map", "sm"), "지도") : null,
        x.addr ? h("a", { class: "btn sm gray", href: `https://map.kakao.com/?q=${encodeURIComponent(x.addr)}`, target: "_blank", rel: "noopener" }, icon("navigation", "sm"), "길찾기") : null,
        h("a", { class: "btn sm gray", href: x.site, target: "_blank", rel: "noopener" }, icon("external-link", "sm"), "병원 홈페이지"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => recordSheet(null, { br: bkey(b) }) }, icon("receipt", "sm"), "방문 기록"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { st.vsA = b; st.vsB = null; nav("versus"); } }, icon("scale", "sm"), "다른 지점과 비교"), shortBtn(b))));
    // level tiles + options this branch is the cheapest for
    const bs = (D.bstat || [])[b];
    // the branch's place in a price ranking and 'cheapest here' lists only with flags.branchRanking (legal review first)
    if (bs && FLAGS.branchRanking) {
      const rk = (idx) => { const all = BR.map((y) => ({ b: y.i, v: D.bstat[y.i] && D.bstat[y.i][idx] })).filter((y) => y.v != null).sort((p, q) => p.v - q.v); const n = all.findIndex((y) => y.b === b); return n >= 0 ? `${all.length}곳 중 ${n + 1}위` : ""; };
      const nSpecial = byB[b].filter((i) => isSpecial(ROWS[i])).length;
      const cheapHere = [];
      for (let g = 0; g < GR.length; g++) { const s = gstat(g, true); const me = s.per.get(b); if (me && s.prices.length >= 5 && me.p === s.prices[0]) cheapHere.push({ g, i: me.i, n: s.prices.length, sole: s.prices[1] > me.p, med: s.med }); }
      cheapHere.sort((p, q) => (q.med - ROWS[q.i][3]) / q.med - (p.med - ROWS[p.i][3]) / p.med);
      box.append(h("div", { class: "card" }, h("h3", {}, "이 지점 가격 수준"),
        h("div", { class: "tiles" },
          h("div", { class: "tile" }, h("span", { class: "k" }, "일반가 기준"), h("b", { class: lvClass(bs[0]) }, lvText(bs[0])), h("span", { class: "w" }, rk(0))),
          h("div", { class: "tile" }, h("span", { class: "k" }, "특가 포함"), h("b", { class: lvClass(bs[1]) }, lvText(bs[1])), h("span", { class: "w" }, rk(1))),
          h("div", { class: "tile" }, h("span", { class: "k" }, "제일 싼 시술"), h("b", { class: "num" }, `${bs[3]}개`), h("span", { class: "w" }, `혼자 최저 ${bs[4]}개`)),
          h("div", { class: "tile" }, h("span", { class: "k" }, "옵션 수"), h("b", { class: "num" }, `${byB[b].length}개`), h("span", { class: "w" }, `체험가·한정가 등 ${nSpecial}개`))),
        Object.keys(bs[5] || {}).length ? h("div", { class: "chips wrapc", style: "margin-top:10px" }, Object.entries(bs[5]).map(([c, v]) => h("span", { class: "chip", style: "cursor:default" }, `${D.meta.cats[+c]} `, h("b", { class: lvClass(v) }, lvText(v))))) : null,
        h("div", { class: "sub", style: "margin-top:8px" }, "같은 옵션을 파는 지점들의 중간 가격과 비교했어요")));
      if (cheapHere.length) box.append(h("details", { class: "card flush fold" }, h("summary", {}, `이 지점이 제일 싼 시술 ${cheapHere.length}개`),
        h("ul", { class: "list" }, cheapHere.slice(0, 200).map((x) => { const r = ROWS[x.i];
          return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
            h("span", { class: "m" }, h("span", {}, `${x.n}곳 중 ${x.sole ? "혼자 " : "공동 "}최저`), h("span", { class: "down" }, pctTxt(r[3] / x.med - 1)), kindBadge(r), srcLink(x.i), h("span", { class: "sp" }), rowAddBtn(x.i)))); }))));
    }
    const rows = byB[b].filter((i) => st.special || !isSpecial(ROWS[i]));
    const cats = D.meta.cats.map((c, ci) => [c, rows.filter((i) => ROWS[i][1] === ci).length]).filter(([, n]) => n);
    if (st.bcat >= 0 && !cats.some(([c]) => D.meta.cats.indexOf(c) === st.bcat)) st.bcat = -1;
    const q = h("input", { type: "search", placeholder: "이 지점에서 시술 찾기", "aria-label": "이 지점에서 시술 찾기" });
    const list = h("ul", { class: "list" });
    const paint = () => {
      const t = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const pos = new Map();
      const vm = (i) => { if (!pos.has(i)) pos.set(i, rowPos(i)); const x = pos.get(i); return x ? x.vsMed : 9; };
      const disc = (i) => ROWS[i][4] ? (ROWS[i][4] - ROWS[i][3]) / ROWS[i][4] : 0;
      const so = { cat: (a, c) => ROWS[a][1] - ROWS[c][1] || ROWS[a][3] - ROWS[c][3], price: (a, c) => ROWS[a][3] - ROWS[c][3], priceDesc: (a, c) => ROWS[c][3] - ROWS[a][3], med: (a, c) => vm(a) - vm(c), disc: (a, c) => disc(c) - disc(a) }[st.bsort];
      const shown = rows.filter((i) => (st.bcat < 0 || ROWS[i][1] === st.bcat) && t.every((w) => S[ROWS[i][2]].toLowerCase().includes(w))).sort((a, c) => (ROWS[a][15] ? 1 : 0) - (ROWS[c][15] ? 1 : 0) || so(a, c));
      list.replaceChildren(...shown.slice(0, 400).map((i) => { const r = ROWS[i];
        return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
          h("span", { class: "m" }, D.meta.cats[r[1]], listS(r), r[4] && FLAGS.discountEmphasis ? h("span", { class: "k kt" }, `${Math.round((r[4] - r[3]) / r[4] * 100)}%↓`) : null, kindBadge(r),
            sessOf(i) > 1 ? h("span", {}, sessOf(i) >= 99 ? "이용권" : `${sessOf(i)}회`) : null,
            (() => { const x = r[15] ? null : rowPos(i); if (!FLAGS.lowestHighlight) return h("button", { class: "linkbtn", type: "button", onclick: () => priceSheet(i) }, icon("info", "xs"), "가격 근거");
              return x ? h("button", { class: `linkbtn ${x.vsMed < -0.005 ? "down" : x.vsMed > 0.005 ? "up" : ""}`, type: "button", title: "계산 기준·조건·원본 보기", onclick: () => priceSheet(i) }, `${x.n}곳 중 ${x.rank}위 · ${pctTxt(x.vsMed)}`, icon("info", "xs")) : null; })(),
            srcLink(i), h("span", { class: "sp" }), r[15] ? null : rowAddBtn(i)))); }));
      if (!shown.length) list.replaceChildren(h("li", { class: "empty" }, "찾는 시술이 없어요"));
      else if (shown.length > 400) list.append(h("li", { class: "empty" }, `${shown.length}개 중 400개만 보여요. 검색으로 좁혀 보세요.`));
    };
    q.addEventListener("input", paint);
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, `가격표 ${rows.length}개`), h("span", { class: "sp" }),
      switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); })),
      h("div", { class: "search", style: "margin-top:10px;box-shadow:none;background:var(--fill)" }, q),
      h("div", { class: "chips", style: "margin-top:10px" }, h("button", { class: "chip", type: "button", "aria-pressed": st.bcat < 0 ? "true" : "false", onclick: () => { st.bcat = -1; render(); } }, "전체"),
        cats.map(([c, n]) => h("button", { class: "chip", type: "button", "aria-pressed": D.meta.cats.indexOf(c) === st.bcat ? "true" : "false",
          onclick: () => { st.bcat = D.meta.cats.indexOf(c); render(); } }, `${c} ${n}`))),
      h("div", { class: "chips", style: "margin-top:8px" }, [["cat", "카테고리순"], ["price", "낮은 가격순"], ["priceDesc", "높은 가격순"], ...(FLAGS.discountEmphasis ? [["med", "중간보다 싼 순"], ["disc", "할인율 큰 순"]] : [])].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": st.bsort === v ? "true" : "false", onclick: () => { st.bsort = v; render(); } }, l)))));
    box.append(h("div", { class: "card flush" }, list));
    paint();
    return box;
  };

  // ---------------- 지점 순위: branch price level (geometric mean of price / median over shared options)
  views.rank = () => {
    const box = h("div", { class: "view" });
    box.append(cmpNav("rank"));
    if (!FLAGS.branchRanking) { box.append(h("div", { class: "card" }, h("div", { class: "empty" }, h("div", { class: "ei" }, icon("scale")), h("b", {}, "지점 순위는 꺼 두었어요"),
      "지점을 싼 순서로 줄 세우는 화면은 환자 유인으로 보일 수 있어서, 법률 검토가 끝날 때까지 보여주지 않아요. 시술별 비교에서 지점별 가격을 지역·거리·가격 순으로 직접 정렬해 볼 수 있어요."),
      h("button", { class: "btn block", type: "button", onclick: () => nav("compare") }, "시술별 비교로 가기", icon("chevron-right", "sm")))); return box; }
    const cats = D.meta.cats.map((c, ci) => ci).filter((ci) => (D.bstat || []).some((s) => s[5] && s[5][ci] != null));
    const list = branchRanks(st.rcat);
    box.append(h("div", { class: "card" }, h("h2", {}, "지점 순위"),
      h("div", { class: "sub", style: "margin-top:4px" }, "같은 옵션을 파는 지점들의 중간 가격과 비교해 이 지점이 평균 몇 % 싼지(기하평균). 같은 브랜드 지점끼리 겹치는 상품이 많아요."),
      h("div", { class: "row", style: "margin-top:10px" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); })),
      h("div", { class: "chips", style: "margin-top:10px" }, h("button", { class: "chip", type: "button", "aria-pressed": st.rcat < 0 ? "true" : "false", onclick: () => { st.rcat = -1; render(); } }, "전체"),
        cats.map((ci) => h("button", { class: "chip", type: "button", "aria-pressed": st.rcat === ci ? "true" : "false", onclick: () => { st.rcat = ci; render(); } }, D.meta.cats[ci]))),
      brandChips()));
    box.append(h("div", { class: "card flush" }, list.length ? h("ul", { class: "list" }, list.map((x, n) => { const s = D.bstat[x.b];
      return h("li", {}, h("button", { class: "rank" + (n < 3 ? " top" : ""), type: "button", onclick: () => nav(`branch/${x.b}`) },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))),
        h("span", { class: `p ${lvClass(x.lv)}` }, lvText(x.lv)),
        h("span", { class: "m" }, divBar(x.lv), h("span", {}, `제일 싼 시술 ${s[3]}개`), h("span", {}, `비교 ${s[2]}개`), dist(x.b) != null ? h("b", {}, km(dist(x.b))) : null))); }))
      : h("div", { class: "empty" }, "조건에 맞는 지점이 없어요")));
    box.append(h("div", { class: "note" }, "• 비교할 수 있는 옵션이 10개 미만(카테고리는 5개 미만)인 지점은 빠져요.", h("br"), "• '제일 싼 시술'은 5곳 이상이 파는 옵션 중 이 지점이 최저가(공동 포함)인 개수예요."));
    return box;
  };

  // ---------------- 지점 비교: two branches side by side over the options both sell
  // ===================== demo-stage features (2026-10-13 DEMO-FIRST directive, docs/DEMO_FEATURES.md) =====================
  // Everything here runs on the real price data in this phone; nothing is sent to a server unless a button says so.

  // ---- 죠미 설정: how often 죠미 speaks, motion, short / long explanations (마이 → 죠미 설정)
  const JP_DEF = { freq: "often", motion: "auto", detail: "short" };
  const jprefs = () => ({ ...JP_DEF, ...(store.get("jomiPrefs", null) || {}) });
  function applyMotion() {
    const m = jprefs().motion;
    document.documentElement.classList.toggle("calm", m === "off" || (m === "auto" && matchMedia("(prefers-reduced-motion: reduce)").matches));
  }
  const smooth = () => document.documentElement.classList.contains("calm") ? "auto" : "smooth";

  // ---- 쉬운 용어 (terms.js): a small '?' next to hard words opens the meaning; #terms lists them all
  const termOf = (w) => (window.TERMS || []).find((x) => x.t === w || (x.aka || []).includes(w));
  function termSheet(w) {
    const x = termOf(w); if (!x) return;
    sheet(`쉬운 용어 · ${x.t}`, (close) => h("div", {}, jomiSay("explaining", x.short),
      jprefs().detail === "long" ? h("p", { class: "sub", style: "margin-top:10px" }, x.long) : h("details", { class: "fold small" }, h("summary", {}, "조금 더 자세히"), h("p", { class: "sub", style: "margin:0 0 8px" }, x.long)),
      h("p", { class: "tiny", style: "margin-top:8px" }, x.kind === "price" ? "윤실장이 가격표를 읽는 방법을 설명한 거예요(의학 정보 아님)." : "일반적인 뜻이에요(의료진 검수 전). 나에게 맞는지·얼마나 필요한지는 의료진과 상담하세요."),
      h("button", { class: "btn sm gray", type: "button", style: "margin-top:10px", onclick: () => { close(); nav("terms"); } }, icon("book-open", "sm"), "용어 모두 보기")));
  }
  const termBtn = (w, label = w) => termOf(w) ? h("button", { class: "termb", type: "button", "aria-label": `${label} — 뜻 보기`, onclick: (e) => { e.stopPropagation(); termSheet(w); } }, label, icon("circle-help", "xs")) : label;
  views.terms = () => {
    const box = h("div", { class: "view" });
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
    const q = h("input", { type: "search", placeholder: "용어 찾기 (예: 체험가, 샷, U)", "aria-label": "용어 찾기" });
    const list = h("div", {});
    const long = jprefs().detail === "long";
    const paint = () => { const w = q.value.trim();
      const shown = (window.TERMS || []).filter((x) => !w || x.t.includes(w) || (x.aka || []).some((a) => a.includes(w)) || x.short.includes(w));
      fill(list, [["price", "가격·조건"], ["unit", "단위"], ["term", "시술 용어"]].map(([kd, l]) => { const xs = shown.filter((x) => x.kind === kd); return xs.length ? h("div", { class: "card flush" },
        h("div", { style: "padding:14px 14px 4px" }, h("h3", {}, l), h("div", { class: "tiny" }, kd === "price" ? "윤실장의 설명이에요(의학 정보 아님)." : "일반적인 뜻이에요 · 의료진 검수 전")),
        h("ul", { class: "list" }, xs.map((x) => h("li", {}, h("div", { class: "item termi" }, h("span", { class: "t" }, x.t), h("span", { class: "m", style: "color:var(--ink-2)" }, x.short),
          long ? h("span", { class: "m" }, x.long) : h("details", { class: "fold small", style: "grid-column:1/-1" }, h("summary", {}, "자세히"), h("p", { class: "sub", style: "margin:0 0 8px" }, x.long))))))) : null; }),
        shown.length ? null : h("div", { class: "card empty" }, "찾는 용어가 없어요. 시술 이름은 시술 사전에서 찾아보세요."));
    };
    q.addEventListener("input", paint);
    box.append(h("div", { class: "card" }, jomiSay("explaining", "가격표에 자주 나오는 말을 쉽게 풀었어. 시술이 나한테 맞는지는 꼭 의료진과 이야기해 줘."),
      h("h2", { style: "margin-top:10px" }, "쉬운 용어"), h("div", { class: "search", style: "margin-top:10px;box-shadow:none;background:var(--fill)" }, q),
      h("button", { class: "linkbtn", type: "button", style: "margin-top:8px", onclick: () => nav("guide") }, icon("book-open", "xs"), "시술 이름은 시술 사전에서")));
    box.append(list);
    paint();
    return box;
  };

  // ---- 시술 규격 확인 (Spec): what the clinic's option name says — product, origin, dose/shots, sessions, area; unknown stays unknown
  const keysOfRow = (i) => (S[ROWS[i][7]] || "").split(" ").map((id) => KI[id]).filter((x) => x != null);
  function specOfRow(i) { const ks = keysOfRow(i), fm = ks.map((k) => famOf[k]).find(Boolean);
    return Spec.parse(S[ROWS[i][2]], { family: fm ? fm.f.name : "", label: ks.length ? KEYS[ks[0]].label : "", sess: sessOf(i) }); }
  function specOfKey(k) { const fm = famOf[k]; return Spec.parse(KEYS[k].label, { family: fm ? fm.f.name : "", label: KEYS[k].label }); }
  const SPEC_TERM = { "용량": "U(유닛)", "샷 수": "샷", "횟수": "회차", "부위": "1부위", "원산지": "국산·수입", "실 개수": "줄", "에너지": "줄" };
  const stateTag = (s) => s === "known" ? h("span", { class: "k ok" }, "확인") : s === "assumed" ? h("span", { class: "k k4" }, "추정") : h("span", { class: "k kx" }, "미확인");
  const specList = (sp) => h("dl", { class: "specs" }, sp.flatMap((x) => [h("dt", {}, SPEC_TERM[x.k] ? termBtn(SPEC_TERM[x.k], x.k) : x.k), h("dd", { class: `st-${x.state}` }, h("span", {}, x.v), stateTag(x.state))]));
  // similar but different: other specs of the same family (each compared on its own) and look-alike families
  function specCard(k) {
    const sp = specOfKey(k), fm = famOf[k];
    const sibs = fm ? fm.f.vs.filter((v) => v.k !== k).map((v) => ({ v, d: Spec.diff(sp, specOfKey(v.k)) })).filter((x) => x.d.length).slice(0, 6) : [];
    const looks = fm ? FAM.filter((f) => f !== fm.f && f.fid && f.fid === fm.f.fid).slice(0, 8) : [];
    return h("section", { class: "card speccard", "aria-label": "시술 규격 확인" },
      h("div", { class: "row" }, h("h3", {}, "시술 규격 확인"), h("span", { class: "sp" }), h("button", { class: "linkbtn", type: "button", onclick: () => nav("terms") }, icon("circle-help", "xs"), "쉬운 용어")),
      h("div", { class: "sub" }, "비교 기준 이름에서 읽은 규격이에요. '미확인'은 이름에 없다는 뜻이고, 앱이 채워 넣지 않아요."),
      specList(sp),
      sibs.length ? h("div", { class: "specsib" }, h("b", {}, "비슷하지만 다른 규격(따로 비교해요)"), h("ul", { class: "plain" }, sibs.map((x) => h("li", {},
        h("button", { class: "linkbtn", type: "button", onclick: () => { st.key = x.v.k; nav(`compare?k=${encodeURIComponent(KEYS[x.v.k].id)}`); } }, x.v.label), " — ", x.d.map((d) => `${d.k} ${d.a} ↔ ${d.b}`).join(", "))))) : null,
      looks.length ? h("div", { class: "specsib" }, h("b", {}, "이름이 비슷한 다른 시술"), h("div", { class: "chips wrapc", style: "margin-top:6px" }, looks.map((f) =>
        h("button", { class: "chip", type: "button", onclick: () => { st.key = f.vs[0].k; nav(`compare?k=${encodeURIComponent(KEYS[f.vs[0].k].id)}`); } }, f.name))),
        h("button", { class: "linkbtn", type: "button", style: "margin-top:6px", onclick: () => nav("guide") }, icon("book-open", "xs"), "무엇이 다른지 시술 사전에서")) : null);
  }

  // ---- 가격 적용 조건 요약 (Spec.eligibility): first visit, trial price, VAT, period, other stated limits
  const tagsOf = (i) => (S[ROWS[i][6]] || "").split("·").filter(Boolean);
  const eligOf = (i) => { const r = ROWS[i]; return Spec.eligibility({ name: S[r[2]], kind: r[5], tags: tagsOf(i).filter((t) => t === "첫 방문"), vat: r[12], until: S[r[10]] || "", today: today(),
    conds: priceConds(i).filter((c) => !/첫 방문|신규|체험|한정/.test(c)) }); };
  const ELIG_IC = { limit: "lock", none: "circle-check", unknown: "circle-help" }, ELIG_T = { limit: "조건 있음", none: "제한 없음", unknown: "미확인" };
  const ELIG_TERM = { "첫 방문": "첫 방문", "체험 가격": "체험가", "부가세": "부가세 별도" };
  const eligList = (i) => h("ul", { class: "elig" }, eligOf(i).map((x) => h("li", { class: `el-${x.state}` }, h("span", { class: "ei2" }, icon(ELIG_IC[x.state], "sm")),
    h("span", { class: "ek" }, ELIG_TERM[x.k] ? termBtn(ELIG_TERM[x.k], x.k) : x.k), h("span", { class: "ev" }, x.v), h("span", { class: "sr" }, ` (${ELIG_T[x.state]})`))));
  // short form for comparison rows: only the stated limits, plus how many things are not stated
  const eligChips = (i) => { const e = eligOf(i), lim = e.filter((x) => x.state === "limit"), unk = e.filter((x) => x.state === "unknown").length;
    return [...lim.map((x) => h("span", { class: "k kx" }, x.k === "부가세" ? "VAT 별도" : x.k === "기간" ? x.v : x.k === "체험 가격" ? x.v.split(" — ")[0] : x.k)), unk ? h("span", { class: "k k4" }, `미확인 ${unk}`) : null]; };

  // ---- 비교함 (shortlist, 2~4 branches, this phone only) → 빠른 비교 (#quick)
  const SHORT_MAX = 4;
  const shortKeys = () => (store.get("short", []) || []).filter((x) => BK.has(x));
  const shortList = () => shortKeys().map((x) => BK.get(x));
  const inShort = (b) => shortKeys().includes(bkey(b));
  function toggleShort(b) {
    let L = shortKeys(); const key = bkey(b);
    if (L.includes(key)) { const before = L; L = L.filter((x) => x !== key); store.set("short", L); undoToast(`비교함에서 뺐어요 (${L.length}/${SHORT_MAX})`, () => { store.set("short", before); render(); }); return true; }
    if (L.length >= SHORT_MAX) { toast(`비교함은 ${SHORT_MAX}곳까지예요. 한 곳을 빼고 담아 주세요`); return false; }
    store.set("short", [...L, key]);
    const n = L.length + 1;
    if (n >= 2) actToast(`비교함에 담았어요 (${n}/${SHORT_MAX})`, ["빠른 비교", () => nav("quick")]); else toast(`비교함에 담았어요 (${n}/${SHORT_MAX}) — 한 곳 더 담으면 비교할 수 있어요`);
    return true;
  }
  // a button that shows and flips the state in place (works inside sheets, no page redraw)
  const shortBtn = (b, cls = "btn sm gray") => { const el = h("button", { class: cls, type: "button" });
    const paint = () => { const on = inShort(b); el.setAttribute("aria-pressed", on ? "true" : "false"); fill(el, icon(on ? "check" : "circle-plus", "sm"), on ? "비교함에 있음" : "비교함"); };
    el.addEventListener("click", (e) => { e.stopPropagation(); toggleShort(b); paint(); }); paint(); return el; };
  const shortLink = () => { const n = shortKeys().length; return n ? h("button", { class: "linkbtn", type: "button", onclick: () => nav("quick") }, icon("scale", "xs"), `비교함 ${n}/${SHORT_MAX} 보기`) : null; };
  function pickBranchSheet(title, except, done) {
    sheet(title, (close) => { let v = BR.find((x) => !except.includes(x.i) && regionOk(x.i))?.i ?? 0;
      return h("div", {}, brSelect(v, (x) => { v = x; }, "지점"), h("button", { class: "btn", type: "button", style: "width:100%;margin-top:12px", onclick: () => { if (except.includes(v)) { toast("이미 비교함에 있는 지점이에요"); return; } close(); done(v); } }, "고르기")); });
  }
  views.quick = (arg, params) => {
    const box = h("div", { class: "view" });
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
    const bs = shortList();
    const setL = (L) => { store.set("short", L.map((b) => bkey(b))); render(); };
    box.append(h("div", { class: "card" }, h("h2", {}, "빠른 비교"),
      h("div", { class: "sub", style: "margin-top:4px" }, `지점 2~${SHORT_MAX}곳을 같은 사양끼리 맞대요. 담은 지점은 이 휴대폰에만 저장돼요.`),
      h("ul", { class: "shortl" }, bs.map((b, n) => h("li", {}, bdot(b), h("b", {}, bname(b)), h("span", { class: "sp" }),
        h("button", { class: "linkbtn", type: "button", onclick: () => pickBranchSheet(`${bname(b)} 대신`, bs, (v) => { const L = [...bs]; L[n] = v; setL(L); }) }, "바꾸기"),
        h("button", { class: "tbtn-i", type: "button", "aria-label": `${bname(b)} 빼기`, onclick: () => { const before = bs; setL(bs.filter((x) => x !== b)); undoToast("비교함에서 뺐어요", () => setL(before)); } }, icon("x", "sm"))))),
      bs.length < SHORT_MAX ? h("button", { class: "btn sm soft", type: "button", onclick: () => pickBranchSheet("비교함에 지점 추가", bs, (v) => setL([...bs, v])) }, icon("circle-plus", "sm"), `지점 추가 (${bs.length}/${SHORT_MAX})`) : null));
    if (bs.length < 2) {
      const F = favs(), sug = [...new Set([...F.b.map((x) => BK.get(x)), ...store.get("recent", []).filter((x) => x.startsWith("b:")).map((x) => BK.get(x.slice(2)))])].filter((b) => b != null && BR[b] && !bs.includes(b)).slice(0, 6);
      box.append(h("div", { class: "card" }, jomiEmpty("cart", "비교할 지점을 2곳 이상 담아 줘",
        h("p", { class: "sub" }, "시술 비교의 카드 보기, 지점 화면, 가격 근거에서 '비교함'을 누르거나 위 '지점 추가'로 담아요."),
        sug.length ? h("div", { class: "chips wrapc", style: "margin-top:10px;justify-content:center" }, sug.map((b) => h("button", { class: "chip", type: "button", onclick: () => setL([...bs, b]) }, icon("circle-plus", "xs"), bname(b)))) : null)));
      return box;
    }
    // the treatment: from the address (?k=), else the one being compared, else the cart's first, else the most shared
    const cand = KEYS.map((k) => ({ k: k.i, n: bs.filter((b) => bestAt(k.i, b) >= 0).length })).filter((x) => x.n >= 1).sort((a, c) => c.n - a.n || byKB[c.k].size - byKB[a.k].size);
    const cartK = cur().items.filter((it) => it.t === "k" && KI[it.k] != null).map((it) => KI[it.k]);
    const want = params.get("k") != null ? KI[params.get("k")] : null;
    const k = [want, st.qk, st.key, ...cartK].find((x) => x != null && cand.some((c) => c.k === x)) ?? (cand[0] && cand[0].k);
    if (k == null) { box.append(h("div", { class: "card empty" }, "담은 지점들이 함께 파는 시술이 없어요. 지점을 바꿔 보세요.")); return box; }
    st.qk = k;
    const go = (x) => { st.qk = x; history.replaceState(null, "", `#quick?k=${encodeURIComponent(KEYS[x].id)}`); render(); };
    const sel = h("select", { class: "pick", "aria-label": "비교할 시술", onchange: (e) => go(+e.target.value) }, cand.slice(0, 400).map((c) => h("option", { value: c.k, selected: c.k === k }, `${KEYS[c.k].label} · ${c.n}/${bs.length}곳`)));
    box.append(h("div", { class: "card" }, h("label", { class: "flabel" }, "비교할 시술(같은 사양끼리)", sel),
      cartK.length ? h("div", { class: "chips", style: "margin-top:8px" }, h("span", { class: "sub", style: "align-self:center;flex:none" }, "장바구니"), [...new Set(cartK)].map((x) => h("button", { class: "chip", type: "button", "aria-pressed": x === k ? "true" : "false", onclick: () => go(x) }, KEYS[x].label))) : null,
      h("div", { class: "row", style: "margin-top:8px" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }))));
    // rows in the user's order; a branch without the same spec is shown as not comparable (and what it has instead)
    const rows = bs.map((b) => { const i = bestAt(k, b); return { b, i, p: i >= 0 ? ROWS[i][3] : null }; });
    // differences are against the user's own baseline (the first comparable branch in their list), never against 'the lowest'
    // clinic — the app does not single out the cheapest (docs/OBJECTIVE_DISPLAY_POLICY.md); '기준으로' moves a branch to the front
    const ok = rows.filter((x) => x.i >= 0), lo = ok.length ? Math.min(...ok.map((x) => x.p)) : 0, hi = ok.length ? Math.max(...ok.map((x) => x.p)) : 0, base = ok[0];
    const toFront = (b) => setL([b, ...bs.filter((y) => y !== b)]);
    const vsBase = (x) => x === base ? "기준 지점" : x.p === base.p ? "기준과 같은 가격" : `기준보다 ${won(Math.abs(x.p - base.p))} ${x.p > base.p ? "높아요" : "낮아요"}`;
    const fm = famOf[k], sp = specOfKey(k);
    const other = (b) => fm ? fm.f.vs.filter((v) => v.k !== k).map((v) => ({ v, i: bestAt(v.k, b) })).filter((x) => x.i >= 0).slice(0, 2) : [];
    box.append(h("section", { class: "card flush", "aria-label": "빠른 비교 결과" },
      h("div", { style: "padding:14px 14px 6px" }, h("h3", {}, KEYS[k].label),
        h("div", { class: "sub" }, sp.filter((x) => x.state === "known" && x.k !== "시술").map((x) => `${x.k} ${x.v}`).join(" · ") || "이름에 규격 정보가 없어요"),
        ok.length >= 2 ? h("div", { class: "vsum", style: "margin-top:8px;font-size:19px" }, lo === hi ? "고른 지점의 가격이 같아요" : `고른 ${ok.length}곳 사이 최대 ${won(hi - lo)} 차이`)
          : h("div", { class: "sub", style: "margin-top:8px" }, "같은 사양을 파는 곳이 1곳뿐이라 차이를 계산하지 않아요.")),
      h("ul", { class: "list qrows" }, rows.map((x) => x.i >= 0
        ? h("li", { class: "qrow2" }, h("div", { class: "row" }, bdot(x.b), h("b", { class: "qn" }, bname(x.b)), h("span", { class: "sp" }), h("b", { class: "num qp" }, won(x.p))),
          h("span", { class: "qbar", "aria-hidden": "true" }, h("i", { class: x === base ? "base" : "", style: `width:${hi ? Math.max(6, x.p / hi * 100) : 100}%` })),
          h("div", { class: "m" }, h("span", { class: "qd" }, ok.length < 2 ? "비교할 다른 곳 없음" : vsBase(x)), ...eligChips(x.i),
            x !== base && ok.length >= 2 ? h("button", { class: "linkbtn", type: "button", onclick: () => toFront(x.b) }, "기준으로") : null,
            h("span", { class: "tiny" }, `확인 ${verified(x.b)}`), srcLink(x.i), h("button", { class: "linkbtn", type: "button", onclick: () => priceSheet(x.i) }, icon("info", "xs"), "가격 근거")))
        : h("li", { class: "qrow2 na" }, h("div", { class: "row" }, bdot(x.b), h("b", { class: "qn" }, bname(x.b)), h("span", { class: "sp" }), h("span", { class: "k k4" }, "비교 불가")),
          h("div", { class: "m" }, h("span", {}, "같은 사양(용량·회차·원산지)의 가격이 없어요."),
            ...other(x.b).map((o) => h("span", {}, `비슷한 규격: ${o.v.label} ${won(ROWS[o.i][3])} — ${Spec.diff(sp, specOfKey(o.v.k)).map((d) => `${d.k}가 달라`).join(", ") || "규격이 달라"} 비교하지 않아요`)))))),
      h("div", { class: "row qact" }, h("button", { class: "btn sm gray", type: "button", onclick: () => checklistSheet({ id: `k:${KEYS[k].id}`, title: KEYS[k].label, k }) }, icon("list-checks", "sm"), "방문 전 체크리스트"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => saveSnap(snapOfKey(k, bs)) }, icon("bookmark", "sm"), "이 비교 저장"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => reportView(k, bs) }, icon("file-text", "sm"), "비교 보고서"), addBtn(k))));
    box.append(coverageCard(bs));
    box.append(h("p", { class: "foot" }, `${vatNote()} 차이는 고른 지점끼리의 병원 공개 가격 차이예요. 정품 여부·시술 의료진·부작용은 병원에 확인하세요.`));
    return box;
  };

  // ---- 지점별 제공 시술 표 (coverage): the cart's items × the shortlist; '없음' and '확인 안 됨' are never counted as offered
  function coverageCard(bs) {
    const its = cur().items;
    if (!its.length || bs.length < 1) return h("div", { class: "card sub" }, "장바구니에 시술을 담으면, 고른 지점마다 어떤 시술을 하는지 한 표로 보여줘요.");
    const lines = bs.map((b) => cartLinesAt(b, its));
    const cell = (j, n) => { const l = lines[n][j], b = bs[n];
      return l ? h("td", { class: "num", title: l.incomplete ? incTxt(l) : null }, l.incomplete ? `1회 ${won(l.total)}만` : won(l.total)) : fresh(b).stale ? h("td", { class: "cov-q" }, "확인 안 됨") : h("td", { class: "cov-x" }, "없음"); };
    const tot = bs.map((b, n) => { const got = lines[n].filter(okL); return { b, sum: got.reduce((s, l) => s + l.total, 0), miss: its.length - got.length }; });
    return h("section", { class: "card flush", "aria-label": "지점별 제공 시술" },
      h("div", { style: "padding:14px 14px 6px" }, h("h3", {}, "지점별 제공 시술"), h("div", { class: "sub" }, `'${cur().name}'의 ${its.length}개 시술 · 장바구니와 같은 계산(수량·첫 방문가 1개)`)),
      h("div", { class: "covwrap", tabindex: "0", role: "region", "aria-label": "지점별 제공 시술 표(옆으로 넘겨 보기)" }, h("table", { class: "cov" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "시술"), bs.map((b) => h("th", { scope: "col" }, BR[b].name)))),
        h("tbody", {}, its.map((it, j) => h("tr", {}, h("th", { scope: "row" }, `${itemLabel(it)} ×${it.q || 1}`), bs.map((_, n) => cell(j, n))))),
        h("tfoot", {}, h("tr", {}, h("th", { scope: "row" }, "있는 시술 합계"), tot.map((x) => h("td", { class: "num" }, won(x.sum), x.miss ? h("small", {}, ` · ${x.miss}개 없음`) : null)))))),
      h("p", { class: "tiny", style: "padding:8px 14px 14px" }, "'없음' = 이번 주 그 지점 가격표에 같은 시술이 없어요. '확인 안 됨' = 그 지점 수집이 이번 주 실패했어요. 둘 다 0원으로 치지 않고 합계에서 뺐어요."));
  }

  // ---- 비교 보고서: chosen treatments (cart) or one treatment × the chosen branches, with conditions and the time it was made
  const stamp = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  function reportText(k, bs) {
    const at = new Date().toISOString(), its = cur().items;
    const head = [`[윤실장 비교 보고서] ${stamp(at)} 작성 · 가격 데이터 ${D.meta.updated} 수집 · ${st.vat === "incl" ? "부가세 포함 예상가" : "병원 표시가"}`];
    if (its.length) {
      const lines = bs.map((b) => cartLinesAt(b, its)), full = bs.map((b, n) => lines[n].every(okL) ? lines[n].reduce((s, l) => s + l.total, 0) : null), baseT = full.find((x) => x != null);
      const vsT = (t) => t === baseT ? " (기준)" : ` (기준보다 ${t > baseT ? "+" : "−"}${won(Math.abs(t - baseT))})`;
      head.push(`시술: ${its.map((it) => `${itemLabel(it)} ×${it.q || 1}`).join(", ")}`, "지점별 예상 총액(장바구니 계산과 같음):");
      bs.forEach((b, n) => { const got = lines[n].filter(okL), miss = its.filter((_, j) => !okL(lines[n][j])), sp = got.filter((l) => l.special).length;
        head.push(full[n] != null ? `- ${bname(b)}: ${won(full[n])}${full.filter((x) => x != null).length > 1 ? (n === full.findIndex((x) => x != null) ? " (기준)" : vsT(full[n]).replace(" (기준)", " (기준과 같음)")) : ""}${sp ? ` · 조건부 가격 ${sp}개 포함` : ""}`
          : `- ${bname(b)}: 일부만 가능 — 없음: ${miss.map(itemLabel).join(", ")} (있는 것만 ${won(got.reduce((s, l) => s + l.total, 0))}, 총액 비교에서 뺌)`); });
      head.push(`가격 적용 조건: 특가(체험가·한정가)는 첫 1회만(일반가가 없으면 2회째부터 가격 없음으로 빼요)${st.noStack ? ", 첫 방문가는 지점마다 1개만" : ""}. 없는 시술은 0원으로 치지 않았어요.`);
    } else {
      const rows = bs.map((b) => ({ b, i: bestAt(k, b) })), ok = rows.filter((x) => x.i >= 0), bp = ok.length ? ROWS[ok[0].i][3] : 0;
      head.push(`시술: ${KEYS[k].label} ×1 (같은 사양끼리)`);
      rows.forEach((x) => { if (x.i < 0) { head.push(`- ${bname(x.b)}: 같은 사양 없음(비교 불가)`); return; }
        const e = eligOf(x.i).filter((y) => y.state === "limit").map((y) => y.v.split(" — ")[0]);
        const p0 = ROWS[x.i][3];
        head.push(`- ${bname(x.b)}: ${won(p0)}${ok.length > 1 ? (x === ok[0] ? " (기준)" : p0 === bp ? " (기준과 같음)" : ` (기준보다 ${p0 > bp ? "+" : "−"}${won(Math.abs(p0 - bp))})`) : ""} · 확인 ${verified(x.b)}${e.length ? ` · 조건: ${e.join(", ")}` : ""}`); });
    }
    head.push("기준 = 비교함 맨 위 지점(사용자가 정한 순서). 윤실장은 가장 싼 곳을 따로 고르지 않아요.", "병원 공개 가격을 모은 참고값이에요. 예약 전 병원에서 가격·조건·정품 여부·시술 의료진을 꼭 확인하세요. — 윤실장(시연)");
    return { at, text: head.join("\n") };
  }
  function reportView(k, bs) {
    const rep = reportText(k, bs);
    sheet("비교 보고서", (close) => h("div", {}, h("pre", { class: "report" }, rep.text),
      h("div", { class: "row", style: "margin-top:12px;gap:8px" },
        h("button", { class: "btn sm gray", type: "button", onclick: () => copyText(rep.text, "보고서를 복사했어요") }, icon("copy", "sm"), "복사"),
        h("button", { class: "btn sm gray", type: "button", onclick: async () => { try { if (navigator.share) { await navigator.share({ title: "윤실장 비교 보고서", text: rep.text }); return; } } catch (e) { if (e && e.name === "AbortError") return; } copyText(rep.text, "공유 기능이 없어 복사했어요"); } }, icon("share-2", "sm"), "공유"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { saveSnap({ id: newId(), at: rep.at, data: D.meta.updated, kind: "report", title: `보고서 · ${cur().items.length ? cur().name : KEYS[k].label}`, text: rep.text }); close(); } }, icon("bookmark", "sm"), "보관")),
      h("p", { class: "tiny", style: "margin-top:8px" }, "이 휴대폰에서 만든 글이에요. 서버로 보내지 않아요.")));
  }

  // ---- 비교 저장 (snapshots): prices and check dates as they were, kept apart from today's prices (this phone only)
  function snapOfKey(k, bs) {
    const list = (bs || ranking(k, "region").map((x) => x.b)).slice(0, 80).map((b) => { const i = bestAt(k, b);
      return i < 0 ? { b: bkey(b), name: bname(b), none: true } : { b: bkey(b), name: bname(b), row: S[ROWS[i][2]], listed: ROWS[i][14], vat: ROWS[i][12], ver: verified(b), cond: isSpecial(ROWS[i]) }; });
    return { id: newId(), at: new Date().toISOString(), data: D.meta.updated, kind: bs ? "quick" : "key", k: KEYS[k].id, title: KEYS[k].label, vatMode: st.vat, special: st.special, region: regionName(), items: list };
  }
  function saveSnap(snap) {
    const L = store.get("snaps", []); L.unshift(snap); store.set("snaps", L.slice(0, 20));
    actToast("비교를 저장했어요 — 관심 탭 '저장한 비교'", ["보기", () => nav(`snap/${snap.id}`)]);
  }
  views.snap = (arg) => {
    const box = h("div", { class: "view" });
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
    const L = store.get("snaps", []), s = L.find((x) => x.id === arg);
    if (!s) { box.append(h("div", { class: "card empty" }, "저장한 비교를 찾지 못했어요. 지웠거나 다른 휴대폰에서 저장했을 수 있어요.")); return box; }
    const del = h("button", { class: "btn sm gray", type: "button", onclick: () => { store.set("snaps", L.filter((x) => x.id !== s.id)); nav("saved"); undoToast("저장한 비교를 지웠어요", () => store.set("snaps", L)); } }, icon("trash-2", "sm"), "지우기");
    const same = s.data === D.meta.updated;
    box.append(h("div", { class: "card" }, h("h2", {}, s.title), h("dl", { class: "kv", style: "margin-top:8px" },
      h("dt", {}, "저장한 때"), h("dd", {}, `${stamp(s.at)} (가격 데이터 ${s.data})`), h("dt", {}, "지금 데이터"), h("dd", {}, D.meta.updated),
      s.region ? [h("dt", {}, "조건"), h("dd", {}, `${s.region} · ${s.vatMode === "incl" ? "부가세 포함 예상가" : "병원 표시가"} · 특가 ${s.special ? "포함" : "제외"}`)] : null),
      h("p", { class: "sub", style: "margin-top:6px" }, same ? "저장한 뒤 가격 데이터가 아직 갱신되지 않았어요. 그래서 '저장 시점'과 '지금'이 같아요." : "왼쪽은 저장한 때의 가격, 오른쪽은 지금 데이터의 가격이에요."),
      h("div", { class: "row", style: "margin-top:8px;gap:8px" }, s.k && KI[s.k] != null ? h("button", { class: "btn sm", type: "button", onclick: () => nav(`compare?k=${encodeURIComponent(s.k)}`) }, "지금 비교 화면 열기") : null, del)));
    if (s.kind === "report") { box.append(h("div", { class: "card" }, h("pre", { class: "report" }, s.text), h("button", { class: "btn sm gray", type: "button", style: "margin-top:10px", onclick: () => copyText(s.text, "복사했어요") }, icon("copy", "sm"), "복사"))); return box; }
    const k = KI[s.k];
    const shown = (listed, vat) => Pricing.vatPrice(listed, vat, s.vatMode);
    box.append(h("div", { class: "card flush" }, h("div", { class: "covwrap" }, h("table", { class: "cov snapt" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "지점"), h("th", { scope: "col" }, "저장 시점"), h("th", { scope: "col" }, "지금"))),
      h("tbody", {}, s.items.map((x) => { const b = BK.get(x.b), i = k != null && b != null ? bestAt(k, b, s.special) : -1, now = i >= 0 ? shown(ROWS[i][14], ROWS[i][12]) : null, then = x.none ? null : shown(x.listed, x.vat);
        return h("tr", {}, h("th", { scope: "row" }, x.name, x.ver ? h("small", {}, ` · 확인 ${x.ver}`) : null), h("td", { class: "num" }, then != null ? won(then) : "없었음"),
          h("td", { class: `num ${now != null && then != null && now !== then ? (now < then ? "down" : "up") : ""}` }, now != null ? won(now) : "지금 없음", now != null && then != null && now !== then ? h("small", {}, ` (${now < then ? "−" : "+"}${won(Math.abs(now - then))})`) : null)); }))))));
    return box;
  }

  // ---- 방문 전 체크리스트: questions to ask before booking, from what the price says (and doesn't); checks kept on this phone
  function checklistItems(ctx) {
    const out = [], i = ctx.i, sp = i != null ? specOfRow(i) : ctx.k != null ? specOfKey(ctx.k) : [], el = i != null ? eligOf(i) : [];
    const g = (k) => el.find((x) => x.k === k);
    out.push(["incl", "가격 포함 범위", "이 가격에 마취크림·진정 관리·재료비가 들어 있나요?"]);
    const v = g("부가세");
    out.push(["vat", "부가세", v ? (v.state === "limit" ? "결제할 땐 부가세 포함 얼마인가요? (사이트 표기: 부가세 별도)" : v.state === "none" ? "부가세 포함 가격이 맞나요?" : "부가세가 포함된 가격인가요? (사이트에서 표기를 찾지 못했어요)") : "결제 금액에 부가세가 포함되나요?"]);
    const fv = g("첫 방문"), tr = g("체험 가격"), pd = g("기간");
    if ((fv && fv.state === "limit") || (tr && tr.state === "limit")) out.push(["promo", "가격 조건", `제가 이 가격 조건(${[fv && fv.state === "limit" ? "첫 방문" : "", tr && tr.state === "limit" ? tr.v.split(" — ")[0] : ""].filter(Boolean).join(", ")})에 해당하나요?`]);
    else out.push(["promo", "가격 조건", "이 가격에 첫 방문·1인 1회 같은 조건이 있나요?"]);
    if (pd && pd.state === "limit") out.push(["period", "기간", `${pd.v} 가격이면, 그 안에 시술해야 하나요 아니면 예약만 하면 되나요?`]);
    for (const x of sp) {
      if (x.k === "제품·장비") out.push(["prod", "시술 규격", x.state === "known" ? `${x.v} 정품을 쓰나요? 확인할 수 있나요?` : "어떤 제품(제조사·원산지)을 쓰나요?"]);
      if (x.k === "용량·샷 수") out.push(["dose", "시술 규격", "용량(U·cc)이나 샷 수가 얼마인가요?"]);
      if ((x.k === "용량" || x.k === "샷 수") && x.state === "known") out.push(["dose", "시술 규격", `${x.k} ${x.v}가 맞나요? 상담 뒤 바뀔 수 있나요?`]);
      if (x.k === "부위") out.push(["area", "시술 규격", x.state === "known" ? `'${x.v}'의 범위가 어디부터 어디까지인가요?` : "어느 부위·범위까지인가요?"]);
    }
    out.push(["who", "의료진에게", "누가 시술하나요?"], ["side", "의료진에게", "부작용이나 불편이 생기면 어떻게 하나요?"], ["retouch", "의료진에게", "리터치·재방문 비용이 따로 있나요?"]);
    return out;
  }
  function checklistSheet(ctx) {
    const items = checklistItems(ctx), all = store.get("checks", {}), done = new Set(all[ctx.id] || []);
    const save = () => { const A = store.get("checks", {}); A[ctx.id] = [...done]; store.set("checks", A); };
    sheet("방문 전 체크리스트", (close) => { const box = h("div", {});
      const paint = () => fill(box, h("div", { class: "sub" }, `${ctx.title} · ${done.size}/${items.length} 확인`), h("div", { class: "prog", "aria-hidden": "true" }, h("i", { style: `width:${items.length ? done.size / items.length * 100 : 0}%` })),
        h("ul", { class: "chk-list" }, items.map(([id, grp, q]) => h("li", {}, h("label", { class: "chkrow" }, h("input", { type: "checkbox", checked: done.has(id), onchange: (e) => { if (e.target.checked) done.add(id); else done.delete(id); save(); paint(); } }),
          h("span", {}, h("small", {}, grp), h("span", {}, q)))))),
        h("p", { class: "tiny" }, "상담 때 물어볼 것들이에요. 진단이나 시술 권유가 아니에요. 체크는 이 휴대폰에만 저장돼요."),
        h("div", { class: "row", style: "margin-top:10px;gap:8px" }, h("button", { class: "btn sm gray", type: "button", onclick: () => copyText([`[방문 전 체크리스트] ${ctx.title}`, ...items.map(([id, grp, q]) => `${done.has(id) ? "☑" : "☐"} ${q}`)].join("\n"), "체크리스트를 복사했어요") }, icon("copy", "sm"), "복사"),
          h("button", { class: "btn sm gray", type: "button", onclick: () => { done.clear(); save(); paint(); } }, "체크 모두 지우기")));
      paint(); return box; });
  }

  // ---- 지역별 같은 사양 가격: by 시·도, plain prices, the brand filter applied, any region; small samples are said so
  function regionalCard(k) {
    const per = new Map();
    for (const [b, rows] of byKB[k]) {
      if (!brandOn(b)) continue;
      let best = -1; for (const i of rows) if (live(i) && plainOk(i) && (best < 0 || ROWS[i][3] < ROWS[best][3])) best = i;
      if (best < 0) continue;
      const rg = BR[b].region || "기타"; if (!per.has(rg)) per.set(rg, []); per.get(rg).push(ROWS[best][3]);
    }
    if (per.size < 2) return null;
    const regs = [...per.entries()].map(([rg, ps]) => { const s = [...ps].sort((a, c) => a - c); return { rg, n: s.length, lo: s[0], hi: s[s.length - 1], med: median(s) }; }).sort((a, c) => c.n - a.n || a.rg.localeCompare(c.rg, "ko"));
    const gl = Math.min(...regs.map((x) => x.lo)), gh = Math.max(...regs.map((x) => x.hi)), pos = (v) => gh > gl ? (v - gl) / (gh - gl) * 100 : 50;
    return h("section", { class: "card", "aria-label": "지역별 같은 사양 가격" }, h("h3", {}, "지역별 가격"),
      h("div", { class: "sub" }, "조건 없는 가격 · 지점마다 하나 · 위 지역 선택과 상관없이 전국(브랜드 필터는 적용)"),
      h("ul", { class: "regl" }, regs.map((x) => h("li", {}, h("span", { class: "rg" }, x.rg, x.n < 3 ? h("span", { class: "k k4" }, "표본 적음") : null),
        h("span", { class: "rbar", role: "img", "aria-label": `${x.rg} ${x.n}곳 ${won(x.lo)}~${won(x.hi)}, 중간값 ${won(x.med)}` }, h("i", { style: `left:${pos(x.lo)}%;width:${Math.max(1.5, pos(x.hi) - pos(x.lo))}%` }), h("b", { style: `left:${pos(x.med)}%` })),
        h("span", { class: "rv num" }, `${x.n}곳 · 중간 ${won(x.med)}`)))),
      regs.some((x) => x.n < 3) ? h("p", { class: "tiny", style: "margin-top:6px" }, "지점이 3곳 미만인 지역은 통계라기보다 개별 가격이에요. 지역 차이로 읽지 마세요.") : null);
  }

  // ---- 관심 시술 대시보드 + 업데이트 소식 (only what the weekly data actually recorded)
  function watchCard(favK) {
    if (!favK.length) return null;
    const tr = TR();
    return h("section", { class: "card flush", "aria-label": "관심 시술 가격" }, h("div", { style: "padding:14px 14px 4px" }, h("h3", {}, "관심 시술 가격"),
      h("div", { class: "sub" }, `${regionName()} · 조건 없는 가격 · 데이터 ${D.meta.updated}`)),
      h("ul", { class: "list" }, favK.map((k) => { const pl = plainRanking(k), ps = pl.map((x) => x.p), ch = keyChange(KEYS[k].id), last = pl.map((x) => verified(x.b)).sort().pop();
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k; nav(`compare?k=${encodeURIComponent(KEYS[k].id)}`); } },
          h("span", { class: "t row", style: "gap:10px;flex-wrap:nowrap" }, catIcon(KEYS[k].cat, "sm"), KEYS[k].label),
          h("span", { class: "p num" }, ps.length ? won(median(ps)) : "-"),
          h("span", { class: "m" }, ps.length ? h("span", {}, `중간값 · ${won(Math.min(...ps))} ~ ${won(Math.max(...ps))} · ${ps.length}곳`) : h("span", {}, "지금 조건 없는 가격이 없어요"),
            tr.dates.length > 1 ? chg(ch) : h("span", {}, "변화: 관측 1회라 아직 몰라요"), last ? h("span", {}, `확인 ${last}`) : null))); })));
  }
  function feedCard(favK) {
    const want = new Set(favK), items = (D.changes || []).filter(([kid]) => want.has(kid)).slice(0, 30);
    return h("section", { class: "card", "aria-label": "관심 시술 업데이트" }, h("h3", {}, "업데이트 소식"),
      h("div", { class: "sub" }, D.meta.prev ? `${D.meta.prev} → ${D.meta.updated} 사이 실제로 바뀐 관심 시술 가격` : "매주 월요일 가격을 모을 때마다, 관심 시술에서 실제로 바뀐 가격만 여기에 쌓여요."),
      !favK.length ? h("p", { class: "sub" }, "관심 시술(하트)을 정하면 그 시술의 새 가격 기록이 여기에 보여요.")
        : items.length ? h("ul", { class: "list" }, items.map(([kid, b, before, after]) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, KEYS[kid].label),
          h("span", { class: `p num ${after < before ? "down" : "up"}` }, `${won(before)} → ${won(after)}`), h("span", { class: "m" }, bdot(b), bname(b), h("span", {}, `${D.meta.updated} 수집`))))))
          : h("p", { class: "sub", style: "margin-top:6px" }, D.meta.prev ? "지난 기록과 비교해 바뀐 관심 시술 가격이 없어요." : `첫 기록(${D.meta.updated})이라 아직 비교할 이전 가격이 없어요. 다음 갱신 뒤부터 보여요. 가격 변동을 지어내지 않아요.`));
  }
  function snapsCard() {
    const L = store.get("snaps", []);
    if (!L.length) return null;
    return h("section", { class: "card flush", "aria-label": "저장한 비교" }, h("div", { style: "padding:14px 14px 4px" }, h("h3", {}, `저장한 비교 ${L.length}개`), h("div", { class: "sub" }, "저장한 때의 가격과 지금 가격을 나란히 봐요 · 이 휴대폰에만 있어요")),
      h("ul", { class: "list" }, L.map((s) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`snap/${s.id}`) },
        h("span", { class: "t row", style: "gap:10px;flex-wrap:nowrap" }, icon(s.kind === "report" ? "file-text" : "bookmark", "sm"), s.title),
        h("span", { class: "sub" }, stamp(s.at)), h("span", { class: "m" }, s.kind === "report" ? "보고서" : `${s.kind === "quick" ? "빠른 비교" : "시술 비교"} · ${(s.items || []).length}곳 · 데이터 ${s.data}`))))));
  }
  function myReportsCard() {
    const reps = store.get("reports", []);
    if (!reps.length) return null;
    const VIA = { demo: "기기에만 저장(데모 · 서버 접수 아님)", github: "GitHub 등록 화면을 열었어요(제출했는지는 GitHub에서 확인)", copy: "내용을 복사했어요(직접 보내야 해요)" };
    return h("section", { class: "card flush", "aria-label": "내 가격 확인 요청" }, h("div", { style: "padding:14px 14px 4px" }, h("h3", {}, `가격 확인 요청 ${reps.length}개`)),
      h("ul", { class: "list" }, reps.slice(0, 10).map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, x.n), h("span", { class: "sub" }, x.at),
        h("span", { class: "m" }, `${String(x.br || "").replace("|", " ")} · ${x.why}`, h("span", { class: x.via === "github" ? "k k4" : "k kx" }, VIA[x.via] || "기기에 기록(예전 방식)")))))));
  }

  // Korean subject particle for a name: 강남점이 / 서면이 … (final consonant → 이, else 가)
  const iga = (w) => { const c = String(w).charCodeAt(String(w).length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? "이" : "가"; };
  // 'OO점이 23,100원 저렴' between two branches (no sentence when equal)
  const cheaperTxt = (a, b, pa, pb) => { if (pa === pb) return "같은 가격"; const w = pa < pb ? a : b, nm = BR[a].name === BR[b].name ? bname(w) : BR[w].name; /* 블리비 안산점 vs 쁨 안산점: full names */ return `${nm}${iga(nm)} ${won(Math.abs(pa - pb))} 저렴`; };
  // two thin bars on one scale (the dearer price = full width); equal prices get no emphasis
  const pairBars = (pa, pb) => { const m = Math.max(pa, pb) || 1;
    return h("span", { class: "pbars", "aria-hidden": "true" }, h("i", { class: "a" + (pa < pb ? " lo" : ""), style: `width:${Math.max(4, pa / m * 100)}%` }), h("i", { class: "b" + (pb < pa ? " lo" : ""), style: `width:${Math.max(4, pb / m * 100)}%` })); };
  // the cart's lines at one branch, priced like the cart does (first-visit prices at most once per branch when st.noStack)
  function cartLinesAt(b, items) {
    let lines = items.map((it) => lineAt(it, b));
    if (st.noStack) lines = Pricing.limitOnce(lines, lines.map((l) => !!l && hasTag(l.rows[0], "첫 방문")), (j) => lineAt(items[j], b, true));
    return lines;
  }
  views.versus = (arg) => {
    const [a0, b0] = (arg || "").split("/").map((x) => (x === "" || x == null ? null : +x));
    if (a0 != null && BR[a0]) st.vsA = a0;
    if (b0 != null && BR[b0]) st.vsB = b0;
    const near = st.loc ? BR.filter((x) => x.lat != null).sort((p, q) => dist(p.i) - dist(q.i)).map((x) => x.i) : branchRanks().map((x) => x.b);
    if (st.vsA == null) st.vsA = near[0] ?? 0;
    if (st.vsB == null || st.vsB === st.vsA) st.vsB = near.find((x) => x !== st.vsA && BR[x].brand === BR[st.vsA].brand) ?? near.find((x) => x !== st.vsA) ?? 1;
    const A = st.vsA, B = st.vsB;
    const box = h("div", { class: "view" });
    box.append(cmpNav("versus"));
    box.append(h("div", { class: "card" }, h("h2", {}, "지점 비교"),
      h("div", { class: "vpick" }, h("label", { class: "flabel" }, h("span", { class: "row", style: "gap:6px" }, h("span", { class: "key", style: "background:var(--s1)" }), "A 지점"), brSelect(A, (v) => { st.vsA = v; render(); }, "A 지점")),
        h("button", { class: "swap", type: "button", "aria-label": "A와 B 바꾸기", onclick: () => { [st.vsA, st.vsB] = [st.vsB, st.vsA]; render(); } }, icon("arrow-down-up")),
        h("label", { class: "flabel" }, h("span", { class: "row", style: "gap:6px" }, h("span", { class: "key", style: "background:var(--s2)" }), "B 지점"), brSelect(B, (v) => { st.vsB = v; render(); }, "B 지점"))),
      h("div", { class: "row", style: "margin-top:8px" },
        ["A", "B"].map((w) => h("button", { class: "btn sm gray", type: "button", onclick: () => { const cur0 = w === "A" ? st.vsA : st.vsB, other = w === "A" ? st.vsB : st.vsA;
          const sib = BR.filter((y) => y.brand === BR[cur0].brand && regionOk(y.i) && y.i !== other).sort((p, q) => p.name.localeCompare(q.name, "ko"));
          const n = sib.findIndex((y) => y.i === cur0), nx = sib[(n + 1) % sib.length]; if (!nx) return; if (w === "A") st.vsA = nx.i; else st.vsB = nx.i; render(); } }, `${w}: 같은 브랜드 다음 지점`))),
      h("div", { class: "row", style: "margin-top:10px" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }),
        switchEl("차이 있는 것만", st.vsDiff, (v) => { st.vsDiff = v; render(); }),
        cur().items.length ? switchEl("장바구니 시술만", !!st.vsCart, (v) => { st.vsCart = v; render(); }) : null)));
    // sticky A/B legend for the long lists below (the colour keys alone don't say which clinic is which)
    const vsHead = () => h("div", { class: "vshead", "aria-hidden": "true" }, h("span", { class: "row" }, h("span", { class: "key", style: "background:var(--s1)" }), h("b", {}, "A"), h("span", {}, bname(A))),
      h("span", { class: "row" }, h("span", { class: "key", style: "background:var(--s2)" }), h("b", {}, "B"), h("span", {}, bname(B))));
    // cart-only: the user's own items at A and at B, priced like the cart; a missing item never counts as 0원
    if (st.vsCart && cur().items.length) {
      const its = cur().items, la = cartLinesAt(A, its), lb = cartLinesAt(B, its);
      const both = its.map((it, j) => ({ it, a: la[j], b: lb[j] })), shared = both.filter((x) => x.a && x.b);
      const ta = shared.reduce((t, x) => t + x.a.total, 0), tb = shared.reduce((t, x) => t + x.b.total, 0);
      const onlyA = both.filter((x) => x.a && !x.b), onlyB = both.filter((x) => !x.a && x.b), none = both.filter((x) => !x.a && !x.b);
      box.append(h("div", { class: "card" }, h("h3", {}, `'${cur().name}' ${its.length}개 시술로 비교`),
        shared.length ? h("div", { class: "vsum", style: "margin-top:6px" }, ta === tb ? "두 지점 합계가 같아요" : cheaperTxt(A, B, ta, tb)) : h("div", { class: "vsum", style: "margin-top:6px" }, "두 지점이 함께 하는 시술이 없어요"),
        shared.length ? h("dl", { class: "kv", style: "margin-top:8px" }, h("dt", {}, "A 합계"), h("dd", { class: "num" }, won(ta)), h("dt", {}, "B 합계"), h("dd", { class: "num" }, won(tb))) : null,
        h("div", { class: "sub", style: "margin-top:6px" }, `둘 다 하는 ${shared.length}개만 더했어요. 한쪽에 없는 시술은 0원으로 치지 않고 아래에 따로 적었어요.${st.noStack ? " 첫 방문가는 지점마다 하나만 넣었어요." : ""}`)));
      const row = (x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, `${itemLabel(x.it)} ×${x.it.q || 1}`),
        h("span", { class: "p num" }, x.a && x.b ? (x.a.total === x.b.total ? "같음" : won(Math.abs(x.a.total - x.b.total)) + " 차이") : "한쪽 없음"),
        h("span", { class: "m" }, x.a && x.b ? pairBars(x.a.total, x.b.total) : null,
          h("span", { class: "row", style: "gap:4px" }, h("span", { class: "key", style: "background:var(--s1)" }), x.a ? h("b", {}, won(x.a.total)) : h("span", { class: "up" }, "없음")),
          h("span", { class: "row", style: "gap:4px" }, h("span", { class: "key", style: "background:var(--s2)" }), x.b ? h("b", {}, won(x.b.total)) : h("span", { class: "up" }, "없음")),
          x.a && x.b && x.a.total !== x.b.total ? h("span", { class: "vwin" }, cheaperTxt(A, B, x.a.total, x.b.total)) : null)));
      box.append(h("div", { class: "card flush" }, vsHead(), h("ul", { class: "list" }, [...shared, ...onlyA, ...onlyB, ...none].map(row)),
        onlyA.length || onlyB.length || none.length ? h("div", { class: "sub", style: "padding:10px 14px 14px" },
          [onlyA.length ? `A에만 있음: ${onlyA.map((x) => itemLabel(x.it)).join(", ")}` : "", onlyB.length ? `B에만 있음: ${onlyB.map((x) => itemLabel(x.it)).join(", ")}` : "",
            none.length ? `둘 다 없음: ${none.map((x) => itemLabel(x.it)).join(", ")}` : ""].filter(Boolean).join(" · ")) : null));
      return box;
    }
    // shared options: auto groups + cross-brand keys
    const items = [];
    const seen = new Set();
    for (let g = 0; g < GR.length; g++) {
      const s = gstat(g), pa = s.per.get(A), pb = s.per.get(B);
      if (pa && pb) { items.push({ name: GR[g].label, cat: GR[g].cat, a: pa.p, b: pb.p, ia: pa.i, ib: pb.i }); seen.add(`${pa.i}|${pb.i}`); }
    }
    for (const k of KEYS) {
      const ia = bestAt(k.i, A), ib = bestAt(k.i, B);
      if (ia >= 0 && ib >= 0 && !seen.has(`${ia}|${ib}`)) items.push({ name: `${k.label} (같은 시술)`, cat: ROWS[ia][1], a: ROWS[ia][3], b: ROWS[ib][3], ia, ib });
    }
    if (!items.length) { box.append(h("div", { class: "card empty" }, "두 지점이 함께 파는 옵션이 없어요. 같은 브랜드 지점끼리 비교해 보세요.")); return box; }
    const lg = items.reduce((s, x) => s + Math.log(x.a / x.b), 0) / items.length, ratio = Math.exp(lg);
    const win = items.filter((x) => x.a < x.b).length, lose = items.filter((x) => x.a > x.b).length, tie = items.length - win - lose;
    box.append(h("div", { class: "card" },
      h("div", { class: "vsum" }, Math.abs(ratio - 1) < 0.005 ? "두 지점 가격이 거의 같아요" : ratio < 1 ? `A가 B보다 평균 ${Math.round((1 - ratio) * 100)}% 싸요` : `B가 A보다 평균 ${Math.round((1 - 1 / ratio) * 100)}% 싸요`),
      h("div", { class: "sub" }, `${bname(A)} vs ${bname(B)} · 함께 파는 옵션 ${items.length}개`),
      h("div", { class: "vbar", role: "img", "aria-label": `A가 싼 옵션 ${win}개, 같음 ${tie}개, B가 싼 옵션 ${lose}개` },
        win ? h("i", { style: `flex:${win};background:var(--s1)` }) : null, tie ? h("i", { style: `flex:${tie};background:var(--line)` }) : null, lose ? h("i", { style: `flex:${lose};background:var(--s2)` }) : null),
      h("div", { class: "stats" }, h("div", {}, h("b", { class: "num" }, win), h("span", {}, "A가 더 쌈")), h("div", {}, h("b", { class: "num" }, tie), h("span", {}, "같음")), h("div", {}, h("b", { class: "num" }, lose), h("span", {}, "B가 더 쌈"))),
      h("button", { class: "btn sm gray", type: "button", style: "margin-top:10px", onclick: () => copyText([`[지점 비교] A ${bname(A)} vs B ${bname(B)} (${D.meta.updated} 기준)`,
        `함께 파는 옵션 ${items.length}개 · A가 더 쌈 ${win} · 같음 ${tie} · B가 더 쌈 ${lose}`,
        ratio < 1 ? `A가 평균 ${Math.round((1 - ratio) * 100)}% 쌈` : ratio > 1 ? `B가 평균 ${Math.round((1 - 1 / ratio) * 100)}% 쌈` : "평균 같음",
        ...items.filter((x) => x.a !== x.b).sort((p, q) => Math.abs(q.a - q.b) - Math.abs(p.a - p.b)).slice(0, 5).map((x) => `- ${x.name}: A ${won(x.a)} / B ${won(x.b)}`)].join("\n"), "비교 결과를 복사했어요") }, "비교 결과 복사"),
      h("button", { class: "btn sm gray", type: "button", style: "margin:10px 0 0 6px", onclick: () => shareLink(`윤실장 · ${bname(A)} vs ${bname(B)}`, `versus/${A}/${B}`) }, icon("share-2", "sm"), "링크 공유")));
    // treatments only one of the two sells (same comparison key) — shown, not silently dropped
    const onlyAt = (x, y) => KEYS.filter((k) => bestAt(k.i, x) >= 0 && bestAt(k.i, y) < 0);
    const oa = onlyAt(A, B), ob = onlyAt(B, A);
    if (oa.length || ob.length) box.append(h("details", { class: "card flush fold" }, h("summary", {}, `한쪽에만 있는 시술: A에만 ${oa.length}개 · B에만 ${ob.length}개`),
      h("div", { style: "padding:0 14px 14px" }, h("div", { class: "sub" }, "같은 용량·회차로 묶은 시술 기준이에요. 아래 목록은 두 지점이 함께 파는 것만 맞대요."),
        oa.length ? h("p", { class: "sub" }, h("b", {}, `A ${bname(A)}: `), oa.slice(0, 30).map((k) => k.label).join(", "), oa.length > 30 ? ` 외 ${oa.length - 30}개` : "") : null,
        ob.length ? h("p", { class: "sub" }, h("b", {}, `B ${bname(B)}: `), ob.slice(0, 30).map((k) => k.label).join(", "), ob.length > 30 ? ` 외 ${ob.length - 30}개` : "") : null)));
    const cats = [...new Set(items.map((x) => x.cat))].sort((p, q) => p - q);
    if (st.vcat >= 0 && !cats.includes(st.vcat)) st.vcat = -1;
    const q = h("input", { type: "search", placeholder: "옵션 이름으로 찾기", "aria-label": "옵션 찾기" });
    const list = h("ul", { class: "list" });
    const paint = () => {
      const w = q.value.trim().toLowerCase();
      let shown = items.filter((x) => (st.vcat < 0 || x.cat === st.vcat) && (!st.vsDiff || x.a !== x.b) && (!w || x.name.toLowerCase().includes(w)));
      const so = { diff: (p, r) => Math.abs(Math.log(r.a / r.b)) - Math.abs(Math.log(p.a / p.b)), name: (p, r) => p.name.localeCompare(r.name, "ko"), a: (p, r) => p.a / p.b - r.a / r.b, b: (p, r) => r.a / r.b - p.a / p.b }[st.vsort];
      shown = shown.sort(so);
      list.replaceChildren(...shown.slice(0, 300).map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, x.name),
        h("span", { class: "p num" }, x.a === x.b ? "같음" : `${x.a < x.b ? "A" : "B"} ${won(Math.abs(x.a - x.b))}↓`),
        h("span", { class: "m" }, pairBars(x.a, x.b), h("span", { class: "row", style: "gap:4px" }, h("span", { class: "key", style: "background:var(--s1)" }), h("b", { class: x.a < x.b ? "down" : "" }, won(x.a))),
          h("span", { class: "row", style: "gap:4px" }, h("span", { class: "key", style: "background:var(--s2)" }), h("b", { class: x.b < x.a ? "down" : "" }, won(x.b))),
          x.a !== x.b ? h("span", { class: "vwin" }, cheaperTxt(A, B, x.a, x.b)) : null, h("span", {}, D.meta.cats[x.cat]))))));
      if (!shown.length) list.replaceChildren(h("div", { class: "empty" }, "찾는 옵션이 없어요"));
    };
    q.addEventListener("input", paint);
    box.append(h("div", { class: "card" }, h("div", { class: "search", style: "box-shadow:none;background:var(--fill)" }, q),
      h("div", { class: "chips", style: "margin-top:10px" }, h("button", { class: "chip", type: "button", "aria-pressed": st.vcat < 0 ? "true" : "false", onclick: () => { st.vcat = -1; render(); } }, "전체"),
        cats.map((ci) => h("button", { class: "chip", type: "button", "aria-pressed": st.vcat === ci ? "true" : "false", onclick: () => { st.vcat = ci; render(); } }, D.meta.cats[ci]))),
      h("div", { class: "chips", style: "margin-top:8px" }, [["diff", "차이 큰 순"], ["a", "A가 싼 것"], ["b", "B가 싼 것"], ["name", "이름순"]].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": st.vsort === v ? "true" : "false", onclick: () => { st.vsort = v; render(); } }, l)))));
    box.append(h("div", { class: "card flush" }, vsHead(), list));
    paint();
    return box;
  };

  // ---------------- search over every price
  // product / device → branches that name it in an option. Only the products the query names are counted (a quick text
  // pre-check on each distinct option name, then Classify.products to confirm), memoised per data load
  let prodIdx = null;
  const prodNames = () => [...Classify.DEVICES.map(([n, rx]) => [n, rx]), ...Spec.PRODUCTS.filter((p) => !["아포지", "젠틀맥스", "클라리티", "리쥬란"].includes(p)).map((p) => [p, null]), ["리쥬란", null]];
  function prodBranches(p, rx) {
    prodIdx = prodIdx || new Map();
    if (prodIdx.has(p)) return prodIdx.get(p);
    const ok = new Map(), out = new Set();
    ROWS.forEach((r, i) => { if (!live(i)) return; let v = ok.get(r[2]);
      if (v == null) { const t = S[r[2]]; v = (rx ? rx.test(t) : t.includes(p)) && Classify.products(t).includes(p); ok.set(r[2], v); }
      if (v) out.add(r[0]); });
    prodIdx.set(p, out);
    return out;
  }
  function typedResults(qs, fams, keys) {
    const nq = Search.norm(qs || "").replace(/\s+/g, "");
    if (nq.length < 2) return null;
    const hit = (t) => { const x = Search.norm(t).replace(/\s+/g, ""); return x.length >= 2 && (nq.includes(x) || x.includes(nq)); };
    const prods = prodNames().filter(([p]) => hit(p)).map(([p, rx]) => [p, prodBranches(p, rx)]).filter(([, bs]) => bs.size).sort((a, b) => b[1].size - a[1].size).slice(0, 6);
    const clinics = BR.filter((b) => hit(`${brandOf(b.i)[0]}${b.name}`) || hit(b.name.replace(/(본점|점)$/, ""))).slice(0, 6);
    const areas = areaFind(qs).filter((a) => a.name.length >= 2 && hit(a.name)).slice(0, 5);
    const conc = FLAGS.concernSearch && CONC.concerns.length ? Concern.classify(qs, CONC).matches.map((m) => CONC.concerns.find((c) => c.id === m.id)).filter(Boolean) : [];
    const groups = [["시술", fams.length + keys.length], ["제품·장비", prods.length], ["병원", clinics.length], ["지역", areas.length], ["고민", conc.length]].filter(([, n]) => n);
    if (!prods.length && !clinics.length && !areas.length) return groups.length ? h("p", { class: "tiny typedsum" }, `찾은 종류: ${groups.map(([g, n]) => `${g} ${n}`).join(" · ")}`) : null;
    const sec = (title, kids) => kids.length ? h("div", { class: "tsec" }, h("b", { class: "sh" }, title), h("div", { class: "chips wrapc" }, kids)) : null;
    return h("div", { class: "card typed" }, h("div", { class: "row" }, h("h3", {}, "검색어가 가리키는 것"), h("span", { class: "sp" }), h("span", { class: "tiny" }, groups.map(([g, n]) => `${g} ${n}`).join(" · "))),
      sec("제품·장비", prods.map(([p, bs]) => h("button", { class: "chip", type: "button", onclick: () => nav(`table?q=${encodeURIComponent(p)}`) }, icon("tag", "sm"), `${p} · ${bs.size}곳`))),
      sec("병원", clinics.map((b) => h("button", { class: "chip", type: "button", onclick: () => nav(`branch/${b.i}`) }, bdot(b.i), bname(b.i)))),
      sec("지역", areas.map((a) => h("button", { class: "chip", type: "button", onclick: () => { useArea(a); nav("map"); } }, icon("map-pin", "sm"), `${a.name} · ${a.bs.length}곳`))),
      h("p", { class: "tiny", style: "margin:6px 0 0" }, "제품·장비는 병원이 상품명에 적은 이름으로만 찾아요(적지 않은 곳은 빠져요). 지역을 누르면 그곳을 거리 기준으로 지도를 열어요."));
  }
  views.search = (arg, params) => {
    let qs = ""; try { qs = decodeURIComponent(arg || ""); } catch (e) { qs = String(arg || ""); }   // a malformed %-sequence in the link
    // natural language → filters, once per new search (?nl=1 marks it as done; ?nl=0 = take the words literally)
    if (qs && !params.has("nl") && !Search.hasOps(qs)) {
      const it = Search.interpret(qs, nlCtx());
      if (it.chips.length) {
        const np = new URLSearchParams(params);
        np.set("nl", "1"); np.set("orig", qs);
        if (it.brand) np.set("brand", D.meta.brands.findIndex((b) => b[0] === it.brand));
        if (it.region) np.set("reg", it.region);
        if (it.area) np.set("area", it.area);
        if (it.min) np.set("min", it.min);
        if (it.max) np.set("max", it.max);
        if (it.kind) np.set("kind", D.meta.kinds.indexOf(it.kind));
        if (it.sess) np.set("sess", it.sess);
        if (it.cond) np.set("cond", it.cond);
        if (it.sort) np.set("sort", it.sort);
        history.replaceState(null, "", `#search/${encodeURIComponent(it.q)}?${np}`);
        params = np; qs = it.q;
      }
    }
    rememberQuery(params.get("orig") || qs);
    if (qs) track("search", { ops: Search.hasOps(qs) });
    const box = h("div", { class: "view" });
    const q = h("input", { type: "search", value: qs, "aria-label": "시술 검색", enterkeyhint: "search", placeholder: "시술 검색 (예: 슈링크 300샷, rejuran)" });
    const run = (v) => { if (v) nav(`search/${encodeURIComponent(v)}`, true); };
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") run(q.value.trim()); });
    box.append(h("div", { class: "search" }, h("span", { html: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' }), withSuggest(q, run)), searchTips((v) => nav(`search/${encodeURIComponent(v)}?nl=0`)));
    if (FLAGS.concernSearch && CONC.concerns.length) {
      const cm = Concern.classify(qs, CONC).matches.map((m) => CONC.concerns.find((c) => c.id === m.id)).filter(Boolean);
      if (cm.length) box.append(h("div", { class: "row", style: "gap:10px;margin:-4px 4px 0" }, h("span", { class: "sub" }, "고민으로 보기:"),
        cm.map((c) => h("button", { class: "linkbtn", type: "button", onclick: () => nav(`concern?c=${c.id}`) }, icon("message-circle", "xs"), c.name))));
    }
    // comparison keys whose label matches (same normalization as prices)
    const qc = Search.compile(qs, searchIndex()), tokens = qc.empty ? [] : qc.raw;
    // kinds of this procedure with a plain-language line each ('보톡스' → 주름·스킨·사각턱·바디 …)
    const fams = tokens.length ? famFind(qs) : [];
    // main types side by side when the search hits a group people often mix up (보톡스, 필러)
    const grp = Object.entries(MAIN_TYPES).map(([g, names]) => [g, names.map(famByName).filter((f) => f && fams.includes(f) && kbOf(f))]).find(([, x]) => x.length >= 3);
    const main = grp && grp[1], how = grp && (grp[0] === "lifting" || grp[0] === "toning");   // devices differ by method, injections by place
    if (main) box.append(h("div", { class: "card" }, h("h3", {}, "주요 종류 한눈에 비교"),
      h("div", { class: "sub" }, "이름은 비슷해도 놓는 곳과 목적이 달라요. 어떤 게 맞는지는 의료진과 상담하세요."),
      h("div", { class: "ttable", role: "table", "aria-label": "주요 종류 비교" },
        h("div", { class: "tr th", role: "row" }, h("span", { role: "columnheader" }, "종류"), h("span", { role: "columnheader" }, how ? "방식" : "놓는 곳"), h("span", { role: "columnheader" }, "주로 받는 이유")),
        main.map((f) => { const e = kbOf(f); return h("div", { class: "tr", role: "row" },
          h("span", { role: "cell" }, h("button", { class: "linkbtn", type: "button", onclick: () => kbSheet(e, f) }, f.name)), h("span", { role: "cell" }, how ? e.one_liner : e.areas), h("span", { role: "cell" }, e.purpose)); })),
      h("p", { class: "tiny" }, "종류 이름을 누르면 부작용·주의사항·근거까지 볼 수 있어요. " + KB_STATE())));
    if (fams.length) box.append(h("div", { class: "card" }, h("h3", {}, `‘${qs}’ 종류 ${fams.length}가지`),
      h("div", { class: "sub" }, "이름이 비슷해도 놓는 곳과 목적이 달라요. 누르면 지점별 가격을 비교해요."),
      h("ul", { class: "list", style: "margin-top:4px" }, fams.slice(0, 12).map((f) => { const e = kbOf(f), top = ranking(f.main, "price")[0];
        return h("li", { class: "rk" }, h("button", { class: "item", type: "button", onclick: () => nav(`compare?k=${KEYS[f.main].id}`) }, h("span", { class: "t" }, f.name),
          h("span", { class: "p num" }, top ? won(top.p) + "~" : "-"), h("span", { class: "m" }, e ? e.purpose : f.desc[0] || `${f.cat} · ${f.n}곳`),
          e && e.areas ? h("span", { class: "m" }, `부위: ${e.areas}`) : null),
          e ? h("button", { class: "infob", type: "button", "aria-label": `${f.name} 설명 보기`, onclick: () => kbSheet(e, f) }, icon("info")) : null); })),
      h("button", { class: "linkbtn", type: "button", style: "margin-top:8px", onclick: () => nav(`guide?q=${encodeURIComponent(qs)}`) }, fams.length > 12 ? `시술 사전에서 ${fams.length}가지 모두 보기` : "시술 사전에서 자세히 보기", icon("chevron-right", "xs"))));
    const keys = KEYS.filter((k) => tokens.length && qc.test(Search.norm(`${k.label} ${k.cat} ${famOf[k.i] ? famOf[k.i].f.name : ""}`)))
      .sort((a, b) => byKB[b.i].size - byKB[a.i].size).slice(0, 8);
    if (keys.length) box.append(h("div", { class: "card" }, h("h3", {}, "같은 조건 가격 비교 바로가기"),
      h("ul", { class: "list", style: "margin-top:4px" }, keys.map((k) => { const top = ranking(k.i, "price")[0];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k.i; nav("compare"); } }, h("span", { class: "t" }, k.label),
          h("span", { class: "p num" }, top ? won(top.p) + "~" : "-"), h("span", { class: "m" }, k.cat, FLAGS.lowestHighlight && top ? `최저 ${bname(top.b)}` : `${byKB[k.i].size}곳`))); }))));
    // typed results (docs/SEARCH_ENGINE_QA.md): what else the words name — a product / device, a clinic, a place, a concern —
    // above the price rows, each with where it leads; the counts are real (branches selling, branches in the place)
    { const tc = typedResults(params.get("orig") || qs, fams, keys); if (tc) box.insertBefore(tc, box.children[2] || null); }
    const orig = params.get("orig");
    box.append(priceTable(`search/${encodeURIComponent(qs)}`, params, { q: qs, head: [h("h3", {}, qs ? "이름에 검색어가 들어간 모든 가격" : "조건에 맞는 모든 가격"),
      orig ? h("div", { class: "note", style: "margin-top:8px" }, `‘${orig}’를 검색어 ‘${qs || "(없음)"}’와 아래 필터로 나눠 찾았어요. `,
        h("button", { class: "linkbtn", type: "button", onclick: () => nav(`search/${encodeURIComponent(orig)}?nl=0`, true) }, "문장 그대로 찾기")) : null] }));
    if (!params.toString()) setTimeout(() => q.focus(), 0);
    return box;
  };

  // ---------------- cart
  let lastTotal = null;   // {id, t}: the cart total animates when an edit changes it
  // the cheapest price of one cart line anywhere (branches in view), for the line's own price
  function itemBest(it) {
    let best = null, hi = 0, n = 0;
    for (const x of BR) { if (!branchOk(x.i)) continue; const l = lineAt(it, x.i); if (!okL(l)) continue; n++; hi = Math.max(hi, l.total); if (!best || l.total < best.total) best = { total: l.total, b: x.i }; }
    return best && Object.assign(best, { hi, n });
  }
  // 방문 계획 A~D (docs/CART_ENGINE_QA.md): the same cart four ways, each with how many clinics you visit and the total from
  // the same lines as the clinic comparison below (Pricing.compareClinics). No clinic is named here — which ones is one
  // tap away in the matching tab (objective display ②); missing prices are never counted as 0.
  function scenarioCard(items, plan) {
    const HL = FLAGS.lowestHighlight, full = plan.full;
    const rng = (xs) => { if (!xs.length) return null; const lo = Math.min(...xs), hi = Math.max(...xs); return lo === hi ? won(lo) : `${man(lo)}~${man(hi)}원`; };
    const near = st.loc ? [...full].filter((x) => x.d != null).sort((a, b) => a.d - b.d)[0] : null;
    const open = (tab, extra) => () => { st.cartTab = tab; st.cartCmp = true; if (extra) extra(); track("scenario_open", { tab, max: st.maxPlaces || 0 }); render(); setTimeout(() => { const t = $("#main .seg[role=tablist]"); if (t) t.scrollIntoView({ block: "start", behavior: "smooth" }); }, 50); };
    const tile = (id, title, visits, total, sub, act, actL) => h("div", { class: "scen" }, h("div", { class: "row", style: "gap:6px" }, h("b", { class: "scen-id" }, id), h("b", {}, title)),
      h("div", { class: "scen-v" }, h("span", { class: "k" }, visits), h("b", { class: "num" }, total || "-")),
      h("div", { class: "tiny" }, sub), act ? h("button", { class: "linkbtn", type: "button", onclick: act }, actL, icon("chevron-right", "xs")) : null);
    const pair = plan.pair;
    return h("section", { class: "card scens", "aria-label": "방문 계획 A~D" }, h("h3", {}, "방문 계획 비교"),
      h("div", { class: "sub" }, `담은 시술 ${items.length}개를 어떻게 나눠 받느냐에 따라 합계와 방문 횟수가 달라요. 같은 가격 기준(${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"} · ${st.special ? "특가 포함" : "일반가만"})으로 계산했어요.`),
      h("div", { class: "scengrid" },
        tile("A", "한 곳에서 모두", "방문 1곳", full.length ? (HL ? won(full[0].total) : rng(full.map((x) => x.total))) : null,
          full.length ? `모두 받을 수 있는 지점 ${full.length}곳${HL ? "" : "의 합계 범위"}` : "담은 시술을 모두 파는 지점이 없어요", full.length ? open("one") : null, "지점별로 보기"),
        tile("B", "시술별로 나눠서", `방문 ${plan.mix.places}곳`, plan.mix.missing ? null : won(plan.mix.total),
          plan.mix.missing ? `${plan.mix.missing}개는 어느 지점에서도 가격을 찾지 못해 합계를 만들지 않아요` : plan.mix.places > 1 ? "시술마다 가격이 가장 낮은 지점에서 받아요. 병원이 늘어 이동·상담이 늘어요" : "한 지점에서 받는 것과 같아요", open("mix", () => { st.maxPlaces = 0; }), "어디서 받는지 보기"),
        tile("C", "최대 2곳", pair ? "방문 2곳" : "방문 1~2곳", pair ? won(pair.total) : null,
          pair ? `한 곳에서 모두 받는 가장 낮은 합계보다 ${won(full.length ? full[0].total - pair.total : 0)} 적어요` : "2곳으로 나눠도 한 곳보다 싸지지 않거나, 두 곳으로 다 채울 수 없어요", pair ? open("mix", () => { st.maxPlaces = 2; }) : null, "두 곳 보기"),
        tile("D", "가까운 한 곳", "방문 1곳", near ? won(near.total) : null,
          !st.loc ? "기준 위치를 정하면 가장 가까운, 모두 받을 수 있는 지점의 합계를 계산해요" : near ? `${km(near.d)} · 모두 받을 수 있는 지점 중 가장 가까운 곳` : "위치 정보가 있는 지점 중 모두 받을 수 있는 곳이 없어요",
          st.loc ? (near ? open("one", () => { st.sort = "near"; }) : null) : () => locSheet(), st.loc ? "가까운 순으로 보기" : "기준 위치 정하기")),
      h("p", { class: "tiny", style: "margin:8px 0 0" }, "합계는 지점별로 가장 싼 같은 조건 가격의 합이에요. 가격이 없는 시술은 0원으로 넣지 않아요. 실제 결제가는 상담·조건에 따라 달라요."));
  }
  views.cart = () => {
    const box = h("div", { class: "view" });
    const c = cur();
    const newCart = () => nameSheet("새 장바구니", `장바구니 ${st.carts.length + 1}`, (name) => { st.carts.push({ id: newId(), name, items: [] }); st.ci = st.carts.length - 1; saveCarts(); render(); });
    box.append(h("div", { class: "row", style: "padding:4px 4px 0" }, h("h2", { class: "display", style: "font-size:24px" }, "장바구니"), h("span", { class: "sp" }),
      h("button", { class: "btn sm gray", type: "button", onclick: newCart }, icon("plus", "sm"), "새 장바구니")),
      // round-2 UX03: not a booking, not a final bill
      h("p", { class: "sub", style: "margin:2px 4px 8px" }, "병원 예약·결제가 아니에요. 모은 가격으로 계산한 비교용 예상 합계예요 — 가격 없는 회차·추가 비용은 합계에 넣지 않아요."));
    if (st.carts.length > 1) box.append(h("div", { class: "chips" }, st.carts.map((x, i) => h("button", { class: "chip", type: "button", "aria-pressed": i === st.ci ? "true" : "false",
      onclick: () => { st.ci = i; st.open.clear(); saveCarts(); render(); } }, `${x.name} ${x.items.length}`))));
    const manage = h("details", { class: "fold small" }, h("summary", {}, icon("settings", "sm"), `'${c.name}' 관리 · 이름·복사·${st.carts.length > 1 ? "삭제" : "비우기"}`),
      h("div", { class: "row", style: "margin:4px 0 6px" },
        h("button", { class: "btn sm gray", type: "button", onclick: () => nameSheet("이름 바꾸기", c.name, (name) => { c.name = name; saveCarts(); render(); }) }, icon("pencil", "sm"), "이름 바꾸기"),
        c.items.length ? h("button", { class: "btn sm gray", type: "button", onclick: () => { st.carts.push({ id: newId(), name: `${c.name} 복사본`.slice(0, 30), items: JSON.parse(JSON.stringify(c.items)), budget: c.budget }); st.ci = st.carts.length - 1; saveCarts(); render(); toast("복사했어요"); } }, icon("copy", "sm"), "복사") : null,
        h("span", { class: "sp" }),
        h("button", { class: "btn sm gray", type: "button", onclick: () => {
          const snap = JSON.parse(JSON.stringify(st.carts)), ci = st.ci, many = st.carts.length > 1;
          if (many) { st.carts.splice(st.ci, 1); st.ci = 0; } else c.items = [];
          saveCarts(); render();
          undoToast(many ? `'${c.name}'을(를) 지웠어요` : "장바구니를 비웠어요", () => { st.carts = snap; st.ci = ci; saveCarts(); render(); });
        } }, icon("trash-2", "sm"), st.carts.length > 1 ? "삭제" : "비우기")));
    if (!c.items.length) {
      box.append(h("div", { class: "card" }, jomiEmpty("cart", jline("emptyCart") || "장바구니가 비어 있어요", h("span", { style: "display:block;color:var(--ink-2);margin-bottom:6px" }, jline("emptyCartSub") || "시술을 담으면 병원별 비용을 비교할 수 있어요."),
        "한 곳에서 다 받을 때, 여러 곳을 섞을 때, 브랜드·지역별로 지점마다 예상 총액을 계산해 드려요. 시술 비교 화면이나 지점 가격표·검색 결과의 '담기'로 실제 옵션을 그대로 담을 수 있어요."),
        h("button", { class: "btn block", type: "button", onclick: () => nav("compare") }, "시술 고르러 가기", icon("chevron-right", "sm")), st.carts.length > 1 ? manage : null));
      return box;
    }
    // the items: name, spec, quantity, the line's lowest price, remove
    const items = c.items.filter(itemOk);
    const lost = c.items.length - items.length;
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, `담은 시술 ${c.items.length}개`), h("span", { class: "sp" }), h("span", { class: "sub" }, c.name)),
      h("div", { class: "cart-items" }, c.items.map((it) => {
        const ok = itemOk(it), fam = it.t === "k" && ok ? famOf[KI[it.k]] : null, e = fam ? kbOf(fam.f) : null;
        const cat = it.t === "k" && ok ? KEYS[KI[it.k]].cat : ok ? D.meta.cats[ROWS[(byName.get(SI.get(it.n)) || [])[0]][1]] : "";
        const setQ = (v) => { it.q = v; saveCarts(); render(); };
        const nOv = it.ov ? Object.keys(it.ov).length : 0, best = ok ? itemBest(it) : null;
        return h("div", { class: "ci" },
          h("span", { class: "cimg", "aria-hidden": "true" }, catIcon(cat)),
          h("span", { class: "cn" }, fam ? fam.f.name : itemLabel(it), e ? h("button", { class: "linkbtn", type: "button", "aria-label": `${fam.f.name} 설명 보기`, onclick: () => kbSheet(e, fam.f) }, icon("info", "xs")) : null),
          h("button", { class: "cx", type: "button", "aria-label": `${itemLabel(it)} 빼기`, onclick: () => {
            const pos = c.items.indexOf(it); c.items = c.items.filter((x) => x !== it); saveCarts(); render();
            undoToast(`뺐어요: ${itemLabel(it)}`, () => { c.items.splice(pos, 0, it); saveCarts(); render(); }); } }, icon("x", "sm")),
          h("div", { class: "cs" },
            fam && fam.f.vs.length > 1 ? h("select", { class: "mini", "aria-label": "옵션", onchange: (ev) => { it.k = KEYS[+ev.target.value].id; it.ov = {}; saveCarts(); render(); } },
              fam.f.vs.map((v) => h("option", { value: v.k, selected: v.k === KI[it.k] }, v.label))) : fam ? h("span", {}, fam.label) : null,
            it.t === "r" ? h("span", {}, `담은 곳: ${it.br.replace("|", " ")} · ${won(it.p)} · 같은 이름 상품끼리 비교`) : null,
            !ok ? h("span", { style: "color:var(--pricey)" }, "이번 주 가격표에 없어요") : null,
            nOv ? h("button", { class: "linkbtn", type: "button", onclick: () => { it.ov = {}; saveCarts(); render(); } }, `지점별로 바꾼 옵션 ${nOv}곳 · 되돌리기`) : null,
            ok && st.cartAdv ? h("button", { class: "chip mini-chip", type: "button", "aria-pressed": (it.sp ?? st.special) ? "true" : "false", title: "이 시술만 체험가·한정가 포함/제외",
              onclick: () => { it.sp = !(it.sp ?? st.special); saveCarts(); render(); } }, (it.sp ?? st.special) ? "특가 포함" : "특가 빼기") : null),
          h("div", { class: "cf" }, qtyEl(() => it.q || 1, setQ), FLAGS.lowestHighlight ? h("span", { class: "cp num" }, best ? won(best.total) : "-",
            h("small", {}, best ? `가장 싼 곳 · ${BR[best.b].name}` : ok ? "가능한 지점 없음" : "계산에서 빠짐"))
            : h("span", { class: "cp num" }, best ? (best.total === best.hi ? won(best.total) : `${man(best.total)}~${man(best.hi)}원`) : "-",
              h("small", {}, best ? `지점별 · ${best.n}곳` : ok ? "가능한 지점 없음" : "계산에서 빠짐"))));
      })),
      lost ? h("div", { class: "note", style: "margin-top:8px" }, `${lost}개는 이번 주 가격표에서 찾지 못해 계산에서 빠졌어요.`) : null, manage));
    if (!items.length) return box;
    // estimated total, the cheapest branch, and the button to the per-clinic comparison
    const plan = cartPlan(items), best = plan.full[0];
    const usesCond = best && best.lines.some((l) => l && l.special);
    const HL = FLAGS.lowestHighlight, totals = plan.full.map((x) => x.total), tmin = totals.length ? Math.min(...totals) : null, tmax = totals.length ? Math.max(...totals) : null;
    const totalNow = HL ? (best ? best.total : null) : `${tmin}-${tmax}`, tick = lastTotal && lastTotal.id === c.id && lastTotal.t !== totalNow;
    lastTotal = { id: c.id, t: totalNow };
    const sumrow = (l, v) => h("div", { class: "sumrow" }, h("span", {}, l), h("b", { class: "num" }, v));
    // sticky summary at the bottom once the summary card has scrolled away (hidden while the card is on screen)
    const endBar = h("div", { class: "actions cartbar", hidden: true },
      h("div", { class: "cb-t" }, h("span", { class: "tiny" }, best ? `예상 총액 · ${plan.full.length}곳` : "예상 총액"),
        h("b", { class: "num" }, best ? (HL || tmin === tmax ? won(HL ? best.total : tmin) : `${won(tmin)} ~ ${won(tmax)}`) : plan.mix.missing ? "일부 가격 미확인" : `섞으면 ${won(plan.mix.total)}`)),
      h("button", { class: "btn", type: "button", onclick: () => { if (!st.cartCmp) { st.cartCmp = true; render(); } setTimeout(() => { const t = $("#main .seg[role=tablist]") || $("#main .cartsum"); if (t) t.scrollIntoView({ block: "start", behavior: "smooth" }); }, 50); } },
        st.cartCmp ? "병원별 비교로" : "병원별 비교 보기"));
    box.append(h("div", { class: "card cartsum lift", "aria-live": "polite" },
      h("span", { class: "hl" }, best ? (HL ? "한 곳에서 다 받을 때 예상 총액" : `한 곳에서 다 받을 때 예상 총액 · ${plan.full.length}곳`) : "한 곳에서 모두 받는 지점이 없어요"),
      best ? h("span", { class: `hp num${tick ? " tick" : ""}${HL ? "" : " range"}` }, HL ? won(best.total) : tmin === tmax ? won(tmin) : [h("span", { class: "nw" }, won(tmin)), h("span", { class: "to" }, " ~ "), h("span", { class: "nw" }, won(tmax))])
        : h("span", { class: "hp num" }, plan.mix.missing ? "일부 가격 미확인" : `섞으면 ${won(plan.mix.total)}`),
      best && HL ? h("span", { class: "hb" }, bdot(best.b), `최저가 지점: ${bname(best.b)}${best.d != null ? ` · ${km(best.d)}` : ""}`) : null,
      best && !HL ? h("span", { class: "sub" }, "병원마다 담은 시술의 가격·조건이 달라요. 병원별 비교에서 지역·거리·합계 순으로 직접 정렬해 보세요.") : null,
      h("div", { style: "margin-top:10px;padding-top:10px;border-top:1px solid var(--line-soft)" },
        sumrow("모두 받을 수 있는 지점", `${regionName()} ${plan.full.length}곳`),
        plan.partial.length ? sumrow("일부만 가능", `${plan.partial.length}곳`) : null,
        plan.savings > 0 ? (HL ? sumrow("여러 곳 섞으면", `${won(plan.mix.total)} · ${won(plan.savings)} 아낌`) : sumrow("여러 곳에 나눠 받으면", `${won(plan.mix.total)}부터`)) : null,
        sumrow("가격 기준", st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가")),
      usesCond ? h("span", { class: "k kx", style: "justify-self:start;margin-top:6px;white-space:normal" }, "첫 방문·체험가 같은 조건부 가격 포함 — 고급 설정에서 뺄 수 있어요") : null,
      c.budget && best ? (HL ? h("span", { class: `k ${best.total > c.budget ? "kx" : "ok"}`, style: "justify-self:start;margin-top:6px" }, best.total > c.budget ? `예산보다 ${won(best.total - c.budget)} 많아요` : `예산 ${won(c.budget)} 안이에요`)
        : (() => { const n = totals.filter((t) => t <= c.budget).length; return h("span", { class: `k ${n ? "ok" : "kx"}`, style: "justify-self:start;margin-top:6px" }, n ? `예산 ${won(c.budget)} 안 지점 ${n}곳` : `예산 ${won(c.budget)} 안 지점이 없어요`); })()) : null,
      h("button", { class: "btn", type: "button", "aria-expanded": st.cartCmp ? "true" : "false", onclick: () => { st.cartCmp = !st.cartCmp; render(); } },
        st.cartCmp ? "병원별 비교 접기" : `병원별 비교 보기 (${plan.full.length + plan.partial.length}곳)`, icon(st.cartCmp ? "chevron-up" : "chevron-down", "sm")),
      h("div", { class: "tools" },
        h("button", { class: "linkbtn", type: "button", onclick: () => shareCart(c) }, icon("share-2", "xs"), "공유하기"),
        h("button", { class: "linkbtn", type: "button", onclick: () => alertSheet({ cart: c.name }) }, icon("bell", "xs"), "합계 알림"),
        h("span", { class: "sub", style: "display:inline-flex;align-items:center;gap:4px" }, icon("check", "xs"), "이 기기에 자동 저장"))));
    box.append(scenarioCard(items, plan));
    // advanced comparison settings — every option the cart had, folded and summarised
    const on = [st.special ? "특가 포함" : "일반가만", st.noStack ? "첫 방문가 지점당 1개" : null, st.when ? `방문 ${st.when.date.slice(5)}${st.when.time ? " " + st.when.time : ""}` : null,
      c.budget ? `예산 ${won(c.budget)}` : null, st.maxKm ? `${st.maxKm}km 안` : null, st.brands.length < D.meta.brands.length ? `브랜드 ${st.brands.length}개` : null].filter(Boolean);
    const adv = h("details", { class: "card advset", open: !!st.cartAdv }, h("summary", {}, h("b", {}, "고급 비교 설정"), h("span", { class: "sub" }, ` · ${on.join(" · ")}`)),
      h("div", { class: "advgrid" },
        h("div", {}, h("div", { class: "flabel" }, "예산 상한"), budgetEl(c)),
        h("div", {}, h("div", { class: "flabel" }, "특가 적용"), switchEl("특가 포함(첫 1회)", st.special, (v) => { st.special = v; store.set("special", v); render(); }),
          h("div", { class: "sub" }, "담은 시술마다 '특가 포함/빼기'를 따로 정할 수도 있어요(위 목록).")),
        h("div", {}, h("div", { class: "flabel" }, "첫 방문 조건"), switchEl("첫 방문가는 지점당 1개만", st.noStack, (v) => { st.noStack = v; store.set("noStack", v); render(); })),
        h("div", {}, h("div", { class: "flabel" }, "방문일"), whenChip()),
        h("div", {}, h("div", { class: "flabel" }, "여러 병원 조합"), h("div", { class: "chips" }, [[0, "제한 없음"], [2, "최대 2곳"]].map(([v, l]) =>
          h("button", { class: "chip", type: "button", "aria-pressed": st.maxPlaces === v ? "true" : "false", onclick: () => { st.maxPlaces = v; st.cartTab = "mix"; st.cartCmp = true; render(); } }, l)))),
        h("div", {}, h("div", { class: "flabel" }, "거리"), st.loc ? h("select", { class: "mini", "aria-label": "거리", onchange: (ev) => { st.maxKm = +ev.target.value; render(); } },
          [[0, "거리 제한 없음"], [3, "3km 안"], [5, "5km 안"], [10, "10km 안"], [20, "20km 안"], [50, "50km 안"]].map(([v, l]) => h("option", { value: v, selected: v === st.maxKm }, l)))
          : h("button", { class: "btn sm soft", type: "button", onclick: () => locate("keep") }, "내 위치로 거리 보기")),
        h("div", {}, h("div", { class: "flabel" }, "브랜드"), brandChips()),
        h("div", { class: "sub" }, `지역: ${regionName()} (화면 위 지역 버튼에서 바꿔요)`)));
    adv.addEventListener("toggle", () => { st.cartAdv = adv.open; });
    box.append(adv);
    // watched once the view is on the page (a detached card reports a zero box); one observer at a time
    const watchSum = () => setTimeout(() => { const sc = box.querySelector(".cartsum"); if (cartIO) cartIO.disconnect(); if (!sc || !sc.isConnected || !("IntersectionObserver" in window)) return;
      cartIO = new IntersectionObserver(([e]) => { endBar.hidden = e.isIntersecting || e.boundingClientRect.top > 0; }); cartIO.observe(sc); }, 0);
    if (!st.cartCmp) { box.append(endBar); watchSum(); return box; }
    const tabs = [["one", "한 곳에서"], ["mix", FLAGS.lowestHighlight ? "여러 곳 섞기" : "나눠 받기"], ["pkg", "병원 패키지"], ["sum", "브랜드·지역"]];
    box.append(h("div", { class: "seg", role: "tablist" }, tabs.map(([v, l]) => h("button", { type: "button", role: "tab", "aria-selected": st.cartTab === v ? "true" : "false", onclick: () => { st.cartTab = v; render(); } }, l))));
    if (st.cartTab === "one") box.append(oneView(items, plan.full, plan.partial));
    else if (st.cartTab === "mix") box.append(mixView(items, plan));
    else if (st.cartTab === "pkg") box.append(pkgView(items, plan));
    else box.append(sumView(plan.full));
    box.append(h("div", { class: "note" }, "• 가격만으로 고르지 마세요. 같은 시술이어도 병원마다 용량·조건·정품 여부·시술 의료진이 다르고, 시술마다 부작용·주의사항이 있어요(담은 시술의 i 버튼).", h("br"),
      "• 특가(체험가·한정가)는 첫 1회만, 2회째부터는 그 지점 일반가로 계산해요.", h("br"),
      "• 지점 이름을 누르면 시술별 견적이 펼쳐지고, 옵션을 그 지점의 다른 상품(용량·회차 패키지 등)으로 바꿀 수 있어요. 3회·5회 패키지를 고르면 횟수에 맞춰 묶음 수로 계산해요.", h("br"),
      `• ${vatNote()} 방문 전에 병원에 꼭 확인하세요.`));
    box.append(endBar); watchSum();
    return box;
  };
  // one branch's quote, expandable, with a per-line option picker
  function quoteRow(x, items, n, best) {
    const open = st.open.has(x.b);
    const li = h("li", { class: "qrow" + (open ? " open" : "") });
    const headBtn = h("button", { class: "rank" + (FLAGS.lowestHighlight ? (n < 3 && best && st.qsort === "total" ? " top" : "") : " nonum"), type: "button", "aria-expanded": open ? "true" : "false",
      onclick: () => { if (st.open.has(x.b)) st.open.delete(x.b); else st.open.add(x.b); render(); } },
      h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))), h("span", { class: "p num" }, won(x.total)),
      h("span", { class: "m" }, x.missing && x.missing.length ? h("span", { style: "color:var(--pricey)" }, `${items.length}개 중 ${x.n}개 가능 · 없음: ${x.missing.map((j) => itemLabel(items[j])).join(", ")}`) : best ? (x.total === best ? "가장 싸요" : `최저 합계보다 +${won(x.total - best)}`) : null,
        cur().budget && !(x.missing && x.missing.length) ? (x.total > cur().budget ? h("span", { class: "k kx" }, `예산 +${won(x.total - cur().budget)}`) : h("span", { class: "k k1" }, "예산 안")) : null,
        isFav("b", bkey(x.b)) ? h("span", { class: "k k4" }, "관심 지점") : null,
        (() => { const n = quoteWarnings(x).length; return n ? h("span", { class: "k kx", title: "합계는 예상이에요. 견적을 펼쳐 조건을 확인하세요" }, `확인할 조건 ${n}개`) : null; })(),
        x.d != null ? h("b", {}, km(x.d)) : null, h("span", { class: "chev" }, open ? "접기" : "견적", icon(open ? "chevron-up" : "chevron-down", "xs"))));
    li.append(headBtn);
    if (!open) return li;
    const body = h("div", { class: "qbody" });
    items.forEach((it, j) => {
      const l = x.lines[j];
      const alts = altRows(it, x.b);
      const sel = h("select", { class: "mini", "aria-label": "이 지점에서 옵션 바꾸기", onchange: (e) => {
        it.ov = it.ov || {};
        if (e.target.value === "") delete it.ov[bkey(x.b)]; else it.ov[bkey(x.b)] = S[ROWS[+e.target.value][2]];
        saveCarts(); render(); } },
        h("option", { value: "" }, "자동 (가장 싼 같은 시술)"),
        alts.map((i) => { const r = ROWS[i], ss = sessOf(i);
          return h("option", { value: i, selected: l && l.ov && l.rows[0] === i }, `${S[r[2]]} · ${won(r[3])}${ss > 1 ? (ss >= 99 ? " (이용권)" : ` (${ss}회)`) : ""}${isSpecial(r) ? " · 특가" : ""}`); }));
      if (!l) {
        body.append(h("div", { class: "qline" }, h("div", { class: "row" }, h("b", {}, itemLabel(it)), h("span", { class: "sp" }), h("span", { style: "color:var(--pricey);font-weight:700" }, "없음")),
          alts.length ? h("div", { class: "row", style: "margin-top:6px" }, h("span", { class: "sub" }, "비슷한 상품으로 대신:"), sel) : h("div", { class: "sub" }, "이 지점 가격표에 비슷한 상품이 없어요")));
        return;
      }
      const r = ROWS[l.rows[0]], ss = sessOf(l.rows[0]);
      const pct = r[4] ? Math.round((r[4] - r[3]) / r[4] * 100) : 0;
      const detail = l.ov ? (ss >= 99 ? "이용권 1개" : ss > 1 ? `${ss}회 묶음 × ${l.units}` : `× ${l.units}`)
        : l.incomplete ? incTxt(l)
        : l.rows.length > 1 ? `첫 회 ${won(r[3])} + ${(it.q || 1) - 1}회 × ${won(ROWS[l.rows[1]][3])}` : (it.q || 1) > 1 ? `${won(r[3])} × ${it.q}` : "";
      body.append(h("div", { class: "qline" },
        h("div", { class: "row" }, h("b", {}, `${itemLabel(it)} ×${it.q || 1}`), h("span", { class: "sp" }), h("b", { class: "num" }, l.incomplete ? `${won(l.total)}~?` : won(l.total))),
        h("div", { class: "m" }, h("span", {}, S[r[2]]), listS(r), pct > 0 && FLAGS.discountEmphasis ? h("span", { class: "k kt" }, `${pct}%↓`) : null, kindBadge(r),
          l.ov ? h("span", { class: "k k4" }, "직접 고름") : null, l.restacked ? h("span", { class: "k kx" }, "첫 방문가 중복 안 함") : null, l.stackWarn ? h("span", { class: "k kx" }, "첫 방문가 중복 확인") : null,
          detail ? h("span", {}, detail) : null, listedTxt(r) ? h("span", {}, listedTxt(r)) : null, srcLink(l.rows[0])),
        alts.length > 1 || l.ov ? h("div", { style: "margin-top:6px" }, sel) : null));
    });
    const warns = quoteWarnings(x);
    body.append(h("div", { class: "row", style: "margin-top:10px" }, h("b", {}, x.missing && x.missing.length ? "확인된 시술만 예상 합계" : "예상 합계(비교용)"), h("span", { class: "sp" }), h("b", { class: "num", style: "font-size:20px" }, won(x.total))),
      h("div", { class: "sub" }, `${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"} · 가격 확인 ${fresh(x.b).d}`),
      warns.length ? h("ul", { class: "warns" }, warns.map((s) => h("li", {}, s))) : null,
      h("div", { class: "row", style: "margin-top:10px" },
        h("button", { class: "btn sm", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(quoteText(x, items)); toast("견적을 복사했어요"); } catch (e) { toast("복사하지 못했어요"); } } }, "견적 복사"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => nav(`branch/${x.b}`) }, "지점 가격표"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => recordQuote(x, items) }, "받았어요 · 기록"),
        BR[x.b].addr ? h("a", { class: "btn sm gray", href: `https://map.kakao.com/?q=${encodeURIComponent(BR[x.b].addr)}`, target: "_blank", rel: "noopener" }, "길찾기") : null));
    li.append(body);
    return li;
  }
  // 'total' order picked by the user → the first three, with what to check before trusting the total (no ranking words)
  function top3Card(xs, items) {
    const lines = (x) => x.lines.filter(Boolean).map((l) => l.rows[0]);
    const body = () => ["[윤실장 합계 낮은순 맨 위 3곳 재확인 요청]", ...xs.map((x) => `- ${bname(x.b)}: ${won(x.total)} (윤실장 수집 ${fresh(x.b).d || "-"})\n${lines(x).map((i) => `  · ${S[ROWS[i][2]]} ${won(ROWS[i][14])} ${S[ROWS[i][11]] || ""}`).join("\n")}`),
      `시술: ${items.map((it) => `${itemLabel(it)} ×${it.q || 1}`).join(", ")}`, `앱 데이터: ${D.meta.updated}`].join("\n");
    return h("div", { class: "card t3card", style: "margin:10px 12px 0" }, h("div", { class: "row" }, h("h3", {}, "맨 위 3곳, 이것부터 확인하세요"), h("span", { class: "sp" }), h("span", { class: "sub" }, "합계 낮은순")),
      h("ul", { class: "plain t3" }, xs.map((x) => { const w = quoteWarnings(x), f = fresh(x.b);
        return h("li", {}, h("div", { class: "row" }, bdot(x.b), h("b", {}, bname(x.b)), h("span", { class: "sp" }), h("b", { class: "num" }, won(x.total))),
          h("div", { class: "sub" }, `수집 ${f.d || "-"}${f.stale ? " · 이번 주 수집 실패" : ""} · ${w.length ? `확인할 조건 ${w.length}개` : "표시된 조건 없음"} · 원본 ${lines(x).filter((i) => S[ROWS[i][11]]).length}/${lines(x).length}개 링크`),
          w.length ? h("ul", { class: "warns" }, w.slice(0, 3).map((t) => h("li", {}, t))) : null); })),
      h("div", { class: "sub", style: "margin-top:8px" }, "지금 버튼으로 병원 사이트를 바로 다시 읽지는 못해요(재수집 서버 없음). 각 견적의 원본 링크로 직접 보거나, 운영자에게 재확인을 요청할 수 있어요."),
      h("a", { class: "btn sm gray", style: "margin-top:8px;text-decoration:none", target: "_blank", rel: "noopener",
        href: `https://github.com/lsy2825/skin/issues/new?${new URLSearchParams({ title: `[재확인 요청] 장바구니 합계 맨 위 3곳 (${D.meta.updated})`, body: body(), labels: "price-recheck" })}` }, icon("send", "sm"), "3곳 재확인 요청 (GitHub, 실제 접수)"));
  }
  function oneView(items, full, part) {
    const res = h("div", { class: "card flush" });
    const budget = cur().budget, HL = FLAGS.lowestHighlight;
    // clinic order: the user's pick (default region · name, nearest once a location is set); 'cheapest first' is one choice
    const QS = { region: "지역·이름순", near: "가까운순", total: "합계 낮은순", totalDesc: "합계 높은순" };
    if (!QS[st.qsort]) st.qsort = HL ? "total" : st.loc ? "near" : "region";
    const qcmp = { region: (a, b) => regionCmp(a.b, b.b), near: (a, b) => (st.loc ? (a.d ?? 1e9) - (b.d ?? 1e9) : 0) || regionCmp(a.b, b.b), total: (a, b) => a.total - b.total, totalDesc: (a, b) => b.total - a.total }[st.qsort];
    const minT = full.length ? Math.min(...full.map((x) => x.total)) : 0;
    full = [...full].sort(qcmp); part = [...part].sort((a, b) => b.n - a.n || qcmp(a, b));
    if (budget) {
      const ok = full.filter((x) => x.total <= budget).length;
      res.append(h("div", { class: ok ? "note" : "note warnnote", style: "margin:10px 12px 0" }, ok ? `예산 ${won(budget)} 안에서 모두 받을 수 있는 곳 ${ok}곳` : `예산 ${won(budget)} 안에서 모두 받을 수 있는 곳이 없어요.${HL && full.length ? ` 가장 싼 곳은 ${won(minT)}이에요.` : ""}`));
      if (st.inBudget) full = full.filter((x) => x.total <= budget);
    }
    if (!full.length) res.append(h("div", { class: "empty" }, `담은 시술을 한 지점에서 모두 하는 곳이 없어요${part.length ? ` (일부만 하는 곳 ${part.length}곳)` : ""}. '여러 곳 섞기'를 보거나 아래에서 일부만 되는 곳을 확인하세요.`));
    else {
      const near = st.loc ? [...full].filter((x) => x.d != null).sort((a, b) => a.d - b.d)[0] : null;
      res.append(h("div", { style: "padding:14px 14px 0" }, h("h3", {}, `모두 받을 수 있는 곳 ${full.length}곳`), h("div", { class: "sub" }, `${QS[st.qsort]} · 눌러서 시술별 견적과 옵션 바꾸기`),
        h("div", { class: "chips sortchips", role: "radiogroup", "aria-label": "병원 정렬", style: "margin-top:10px" }, Object.entries(QS).map(([v, l]) =>
          h("button", { class: "chip", type: "button", role: "radio", "aria-checked": st.qsort === v ? "true" : "false",
            onclick: () => { if (v === "near" && !st.loc) locSheet(); st.qsort = v; render(); } }, l)))));
      if (HL) res.append(h("div", { class: "hero flat", style: "margin:10px 12px 0" }, h("span", { class: "hl" }, "가장 싼 곳"), h("span", { class: "hb" }, bname(full.find((x) => x.total === minT).b)), h("span", { class: "hp num" }, won(minT))));
      if (near && (HL ? near.total !== minT : st.qsort !== "near")) res.append(h("div", { class: "hero alt", style: "margin:8px 12px 0" }, h("span", { class: "hl" }, "가장 가까운 곳"), h("span", { class: "hb" }, `${bname(near.b)} · ${km(near.d)}`), h("span", { class: "hp num" }, won(near.total))));
      if (st.qsort === "total" && full.length) res.append(top3Card(full.slice(0, 3), items));
      res.append(h("ul", { class: "list" }, full.slice(0, 40).map((x, n) => quoteRow(x, items, n, HL ? minT : 0))));
      if (full.length > 40) res.append(h("div", { class: "sub", style: "text-align:center;padding:8px" }, `${QS[st.qsort]}으로 40곳까지 보여요 (전체 ${full.length}곳)`));
    }
    if (part.length) {
      res.append(h("button", { class: "more-link", type: "button", onclick: () => { st.showPart = !st.showPart; render(); } }, st.showPart ? "일부만 되는 곳 접기" : `일부만 되는 곳 ${part.length}곳 보기`));
      if (st.showPart) res.append(h("ul", { class: "list" }, part.slice(0, 30).map((x, n) => quoteRow(x, items, n, 0))));
    }
    return res;
  }
  // mode C: clinic packages ('A + B') that cover several cart items, vs. buying the same items separately there
  function pkgSpec(it) {
    const label = it.t === "k" ? KEYS[KI[it.k]].label : it.n;
    const fam = it.t === "k" && famOf[KI[it.k]] ? famOf[KI[it.k]].f.rx : new RegExp((label.replace(/^\[[^\]]*\]\s*/, "").split(/[\s(·]/).find((w) => w.length >= 2) || label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const u = Search.unitOf(label);
    return { fam, spec: u ? `${u.qty}${u.unit}` : "", key: it.t === "k" ? it.k : undefined };
  }
  function pkgView(items, plan) {
    const specs = items.map(pkgSpec);
    const found = [];
    for (const x of BR) {
      if (!branchOk(x.i)) continue;
      const singles = plan.byB.get(x.i) || [];
      for (const i of byB[x.i]) {
        const r = ROWS[i], name = S[r[2]];
        if (!live(i) || !name.includes("+") || (!st.special && isSpecial(r))) continue;
        const m = Pricing.matchPackage(name, specs, Search.norm, S[r[18]] || "");
        if (m.matched.length < 2) continue;
        const sep = m.matched.every((y) => singles[y.j]) ? m.matched.reduce((s, y) => s + singles[y.j].total, 0) : null;
        const qtyOk = m.matched.every((y) => (items[y.j].q || 1) === 1 && sessOf(i) <= 1);    // a 1-session package vs 1 of each
        found.push({ i, b: x.i, m, sep, qtyOk, gain: m.full && qtyOk && sep != null ? sep - r[3] : null });
      }
    }
    found.sort((a, b) => (b.m.full - a.m.full) || ((b.gain ?? -1e12) - (a.gain ?? -1e12)) || b.m.matched.length - a.m.matched.length || ROWS[a.i][3] - ROWS[b.i][3]);
    const res = h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, "담은 시술 2개 이상이 들어 있는 병원 패키지"),
      h("div", { class: "sub" }, "이름에 '+'로 묶인 상품만 찾아요. 스펙(샷 수·용량)이 모두 같고 다른 구성이 없을 때만 '따로 사는 것보다 얼마' 를 계산해요.")));
    if (!found.length) { res.append(h("div", { class: "empty" }, "담은 시술을 2개 이상 묶은 패키지를 찾지 못했어요.")); return res; }
    const stateTxt = { match: "같은 시술", spec: "용량·부위·제품 다름", check: "구성 확인 필요" };
    res.append(h("ul", { class: "list" }, found.slice(0, 30).map((y) => { const r = ROWS[y.i];
      return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
        h("span", { class: "m" }, h("button", { class: "linkbtn", type: "button", onclick: () => nav(`branch/${y.b}`) }, bdot(y.b), bname(y.b)), kindBadge(r),
          ...y.m.matched.map((z) => h("span", { class: `k ${z.state === "match" ? "k1" : "kx"}` }, `${itemLabel(items[z.j])}: ${stateTxt[z.state]}`)),
          y.m.extras.length ? h("span", { class: "k k4" }, `추가 구성: ${y.m.extras.join(", ")}`) : null,
          y.gain != null ? h("b", { class: y.gain > 0 ? "down" : "up" }, y.gain > 0 ? `따로(${won(y.sep)})보다 ${won(y.gain)} 싸요` : `따로(${won(y.sep)})가 ${won(-y.gain)} 싸요`)
            : h("span", {}, y.sep == null ? "같은 지점 단품 가격이 없어 비교 못 함" : !y.qtyOk && y.m.full ? `같은 지점에서 따로 ${won(y.sep)} · 횟수가 달라 직접 비교 안 함` : `같은 지점에서 따로 ${won(y.sep)} · 구성이 달라 직접 비교 안 함`),
          srcLink(y.i), h("span", { class: "sp" }), rowAddBtn(y.i)))); })));
    return res;
  }

  // several branches: at most 1 / 2 / any number of visits
  function mixView(items, plan) {
    const { full, mix, pair } = plan;
    const res = h("div", { class: "card" });
    const HL = FLAGS.lowestHighlight;
    res.append(h("div", { class: "row" }, h("h3", {}, HL ? "여러 곳 섞어서 받으면" : "여러 곳에 나눠 받을 때 예상 합계"), h("span", { class: "sp" })),
      h("div", { class: "chips", style: "margin-top:8px" }, [[2, "최대 2곳"], [0, "제한 없음"]].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": st.maxPlaces === v ? "true" : "false", onclick: () => { st.maxPlaces = v; render(); } }, l))));
    const single = full[0];
    let picks, total, places, note;
    if (st.maxPlaces === 2) {
      if (!pair) {
        res.append(h("div", { class: "empty" }, single ? (HL ? `두 곳을 섞어도 한 곳(${bname(single.b)} ${won(single.total)})보다 싸지지 않아요.` : "두 곳으로 나눠도 한 곳에서 다 받을 때보다 합계가 낮아지지 않아요.") : "두 곳으로 담은 시술을 모두 받을 수 있는 조합이 없어요."));
        return res;
      }
      picks = items.map((it, j) => ({ b: pair.assign[j], line: lineAt(it, pair.assign[j]) }));
      total = pair.total; places = 2;
    } else {
      picks = mix.picks; total = mix.total; places = mix.places;
    }
    const one = full.length ? Math.min(...full.map((x) => x.total)) : null, oneB = full.find((x) => x.total === one);
    note = one != null ? (total < one ? (HL ? `한 곳에서 다 받는 최저(${bname(oneB.b)} ${won(one)})보다 ${won(one - total)} 싸요. 대신 ${places}곳을 다녀야 해요.` : `한 곳에서 다 받을 때의 가장 낮은 합계보다 ${won(one - total)} 적어요. 대신 ${places}곳을 다녀야 해요.`)
      : HL ? `한 곳(${bname(oneB.b)})에서 다 받아도 같은 값이에요.` : "한 곳에서 다 받아도 합계가 같아요.") : "한 곳에서 모두 받을 수 있는 지점은 없어요.";
    if (!HL) note += " 시술마다 합계가 가장 낮은 곳을 골라 계산한 참고값이에요. 병원은 가격만이 아니라 조건·의료진·부작용 설명을 함께 보고 고르세요.";
    res.append(h("div", { class: "hero", style: "margin-top:10px" }, h("span", { class: "hl" }, `${places}곳 방문${st.maxPlaces !== 2 && mix.missing ? ` · ${mix.missing}개는 가능한 지점 없음` : ""}`),
        h("span", { class: "hb" }, st.vat === "incl" ? "합계 (부가세 포함 예상)" : "합계 (병원 표시가)"), h("span", { class: "hp num" }, won(total))),
      h("div", { class: "sub", style: "margin-top:8px" }, note),
      cur().budget ? h("div", { class: total <= cur().budget ? "sub down" : "sub up", style: "margin-top:4px" }, total <= cur().budget ? `예산 ${won(cur().budget)} 안이에요` : `예산보다 ${won(total - cur().budget)} 많아요`) : null,
      h("ul", { class: "list", style: "margin-top:6px" }, items.map((it, j) => { const p = picks[j];
        if (!p || !p.line) return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, `${itemLabel(it)} ×${it.q || 1}`), h("span", { class: "p", style: "color:var(--pricey)" }, "가격 미확인")));
        const r = ROWS[p.line.rows[0]];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${p.b}`) }, h("span", { class: "t" }, `${itemLabel(it)} ×${it.q || 1}`), h("span", { class: "p num" }, won(p.line.total)),
          h("span", { class: "m" }, bdot(p.b), bname(p.b), h("span", {}, S[r[2]]), kindBadge(r), p.line.ov ? h("span", { class: "k k4" }, "직접 고름") : null, dist(p.b) != null ? h("b", {}, km(dist(p.b))) : null)));
      })),
      picks.some((p) => p && p.line && p.line.special) ? h("div", { class: "note", style: "margin-top:8px" }, "체험가·한정가·첫 방문 같은 조건부 가격이 들어 있어요. 병원마다 1인 1회 등 조건을 꼭 확인하세요.") : null);
    return res;
  }
  function sumView(full) {
    const box = h("div", { class: "view", style: "animation:none" }), HL = FLAGS.lowestHighlight;
    if (!full.length) { box.append(h("div", { class: "card empty" }, "담은 시술을 한 지점에서 모두 하는 곳이 없어 브랜드·지역별 합계를 낼 수 없어요.")); return box; }
    const group = (keyOf) => { const m = new Map(); for (const x of full) { const k = keyOf(x); if (!m.has(k)) m.set(k, { best: x, n: 0, near: null, lo: x.total, hi: x.total }); const g = m.get(k); g.n++;
      if (x.total < g.best.total) g.best = x; g.lo = Math.min(g.lo, x.total); g.hi = Math.max(g.hi, x.total);
      if (x.d != null && (!g.near || x.d < g.near.d)) g.near = x; } return [...m.entries()].sort((a, b) => a[1].best.total - b[1].best.total); };
    const rng = (g) => g.lo === g.hi ? won(g.lo) : `${man(g.lo)}~${man(g.hi)}원`;
    const brands = group((x) => BR[x.b].brand);
    if (HL) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, "브랜드별 최저"), h("div", { class: "sub" }, "각 브랜드에서 담은 시술을 모두 받는 가장 싼 지점")),
      h("ul", { class: "list" }, brands.map(([bi, g], n) => h("li", {}, h("button", { class: "rank" + (n === 0 ? " top" : ""), type: "button", onclick: () => { st.cartTab = "one"; st.open.add(g.best.b); render(); } },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, h("span", { class: "bdot", style: `background:${D.meta.brands[bi][1]}` }), h("span", {}, D.meta.brands[bi][0])), h("span", { class: "p num" }, won(g.best.total)),
        h("span", { class: "m" }, h("span", {}, `${BR[g.best.b].name} · 가능 ${g.n}곳`), n ? h("span", {}, `1위보다 +${won(g.best.total - brands[0][1].best.total)}`) : null,
          g.near ? h("b", {}, `가까운 곳 ${BR[g.near.b].name} ${km(g.near.d)} ${won(g.near.total)}`) : null)))))));
    // neutral (default): each brand's / region's range of totals, in brand order / region name order, no branch named
    else box.append(h("div", { class: "card flush" }, h("div", { style: "padding:14px 14px 0" }, h("h3", {}, "브랜드별 합계 범위"), h("div", { class: "sub" }, "각 브랜드에서 담은 시술을 모두 받을 수 있는 지점들의 합계")),
      h("ul", { class: "list" }, [...brands].sort((a, b) => a[0] - b[0]).map(([bi, g]) => h("li", {}, h("div", { class: "item" },
        h("span", { class: "t row", style: "gap:8px;flex-wrap:nowrap" }, h("span", { class: "bdot", style: `background:${D.meta.brands[bi][1]}` }), D.meta.brands[bi][0]), h("span", { class: "p num" }, rng(g)),
        h("span", { class: "m" }, `가능 ${g.n}곳`, g.near ? h("b", {}, `가까운 곳 ${BR[g.near.b].name} ${km(g.near.d)}`) : null)))))));
    const regs = group((x) => BR[x.b].region || "기타");
    box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, HL ? "지역별 최저" : "지역별 합계 범위"), h("div", { class: "sub" }, HL ? "시·도마다 담은 시술을 모두 받는 가장 싼 지점" : "시·도마다 담은 시술을 모두 받을 수 있는 지점들의 합계")),
      h("ul", { class: "list" }, (HL ? regs : [...regs].sort((a, b) => a[0].localeCompare(b[0], "ko"))).map(([rg, g]) => h("li", {}, HL ? h("button", { class: "item", type: "button", onclick: () => { st.cartTab = "one"; st.open.add(g.best.b); render(); } },
        h("span", { class: "t" }, rg), h("span", { class: "p num" }, won(g.best.total)),
        h("span", { class: "m" }, bdot(g.best.b), h("span", {}, bname(g.best.b)), h("span", {}, `가능 ${g.n}곳`)))
        : h("div", { class: "item" }, h("span", { class: "t" }, rg), h("span", { class: "p num" }, rng(g)), h("span", { class: "m" }, `가능 ${g.n}곳`)))))));
    return box;
  }
  // a cart shared by link
  // a shared cart comes from someone else's link: keep only the known fields, with their types and sizes
  function cleanShared(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return null;
    const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
    const ov = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).slice(0, 30).filter(([k, v]) => typeof v === "string").map(([k, v]) => [k.slice(0, 80), v.slice(0, 200)])) : undefined);
    const items = raw.items.slice(0, 50).map((it) => {
      if (!it || typeof it !== "object") return null;
      const q = Math.max(1, Math.min(20, Math.floor(+it.q) || 1)), sp = typeof it.sp === "boolean" ? it.sp : undefined;
      if (it.t === "k" && typeof it.k === "string" && /^[A-Z][A-Z0-9]{1,11}$/.test(it.k)) return { t: "k", k: it.k, q, sp, ov: ov(it.ov) };
      if (it.t === "r" && typeof it.n === "string" && it.n) return { t: "r", n: it.n.slice(0, 200), br: str(it.br, 80), p: Math.max(0, Math.round(+it.p) || 0), q, sp };
      return null;
    }).filter(Boolean);
    const sent = raw.sent && typeof raw.sent === "object" && Number.isFinite(+raw.sent.total)
      ? { total: Math.round(+raw.sent.total), vat: raw.sent.vat === "listed" ? "listed" : "incl", date: str(raw.sent.date, 10) } : null;
    return { name: str(raw.name, 30), from: str(raw.from, 20), note: str(raw.note, 200), items, sent };
  }
  views.import = (arg) => {
    const box = h("div", { class: "view" });
    let c = null;
    // size cap before decoding (a real cart link is a few KB); any decoding error = unreadable link
    try { if (String(arg || "").length <= 20000) c = cleanShared(dec(arg)); } catch (e) { c = null; }
    if (!c || !c.items.length) { box.append(h("div", { class: "card empty" }, "공유 링크를 읽지 못했어요.")); return box; }
    const okItems = c.items.filter((it) => it && (it.t === "k" || it.t === "r") && itemOk(it));
    const now = okItems.length === c.items.length && okItems.length ? cartPlan(okItems).full[0] : null;
    box.append(h("div", { class: "card" }, h("h2", {}, `${c.from ? `${String(c.from).slice(0, 20)}님이 보낸 ` : "공유받은 "}장바구니: ${c.name || "장바구니"}`),
      c.note ? h("div", { class: "note", style: "margin-top:8px" }, String(c.note).slice(0, 200)) : null,
      c.sent && now ? h("div", { class: "note", style: "margin-top:8px" }, c.sent.total === now.total && c.sent.vat === st.vat
        ? `보낸 때(${c.sent.date})와 같은 가격이에요: 한 곳 최저 ${won(now.total)}`
        : `보낸 때(${c.sent.date}) 한 곳 최저 ${won(c.sent.total)}${c.sent.vat !== st.vat ? "(표시 방식 다름)" : ""} → 지금 ${FLAGS.lowestHighlight ? `${bname(now.b)} ` : ""}${won(now.total)}. 그사이 가격이 바뀌었어요.`) : null,
      h("ul", { class: "list", style: "margin-top:6px" }, c.items.map((it) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, itemLabel(it)), h("span", { class: "sub" }, `×${it.q || 1}`),
        !itemOk(it) ? h("span", { class: "m", style: "color:var(--pricey)" }, "이번 주 가격표에 없음") : null)))),
      h("button", { class: "btn", type: "button", style: "width:100%;margin-top:12px", onclick: () => {
        st.carts.push({ id: newId(), name: c.name || "공유받은 장바구니", items: c.items.map((it) => JSON.parse(JSON.stringify(it))) });
        st.ci = st.carts.length - 1; saveCarts(); toast("내 장바구니로 저장했어요"); nav("cart", true); } }, "내 장바구니로 저장")));
    return box;
  };

  // ---------------- 내정보: profile, visit records (this phone; synced to the account when sign-in is on)
  const GENDERS = ["여성", "남성", "선택 안 함"];
  const AGES = ["10대", "20대 초반", "20대 후반", "30대 초반", "30대 후반", "40대", "50대", "60대 이상"];
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (Math.random() * 16) >> (c / 4)).toString(16)));
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const brLabel = (br) => (br || "").replace("|", " ");
  const sortRecs = () => st.recs.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.at || 0) - (a.at || 0));
  const auth = () => (window.Auth && window.Auth.enabled ? window.Auth : null);
  const PROVIDER_L = { kakao: "카카오", google: "Google", apple: "Apple" };
  function saveMe() {
    store.set("me", st.me);
    const A = auth();
    if (A && A.user) A.saveProfile(st.me, A.user.id).catch(() => toast("계정에 저장하지 못했어요(이 기기에는 저장됨)"));
  }
  function saveRecs(changed) {
    sortRecs(); store.set("recs", st.recs);
    const A = auth();
    if (A && A.user && changed && changed.length) A.saveRecords(changed, A.user.id).catch(() => toast("계정에 저장하지 못했어요(이 기기에는 저장됨)"));
  }
  // the personal state in memory, read again from the current space (sign-in, sign-out, another account)
  function reloadPersonal() {
    st.me = store.get("me", { nick: "", gender: "", age: "" }); st.recs = store.get("recs", []);
    st.alerts = store.get("alerts", []); st.notes = store.get("notes", []);
    st.carts = loadCarts(); st.ci = Math.min(store.get("ci", 0) || 0, st.carts.length - 1);
    cartQ.clear(); clearTimeout(cartPush);
  }
  // who is using the phone changed (round-2 R01). A token refresh of the same account is not a change and merges nothing.
  let lastUid = App.scope() ? App.scope().slice(2, -1) : null, syncGen = 0;
  function onAccount(u) {
    const id = u ? u.id : null;
    if (id === lastUid && (id ? App.scope() === `u:${id}:` : !App.scope())) { if (id && D && !syncGen) syncFromAccount(); return; }
    const fromAnon = !lastUid;
    lastUid = id; syncGen++;
    App.setScope(id ? `u:${id}:` : "");
    try { if (id) localStorage.setItem("pc:lastUid", JSON.stringify(id)); else localStorage.removeItem("pc:lastUid"); } catch (e) { /* ignore */ }
    reloadPersonal();
    if (D) { render(); if (id) syncFromAccount(fromAnon); }
  }
  // after sign-in: merge the account's copy with THIS ACCOUNT's space on the phone. Every await is followed by a check that
  // the same account is still signed in — a late answer for account A is dropped once B signed in (round-2 R01).
  // Data the phone collected before any sign-in is moved into the account only when the user says so (offerAnon).
  async function syncFromAccount(offerAnon = false) {
    const A = auth();
    if (!A || !A.user) return;
    const uid = A.user.id, gen = ++syncGen, stale = () => gen !== syncGen || !A.user || A.user.id !== uid;
    try {
      const s = await A.pull(uid);
      if (!s || stale()) return;
      if (s.profile) {
        st.me = { nick: st.me.nick || s.profile.nick || "", gender: st.me.gender || s.profile.gender || "", age: st.me.age || s.profile.age_band || "" };
        store.set("me", st.me);
      }
      const have = new Set(st.recs.map((x) => x.id));
      for (const r of s.records) if (!have.has(r.id)) st.recs.push({ id: r.id, date: r.done_on, n: r.procedure, br: `${r.brand}|${r.branch}`, p: r.price || 0, memo: r.memo || "", at: 0 });
      const onServer = new Set(s.records.map((r) => r.id));
      saveRecs(st.recs.filter((x) => !onServer.has(x.id)));
      await A.saveProfile(st.me, uid);
      if (stale()) return;
      const remote = await A.pullCarts(uid);
      if (stale()) return;
      const ids = new Set(st.carts.map((c) => c.id));
      for (const c of remote) if (!ids.has(c.id)) st.carts.push({ id: c.id, name: c.name, items: c.items, ver: c.ver });
      for (const c of st.carts) { const r = remote.find((x) => x.id === c.id); if (r && c.ver == null) c.ver = r.ver; }
      st.carts = st.carts.filter((c) => c.items.length || st.carts.length === 1);
      saveCarts();
      render();
      if (offerAnon) offerAnonImport(uid);
    } catch (e) { if (!stale()) { console.warn(e); toast("계정 정보를 불러오지 못했어요"); } }
  }
  // the phone's pre-sign-in records and carts → this account, only if the user chooses; once moved they leave the anonymous
  // space, so a later account on this phone is never offered them
  function offerAnonImport(uid) {
    const recs = store.anon("recs") || [], carts = (store.anon("carts") || []).filter((c) => c.items && c.items.length);
    if (!recs.length && !carts.length) return;
    sheet("이 휴대폰의 기록 가져오기", (close) => h("div", {},
      h("p", {}, `로그인 전에 이 휴대폰에 저장한 기록 ${recs.length}개와 장바구니 ${carts.length}개가 있어요. 이 계정으로 옮길까요?`),
      h("p", { class: "sub" }, "옮기지 않으면 로그아웃했을 때 이 휴대폰에서 그대로 볼 수 있어요. 다른 사람의 기록이라면 옮기지 마세요."),
      h("div", { class: "row", style: "margin-top:12px;gap:8px" },
        h("button", { class: "btn gray", type: "button", onclick: () => close() }, "두기"),
        h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => {
          const A = auth();
          if (!A || !A.user || A.user.id !== uid) { close(); return; }
          const have = new Set(st.recs.map((x) => x.id)), add = recs.filter((x) => !have.has(x.id));
          st.recs.push(...add); saveRecs(add);
          const cids = new Set(st.carts.map((c) => c.id));
          for (const c of carts) if (!cids.has(c.id)) st.carts.push({ ...c, ver: undefined });
          st.carts = st.carts.filter((c) => c.items.length || st.carts.length === 1);
          saveCarts();
          for (const k of ["recs", "carts", "cart", "ci"]) store.dropAnon(k);
          close(); render(); toast(`기록 ${add.length}개와 장바구니를 이 계정으로 옮겼어요`);
        } }, "이 계정으로 옮기기"))));
  }
  function nickSheet() {
    sheet("닉네임 바꾸기", (close) => {
      const inp = h("input", { class: "field", value: st.me.nick || "", maxlength: "20", placeholder: "예: 피부요정", "aria-label": "새 닉네임", autocomplete: "nickname" });
      const err = h("div", { class: "ferr", role: "alert", hidden: true }, "닉네임을 1~20자로 적어 주세요");
      const count = h("span", { class: "sub" }, `${(st.me.nick || "").length}/20`);
      inp.addEventListener("input", () => { count.textContent = `${inp.value.length}/20`; err.hidden = true; inp.setAttribute("aria-invalid", "false"); });
      const ok = () => { const v = inp.value.trim(); if (!v) { err.hidden = false; inp.setAttribute("aria-invalid", "true"); inp.focus(); return; }
        const before = st.me.nick; st.me = { ...st.me, nick: v.slice(0, 20) }; saveMe(); close(); render();
        undoToast(`닉네임을 '${st.me.nick}'(으)로 바꿨어요`, () => { st.me = { ...st.me, nick: before || "" }; saveMe(); render(); }); };
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } });   // preventDefault: the same Enter must not also press the button focus returns to
      return h("div", {}, h("label", { class: "flabel" }, h("span", { class: "row" }, "새 닉네임", h("span", { class: "sp" }), count), inp), err,
        h("div", { class: "sub", style: "margin-top:6px" }, "이 휴대폰에만 저장돼요(로그인을 켜면 계정에도 저장)."),
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:14px", onclick: ok }, "저장"));
    });
  }
  function profileSheet() {
    const s = { ...st.me };
    sheet("프로필", (close) => {
      const box = h("div", {});
      const nick = h("input", { class: "field", value: s.nick || "", maxlength: "20", placeholder: "예: 피부요정", "aria-label": "닉네임" });
      const paint = () => fill(box,
        h("label", { class: "flabel" }, "닉네임", nick),
        h("div", { class: "flabel" }, "성별"), h("div", { class: "chips wrapc" }, GENDERS.map((g) => h("button", { class: "chip", type: "button", "aria-pressed": s.gender === g ? "true" : "false", onclick: () => { s.gender = s.gender === g ? "" : g; s.nick = nick.value; paint(); } }, g))),
        h("div", { class: "flabel" }, "나이"), h("div", { class: "chips wrapc" }, AGES.map((g) => h("button", { class: "chip", type: "button", "aria-pressed": s.age === g ? "true" : "false", onclick: () => { s.age = s.age === g ? "" : g; s.nick = nick.value; paint(); } }, g))),
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:16px", onclick: () => { st.me = { nick: nick.value.trim().slice(0, 20), gender: s.gender || "", age: s.age || "" }; saveMe(); close(); render(); toast("저장했어요"); } }, "저장"));
      paint();
      return box;
    });
  }
  // add or edit one visit record; pre: {br, n, p} to prefill
  function recordSheet(rec, pre = {}) {
    const isNew = !rec;
    const s = rec ? { ...rec } : { id: uid(), date: today(), n: pre.n || "", br: pre.br || "", p: pre.p || "", memo: "" };
    sheet(isNew ? "받은 시술 기록" : "기록 고치기", (close) => {
      const box = h("div", {});
      const date = h("input", { class: "field", type: "date", value: s.date, max: today(), "aria-label": "받은 날" });
      const known = BK.has(s.br);
      const brSel = h("select", { class: "field", "aria-label": "지점" }, h("option", { value: "" }, "지점 고르기"),
        D.meta.brands.map((b, bi) => h("optgroup", { label: b[0] }, BR.filter((x) => x.brand === bi).sort((a, c) => a.name.localeCompare(c.name, "ko"))
          .map((x) => h("option", { value: bkey(x.i), selected: bkey(x.i) === s.br }, x.name)))),
        h("option", { value: "__other", selected: !!s.br && !known }, "목록에 없는 곳(직접 쓰기)"));
      const other = h("input", { class: "field", placeholder: "병원·지점 이름", value: !known ? brLabel(s.br) : "", hidden: !(s.br && !known), "aria-label": "병원 이름" });
      const proc = h("input", { class: "field", value: s.n, placeholder: "시술 이름 (지점을 고르면 가격표에서 골라져요)", list: "proc-list", "aria-label": "시술" });
      const dl = h("datalist", { id: "proc-list" });
      const price = h("input", { class: "field", type: "number", inputmode: "numeric", min: "0", value: s.p || "", placeholder: "낸 금액(원)", "aria-label": "금액" });
      const memo = h("textarea", { class: "field", rows: "2", maxlength: "500", placeholder: "메모 (예: 통증 적었음, 다음엔 300샷)", "aria-label": "메모" }, s.memo || "");
      const fillList = () => {
        const b = BK.get(brSel.value);
        const names = b != null ? [...new Set(byB[b].map((i) => S[ROWS[i][2]]))].slice(0, 400) : [];
        dl.replaceChildren(...names.map((n) => h("option", { value: n })));
      };
      brSel.addEventListener("change", () => { other.hidden = brSel.value !== "__other"; fillList(); });
      proc.addEventListener("change", () => {
        const b = BK.get(brSel.value);
        if (b == null || price.value) return;
        const i = byB[b].find((x) => S[ROWS[x][2]] === proc.value);
        if (i != null) price.value = ROWS[i][3];
      });
      fillList();
      fill(box,
        h("label", { class: "flabel" }, "받은 날", date),
        h("label", { class: "flabel" }, "지점", brSel), other,
        h("label", { class: "flabel" }, "시술", proc), dl,
        h("label", { class: "flabel" }, "금액", price),
        h("label", { class: "flabel" }, "메모", memo),
        h("div", { class: "row", style: "margin-top:16px" },
          !isNew ? h("button", { class: "btn gray", type: "button", onclick: () => {
            const gone = st.recs.find((x) => x.id === s.id);
            st.recs = st.recs.filter((x) => x.id !== s.id); saveRecs();
            const A = auth(); if (A && A.user) A.deleteRecord(s.id, A.user.id).catch(() => {});
            close(); render();
            undoToast("기록을 지웠어요", () => { st.recs.push(gone); saveRecs([gone]); render(); }); } }, "삭제") : null,
          h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => {
            const br = brSel.value === "__other" ? `${other.value.trim()}|` : brSel.value;
            if (!proc.value.trim()) { toast("시술 이름을 써 주세요"); proc.focus(); return; }
            const r = { id: s.id, date: date.value || today(), n: proc.value.trim().slice(0, 200), br, p: Math.max(0, Math.round(+price.value || 0)), memo: memo.value.trim().slice(0, 500), at: s.at || Date.now() };
            st.recs = st.recs.filter((x) => x.id !== r.id).concat(r); saveRecs([r]);
            close(); render(); toast(isNew ? "기록했어요" : "고쳤어요");
          } }, "저장")));
      return box;
    });
  }
  // a cart quote → records for every line at that branch (today)
  function recordQuote(x, items) {
    const add = items.map((it, j) => okL(x.lines[j]) ? { id: uid(), date: today(), n: `${itemLabel(it)}${(it.q || 1) > 1 ? ` ×${it.q}` : ""}`, br: bkey(x.b), p: x.lines[j].total, memo: S[ROWS[x.lines[j].rows[0]][2]], at: Date.now() } : null).filter(Boolean);
    st.recs.push(...add); saveRecs(add);
    toast(`받은 시술 ${add.length}개를 내정보에 기록했어요`);
  }

  views.me = () => {
    const box = h("div", { class: "view" });
    const me = st.me, A = auth();
    sortRecs();
    const spent = st.recs.reduce((s, x) => s + (x.p || 0), 0);
    const visits = new Map();
    for (const r of st.recs) { const v = visits.get(r.br) || { n: 0, last: "", sum: 0 }; v.n++; v.sum += r.p || 0; if ((r.date || "") > v.last) v.last = r.date; visits.set(r.br, v); }
    // profile
    box.append(h("div", { class: "card" },
      h("div", { class: "row", style: "flex-wrap:nowrap;gap:14px" }, h("div", { class: "avatar", "aria-hidden": "true" }, me.nick ? me.nick.slice(0, 1) : icon("user")),
        h("div", { style: "min-width:0" }, h("h2", {}, me.nick || "닉네임을 정해 주세요"),
          h("div", { class: "sub" }, [me.gender, me.age].filter((x) => x && x !== "선택 안 함").join(" · ") || "성별·나이 미입력")),
      ),
      h("div", { class: "row", style: "gap:6px;margin-top:10px" },
        h("button", { class: "btn sm gray", type: "button", onclick: nickSheet }, "닉네임 바꾸기"), h("button", { class: "btn sm gray", type: "button", onclick: profileSheet }, "성별·나이 입력")),
      h("div", { class: "stats" },
        h("div", {}, h("b", { class: "num" }, st.recs.length), h("span", {}, "받은 시술")),
        h("div", {}, h("b", { class: "num" }, spent >= 10000 ? `${Math.round(spent / 1000) / 10}만` : spent.toLocaleString()), h("span", {}, "쓴 돈(원)")),
        h("div", {}, h("b", { class: "num" }, visits.size), h("span", {}, "다닌 지점"))),
      A ? (A.user
        ? h("div", { class: "row", style: "margin-top:12px" }, h("span", { class: "sub" }, `${PROVIDER_L[A.providerName(A.user)] || "소셜"} 계정으로 로그인됨 · 기록이 계정에 저장돼요`), h("span", { class: "sp" }),
          h("button", { class: "btn sm gray", type: "button", onclick: async () => { await A.signOut(); render(); } }, "로그아웃"))
        : h("div", { style: "margin-top:12px" }, h("div", { class: "sub", style: "margin-bottom:8px" }, "로그인하면 휴대폰을 바꿔도 기록이 남아요"),
          h("div", { class: "row" }, A.providers.map((pv) => h("button", { class: `btn sm login-${pv}`, type: "button", onclick: () => A.signIn(pv).catch(() => toast("로그인하지 못했어요")) },
            `${PROVIDER_L[pv]}로 시작하기`)))))
        // demo: login is not connected — say so, list what is prepared, offer no button that pretends to work
        : h("div", { class: "acctprep" }, h("div", { class: "row", style: "gap:6px" }, icon("lock", "sm"), h("b", {}, "계정 연결은 정식 출시 때 열려요")),
          h("p", { class: "sub" }, "지금은 시연 단계라 로그인·회원가입·약관 동의가 없어요. 기록·장바구니·관심은 이 휴대폰에만 저장돼요."),
          h("p", { class: "tiny" }, "준비된 것: 카카오·Google·Apple 로그인 화면 배치와 인증 구조(app/auth.js, Supabase), 계정 동기화 코드, DB 접근 정책. 실제 연결에는 각 서비스의 키가 필요해요."))));
    // records
    box.append(h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:14px 14px 4px" }, h("h3", {}, "최근 받은 시술"), h("span", { class: "sp" }),
      h("button", { class: "btn sm gray", type: "button", onclick: () => recordSheet(null) }, icon("plus", "sm"), "기록하기")),
      st.recs.length ? h("ul", { class: "list" }, st.recs.slice(0, st.allRecs ? 500 : 8).map((r) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => recordSheet(r) },
        h("span", { class: "t" }, r.n), h("span", { class: "p num" }, r.p ? won(r.p) : "-"),
        h("span", { class: "m" }, h("span", {}, r.date), h("span", {}, brLabel(r.br) || "지점 미입력"), r.memo ? h("span", {}, r.memo) : null)))))
        : h("div", { class: "empty" }, h("div", { class: "ei" }, icon("receipt")), h("b", {}, "아직 기록이 없어요"), "받은 시술을 기록하면 언제·어디서·얼마에 받았는지 한눈에 볼 수 있어요.", h("br"), "장바구니 견적에서 '받았어요'를 눌러도 기록돼요."),
      st.recs.length > 8 ? h("button", { class: "more-link", type: "button", onclick: () => { st.allRecs = !st.allRecs; render(); } }, st.allRecs ? "접기" : `전체 ${st.recs.length}개 보기`) : null));
    // visited branches
    if (visits.size) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:14px 14px 4px" }, h("h3", {}, "방문한 지점")),
      h("ul", { class: "list" }, [...visits.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([br, v]) => { const b = BK.get(br);
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { if (b != null) nav(`branch/${b}`); } },
          h("span", { class: "t row" }, b != null ? bdot(b) : null, brLabel(br) || "지점 미입력"), h("span", { class: "p num" }, `${v.n}회`),
          h("span", { class: "m" }, h("span", {}, `마지막 ${v.last}`), v.sum ? h("span", {}, `합계 ${won(v.sum)}`) : null, b == null ? h("span", {}, "앱 목록에 없는 곳") : null))); }))));
    // more pages
    box.append(h("div", { class: "card flush menu" }, h("ul", { class: "list" }, [["saved", "heart", "관심·가격 알림", "관심 시술·지점, 알림, 최근 본 것"], ["wallet", "wallet", "크레딧", "시연 지갑 · 충전 · 이용 내역 · 광고 없는 기간"], ["premium", "sparkles", "프리미엄 도구", "이벤트·견적 읽기, 보고서, 고급 계획 (크레딧)"], ["guide", "book-open", "시술 사전", "헷갈리는 시술 종류와 차이를 쉽게"], ["table", "table", "전체 가격표", "모든 지점·모든 가격을 조건으로 찾기"], ["change", "trending-down", "가격 변동", "지난 수집보다 내리거나 오른 가격"], ["data", "database", "데이터 상태·앱 설치", "수집 상태, 저장된 가격, 홈 화면 설치, 비교 기준"], ["ops", "shield", "운영 현황", "수집 상태·신선도·검토 큐·출처 정책"]].map(([v, ic, l, s]) =>
      h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(v) }, h("span", { class: "t" }, h("span", { class: "mi" }, icon(ic, "sm")), h("span", {}, h("span", { style: "display:block" }, l), h("span", { class: "sub", style: "display:block;font-weight:500" }, s))), icon("chevron-right", "sm")))))));
    // ---- 내 설정 (what this phone shows) — separate from the data information below
    const theme = store.get("theme", "auto");
    const radios = (label, opts, curV, set) => h("div", { class: "seg setseg", role: "radiogroup", "aria-label": label }, opts.map(([v, l]) =>
      h("button", { type: "button", role: "radio", "aria-checked": curV === v ? "true" : "false", onclick: () => set(v) }, l)));
    box.append(h("div", { class: "card settings" }, h("h2", {}, "내 설정"), h("div", { class: "sub" }, "이 휴대폰에서 보이는 방식을 바꿔요. 데이터 자체는 바뀌지 않아요."),
      h("div", { class: "setrow" }, h("div", { class: "flabel" }, h("span", {}, "가격 표시"), h("b", { class: "now" }, st.vat === "incl" ? "지금: 부가세 포함 예상가" : "지금: 병원 표시가")),
        radios("가격 표시", [["incl", "부가세 포함 예상가"], ["listed", "병원 표시가"]], st.vat, (v) => { st.vat = v; store.set("vat", v); applyVat(); render(); toast(v === "incl" ? "부가세 포함 예상가로 보여요" : "병원이 적은 가격 그대로 보여요"); }),
        h("div", { class: "sub" }, st.vat === "incl" ? "병원이 '부가세 별도'라고 적은 가격에 10%를 더해 보여줘요. 4개 브랜드 모두 사이트에 '부가세 10% 별도'라고 적혀 있어요(2026-10-13 확인)." : "병원 사이트에 적힌 숫자 그대로예요. 실제 결제는 부가세 10%가 더해질 수 있어요.")),
      h("div", { class: "setrow" }, h("div", { class: "flabel" }, h("span", {}, "화면 테마"), h("b", { class: "now" }, `지금: ${{ auto: "기기 설정 따름", light: "밝게", dark: "어둡게" }[theme]}`)),
        radios("화면 테마", [["auto", "기기 설정"], ["light", "밝게"], ["dark", "어둡게"]], theme, (t) => { store.set("theme", t); applyTheme(); render(); })),
      h("div", { class: "setrow" }, h("div", { class: "flabel" }, h("span", {}, "지역"), h("b", { class: "now" }, `지금: ${regionName()} ${regionCount()}곳`)),
        regionSelect(), h("div", { class: "sub" }, "고르면 비교·장바구니·검색·순위가 이 지역 지점만 보여줘요(데이터는 전국을 모두 모아요).")),
      (() => { const P = jprefs(), set = (k, v) => { store.set("jomiPrefs", { ...P, [k]: v }); applyMotion(); render(); };
        return h("div", { class: "setrow" }, h("div", { class: "flabel" }, h("span", {}, "죠미 설정"), h("b", { class: "now" }, `지금: 안내 ${{ often: "자주", some: "가끔", off: "끄기" }[P.freq]} · 움직임 ${{ auto: "기기 설정", on: "켜기", off: "끄기" }[P.motion]} · 설명 ${{ short: "간략", long: "상세" }[P.detail]}`)),
          h("div", { class: "sub", style: "margin:6px 0 4px" }, "안내 빈도 — '가끔'은 홈 인사·사전 한마디를 줄이고, '끄기'는 죠미 얼굴 없이 글로만 알려줘요."),
          radios("죠미 안내 빈도", [["often", "자주"], ["some", "가끔"], ["off", "끄기"]], P.freq, (v) => set("freq", v)),
          h("div", { class: "sub", style: "margin:10px 0 4px" }, "움직임 — '기기 설정'은 휴대폰의 '동작 줄이기'를 따라요."),
          radios("움직임", [["auto", "기기 설정"], ["on", "켜기"], ["off", "끄기"]], P.motion, (v) => set("motion", v)),
          h("div", { class: "sub", style: "margin:10px 0 4px" }, "용어·규격 설명"),
          radios("설명 길이", [["short", "간략"], ["long", "상세"]], P.detail, (v) => set("detail", v))); })(),
      h("div", { class: "setrow" }, h("div", { class: "flabel" }, h("span", {}, "보기 기록"), h("b", { class: "now" }, histOn() ? "지금: 남김" : "지금: 남기지 않음")),
        switchEl("최근 본 것·최근 검색·이어서 보기 기록 남기기", histOn(), (v) => { store.set("histOff", !v); render(); toast(v ? "다시 기록해요" : "이제 기록하지 않아요(이미 있는 기록은 그대로)"); }),
        switchEl("사용 통계 남기기 (이 기기에만 · 시연 기록)", anOn(), (v) => { store.set("analytics", v ? "on" : "off"); render(); toast(v ? "이 기기에만 사용 통계를 남겨요(서버로 보내지 않아요)" : "사용 통계를 남기지 않아요(이미 있는 기록은 '보기'에서 지울 수 있어요)"); }),
        h("button", { class: "linkbtn", type: "button", onclick: () => eventsSheet() }, "사용 통계 보기·지우기", icon("chevron-right", "xs")),
        h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn sm gray", type: "button", onclick: () => {
          const before = Object.fromEntries(HIST_KEYS.map((k) => [k, store.get(k, null)]));
          for (const k of HIST_KEYS) { try { localStorage.removeItem("pc:" + k); } catch (e) { /* storage unavailable */ } }
          try { localStorage.removeItem("pc:lastTable"); } catch (e) { /* an older version's key */ }
          render(); undoToast("보기 기록을 지웠어요", () => { for (const [k, v] of Object.entries(before)) if (v != null) store.set(k, v); render(); }); } }, "기록 지우기")),
        h("div", { class: "sub" }, "이 휴대폰에만 있어요(서버로 보내지 않아요). 장바구니·관심·알림은 지우지 않아요.")),
      h("div", { class: "row", style: "margin-top:14px" }, h("button", { class: "btn sm gray", type: "button", onclick: () => window.lockApp && window.lockApp() }, "지금 잠그기"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { store.set("brands", null); store.set("special", true); location.reload(); } }, "설정 초기화"))));
    // ---- 데이터 안내 (information, not settings)
    const counts = D.meta.brands.map((_, i) => [BR.filter((b) => b.brand === i).length, D.rows.filter((r) => BR[r[0]].brand === i).length]);
    box.append(h("div", { class: "card info" }, h("h2", {}, "데이터 안내"),
      h("dl", { class: "kv", style: "margin-top:10px" }, h("dt", {}, "기준일"), h("dd", {}, `${D.meta.updated} (매주 월요일 자동 갱신)`),
        h("dt", {}, "지점"), h("dd", {}, branchCountText()), h("dt", {}, "가격 수"), h("dd", {}, `${D.meta.rows.toLocaleString()}개 (전국)`)),
      h("ul", { class: "list", style: "margin-top:8px" }, D.meta.brands.map((b, i) => !counts[i][0] ? null : h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "dot bdot", style: `background:${b[1]}` }), b[0]),
        h("span", { class: "sub" }, `${counts[i][0]}곳 · ${counts[i][1].toLocaleString()}개`), h("span", { class: "m" }, b[2]))))),
      h("div", { class: "note", style: "margin-top:10px" }, "• 체험가·한정가는 보통 1인 1회예요. 최저가는 '조건 없는 가격'을 먼저 보여주고, 조건부 가격은 따로 표시해요.", h("br"),
        "• '평일 낮', '일요일' 같은 표시는 그 시간에만 되는 가격이에요.", h("br"), `• ${vatNote()}`, h("br"),
        "• 종료일이 지난 이벤트, 지난 수집보다 90% 넘게 내리거나 10배 넘게 오른 가격(확인 중)은 비교에서 빠져요. 가격마다 'i' 버튼이나 '출처'로 근거와 병원 페이지를 볼 수 있어요.", h("br"),
        "• 병원 사이트 표기 오류(정가가 판매가보다 낮거나 10배 넘는 값)는 정가를 지웠고, 안내 문구·서류 발급비는 뺐어요."),
      h("div", { class: "sub", style: "margin-top:10px" }, "지도 © OpenStreetMap 기여자. 가격 출처는 각 병원 홈페이지예요.")));
    const shown = BR.filter((b) => regionOk(b.i));
    box.append(h("details", { class: "card flush fold" }, h("summary", {}, `지점 전체 목록 · ${regionName()} ${shown.length}곳`),
      h("ul", { class: "list" }, shown.sort((a, b) => a.brand - b.brand || a.name.localeCompare(b.name, "ko")).map((b) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b.i}`) },
        h("span", { class: "t row" }, bdot(b.i), bname(b.i)), h("span", { class: "sub" }, dist(b.i) != null ? km(dist(b.i)) : b.region), h("span", { class: "m" }, b.addr)))))));
    if (A && A.user) box.append(h("div", { class: "card" }, h("h3", {}, "계정"),
      h("div", { class: "sub", style: "margin-top:6px" }, "탈퇴하면 계정의 프로필·기록·장바구니·관심·알림과 보고서 내용, 공유 링크가 바로 지워져요. 이 휴대폰에 남은 이 계정의 기록도 함께 지워요. 결제·크레딧 거래 기록이 있으면 그 기록만 법이 정한 기간 동안 이름·연락처 없이 보관해요(보관 기간은 확정 전)."),
      h("button", { class: "btn sm gray", type: "button", style: "margin-top:10px", onclick: async () => {
        if (!confirm("정말 탈퇴할까요? 계정의 개인 정보가 모두 지워지고 되돌릴 수 없어요.")) return;
        const uid = A.user.id;
        try {
          const r = await A.deleteAccount();
          for (const k of PERSONAL) { try { localStorage.removeItem(`pc:u:${uid}:${k}`); } catch (e) { /* ignore */ } }
          toast(r && r.mode === "CLOSED" ? "탈퇴했어요. 거래 기록만 보관 기간 동안 남아요" : "탈퇴했어요"); onAccount(null); render();
        } catch (e) { toast("탈퇴하지 못했어요"); } } }, "회원 탈퇴")));
    return box;
  };

  function applyTheme() {
    const t = store.get("theme", "auto");
    if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
    // the status bar follows a theme picked here too (the two meta tags otherwise follow the device setting)
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (!m.dataset.c) m.dataset.c = m.content;
      m.content = t === "auto" ? m.dataset.c : t === "dark" ? "#141311" : "#f7f3ea";
    });
  }

  // ---------------- router
  function nav(path, replace) {
    const url = "#" + path;
    if (replace) history.replaceState(null, "", url); else history.pushState(null, "", url);
    render();
    window.scrollTo(0, 0);
  }
  // floating cart summary on every page but the cart
  function paintFloatCart(view) {
    const el = $("#fcart");
    if (!el) return;
    const items = cur().items.filter(itemOk);
    // pages with their own bottom bar (compare's actions, the concern composer), the cart itself, settings and the map don't show it
    if (["cart", "import", "compare", "concern", "me", "about", "ops", "map", "wallet", "premium", "report", "admin"].includes(view) || !items.length) { el.hidden = true; document.body.classList.remove("has-fcart"); return; }
    document.body.classList.add("has-fcart");
    const plan = cartPlan(items), best = plan.full[0];
    el.replaceChildren(icon("shopping-bag", "sm"), FLAGS.lowestHighlight ? `${items.length}개 · ${best ? `한 곳 ${won(best.total)}부터` : plan.mix.missing ? "일부 가격 미확인" : `섞으면 ${won(plan.mix.total)}`}`
      : `장바구니 ${items.length}개 · 병원별 견적 ${plan.full.length + plan.partial.length}곳`);
    el.hidden = false;
  }
  // removing a focused input can fire change/blur handlers that render again: never nest renders
  let rendering = false;
  function render() {
    if (!D) return;
    if (rendering) { setTimeout(render, 0); return; }
    rendering = true;
    try { renderNow(); } finally { rendering = false; }
  }
  function renderNow() {
    const [path, qs] = (location.hash.replace(/^#/, "") || "home").split("?");
    const [name, ...rest] = path.split("/");
    const params = new URLSearchParams(qs || "");
    const view = views[name] ? name : name === "more" ? "me" : name === "favorites" ? "saved" : name === "data" ? "about" : "home";
    const main = $("#main"), same = view === current && path === lastPath, mark = focusMark(main, document.activeElement);
    if (!same) for (const c of [...openSheets]) c(true);
    current = view; lastPath = path;
    if ((ROUTE_NAME[view] || view === "branch") && histOn()) store.set("lastRoute", path + (qs ? `?${qs}` : ""));
    const tab = { search: "home", import: "cart", compare: "explore", rank: "explore", versus: "explore", change: "explore", table: "explore", guide: "explore", concern: "explore",
      map: "explore", branch: "explore", about: "me", principles: "me", ops: "me", wallet: "me", premium: "me", report: "me", admin: "me", quick: "explore", terms: "explore", snap: "saved" }[view] ?? view;
    document.querySelectorAll("#tabs button").forEach((b) => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    // one screen failing must not leave the previous one up or a blank page (round-2 D5): show what happened and a way back
    let node;
    try { node = views[view](rest.join("/"), params); }
    catch (e) {
      console.error(e);
      node = h("div", { class: "view" }, jomiEmpty("error", "이 화면을 그리다가 문제가 생겼어요. 링크가 잘못됐거나 앱 오류일 수 있어요."),
        h("div", { class: "row", style: "gap:8px;margin-top:12px" }, h("button", { class: "btn line", type: "button", onclick: () => history.back() }, "뒤로"),
          h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => nav("home") }, "홈으로")));
    }
    main.replaceChildren(node);
    main.removeAttribute("aria-busy");
    // same page redrawn (filter, quantity …): focus goes back to that control; new page opened from the content: focus
    // the page itself so the next Tab starts in the new content instead of the header
    if (mark) { if (same) focusBack(main, mark); else main.focus({ preventScroll: true }); }
    paintFloatCart(view);
    document.body.classList.toggle("has-bar", view === "compare" || view === "concern" || view === "cart");
  }
  window.addEventListener("popstate", render);
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => nav(b.dataset.tab)));
  $("#locbtn").addEventListener("click", () => { if (D) locSheet(); });
  $("#notibtn").addEventListener("click", () => nav("saved"));
  // the top bar gets a hairline once the page scrolls under it
  window.addEventListener("scroll", () => $("#top").classList.toggle("scrolled", window.scrollY > 4), { passive: true });

  // 크레딧·프리미엄 화면 (commerce.js). The price context for reports is built once per data version from the rows already loaded.
  let pctx = null, pctxFor = "";
  const premiumCtx = () => {
    const v = `${D.meta.updated}|${today()}`;
    if (!pctx || pctxFor !== v) {
      pctx = PriceCtx.build({ rows: ROWS, S, branches: D.branches, keys: D.keys, trend: D.trend, updated: D.meta.updated, today: today(), brands: D.meta.brands,
        price: (r) => r[14], live: (r) => !r[15] });           // r[14] = the clinic's listed price, r[15] = 0 live (see applyData)
      pctxFor = v;
    }
    return pctx;
  };
  // the commerce screens' scripts load on first use (5.1 performance: the free core does not download or parse them at start)
  const COMMERCE_JS = ["domain/offerparse.js", "domain/match.js", "domain/pricectx.js", "domain/premium.js", "domain/jomiqa.js", "domain/demowallet.js", "domain/economics.js", "commerce.js"];
  let commerceP = null;
  const loadCommerce = () => commerceP || (commerceP = COMMERCE_JS.reduce((p, src) => p.then(() => new Promise((ok, bad) => {
    const el = document.createElement("script"); el.src = src; el.onload = ok; el.onerror = () => bad(new Error(src)); document.body.append(el);
  })), Promise.resolve()).then(installCommerce).catch((e) => { commerceP = null; throw e; }));
  for (const v of ["wallet", "premium", "report", "admin"]) views[v] = () => {
    const box = h("div", { class: "view" }, h("div", { class: "jomi-load", role: "status" }, jomiImg("thinking", "face", 32), h("span", {}, "불러오는 중…")), h("div", { class: "skel", style: "height:160px" }));
    loadCommerce().then(() => render()).catch(() => box.replaceChildren(h("div", { class: "card", role: "alert" }, "화면을 불러오지 못했어요. 연결을 확인하고 다시 열어 주세요.")));
    return box;
  };
  function installCommerce() { if (window.Commerce && window.PriceCtx && window.Premium && window.DemoWallet) window.Commerce.install({ h, icon, sheet, toast, nav, render, store, won, views, copyText,
    ctx: premiumCtx,
    cartItems: () => cur().items.filter((it) => it.t === "k" && KI[it.k] != null).map((it) => ({ k: it.k, q: it.q || 1 })),
    region: () => (st.region && st.region !== "수도권" ? st.region : ""),
    regionLabel: () => (st.region === "수도권" ? "전국(수도권 묶음은 보고서에서 전국으로 계산)" : regionName()),
    addKey: (id) => { if (KI[id] != null) addKeySheet(KI[id]); },
    jomiNotice: (text) => sheet("죠미", () => h("div", {}, jomiSay("thinking", text), h("div", { class: "tiny", style: "margin-top:8px" }, "이 질문에는 크레딧을 쓰지 않았어요."))),
  }); }
  applyTheme();
  applyMotion();   // 죠미 설정 → 움직임 (or the device's reduce-motion setting)
  if (st.when && (!st.when.date || st.when.date < new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))) { st.when = null; store.set("when", null); }
  st.region = store.get("region", "수도권");
  paintRegion();
  $("#regbtn").addEventListener("click", () => { if (D) regionSheet(); });
  $("#fcart").addEventListener("click", () => nav("cart"));   // no inline handlers: the CSP allows scripts from files only
  paintCartN();
  if (window.Auth && window.Auth.enabled) window.Auth.onChange(onAccount);
  $("#jomibtn").addEventListener("click", () => jomiSheet());
  // start: no splash delay — the page shows as soon as data.json is read; a slow read says so after 12 s, a failed one
  // explains what failed (only that the price file could not be read) and retries in place
  function boot() {
    const slow = setTimeout(() => { const m = $("#load-msg"); if (!m || D) return; m.textContent = jline("slow") || "평소보다 오래 걸리고 있어요.";
      m.parentElement.append(h("button", { class: "btn sm gray", type: "button", onclick: () => location.reload() }, icon("refresh-cw", "sm"), "새로고침")); }, 12000);
    loadData().then(() => { clearTimeout(slow);
      // a stored region no branch has (an old version's value, a typo) would empty every list: back to the default
      if (st.region && st.region !== "수도권" && !BR.some((b) => b.region === st.region)) { st.region = "수도권"; store.set("region", st.region); paintRegion(); }
      if (store.get("locPlace", "")) usePlace(store.get("locPlace", "")); render(); checkAlerts(); if (window.Auth && window.Auth.enabled) onAccount(window.Auth.user); }).catch((e) => {
      clearTimeout(slow); D = null; console.error(e);
      const main = $("#main"); main.removeAttribute("aria-busy");
      main.replaceChildren(h("div", { class: "view" }, h("div", { class: "card", role: "alert" }, jomiEmpty("error", jline("error") || "문제가 생겼어요",
        "가격 데이터를 불러오지 못했어요. 인터넷 연결이 끊겼거나 서버가 잠시 응답하지 않을 수 있어요.",
        SYNC.failed ? h("span", { class: "tiny", style: "display:block;margin-top:6px" }, `자세히: ${SYNC.failed}${SYNC.tries > 1 ? ` (${SYNC.tries}번 시도)` : ""}`) : null,
        h("button", { class: "btn block", type: "button", style: "margin-top:16px", onclick: () => {
          main.setAttribute("aria-busy", "true");
          main.replaceChildren(h("div", { class: "view" }, h("div", { class: "jomi-load", role: "status" }, jomiImg("sleeping", "face", 40), h("span", { id: "load-msg" }, jline("loading") || "불러오는 중…")), h("div", { class: "skel", style: "height:180px" })));
          boot(); } }, icon("refresh-cw", "sm"), "다시 시도")))));
    });
  }
  boot();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    const hadSW = !!navigator.serviceWorker.controller;   // first install also fires controllerchange: no notice then
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadSW) actToast("앱이 새 버전으로 바뀌었어요", ["새로고침", () => location.reload()]); });
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
