// 윤실장 (피부과 가격비교) — app logic. Data: data.json (built by build2/appdata.py). No framework.
(function () {
  "use strict";
  // shared helpers, storage and toasts live in core.js (docs/APP_JS_SPLIT_PLAN.md 1단계)
  const { $, h, fill, icon, won, km, emptyBox, emptyLine, searchBox, PERSONAL, store, toast, toastStop, toastTimer, undoToast, actToast, copyText } = window.App;
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
    const now = new Date();
    const p = L.pick(intent, { visits, hour: now.getHours(), dow: now.getDay(), month: now.getMonth() + 1, offline: typeof navigator !== "undefined" && navigator.onLine === false }, recent);
    if (!p) return fb();
    try { localStorage.setItem("pc:jomiRecent", JSON.stringify([...recent, p.id].slice(-20))); } catch (e) { /* ignore */ }
    return p.text;
  };
  App.jline = jline;   // core.js toasts (되돌리기, 복사) use it when it is there
  // the full line set (app/data/jomi_lines.json, ~29KB gzip) arrives after the prices are on screen; until then (or if it
  // never comes) the built-in lines answer. Cached by the service worker like any other app file.
  let jomiLinesP = null;
  const loadJomiLines = () => jomiLinesP || (jomiLinesP = fetch("data/jomi_lines.json").then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j && window.JomiLines) window.JomiLines.load(j); }).catch(() => {}));
  try { if (!sessionStorage.getItem("pc:counted")) { sessionStorage.setItem("pc:counted", "1"); localStorage.setItem("pc:visits", String((+localStorage.getItem("pc:visits") || 0) + 1)); } } catch (e) { /* ignore */ }
  const jomiEmpty = (expr, title, ...kids) => h("div", { class: "empty jomi-empty" }, jomiImg(expr, "portrait", 88), h("b", {}, title), ...kids);
  // a link to this exact screen (the receiver still needs the PIN); the phone's share sheet when there is one
  async function shareLink(title, hash) {
    const url = `${location.origin}${location.pathname}#${hash}`;
    try { if (navigator.share) { await navigator.share({ title, url }); const t = jline("shared"); if (t) jomiToast("happy", t); return; } } catch (e) { if (e && e.name === "AbortError") return; }
    copyText(url, "링크를 복사했어요 — 받는 사람도 비밀번호가 필요해요");
  }
  // 죠미's toast: her face, one short line, optionally one action (되돌리기 / 관심 보기 / 알림 관리). One toast at a time:
  // a new one replaces the last, so the same success is never stacked. sub: 죠미's own line under a fixed first line
  function jomiToast(expr, text, act, sub) {
    const el = $("#toast");
    const kids = [jprefs().freq === "off" ? null : h("img", { class: "mascot", src: jomiSrc(expr, "face"), alt: "", width: 24, height: 24, "data-expr": expr }),
      h("span", { class: "tt" }, sub ? [h("b", { class: "tm" }, text), h("span", { class: "ts" }, sub)] : text)].filter(Boolean);   // 죠미 설정: 끄기 → no face
    if (act) kids.push(h("button", { type: "button", onclick: () => { el.classList.remove("on", "act"); toastStop(); act[1](); } }, act[0]));
    el.replaceChildren(...kids); el.classList.add("on", "jt"); el.classList.toggle("act", !!act);
    toastTimer(act ? 5000 : 2600, ["on", "act"]);
  }

  // brands with at least one branch in this data (a paused collector keeps its brand entry but has no branches)
  const liveBrands = () => D.meta.brands.map((b, i) => ({ i, name: b[0] })).filter((b) => BR.some((x) => x.brand === b.i));
  // which brands' sites were checked for '부가세 별도' (data meta.about.vat), counted from the data, never a fixed number
  function vatBrandsNote() {
    const vat = (D.meta.about || {}).vat || {}, live = liveBrands();
    const ok = live.filter((b) => vat[b.name] && vat[b.name].default === "excl"), rest = live.filter((b) => !ok.includes(b));
    const last = ok.map((b) => vat[b.name].checked).filter(Boolean).sort().pop();
    if (!ok.length) return "부가세 표기를 확인한 브랜드가 아직 없어요.";
    return (rest.length ? `${ok.length}개 브랜드는 사이트에 '부가세 10% 별도'라고 적혀 있어요` : `${ok.length}개 브랜드 모두 사이트에 '부가세 10% 별도'라고 적혀 있어요`)
      + (last ? `(확인 ${Stats.md(last) || last}).` : ".") + (rest.length ? ` ${rest.map((b) => b.name).join("·")}는 표기를 아직 확인하지 못해 더하지 않아요.` : "");
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
    cmpN: null, qN: null, pN: null,                // rows a '더 보기' has opened (compare's clinics, 내 견적's clinic lists) — kept over a redraw
    folds: new Set(),                              // ids of the small folds the user opened (keptFold): they stay open through render()
  };
  let CHK = new Map();
  let CONC = { concerns: [], safety: { rules: [], personal: { pattern: "(?!)" } } }, concernPick = null;   // (the home box's message for 죠미와 대화 is kept by screens/concern.js: App.chatPending)
  let D, S, BR, KEYS, ROWS, KI, byKB, byB, nameIdx, FAM, famOf, BK, SI, byName, GR, byG, gcache, KB, kbFind, famsByName;
  let ADDON_COL = false;   // this file has the build's add-on field (row field 15 → r[19]); without it the name decides (isAddonRow)
  let WHEN_COL = false;    // this file has the site's visit days / hours (row fields 16-17 → r[20]/r[21], C #71); older files: none
  // carts: old single cart [{k, q}] becomes the first saved cart
  function newId() { return crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (Math.random() * 16) >> (c / 4)).toString(16)); }
  function loadCarts() {
    const c = store.get("carts", null);
    const list = Array.isArray(c) && c.length ? c : [{ name: "내 견적", items: store.get("cart", []).map((x) => ({ t: "k", k: x.k, q: x.q || 1 })) }];
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
  // price data sync lives in state/data.js (docs/APP_JS_SPLIT_PLAN.md 2단계); this file gives it the two screen hooks
  const { SYNC, loadData } = App.Data;
  App.Data.setHooks({ apply: (d) => { const was = partial(); applyData(d); if (was && !partial()) fullArrived(); }, paint: (parsing) => paintSync(parsing) });
  // round-2 O2: on a first visit the home screen is drawn from home.json (every row of the ids it shows, nothing else) while
  // data.json downloads. Until it arrives, every other screen waits (fullWait) and actions that need all rows are queued.
  const partial = () => !!(D && D.meta.partial);
  let pending = null;   // one action waiting for the full file (a search typed on 홈, 담기 on a home card)
  const fullPct = () => SYNC.total ? Math.min(99, Math.floor((SYNC.got / SYNC.total) * 100)) : 0;
  const fullMsg = () => SYNC.failed ? "전체 가격을 받지 못했어요" : `전체 가격을 받는 중… ${SYNC.total ? `${fullPct()}%` : ""}`.trim();
  function fullWait() {
    return h("div", { class: "view" }, h("div", { class: "jomi-load", role: "status" }, jomiImg(SYNC.failed ? "empty" : "thinking", "face", 40), h("span", { id: "load-msg" }, fullMsg())),
      SYNC.failed ? [h("p", { class: "tiny" }, `자세히: ${SYNC.failed}${SYNC.tries > 1 ? ` (${SYNC.tries}번 시도)` : ""}`),
        h("button", { class: "btn block", type: "button", onclick: () => { SYNC.failed = ""; loadData().catch(() => {}); render(); } }, icon("refresh-cw", "sm"), "다시 시도")]
        : h("p", { class: "sub" }, "홈 화면에 필요한 가격만 먼저 받았어요. 이 화면은 전체 가격이 오면 바로 열려요."), h("div", { class: "skel", style: "height:160px" }));
  }
  function whenFull(fn, msg) { if (!partial()) return fn(); pending = fn; if (msg) toast(msg); }
  function fullArrived() {
    const fn = pending; pending = null;
    if (fn) { pressing = false; render(); fn(); } else render();   // fn may act on the new screen: draw it now
    checkAlerts(); pushCheck();
    if (window.Auth && window.Auth.enabled) onAccount(window.Auth.user);
  }
  // live readers for screen files split out later: functions, never copies (D and ROWS are replaced when new data arrives)
  App.data = () => D; App.rows = () => ROWS;
  // state → header dot + text, the loading line, and the notice bar under the header (offline / new prices ready / failed)
  function syncState() { return Sync.stateOf({ ...SYNC, updated: D ? D.meta.updated : "", today: today(), stale: D ? BR.filter((b) => fresh(b.i).stale).length : 0 }); }
  let toldReady = false;   // 죠미 says once that new prices are ready (the notice bar keeps the button)
  function paintSync(parsing) {
    const ss = syncState(), up = $("#upd");
    if (up) up.dataset.state = ss.state;
    const lm = $("#load-msg");
    const jl = jline("loading") || "오늘의 가격을 살펴보는 중…";   // 죠미's line first, the real progress after it
    if (lm && partial()) lm.textContent = fullMsg();
    else if (lm && !D) lm.textContent = parsing ? "받은 가격을 정리하는 중…" : SYNC.total ? `${jl} ${Math.min(99, Math.floor((SYNC.got / SYNC.total) * 100))}% (${(SYNC.got / 1e6).toFixed(1)}/${(SYNC.total / 1e6).toFixed(1)}MB)` : SYNC.got ? `${jl} ${(SYNC.got / 1e6).toFixed(1)}MB` : jl;
    const bar = $("#netbar");
    if (!bar || !D) return;
    if (SYNC.ready && !toldReady) { toldReady = true; const t = jline("newPrices"); if (t) setTimeout(() => jomiToast("happy", t), 300); }
    let kids = null;
    // home.json on screen: the progress goes in the header caption (a text change — a notice bar would push the page down
    // and back up again when the full file arrives); the bar appears only if the full file could not be read
    if (partial() && up && !SYNC.failed) up.textContent = fullMsg();
    if (partial()) kids = SYNC.failed ? [icon("triangle-alert", "sm"), h("span", {}, "전체 가격을 받지 못했어요. 홈 가격만 보여요"), h("button", { type: "button", class: "nb-act", onclick: () => { SYNC.failed = ""; loadData().catch(() => {}); paintSync(); } }, "다시 시도")] : null;
    else if (ss.offline) kids = [icon("wifi-off", "sm"), h("span", {}, `저장된 가격 정보입니다. 현재 가격과 다를 수 있습니다. (${md(D.meta.updated)} 수집)`)];
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
    ADDON_COL = Classify.hasAddonField(D);   // once per file: data.json/home.json from before 2026-10-15 have 15 fields
    WHEN_COL = Pricing.hasWhenFields(D);     // … and those from before 2026-10-16 have no days / hours (16 fields or fewer)
    D.rows = rowsOf(D); delete D.cols;
    S = D.s;
    BR = D.branches.map((b, i) => ({ i, brand: b[0], name: S[b[1]], addr: S[b[2]], lat: b[3], lng: b[4], region: S[b[5]], site: S[b[6]], geo: b[9] ?? 0 }));
    KEYS = D.keys.map(([id, cat, label], i) => ({ i, id, cat, label }));
    KI = Object.assign(Object.create(null), Object.fromEntries(KEYS.map((k) => [k.id, k.i])));   // no prototype: '#compare?k=__proto__' is just unknown (round-2 D5)
    ROWS = D.rows;
    // source re-checks of low prices (scrape/verify_prices.py): row → { s: 1 found · 2 name only · 3 not found · 4 fetch error · 5 in the same block, d: date }
    CHK = new Map((D.meta.checks || []).map(([i, s, d]) => [i, { s, d }]));
    // r[15] = 0 live · 1 event over (until < today) · 2 price jump waiting for review; r[14] = listed price when VAT 별도
    // r[19] = the build's add-on flag (data.json field 15: 1 = sold only with another procedure; 0 in files without it)
    // r[20] = visit days bits (field 16: 월=1 … 일=64, 0 = not stated), r[21] = visit hours as Pricing.hoursCode (field 17, 0 = none)
    const td = today();
    for (const r of ROWS) {
      const u = S[r[10]] || "";
      r[18] = r[14] || 0;                 // per-'+'-part comparison keys (data.json) moved out of the runtime slots
      r[19] = r[15] || 0;                 // add-on flag (data.json) moved out before r[15] becomes the runtime state
      r[15] = Pricing.isExpired(u, td) ? 1 : r[13] ? 2 : 0;
      r[20] = WHEN_COL ? r[16] || 0 : 0;   // the site's visit days and hours, moved out before r[16] / r[17] are reused below
      r[21] = WHEN_COL ? Pricing.hoursCode(S[r[17]]) : 0;
      r[14] = r[3]; r[16] = r[4];        // the clinic's listed price / list price, kept for the 'VAT 포함' switch
    }
    applyVat();
    applyWhen();
    byKB = KEYS.map(() => new Map());
    byB = BR.map(() => []);
    ROWS.forEach((r, i) => {
      byB[r[0]].push(i);
      const ks = S[r[7]];
      if (ks) for (const id of ks.split(" ")) { const m = byKB[KI[id]]; if (!m) continue; if (!m.has(r[0])) m.set(r[0], []); m.get(r[0]).push(i); }   // home.json: ids not shipped
    });
    nameIdx = null; prodIdx = null; SIDX = null; normBySid = null;
    if (!D.meta.partial) setTimeout(prepSearchIndex, 0);   // O3: the search index in a worker, before anyone searches
    GR = (D.groups || []).map(([s, cat, nb, med, mn, mx], i) => ({ i, label: S[s], cat, nb, med, mn, mx }));
    byG = GR.map(() => []);
    ROWS.forEach((r, i) => { if (r[9] != null && r[9] >= 0) byG[r[9]].push(i); });
    gcache = new Map();
    mixMemo.clear(); medMemo.clear(); addonMemo.clear();   // addonMemo is keyed by string index: home.json and data.json differ
    // procedure families (option picker) and lookups for cart items stored by name
    // families (build2/taxonomy.py): name, regex for related rows (written for names without spaces), variants, compare
    // category, base family id, the clinics' own explanations. n = branches selling any variant, main = default variant
    const spaceless = (src) => { let re; try { re = new RegExp(src); } catch (e) { re = /$^/; } return { source: src, test: (x) => re.test(x) || re.test(String(x).replace(/\s+/g, "")) }; };
    const PN = D.meta.partial ? D.meta.partial.fn : null;   // home.json: branches per family counted in the full file
    FAM = (D.meta.fam || []).map(([name, rx, vs, cat, fid, desc], fi) => ({ name, rx: spaceless(rx), cat: cat || "", fid: fid || "", desc: desc || [], pn: PN ? PN[fi] : null,
      vs: vs.map(([id, label]) => ({ k: KI[id], label })).filter((v) => v.k != null) })).filter((f) => f.vs.length);
    famOf = KEYS.map(() => null);
    FAM.forEach((f) => f.vs.forEach((v) => { if (!famOf[v.k]) famOf[v.k] = { f, label: v.label }; }));
    FAM.forEach((f, i) => { f.idx = i; });
    for (const f of FAM) {
      f.n = f.pn != null ? f.pn : new Set(f.vs.flatMap((v) => [...byKB[v.k].keys()])).size;
      const one = f.vs.filter((v) => !/\d+회$/.test(v.label));
      f.main = (one.length ? one : f.vs).reduce((a, v) => (byKB[v.k].size > byKB[a.k].size ? v : a)).k;
      if (!f.cat) f.cat = KEYS[f.main].cat;
    }
    // Treatment Knowledge Base (knowledge/treatments.json): entries matched to families by name, else by base family id
    KB = D.meta.kb || { entries: [], statuses: {} };
    // 22 family names are shared across compare categories (C #114): the note and the family are found with the fid then
    kbFind = Spec.kbFinder(KB.entries, FAM);
    famsByName = new Map();
    for (const f of FAM) { if (!famsByName.has(f.name)) famsByName.set(f.name, []); famsByName.get(f.name).push(f); }
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
    if (!D.meta.partial) { migrateKeys(); migrateNames(); }   // home.json has only some rows: saved items move only with the full list
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
  // saved option names the build renamed at the same branch (Sync.renamed: a section title put in front or taken off, C #126):
  // '이 옵션 그대로' cart lines, a branch's pick (it.ov) and option price alerts keep finding their row instead of dropping out
  function migrateNames() {
    const memo = new Map();
    const at = (b) => { if (!memo.has(b)) { const m = new Map(); for (const i of byB[b] || []) { const n = S[ROWS[i][2]]; if (!m.has(n)) m.set(n, []); m.get(n).push(ROWS[i][3]); } memo.set(b, m); } return memo.get(b); };
    const fix = (n, b, p) => { if (b == null || typeof n !== "string") return null; const m = at(b); return Sync.renamed(n, [...m.keys()], p, (x) => m.get(x)); };
    let c = 0;
    for (const cart of st.carts || []) for (const it of cart.items || []) {
      if (it.t === "r") { const n = fix(it.n, BK.get(it.br), it.p); if (n) { it.n = n; c++; } }
      if (it.ov) for (const bk of Object.keys(it.ov)) { const n = fix(it.ov[bk], BK.get(bk)); if (n) { it.ov[bk] = n; c++; } }
    }
    if (c) saveCarts();
    let ac = 0;
    for (const a of st.alerts || []) {
      if (a.row) { const n = fix(a.row.n, BK.get(a.row.br)); if (n) { a.row.n = n; ac++; } }
      const lr = a.base && a.base.lowRow;
      if (lr) { const ps = lr.split("|"), bk = ps.slice(0, 2).join("|"), n = fix(ps.slice(2).join("|"), BK.get(bk)); if (n) { a.base.lowRow = `${bk}|${n}`; ac++; } }
    }
    if (ac) saveAlerts();
    return c + ac;
  }
  // the date the rows of key id were last regrouped (data.json meta.recl), or ""
  const reclDate = (id) => { let d = ""; for (const [dt, ks] of D.meta.recl || []) if (ks.includes(id)) d = dt; return d; };
  const brandOf = (b) => D.meta.brands[BR[b].brand];
  const brandOn = (b) => st.brands.includes(BR[b].brand);
  // region view: "" = 전국, "수도권" = 서울·경기·인천, otherwise one 시·도 (data stays nationwide)
  const CAPITAL = ["서울", "경기", "인천"];
  const regionOk = (b) => !st.region || (st.region === "수도권" ? CAPITAL.includes(BR[b].region) : BR[b].region === st.region);
  const regionName = () => st.region || "전국";
  // a conditional price: a condition tag, or days / hours the site limits it to (r[20]/r[21]) — a price for some weekdays or
  // hours only is not a plain price, tagged or not (C #71 left ~420 untagged ones such as '토요일이벤트' to the app). The one
  // place this is decided: special prices, price classes, plain medians and the class E reading all go through condOf.
  const timeLimited = (r) => Pricing.whenLimited(r[20], r[21]);
  const condOf = (r) => S[r[6]] !== "" || timeLimited(r);
  const isSpecial = (r) => r[5] === 1 || r[5] === 2 || condOf(r);
  // why a special price is special (Pricing.condClass): "once" 체험가·한정가·첫 방문·1인 1회·타임세일 — one time per person,
  // "repeat" a visit day / time only ('평일 낮', '시간대', '일요일', the site's days / hours) — the same price on every visit that fits,
  // "revisit" one for people coming back ('★재방문 이벤트★ …', '[재진] …', Pricing.isRevisit: the cart uses it only at a branch marked
  // '이 병원에 다녀왔어요' — visitedAt)
  const condClassOf = (r) => Pricing.condClass(r[5], S[r[6]], r[20], r[21], S[r[2]]);
  const isRevisitRow = (r) => condClassOf(r) === "revisit";
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
  // rows that repeat an earlier row exactly as shown (branch, product name ignoring spacing/case, price, kind, tags, end date):
  // the same product collected from two pages. Lists and their counts skip them (audit U10, E4); computed once per data load.
  let dupMemo = null;
  const dupRows = () => {
    if (dupMemo && dupMemo.rows === ROWS) return dupMemo.set;
    const idx = ROWS.map((_, i) => i), keep = new Set(Search.uniqueRows(idx, (i) => { const r = ROWS[i]; return [r[0], S[r[2]], `${r[3]}|${r[5]}|${r[6]}|${r[10]}`]; }));
    dupMemo = { rows: ROWS, set: new Set(idx.filter((i) => !keep.has(i))) };
    return dupMemo.set;
  };
  // a price that can set a group's range, middle and lowest: VAT basis known (r[12] 0 = the site's VAT note was not found,
  // so +10% may or may not apply — audit U6, E6) and not an add-on sold only with another treatment (audit U10, E5).
  // Such rows stay in every list with a badge; a branch whose only prices are such rows is still listed.
  // The add-on call is the build's own (r[19], C2) when the file has it — the same one its groups and keys used; only an
  // older file falls back to the name rule (Classify.isAddon), memoised per name for this load.
  const addonMemo = new Map();
  const addonOf = (r) => { if (ADDON_COL) return r[19] === 1; const n = r[2]; if (!addonMemo.has(n)) addonMemo.set(n, Classify.isAddon(S[n])); return addonMemo.get(n); };
  const isAddonRow = (i) => addonOf(ROWS[i]);
  const vatUnknown = (i) => ROWS[i][12] === 0;
  const cmpOk = (i) => !vatUnknown(i) && !isAddonRow(i);
  // the part of a branch list that the summary numbers are taken from (all of it when no branch has a comparable price)
  const cmpRk = (rk) => { const c = rk.filter((x) => cmpOk(x.i)); return c.length ? c : rk; };
  // price basis: "incl" = VAT 포함 예상가 (listed + 10% where the clinic says VAT 별도), "listed" = as shown on the site
  function applyVat() {
    for (const r of ROWS) {
      r[3] = Pricing.vatPrice(r[14], r[12], st.vat);
      r[4] = r[16] ? Pricing.vatPrice(r[16], r[12], st.vat) : 0;
    }
    if (gcache) gcache.clear();
  }
  function applyWhen() {
    for (const r of ROWS) r[17] = S[r[6]] || r[20] || r[21] ? Pricing.condState(S[r[6]], S[r[2]], st.when, { days: r[20], hours: r[21] }) : 0;
    // r[22] = 1: the visit is after the event's end date — kept, marked '기간 확인 필요' (user decision 2026-10-16)
    for (const r of ROWS) r[22] = Pricing.periodOver(S[r[10]], st.when) ? 1 : 0;
    if (gcache) gcache.clear();
  }
  const vatNote = () => st.vat === "incl" ? "'부가세 별도' 가격은 10%를 더한 예상가예요." : "병원 사이트에 적힌 가격 그대로예요(대부분 부가세 별도).";
  const listedTxt = (r) => st.vat === "incl" && r[12] === 2 ? `병원 표시 ${won(r[14])} + 부가세` : st.vat === "listed" && r[12] === 2 ? "부가세 별도" : "";
  function bestAt(k, b, special = st.special) {
    let best = -1;
    for (const i of byKB[k].get(b) || []) {
      const r = ROWS[i];
      if (!live(i) || (!special && isSpecial(r))) continue;
      if (best >= 0 && cmpOk(best) !== cmpOk(i)) { if (cmpOk(i)) best = i; continue; }   // a comparable price wins over a cheaper add-on / VAT-unknown one
      if (best < 0 || r[3] < ROWS[best][3] || (r[3] === ROWS[best][3] && isSpecial(ROWS[best]) && !isSpecial(r))) best = i;
    }
    return best;
  }
  // ---- product / device layer and comparability (docs/TREATMENT_TAXONOMY.md, domain/classify.js). mixFor(k): the products
  // the live rows of key k name; prodRank(k, p): ranking() restricted to rows naming product p ("" = rows naming none);
  // classOf(i, k): the A–J class of row i inside key k (the median is over the key's live plain prices per session)
  const mixMemo = new Map(), medMemo = new Map();
  const rowProds = (i) => Classify.products(S[ROWS[i][2]]);
  // mixFor(k) reads the rows the list on screen is made of — branches in the region and brands shown, and with '특가 포함' off
  // no special price (the rows ranking() and prodRank() pick from) — so the '섞여 있어요' note, the product chips' counts and
  // the rows' product tags say what this list holds (2026-10-16 hierarchy audit: 수도권 showed '제품 표기가 섞여 있어요' and
  // '리즈톡스 3곳' from branches outside it, and the chip led to an empty list). A chip's count is then exactly the rows its
  // list will have. mixFor(k, true): every branch, every live row — a row's A–J class (classOf) is read against the whole
  // group, the same way tools/review_queue.js reads it.
  function mixFor(k, whole = false) {
    const mk = whole ? `${k}|all` : `${k}|${st.region || ""}|${st.brands.join(",")}|${st.special ? 1 : 0}`;
    if (mixMemo.has(mk)) return mixMemo.get(mk);
    const names = [], per = new Map();
    for (const [b, ids] of byKB[k]) {
      if (!whole && (!brandOn(b) || !regionOk(b))) continue;
      for (const i of ids) if (live(i) && (whole || st.special || !isSpecial(ROWS[i]))) {
        names.push(S[ROWS[i][2]]);
        for (const p of (rowProds(i).length ? rowProds(i) : [""])) { if (!per.has(p)) per.set(p, new Set()); per.get(p).add(b); }
      }
    }
    const m = { ...Classify.mixOf(names), branches: per };
    mixMemo.set(mk, m);
    return m;
  }
  // a list worth splitting by product: two products, or one product and rows naming none (docs/TREATMENT_TAXONOMY.md §4)
  const isMixed = (m) => m.mixed || (m.named.size > 0 && m.none > 0);
  // the product chip in force for key k: only one the list on screen still has (a region or brand change can take it away)
  const prodOn = (k) => { if (st.prodK !== k || st.prod == null) return null; const m = mixFor(k); return isMixed(m) && m.branches.has(st.prod) ? st.prod : null; };
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
    for (const ids of byKB[k].values()) for (const i of ids) if (live(i)) { const r = ROWS[i], v = r[14] / Math.min(r[8] || 1, 98); all.push(v); if (!r[5] && !condOf(r)) plain.push(v); }
    const m = median(plain.length >= 3 ? plain : all) || 0;
    medMemo.set(k, m);
    return m;
  }
  function classOf(i, k) {
    const r = ROWS[i];
    if (k == null) { const id = (S[r[7]] || "").split(" ").find((x) => KI[x] != null); k = id ? KI[id] : null; }
    const tags = (S[r[6]] || "").split("·").filter(Boolean);
    if (!tags.length && timeLimited(r)) tags.push(Pricing.whenBadge(r[20], r[21]));   // days / hours only: a conditional price too (E)
    return Classify.row({ name: S[r[2]], sess: r[8], kind: r[5], tags, keyLabel: k != null ? KEYS[k].label : "", addon: addonOf(r),
      mix: k != null ? mixFor(k, true) : null, price: r[14] / Math.min(r[8] || 1, 98), median: k != null ? keyMed(k) : 0 });
  }
  // the 판정 badge in a colour per role (위계 점검 27 · BADGE-3): A checked (sage), E a condition (butter), F~H information (grey),
  // the other cautions a state of the data — 표기 없음, 다른 제품, 고시표, 확인 필요 (grey with its icon), J a different treatment:
  // this price cannot be used here (coral)
  const classBadge = (c) => c.cmp === "caution" && c.c !== "E" ? kwBadge(`${c.c} · ${c.label}`, { class: "k kw clsb", title: c.why })
    : h("span", { class: `${c.cmp === "direct" ? "k ok" : c.cmp === "never" ? "k kx" : c.cmp === "reference" ? "k k4" : "k kc"} clsb`, title: c.why }, `${c.c} · ${c.label}`);
  // clinic order. The default is neutral — region, then branch name (nearest first once a location is set) — so the app
  // never pins one clinic on top as 'the lowest'; price order is one of the user's choices (docs/OBJECTIVE_DISPLAY_POLICY.md)
  const SORT_L = { region: "지역·이름순", near: "가까운순", recent: "최근 확인순", price: "낮은 가격순", priceDesc: "높은 가격순" };
  // 시·도 in 수도권's own order 서울 → 경기 → 인천, then 가나다 (Stats.sidoCmp — hierarchy audit 7: 가나다 put every 수도권 list's
  // first rows in 경기), then branch name and brand. Every '지역·이름순' list uses this one order (compare, 내 견적, search, map)
  // (an older cached stats.js without it: 가나다 as before, never a broken list)
  const sidoCmp = (x, y) => (Stats.sidoCmp ? Stats.sidoCmp(x, y) : String(x || "").localeCompare(String(y || ""), "ko"));
  const regionCmp = (a, b) => sidoCmp(BR[a].region, BR[b].region) || BR[a].name.localeCompare(BR[b].name, "ko") || brandOf(a)[0].localeCompare(brandOf(b)[0], "ko");
  const sortChips = (curS, set, keys = Object.keys(SORT_L)) => h("div", { class: "chips sortchips", role: "radiogroup", "aria-label": "정렬" }, keys.map((v) =>
    h("button", { class: "chip", type: "button", role: "radio", "aria-checked": curS === v ? "true" : "false", onclick: () => set(v) }, v === "near" ? [icon("map-pin", "sm"), SORT_L[v]] : SORT_L[v])));
  // ---------------- '더 보기': one part for every list (hierarchy audit 11 · L7 · MORE-1, 6.0 규칙 4 '모든 더 보기는 같은 모양')
  // '20곳 더 보기 (165곳 남음)' — the list's own word (곳 for clinics, 개 for prices), 20 more per tap (Stats.more), one look
  // (.morelist). moreBtn: the list redraws itself with more(next) — its own small redraw (a paint() or a card), never #main.
  // moreList: rows appended in place — nothing else is redrawn, so a search box keeps what was typed and the page stays
  // where it is; focus goes to the first new row (keyboard and screen reader land on what just appeared).
  const moreOf = (shown, total, unit) => (Stats.more ? Stats.more(shown, total, unit) : null);
  const moreBtn = (shown, total, unit, more) => { const m = moreOf(shown, total, unit);
    return m ? h("button", { class: "morelist", type: "button", onclick: () => more(m.next) }, m.label) : null; };
  const focusIn = (el) => { if (!el) return; let f = el.matches(FOCUSABLE) ? el : el.querySelector(FOCUSABLE);
    if (!f) { el.setAttribute("tabindex", "-1"); f = el; }   // a row of plain text: the row itself
    f.focus({ preventScroll: true }); };
  // ul: the list element; items: everything the list could show, in order; make(item, n) → one row (li). first: rows shown
  // at once (an older cached stats.js without Stats.more: all of them, as before). onMore(n): rows on screen now (a screen
  // that redraws later can start from there). name: the list's name, for a screen with two such lists (내 견적's clinics that
  // do all of it and the ones that do part, the search page's specs, kinds and prices) — said with the button's words to a
  // screen reader ('일부만 되는 곳 20곳 더 보기 (53곳 남음)'); the words on screen stay the shared ones.
  // Returns the button to put under the list, or null when nothing is left.
  function moreList(ul, items, make, { first = 20, unit = "개", onMore = null, name = "" } = {}) {
    let n = 0;
    const btn = h("button", { class: "morelist", type: "button" });
    const add = (to) => { const els = []; for (; n < Math.min(to, items.length); n++) { const el = make(items[n], n); if (el) { ul.append(el); els.push(el); } } return els; };
    const label = () => { const m = moreOf(n, items.length, unit); if (m) { btn.textContent = m.label; if (name) btn.setAttribute("aria-label", `${name} ${m.label}`); } else btn.remove(); return m; };
    btn.addEventListener("click", () => { const m = moreOf(n, items.length, unit); if (!m) return; const els = add(m.next); if (onMore) onMore(n); label(); focusIn(els[0]); });
    add(Stats.more ? first : items.length);
    return label() ? btn : null;
  }
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
  const pctTxt = (v) => Math.abs(v) < 0.005 ? "중간 가격" : v < 0 ? `중간보다 ${Math.round(-v * 100)}% ↓` : `중간보다 ${Math.round(v * 100)}% ↑`;
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
  // a date on a screen is 'M/D' and a time Korea time 'M/D HH:MM' (Stats.md · Stats.mdhm — 2026-10-20 디자인 통일 U04); the word for
  // the data's date is '수집', a branch's or a price's '확인 M/D'. Copied text and reports keep the year
  const md = (d) => Stats.md(d) || (d == null ? "" : String(d)), md2 = md, mdhm = Stats.mdhm;
  const WHEN_TAGS = ["평일 낮", "시간대", "일요일"];   // tags whose own badge already says the day / time limit
  // a revisit price (C #111, Pricing.isRevisit): the badge, its title and the price sheet's condition line; the cart counts it only
  // at a clinic marked '이 병원에 다녀왔어요' (VISIT_SW, user decision 2026-10-19 — the price is about the clinic, not the treatment)
  const VISIT_SW = "이 병원에 다녀왔어요";
  const REVISIT_COND = "재방문(다시 오는 손님)만";
  const REVISIT_CART = `내 견적은 '${VISIT_SW}'를 켠 병원에서만 계산해요`;
  const REVISIT_HINT = `그 병원에 다시 오는 손님만 받는 가격이에요(병원 표기). ${REVISIT_CART}. 받을 수 있는지 병원에 확인하세요`;
  // the end date a line shows as '~10/31까지' ('' for none: no date, a far-off one, or an event already over)
  const endDate = (r) => { const u = S[r[10]] || ""; return !r[15] && /^\d{4}-\d{2}-\d{2}$/.test(u) && u < "2099" ? u : ""; };
  // opt.sameDate: an end date the screen already says once above the list (지점 가격표, Stats.commonDate) — not again per line.
  // One order on every price line (위계 점검 29 · BADGE-1, 6.0 규칙 3 '가격과 그 조건은 붙이고'): ① what kind of price and
  // its conditions (체험가·한정가·고시가, 첫 방문·평일·시간 한정 … — right after the price, so a lone 첫 방문 no longer wraps to a
  // third line behind the date), ② warnings (기간 끝남·방문일엔 안 됨·시간 확인 필요·기간 확인 필요 …), ③ information
  // (~10/31까지·VAT·추가 옵션·고시표). The words of each badge stay as they were. A screen's own badges go in their group:
  // opt.warn (초저가·조건 확인, 지난 자료, 첫 방문가 중복 …) before the line's own warnings, opt.info (제품·장비, 직접 고름)
  // after its information. opt.group: 0 / 1 / 2 gives that group only (the price card's 조건부 가격 line shows ① alone)
  // a state of the data (지난 자료, 급변·확인 중, 초저가·조건 확인, 횟수 표기 없음, 미확인 …): grey with an icon — not coral, which
  // is for a price that cannot be had (2026-10-19 사용자 결정 · 위계 점검 27). The icon is aria-hidden: the words say it
  const kwBadge = (text, a = {}, ic = "circle-help") => h("span", { class: "k kw", ...a }, icon(ic, "xs"), text);
  const kindBadge = (r, opt = {}) => {
    const kind = [], warn = [...(opt.warn || [])].filter(Boolean), info = [];
    if (r[5] === 1) kind.push(h("span", { class: "k k1" }, "체험가"));
    if (r[5] === 2) kind.push(h("span", { class: "k k2" }, "한정가"));
    if (isRevisitRow(r)) kind.push(h("span", { class: "k kt", title: REVISIT_HINT }, "재방문만"));
    if (r[5] === 4) kind.push(h("span", { class: "k k4" }, "고시가"));
    const t = S[r[6]], tags = t ? t.split("·") : [];
    // the tag id from the data, shown in the app's words (Pricing.condLabel: '평일 낮' → '평일·시간 한정', '시간대' → '정해진 시간만');
    // the title says what it means and the days / hours the site wrote (Pricing.condTitle)
    for (const x of tags) kind.push(h("span", { class: "k kt", title: Pricing.condTitle(x, r[20], r[21]) || null }, Pricing.condLabel(x)));
    // days / hours with no tag that says so ('토요일이벤트', a 첫 방문 price for weekdays): '토요일만', '평일만', '정해진 시간만',
    // days and hours both '평일·시간 한정' (Pricing.whenBadge)
    if (timeLimited(r) && !tags.some((x) => WHEN_TAGS.includes(x))) kind.push(h("span", { class: "k kt", title: Pricing.condTitle("", r[20], r[21]) }, Pricing.whenBadge(r[20], r[21])));
    if (r[15] === 1) warn.push(h("span", { class: "k kx" }, "기간 끝남"));
    if (r[17] === 1) warn.push(h("span", { class: "k kx", title: st.when && Pricing.weekendOnly(r[20]) && Pricing.weekdayHoliday(st.when.date)
      ? "주말에만 되는 가격이라 공휴일엔 뺐어요. 공휴일에도 주말 가격을 받는 병원이 있으니 병원에 확인하세요" : null }, "방문일엔 안 됨"));
    if (r[17] === 2) warn.push(h("span", { class: "k kc", title: "이 가격이 되는 시간대를 앱이 알지 못해요. 병원에 확인하세요" }, "시간 확인 필요"));
    if (r[15] === 2) warn.push(kwBadge("급변·확인 중", { title: "지난 수집보다 90% 넘게 내리거나 10배 넘게 올라 확인 중이에요" }));
    const u = S[r[10]] || "";
    // '기간 확인 필요' (user decision 2026-10-16, kept on the line): the event's end date before the visit is a condition to
    // check with the clinic, not a price that cannot be had — butter like the other conditions (위계 점검 27)
    if (r[22] === 1 && st.when) warn.push(h("span", { class: "k kc", title: `방문일(${md2(st.when.date)})에는 이 행사가 끝났을 수 있어요(${md2(u)}까지). 병원에 확인하세요` }, "기간 확인 필요"));
    if (endDate(r) && u !== opt.sameDate) info.push(h("span", { class: "k k4" }, `~${md2(u)}까지`));
    if (r[12] === 1 && st.vat === "listed") info.push(h("span", { class: "k k4" }, "부가세 포함"));
    if (r[12] === 0) info.push(h("span", { class: "k k4", title: "병원 사이트에서 부가세 포함·별도 표기를 찾지 못했어요. 범위·중간 가격 계산에서 빼요" }, "부가세 미확인"));
    if (addonOf(r)) info.push(h("span", { class: "k k4", title: "다른 시술과 함께할 때만 사는 추가 옵션이에요. 범위·중간 가격 계산에서 빼요" }, "추가 옵션"));
    if (u.startsWith("posted:")) info.push(h("span", { class: "k k4" }, `고시표 ${u.slice(7)}`));
    info.push(...[...(opt.info || [])].filter(Boolean));
    const groups = [kind, warn, info];
    return opt.group != null ? groups[opt.group] : [].concat(...groups);
  };
  const bname = (b) => `${D.meta.brands[BR[b].brand][0]} ${BR[b].name}`;
  // a small fold that stays the way the user left it when the screen is drawn again (render() after a setting or a quantity
  // changes): its id is kept in st.folds by the toggle event — no render() of its own (hierarchy audit 3-2: 견적 줄 '자세히',
  // 합계 계산 방법, 마이 데이터 안내·내 설정)
  const keptFold = (id, cls, summary, ...body) => h("details", { class: cls, open: st.folds.has(id),
    ontoggle: (e) => { if (e.currentTarget.open) st.folds.add(id); else st.folds.delete(id); } }, summary, ...body);
  // the way into a price's evidence (가격 근거 sheet — 조건·부작용·주의사항 and the clinic's page in its '원본' line): one ⓘ
  // column at the right of every price line, the same in the compare list, a branch's price table and the search results
  // (위계 점검 47 · INFO-1; the two text links '가격 근거' · '출처' per line were 800 green words on a branch page)
  const infoBtn = (i, who) => h("button", { class: "infob", type: "button", "aria-label": `${who} 가격 정보 보기`, onclick: () => priceSheet(i) }, icon("info"));
  // a text link in one of two shapes (2026-10-20 디자인 통일 U10, DESIGN_SYSTEM §3 '.linkbtn'): one that takes you to another screen is
  // the words and a trailing › (goLink — go: a route or a function); one that opens a sheet on this screen, or moves within it,
  // is a leading icon and the words, no › (hereLink). The price card's '계산 기준' had its icon first while '조건 확인', a sheet
  // too, had a › after it
  const goLink = (label, go, attrs) => h("button", { class: "linkbtn", type: "button", ...attrs, onclick: typeof go === "function" ? go : () => nav(go) }, label, icon("chevron-right", "xs"));
  const hereLink = (ic, label, onclick, attrs) => h("button", { class: "linkbtn", type: "button", ...attrs, onclick }, icon(ic, "xs"), label);
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
      const info = h("div", { class: "sub", style: "margin-top:var(--sp-2)" });
      const paint = () => { const hol = Pricing.KR_HOLIDAYS[date.value]; const d = date.value ? new Date(date.value + "T12:00:00Z").getUTCDay() : null;
        // a weekday holiday also leaves out weekend-only prices (with the site's days): say so, and that some clinics take them
        const wkHol = WHEN_COL && Pricing.weekdayHoliday(date.value);
        info.textContent = date.value ? `${DOW[d]}요일${hol ? ` · 공휴일(${hol}) — ${wkHol ? "평일에만 되는 가격과 주말에만 되는 가격은 빠져요. 공휴일에도 주말 가격을 받는 병원이 있으니 병원에 확인하세요" : "평일에만 되는 가격은 빠져요"}` : d === 0 || d === 6 ? " · 주말 — 평일에만 되는 가격은 빠져요" : ""}` : ""; };
      date.addEventListener("input", paint); paint();
      // a file without the site's days / hours (before C #71) can only use the tags: say so instead of promising the days
      const intro = `'${Pricing.condLabel("평일 낮")}', '${Pricing.condLabel("시간대")}', '일요일'처럼 요일·시간이 붙은 가격 중 이날 안 되는 것을 빼요. `
        + (WHEN_COL ? "사이트에 적힌 요일·시간으로 거르고, 되는 시간을 모르면 '시간 확인 필요'로 남겨요."
          : "되는 시간을 모르면 '시간 확인 필요'로 남겨요. 화수목처럼 정해진 요일은 병원에 확인하세요.");
      return h("div", {}, h("div", { class: "sub" }, intro),
        h("label", { class: "flabel" }, "날짜", date), h("label", { class: "flabel" }, "시간", time), info,
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "공휴일은 2026-10-13 기준이에요(대체공휴일 포함)."),
        h("div", { class: "row", style: "margin-top:var(--sp-3)" },
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
  function paintUpd() { const el = $("#upd"); if (!el || !D) return; el.textContent = `${md(D.meta.updated)} 수집 · ${regionCount()}곳`; el.title = `${D.meta.updated} 수집 · ${branchCountText()}`; }
  function regionSheet() { sheet("지역", (close) => h("div", {}, h("div", { class: "sub", style: "margin:var(--sp-2) 0" }, "비교·내 견적·검색에 이 지역 지점만 보여요"), regionSelect(close))); }

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
  // set: what to do once a place is chosen here (GPS, 집·직장 or a 동네 name — also the 동네 box GPS falls back to); closing
  // the sheet without one does nothing (비교's '가까운 5곳' turns 가까운순 on only then — review of hierarchy 3-1)
  function locSheet(set) {
    const p = places(), done = () => { if (typeof set === "function") set(); };
    sheet("거리 기준 위치", (close) => h("div", {},
      h("div", { class: "sub" }, "가까운순·거리 제한·지도에 쓰는 기준이에요. 집·직장은 이 휴대폰에만 저장돼요."),
      h("div", { class: "opts", style: "margin-top:var(--sp-2)" },
        h("button", { class: "opt", type: "button", onclick: () => { close(); locate(set, set); } }, h("b", {}, icon("locate-fixed", "sm"), "현재 위치"), h("span", {}, "GPS 권한 필요")),
        ["집", "직장"].map((n) => h("button", { class: "opt", type: "button", "aria-pressed": st.locName === n ? "true" : "false", disabled: !p[n], onclick: () => { close(); usePlace(n); done(); } },
          h("b", {}, icon(n === "집" ? "house" : "building-2", "sm"), n), h("span", {}, p[n] ? "저장됨" : "아직 없음")))),
      st.loc ? h("div", { class: "row", style: "margin-top:var(--sp-3)" },
        ["집", "직장"].map((n) => h("button", { class: "btn sm gray", type: "button", onclick: () => { savePlace(n, st.loc.lat, st.loc.lng); close(); render(); } }, `지금 기준을 ${n}으로 저장`)),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { st.loc = null; st.locName = ""; store.set("locPlace", ""); $("#locbtn").classList.remove("on"); $("#locbtn span").textContent = "내 위치"; close(); render(); } }, "위치 끄기")) : null,
      p["집"] || p["직장"] ? h("div", { class: "row", style: "margin-top:var(--sp-2)" }, h("button", { class: "linkbtn", type: "button", onclick: () => {
        const before = places(); store.set("places", {});
        if (st.locName === "집" || st.locName === "직장") { st.loc = null; st.locName = ""; store.set("locPlace", ""); $("#locbtn").classList.remove("on"); $("#locbtn span").textContent = "내 위치"; }
        close(); render(); undoToast("저장한 집·직장을 지웠어요", () => { store.set("places", before); render(); }); } }, "저장한 집·직장 지우기")) : null,
      h("div", { class: "flabel", style: "margin-top:var(--sp-3)" }, "동네·역 이름으로 (위치 권한 없이)"), areaSearch(() => { close(); done(); }),
      h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "지도 탭의 '지도 가운데를 집으로'·'직장으로'로도 저장할 수 있어요.")));
  }
  // then: after the place is set (or "keep": leave the order as it is); areaThen: after a 동네 is picked in the sheet that
  // opens when GPS gives no place
  function locate(then, areaThen) {
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
        h("div", { style: "margin-top:var(--sp-2)" }, areaSearch(() => { close(); if (typeof areaThen === "function") areaThen(); }))));
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  // ---------------- favorites (procedures and branches, this phone): pinned in comparisons and on 홈
  const favs = () => { const f = store.get("favs", null); return f && f.k && f.b ? f : { k: [], b: [] }; };
  const isFav = (kind, id) => favs()[kind].includes(id);
  function toggleFav(kind, id, label) {
    const f = favs(), on = f[kind].includes(id);
    f[kind] = on ? f[kind].filter((x) => x !== id) : [id, ...f[kind]].slice(0, 30);
    if (!on) { favPop = `${kind}:${id}`; metric("keep_fav"); }
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
        if (remote && A.user && A.user.id === uid) { Object.assign(c, { name: remote.name, items: remote.items, ver: remote.ver }); store.set("carts", st.carts); render(); toast("다른 기기에서 바뀐 내 견적을 불러왔어요"); }
      }
    });
    cartQ.set(c.id, run.catch(() => {}));
    return run;
  }
  const saveCarts = () => {
    for (const x of st.carts) if (!x.id) x.id = newId();
    store.set("carts", st.carts); store.set("ci", st.ci); paintCartN();
    const A = window.Auth && window.Auth.enabled ? window.Auth : null;
    if (A && A.user) { const uid = A.user.id; clearTimeout(cartPush); cartPush = setTimeout(() => Promise.all(st.carts.map((c) => pushCart(A, c, uid))).catch(() => toast("내 견적을 계정에 저장하지 못했어요(이 휴대폰에는 저장됨)")), 800); }
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
  // the spec named on a 담기 button ('담기 · 2cc'): the button alone must say what it adds (6.0: '+담기가 뭘 담는지'). The same
  // short name everywhere the key's own button shows (compare header, home cards, quick compare); the full name is in aria-label.
  // A family's only option is called '기본' (348 of them): that names nothing, so the key's own name ('코 조각주사') goes there.
  // A long name (758 keys over 20 characters) gives its short name (Spec.shortLabel — '담기 · 리쥬베룩 패키지', 위계 점검 39; a
  // bracket of an amount alone, '(100U)', stays); the full name stays in the button's aria-label and the title above it
  const addTarget = (k) => Spec.shortLabel(famOf[k] && famOf[k].label !== "기본" ? famOf[k].label : KEYS[k].label);
  const addBtn = (k) => {
    const target = addTarget(k), id = KEYS[k].id;
    const b = h("button", { class: "addbtn", type: "button", "aria-pressed": inCart(k) ? "true" : "false",
      "aria-label": `${inCart(k) ? "담김" : "담기"} · ${target} — ${KEYS[k].label} ${inCart(k) ? "횟수 바꾸기" : "내 견적에 담기"}` },
      icon(inCart(k) ? "check" : "plus", "sm"), h("span", {}, h("span", { class: "av" }, `${inCart(k) ? "담김" : "담기"} · `), target));   // .av: hidden on 320px home cards
    // the spec on screen goes in with one tap (audit U11, 위계 점검 1 — no second spec picker); once it is in, the same button
    // opens the sheet to change sessions, the option or the cart, or to take it out. Queued until the full file is in (a home
    // card on a first visit): the key is found again by its id there, since home.json numbers its keys differently
    b.addEventListener("click", (e) => { e.stopPropagation(); whenFull(() => { const kk = KI[id]; if (kk == null) return; if (inCart(kk)) addKeySheet(kk); else quickAdd(kk); }, inCart(k) ? "전체 가격을 받는 대로 담기 화면을 열게요" : "전체 가격을 받는 대로 담을게요"); });
    return b;
  };
  // one toast for every way into 내 견적 (6.0 표 3행, 위계 점검 22): a fixed line saying what went in and how many the cart now
  // holds, 죠미's line under it. With two or more 내 견적 the line names the cart, and only then does 죠미 talk about the others.
  // 죠미 설정 '끄기': the fixed line alone — her face and her words both stay out
  function addedToast(cart, what, undo) {
    const many = st.carts.length > 1, t = what.length > 30 ? `${what.slice(0, 29)}…` : what;
    jomiToast("happy", `${many ? `'${cart.name}'에` : "내 견적에"} 담았어요 · ${t} (${cart.items.length}개)`, ["되돌리기", undo],
      jprefs().freq === "off" ? null : many ? jline("addedMany") : jline("added"));   // literal intents: tests/jomilines.test.js reads them
  }
  function quickAdd(k) {
    const c = cur(), it = { t: "k", k: KEYS[k].id, q: 1 };
    c.items.push(it); track("cart_add", { k: it.k }); metric("keep_cart"); saveCarts(); render();
    addedToast(c, KEYS[k].label, () => { c.items = c.items.filter((x) => x !== it); saveCarts(); render(); toast("되돌렸어요"); });
  }
  // a price row's 담기: the row already shows what it is, the name says it for screen readers (위계 점검 21 — '담기' ×400)
  const rowAddBtn = (i) => h("button", { class: "addbtn", type: "button", "aria-label": `${S[ROWS[i][2]]} · ${bname(ROWS[i][0])} 내 견적에 담기`,
    onclick: (e) => { e.stopPropagation(); addRowSheet(i); } }, icon("plus", "sm"), "담기");

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
      h("div", { class: "row" }, h("h3", {}, title), h("span", { class: "sp" }), h("button", { class: "tbtn-i", type: "button", "aria-label": "닫기", style: "margin:-8px -8px 0 0", onclick: () => close() }, icon("x"))), body(close));
    bg.append(sh);
    document.body.append(bg);
    setTimeout(() => { const bs = [...sh.querySelectorAll("button")].filter((x) => !x.disabled), first = sh.querySelector("input, select, textarea") || bs[1] || bs[0]; if (first) first.focus(); }, 30);   // a disabled '하나 빼기' cannot take focus
    return close;
  }
  // small text-input sheet (cart names …) with inline validation instead of window.prompt
  function nameSheet(title, initial, save) {
    sheet(title, (close) => {
      const inp = h("input", { class: "field", value: initial || "", maxlength: "30", "aria-label": "이름" });
      const err = h("div", { class: "ferr", role: "alert", hidden: true }, "이름을 적어 주세요");
      const ok = () => { const v = inp.value.trim(); if (!v) { err.hidden = false; inp.setAttribute("aria-invalid", "true"); inp.focus(); return; } save(v.slice(0, 30)); close(); };
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } });   // preventDefault: the same Enter must not also press the button focus returns to
      return h("div", {}, inp, err, h("button", { class: "btn", type: "button", style: "width:100%;margin-top:var(--sp-3)", onclick: ok }, "저장"));
    });
  }
  const qtyEl = (get, set, max = 20) => h("span", { class: "qty" },
    h("button", { type: "button", "aria-label": "하나 빼기", disabled: get() <= 1, onclick: () => set(Math.max(1, get() - 1)) }, icon("minus", "sm")), h("b", { class: "num" }, get()),
    h("button", { type: "button", "aria-label": "하나 더", disabled: get() >= max, onclick: () => set(Math.min(max, get() + 1)) }, icon("plus", "sm")));
  function cartPicker(sel, set) {
    if (st.carts.length < 2) return null;
    return h("div", {}, h("div", { class: "sub", style: "margin:var(--sp-3) 0 var(--sp-2)" }, "담을 내 견적"),
      h("div", { class: "chips" }, st.carts.map((c, i) => h("button", { class: "chip", type: "button", "aria-pressed": i === sel ? "true" : "false", onclick: () => set(i) }, c.name))));
  }
  // add a comparable procedure: pick the option (variant), sessions and cart. Opened from a '담김' button (the key is already
  // in this 내 견적): what was asked for comes first — its sessions (as they are now), the cart, 빼기 / n회로 바꾸기 — and the
  // family's other options fold under it (위계 점검 1 검토: 30 options pushed the buttons off the screen)
  function addKeySheet(k0) {
    const had = cur().items.find((c) => c.t === "k" && c.k === KEYS[k0].id);
    const s = { k: k0, q: had ? had.q || 1 : 1, ci: st.ci, more: false };
    const fam = famOf[k0];
    sheet(fam ? fam.f.name : KEYS[k0].label, (close) => {
      const box = h("div", {});
      // each option's numbers once per sheet: they do not change with the sessions or the cart chosen here, and '+'·'−'
      // repaint the sheet (X12: 68 options — keyNums for all of them on every tap was ~10ms on a desktop)
      const HL = FLAGS.lowestHighlight, memo = new Map();
      const numsOf = (k) => { if (!memo.has(k)) memo.set(k, HL ? cmpRk(ranking(k, "price")) : keyNums(k)); return memo.get(k); };
      const paint = () => {
        // ② off: the compare header's numbers (keyNums — same basis, same branch count, same '중간값'), no clinic named
        const top = HL ? numsOf(s.k)[0] : null, N = HL ? null : numsOf(s.k);
        const have = st.carts[s.ci].items.find((c) => c.t === "k" && c.k === KEYS[s.k].id);
        const opts = fam && fam.f.vs.length > 1 ? h("div", { class: "opts" }, fam.f.vs.map((v) => { const vr = HL ? numsOf(v.k) : null, vN = HL ? null : numsOf(v.k);
          return h("button", { class: "opt", type: "button", "aria-pressed": v.k === s.k ? "true" : "false", onclick: () => { s.k = v.k; paint(); } },
            h("b", {}, v.label), h("span", { class: "num" }, vr ? (vr.length ? `최저 ${won(vr[0].p)}` : "가격 없음") : vN ? `중간 가격 ${won(vN.med)}` : "가격 없음")); })) : null;
        const optFold = had && opts ? h("details", { class: "fold small optfold", open: s.more, ontoggle: (e) => { s.more = e.currentTarget.open; } },
          h("summary", {}, `다른 옵션 ${fam.f.vs.length - 1}개`), opts) : null;
        fill(box,
          opts && !had ? h("div", {}, h("div", { class: "sub", style: "margin:var(--sp-3) 0 var(--sp-2)" }, "옵션"), opts) : null,
          h("div", { class: "row", style: "margin-top:var(--sp-3)" }, h("div", {}, h("div", { class: "sub" }, "횟수"), h("div", { class: "sub" }, "체험가·한정가·첫 방문가는 첫 회만 그 가격")),
            h("span", { class: "sp" }), qtyEl(() => s.q, (v) => { s.q = v; paint(); })),
          cartPicker(s.ci, (i) => { s.ci = i; paint(); }),
          top ? h("div", { class: "hero", style: "margin-top:var(--sp-3)" }, h("span", { class: "hl" }, `${KEYS[s.k].label} · 가장 싼 곳`), h("span", { class: "hb" }, bname(top.b)),
            h("span", { class: "hp num" }, won(top.p)))
            : N ? h("div", { class: "note", style: "margin-top:var(--sp-3)" }, `${KEYS[s.k].label} · ${regionName()} · ${N.ptop ? "일반가" : "특가 포함"} ${N.prices.length}곳 · ${Pricing.rangeText(N.lo, N.hi)} · 중간 가격 ${won(N.med)}`) : null,
          h("div", { class: "row", style: "margin-top:var(--sp-3)" },
            have ? h("button", { class: "btn gray", type: "button", onclick: () => { const c = st.carts[s.ci], pos = c.items.indexOf(have); c.items = c.items.filter((x) => x !== have); saveCarts(); close(); render();
              undoToast(jline("removed") || "내 견적에서 뺐어요", () => { c.items.splice(pos, 0, have); saveCarts(); render(); }); } }, "빼기") : null,
            h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => {
              const c = st.carts[s.ci], it = have || { t: "k", k: KEYS[s.k].id, q: s.q };
              if (have) have.q = s.q; else { c.items.push(it); track("cart_add", { k: it.k }); metric("keep_cart"); }
              saveCarts(); close(); render();
              if (have) toast("횟수를 바꿨어요");
              else addedToast(c, KEYS[s.k].label, () => { c.items = c.items.filter((x) => x !== it); saveCarts(); render(); toast("되돌렸어요"); });
            } }, have ? `${s.q}회로 바꾸기` : `${s.q}회 담기`)),
          optFold);
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
  const ADDON_COND = "추가 옵션이에요(본 시술과 함께)";
  // the build's '첫 방문' tag also stands for '첫 시술'·'첫경험' (build2/clean.py TAGS): the price may be for someone new to the
  // clinic or new to that treatment — the sites do not say which (C 2026-10-19, docs/TREATMENT_TAXONOMY.md §6)
  const FIRST_COND = "첫 방문·첫 시술 조건";
  const COND_WORDS = [[/(\d[\d,]*\s*만?\s*원)\s*이상\s*(결제|구매|시술|시)/, "최소 결제 금액 조건이 있어요"], [/\d+\s*(샷|cc|U|회|부위)\s*이상\s*(시|구매|결제)?/i, "최소 수량 조건이 있어요"],
    [/단독\s*(불가|시술\s*불가|사용\s*불가)/, "단독으로는 못 받아요(다른 시술과 함께)"], [/(^|\s|\(|\])옵션\s*\d*\)|추가\s*(시|구매|결제)|\d\s*(샷|cc|U)\s*추가|(^|\s)추가(\s|$)/, ADDON_COND],
    [/동시\s*시술|함께\s*시술|(진행|구매|결제|이용)\s*(고객|시)/, "다른 시술을 받거나 산 사람만"], [/첫\s*방문|신규|웰컴|첫\s*시술|첫\s*경험|첫\s*구매/, FIRST_COND],
    [/1\s*인\s*(당\s*)?1\s*회/, "1인 1회"], [/선착순|한정\s*수량/, "선착순·수량 한정"], [/평일|주말|타임\s*세일|\d\s*시\s*(이전|전|까지)|프라임\s*타임/, "요일·시간 조건"],
    [/팁\s*(별도|미포함)|별도\s*(구매|비용)/, "추가 비용이 따로 있어요"]];
  function priceConds(i) {
    // the name without a new device's '신규 런칭·입고·도입' (Spec.dropNewItem, C #99): that '신규' is not a first-visit price
    const r = ROWS[i], n = Spec.dropNewItem(S[r[2]]), out = new Set();
    // the add-on line: with the build's add-on field the sheet says what the badge says (addonOf), the name only in older files
    for (const [rx, t] of COND_WORDS) if ((t === ADDON_COND && ADDON_COL) ? addonOf(r) : rx.test(n)) out.add(t);
    // '평일 낮' and '시간대' (해피아워·화수목·점심·평일 한정…): the same words as the name rule above (and no '한정', which eligOf drops)
    for (const t of (S[r[6]] || "").split("·").filter(Boolean)) out.add(t === "첫 방문" ? FIRST_COND : t === "1인 1회" ? "1인 1회" : t === "평일 낮" || t === "시간대" ? "요일·시간 조건" : `${t} 조건`);
    for (const x of Pricing.whenLines(r[20], r[21])) out.add(x);    // the days / hours the site wrote: '되는 요일: 화·수·목', '되는 시간: 12:00~15:00'
    if (r[5] === 1) out.add("체험가(보통 1인 1회)");
    if (r[5] === 2) out.add("한정가(기간·수량·첫 방문·재방문 등 조건)");
    if (isRevisitRow(r)) out.add(REVISIT_COND);
    if (r[17] === 2) out.add("되는 시간대를 앱이 알지 못해요");
    if (r[22] === 1) out.add("방문일에는 행사가 끝났을 수 있어요");
    return [...out];
  }
  // a price is 'normal' (shown as the plain lowest) only with no condition, at a branch read this week, valid on the chosen visit
  const plainOk = (i) => !isSpecial(ROWS[i]) && !ROWS[i][15] && !ROWS[i][17] && !fresh(ROWS[i][0]).stale && !priceConds(i).length && cmpOk(i);
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
    if (kid != null) { const rk = cmpRk(ranking(kid, "price")), ps = rk.map((x) => x.p), med = median(ps);
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
  // the numbers of comparison key k under the current settings, on ONE basis (audit U1·E7): plain prices when there are any
  // (one per branch, unverified ultra-lows set apart), else the comparable ones (cmpRk). prices / med: the median's basis and
  // its branch count; lo / hi: the range shown (ultra-lows left out). The compare header, its price card, the 담기 sheet and
  // the search shortcuts all read this, so one key never shows two different '중간값' (2026-10-16 hierarchy audit M1: the
  // sheet had the special-inclusive median, 아쿠아필 10,890원 against the header's 31,900원). null: no price here.
  function keyNums(k, rk = ranking(k)) {
    if (!rk.length) return null;
    const plain = plainRanking(k), { normal, lowp } = splitLow(plain), ptop = normal[0], lowI = new Set(lowp.map((x) => x.i));
    const rkc = cmpRk(rk);   // add-ons and VAT-unknown prices stay in the lists, not in these numbers
    const ctop = [...rkc].filter((x) => !lowI.has(x.i)).sort((x, y) => x.p - y.p)[0];
    const top = ptop || ctop || lowp[0];
    const basis = ptop ? plain : rkc, prices = basis.map((x) => x.p).sort((a, b) => a - b), med = median(prices);
    const shown = (ptop ? normal : rkc.filter((x) => !lowI.has(x.i))).map((x) => x.p), lo = Math.min(...shown), hi = Math.max(...shown);
    return { plain, normal, lowp, ptop, lowI, rkc, ctop, top, prices, med, shown, lo, hi };
  }
  // a key's price in a row that leads to its comparison (search shortcuts and kinds): the home card's basis — the median
  // (its card's head says '중간값'; the row says it to a screen reader only, so the price cell is as narrow as the old
  // '110,000원~' and a 320px row's name keeps its room), then the range (same unit at both ends) and the branch count of the region on
  // screen — the median's count, as in the compare header. One price, or all the same: no range repeating it ('모두 같은 가격').
  // With flags.lowestHighlight (B1-1): the lowest comparable price with '~' and its clinic, as before.
  // memo (a Map, optional): one search screen reads a key's numbers once even when it is in two cards.
  // → { p: the price cell, m: meta, n: branches with a price in the region }
  function keyPrice(k, memo) {
    if (FLAGS.lowestHighlight) { const rk = cmpRk(ranking(k, "price")), top = rk[0];
      return { p: h("span", { class: "p num" }, top ? won(top.p) + "~" : "-"), m: top ? `최저 ${bname(top.b)}` : `${regionName()} 가격 없음`, n: rk.length }; }
    const N = !memo ? keyNums(k) : memo.has(k) ? memo.get(k) : memo.set(k, keyNums(k)).get(k);
    if (!N) return { p: h("span", { class: "p num" }, "-"), m: `${regionName()} 가격 없음`, n: 0 };
    const n = N.prices.length, same = N.prices.every((x) => x === N.prices[0]);
    return { p: h("span", { class: "p num" }, h("span", { class: "sr" }, "중간 가격 "), won(N.med)),
      m: N.lo !== N.hi ? `${Pricing.rangeText(N.lo, N.hi)} · ${n}곳` : same && n > 1 ? `모두 같은 가격 · ${n}곳` : `${n}곳`, n };
  }
  const checkedOk = (i) => (CHK.get(i) || {}).s === 1;
  const CHECK_TXT = { 1: "병원 사이트에서 같은 이름·가격을 다시 확인했어요", 2: "병원 사이트에 상품명은 있지만 이 가격은 옆에서 찾지 못했어요 — 바뀌었을 수 있어요",
    3: "병원 사이트에서 이 상품을 찾지 못했어요 — 행사가 끝났거나 이름이 바뀌었을 수 있어요", 4: "병원 사이트를 읽지 못했어요",
    5: "병원 사이트의 같은 상품 칸에서 이 가격을 찾았어요 (상품명 바로 옆은 아니에요)" };
  function priceSheet(i) {
    const r = ROWS[i], b = r[0], f = fresh(b), conds = priceConds(i), stx = priceStats(i), low = isLow(i, stx);
    const vatTxt = r[12] === 2 ? (st.vat === "incl" ? `병원 표시가 ${won(r[14])} + 부가세 10% = ${won(r[3])}` : `병원 표시가 ${won(r[14])} (부가세 별도, 결제 땐 10% 더 붙을 수 있어요)`)
      : r[12] === 1 ? `${won(r[3])} (병원이 '부가세 포함'이라고 적음)` : `${won(r[3])} (부가세 포함 여부를 사이트에서 찾지 못했어요)`;
    const u = S[r[10]] || "";
    const row = (k, v) => h("div", { class: "fact" }, h("dt", {}, k), h("dd", {}, v));
    sheet("가격 정보", (close) => h("div", {},
      h("div", { class: "item", style: "padding:var(--sp-2) 0" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])), h("span", { class: "m" }, bdot(b), bname(b), kindBadge(r))),
      (() => { const c = classOf(i, ROWS[i] && (S[ROWS[i][7]] || "").split(" ").includes(KEYS[st.key] && KEYS[st.key].id) ? st.key : null);
        track("price_sheet", { cls: c.c });
        return h("div", { class: `clsbox cls-${c.cmp}` }, h("div", { class: "row" }, h("b", { class: "sh", style: "margin:0" }, "비교 판정"), classBadge(c),
          h("span", { class: "sp" }), hereLink("circle-help", "A~J 뜻", () => clsSheet())), h("p", { class: "sub", style: "margin:var(--sp-2) 0 0" }, c.why)); })(),
      h("div", { class: "elig-wrap" }, h("b", { class: "sh" }, "가격 적용 조건"), eligList(i)),
      h("details", { class: "fold small specfold" }, h("summary", {}, "용량·종류 확인"), specList(specOfRow(i)), h("p", { class: "tiny" }, "상품명에서 읽은 것만이에요. '미확인'은 이름에 없다는 뜻이에요.")),
      low ? h("div", { class: "note warnnote" }, icon("circle-help", "sm"), `아주 낮은 가격이에요(중간 가격의 ${Math.round(r[3] / stx.med * 100)}%). 체험가·적은 용량·추가 옵션일 때가 많아요. 아래 조건을 꼭 확인하세요.`) : null,
      h("dl", { class: "facts" },
        row("가격과 부가세", vatTxt),
        row("가격 종류", { regular: "일반가 — 조건 문구가 없는 가격", event: `${r[5] === 1 ? "체험가" : "한정가"} — ${isRevisitRow(r) ? `다시 오는 손님(재방문)만 받는 행사 가격 · ${REVISIT_CART}` : "행사 가격"}`, cond: isRevisitRow(r) ? `특가 — 다시 오는 손님(재방문)만 · ${REVISIT_CART}` : "특가 — 첫 방문·요일·시간 조건이 맞을 때만", posted: "고시가 — 병원 게시 비급여 가격표(정가), 행사 가격 아님", pass: "이용권" }[priceClass(r)]),
        row("조건", conds.length ? h("ul", { class: "warns" }, conds.map((c) => h("li", {}, c))) : "상품명에 조건 문구가 없어요."),
        row("횟수", sessOf(i) >= 99 ? "이용권·무제한" : sessOf(i) > 1 ? `${sessOf(i)}회 묶음 가격` : "1회 가격(또는 횟수 표기 없음)"),
        row("유효기간", /^\d{4}-\d{2}-\d{2}$/.test(u) ? `${u}까지${r[15] === 1 ? " (끝남 — 비교에서 빠져요)" : ""}` : u.startsWith("posted:") ? `고시표 게시일 ${u.slice(7)}` : "적혀 있지 않아요"),
        row("비교 기준", stx ? (FLAGS.lowestHighlight ? `${stx.by} ${stx.n}곳의 지점별 최저가 중 ${stx.rank}번째 · 중간 가격 ${won(stx.med)}` : `${stx.by} ${stx.n}곳 · 중간 가격 ${won(stx.med)}`) + (stx.special ? " (특가 포함)" : " (일반가만)") : "같이 비교할 지점이 3곳 미만이에요"),
        row("정가(병원 표기)", r[4] ? `${won(r[4])} · ${Math.round((r[4] - r[3]) / r[4] * 100)}% 할인` : "정가 표기 없음"),
        row("확인일", `${f.d || "-"} 수집${f.stale ? " · 이번 주에 못 읽어 지난 가격이에요(최저가에서 빼요)" : " · 이번 주 확인됨"}`),
        row("원본", S[r[11]] ? h("a", { href: S[r[11]], target: "_blank", rel: "noopener noreferrer" }, "병원 원본 페이지 열기 ", icon("external-link", "xs")) : "원본 링크 없음"),
        row("정품 표기", /정품/.test(S[r[2]]) ? "상품명에 '정품'이라고 적혀 있어요(병원 표기, 앱이 확인한 것 아님)" : "표기 없음 · 앱은 정품 여부를 확인하지 않아요"),
        row("시술 의료진", "앱은 의료진 정보를 모으지 않아요. 누가 시술하는지 병원에 확인하세요"),
        (() => { const e = kbOfRow(i); return row("부작용·주의사항", e ? h("span", {}, (e.side_effects || []).slice(0, 3).join(" / ") || "정리 중", " ", hereLink("info", "자세히", () => { close(); kbSheet(e); })) : "이 상품의 시술 설명이 아직 정리되지 않았어요. 상담 때 꼭 물어보세요"); })(),
        row("다시 확인", CHK.has(i) ? `${md(CHK.get(i).d)} · ${CHECK_TXT[CHK.get(i).s]}` : low ? "아직 안 했어요" : "해당 없음(초저가만 다시 확인해요)"),
        r[15] === 2 ? row("검토", "지난 수집보다 크게 바뀌어 운영자 확인 전이라 비교에서 빠져요") : null),
      h("div", { class: "row", style: "margin-top:var(--sp-3)" }, h("button", { class: "btn sm gray", type: "button", style: "flex:1", onclick: () => { close(); checklistSheet({ id: `r:${bkey(r[0])}|${S[r[2]]}`, title: `${bname(r[0])} · ${S[r[2]]}`, i }); } }, icon("list-checks", "sm"), "방문 전 체크리스트"),
        shortBtn(r[0], "btn sm gray")),
      h("button", { class: "btn gray", type: "button", style: "width:100%;margin-top:var(--sp-2)", onclick: () => { close(); recheckSheet(i); } }, icon("refresh-cw", "sm"), "이 가격 다시 확인하기"),
      h("button", { class: "btn gray", type: "button", style: "width:100%;margin-top:var(--sp-2)", onclick: () => { close(); reportSheet(i); } }, icon("flag", "sm"), "사이트 가격과 달라요 (신고)")));
  }
  // what the comparability classes mean (domain/classify.js CLASSES), the same sentences the price sheet uses
  function clsSheet() {
    const lv = { direct: "그대로 비교", caution: "비교하되 확인", reference: "참고만", never: "비교 안 함" };
    sheet("비교 판정 A~J", () => h("div", {}, h("p", { class: "sub" }, "같은 시술의 다른 가격과 얼마나 같은지, 병원이 적은 상품명만 보고 판정해요(앱이 시술 내용을 확인한 건 아니에요)."),
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
      h("div", { class: "item", style: "padding:var(--sp-2) 0" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])), h("span", { class: "m" }, bdot(b), bname(b))),
      h("div", { class: "note" }, h("b", {}, "지금은 시연 단계예요. "), "눌러도 병원 사이트를 바로 다시 읽지 않아요(재수집 서버가 아직 없어요). 직접 확인하거나 재확인을 요청할 수 있어요."),
      h("h3", { style: "margin-top:var(--sp-3)" }, "윤실장이 가진 기록"),
      h("dl", { class: "facts" },
        row("병원 가격을 읽은 날", `${f.d ? md(f.d) : "-"}${f.n != null ? ` (${f.n === 0 ? "오늘" : `${f.n}일 전`})` : ""}`),
        row("이번 주 수집", f.stale ? "실패 — 지난 자료를 보여주고 있어요" : "성공"),
        row("다시 확인", CHK.has(i) ? `${md(CHK.get(i).d)} · ${CHECK_TXT[CHK.get(i).s]}` : "따로 확인하지 않았어요(초저가만 해요)"),
        row("앱 가격", `${md(D.meta.updated)} 수집`),
        row("다음 정기 수집", `${md(nextCollect())}(월) 06:00 무렵 · 이벤트가 끝난 다음 날에도 모아요`)),
      h("h3", { style: "margin-top:var(--sp-3)" }, "직접 확인"),
      S[r[11]] ? h("a", { class: "btn gray", style: "width:100%;text-align:center;text-decoration:none;margin-top:var(--sp-2)", href: S[r[11]], target: "_blank", rel: "noopener noreferrer" }, icon("external-link", "sm"), "병원 원본 페이지 열기")
        : h("div", { class: "sub" }, "원본 링크가 없어요."),
      h("h3", { style: "margin-top:var(--sp-3)" }, "재확인 요청 (실제 접수)"),
      h("div", { class: "sub" }, "운영자에게 공개 글(GitHub 이슈)로 가요. 확인되면 다음 갱신에 반영돼요. 같은 가격은 하루 한 번, 하루 10번까지 보낼 수 있어요."),
      mine ? h("div", { class: "note", style: "margin-top:var(--sp-2)" }, `오늘 이미 요청했어요(${mine.at}). 같은 가격은 하루에 한 번만 보내요.`)
        : todayN >= RECHECK_DAY ? h("div", { class: "note", style: "margin-top:var(--sp-2)" }, `오늘 요청을 ${RECHECK_DAY}번 보냈어요. 내일 다시 보낼 수 있어요.`)
        : h("a", { class: "btn", style: "width:100%;text-align:center;text-decoration:none;margin-top:var(--sp-2)", target: "_blank", rel: "noopener",
          href: `https://github.com/lsy2825/skin/issues/new?${new URLSearchParams({ title: `[재확인 요청] ${bname(b)} ${S[r[2]]}`.slice(0, 120), body: body(), labels: "price-recheck" })}`,
          onclick: () => { store.set("rechecks", [{ at: today(), key, n: S[r[2]], br: bkey(b) }, ...log].slice(0, 100)); setTimeout(close, 100); } }, icon("send", "sm"), "GitHub로 재확인 요청"),
      h("p", { class: "tiny", style: "margin-top:var(--sp-2)" }, "GitHub 화면에서 '제출'을 눌러야 접수돼요. 공개 글이라 개인정보는 적지 마세요.")));
  }
  function addRowSheet(i) {
    const r = ROWS[i], n = S[r[2]], keys = S[r[7]] ? S[r[7]].split(" ").map((id) => KI[id]).filter((x) => x != null) : [];
    const s = { q: 1, ci: st.ci, how: "row" };
    const same = (byName.get(r[2]) || []).map((x) => ROWS[x][0]).filter((b, j, a) => a.indexOf(b) === j).length;
    sheet("내 견적에 담기", (close) => {
      const box = h("div", {});
      const paint = () => fill(box,
        h("div", { class: "item", style: "padding:var(--sp-2) 0" }, h("span", { class: "t" }, n), h("span", { class: "p num" }, won(r[3])),
          h("span", { class: "m" }, bdot(r[0]), bname(r[0]), listS(r), kindBadge(r), sessOf(i) > 1 ? h("span", { class: "k k4" }, sessOf(i) >= 99 ? "이용권" : `${sessOf(i)}회 가격`) : null)),
        h("div", { class: "opts" },
          h("button", { class: "opt", type: "button", "aria-pressed": s.how === "row" ? "true" : "false", onclick: () => { s.how = "row"; paint(); } },
            h("b", {}, "이 옵션 그대로"), h("span", {}, `같은 이름 상품이 있는 ${same}개 지점끼리 비교`)),
          keys.map((k) => h("button", { class: "opt", type: "button", "aria-pressed": s.how === k ? "true" : "false", onclick: () => { s.how = k; paint(); } },
            h("b", {}, `같은 시술로: ${KEYS[k].label}`), h("span", {}, "모든 브랜드·지점과 비교")))),
        typeof s.how === "number" ? specNotes(famOf[s.how]) : null,
        h("div", { class: "row", style: "margin-top:var(--sp-3)" }, h("span", { class: "sub" }, "횟수"), h("span", { class: "sp" }), qtyEl(() => s.q, (v) => { s.q = v; paint(); })),
        cartPicker(s.ci, (x) => { s.ci = x; paint(); }),
        h("div", { class: "row", style: "margin-top:var(--sp-3)" },
          h("button", { class: "btn sm gray", type: "button", style: "flex:1", onclick: () => { close(); priceSheet(i); } }, icon("info", "sm"), "가격 정보"),
          h("button", { class: "btn sm gray", type: "button", style: "flex:1", onclick: () => { close(); alertSheet({ row: { n, br: bkey(r[0]) } }); } }, icon("bell", "sm"), /^\d{4}-\d{2}-\d{2}$/.test(S[r[10]] || "") ? "종료 전 알림" : "가격 알림"),
          h("button", { class: "btn sm gray", type: "button", style: "flex:1", onclick: () => { close(); reportSheet(i); } }, icon("flag", "sm"), "신고")),
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:var(--sp-3)", onclick: () => {
          const cart = st.carts[s.ci], items = cart.items;
          let added = null;
          if (s.how === "row") {
            const ov = {};
            added = { t: "r", n, br: bkey(r[0]), p: r[3], q: s.q, ov }; items.push(added);
          } else {
            const id = KEYS[s.how].id, have = items.find((c) => c.t === "k" && c.k === id);
            if (have) have.q = s.q; else { added = { t: "k", k: id, q: s.q, ov: { [bkey(r[0])]: n } }; items.push(added); }
          }
          if (added) metric("keep_cart");
          saveCarts(); close(); render();
          if (!added) toast("횟수를 바꿨어요");
          else addedToast(cart, added.t === "r" ? n : KEYS[s.how].label, () => { cart.items = cart.items.filter((x) => x !== added); saveCarts(); render(); toast("되돌렸어요"); });
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
  // a day/time price whose event ends before the chosen visit (r[22]) is not repeated: first session only (user decision 2026-10-16)
  // a revisit price (C #111) is a once price for the one who may take it (Pricing.canTake): never repeated on a guess;
  // first: the tag '첫 방문' (신규·첫 방문가), not for one who has been to that clinic; trial: a revisit 체험가 ('[재진] 1회 체험 …',
  // Pricing.isTrial), not for one who had the treatment before either (user decision 2026-10-19)
  const asC = (i) => { const c = condClassOf(ROWS[i]); return { i, p: ROWS[i][3], special: isSpecial(ROWS[i]), repeat: c === "repeat" && ROWS[i][22] !== 1, revisit: c === "revisit",
    trial: c === "revisit" && !!Pricing.isTrial && Pricing.isTrial(ROWS[i][5], S[ROWS[i][6]]), first: isFirstVisit(ROWS[i]) }; };
  // '이 병원에 다녀왔어요' (user decision 2026-10-19): the clinics this phone's person has been to, by branch key (bkey: the same
  // clinic whatever this week's file numbers it). Their own history like it.done: never in a shared link or the total it carries.
  let visMemo = null, visAnchor = null;
  const visitedSet = () => { const sc = App.scope(); if (!visMemo || visMemo.sc !== sc) { const L = store.get("visited", []); visMemo = { sc, set: new Set(Array.isArray(L) ? L : []) }; } return visMemo.set; };
  const visitedAt = (b) => visitedSet().has(bkey(b));
  // stored only (the caller redraws): the 내 견적 합계 alerts take the new totals as their base without a notice — a switch the
  // person turned is not a price change (rebaseCartAlerts, review 2026-10-19)
  function markVisited(b, on) {
    const k = bkey(b), L = [...visitedSet()].filter((x) => x !== k);
    store.set("visited", on ? [...L, k] : L); visMemo = null;
    rebaseCartAlerts();
  }
  function setVisited(b, on) { markVisited(b, on); render(); }
  // price of q sessions of an item at branch b (Pricing.lineCost); it.sp overrides 특가 포함 for this line, it.done (the item's
  // '전에 이 시술을 받아 봤어요' switch) leaves out the once prices, vis (the branch's '이 병원에 다녀왔어요') lets its revisit
  // prices in and leaves its first-visit ones out (Pricing.forVisitor) — also one picked for this branch
  const hasTag = (i, tag) => (S[ROWS[i][6]] || "").split("·").includes(tag);
  // the row picked for branch b (it.ov holds its name), or null
  function ovRow(it, b) {
    const n = it.ov && it.ov[bkey(b)];
    if (n == null || !SI.has(n)) return null;
    const i = (byName.get(SI.get(n)) || []).find((x) => ROWS[x][0] === b && live(x));
    return i == null ? null : i;
  }
  // a picked price the switches leave out (a once price with it.done on, a revisit one at a clinic not marked visited, a first-visit
  // one at a clinic marked visited): the pick stays stored (back when the switch turns) but is not in use
  const ovDropped = (it, b, vis = visitedAt(b)) => { const i = ovRow(it, b); return i != null && !Pricing.canTake(asC(i), !!it.done, vis); };
  function lineAt(it, b, noOnce = false, vis = visitedAt(b)) {
    const oi = ovRow(it, b);
    let ov = oi == null ? null : { ...asC(oi), sess: sessOf(oi) };
    const sp = it.sp ?? st.special;
    const keep = (i) => !noOnce || !hasTag(i, "첫 방문");
    const cands = (list) => Pricing.forVisitor(list.filter(keep).map(asC), !!it.done, vis);
    if (ov && (!keep(ov.i) || ovDropped(it, b, vis))) ov = null;
    return Pricing.lineCost(cands(itemRows(it, b, sp)), cands(itemRows(it, b, false)), it.q || 1, ov);
  }
  // the item has a once price at some branch in view, so '전에 이 시술을 받아 봤어요' changes something (a revisit price is not
  // "once": that switch has nothing to do with it — except a revisit trial at a clinic marked visited, asC trial)
  const itemHasOnce = (it) => BR.some((x) => branchOk(x.i) && itemRows(it, x.i, true).some((i) => condClassOf(ROWS[i]) === "once" || (visitedAt(x.i) && asC(i).trial)));
  // what '이 병원에 다녀왔어요' changes at branch b for these items: a revisit price it lets in (rv) or a first-visit one it leaves
  // out (fv), among a line's candidates (with 특가 포함 for the line, as lineAt) or picked for the branch
  function visitStake(items, b) {
    let rv = false, fv = false;
    for (const it of items) {
      const oi = ovRow(it, b);
      // (a first-visit price is a once price: with '전에 이 시술을 받아 봤어요' on it is out already)
      // (a revisit trial with that switch on stays out once marked too: Pricing.canTake)
      for (const i of [...itemRows(it, b, it.sp ?? st.special), ...(oi == null ? [] : [oi])]) { if (isRevisitRow(ROWS[i])) { if (Pricing.canTake(asC(i), !!it.done, true)) rv = true; } else if (isFirstVisit(ROWS[i]) && !it.done) fv = true; }
    }
    return { rv, fv };
  }
  // the switch with what it does: '켜면 …' while off, the same words when on; null when there is nothing to change — unless it
  // is on and o.none gives the words then (it can always be turned off where it was turned on). o.where / o.tail: words before /
  // after what it does; o.vw: which copy (q a clinic's quote, head the branch page, item a cart line) — data-vb / data-vw let the
  // redraw find the same one (visAnchor); o.flip: what turning it does (setVisited when not given). Its name has the clinic in
  // it: several quotes open at once each have one (review 2026-10-19)
  function visitSwitch(b, { rv, fv }, o = {}) {
    const on = visitedAt(b);
    if (!rv && !fv && !(on && o.none)) return null;
    const what = [rv ? "재방문 가격은 넣고(첫 1회만)" : "", fv ? "첫 방문가는 빼고" : ""].filter(Boolean).join(", ");
    return h("div", { class: "visit", "data-vb": b, "data-vw": o.vw || "" },
      switchEl(VISIT_SW, on, (v) => (o.flip ? o.flip(v) : setVisited(b, v)), `${VISIT_SW} · ${bname(b)}`),
      h("span", { class: "sub" }, what ? `${on ? "" : "켜면 "}${o.where || ""}${what} 계산해요${o.tail || ""}` : o.none));
  }
  // the quote's switch (review 2026-10-19): turned, the clinic may move to the other list, or out of both (its every price of the
  // cart a first-visit one). '일부만 되는 곳' opens only when it moves there, the redraw keeps the switch where the finger was
  // (renderNow, visAnchor: the item line's copy when the clinic left both lists, itemVisitSw) and a toast says where it went
  // Returns whether it moved (then a toast has said where)
  function flipVisit(x, items, v) {
    const sw = document.querySelector(`#main .visit[data-vb="${x.b}"][data-vw="q"]`);
    visAnchor = sw ? { b: x.b, top: sw.getBoundingClientRect().top } : null;
    const was = x.missing && x.missing.length ? "part" : "full";
    markVisited(x.b, v);
    const p = cartPlan(items), now = p.full.some((y) => y.b === x.b) ? "full" : p.partial.some((y) => y.b === x.b) ? "part" : "";
    if (now === "part" && was !== "part") st.showPart = true;
    render();
    if (now !== was) undoToast(`${bname(x.b)}: ${now === "full" ? "모두 받을 수 있는 곳으로 옮겼어요" : now === "part" ? "일부만 되는 곳으로 옮겼어요" : "견적 비교에서 빠졌어요(담은 시술 줄에서 끌 수 있어요)"}`,
      () => setVisited(x.b, !v));
    return now !== was;
  }
  // the same switch on a cart line, where it decides whether the item has a price at a clinic at all: there its every price is a
  // revisit one (none until marked — shown while no clinic prices the item, and while marked: with q ≥ 2 it is still a once price,
  // so the words say what is missing) or a first-visit one (none once marked — the clinic may have left the comparison, so its
  // switch stays here). A pick for the clinic (it.ov) counts as one of its prices.
  const VIS_GONE = "다녀온 병원이라 첫 방문가를 뺐어요", TRIAL_GONE = "재방문 체험가만 있어요 — 전에 받아 본 시술이라 계산에서 뺐어요";
  function itemVisitSw(it, best) {
    const sp = it.sp ?? st.special, out = [];
    let off = null;
    for (const x of BR) {
      if (!branchOk(x.i)) continue;
      const oi = ovRow(it, x.i), rs = [...itemRows(it, x.i, sp), ...(oi == null ? [] : [oi])];
      if (!rs.length) continue;
      // gone: its every revisit price is a trial and the item's '전에 이 시술을 받아 봤어요' is on — marking it lets nothing in
      const on = visitedAt(x.i), rv = rs.every((i) => isRevisitRow(ROWS[i])), fv = !it.done && rs.every((i) => isFirstVisit(ROWS[i]) && !isRevisitRow(ROWS[i]));
      const gone = rv && !rs.some((i) => Pricing.canTake(asC(i), !!it.done, true));
      if (on && (rv || fv)) out.push({ b: x.i, rv, on, gone });
      else if (!on && rv && !gone && !best && !off) off = { b: x.i, rv, on, gone };
    }
    if (!out.length && off) out.push(off);
    return out.map(({ b, rv, on, gone }) => { const l = on && rv && !gone ? lineAt(it, b) : null;
      return h("div", { class: "cdone visit", "data-vb": b, "data-vw": "item" }, switchEl(`${VISIT_SW} · ${bname(b)}`, on, (v) => setVisited(b, v), `${VISIT_SW} · ${bname(b)}`),
        h("span", { class: "sub" }, !rv ? "첫 방문가만 있어요 — 다녀온 병원이라 계산에서 뺐어요" : gone ? TRIAL_GONE : !on ? "재방문 가격만 있어요 — 켜면 계산해요" : l && l.incomplete ? incTxt(l) : "재방문 가격으로 계산해요(첫 1회만)")); });
  }
  // a line that keeps a visit day / time price for its sessions (Pricing.lineCost repeat): the words under it
  const REPEAT_TXT = "방문일·시간 조건이 맞을 때 매번 이 가격";
  // the row used after the first session when it is another one (a once price first, Pricing.lineCost rows[1]), or null
  const laterRow = (l) => (l && l.rows.length > 1 ? ROWS[l.rows[1]] : null);
  const branchOk = (b) => brandOn(b) && regionOk(b) && (!st.maxKm || !st.loc || (dist(b) != null && dist(b) <= st.maxKm));
  // a line whose later sessions have no price (only a special exists, round-2 R14) is shown but never summed or compared
  const okL = (l) => !!l && !l.incomplete;
  const incTxt = (l) => `1회 ${won(l.total)}만 확인 · ${l.unpriced}회는 가격 없음(1회 가격이라 반복 여부 미확인) — 합계에서 뺐어요`;
  // whole cart across branches (Pricing.compareClinics): full / partial / mix / pair / savings
  // first-visit prices: at most one per branch unless the user turns it off (st.noStack, Pricing.limitOnce)
  // own = false: without this phone's '이 병원에 다녀왔어요' (a shared link's total, and the one it is checked against)
  function cartPlan(items, own = true) {
    const matrix = BR.filter((x) => branchOk(x.i)).map((x) => {
      const vis = own && visitedAt(x.i);
      let lines = items.map((it) => lineAt(it, x.i, false, vis));
      if (st.noStack) lines = Pricing.limitOnce(lines, lines.map((l) => !!l && hasTag(l.rows[0], "첫 방문")), (j) => lineAt(items[j], x.i, true, vis));
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
      h("div", { class: "row" }, inp, h("span", { class: "sub" }, "원"), h("span", { class: "sp" }), shown),
      h("div", { class: "sliders" }, rng),
      err,
      h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" }, [[100000, "10만"], [200000, "20만"], [300000, "30만"], [500000, "50만"], [1000000, "100만"], [0, "제한 없음"]].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": (c.budget || 0) === v ? "true" : "false", onclick: () => { inp.value = v || ""; apply(v); } }, l))),
      c.budget ? h("div", { style: "margin-top:var(--sp-2)" }, switchEl("예산 안만 보기", st.inBudget, (v) => { st.inBudget = v; render(); })) : null);
  }
  // conditions to check before visiting, for one branch's quote
  function quoteWarnings(x, items) {
    const w = [];
    const ls = x.lines.filter(Boolean);
    const sp = ls.filter((l) => isSpecial(ROWS[l.rows[0]])).length;
    if (sp) w.push(`특가 ${sp}개 — 1인 1회·첫 방문·요일·시간 조건을 병원에 확인하세요`);
    // a revisit price is only in the quote of a clinic marked '이 병원에 다녀왔어요' (C #111, user decision 2026-10-19)
    const rv = ls.filter((l) => l.rows.some((i) => isRevisitRow(ROWS[i]))).length;
    if (rv) w.push(`재방문 가격 ${rv}개 — 그 병원에 다시 오는 손님만 받는 가격이에요('${VISIT_SW}'를 켠 병원에서만 계산해요). 이 지점에서 받을 수 있는지 병원에 확인하세요`);
    // … and the first-visit prices it left out: the lines that would use one without it (review 2026-10-19)
    const fv = items && visitedAt(x.b) ? items.filter((it) => { const l0 = lineAt(it, x.b, false, false); return !!l0 && l0.rows.some((i) => isFirstVisit(ROWS[i]) && !isRevisitRow(ROWS[i])); }).length : 0;
    if (fv) w.push(`첫 방문가 ${fv}개 — '${VISIT_SW}'를 켠 병원이라 빼고 계산했어요`);
    if (ls.some((l) => l.restacked)) w.push("첫 방문가가 여러 개라 하나만 첫 방문가로, 나머지는 다음 가격으로 계산했어요");
    if (ls.some((l) => l.stackWarn)) w.push("첫 방문가만 있는 시술이 여러 개예요 — 함께 적용되는지 병원에 확인하세요");
    if (ls.some((l) => l.rows.some((i) => ROWS[i][17] === 2))) w.push("방문 시간에 되는 가격인지 병원에 확인하세요(앱이 시간대를 알지 못해요)");
    const over = ls.filter((l) => l.rows.some((i) => ROWS[i][22] === 1)).length;
    if (over) w.push(`방문일에는 행사가 끝났을 수 있는 가격 ${over}개 — 병원에 확인하세요`);
    const low = ls.filter((l) => isLow(l.rows[0])).length;
    if (low) w.push(`초저가 ${low}개(중간 가격의 ${Math.round(LOW_SHARE * 100)}% 이하) — 개당 가격이나 행사일 수 있어요. '가격 정보'에서 확인하세요`);
    if (x.missing && x.missing.length) w.push(`이 지점에서 가격을 확인하지 못한 시술 ${x.missing.length}개 — 합계에 넣지 않았어요(0원 아님)`);
    if (fresh(x.b).stale) w.push(`가격 확인일 ${fresh(x.b).d} — 최신이 아닐 수 있어요`);
    // CART_INTELLIGENCE_REPORT.md: quantity limits, package conditions, combining promotions
    if (ls.some((l) => l.incomplete)) w.push("1회 가격(체험가·첫 방문가 등)만 있는 시술은 2회째부터 가격이 없어 합계에서 뺐어요 — 반복 가격을 병원에 확인하세요");
    if (ls.some((l) => l.laterOther)) w.push("1회 가격(체험가·첫 방문가 등)은 첫 1회만, 2회째부터는 이 지점의 다른 가격으로 계산했어요 — 반복 여부는 병원마다 달라요");
    const pk = ls.filter((l) => sessOf(l.rows[0]) > 1 && sessOf(l.rows[0]) < 99).length;
    if (pk) w.push(`여러 회 묶음 가격 ${pk}개 — 한 번에 결제하는지, 사용 기간이 있는지 확인하세요`);
    if (sp >= 2) w.push(`특가 ${sp}개를 한 번에 받는 계산이에요 — 같은 날 함께 되는지 병원에 확인하세요`);
    return w;
  }
  // share: the cart travels in the link (#import/<base64url json>)
  const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
  function shareCart(c) {
    // '전에 이 시술을 받아 봤어요' (it.done) and '이 병원에 다녀왔어요' are the sender's own history: the link and the total it
    // carries leave them out, so the receiver (whose import drops it.done, and checks with cartPlan(…, false)) compares the same prices
    // (the 3곳 재확인 요청 text, which the person opens and sends themselves on GitHub, names the rows the quotes use — revisit ones too)
    // (a revisit price picked for a clinic can only be picked there once it is marked: such a pick stays out too — ovDropped
    // without the clinics, what the receiver leaves out anyway)
    const plain = c.items.map(({ done, ...x }) => (!x.ov ? x : { ...x, ov: Object.fromEntries(Object.entries(x.ov).filter(([k]) => { const b = BK.get(k); return b == null || !ovDropped(x, b, false); })) })),
      items = plain.filter(itemOk);
    const plan = items.length ? cartPlan(items, false) : null, best = plan && plan.full[0];
    const s = { from: store.get("sender", st.me.nick || ""), note: "" };
    sheet("내 견적 보내기", (close) => {
      const from = h("input", { class: "field", value: s.from, maxlength: "20", placeholder: "보내는 사람 (선택)", "aria-label": "보내는 사람" });
      const note = h("textarea", { class: "field", rows: "2", maxlength: "200", placeholder: "메모 (예: 이번 달에 같이 받자!)", "aria-label": "메모" });
      const preview = h("pre", { class: "preview" });
      const payload = () => ({ name: c.name, items: plain, from: from.value.trim().slice(0, 20), note: note.value.trim().slice(0, 200),
        sent: best ? { total: best.total, b: bkey(best.b), date: today(), vat: st.vat } : null });
      const link = () => `${location.origin}${location.pathname}#import/${enc(payload())}`;
      const text = () => [`${from.value.trim() ? `${from.value.trim()}님이 보낸 ` : ""}윤실장 견적 '${c.name}'`,
        ...c.items.map((it) => `- ${itemLabel(it)} ×${it.q || 1}`),
        best ? (FLAGS.lowestHighlight ? `한 곳 최저: ${bname(best.b)} ${won(best.total)}` : (() => { const ts = plan.full.map((x) => x.total); return `한 곳에서 다 받을 때 예상 ${Pricing.rangeText(Math.min(...ts), Math.max(...ts), WON)} (${ts.length}곳)`; })())
          + ` (${today()} 기준, ${st.vat === "incl" ? "부가세 포함가" : "병원 표시가"})` : null,
        note.value.trim() || null].filter(Boolean).join("\n");
      const paint = () => { preview.textContent = text(); };
      from.addEventListener("input", paint); note.addEventListener("input", paint); paint();
      return h("div", {}, h("label", { class: "flabel" }, "보내는 사람", from), h("label", { class: "flabel" }, "메모", note),
        h("div", { class: "flabel" }, "미리보기"), preview,
        h("div", { class: "row", style: "margin-top:var(--sp-3)" },
          h("button", { class: "btn gray", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(link()); toast("링크만 복사했어요"); } catch (e) { toast("복사하지 못했어요"); } } }, "링크만 복사"),
          h("button", { class: "btn", type: "button", style: "flex:1", onclick: async () => {
            store.set("sender", from.value.trim());
            try {
              if (navigator.share) await navigator.share({ title: "윤실장 견적", text: text(), url: link() });
              else { await navigator.clipboard.writeText(`${text()}\n${link()}`); toast("메시지와 링크를 복사했어요"); }
              close();
            } catch (e) { if (e && e.name !== "AbortError") toast("보내지 못했어요"); }
          } }, "보내기")));
    });
  }
  function quoteText(x, items) {
    return [`[${bname(x.b)}] 예상 견적 (${D.meta.updated} 기준)`,
      ...items.map((it, j) => { const l = x.lines[j]; if (!l) return `- ${itemLabel(it)}: 이 지점에 없음${visitedAt(x.b) && lineAt(it, x.b, false, false) ? ` (${VIS_GONE})` : ""}`;
        const r2 = laterRow(l);
        return `- ${itemLabel(it)} ×${it.q || 1}: ${l.incomplete ? incTxt(l) : won(l.total)} (${S[ROWS[l.rows[0]][2]]}${r2 ? ` · 2회째부터 ${S[r2[2]]}` : ""})${l.repeat && (it.q || 1) > 1 ? ` · ${r2 ? "2회째부터 " : ""}${REPEAT_TXT}` : ""}`; }),
      `합계 ${won(x.total)} (${st.vat === "incl" ? "부가세 포함가" : "병원 표시가, 대부분 부가세 별도"}) · 가격 확인 ${fresh(x.b).d} · 방문 전 병원 확인`,
      ...quoteWarnings(x, items).map((s) => `※ ${s}`)].join("\n");
  }

  // ---------------- price trend (weekly snapshots of regular prices; data.json "trend")
  const TR = () => D.trend || { dates: [], k: {}, disc: {} };
  const man = (n) => n >= 10000 ? `${(n / 10000).toFixed(n % 10000 ? 1 : 0).replace(/\.0$/, "")}만` : n.toLocaleString();
  // a price range as nodes: the two ends in one unit (Pricing.rangeText) and each end kept on one line, so a narrow screen
  // breaks the line at '~' only ('202.3만~' / '493.7만원', never '202.3' / '만~…'). Charts' axis ticks keep man().
  // opts.won: full won at both ends (내 견적, whose summary total is in won — one total, one unit on that screen)
  const rangeEl = (lo, hi, opts) => { const r = Pricing.rangeParts(lo, hi, opts); return r.one ? r.text : [h("span", { class: "nw" }, r.lo), "~", h("wbr"), h("span", { class: "nw" }, r.hi)]; };
  const WON = { won: true };
  // a price range drawn as a bar — one shape on every screen (2026-10-20 사용자 지시: 홈 '오늘의 발견'과 비교 가격 카드의 막대가
  // 달랐음; docs/DESIGN_SYSTEM.md §3 '범위 막대'): a 6px track with round ends from the lowest to the highest price, the middle
  // price as a filled 14px dot (같은 날 사용자 지시 "막대기보단 그전에 점으러 하는게 더 낫다" — it was a 2px line), a given price
  // (opts.at, read aloud as opts.atName) as a hollow 12px ring — another shape, so the two never read as one.
  // opts.label: '중간값 X원' under the dot (비교 가격 카드, 가격 종류별 범위). opts.axis [a, b]: a scale shared by several bars
  // (가격 종류별·지역별) — each track covers its own part, a hairline the rest. opts.name goes before the words read aloud;
  // opts.hidden when the line's own name already says them. Where the marks sit is Pricing.rangeMarks (unit-tested)
  function rangeBar(lo, hi, med, opts = {}) {
    const M = Pricing.rangeMarks(lo, hi, med, opts);
    // the scale runs between the centres of the track's round ends (3px in), so a mark at the lowest price sits on the end's centre
    const x = (f) => `calc(3px + (100% - 6px) * ${f.toFixed(4)})`;
    const words = `${opts.name ? opts.name + " " : ""}가격 범위 ${won(lo)}~${won(hi)}${med != null ? `, 중간 가격 ${won(med)}` : ""}${M.at != null ? `, ${opts.atName || "이 가격"} ${won(opts.at)}` : ""}`;
    return h("div", { class: `prange${opts.axis ? " axis" : ""}`, ...(opts.hidden ? { "aria-hidden": "true" } : { role: "img", "aria-label": words }) },
      h("span", { class: "pr-bar" },
        h("i", { class: "pr-t", style: `left:calc((100% - 6px) * ${M.lo.toFixed(4)});width:calc((100% - 6px) * ${(M.hi - M.lo).toFixed(4)} + 6px)` }),
        M.med != null ? h("b", { class: "pr-m", style: `left:${x(M.med)}` }) : null,
        M.at != null ? h("i", { class: "pr-d", style: `left:${x(M.at)}` }) : null),
      // the label in won like the compare header's '중간값 19,690원'; shifted by its own width × the place, so it never leaves the bar
      opts.label && M.med != null ? h("span", { class: "pr-l", style: `left:${x(M.med)};transform:translateX(-${(M.med * 100).toFixed(1)}%)` }, won(med)) : null);
  }
  const svg =(tag, attrs, ...kids) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v); kids.forEach((c) => c && e.append(c)); return e; };
  // change of the median between the last two snapshots that have the key
  function keyChange(id) {
    const v = (TR().k[id] || []).map((x) => x && x[0]);
    const idx = v.map((x, i) => (x != null ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) return null;
    const a = v[idx[idx.length - 2]], b = v[idx[idx.length - 1]];
    return { a, b, pct: (b - a) / a * 100 };
  }
  const chg = (c) => !c ? h("span", { class: "sub" }, "변동 기록 전") : Math.abs(c.pct) < 0.5 ? h("span", { class: "sub" }, "지난 수집과 같음")
    : h("span", { class: c.pct < 0 ? "down" : "up" }, Stats.moveText(c.pct / 100, 1));
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
  // a chart is drawn at its box's real width (1 unit = 1 CSS px), so its 13px words are 13px on every phone: with a fixed
  // viewBox of 340 they shrank to 12.1px at 390 and 9.4px at 320 (위계 묶음 6 검토). First drawn at 340 (the box is not on the
  // page yet), then again by a ResizeObserver before the first paint — and when a fold opens or the phone turns. It watches a
  // zero-height ruler across the box, not the box: a new drawing changes the box's height, which would loop the observer
  const fitChart = (box, draw) => { let w = 340; draw(w);
    if (!window.ResizeObserver) return;
    const ruler = h("i", { class: "lcw", "aria-hidden": "true" }); box.append(ruler);
    new ResizeObserver((es) => { const nw = Math.round(es[0].contentRect.width); if (nw > 0 && nw !== w) { w = nw; draw(w); } }).observe(ruler); };
  // how wide a chart word is at 13px (a Hangul syllable ≈ 13, a digit, '.', ',' or '/' ≈ 7.6): the room left for the axis and end labels
  const chartTextW = (t) => [...String(t)].reduce((a, c) => a + (/[가-힣]/.test(c) ? 13 : c === " " ? 3.6 : 7.6), 0);
  // line chart: one axis, 2px lines broken where a week has no record, end labels, crosshair tooltip (pointer, touch,
  // arrow keys), table view. Only observed points are drawn; nothing is filled in between records.
  function lineChart(dates, series, title) {
    const T = 16, B = 26;
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    const wrap = h("div", { class: "lc" });
    if (!all.length) return wrap;
    let lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.15 || hi * 0.1 || 1; lo = Math.max(0, lo - pad); hi += pad;
    const stepv = niceStep(hi - lo);
    lo = Math.floor(lo / stepv) * stepv; hi = lo + stepv * 3; while (hi < Math.max(...all)) hi += stepv;
    const ticks = []; for (let v = lo; v <= hi + 1e-6; v += stepv) ticks.push(v);
    const ends = series.map((s) => s.values.map((v, i) => [i, v]).filter((p) => p[1] != null).pop()).map((li, n) => li && { s: series[n], i: li[0], v: li[1], t: `${series[n].name} ${man(li[1])}` });
    // the side margins hold the words: the axis numbers on the left, the end labels on the right
    const L = Math.max(32, Math.ceil(8 + Math.max(...ticks.map((v) => chartTextW(man(Math.round(v))))))), R = Math.max(40, Math.ceil(8 + Math.max(0, ...ends.filter(Boolean).map((e) => chartTextW(e.t)))));
    let W = 340, H = 196;
    const x = (i) => dates.length < 2 ? L + (W - L - R) / 2 : L + i / (dates.length - 1) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const g = svg("svg", { class: "lcsvg", role: "img", "aria-label": title });
    // crosshair + tooltip
    const hair = svg("line", { class: "hair", visibility: "hidden" });
    const hit = svg("rect", { y: 0, fill: "transparent" });
    // keyboard: the chart box is one slider (arrow keys move the date); the drawing inside is a picture
    const kbox = h("div", { class: "lcbox", tabindex: "0", role: "slider", "aria-label": `${title} — 좌우 방향키로 날짜 이동`, "aria-valuemin": "0", "aria-valuemax": String(dates.length - 1),
      "aria-valuenow": String(dates.length - 1) });
    const tip = h("div", { class: "lctip", hidden: true });
    let at = dates.length - 1;
    const show = (i) => {
      at = i;
      hair.setAttribute("x1", x(i)); hair.setAttribute("x2", x(i)); hair.setAttribute("visibility", "visible");
      tip.replaceChildren(h("div", { class: "sub" }, dates[i]), ...series.map((s) => h("div", { class: "row", style: "flex-wrap:nowrap" },
        h("span", { class: "key", style: `background:${s.color}` }), h("b", { class: "num" }, s.values[i] != null ? won(s.values[i]) : "기록 없음"), h("span", {}, s.name))));
      tip.hidden = false; tip.style.left = `${Math.min(84, Math.max(16, x(i) / W * 100))}%`;
      kbox.setAttribute("aria-valuenow", String(i)); kbox.setAttribute("aria-valuetext", `${dates[i]} ${series.map((s) => `${s.name} ${s.values[i] != null ? won(s.values[i]) : "기록 없음"}`).join(", ")}`);
    };
    const hide = () => { tip.hidden = true; hair.setAttribute("visibility", "hidden"); };
    const draw = (w) => {
      W = w; H = Math.round(Math.min(196, Math.max(150, W * 0.58)));   // 196 at 340, a little lower on a narrow phone
      g.setAttribute("viewBox", `0 0 ${W} ${H}`); g.replaceChildren();
      for (const v of ticks) {
        const yy = y(v);
        g.append(svg("line", { x1: L, x2: W - R + 8, y1: yy, y2: yy, class: v === lo ? "base" : "grid" }));
        const tx = svg("text", { x: L - 8, y: yy + 4, class: "ax", "text-anchor": "end" }); tx.textContent = man(Math.round(v)); g.append(tx);
      }
      // as many dates as fit 46px apart (a date is about 38px), the last one always
      const last = dates.length - 1, maxN = Math.max(2, Math.min(5, Math.floor((W - L - R) / 46) + 1)), step = Math.max(1, Math.ceil(last / (maxN - 1)));
      dates.forEach((d, i) => { if (i !== last && (i % step || x(last) - x(i) < 46)) return; const tx = svg("text", { x: x(i), y: H - 6, class: "ax", "text-anchor": "middle" }); tx.textContent = md(d); g.append(tx); });
      series.forEach((s) => {
        // consecutive observed weeks form one segment; a missing week breaks the line
        const segs = []; let cur = [];
        s.values.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([+x(i).toFixed(1), +y(v).toFixed(1)]); });
        if (cur.length) segs.push(cur);
        for (const sg of segs) if (sg.length > 1) g.append(svg("path", { d: smoothPath(sg), class: "ln draw", pathLength: "1", style: `stroke:${s.color};--len:1` }));
        s.values.forEach((v, i) => { if (v != null) g.append(svg("circle", { cx: x(i), cy: y(v), r: dates.length > 26 ? 2.5 : 3.5, class: "mk", style: `fill:${s.color}` })); });
      });
      // end labels: nudge apart when two series end close together
      const labels = ends.filter(Boolean).map((e) => ({ t: e.t, x: x(e.i) + 8, y: y(e.v) + 4 }));
      labels.sort((p, q) => p.y - q.y).forEach((lb, j, arr) => { if (j && lb.y - arr[j - 1].y < 13) lb.y = arr[j - 1].y + 13; });
      for (const lb of labels) { const tx = svg("text", { x: lb.x, y: lb.y, class: "dl" }); tx.textContent = lb.t; g.append(tx); }
      hair.setAttribute("y1", T); hair.setAttribute("y2", H - B);
      hit.setAttribute("x", L - 12); hit.setAttribute("width", W - L - R + 24); hit.setAttribute("height", H);
      g.append(hair, hit);
      if (!tip.hidden) show(at);
    };
    const near = (e) => { const r = g.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W; let bi = 0; dates.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(bi) - px)) bi = i; }); return bi; };
    hit.addEventListener("pointermove", (e) => show(near(e)));
    hit.addEventListener("pointerdown", (e) => show(near(e)));
    hit.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    kbox.addEventListener("focus", () => show(at));
    kbox.addEventListener("blur", hide);
    kbox.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { show(Math.max(0, Math.min(dates.length - 1, at + (e.key === "ArrowLeft" ? -1 : 1)))); e.preventDefault(); } });
    const legend = series.length > 1 ? h("div", { class: "row lclegend" }, series.map((s) => h("span", { class: "row" }, h("span", { class: "key", style: `background:${s.color}` }), s.name))) : null;
    const table = h("table", { class: "lctable", hidden: true }, h("thead", {}, h("tr", {}, h("th", {}, "날짜"), series.map((s) => h("th", {}, s.name)))),
      h("tbody", {}, dates.map((d, i) => h("tr", {}, h("td", {}, d), series.map((s) => h("td", { class: "num" }, s.values[i] != null ? won(s.values[i]) : "-"))))));
    const tbtn = h("button", { class: "linkbtn", type: "button", style: "min-height:28px", onclick: () => { table.hidden = !table.hidden; tbtn.lastChild.textContent = table.hidden ? "표로 보기" : "표 닫기"; } }, icon("table", "xs"), h("span", {}, "표로 보기"));
    kbox.append(g, tip);
    fitChart(kbox, draw);
    wrap.append(legend || "", kbox, h("div", { class: "row" }, h("span", { class: "sp" }), tbtn), table);
    return wrap;
  }
  // where each clinic's lowest price sits: one dot per branch on one price axis (dots stacked where they would overlap),
  // filled = no condition, ring = a conditional price (first visit, trial …), dark = the headline lowest; the middle price is
  // a solid 2px dark grey line across the chart (docs/DESIGN_SYSTEM.md §3 '범위 막대': a bar's middle is a dot, but a chart's
  // runs through its dots — and a green middle would read as one more branch)
  function distChart(list, med, bestI, title, onPick) {
    const R = 4.5, PL = 14, PR = 14, TOP = 24, AX = 24;
    const ps = list.map((x) => x.p);
    let lo = Math.min(...ps), hi = Math.max(...ps);
    if (med != null && med > 0) { lo = Math.min(lo, med); hi = Math.max(hi, med); }   // the middle line is always on the axis
    if (hi === lo) { lo = Math.max(0, lo * 0.9); hi = hi * 1.1 || 1; }
    const stepv = niceStep(hi - lo, 4), t0 = Math.floor(lo / stepv) * stepv, t1 = Math.ceil(hi / stepv) * stepv;
    const sorted = [...list].sort((a, c) => a.p - c.p);
    const g = svg("svg", { class: "lcsvg", role: "img",
      "aria-label": `${title}: ${list.length}곳, 최저 ${won(Math.min(...ps))}, 중간 가격 ${won(med)}, 최고 ${won(Math.max(...ps))}` });
    const hit = svg("rect", { x: 0, y: 0, fill: "transparent" });
    const kbox = h("div", { class: "lcbox", tabindex: "0", role: "slider", "aria-label": `${title} — 좌우 방향키로 지점 이동, Enter로 지점 보기`, "aria-valuemin": "0",
      "aria-valuemax": String(list.length - 1), "aria-valuenow": "0" });
    const tip = h("div", { class: "lctip", hidden: true });
    let W = 340, H = 0, base = 0, dy = 0, dots = [], els = [];
    let at = bestI != null ? Math.max(0, sorted.findIndex((d) => d.i === bestI)) : 0;
    const show = (j) => {
      at = j; const d = dots[j];
      els.forEach((e, n) => e.classList.toggle("on", n === j));
      document.querySelectorAll("#clinics li[data-b].hl").forEach((x) => x.classList.remove("hl")); { const li = document.querySelector(`#clinics li[data-b="${d.b}"]`); if (li) li.classList.add("hl"); }
      tip.replaceChildren(h("div", { class: "sub" }, `${d.cond ? "특가" : "일반가"}`), h("div", { class: "row", style: "flex-wrap:nowrap" }, bdot(d.b), h("span", {}, bname(d.b))), h("b", { class: "num" }, won(d.p)));
      tip.hidden = false; tip.style.left = `${Math.min(80, Math.max(20, d.x / W * 100))}%`; tip.style.top = `${(base - R - d.k * dy - 8) / H * 100}%`;
      kbox.setAttribute("aria-valuenow", String(j)); kbox.setAttribute("aria-valuetext", `${bname(d.b)} ${won(d.p)}${d.cond ? " 특가" : ""}`);
    };
    const hide = () => { tip.hidden = true; els.forEach((e) => e.classList.remove("on")); };
    const draw = (w) => {
      W = w;
      const x = (v) => PL + (v - t0) / (t1 - t0) * (W - PL - PR);
      const rows = [];
      dots = sorted.map((it) => { const xx = x(it.p); let k = 0; while (rows[k] != null && xx - rows[k] < R * 2 + 1) k++; rows[k] = xx; return { ...it, x: xx, k }; });
      const nr = rows.length; dy = Math.min(R * 2 + 1.5, 132 / Math.max(1, nr));
      H = TOP + nr * dy + 8 + AX; base = H - AX;
      g.setAttribute("viewBox", `0 0 ${W} ${H}`);
      g.replaceChildren(svg("line", { x1: PL - 6, x2: W - PR + 6, y1: base, y2: base, class: "base" }));
      for (let v = t0; v <= t1 + 1e-6; v += stepv) {
        g.append(svg("line", { x1: x(v), x2: x(v), y1: base, y2: base + 4, class: "base" }));
        const tx = svg("text", { x: x(v), y: H - 6, class: "ax", "text-anchor": v === t0 ? "start" : v + stepv > t1 + 1e-6 ? "end" : "middle" }); tx.textContent = man(Math.round(v)); g.append(tx);
      }
      const mx = x(med), mw = chartTextW(`중간 가격 ${won(med)}`) / 2 + 4;   // centred over the line unless that runs past an end
      g.append(svg("line", { x1: mx, x2: mx, y1: 14, y2: base, class: "med" }));
      const mt = svg("text", { x: Math.min(W - PR, Math.max(PL, mx)), y: 10, class: "medt", "text-anchor": mx < PL + mw ? "start" : mx > W - PR - mw ? "end" : "middle" }); mt.textContent = `중간 가격 ${won(med)}`; g.append(mt);   // the header's '중간값 19,690원', never '2만
      els = dots.map((d, j) => { const c = svg("circle", { cx: d.x.toFixed(1), cy: (base - R - 2 - d.k * dy).toFixed(1), r: R, "data-b": d.b, class: `dot pop${d.cond ? " cond" : ""}${d.i === bestI ? " best" : ""}`,
        style: `animation-delay:${Math.min(j * 12, 400)}ms` }); g.append(c); return c; });
      hit.setAttribute("width", W); hit.setAttribute("height", H);
      g.append(hit);
      if (!tip.hidden) show(at);
    };
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
    const hasCond = list.some((d) => d.cond), hasPlain = list.some((d) => !d.cond);
    const legend = h("div", { class: "row lclegend" }, hasPlain ? h("span", { class: "row" }, h("span", { class: "key solid", style: "background:var(--s1)" }), "일반가") : null,
      hasCond ? h("span", { class: "row" }, h("span", { class: "key ring" }), "특가") : null,
      bestI != null ? h("span", { class: "row" }, h("span", { class: "key solid", style: "background:var(--ink)" }), "현재 최저가") : null);
    kbox.append(g, tip);
    fitChart(kbox, draw);
    return h("div", { class: "lc" }, legend, kbox);
  }
  // weeks the trend snapshots cover (every date counts; a key's own gaps are checked in keyTrend)
  const trendObs = () => { const tr = TR(); return Stats.observations(tr.dates, tr.dates.map(() => [0, 0, 0])); };
  function trendCard() {
    const tr = TR();
    if (!Stats.historyReady(trendObs())) return null;   // hidden until 8 distinct weeks: two snapshots are not a trend
    const cats = CMP_CATS.filter((c) => FAM.some((f) => f.cat === c));
    if (!st.tcat || !cats.includes(st.tcat)) st.tcat = cats[0];
    // the main variant of the category's most-sold families (a category can hold hundreds of variants)
    const keys = famsIn(st.tcat).slice(0, 8).map((f) => KEYS[f.main]);
    const chs = keys.map((k) => keyChange(k.id)).filter(Boolean);
    const avg = chs.length ? chs.reduce((s, c) => s + c.pct, 0) / chs.length : null;
    const card = h("div", { class: "card flush" });
    card.append(h("div", { style: "padding:var(--sp-3) 14px 0" }, h("div", { class: "row" }, h("h3", {}, "가격 동향"), h("span", { class: "sp" }),
      h("span", { class: "sub" }, Stats.obsLabel(trendObs()))),
      FLAGS.discountEmphasis ? h("div", { class: "sub" }, "선과 '지난 수집 대비'는 실제로 모은 일반가 중간 가격의 변화(가격 이력)예요. '정가 표기 대비'는 이번 주 병원이 적은 정가에서 할인된 정도라 이력과 다른 숫자예요.") : null,
      h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": c === st.tcat ? "true" : "false", onclick: () => { st.tcat = c; render(); } }, c))),
      h("div", { class: "row", style: "margin-top:var(--sp-2)" }, h("b", {}, `${st.tcat} 평균`), avg == null ? h("span", { class: "sub" }, tr.dates.length < 2 ? "다음 주 월요일부터 지난 수집 대비 변동이 보여요" : "변동 없음")
        : chg({ pct: avg }))),
      h("ul", { class: "list" }, keys.map((k) => { const v = (tr.k[k.id] || []).map((x) => x && x[0]); const now = v[v.length - 1]; const disc = tr.disc[k.id];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k.i; nav("compare"); } },
          h("span", { class: "t" }, k.label), h("span", { class: "p num" }, now != null ? won(now) : "-"),
          h("span", { class: "m" }, h("span", { class: "sub" }, "지난 수집 대비"), chg(keyChange(k.id)), disc != null && FLAGS.discountEmphasis ? h("span", { class: "k k4", title: "병원이 적은 정가와 판매가 비교(이번 주). 가격 이력과 별개" }, `정가 표기 대비 −${disc}%`) : null, h("span", { class: "sp" }), sparkline(v)))); })));
    return card;
  }
  function keyTrend(k) {
    const tr = TR(), v = tr.k[k.id];
    if (!v || !Stats.historyReady(Stats.observations(tr.dates, v))) return null;   // hidden until 8 distinct weeks of this key
    const ranges = [["7", "7일"], ["30", "30일"], ["90", "90일"], ["", "전체"]];
    const from = st.hrange ? Intel.daysBefore(today(), +st.hrange) : "";
    const keep = tr.dates.map((d) => d >= from);
    const dates = tr.dates.filter((_, i) => keep[i]);
    const med = v.map((x) => x && x[0]).filter((_, i) => keep[i]), low = v.map((x) => x && x[1]).filter((_, i) => keep[i]);
    const s = Intel.historyStats(dates, low), sm = Intel.historyStats(dates, med);
    const card = h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "가격 이력"), h("span", { class: "sp" }), chg(keyChange(k.id))),
      h("div", { class: "sub" }, "일반가 · 모든 브랜드 · 병원 표시가 기준"),
      reclDate(k.id) ? h("div", { class: "note recl" }, icon("info", "sm"), `${md(reclDate(k.id))}에 비교 기준을 고쳤어요(같은 시술로 묶는 방법이나 일반가로 보는 가격). 그 전 기록은 지금 기준과 다른 값이라 빼고 보여줘요.`) : null,
      tr.dates.length > 1 ? h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, ranges.map(([r, l]) => h("button", { class: "chip", type: "button", "aria-pressed": (st.hrange || "") === r ? "true" : "false", onclick: () => { st.hrange = r; render(); } }, l))) : null);
    if (!s) { card.append(emptyLine("이 기간엔 기록이 없어요")); return card; }
    // one record is a point, not a trend: no line and no 'change' tiles until a second week is collected
    if (dates.length < 2) { card.append(emptyBox("chart-line", `첫 기록 ${md(dates[0])} · 최저 ${won(s.cur)} · 중간 가격 ${won(sm ? sm.median : s.median)}`,
      "매주 월요일마다 점이 하나씩 늘어요. 기록이 없는 날은 채우지 않아요.")); return card; }
    card.append(h("div", { class: "tiles" },
      h("div", { class: "tile" }, h("span", { class: "k" }, "현재 최저가"), h("b", { class: "num" }, won(s.cur)), h("span", { class: "w" }, `확인 ${md(s.last)}`)),
      h("div", { class: "tile" }, h("span", { class: "k" }, "기록 최저 / 최고"), h("b", { class: "num" }, `${won(s.min)}`), h("span", { class: "w" }, `최고 ${won(s.max)} · 최저 마지막 ${md(s.minLast)}`)),
      h("div", { class: "tile" }, h("span", { class: "k" }, "기간 중간 가격"), h("b", { class: "num" }, won(sm ? sm.median : s.median)), h("span", { class: "w" }, "지점별 중간 가격의 가운데")),
      h("div", { class: "tile" }, h("span", { class: "k" }, "최저가 변동"), h("b", { class: "num" }, `${s.changes}번`), h("span", { class: "w" }, `${s.points}번 기록 (${md(s.first)}~)`))));
    card.append(lineChart(dates, [{ name: "중간 가격", color: "var(--ink-2)", values: med }, { name: "최저가", color: "var(--s1)", values: low }], `${k.label} 가격 이력`));
    return card;
  }
  // ---------------- saved treatments & price alerts (checked when the app opens; e-mail/push later with sign-in)
  const ALERT_TYPES = { watch: "지켜보기", target: "목표가 이하", newlow: "새 최저가", newmatch: "파는 지점이 늘면", cartdrop: "내 견적 합계", expiring: "이벤트 종료 3일 전" };
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
  const saveAlerts = () => { store.set("alerts", st.alerts); store.set("notes", st.notes.slice(0, 30)); paintMeN(); pushSync(); };
  function paintMeN() { const el = $("#me-n"); if (!el) return; const n = st.notes.filter((x) => !x.read).length; el.hidden = !n; el.textContent = n;
    const b = $("#notibtn"); if (b) b.setAttribute("aria-label", n ? `가격 알림, 안 읽은 알림 ${n}개` : "가격 알림"); }   // the count inside an aria-label button is not read out
  function alertNow(a) {
    if (a.k) { const n = watchNow(a); return n && { value: n.low, count: n.count }; }
    if (a.cart != null) { const c = st.carts.find((x) => x.name === a.cart); if (!c) return null; const items = c.items.filter(itemOk); if (!items.length) return null; const b = cartPlan(items).full[0]; return { value: b ? b.total : null }; }
    if (a.row) { const sid = SI.get(a.row.n), b = BK.get(a.row.br); if (sid == null || b == null) return null; const i = (byName.get(sid) || []).find((x) => ROWS[x][0] === b); return i == null ? null : { value: ROWS[i][3], until: S[ROWS[i][10]] }; }
    return null;
  }
  const alertName = (a) => a.k ? (KI[a.k] != null ? KEYS[KI[a.k]].label : goneLabel(a.k) ? `${goneLabel(a.k)} (지금은 비교 묶음 없음)` : a.k) : a.cart != null ? `내 견적 '${a.cart}'` : a.row ? `${a.row.n} (${a.row.br.replace("|", " ")})` : "";
  // a structured record per alert event (알림 기록): type, treatment, real branch, before → after, data date, link
  const noteOf = (a, t, x) => ({ at: today(), obs: D.meta.updated, type: t, k: a.k || "", name: alertName(a), b: x.b || "", before: x.before ?? null, after: x.after ?? null,
    text: `${alertName(a)} — ${NOTE_T[t] || ""}: ${x.text}`, id: a.id, read: false });
  const NOTE_T = { ...ALERT_TYPES, ...Intel.WATCH_T, past: "지난 기록", test: "TEST" };
  // the data build on screen: data-meta.json's version (a checksum: two builds of one collection differ). '' when it was not
  // read (state/data.js: a first download without data-meta.json) — unknown, so Intel.reclRebase never calls it another build
  // (a stand-in such as collection/build day would differ from the real version at the next open: a false 'rebuilt')
  const dataVer = () => SYNC.version || "";
  const reclMarkOf = (id) => Intel.reclMark(D.meta, id, dataVer());
  function checkAlerts() {
    const td = today();
    let fired = 0;
    for (const a of st.alerts) {
      // the treatment's rows were regrouped (a rule fix, meta.recl) since the build the baseline came from, or the alert
      // moved to a successor id: a new mix of rows is not a price change, so the baseline is set again without a notice.
      // Told by the mark of that build (a.rm, Intel.reclRebase), not by dates (C #112)
      const mark = a.k && KI[a.k] != null ? reclMarkOf(a.k) : null;
      if (mark && (a.regroup || Intel.reclRebase(a.rm, mark))) {
        a.rb = td; a.rm = mark; delete a.regroup;
        if (a.type === "watch") Object.assign(a, Intel.evalWatch({}, watchNow(a), td).patch);
        else Object.assign(a, Intel.rebaseAlert(a, alertNow(a)));
        continue;
      }
      if (mark) a.rm = mark;
      // alerts made before 2026-10-14 compared the screen's (VAT-mode, region-filtered) price: re-base once, silently
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
    if (fired) { toast(`가격 알림 ${fired}개 — 관심 탭에서 확인하세요`); deviceNotify(`가격 알림 ${fired}개`, st.notes[0].text); if (noti) render(); }   // the open bell panel shows them
  }
  // '이 병원에 다녀왔어요' turned (markVisited): the person's own history, not a price — every 내 견적 합계 alert takes the total
  // as it is now as its base again, without a notice, the way a regrouped treatment's alert does above (review 2026-10-19)
  function rebaseCartAlerts() {
    let n = 0;
    for (const a of st.alerts) {
      if (a.type !== "cartdrop") continue;
      const la = a.lastAt;
      Object.assign(a, Intel.evalAlert({ ...a, lastAt: today(), base: null, last: null }, alertNow(a), "0000-00-00").patch);
      if (la) a.lastAt = la; else delete a.lastAt;
      n++;
    }
    if (n) saveAlerts();
  }
  // 휴대폰 알림 (PWA_IMPLEMENTATION.md): only after the user taps '휴대폰 알림 켜기'; only while the app runs (no push server)
  const notifySupported = () => "Notification" in window && "serviceWorker" in navigator;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  // 푸시 알림 (6.0 약속 1, app/domain/push.js): only when config.js has alertsApi + pushPublicKey (chat A sends both). The
  // permission prompt only inside the tap on '가격 알림 받기', and the first subscription with it; once the permission is
  // given, a subscription is made again without a tap when it no longer works — at a start for a new public key, after a
  // 404/410 on PUT (chat A's request #85 ②④). The id the Worker gives back stays on this phone (device key 'push', not per
  // account). The rules follow the phone's alerts (PUT when they change).
  const CFG = window.APP_CONFIG || {};
  const PUSH = Push.enabled(CFG);
  const pushSupported = () => notifySupported() && "PushManager" in window;
  const pushState = () => Push.cleanState(store.get("push", null));
  const pushRules = () => Push.rulesOf(st.alerts, (k) => KI[k] != null);
  // ms: give up after that long (a DELETE must not hang the '끄기' button on a weak connection)
  const pushFetch = (req, ms) => {
    const c = ms && typeof AbortController === "function" ? new AbortController() : null, t = c ? setTimeout(() => c.abort(), ms) : null;
    return fetch(req.url, { method: req.method, headers: req.body ? { "content-type": "application/json" } : undefined, body: req.body, credentials: "omit", cache: "no-store", signal: c ? c.signal : undefined })
      .finally(() => { if (t) clearTimeout(t); });
  };
  // the registration, or null: navigator.serviceWorker.ready never settles when registering failed
  const swReg = () => Promise.race([navigator.serviceWorker.getRegistration().catch(() => null), new Promise((ok) => setTimeout(() => ok(null), 4000))]);
  // endpoints never sent again in this run of the app: one the Worker answered 404/410 for, or one taken back for a new key
  // (chat A's request #85 ②④ — POSTed again it would be stored, dropped at the next send, and the screen would say on)
  const pushGone = new Set();
  // one at a time: a start's renewal, a 404's and a tap share the one on its way (two at once would each make a subscription)
  let pushBusy = null;
  function pushSubscribe(fresh) { return pushBusy || (pushBusy = pushSubscribeOnce(fresh).finally(() => { pushBusy = null; })); }
  // fresh: take back the browser's subscription even when it looks fine (after a 404/410)
  async function pushSubscribeOnce(fresh) {
    const reg = await swReg();
    if (!reg || !reg.pushManager) throw new Error("no service worker");
    const old = pushState();
    let had = await reg.pushManager.getSubscription();
    // dropped by the Worker, or made with another public key (the VAPID keys were replaced): taken back, and a new one is
    // made with the key in config.js
    if (had && (fresh || pushGone.has(had.endpoint) || Push.otherKey(had, CFG))) {
      pushGone.add(had.endpoint);
      // still on (a new key at start): marked first, so a next start that finds no subscription (the new one could not be
      // made: offline) tries once more instead of turning off without a word (read now: a 404 on the way may have cleared it)
      const on = pushState();
      if (on) store.set("push", { ...on, re: 1 });
      if (!(await had.unsubscribe())) throw new Error("unsubscribe refused");
      had = null;
    }
    const sub = had || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Push.keyBytes(CFG.pushPublicKey) });
    try {
      if (pushGone.has(sub.endpoint)) throw new Error("same endpoint");
      const { rules } = pushRules(), req = Push.subscribeReq(CFG, sub, rules);
      if (!req) throw new Error("unusable subscription");
      const res = await pushFetch(req);
      const id = res.ok ? Push.idOf(await res.json().catch(() => null)) : null;
      if (!id) throw new Error(`subscribe ${res.status}`);
      store.set("push", { id, ep: sub.endpoint, h: Push.hash(rules) });
      // an id the Worker hands out (again) is in use: it never waits for a retried DELETE
      store.set("pushDel", Push.cleanDel(store.get("pushDel", [])).filter((x) => x !== id));
      // the id this one replaces (a renewed endpoint, a new key) goes only now that the new one is in (offline: next start)
      if (old && old.id !== id) pushDelete(old.id).catch(() => {});
    } catch (e) {
      // the Worker did not take it (or its answer was lost): a subscription made just now is taken back while the screen
      // says off, so nothing can push to this phone then (a row the Worker did keep gets 410 on its next send and goes).
      // Still on (a new key at start): it stays, and the next start sends it (its endpoint is not the one kept here).
      if (!had && !pushState()) await sub.unsubscribe().catch(() => {});
      throw e;
    }
  }
  // DELETE one subscription id at the Worker (chat A's request 2026-10-16: a '끄기' that does not get there must not leave the
  // subscription on the server). The id is written to 'pushDel' (this phone) BEFORE the request, so a page closed while it
  // is on its way still sends it at the next start; it leaves the list only once the Worker has answered for good. An id
  // in use again (the one in 'push') is never deleted.
  async function pushDelete(id) {
    const req = Push.unsubscribeReq(CFG, id);
    if (!req) return;
    const drop = () => store.set("pushDel", Push.cleanDel(store.get("pushDel", [])).filter((x) => x !== id));
    if ((pushState() || {}).id === id) { drop(); return; }
    store.set("pushDel", Push.addDel(store.get("pushDel", []), id));
    let done = false;
    try { done = Push.delDone((await pushFetch(req, 10000)).status); } catch (e) { /* offline, or no answer in 10 s */ }
    if (done) drop();
  }
  async function pushRetryDeletes() { for (const id of Push.cleanDel(store.get("pushDel", []))) await pushDelete(id); }
  async function pushUnsubscribe() {
    const s = pushState();
    store.set("push", null);
    // queued at once (inside pushDelete, before its request) and not waited for: the screen is off right away
    if (s) pushDelete(s.id).catch(() => {});
    const reg = await swReg(), sub = reg && reg.pushManager ? await reg.pushManager.getSubscription().catch(() => null) : null;
    if (sub) await sub.unsubscribe().catch(() => {});
  }
  // after an alert is added or removed (and at start, with the full price file): PUT the rules when they differ from the
  // last sent. A subscription the Worker no longer knows (404/410) is made again with a new browser subscription, once per
  // run of the app; when that does not work it is forgotten (off).
  let pushT = null, pushRenewed = false;
  function pushSync() {
    if (!PUSH || !pushState()) return;
    clearTimeout(pushT);
    // no rule left (the last alert removed): the subscription itself goes — nothing kept on the server that nothing uses
    // (user decision 2026-10-15). It waits out the 6 s '되돌리기' toast, so an undo keeps it.
    const empty = !pushRules().rules.length;
    pushT = setTimeout(async () => {
      const s = pushState();
      if (!s || partial()) return;
      const { rules } = pushRules(), h = Push.hash(rules);
      if (!rules.length) {
        await pushUnsubscribe(); render();
        // the panel says it too; a toast only when it would not cut short another action's 되돌리기
        if (!$("#toast").classList.contains("act")) toast("앱 밖으로 보낼 가격 알림이 없어 휴대폰 알림 받기를 껐어요");
        return;
      }
      if (h === s.h) return;
      try {
        const r = await pushFetch(Push.rulesReq(CFG, s.id, rules));
        // '끄기' (or a new subscription) may have happened while this was on its way: write only for the same id
        const now = pushState();
        if (!now || now.id !== s.id) return;
        if (r.ok) store.set("push", { ...now, h });
        else if (r.status === 404 || r.status === 410) {
          // the Worker dropped it (a dead endpoint, an old key, a clean-up): the same endpoint is never POSTed again — the
          // browser's subscription is taken back, a new one made with the key in config.js, and POSTed for a new id (chat A's
          // request #85 ④). No permission, or that fails: off, as before.
          store.set("push", null); pushGone.add(s.ep);
          if (!pushRenewed && pushSupported() && Notification.permission === "granted") { pushRenewed = true; await pushSubscribe(true).catch(() => {}); }
          render();
        }
      } catch (e) { /* offline: the next change or the next start sends them */ }
    }, empty ? 6500 : 600);
  }
  // at start: the browser may have dropped the subscription (permission taken back) or renewed it — follow it
  async function pushCheck() {
    const s = pushState();
    if (!PUSH) return;
    pushRetryDeletes().catch(() => {});   // an earlier '끄기' whose DELETE did not get through
    if (!pushSupported()) return;
    try {
      if (!s) {
        // subscribed in this browser but not known here (an earlier '받기' whose answer was lost): take it back
        if (Notification.permission !== "granted") return;
        const reg = await swReg(), sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
        if (sub) await sub.unsubscribe().catch(() => {});
        return;
      }
      if (Notification.permission !== "granted") { await pushUnsubscribe(); render(); return; }
      const reg = await swReg();
      if (!reg || !reg.pushManager) return;   // not registered yet: next start
      const sub = await reg.pushManager.getSubscription();
      if (!sub && !s.re) { await pushUnsubscribe(); render(); return; }
      if (!pushRules().rules.length) { await pushUnsubscribe(); render(); return; }   // nothing left to watch: no subscription
      if (!sub) {
        // an earlier start took back the old key's subscription and could not make the new one (s.re): once more now, and
        // off when that does not work either ('받기' then asks with a tap)
        try { await pushSubscribe(); } catch (e) { await pushUnsubscribe(); }
        render();
        return;
      }
      if (sub.endpoint !== s.ep || Push.otherKey(sub, CFG)) {
        // renewed by the browser, or made with another public key (chat A's request #85 ②: pushSubscribe takes that one back
        // and makes a new one): POST the new one first; the old id goes only once that worked (offline: next start)
        await pushSubscribe();
        return;
      }
      pushSync();
    } catch (e) { /* offline or the Worker is down: nothing changes on the phone */ }
  }
  async function deviceNotify(title, body, tag = "pc-alert") {
    if (!notifySupported() || Notification.permission !== "granted") return false;
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.showNotification(title, { body, tag, icon: "icons/icon-192.png", badge: "icons/favicon-32.png" }); else new Notification(title, { body, tag }); return true; } catch (e) { return false; }
  }
  function addAlert(a) {
    if (st.alerts.length >= 20) { toast("알림은 20개까지예요. 관심 탭에서 정리해 주세요"); return false; }
    const al = { id: uid(), created: today(), ...a };
    if (al.k) { al.basis = "listed"; al.rb = today(); al.rm = reclMarkOf(al.k); al.reg = al.reg || st.region || "전국"; if (al.sp == null) al.sp = st.special; }
    if (al.type === "watch") Object.assign(al, Intel.evalWatch({}, watchNow(al), today()).patch);   // first look = the base, nothing fires
    else Object.assign(al, Intel.evalAlert({ ...al, lastAt: today() }, alertNow(al), "0000-00-00").patch);   // set the baseline only
    delete al.lastAt;
    // the real changes already recorded for this treatment (last weekly snapshot) go into 알림 기록 as '지난 기록'
    if (al.k && KI[al.k] != null) for (const [k, b, before, after] of D.changes || []) if (KEYS[k].id === al.k && BR[b] && regOk(b, al.reg)) st.notes.unshift({ ...noteOf(al, "past", { b: bkey(b), before, after, text: `${D.meta.prev} → ${D.meta.updated} ${bname(b)} ${won(before)} → ${won(after)}` }), read: true, past: true });
    if (al.type === "target" || al.type === "cartdrop") delete al.last;
    st.alerts.push(al); saveAlerts(); track("alert_set", { type: al.type }); metric("keep_alert");
    // 죠미 winks only once the alert is really stored; the toast repeats the condition that was saved
    const kinds = al.type === "watch" ? Object.keys(Intel.WATCH_T).filter((t) => !al.on || al.on[t] !== false).length : 0;
    if (store.get("alerts", []).some((x) => x.id === al.id)) jomiToast("wink", `${jline("alertSet") || "알림을 만들었어요"} ${alertName(al)} · ${ALERT_TYPES[al.type]}${kinds ? ` (${kinds}가지 변화)` : ""}${al.target ? ` · 목표가 ${won(al.target)}` : ""}`, ["알림 관리", () => nav("saved")]);
    else toast("알림을 저장하지 못했어요(이 휴대폰의 저장 공간을 확인해 주세요)");
    return true;
  }
  function alertSheet(base) {
    // the price shown is the one the alert will watch: addAlert gives a comparison alert the region and the special setting in
    // use now (st.region, st.special), so the sheet reads it the same way — not nationwide while the label names a region
    const watched = base.k ? { ...base, reg: base.reg || st.region || "전국", sp: base.sp != null ? base.sp : st.special } : base;
    const now = alertNow(watched);
    sheet("가격 알림", (close) => {
      const box = h("div", {});
      const types = base.k ? ["watch", "target", "newlow", "newmatch"] : base.cart != null ? ["cartdrop"] : ["expiring", "target"];
      const s = { type: types[0], on: { drop: true, target: true, lowbranch: true, newmatch: true, lowended: true, recheck: true } };
      const tgt = h("input", { class: "field", type: "number", inputmode: "numeric", min: "0", step: "1000", value: now && now.value ? Math.floor(now.value * 0.9 / 1000) * 1000 : "", "aria-label": "목표 금액" });
      const paint = () => fill(box,
        h("div", { class: "sub" }, `${alertName(base)}${now && now.value ? ` · 지금 ${base.cart != null ? "한 곳 최저 합계" : `최저(병원 표시가, ${base.k ? watched.reg : ""})`} ${won(now.value)}` : ""}`),
        h("div", { class: "opts", style: "margin-top:var(--sp-2)" }, types.map((ty) => h("button", { class: "opt", type: "button", "aria-pressed": s.type === ty ? "true" : "false", onclick: () => { s.type = ty; paint(); } }, h("b", {}, ALERT_TYPES[ty]),
          ty === "watch" ? h("span", {}, "여러 변화를 한 번에") : null))),
        s.type === "watch" ? h("div", { class: "pcgrp", role: "group", "aria-label": "알려줄 변화" }, h("div", { class: "sub", style: "margin:var(--sp-3) 0 var(--sp-2)" }, "알려줄 변화"),
          Object.entries(Intel.WATCH_T).map(([t, l]) => h("label", { class: "row pctog", style: "margin-top:var(--sp-2);flex-wrap:nowrap" },
            h("input", { type: "checkbox", checked: s.on[t], onchange: (e) => { s.on[t] = e.target.checked; paint(); } }), h("span", {}, h("b", {}, l), h("span", { class: "tiny", style: "display:block" }, WATCH_HELP[t])))),
          s.on.target ? h("label", { class: "flabel" }, "목표가 (이 금액 이하가 되면)", tgt) : null) : null,
        s.type === "target" || s.type === "cartdrop" ? h("label", { class: "flabel" }, s.type === "cartdrop" ? "이 금액 이하가 되면 (비우면 지금보다 내리면)" : "이 금액 이하가 되면", tgt) : null,
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "매주 모은 가격끼리 비교해, 앱을 열 때 관심 탭과 종 아이콘으로 알려요. 같은 변화는 한 번만 알려요. 병원 표시가 기준이에요."),
        h("div", { class: "tiny", style: "margin-top:var(--sp-2)" }, PUSH ? (base.k && watched.sp === false ? "'특가 포함'이 꺼져 있어 이 알림은 이 기기에서 앱을 열 때만 알려요(앱이 닫혀 있을 때 오는 알림은 특가까지 넣어 계산해요). 앱을 닫아도 받으려면 내 설정에서 '특가 포함'을 켜고 만들어 주세요."
          : base.k ? "관심 탭에서 '가격 알림 받기'를 켜 두면 앱이 닫혀 있어도 이 알림의 가격이 바뀔 때 알려요(일주일에 한 번 묶어서)."
          : "이 알림은 앱을 열 때만 알려요(앱이 닫혀 있을 때 오는 알림에는 이 종류가 없어요).")
          : "휴대폰 알림을 켜 두면 앱을 열 때 찾은 변화를 휴대폰 알림으로도 보여줘요. 앱이 닫혀 있을 때 오는 푸시는 서버가 필요해서 아직 없어요."),
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:var(--sp-3)", onclick: () => {
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
  // one line of 알림 기록 — 관심 탭's card and the top bar's bell panel draw it the same way: the kind, the treatment, the real
  // branch, before → after, the data date and '가격 보기'. fresh: the '새 알림' dot instead of the bell (history) icon
  const NOTES_EMPTY = "아직 기록이 없어요. 알림 가격이 바뀌면 여기에 남아요.";
  function noteRow(x, fresh = !x.read) {
    const b = x.b ? BK.get(x.b) : null, k = x.k && KI[x.k] != null ? x.k : null;
    return h("li", { "data-type": x.type || "" }, h("div", { class: "item" },
      h("span", { class: "t row", style: "flex-wrap:nowrap" }, fresh ? h("span", { class: "dot", role: "img", "aria-label": "새 알림", style: "background:var(--s2)", title: "새 알림" }) : icon(x.past ? "history" : "bell", "sm"),
        h("span", {}, x.type ? h("span", { class: "k k4", style: "margin-right:var(--sp-2)" }, NOTE_T[x.type] || x.type) : null, x.name || x.text)),
      h("span", { class: "sub" }, x.obs ? `${md(x.obs)} 수집` : md(x.at)),
      x.type ? h("span", { class: "m" }, b != null ? h("span", { class: "row", style: "gap:var(--sp-1)" }, bdot(b), bname(b)) : x.b ? h("span", {}, x.b.replace("|", " ")) : null,
        x.before != null && x.after != null && typeof x.before === "number" ? h("span", { class: "num" }, `${won(x.before)} → ${won(x.after)}`) : x.after != null ? h("span", { class: "num" }, won(x.after)) : null,
        h("span", {}, (x.text || "").split(": ").slice(1).join(": ")), h("span", { class: "sp" }),
        k ? goLink("가격 보기", () => { closeNoti(true); nav(`compare?k=${k}`); }, { "aria-label": `${x.name || "이 시술"} 가격 보기` }) : null)
        : h("span", { class: "m" }, x.text)));
  }
  // 종 버튼 알림 패널 (#notip, 2026-10-20 사용자 요청): the top bar's bell opens the latest 알림 기록 right under the bar, so what
  // an alert was is seen where its count is. Opening reads them all (the count on the bell goes); the lines that were new keep
  // the '새 알림' dot while the panel stays open. It closes on the bell again, a tap outside it, focus leaving it (Tab), Esc,
  // '가격 보기', '전체 보기' and a new screen (renderNow). It lives outside #main: made when it opens and removed when it closes;
  // while it is open, render() brings its lines up to date (paintNoti) — so a record checkAlerts makes after the full price
  // file arrives shows there too.
  // The mark a tapped phone notification brings when sw.js sends one ('#saved?bell=1', or a message to the open window with
  // panel: true — PWA_IMPLEMENTATION.md 4-3) opens it on 관심 탭 (bellMark).
  const NOTI_N = 5;
  let noti = null;   // the open panel: { el, list, count, fresh: the notes new at this opening, sig, off }
  function openNoti() {
    if (!D) return;
    if (noti) { paintNoti(); return; }   // already open (a phone notification tapped again): its lines again
    const btn = $("#notibtn"), list = h("div", { class: "notip-b" }), count = h("span", { class: "sub" });
    const el = h("div", { class: "card flush notip", id: "notip", role: "dialog", "aria-labelledby": "notip-t" },
      h("div", { class: "row", style: "padding:var(--sp-3) 14px 0" }, h("h3", { id: "notip-t", tabindex: "-1" }, "가격 알림 기록"), h("span", { class: "sp" }), count),
      list, h("button", { class: "morelist", type: "button", onclick: () => { closeNoti(true); nav("saved"); } }, "전체 보기", icon("chevron-right", "sm")));
    // a tap anywhere else closes it (and still does what it was for), and so does focus going anywhere else — Tab out of it, a
    // field tapped: the control then focused would be hidden under the panel (WCAG 2.4.11). The panel only goes, nothing below
    // moves, so a press that focused on its way down still clicks. A tap on the panel's own text sends focus to the page with no
    // focusin, so it stays open. Esc closes it; focus goes back to the bell from the panel, the bell or nowhere (that tap on its
    // text) — never off a control elsewhere, which stays where it is
    const out = (e) => { if (noti && !el.contains(e.target) && !btn.contains(e.target)) closeNoti(true); };
    const key = (e) => { if (e.key === "Escape" && noti && !document.querySelector(".sheet-bg")) { e.preventDefault();
      const a = document.activeElement; closeNoti(!(!a || a === document.body || el.contains(a) || btn.contains(a))); } };
    const on = [["click", out, true], ["focusin", out, true], ["keydown", key, false]];
    for (const [t, f, c] of on) document.addEventListener(t, f, c);
    noti = { el, list, count, fresh: new Set(), sig: "", off: () => { for (const [t, f, c] of on) document.removeEventListener(t, f, c); } };
    $("#top").append(el);
    btn.setAttribute("aria-expanded", "true"); btn.setAttribute("aria-controls", "notip");
    paintNoti();
    el.querySelector("#notip-t").focus({ preventScroll: true });
  }
  // quiet: focus is not sent back to the bell (a tap elsewhere, a new screen); when it was in the panel ('가격 보기', '전체 보기')
  // it goes to the page, not to nowhere
  function closeNoti(quiet) {
    if (!noti) return;
    const n = noti, had = n.el.contains(document.activeElement); noti = null;
    n.off(); n.el.remove();
    const btn = $("#notibtn");
    btn.setAttribute("aria-expanded", "false"); btn.removeAttribute("aria-controls");
    if (quiet !== true) btn.focus(); else if (had) $("#main").focus({ preventScroll: true });
  }
  function paintNoti() {
    if (!noti) return;
    // what is new now is read (the bell's count goes) and keeps its dot in the panel until it closes
    const unread = st.notes.filter((x) => !x.read);
    for (const x of unread) { noti.fresh.add(x); x.read = true; }
    if (unread.length) saveAlerts();
    const shown = st.notes.slice(0, NOTI_N);
    const sig = [D.meta.updated, partial(), st.notes.length, ...shown.map((x) => `${noti.fresh.has(x) ? "*" : ""}${x.at}|${x.obs}|${x.type}|${x.k}|${x.b}|${x.before}|${x.after}|${x.text}`)].join("\n");
    if (sig === noti.sig) return;
    noti.sig = sig;
    const mark = focusMark(noti.list, document.activeElement);
    noti.count.textContent = st.notes.length > NOTI_N ? `최근 ${NOTI_N}개 · 모두 ${st.notes.length}개` : "";
    noti.list.replaceChildren(shown.length ? h("ul", { class: "list notes" }, shown.map((x) => noteRow(x, noti.fresh.has(x))))
      : emptyLine(NOTES_EMPTY));
    if (mark) focusBack(noti.list, mark);
  }
  // a phone notification tapped: sw.js opens '#saved?bell=1' (or tells the open window, which goes there). The mark leaves the
  // address at once (replaceState), so back, a reload or the remembered last screen do not open the panel again
  function bellMark() {
    const m = /^#([^?]*)\?(.*)$/.exec(location.hash);
    if (!m) return false;
    const q = new URLSearchParams(m[2]);
    if (q.get("bell") !== "1") return false;
    q.delete("bell");
    history.replaceState(null, "", `#${m[1]}${q.toString() ? `?${q}` : ""}`);
    return true;
  }
  function alertsCard() {
    const card = h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "가격 알림"), h("span", { class: "sp" }),
      h("span", { class: "sub" }, `${st.alerts.length}/20`)));
    const unread = st.notes.filter((x) => !x.read);
    card.append(st.alerts.length ? h("ul", { class: "list" }, st.alerts.map((a) => { const now = alertNow(a);
      return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, alertName(a)), h("span", { class: "p num" }, now && now.value != null ? won(now.value) : "-"),
        h("span", { class: "m" }, h("span", { class: "k k4" }, ALERT_TYPES[a.type]), a.type === "watch" ? h("span", {}, Object.entries(Intel.WATCH_T).filter(([t]) => !a.on || a.on[t] !== false).map(([, l]) => l).join(" · ")) : null,
          a.target ? h("span", {}, `목표 ${won(a.target)}`) : null, a.base != null && typeof a.base !== "object" && a.type !== "newmatch" ? h("span", {}, `기준 ${won(a.base)}`) : null,
          a.type === "newmatch" && a.base != null ? h("span", {}, `기준 ${a.base}곳`) : null, a.reg ? h("span", {}, a.reg) : null, PUSH && a.k && a.sp === false ? h("span", { title: "'특가 포함'을 끄고 만든 알림이라 앱을 열 때만 알려요" }, "일반가만 · 이 기기만") : null, h("span", { class: "sp" }),
          h("button", { class: "addbtn", type: "button", "aria-label": `${alertName(a)} 알림 해지`, onclick: () => {
            const before = st.alerts.slice(); st.alerts = st.alerts.filter((x) => x !== a); saveAlerts(); render();
            undoToast("알림을 해지했어요", () => { st.alerts = before; saveAlerts(); render(); }); } }, "해지")))); }))
      : emptyBox("bell-plus", jline("emptyAlerts") || "아직 알림이 없어요", "시술 화면 ⋯ → '가격 알림'이나 내 견적의 '합계 알림'에서 만들 수 있어요."));
    // 알림 기록: what fired (and the real past changes of a watched treatment), newest first
    card.append(h("div", { class: "row", style: "padding:var(--sp-3) 14px 0" }, h("h3", { class: "t-body" }, "알림 기록"), h("span", { class: "sp" }),
      st.notes.length ? h("button", { class: "linkbtn", type: "button", onclick: () => { const before = st.notes.slice(); st.notes = []; saveAlerts(); render(); undoToast("알림 기록을 지웠어요", () => { st.notes = before; saveAlerts(); render(); }); } }, "기록 지우기") : null));
    card.append(st.notes.length ? h("ul", { class: "list notes" }, st.notes.slice(0, 20).map((x) => noteRow(x)))
      : emptyLine(NOTES_EMPTY));
    if (unread.length) setTimeout(() => { for (const x of unread) x.read = true; saveAlerts(); }, 1500);
    card.append(notifyPanel());
    return card;
  }
  // 휴대폰 알림 panel: real state of this browser; the permission prompt only after a tap. With push set up (config.js) it is
  // the push switch: '가격 알림 받기' asks for the permission first (iOS wants it straight from the tap), then subscribes.
  function notifyPanel() {
    const box = h("div", { class: "nfp" });
    const paint = () => {
      const kids = [h("b", {}, icon("bell-ring", "sm"), PUSH ? " 가격 알림 받기" : " 휴대폰 알림")];
      // iPhone·iPad first: a Safari tab has no Notification at all, and the answer there is 'install', not 'unsupported'
      if (isIOS() && !standalone()) kids.push(h("div", { class: "sub" }, "iPhone·iPad는 홈 화면에 설치한 앱에서만 알림을 켤 수 있어요(iOS 16.4 이상). ", goLink("설치 방법", "about")));
      else if (!(PUSH ? pushSupported() : notifySupported())) kids.push(h("div", { class: "sub" }, "이 브라우저는 웹 알림을 지원하지 않아요. 앱 안의 알림(관심 탭·종 아이콘)은 그대로 돼요."));
      else if (Notification.permission === "denied") kids.push(h("div", { class: "sub" }, "이 사이트의 알림이 꺼져 있어요. 브라우저 설정에서 켜 주세요."));
      else if (PUSH) {
        const s = pushState(), { rules, local, cut } = pushRules();
        const note = [local ? `${local}개는 이 기기에서 앱을 열 때만 알려요(내 견적 합계·지점 상품 목표가·이벤트 종료 3일 전·'특가 포함'을 끄고 만든 알림)` : "", cut ? `조건이 20개를 넘어 ${cut}개는 빠졌어요` : ""].filter(Boolean).join(" · ");
        if (s && Notification.permission === "granted") {
          kids.push(h("div", { class: "sub" }, `켜짐 — 가격이 바뀌면 보통 일주일에 한 번 묶어서 와요(행사 마감 임박은 따로). 오전 8시~오후 9시에만 보내요. 보낸 조건 ${rules.length}개.`),
            privacyLink(), note ? h("div", { class: "tiny" }, note) : null);
          const off = h("button", { class: "btn sm gray", type: "button", style: "margin-top:var(--sp-2)", onclick: async () => {
            off.disabled = true; await pushUnsubscribe(); toast("가격 알림을 껐어요"); paint(); } }, "가격 알림 끄기");
          kids.push(off);
        } else if (!rules.length) {
          // nothing to send yet: the switch would only make an empty subscription (and remove it again)
          kids.push(h("div", { class: "sub" }, st.alerts.length ? "지금 가격 알림은 모두 이 기기에서 앱을 열 때만 알리는 종류예요. 앱 밖으로 받을 수 있는 알림(비교 화면의 ⋯ → 가격 알림, '특가 포함' 켬)을 하나 이상 만들면 켤 수 있어요."
            : "가격 알림을 하나 이상 만들면 켤 수 있어요. 비교 화면의 ⋯ → 가격 알림에서 만들어요."),
            note ? h("div", { class: "tiny" }, note) : null);
        } else {
          // the first three sentences: §4 '알림 설정 설명', then §4 '푸시 칸' (docs/legal/PRIVACY_POLICY_DRAFT.md, chat C — as written)
          kids.push(h("div", { class: "sub" }, "알림을 켜면 알림 주소와 지켜볼 조건, 알림을 보낸 날 같은 전달 기록이 서버에 저장돼요. 이름·연락처·위치는 저장하지 않아요. 끄거나 가격 알림을 모두 지우면 서버에서도 지워요. 가격이 바뀌면 보통 일주일에 한 번 묶어서 와요(행사 마감 임박은 따로). 오전 8시~오후 9시에만 보내요. 누르기 전에는 권한을 묻지 않아요."),
            privacyLink(), note ? h("div", { class: "tiny" }, note) : null);
          const on = h("button", { class: "btn sm", type: "button", style: "margin-top:var(--sp-2)", onclick: async () => {
            on.disabled = true;
            let p = null;
            try { p = await Notification.requestPermission(); } catch (e) { /* old Safari: callback form */ }
            if ((p || Notification.permission) !== "granted") { paint(); return; }
            on.textContent = "켜는 중…";
            try { await pushSubscribe(); toast("가격 알림을 켰어요"); } catch (e) { console.error(e); toast("가격 알림을 켜지 못했어요. 잠시 뒤 다시 해 주세요"); }
            paint(); } }, "가격 알림 받기");
          kids.push(on);
        }
      }
      else if (Notification.permission === "granted") kids.push(h("div", { class: "sub" }, "켜짐 — 앱을 열 때 찾은 변화를 휴대폰 알림으로도 보여줘요. 앱이 닫혀 있을 때 오는 푸시는 서버가 필요해서 아직 없어요."),
        h("button", { class: "btn sm gray", type: "button", style: "margin-top:var(--sp-2)", onclick: async () => {
          const okN = await deviceNotify("[TEST] 윤실장 알림 시험", "시험용 알림이에요. 실제 가격 변화가 아니에요.", "pc-test");
          st.notes.unshift({ at: today(), obs: "", type: "test", name: "알림 시험", text: okN ? "시험 알림을 보냈어요(실제 가격 변화 아님)" : "시험 알림을 보내지 못했어요", read: true }); saveAlerts(); render();
          toast(okN ? "시험 알림을 보냈어요 — TEST라고 적혀 있어요" : "시험 알림을 보내지 못했어요"); } }, "테스트 알림 보내기 (TEST)"));
      else kids.push(h("div", { class: "sub" }, "켜면 앱을 열 때 찾은 가격 변화를 휴대폰 알림으로도 보여줘요. 누르기 전에는 권한을 묻지 않아요."),
        h("button", { class: "btn sm", type: "button", style: "margin-top:var(--sp-2)", onclick: async () => { try { await Notification.requestPermission(); } catch (e) { /* old Safari: callback form */ } paint(); } }, "휴대폰 알림 켜기"));
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
    price_sheet: "가격 정보 열기", cart_add: "내 견적 담기", scenario_open: "방문 계획 열기", alert_set: "알림 만들기" };
  const anOn = () => store.get("analytics", "off") === "on";
  function track(name, props) {
    if (!anOn() || !AN_EVENTS[name]) return;
    const L = store.get("events", []);
    L.push({ e: name, at: new Date().toISOString(), demo: true, ...(props || {}) });
    store.set("events", L.slice(-500));
  }
  // 단계별 익명 집계 (6.0 약속 2, app/domain/metrics.js) — separate from the on-phone 사용 통계 above. Off unless config.js
  // turns it on (metrics + metricsApi); then only {"s":"<step>"} goes out, each step once a day. While off: nothing stored,
  // nothing sent (tests/e2e/metrics.js counts zero requests).
  // the body is a string (text/plain, no CORS preflight); without sendBeacon, the no-cors keepalive POST chat A gave
  // the phone's switch, also held in memory: storage that is blocked or full must not undo '끄기' for the rest of the visit
  let metricsOffMem = null;
  function metricsOff() { return metricsOffMem != null ? metricsOffMem : store.get("metricsOff", false) === true; }
  const metrics = Metrics.make(window.APP_CONFIG, { load: () => store.get("metrics", null), save: (v) => store.set("metrics", v), today: () => Metrics.kstDay(),
    off: metricsOff,   // 마이 → 내 설정 '익명 이용 집계' (this phone, every account)
    beacon: (url, body) => navigator.sendBeacon ? navigator.sendBeacon(url, body)
      : (fetch(url, { method: "POST", body, keepalive: true, mode: "no-cors", credentials: "omit" }).catch(() => {}), true) });
  // behind the PIN screen (html.locked hides the page) nothing has been seen yet: steps wait; 'unlocked' draws the screen again
  const unseen = () => document.documentElement.classList.contains("locked");
  const metric = (name) => (unseen() ? false : metrics.hit(name));
  // 'first_price': a price (…원) is on screen for the first time today — checked after each draw and while scrolling
  let priceLook = 0, priceDay = "";   // priceDay: the day it went (or was found already sent) — scrolling then costs nothing
  function seePrice() {
    if (!metrics.on || priceLook || priceDay === Metrics.kstDay()) return;
    if (!metrics.pending("first_price")) { priceDay = Metrics.kstDay(); return; }
    priceLook = requestAnimationFrame(() => {
      priceLook = 0;
      const main = $("#main"), vh = window.innerHeight, walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(), n = 0; t && n < 400; t = walk.nextNode()) {
        if (!/\d만?원/.test(t.nodeValue)) continue;   // 250,000원 · 25만원
        n++;
        const r = t.parentElement && t.parentElement.getBoundingClientRect();
        if (r && r.width && r.height && r.bottom > 0 && r.top < vh) { if (metric("first_price")) priceDay = Metrics.kstDay(); return; }
      }
    });
  }
  function eventsSheet() {
    sheet("사용 통계 (이 휴대폰)", (close) => { const L = store.get("events", []), n = {};
      for (const x of L) n[x.e] = (n[x.e] || 0) + 1;
      return h("div", {}, h("p", { class: "sub" }, "이 휴대폰에만 있는 시연 기록이에요. 서버로 보내지 않고, 검색어·고민·위치는 남기지 않아요."),
        L.length ? h("dl", { class: "facts" }, Object.entries(AN_EVENTS).map(([k, l]) => h("div", { class: "fact" }, h("dt", {}, l), h("dd", {}, `${n[k] || 0}번`))))
          : emptyLine("아직 기록이 없어요."),
        h("p", { class: "tiny" }, L.length ? `${L.length}개 · 첫 기록 ${L[0].at.slice(0, 10)} · 모두 demo 표시` : ""),
        h("button", { class: "btn gray", type: "button", style: "width:100%;margin-top:var(--sp-2)", onclick: () => { store.set("events", []); close(); toast("사용 통계를 지웠어요"); } }, "모두 지우기")); });
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
    if (partial()) { pending = () => routeQuery(t); $("#main").replaceChildren(fullWait()); return; }
    // not a price search: a concern, a warning sign, two treatments compared, a question about the app or small talk goes to
    // 죠미와 대화 with the words in memory only (not the URL)
    const r = JomiChat.understand(t, chatCtx(), JomiChat.memory());
    if (FLAGS.concernSearch && !famFind(t).length && (["concern", "safety", "help", "chit", "compare2"].includes(r.kind) || r.safety.length)) { App.chatPending(t); nav("concern"); return; }
    const id = specRoute(t, r);
    nav(id ? `compare?k=${id}` : `search/${encodeURIComponent(t)}`);
  }
  // a treatment named (and no place, brand or price range): straight to its price comparison in the spec asked
  // ('리쥬란 2cc 얼마' → 리쥬란 2cc). A name that covers many kinds ('보톡스', '필러') opens the search page with the kinds
  // side by side instead. 2026-10-15 audit: a search typed like a question showed the treatment's price on the first screen
  // only 42.6% of the time. → the key's id, or null for the search list.
  // The same reading for every box that takes a treatment name — 홈, 탐색 and the search page (hierarchy audit 15 · L10: the
  // same '리쥬란 2cc' opened its comparison from 홈, 4.9 screens, and an 18.6-screen list from the other two). Reading a
  // concern or small talk (→ 죠미와 대화) stays on 홈's box only (routeQuery above).
  function specRoute(t, r = JomiChat.understand(t, chatCtx(), JomiChat.memory())) {
    if (!((r.kind === "treatment" || r.kind === "price") && r.key && !Object.keys(r.where).length)) return null;
    const nl = Search.interpret(` ${t} `, nlCtx());
    if (nl.min || nl.max) return null;
    const head = Search.norm(JomiChat.cleanQuery(t)), many = FAM.filter((f) => f.name.split(/[\s·/()]+/).some((w) => Search.norm(w) === head)).length;
    return many >= 5 && !r.spec && head === Search.norm(r.fams[0].name) ? null : r.key.id;
  }
  // 탐색 and the search page's box: a treatment name → its comparison, anything else → the search list (replace: the search
  // page's own box swaps the page it is on, so 뒤로 goes where it went before)
  const findGo = (v, replace) => { const t = String(v || "").trim(); if (!t) return; const id = specRoute(t); nav(id ? `compare?k=${id}` : `search/${encodeURIComponent(t)}`, replace); };
  const secHead = (title, sub, more) => h("div", { class: "sec-h" }, h("h2", {}, title), sub ? h("span", { class: "sub" }, sub) : null, more || null);
  // 오늘의 발견's rows are picked on their own measure, but the numbers a row shows — the range, the middle price and its branch
  // count — are the comparison's (keyNums: the median over every plain price as in the compare header, the range without the
  // unverified ultra-lows as in its price card), so a row and the comparison it opens draw the line at the same price and the
  // bar's ends mean the same (2026-10-20 review: 윤곽주사 3cc 29,700원 on 홈 ↔ 27,500원 on 비교; 아쿠아필's left end 5,390원 ↔ 10,890원)
  const findNums = (x) => { const N = keyNums(x.k); return N && { ...x, lo: N.lo, hi: N.hi, med: N.med, n: N.prices.length, top: N.ptop }; };
  // treatments whose lowest plain price sits far below the middle of the same-condition prices (comparable sets only)
  function lowFinds(n = 4) {
    const out = [];
    // a gap of more than 70% usually means a different unit (per spot, per shot) or an unmarked condition, not a find
    for (const f of [...FAM].filter((x) => x.cat !== "기타").sort((a, c) => c.n - a.n).slice(0, 80)) {
      const pl = plainRanking(f.main); if (pl.length < 5) continue;
      const { normal } = splitLow(pl); if (normal.length < 5) continue;
      const med = median(pl.map((x) => x.p)), top = normal[0], below = med ? 1 - top.p / med : 0;
      if (below >= 0.15 && below <= 0.7) out.push({ k: f.main, below });
    }
    return out.sort((a, c) => c.below - a.below).slice(0, n).map(findNums).filter(Boolean);
  }
  // same-condition treatments with the widest gap between the lowest and highest plain price (unverified ultra-lows left out).
  // A middle price below the drawn range (ultra-lows pulling it down) is not pinned to the bar's end — the price card draws
  // no bar then — so such a treatment is passed over
  function spreadFinds(n = 4) {
    const out = [];
    for (const f of [...FAM].filter((x) => x.cat !== "기타").sort((a, c) => c.n - a.n).slice(0, 80)) {
      const pl = plainRanking(f.main); if (pl.length < 5) continue;
      const { normal } = splitLow(pl); if (normal.length < 5) continue;
      const ps = normal.map((x) => x.p), lo = Math.min(...ps), hi = Math.max(...ps), spread = lo ? hi / lo : 1;
      if (spread >= 1.5 && spread <= 10) out.push({ k: f.main, spread });
    }
    const picked = [];
    for (const x of out.sort((a, c) => c.spread - a.spread)) {
      if (picked.length >= n) break;
      const y = findNums(x); if (y && y.med >= y.lo && y.med <= y.hi) picked.push(y);
    }
    return picked;
  }

  views.home = () => {
    const box = h("div", { class: "view" });
    const q = h("input", { type: "search", placeholder: "시술 이름 (예: 리쥬란 2cc, 보톡스 50U)", "aria-label": "시술 이름으로 가격 찾기", enterkeyhint: "search" });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") routeQuery(q.value); });
    box.append(h("section", { class: "hero-home" },
      jprefs().freq === "often" ? h("button", { class: "jomi-hello", type: "button", "aria-haspopup": "dialog", onclick: () => jomiSheet() }, jomiImg("default", "face", 28),
        h("span", {}, jline("home")), h("span", { class: "sr" }, " — 죠미 소개 보기")) : null,
      // round-2 UX01: the promise the data can keep — same product, amount and sessions — and the collection range right under it
      h("h2", { class: "display" }, "같은 용량·횟수끼리,", h("br"), "피부과 가격을 비교해요."),
      h("p", { class: "lede", title: coverageBrands() }, coverageLine()),
      searchBox(withSuggest(q, routeQuery), { cls: "hsearch" }, h("button", { type: "button", onclick: () => routeQuery(q.value) }, "찾기"))));
    // two ways in
    const ent = (cls, ic, t, sub, go) => h("button", { class: `entry ${cls}`, type: "button", onclick: go }, h("span", { class: "ei" }, icon(ic)),
      h("span", {}, h("b", {}, t), h("small", {}, sub)), h("span", { class: "go" }, icon("arrow-up-right", "sm")));
    // the two ways in and the promise come after the popular prices: the first screen shows prices (2026-10-15 audit — the
    // home screen showed no price above the fold)
    const entriesNode = h("div", { class: "entries" },
      ent("e-price", "chart-column", "시술 가격 비교", `${regionName()} 지점 가격을 한눈에`, () => nav("compare")),
      FLAGS.concernSearch ? ent("e-concern", "message-circle", "죠미에게 묻기", "이름·가격·고민을 말로 물어봐요", () => nav("concern")) : null);
    const trustNode = h("button", { class: "trustline", type: "button", onclick: () => nav("principles") }, icon("shield-check", "sm"),
      h("span", {}, "병원에게 돈을 받고 순서를 바꾸지 않아요 · 수집 범위와 출처를 공개해요"), icon("chevron-right", "xs"));
    if (!FLAGS.concernSearch) entriesNode.style.gridTemplateColumns = "1fr";
    const cont = partial() ? null : continueChips();
    if (cont) box.append(secHead("이어서 보기"), cont);
    // 인기 시술: cheapest plain price per treatment, how far below the middle, + 담기
    const cats = partial() ? D.meta.partial.cats : [...new Set(KEYS.map((k) => k.cat))];
    if (st.hcat && !cats.includes(st.hcat)) st.hcat = null;
    const popular = [...KEYS].sort((a, b) => byKB[b.i].size - byKB[a.i].size).slice(0, 6);
    // a category tab: the main variant of its most-sold families (not every variant — 톡신 alone has 250+)
    const keys = st.hcat ? famsIn(st.hcat).slice(0, 6).map((f) => KEYS[f.main]) : popular;
    const basisL = FLAGS.lowestHighlight ? "최저가" : "중간 가격";
    box.append(secHead(st.loc ? "내 주변 인기 시술" : "인기 시술", st.loc ? `10km 안 · ${basisL}` : `${regionName()} · ${basisL}`));
    box.append(h("div", { class: "chips" }, h("button", { class: "chip", type: "button", "aria-pressed": !st.hcat ? "true" : "false", onclick: () => { st.hcat = null; render(); } }, "인기"),
      cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": st.hcat === c ? "true" : "false", onclick: () => { st.hcat = c; render(); } }, catIcon(c, "sm"), c))));
    // what '인기' means here: the most widely sold, not searches or bookings (the app has no such numbers)
    // what '인기' means here (the most widely sold, not searches or bookings): behind an ⓘ in the section head (6.0 홈)
    { const sh = [...box.querySelectorAll(".sec-h")].pop(); if (sh) sh.append(h("button", { class: "infob", type: "button", "aria-label": "순서 기준", onclick: () => sheet("순서 기준", () => h("p", { class: "sub" }, st.hcat ? `${st.hcat}에서 파는 지점이 많은 시술 순이에요.` : "‘인기’는 파는 지점이 많은 순이에요(검색·예약 수가 아니에요).")) }, icon("info"))); }
    const grid = h("div", { class: "grid" });
    for (const k of keys) {
      let rk = cmpRk(ranking(k.i, "price")), pl = plainRanking(k.i);
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
        // the branch count sits with '중간값' (it is the median's count, like the compare header's '중간값: … 167곳'), so the
        // range below — both ends in one unit, '5,390~275,000원' — keeps the card's one line (375×667: two cards on the first screen)
        HL ? null : h("span", { class: "pk" }, `${base.length}곳`), h("span", { class: "p num" }, won(HL ? top.p : med)),
        HL && FLAGS.discountEmphasis ? h("span", { class: below > 0 ? "save" : "save flat" }, below > 0 ? `중간보다 ${below}% 싸요` : `${base.length}곳 비교`)
          : HL ? h("span", { class: "save flat" }, nlo === nhi ? `${base.length}곳 같은 가격` : `${Pricing.rangeText(nlo, nhi)} · ${base.length}곳`)
          : h("span", { class: "save flat" }, nlo === nhi ? "모두 같은 가격" : rangeEl(nlo, nhi)),
        HL ? h("span", { class: "basis" }, `${pl.length ? "일반가" : "특가"} ${base.length}곳 · 중간 가격 ${won(med)}`) : pl.length ? null : h("span", { class: "basis" }, "특가만 있어요"),
        HL && cond ? h("span", { class: "basis" }, `특가 ${won(cond.p)}~ (${priceConds(cond.i)[0] || "조건 있음"})`) : null,
        HL && lowp.length ? h("span", { class: "basis" }, `확인 필요 초저가 ${won(lowp[0].p)} (중간 가격의 ${Math.round(lowp[0].p / med * 100)}%)`) : null,
        HL && kindBadge(r).length ? h("span", { class: "row", style: "gap:var(--sp-1);margin-top:var(--sp-2)" }, kindBadge(r).slice(0, 2)) : null,
        HL ? h("span", { class: "w" }, `${bname(top.b)}${top.d != null ? " · " + km(top.d) : ""}`) : null), addBtn(k.i)));
    }
    // '전체 비교' right under the cards it continues (8px — 위계 점검 50 · HOME-1: it sat 29px under them and 16px over the next
    // block, so it read as part of that block), their note under both, then the next block 24px away
    box.append(grid, h("button", { class: "btn line block hall", type: "button", onclick: () => nav("compare") }, `시술 ${(partial() ? D.meta.partial.keys : KEYS.length).toLocaleString()}개 전체 비교`, icon("chevron-right", "sm")),
      h("p", { class: "foot under" }, "가격만으로 고르지 마세요. 용량·조건·정품 여부·의료진·부작용은 시술 화면에서 함께 봐요."));
    box.append(entriesNode, trustNode);
    // 죠미의 오늘의 발견. Default: treatments whose same-condition prices differ most between clinics (no clinic named) —
    // 'compare before you choose'. With flags.discountEmphasis: the biggest gaps below the middle (the earlier list).
    const spreads = FLAGS.discountEmphasis ? [] : spreadFinds();
    if (spreads.length) box.append(secHead("죠미의 오늘의 발견", "병원마다 가격 차이가 큰 시술"), h("div", { class: "card flush" }, h("ul", { class: "list" }, spreads.map((x) =>
      h("li", {}, h("button", { class: "disc-row", type: "button", onclick: () => { st.key = x.k; nav("compare"); } },
        h("span", { class: "t" }, KEYS[x.k].label), h("span", { class: "p num" }, `최대 ${x.spread.toFixed(1)}배`),
        rangeBar(x.lo, x.hi, x.med),
        // the range in the words every range uses ('10,890~108,900원', Pricing.rangeText — the 가격 종류별 lines beside the same bar)
        h("span", { class: "m" }, h("span", { class: "num" }, rangeEl(x.lo, x.hi)), h("span", {}, `중간 ${won(x.med)}`), h("span", {}, `${x.n}곳`))))))),
      h("p", { class: "foot under" }, "같은 용량·횟수인데도 지점마다 이만큼 달라요. 점은 중간 가격이에요."),
      h("p", { class: "foot under" }, `고르는 기준: 일반가가 5곳 이상인 시술 중 가장 비싼 곳과 가장 싼 곳의 차이가 큰 순서예요(초저가 제외). ${md(D.meta.updated)} 가격으로 자동으로 골라요 — 사람이 고르거나 광고로 정하지 않아요.`));
    const finds = FLAGS.discountEmphasis ? lowFinds() : [];
    if (finds.length) box.append(secHead("죠미의 오늘의 발견", "중간 가격보다 많이 낮은 곳"), h("div", { class: "card flush" }, h("ul", { class: "list" }, finds.map((x) =>
      h("li", {}, h("button", { class: "disc-row", type: "button", onclick: () => { st.key = x.k; nav("compare"); } },
        h("span", { class: "t" }, KEYS[x.k].label), h("span", { class: "p num" }, won(x.top.p)),
        rangeBar(x.lo, x.hi, x.med, { at: x.top.p, atName: bname(x.top.b) }),
        // the bar's two ends in words as on every range bar's line (its track alone is too light to read them from)
        h("span", { class: "m" }, bdot(x.top.b), h("span", {}, bname(x.top.b)), h("span", { class: "num" }, rangeEl(x.lo, x.hi)), h("span", { class: "down" }, `중간 가격보다 ${Math.round(x.below * 100)}% ↓`), h("span", {}, `일반가 ${x.n}곳`))))))),
      h("p", { class: "foot under" }, "빈 동그라미는 이 가격, 채운 점은 중간 가격이에요. 특가와 초저가는 빼고 골랐어요."));
    // 가격 변동 since last week (max 2 per branch); before the second collection: say when it starts, draw nothing
    const ch = changeItems(), dn = ch.filter((x) => x.t === "down").length, up = ch.filter((x) => x.t === "up").length;
    box.append(secHead("가격 변동", D.meta.prev ? `${md(D.meta.prev)} 대비` : "주간 기록"));
    const pick = (t) => { const per = new Map(); return ch.filter((x) => x.t === t).sort((a, b) => Math.abs(b.after - b.before) / b.before - Math.abs(a.after - a.before) / a.before)
      .filter((x) => { const n = per.get(x.b) || 0; per.set(x.b, n + 1); return n < 2; }).slice(0, 4); };
    if (D.meta.prev && (dn || up)) {
      const t = st.hmove || "down", list = pick(t);
      box.append(h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:var(--sp-3) 14px 0" }, h("div", { class: "seg", role: "tablist", style: "flex:1" },
        [["down", `내렸어요 ${dn}`], ["up", `올랐어요 ${up}`]].map(([v, l]) => h("button", { type: "button", role: "tab", "aria-selected": t === v ? "true" : "false", onclick: () => { st.hmove = v; render(); } }, l)))),
        h("ul", { class: "list" }, list.map((x) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${x.b}`) },
          h("span", { class: "t" }, x.name), h("span", { class: `p num ${t}` }, won(x.after)),
          h("span", { class: "m" }, bdot(x.b), bname(x.b), h("s", {}, won(x.before)), h("span", { class: t }, Stats.moveText((x.after - x.before) / x.before))))))),
        h("button", { class: "morelist", type: "button", onclick: () => nav("change") }, "가격 변동 전체", icon("chevron-right", "sm"))));
    } else box.append(h("div", { class: "card" }, emptyBox("chart-line", D.meta.prev ? "지난 수집과 달라진 가격이 없어요" : "다음 수집부터 변동이 보여요",
      D.meta.prev ? `${md(D.meta.prev)} → ${md(D.meta.updated)} 비교 결과예요.` : `첫 기록은 ${md(D.meta.updated)} 수집이에요. 다음 주 월요일부터 보여요.`),
      h("button", { class: "btn gray block", type: "button", onclick: () => nav("change") }, "가격 변동 화면", icon("chevron-right", "sm"))));
    box.append(h("p", { class: "foot" }, `병원 홈페이지 가격을 매주 월요일 모아요. ${vatNote()} 체험가·한정가는 보통 1인 1회예요. 방문 전에 병원에 꼭 확인하세요. `,
      h("button", { class: "linkbtn", type: "button", onclick: () => nav("about") }, "알아두면 좋은 점", icon("chevron-right", "xs"))));
    return box;
  };

  // personal shortcuts on 홈: the screen left last time, saved treatments, recently viewed (this phone)
  const ROUTE_NAME = { cart: "내 견적", map: "지도", table: "전체 가격표", guide: "시술 사전", rank: "지점 순위", versus: "지점 비교", change: "가격 변동", quick: "빠른 비교", terms: "쉬운 용어" };
  function continueChips() {
    const out = [], seen = new Set();
    const add = (key, el) => { if (!seen.has(key) && out.length < 5) { seen.add(key); out.push(el); } };
    const last = store.get("lastRoute", ""), lv = last.split(/[/?]/)[0];
    if (lv === "branch" && BR[+last.split(/[/?]/)[1]]) { const b = +last.split(/[/?]/)[1]; add(`b:${bkey(b)}`, h("button", { class: "chip", type: "button", onclick: () => nav(last) }, icon("history", "sm"), bname(b))); }
    else if (ROUTE_NAME[lv] && (lv !== "cart" || cur().items.length)) add(`r:${lv}`, h("button", { class: "chip", type: "button", onclick: () => nav(last) }, icon("history", "sm"), lv === "cart" ? `내 견적 ${cur().items.length}개` : ROUTE_NAME[lv]));
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
      pic.addEventListener("click", () => { const L = J.lines.easter || []; const t = jline("quip") || L[taps++ % (L.length || 1)]; if (!t) return; quip.textContent = t; pic.classList.remove("hop"); void pic.offsetWidth; pic.classList.add("hop"); });
      const go = (route) => () => { close(); nav(route); };
      const actions = h("div", { class: "jomi-actions" },
        FLAGS.concernSearch ? h("button", { class: "btn gray", type: "button", onclick: go("concern") }, icon("message-circle", "sm"), "죠미와 대화") : null,
        h("button", { class: "btn", type: "button", onclick: go("compare") }, icon("chart-column", "sm"), "시술 가격비교"));
      const id = h("div", { class: "jomi-id" }, h("b", {}, J.name), h("span", { class: "en" }, J.en), h("span", { class: "infotag" }, J.role));
      return h("div", { class: `jomi-intro${first ? " first" : ""}` }, pic, quip, id,
        first ? [h("div", { class: "jomi-words" }, (J.lines.intro || []).map((t) => h("p", {}, t))),
          h("ul", { class: "jomi-does" }, (J.lines.does || []).map((t) => h("li", {}, icon("check", "xs"), t))), h("p", { class: "tiny" }, J.lines.doesNot || "")]
          : [h("p", { class: "jomi-back" }, J.lines.back || ""), (() => { const t = jline(Math.random() < 0.7 ? "tip" : "cheer"); return t ? h("p", { class: "jomi-tip tiny" }, h("b", {}, "오늘의 한마디 "), t) : null; })(),
            hereLink("sparkles", "전체 소개 다시 보기", () => { close(); jomiSheet(true); })],
        actions);
    });
  }

  // ---------------- 탐색: every way to look at prices and treatments
  views.explore = () => {
    const box = h("div", { class: "view" });
    const q = h("input", { type: "search", placeholder: "시술 이름 (예: 슈링크 300샷, 리쥬란)", "aria-label": "시술 검색", enterkeyhint: "search" });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter" && q.value.trim()) findGo(q.value); });
    box.append(h("div", { style: "padding:0" }, h("h2", { class: "display" }, "탐색"), h("p", { class: "sub", style: "margin:var(--sp-2) 0 0" }, `${regionName()} ${regionCount()}곳 · 가격 ${D.meta.rows.toLocaleString()}개 · ${md(D.meta.updated)} 수집`)),
      searchBox(withSuggest(q, (v) => findGo(v))));
    const tile = (ic, t, sub, go, cls) => h("button", { type: "button", class: cls || null, onclick: go }, h("span", { class: "hi" }, icon(ic)), h("span", {}, h("b", {}, t), h("small", {}, sub)));
    const top1 = branchRanks()[0];
    box.append(h("div", { class: "hub" },
      tile("chart-column", "시술별 가격 비교", "같은 용량·횟수끼리 가격 범위", () => nav("compare"), "feat"),
      tile("scale", "빠른 비교", shortKeys().length ? `비교함 ${shortKeys().length}/${SHORT_MAX}곳` : "지점 2~4곳 나란히", () => nav("quick")),
      FLAGS.concernSearch ? tile("message-circle", "죠미와 대화", "이름·가격·고민을 말로", () => nav("concern")) : null,
      tile("book-open", "시술 사전", "헷갈리는 시술의 차이", () => nav("guide")),
      tile("map", "지도", "가까운 지점과 가격", () => nav("map")),
      FLAGS.branchRanking ? tile("trophy", "지점 순위", top1 ? `1위 ${BR[top1.b].name}` : "같은 상품 기준", () => nav("rank")) : null,
      tile("scale", "지점 비교", "두 지점 나란히", () => nav("versus")),
      tile("table", "전체 가격표", "조건으로 모든 가격 찾기", () => nav("table")),
      tile("circle-help", "쉬운 용어", "체험가·샷·U가 뭔지", () => nav("terms")),
      tile("trending-down", "가격 변동", D.meta.prev ? "지난 수집 대비" : "다음 수집부터", () => nav("change")),
      tile("info", "데이터 상태·앱 설치", "언제·어디서 모았나·비교 기준", () => nav("data"))));
    box.append(secHead("카테고리로 바로 비교"), h("div", { class: "chips wrapc" }, CMP_CATS.filter((c) => FAM.some((f) => f.cat === c)).map((c) =>
      h("button", { class: "chip", type: "button", onclick: () => nav(`compare?k=${KEYS[KI[CAT_START[c]] ?? famsIn(c)[0].main].id}`) }, catIcon(c, "sm"), c))));
    const tops = FLAGS.branchRanking ? branchRanks().slice(0, 5) : [];
    if (tops.length) box.append(secHead("가격 착한 지점 TOP 5", regionName()), h("div", { class: "card flush" },
      h("ul", { class: "list" }, tops.map((x, n) => h("li", {}, h("button", { class: "rank top", type: "button", onclick: () => nav(`branch/${x.b}`) },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))), h("span", { class: `p ${lvClass(x.lv)}` }, lvText(x.lv)),
        h("span", { class: "m" }, divBar(x.lv), h("span", {}, `제일 싼 시술 ${D.bstat[x.b][3]}개`), dist(x.b) != null ? h("b", {}, km(dist(x.b))) : null))))),
      h("button", { class: "morelist", type: "button", onclick: () => nav("rank") }, "지점 순위 전체", icon("chevron-right", "sm"))));
    box.append(trendCard() || "");
    return box;
  };

  // ---------------- 관심: favourites, price alerts and what was viewed lately (this phone)
  views.saved = () => {
    const box = h("div", { class: "view" });
    box.append(h("div", { style: "padding:0" }, h("h2", { class: "display" }, "관심"), h("p", { class: "sub", style: "margin:var(--sp-2) 0 0" }, "관심 시술·지점과 가격 알림이 이 휴대폰에 모여요")));
    const F = favs();
    const favK = F.k.map((id) => KI[id]).filter((k) => k != null), favB = F.b.map((id) => BK.get(id)).filter((b) => b != null);
    // nothing saved yet: the way to prices first (2026-10-15 audit — the empty screen led nowhere near a price)
    if (!favK.length && !favB.length) box.append(h("button", { class: "btn block", type: "button", onclick: () => nav("compare") }, icon("chart-column", "sm"), "시술 가격 비교하고 관심에 담기"));
    box.append(alertsCard());
    // 관심 시술: price range / middle price / observed change / last check — no 'lowest clinic' (docs/OBJECTIVE_DISPLAY_POLICY.md)
    if (favK.length) box.append(watchCard(favK));
    if (favK.length) box.append(feedCard(favK));
    box.append(h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "관심 지점"), h("span", { class: "sp" }), h("span", { class: "sub" }, `${favB.length}곳`)),
      favB.length ? h("ul", { class: "list" }, favB.map((b) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b}`) }, h("span", { class: "t row", style: "flex-wrap:nowrap" }, icon("store", "sm"), bname(b)),
          h("span", { class: "sub" }, dist(b) != null ? km(dist(b)) : BR[b].region), h("span", { class: "m" }, `가격 ${byB[b].length}개 · 확인 ${md(verified(b))}`)))))
        : favK.length ? emptyBox("store", "관심 지점이 없어요", "지점 화면에서 하트를 누르면 여기에 모여요.")
          : emptyBox("heart", jline("emptySaved") || "관심 시술이 없어요", "시술이나 지점 화면에서 하트를 누르면 여기에 모여요.")));
    { const sc = snapsCard(); if (sc) box.append(sc); }
    const rc = recentChips();
    box.append(h("div", { class: "card" }, h("h3", {}, "최근 본 것"), rc ? h("div", { style: "margin-top:var(--sp-3)" }, rc) : emptyBox("history", jline("emptyRecent") || "아직 본 것이 없어요", "시술이나 지점을 보면 여기에 남아요(이 휴대폰).")));
    const presets = store.get("presets", []);
    if (presets.length) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "내 필터")),
      h("ul", { class: "list" }, presets.map((x) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`${x.route}${x.qs ? "?" + x.qs : ""}`) },
        h("span", { class: "t row", style: "flex-wrap:nowrap" }, icon("sliders-horizontal", "sm"), x.name), icon("chevron-right", "sm")))))));
    { const mr = myReportsCard(); if (mr) box.append(mr); }
    return box;
  };

  // ---------------- 가격 변동: everything that moved since the previous snapshot
  views.change = () => {
    const box = h("div", { class: "view" });
    const all = changeItems();
    // chains first collected since the previous snapshot (meta.brandFirst, C3): their prices are not '새로 생겼어요' one by one —
    // say so, for the chains this list can show (switched on, a branch in the region). No brandFirst: no notice, as before.
    // An older cached intel.js next to this app.js (sw.js falls back to the cache per file) only drops the notice
    const shownChains = D.meta.brands.map((x, i) => (st.brands.includes(i) && BR.some((r) => r.brand === i && regionOk(r.i)) ? x[0] : "")).filter(Boolean);
    const nc = Intel.newChains ? Intel.newChainsNote(Intel.newChains(D.meta.brandFirst, (D.achg || {}).prev, shownChains, D.meta.updated)) : "";
    box.append(h("div", { class: "card" }, h("h2", {}, "가격 변동"),
      h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, D.meta.prev ? `${md(D.meta.prev)} → ${md(D.meta.updated)} 수집 · 일반가 · 병원 표시가 기준 · ${regionName()}` : "지난 수집과 비교해요. 다음 수집부터 보여요."),
      nc ? h("div", { class: "note", id: "newchains", style: "margin-top:var(--sp-2)" }, nc) : null,
      h("div", { class: "tiles" }, [["down", "내렸어요"], ["up", "올랐어요"], ["new", "새로 생겼어요"], ["gone", "없어졌어요"]].map(([v, l]) =>
        h("button", { class: "tile tbtn", type: "button", "aria-pressed": st.cdir === v ? "true" : "false", onclick: () => { st.cdir = st.cdir === v ? "all" : v; render(); } },
          h("span", { class: "k" }, l), h("b", { class: `num ${v === "down" ? "down" : v === "up" ? "up" : ""}` }, all.filter((x) => x.t === v).length), h("span", { class: "w" }, st.cdir === v ? "선택됨 · 다시 누르면 전체" : null))))));
    if (!all.length) { box.append(h("div", { class: "card" }, D.meta.prev ? emptyBox("chart-line", "지난 수집과 달라진 가격이 없어요", `${md(D.meta.prev)} → ${md(D.meta.updated)} 비교 결과예요.`)
      : emptyBox("chart-line", "아직 비교할 지난 기록이 없어요", "다음 주 월요일 갱신 뒤에 보여요."))); return box; }
    // per-branch bars: how many went down vs up
    const per = new Map();
    for (const x of all) { if (x.t !== "down" && x.t !== "up") continue; const v = per.get(x.b) || { d: 0, u: 0 }; v[x.t === "down" ? "d" : "u"]++; per.set(x.b, v); }
    const pmax = Math.max(1, ...[...per.values()].map((v) => Math.max(v.d, v.u)));
    if (per.size) box.append(h("div", { class: "card" }, h("h3", {}, "지점별 내린·오른 개수"), h("div", { class: "row lclegend", style: "margin-top:var(--sp-2)" },
      h("span", { class: "row" }, h("span", { class: "key", style: "background:var(--s1)" }), "내림"), h("span", { class: "row" }, h("span", { class: "key", style: "background:var(--s2)" }), "오름")),
      h("ul", { class: "list cbars" }, [...per.entries()].sort((a, b) => (b[1].d + b[1].u) - (a[1].d + a[1].u)).slice(0, 15).map(([b, v]) => h("li", {}, h("button", { class: "cbar", type: "button", "aria-pressed": st.cbr === b ? "true" : "false",
        onclick: () => { st.cbr = st.cbr === b ? null : b; render(); }, "aria-label": `${bname(b)} 내림 ${v.d}개 오름 ${v.u}개` },
        h("span", { class: "bn" }, BR[b].name), h("span", { class: "side l" }, h("b", {}, v.d || ""), h("i", { style: `width:${v.d / pmax * 100}%` })), h("span", { class: "side r" }, h("i", { style: `width:${v.u / pmax * 100}%` }), h("b", {}, v.u || "")))))) ));
    const q = h("input", { type: "search", placeholder: "시술 이름으로 찾기", "aria-label": "시술 찾기" });
    const list = h("ul", { class: "list" }), moreSlot = h("div", {});
    const paint = () => {
      const w = q.value.trim().toLowerCase();
      const pct = (x) => x.before && x.after ? (x.after - x.before) / x.before : 0;
      let shown = all.filter((x) => (st.cdir === "all" || x.t === st.cdir) && (st.ccat < 0 || x.cat === st.ccat) && (st.cbr == null || x.b === st.cbr) && (!w || x.name.toLowerCase().includes(w)));
      shown.sort({ pct: (a, b) => Math.abs(pct(b)) - Math.abs(pct(a)), amount: (a, b) => Math.abs((b.after || 0) - (b.before || 0)) - Math.abs((a.after || 0) - (a.before || 0)), branch: (a, b) => a.b - b.b || a.name.localeCompare(b.name, "ko"), price: (a, b) => (a.after ?? a.before) - (b.after ?? b.before) }[st.csort]);
      // the first 300, then the shared '더 보기' (it used to end on '1,234개 중 300개만 보여요' with no way to the rest)
      list.replaceChildren();
      const mb = moreList(list, shown, (x) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${x.b}`) },
        h("span", { class: "t" }, x.name), h("span", { class: `p num ${x.t === "down" ? "down" : x.t === "up" ? "up" : ""}` }, x.after != null ? won(x.after) : "없어짐"),
        h("span", { class: "m" }, bdot(x.b), h("span", {}, bname(x.b)), x.before != null && x.after != null ? [h("s", {}, won(x.before)), h("span", { class: x.t }, Stats.moveText(pct(x)))] : null,
          x.t === "new" ? h("span", { class: "k k4" }, "새로 생김") : null, x.t === "gone" ? h("span", { class: "k k4" }, `지난 수집 ${won(x.before)}`) : null))), { first: 300 });
      moreSlot.replaceChildren(...(mb ? [mb] : []));
      if (!shown.length) list.replaceChildren(emptyLine("조건에 맞는 변동이 없어요"));
    };
    q.addEventListener("input", paint);
    const cats = [...new Set(all.map((x) => x.cat).filter((c) => c >= 0))].sort((a, b) => a - b);
    box.append(h("div", { class: "card" }, searchBox(q, { inset: true }),
      h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, h("button", { class: "chip", type: "button", "aria-pressed": st.ccat < 0 ? "true" : "false", onclick: () => { st.ccat = -1; render(); } }, "전체"),
        cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": st.ccat === c ? "true" : "false", onclick: () => { st.ccat = c; render(); } }, D.meta.cats[c]))),
      h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, [["pct", "변동률 큰 순"], ["amount", "금액 큰 순"], ["price", "낮은 가격순"], ["branch", "지점별"]].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": st.csort === v ? "true" : "false", onclick: () => { st.csort = v; render(); } }, l))),
      st.cbr != null ? h("div", { class: "row", style: "margin-top:var(--sp-2)" }, h("span", { class: "sub" }, `지점: ${bname(st.cbr)}`), h("button", { class: "linkbtn", type: "button", onclick: () => { st.cbr = null; render(); } }, "해제")) : null));
    box.append(h("div", { class: "card flush" }, list, moreSlot));
    paint();
    return box;
  };

  // ---------------- search index (aliases, typo correction, autocomplete — app/domain/search.js), built on first use
  let SIDX = null, normBySid = null;
  const searchNames = () => { const sids = [...new Set(ROWS.map((r) => r[2]))]; return { sids, names: sids.map((i) => S[i]), extra: [...KEYS.map((k) => k.label), ...FAM.map((f) => f.name)] }; };
  const takeIndex = (sids, idx) => { SIDX = idx; normBySid = new Map(sids.map((sid, n) => [sid, idx.normNames[n]])); return SIDX; };
  function searchIndex() {
    if (SIDX) return SIDX;
    const { sids, names, extra } = searchNames();   // the worker has not answered yet (or there is none): build it here
    return takeIndex(sids, Search.buildIndex(names, extra));
  }
  // round-2 O3: the same index built in a worker as soon as the full price data is in (never from home.json's rows)
  function prepSearchIndex() {
    if (SIDX || partial() || typeof Worker === "undefined") return;
    const forD = D, { sids, names, extra } = searchNames();
    let w;
    try { w = new Worker("workers/search_index.js"); } catch (e) { return; }
    w.onmessage = (e) => { w.terminate(); if (D === forD && !SIDX && e.data && e.data.ok) takeIndex(sids, e.data.idx); };
    w.onerror = () => w.terminate();
    w.postMessage({ names, extra });
  }
  App.searchReady = () => !!SIDX;
  App.searchIndexData = () => SIDX;   // tests: the worker's index against one built here (tests/e2e/o3_search.js)
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
      if (partial()) { list.hidden = true; return; }   // suggestions come from every name: after the full file
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
  const SORTS = () => [["region", "지역·이름순"], ["recent", "최근 확인순"], ["near", "가까운순"], ["price", "낮은 가격순"], ["priceDesc", "높은 가격순"], ["unit", "단위당 가격"], ["name", "상품명순"],
    ...(FLAGS.discountEmphasis ? [["disc", "할인율 큰 순"], ["pos", "중간보다 싼 순"]] : [])];
  const SESS_L = { "1": "1회 가격", pkg: "2회 이상 묶음", pass: "이용권·무제한" }, COND_L = { plain: "일반가만", special: "특가만" };
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
  // nDef: price rows shown at first — 전체 가격표 100 (as before), search 20 (hierarchy audit 5); ?n= in the address after 더 보기
  function readFilters(params, q, nDef = 100) {
    const P = (k, d = "") => params.get(k) ?? d;
    return { q: q ?? P("q"), cat: +P("cat", -1), brand: +P("brand", -1), b: +P("b", -1), kind: +P("kind", -1), sort: (() => { const v = P("sort", "") || store.get("tableSort", "region"); return SORTS().some(([k]) => k === v) ? v : "region"; })(),
      min: +P("min", 0) || 0, max: +P("max", 0) || 0, sess: P("sess", ""), cond: P("cond", ""), unit: P("unit", ""), amt: P("amt", ""), area: P("area", ""), reg: P("reg", ""),
      atts: P("att", "").split(",").filter((x) => Search.attrGroup(x)),
      fv: P("fv", ""), bun: P("bun", ""), old: P("old") === "1", vu: P("vu", ""), prod: P("prod", ""),   // 가격 조건 sheet + 제품·장비 chips
      exact: P("exact") === "1", n: Math.max(1, +P("n", nDef) || nDef) };
  }
  // every filter as a predicate; skip = one dimension to ignore (for 'how many results would this option give')
  // cq = Search.compile(query) or null (docs/ADVANCED_SEARCH_SPEC.md: words, -뺄 낱말, a|b, 300샷, 1회?)
  // branch-level checks (brand switched on, region, area) for one pass over the rows: once per branch instead of once per
  // row and per count (round-2 O3 — a search ran them ~13 × 140k times). Set only for the loop that asked for it.
  let GATE = null;
  function withGate(f, fn) {
    const arr = new Uint8Array(BR.length);
    for (const b of BR) arr[b.i] = (brandOn(b.i) ? 1 : 0) | (regOk(b.i, f.reg) ? 2 : 0) | (areaOk(b.i, f.area) ? 4 : 0);
    const prev = GATE; GATE = { f, arr };
    try { return fn(); } finally { GATE = prev; }
  }
  function rowPasses(i, f, cq, skip = "") {
    const r = ROWS[i], G = GATE && GATE.f === f ? GATE.arr[r[0]] : -1;
    if (!(f.old ? r[17] !== 1 : live(i)) || !(G >= 0 ? G & 1 : brandOn(r[0])) || (!st.special && isSpecial(r))) return false;
    if (skip !== "q" && cq && !cq.empty && !cq.test(normBySid.get(r[2]))) return false;   // the most selective check first
    if (skip !== "fv" && f.fv && (f.fv === "only") !== isFirstVisit(r)) return false;
    if (skip !== "bun" && f.bun && (f.bun === "only") !== isBundle(r)) return false;
    if (skip !== "vu" && f.vu === "no" && r[12] === 0) return false;
    if (skip !== "prod" && f.prod && !prodOf(r[2]).includes(f.prod)) return false;
    if (skip !== "reg" && !(G >= 0 ? G & 2 : regOk(r[0], f.reg))) return false;
    if (skip !== "area" && !(G >= 0 ? G & 4 : areaOk(r[0], f.area))) return false;
    if (skip !== "cat" && f.cat >= 0 && r[1] !== f.cat) return false;
    if (skip !== "brand" && f.brand >= 0 && BR[r[0]].brand !== f.brand) return false;
    if (skip !== "b" && f.b >= 0 && r[0] !== f.b) return false;
    if (skip !== "kind" && f.kind >= 0 && r[5] !== f.kind) return false;
    if (skip !== "range" && ((f.min && r[3] < f.min) || (f.max && r[3] > f.max))) return false;
    if (skip !== "sess") { const ss = sessOf(i); if ((f.sess === "1" && ss !== 1) || (f.sess === "pkg" && (ss < 2 || ss >= 99)) || (f.sess === "pass" && ss < 99)) return false; }
    if (skip !== "cond" && ((f.cond === "plain" && isSpecial(r)) || (f.cond === "special" && !isSpecial(r)))) return false;
    if (skip !== "amt" && f.amt && amtOf(i) !== f.amt) return false;
    if (skip !== "att" && !attOk(i, f.atts || [])) return false;
    return true;
  }
  // ---- 가격 조건 (one sheet for every price condition: 조건부·종류·첫 방문·묶음·회차·부가세·만료/미확인)
  const FV_L = { only: "첫 방문가만", no: "첫 방문가 빼기" }, BUN_L = { only: "패키지(+)만", no: "패키지(+) 빼기" };
  const condActive = (f) => [f.cond ? COND_L[f.cond] : "", f.kind >= 0 ? D.meta.kinds[f.kind] : "", f.fv ? FV_L[f.fv] : "", f.bun ? BUN_L[f.bun] : "", f.sess ? SESS_L[f.sess] : "",
    f.old ? "지난 이벤트·확인 중 포함" : "", f.vu ? "부가세 미확인 빼기" : "", st.special ? "" : "특가 빼기(앱 전체)", st.vat === "listed" ? "병원 표시가" : ""].filter(Boolean);
  function priceCondSheet(f, go, cnt) {
    const s0 = { cond: f.cond, kind: f.kind, fv: f.fv, bun: f.bun, sess: f.sess, old: f.old, vu: f.vu, special: st.special, vat: st.vat };
    const s = { ...s0 };
    sheet("가격 조건", (close) => {
      const box = h("div", {});
      const opts = (label, key, list, note) => h("div", { class: "pcgrp", role: "group", "aria-label": label }, h("div", { class: "sub", style: "margin:var(--sp-3) 0 var(--sp-2)" }, label),
        h("div", { class: "opts" }, list.map(([v, l, n]) => h("button", { class: "opt", type: "button", "aria-pressed": String(s[key]) === String(v) ? "true" : "false", onclick: () => { s[key] = v; paint(); } },
          h("b", {}, l), n != null ? h("span", { class: "num" }, `${n.toLocaleString()}개`) : null))), note ? h("div", { class: "tiny", style: "margin-top:var(--sp-2)" }, note) : null);
      const tog = (label, key, help) => h("label", { class: "row pctog", style: "margin-top:var(--sp-2);flex-wrap:nowrap" }, h("input", { type: "checkbox", checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; } }),
        h("span", {}, h("b", {}, label), help ? h("span", { class: "tiny", style: "display:block" }, help) : null));
      const paint = () => fill(box,
        h("div", { class: "sub" }, "숫자는 지금 다른 조건에서의 가격 수예요."),
        opts("특가(체험가·한정가·첫 방문·요일·시간)", "cond", [["", "모두", null], ["plain", "일반가만", cnt.cond.plain || 0], ["special", "특가만", cnt.cond.special || 0]]),
        opts("가격 종류", "kind", [[-1, "전체", null], ...D.meta.kinds.map((k, i) => [i, k, cnt.kind[i] || 0])]),
        opts("첫 방문 가격", "fv", [["", "상관없음", null], ["only", "첫 방문가만", cnt.fv.only || 0], ["no", "첫 방문가 빼기", cnt.fv.no || 0]], "병원이 '첫 방문·신규·첫 시술'이라고 적은 가격이에요. 두 번째부터는 보통 일반가예요."),
        opts("패키지(A+B처럼 여러 시술을 한 값에)", "bun", [["", "포함", null], ["only", "패키지만", cnt.bun.only || 0], ["no", "패키지 빼기", cnt.bun.no || 0]], "패키지는 구성이 지점마다 달라 시술별 비교에 쓰지 않아요."),
        opts("횟수", "sess", [["", "전체", null], ...Object.entries(SESS_L).map(([k, l]) => [k, l, cnt.sess[k] || 0])], "횟수가 안 적힌 가격은 1회로 봐요."),
        opts("부가세 표시(앱 전체)", "vat", [["incl", "부가세 포함가", null], ["listed", "병원 표시가", null]], "'부가세 별도' 가격에만 10%를 더해요. 표기를 못 찾은 가격은 그대로 둬요."),
        h("div", { class: "sub", style: "margin:var(--sp-3) 0 0" }, "그 밖의 설정"),
        tog("특가 포함(앱 전체)", "special", "끄면 특가(체험가·한정가·첫 방문·요일·시간)가 모든 화면에서 빠져요."),
        tog("지난 이벤트·확인 중 가격도 보기", "old", "이벤트가 끝났거나 급변해서 확인 중인 가격이에요. 가격표에서만 보이고 비교·내 견적에는 쓰지 않아요."),
        tog("부가세 표기를 못 찾은 가격 빼기", "vu", null),
        h("div", { class: "row", style: "margin-top:var(--sp-3)" },
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
    return h("div", { class: "prodf" }, h("div", { class: "sub", style: "margin:var(--sp-2) 0" }, "제품·장비"),
      h("div", { class: "chips", role: "group", "aria-label": "제품·장비" }, list.map(([n, c]) => h("button", { class: "chip", type: "button", "aria-pressed": f.prod === n ? "true" : "false", onclick: () => go({ prod: f.prod === n ? "" : n }) }, `${n} (${c.toLocaleString()})`))),
      h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "상품명에 제품·장비 이름이 적힌 가격만 잡혀요."));
  }
  // '이렇게 찾았어요': how the query was read (operators), and what was ignored
  const QK = { and: "포함", exact: "", not: "빼기", or: "둘 중 하나", opt: "" };
  function queryCard(cq) {   // a line at the top of the filter card (no card of its own — 위계 점검 32)
    return h("div", { class: "qcard" }, h("div", { class: "sub" }, "이렇게 찾았어요"),
      h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, cq.parts.map((x) => h("span", { class: `chip qk-${x.kind}`, style: "cursor:default" }, QK[x.kind] ? `${QK[x.kind]}: ` : "", x.label))),
      cq.warn.map((w) => h("div", { class: "ferr", style: "margin-top:var(--sp-2)" }, w)));
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
    return h("div", { class: "attf" }, h("div", { class: "sub", style: "margin:var(--sp-2) 0 0" }, "세부 구분"),
      groups.map(([g, l]) => h("div", { class: "chips", role: "group", "aria-label": g, style: "margin-top:var(--sp-2)" }, h("span", { class: "sub", style: "align-self:center;flex:none;min-width:44px" }, g),
        l.map((n) => h("button", { class: "chip", type: "button", "aria-pressed": f.atts.includes(n) ? "true" : "false", onclick: () => pick(n) }, `${n} (${(cnt[n] || 0).toLocaleString()})`)))),
      h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "상품명에서 읽은 구분이에요. 구분이 없는 가격은 이 필터를 고르면 빠져요."));
  }
  // the address's query as it is now when it is still this page, else the params the screen was drawn with
  function liveParams(route, params) {
    const [hp, hq] = location.hash.replace(/^#/, "").split("?");
    return new URLSearchParams(hp === route ? hq || "" : params);
  }
  function priceTable(route, params, opt = {}) {
    const N0 = opt.n || 100, f = readFilters(params, opt.q, N0);
    const go = (patch) => {
      // from the address as it is now, not the params this screen was drawn with: a min/max typed and then a chip tapped
      // on the same (not yet redrawn) screen must both stick
      const np = liveParams(route, params);
      for (const [k, v] of Object.entries(patch)) { if (v === "" || v == null || v === -1 || v === false || (k === "n" && v === N0)) np.delete(k); else np.set(k, v === true ? "1" : v); }
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
    const pr = [], qOn = cq && !cq.empty;
    withGate(f, () => { for (let i = 0; i < ROWS.length; i++) {
      if (dupRows().has(i) || !(f.old ? ROWS[i][17] !== 1 : live(i)) || !(GATE.arr[ROWS[i][0]] & 1)) continue;   // a row collected twice counts once (E4)
      if (qOn && !cq.test(normBySid.get(ROWS[i][2]))) continue;   // every count below needs the words too
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
    } });
    // two blocks (위계 점검 32 · SEARCH-1): the filters — with how the words were read ('이렇게 찾았어요') at their top — and the
    // results, whose card opens on its count, range and order, the notes about them and '가격만으로 고르지 마세요'. 24 px between
    // the two blocks (.ptable), 8 px inside; no boxes in between
    const box = h("div", { class: "view ptable", style: "animation:none" });
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
    // 용량·샷 수, 제품·장비, 세부 구분 chips: on the search page they wait in their own fold until one is used (hierarchy
    // audit 5: open, the three took ~400 of the 640 px between the search's specs and its first price line); 전체 가격표
    // keeps them open as before
    const amtF = Object.keys(cnt.amt).length > 1 ? h("div", {}, h("div", { class: "sub", style: "margin:var(--sp-2) 0" }, "용량·샷 수"), h("div", { class: "chips" },
        Object.entries(cnt.amt).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([a, n]) => h("button", { class: "chip", type: "button", "aria-pressed": f.amt === a ? "true" : "false", onclick: () => go({ amt: f.amt === a ? "" : a }) }, `${a} (${n})`)))) : null;
    const prodF = prodFacet(f, cnt.prod, go), attF = attFacet(f, cnt.att, go), facets = [amtF, prodF, attF].filter(Boolean), facN = (f.amt ? 1 : 0) + (f.prod ? 1 : 0) + f.atts.length;
    const facetBox = !facets.length ? null : !opt.foldFacets ? facets
      : h("details", { class: "fmore ffacet", open: facN > 0 }, h("summary", {}, "더 좁히기", facN ? h("span", { class: "k k4" }, `${facN}개 사용 중`)
        : h("span", { class: "sub" }, [amtF ? "용량·샷 수" : "", prodF ? "제품·장비" : "", attF ? "세부 구분" : ""].filter(Boolean).join(" · "))), facets);
    box.append(h("div", { class: "card" }, opt.head || null,
      cq && (cq.ops || cq.warn.length) ? queryCard(cq) : null,
      cq && cq.fixes.length ? h("p", { class: "tiny qfix" }, cq.fixes.map(([a, b]) => `‘${a}’ 대신 ‘${b}’로 찾았어요. `), h("button", { class: "linkbtn", type: "button", onclick: () => go({ exact: true }) }, "입력한 그대로 찾기")) : null,
      presets.length ? h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, h("span", { class: "sub", style: "align-self:center;flex:none" }, "내 필터"), presets.map((x) => h("span", { class: "chip pchip" },
        h("button", { type: "button", class: "plink", onclick: () => nav(`${x.route}${x.qs ? "?" + x.qs : ""}`) }, x.name),
        h("button", { type: "button", class: "px", "aria-label": `${x.name} 필터 지우기`, onclick: () => { const before = store.get("presets", []); store.set("presets", before.filter((y) => y.id !== x.id)); render(); undoToast(`'${x.name}' 필터를 지웠어요`, () => { store.set("presets", before); render(); }); } }, icon("x", "xs"))))) : null,
      act.length ? h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, act.map(([l, patch]) => h("button", { class: "chip on", type: "button", "aria-label": `${l} 해제`, onclick: () => go(patch) }, l, icon("x", "xs"))),
        h("button", { class: "chip", type: "button", onclick: () => go({ reg: "", area: "", cat: -1, brand: -1, b: -1, kind: -1, sess: "", cond: "", amt: "", att: "", min: "", max: "", fv: "", bun: "", old: "", vu: "", prod: "" }) }, "모두 해제")) : null,
      h("div", { class: "fgrid fbar" }, regSel, condBtn,
        sel("브랜드", "brand", f.brand, [[-1, "전체", null], ...D.meta.brands.map((b, i) => BR.some((x) => x.brand === i) ? [i, b[0], cnt.brand[i] || 0] : null).filter(Boolean)], { b: "" }),
        sel("정렬", "sort", f.sort, SORTS().map(([v, l]) => [v, l, null]), { unit: "" })),
      h("details", { class: "fmore", open: advN > 0 }, h("summary", {}, "상세 필터", advN ? h("span", { class: "k k4" }, `${advN}개 사용 중`) : h("span", { class: "sub" }, "카테고리 · 지점 · 가격 범위")),
        h("div", { class: "fgrid" },
          sel("카테고리", "cat", f.cat, [[-1, "전체", null], ...D.meta.cats.map((c, i) => [i, c, cnt.cat[i] || 0])]),
          sel("지점", "b", f.b, [[-1, "전체", null], ...brs.map((x) => [x.i, bname(x.i), null])]),
          h("div", { class: "flabel wide" }, `가격 범위(원) · 최대 ${won(smax)}까지`, rangeBox, h("div", { class: "sliders" }, minR, maxR), err))),
      facetBox,
      h("div", { class: "row", style: "margin-top:var(--sp-2)" }, whenChip(),
        h("span", { class: "sp" }), curQs ? h("button", { class: "btn sm gray", type: "button", onclick: () => { const np = liveParams(route, params); np.delete("n"); presetSheet(route, np.toString()); } }, "필터 저장") : null)));
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
      notes.push(`단위당 가격은 참고용이에요.${other ? ` 단위가 다른 ${other}개는 빠졌어요.` : ""}${without ? ` 수량이 없거나 패키지(+)인 ${without}개도 빠졌어요.` : ""}`);
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
    const resHead = h("div", { class: "reshead" });
    // a loop, not Math.min(...array): 전국 with no words is ~140k prices — too many arguments for one call (stack overflow)
    let minP = hits.length ? Infinity : 0, maxP = 0;
    for (const i of hits) { const v = ROWS[i][3]; if (v < minP) minP = v; if (v > maxP) maxP = v; }
    // one range only over one spec (hierarchy audit 5 ③): '리쥬란 2cc' gave '53,900원 ~ 4,939,000원' over 1회, 3회 packages and
    // '+ 크라이오셀' bundles — not a price anyone pays. Rows that do not all share a comparison key say so instead
    const oneSpec = !!f.q && hits.length > 0 && !!Stats.sharedKey && Stats.sharedKey((function* () { for (const i of hits) yield (S[ROWS[i][7]] || "").split(" "); })()) != null;
    resHead.append(h("div", { class: "searchstat", role: "status" }, hits.length ? (FLAGS.lowestHighlight ? `가격 ${hits.length.toLocaleString()}개 · 가장 싼 ${won(minP)} (${new Set(hits.filter((i) => ROWS[i][3] === minP).map((i) => ROWS[i][0])).size}개 지점)`
      : `가격 ${hits.length.toLocaleString()}개 · ${f.q ? (oneSpec ? `${Pricing.rangeText(minP, maxP)} · ` : "여러 용량 · ") : ""}${(SORTS().find(([v]) => v === f.sort) || [, ""])[1]}`) : "조건에 맞는 가격이 없어요"));   // no words: a range over every procedure means nothing (E12)
    if (hits.length && f.q && !oneSpec && !FLAGS.lowestHighlight) resHead.append(h("p", { class: "tiny mixstat" }, "용량·횟수가 섞여 있어 범위를 적지 않아요.", opt.mixHint ? ` ${opt.mixHint}` : ""));
    if (unitInfo && unitInfo.units.length > 1) resHead.append(h("div", { class: "chips" }, unitInfo.units.map(([u, n]) => h("button", { class: "chip", type: "button", "aria-pressed": u === unitInfo.unit ? "true" : "false", onclick: () => go({ unit: u, sort: "unit" }) }, `${u === "샷" ? "100샷" : u === "U" ? "10U" : "1" + u}당 · ${n}개`))));
    for (const n of notes) resHead.append(h("p", { class: "tiny" }, n));
    if (hits.length) resHead.append(h("p", { class: "tiny" }, "가격만으로 고르지 마세요. 이름이 같아도 용량·조건·정품 여부·의료진이 다를 수 있어요. 조건·부작용은 각 가격의 ⓘ에서 봐요."));
    if (!hits.length) { const nr = noResults(f, cq, go, route); nr.prepend(resHead); box.append(nr); return box; }
    // the first rows (전체 가격표 100, search 20), then the shared '20개 더 보기 (N개 남음)': rows added in place (what was typed
    // in the boxes above stays), the count kept in the address (?n=) so a later redraw shows as many
    const ul = h("ul", { class: "list" });
    // 지역·이름순 (the default) lists one clinic's prices one after another: the clinic is named once, over its first line
    // (위계 점검 33 · SEARCH-2 — 100 lines repeated 11 names), and its lines say product · price · conditions. Other orders mix
    // the clinics, so each line names its own. The ⓘ at the right opens the price's evidence (47)
    const byClinic = f.sort === "region";
    const more = moreList(ul, hits, (i, n) => { const r = ROWS[i], x = rowPos(i), u = Search.unitPrice(S[r[2]], r[3]);
      const head = byClinic && (n === 0 || ROWS[hits[n - 1]][0] !== r[0]);
      const clinic = (cls) => h("button", { class: cls, type: "button", onclick: () => nav(`branch/${r[0]}`) }, bdot(r[0]), bname(r[0]), cls === "linkbtn sgname" ? icon("chevron-right", "xs") : null);
      return h("li", { class: head ? "rk sgs" : "rk" },
        head ? h("div", { class: "sgh" }, clinic("linkbtn sgname"), dist(r[0]) != null ? h("b", { class: "sgkm" }, km(dist(r[0]))) : null) : null,
        h("div", { class: "item ra" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
        h("span", { class: "m" }, byClinic ? null : clinic("linkbtn"), listS(r),
          r[4] && FLAGS.discountEmphasis ? h("span", { class: "k k4" }, `${Math.round(disc(i) * 100)}%↓`) : null,   // information, not a condition (butter)
          kindBadge(r, { warn: cq ? cq.unstated(normBySid.get(r[2])).map((t) => kwBadge(t, { title: "상품명에 적혀 있지 않아요. 1회로 단정하지 않아요" })) : [] }),
          u ? h("span", { class: "unitp" }, `${u.unit === "샷" ? "100샷" : u.unit === "U" ? "10U" : "1" + u.unit}당 ${won(u.price)}`) : null,
          x && FLAGS.lowestHighlight ? h("span", { class: x.vsMed < -0.005 ? "down" : x.vsMed > 0.005 ? "up" : "" }, `${x.n}곳 중 ${x.rank}위`) : null,
          f.sort === "recent" ? h("span", {}, `확인 ${md(ver(i))}`) : null, !byClinic && dist(r[0]) != null ? h("b", {}, km(dist(r[0]))) : null), rowAddBtn(i)),
        infoBtn(i, `${bname(r[0])} ${S[r[2]]}`)); },
      { first: f.n, name: "가격", onMore: (n) => { const np = liveParams(route, params); if (n === N0) np.delete("n"); else np.set("n", n); const s = np.toString(); history.replaceState(null, "", `#${route}${s ? "?" + s : ""}`); } });
    box.append(h("div", { class: "card flush results" }, resHead, ul, more));
    return box;
  }
  // zero results: offer the nearest searches that do return something
  function noResults(f, cq, go, route = "") {
    const toks = cq && !cq.empty ? cq.raw : [];
    const count = (ff, c) => withGate(ff, () => { let n = 0; for (let i = 0; i < ROWS.length; i++) if (rowPasses(i, ff, c)) n++; return n; });
    const reQ = (q) => route.startsWith("search/") ? nav(`search/${encodeURIComponent(q)}?nl=0`, true) : go({ q });
    const bare = { ...f, cat: -1, brand: -1, b: -1, kind: -1, sess: "", cond: "", amt: "", min: 0, max: 0, area: "", reg: "전국" };
    const tips = [];
    const hasF = f.cat >= 0 || f.brand >= 0 || f.b >= 0 || f.kind >= 0 || f.sess || f.cond || f.amt || f.min || f.max || f.area || f.reg;
    if (hasF) { const n = count(bare, cq); if (n) tips.push([`필터 모두 빼고 찾기 (${n.toLocaleString()}개)`, () => go({ reg: "전국", area: "", cat: -1, brand: -1, b: -1, kind: -1, sess: "", cond: "", amt: "", min: "", max: "" })]); }
    if (!f.reg || f.reg !== "전국") { const n = count({ ...f, reg: "전국" }, cq); if (n) tips.push([`전국에서 찾기 (${n.toLocaleString()}개)`, () => go({ reg: "전국" })]); }
    if (toks.length > 1) toks.forEach((tk, j) => { const rest = toks.filter((_, k) => k !== j).join(" "); const n = count(f, Search.compile(rest, searchIndex())); if (n) tips.push([`‘${tk}’ 빼고 찾기 (${n.toLocaleString()}개)`, () => reQ(rest)]); });
    if (toks.length) for (const s of Search.suggest(toks.find((t) => !/^[-−]|\||\?$/.test(t)) || "", searchIndex(), suggestTerms(), 3)) tips.push([`‘${s}’ 찾기`, () => nav(`search/${encodeURIComponent(s)}`)]);
    return h("div", { class: "card" }, jomiEmpty("empty", jline("emptySearch") || "찾지 못했어요", "이 조건으로는 가격이 없어요."),
      tips.length ? h("div", {}, h("div", { class: "sub", style: "margin-bottom:var(--sp-2)" }, "이렇게 찾아보면 있어요"), h("div", { class: "chips wrapc" }, tips.slice(0, 6).map(([l, fn]) => h("button", { class: "chip", type: "button", onclick: fn }, l))))
        : h("div", { class: "sub" }, "짧게 써 보세요(예: 슈링크)."));
  }
  function presetSheet(route, qs) {
    sheet("필터 저장", (close) => {
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
      return h("div", {}, h("div", { class: "sub" }, "지금 고른 검색어·필터·정렬을 이름 붙여 저장해요(최대 10개, 이 휴대폰)."), h("label", { class: "flabel" }, "이름", name), err,
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:var(--sp-3)", onclick: save }, "저장"));
    });
  }
  views.table = (arg, params) => {
    const box = h("div", { class: "view" });
    box.append(cmpNav("table"));
    const q = h("input", { type: "search", value: params.get("q") || "", placeholder: "이름에 들어간 말 (예: 리쥬란 2cc, rejuran)", "aria-label": "가격 검색", enterkeyhint: "search" });
    const run = (v) => { const np = liveParams("table", params); if (v) np.set("q", v); else np.delete("q"); np.delete("exact"); np.delete("n"); nav(`table?${np}`, true); };
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") run(q.value.trim()); });
    box.append(priceTable("table", params, { head: [h("h2", {}, "전체 가격표"), h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, `모든 가격 · ${regionName()} · ${vatNote()}`),
      searchBox(withSuggest(q, run), { inset: true, style: "margin-top:var(--sp-2)" }), searchTips(run)] }));
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
      const body = () => [`지점: ${bname(r[0])}`, `상품: ${S[r[2]]}`, `앱 표시: ${won(r[3])} (${st.vat === "incl" ? "부가세 포함가" : "병원 표시가"}, 병원 표시 ${won(r[14])})`,
        `사유: ${s.why}`, note.value.trim() ? `메모: ${note.value.trim()}` : "", `출처: ${S[r[11]] || "-"}`, `가격 확인일: ${verified(r[0])} · 앱 데이터 ${D.meta.updated}`].filter(Boolean).join("\n");
      const keep = (via) => { const list = store.get("reports", []); list.unshift({ at: today(), n: S[r[2]], br: bkey(r[0]), why: s.why, via, url: S[r[11]] || "" }); store.set("reports", list.slice(0, 50)); };
      const paint = () => fill(box,
        h("div", { class: "sub" }, `${bname(r[0])} · ${S[r[2]]} · ${won(r[3])}`),
        h("div", { class: "opts", style: "margin-top:var(--sp-2)" }, reasons.map((x) => h("button", { class: "opt", type: "button", "aria-pressed": s.why === x ? "true" : "false", onclick: () => { s.why = x; paint(); } }, h("b", {}, x)))),
        h("label", { class: "flabel" }, "메모 (선택)", note),
        h("dl", { class: "kv", style: "margin-top:var(--sp-2)" }, h("dt", {}, "원본 주소"), h("dd", {}, S[r[11]] ? h("a", { href: S[r[11]], target: "_blank", rel: "noopener noreferrer" }, S[r[11]].replace(/^https?:\/\//, "").slice(0, 60), icon("external-link", "xs")) : "원본 링크 없음"),
          h("dt", {}, "보낼 내용"), h("dd", {}, "지점·상품·앱 표시가·사유·메모·원본 주소·확인일")),
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "지금은 시연 단계라 윤실장 서버가 없어요. 실제로 운영자에게 닿는 건 'GitHub로 신고'(공개 글)뿐이에요."),
        h("div", { class: "sub warnline", style: "margin-top:var(--sp-2)" }, icon("triangle-alert", "xs"), "GitHub 신고는 누구나 볼 수 있는 공개 글이에요. 메모에 이름·연락처 같은 개인정보를 적지 마세요."),
        h("div", { class: "row", style: "margin-top:var(--sp-3);flex-wrap:wrap" },
          h("button", { class: "btn gray", type: "button", onclick: () => { keep("demo"); close(); toast("이 휴대폰에만 저장했어요 — 서버로 보내지 않았어요(시연)"); } }, "기기에만 저장(시연)"),
          h("button", { class: "btn gray", type: "button", onclick: () => { keep("copy"); copyText(body(), "신고 내용을 복사했어요 — 직접 보내 주세요"); close(); } }, "내용 복사"),
          h("a", { class: "btn", style: "flex:1;text-align:center;text-decoration:none", target: "_blank", rel: "noopener",
            href: `https://github.com/lsy2825/skin/issues/new?${new URLSearchParams({ title: `[가격 신고] ${bname(r[0])} ${S[r[2]]}`.slice(0, 120), body: body(), labels: "price-report" })}`,
            onclick: () => { keep("github"); setTimeout(close, 100); const t = jline("reported"); if (t) setTimeout(() => jomiToast("happy", t), 150); } }, "GitHub로 신고(실제 접수)")),
        h("p", { class: "tiny", style: "margin-top:var(--sp-2)" }, "GitHub 화면이 열리면 거기서 '제출'을 눌러야 접수돼요. 보낸 내역은 관심 탭 '가격 확인 요청'에 상태와 함께 남아요."));
      paint();
      return box;
    });
  }

  // 운영 현황 (#ops) lives in screens/ops.js (docs/APP_JS_SPLIT_PLAN.md 3-1)

  // 데이터 안내 (#about·#data)·운영 원칙 (#principles)·처리방침 (#privacy)·시술 사전 (#guide)·쉬운 용어 (#terms) live in
  // screens/about.js (docs/APP_JS_SPLIT_PLAN.md 3-2); the helpers other screens use stay here (recheckQueue, coverageLine, privacyParts …)
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
  // what the data covers, in one line (round-2 UX01/DATA): chains, branches, the collection date — so nobody reads '전국 최저가'
  const coverageBrands = () => (D.meta.brands || []).filter((b, i) => BR.some((x) => x.brand === i)).map((b) => b[0]).join("·");
  function coverageLine() {
    const br = (D.meta.brands || []).map((b, i) => [b[0], BR.filter((x) => x.brand === i).length]).filter((x) => x[1] > 0);
    return `${br.length}개 체인 ${BR.length}곳의 공개 가격 · ${md(D.meta.updated)} 수집`;
  }
  // 개인정보 처리방침 (C6): the sentences are chat C's (docs/legal/PRIVACY_POLICY_DRAFT.md §3, promise 6) and go in as written —
  // tests/e2e/privacy.js reads the doc and compares. Only the parts that are set up: §3-1 while 익명 집계 is (metrics.available,
  // the same test as its 내 설정 row), §3-2 while 푸시 is (PUSH). §3-3 waits for the lawyer (§5-2). Neither set up (as
  // shipped): no view, no way in — #privacy typed by hand is the 마이 screen (router).
  const PRIVACY = [
    { on: () => metrics.available, title: "윤실장이 어떻게 쓰이는지 세기", paras: [
      "앱이 잘 쓰이는지 보려고 '앱을 열었다', '가격을 봤다', '담았다', '일주일 안에 다시 왔다' 같은 단계 이름을 보내요. 같은 단계는 하루 한 번만 보내도록 휴대폰(브라우저)에 기록을 남기지만, 서버는 누가 보냈는지 읽거나 남기지 않아요. 그래서 시크릿 창이나 다른 브라우저에서 쓸 때, 앱 데이터를 지운 뒤, 저장 공간이 막히거나 가득 찬 휴대폰, 휴대폰 시계를 바꾼 때에는 같은 날 다시 셀 수 있어요. 이름·계정·기기 번호·쿠키·검색어·가격·위치는 보내지 않고, 서버에는 날짜별·단계별 횟수만 남아요. 외부 분석 회사에는 보내지 않아요.",
      "이 횟수는 누구의 것인지 알 수 없는 합계라서, 통계 목적으로 보관해요. 집계를 받는 서버는 한국 밖(주로 아시아·태평양 지역)의 Cloudflare 서버예요.",
      "처음에는 켜져 있고, 마이 → 내 설정의 '익명 이용 집계 보내기'에서 끌 수 있어요. 끄면 이 브라우저에서는 보내지 않아요. 시크릿 창이나 다른 브라우저에서 쓰거나 앱 데이터를 지우면 다시 켜진 상태가 되니, 그때는 다시 꺼 주세요. 휴대폰에는 마지막으로 집계를 보낸 날짜와 그날 보낸 단계 이름만 남아요(하루 한 번만 보내고, 일주일 안에 다시 왔는지 휴대폰에서 판단하기 위해서예요)."] },
    { on: () => PUSH, title: "관심 시술 가격 알림(푸시)", paras: [
      "알림을 켜면 ① 브라우저가 만든 알림 주소와 ② 어떤 시술을 어떤 조건(목표가·지역)으로 지켜볼지, ③ 알림을 마지막으로 보낸 날 같은 전달 기록이 윤실장 서버에 저장돼요. 이름·연락처·위치·장바구니는 저장하지 않아요.",
      "알림은 새 가격을 모은 뒤 보통 주 1회 묶어서 보내고, 행사 마감이 임박한 알림만 따로 보내요. 오전 8시~오후 9시 사이에만 보내요.",
      "알림 자체에는 내용이 없어서, 알림을 전달하는 브라우저 회사(Google·Apple 등)는 어떤 시술인지 알 수 없어요. 알림 주소와 조건을 저장하는 서버는 한국 밖(주로 아시아·태평양 지역)의 Cloudflare 서버예요. 광고 알림은 보내지 않아요.",
      "알림 주소와 조건은 알림에 쓰는 동안만 두고, 다음 때 바로 지워요: 앱에서 알림을 끌 때, 가격 알림을 모두 지웠을 때(되돌리기 시간이 지나면), 앱을 열었는데 휴대폰 알림 권한이 꺼져 있거나 알림 구독이 사라졌을 때, 알림 서비스가 이 휴대폰에 더는 전달할 수 없다고 알려 올 때, 전달이 계속 실패할 때."] },
  ];
  function privacyParts() { return PRIVACY.filter((x) => x.on()); }
  // the way in under 내 설정's 집계 row and the 관심 tab's push panel (each drawn only while its part is set up)
  function privacyLink() { return h("button", { class: "linkbtn", type: "button", onclick: () => nav("privacy") }, "처리방침 보기", icon("chevron-right", "xs")); }

  // 비교 tab sub-navigation: 시술별 / 지점 순위 / 지점 비교 / 전체 가격표 — a light underlined tab row in the same place on the
  // four screens, lighter than the path under it (위계 점검 40: the white pill on a filled track read before the path)
  const cmpNav = (cur) => h("div", { class: "subnav", role: "tablist" }, [["compare", "시술별"], FLAGS.branchRanking ? ["rank", "지점 순위"] : null, ["versus", "지점 비교"], ["table", "전체 가격표"]].filter(Boolean).map(([v, l]) =>
    h("button", { type: "button", role: "tab", "aria-selected": cur === v ? "true" : "false", onclick: () => nav(v) }, l)));
  // the chosen procedure lives in the URL (#compare?k=X12): change both, or the old ?k= wins on the next render
  function pickKey(i) { st.key = i; history.replaceState(null, "", `#compare?k=${KEYS[i].id}`); render(); }
  // how the compare numbers are computed, with the real counts of this view
  function basisSheet(k, rk, plain) {
    const rkc = cmpRk(rk), ps = rkc.map((x) => x.p), med = median(ps);   // same set as the header when no plain price exists
    sheet("가격 계산 기준", () => h("div", {}, h("dl", { class: "facts" },
      h("div", { class: "fact" }, h("dt", {}, "같은 시술"), h("dd", {}, `'${k.label}' — 용량·샷 수·횟수·원산지·부위가 같은 가격만 묶었어요. 패키지와 추가 옵션은 빠져요.`)),
      h("div", { class: "fact" }, h("dt", {}, "비교한 지점"), h("dd", {}, `${regionName()} ${rk.length}곳 · 지점마다 가장 싼 가격 하나씩${st.special ? " (체험가·한정가 등 특가 포함)" : " (일반가만)"}`)),
      h("div", { class: "fact" }, h("dt", {}, "중간 가격"), h("dd", {}, plain.length
        ? `${won(median(plain.map((x) => x.p)))} — 일반가 ${plain.length}곳을 지점마다 가장 싼 값으로 줄 세운 가운데 값이에요. 특가까지 넣으면 ${rk.length}곳 ${won(med)}이에요.`
        : `${won(med)} — ${rkc.length}곳을 지점마다 가장 싼 값(특가 포함, 추가 옵션·부가세 미확인 제외)으로 줄 세운 가운데 값이에요.`, FLAGS.discountEmphasis ? " '중간보다 N% 싸요'는 (중간 가격 − 가격) ÷ 중간 가격이에요." : null)),
      h("div", { class: "fact" }, h("dt", {}, "일반가"), h("dd", {}, `${plain.length}곳 — 특가 조건이 없고, 이번 주 확인된 지점의 가격만이에요.`)),
      h("div", { class: "fact" }, h("dt", {}, "빼는 가격"), h("dd", {}, "끝난 이벤트, 급변해 확인 중인 가격, 고른 방문일에 안 되는 가격은 계산에서 빼요. 이번 주 못 읽은 지점은 일반가에서 빼요.")),
      h("div", { class: "fact" }, h("dt", {}, "초저가 표시"), h("dd", {}, `중간 가격의 ${Math.round(LOW_SHARE * 100)}% 이하면 '초저가·조건 확인'을 붙여요. 1~2곳만 그 값이면 확인 전까지 범위에서 빼고 따로 보여줘요(여러 지점이 같은 값이면 그 체인의 보통 가격으로 봐요).`)))));
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
  const kbOf = (f) => { const e = (f && kbFind.of(f)) || null; return kbVisible(e) ? e : null; };
  const MAIN_TYPES = { toxin: ["주름 보톡스", "사각턱 보톡스", "스킨보톡스", "다한증 보톡스", "바디 보톡스"], filler: ["코 필러", "턱끝 필러", "애교 필러", "눈밑 필러", "입술 필러"],
    lifting: ["슈링크 유니버스", "울쎄라", "써마지 FLX", "인모드", "올리지오"], toning: ["레이저토닝", "피코토닝", "제네시스", "착색토닝"] };
  const DISCLAIM = "일반적인 설명이에요. 진단이나 효과 보장이 아니고 특정 시술을 권하지 않아요. 나에게 맞는지는 의료진과 상담하세요.";
  const KB_REPO = "https://github.com/lsy2825/skin";
  // only a reviewed text gets a mark; a draft gets no red badge per procedure (audit U8) — the gray line under the text
  // (kbFoot) says it once
  const reviewed = (e) => !!e && (e.review || {}).status === "approved";
  const reviewBadge = (e) => { const r = e.review || {};
    return reviewed(e) ? h("span", { class: "k k1", title: `${r.reviewer} · ${r.reviewed_at}` }, `✓ ${(KB.statuses || {})[r.status] || r.status}`) : null; };
  const evidenceBadge = (e) => e.sources.length ? h("span", { class: "k k4", title: "근거 문서의 종류예요(효과의 크기를 뜻하지 않아요)" },
    `근거: ${(KB.evidence_levels || {})[e.evidence_level] || "출처"} ${e.sources.length}개`) : null;
  const kbFoot = (e) => h("p", { class: "tiny" }, `${reviewed(e) ? "" : "시술 설명은 의료진 검수 전이에요. "}${DISCLAIM}`);
  // short card on the compare tab: one line + purpose + how it differs, review state, quick view
  // compact: on top of the compare screen right under the picker — the one-liner shows, the rest folds
  // hospitals' own words from product names (f.desc: '카톡플친 적용가' …) are promotion, not an explanation: not shown
  // (audit U5, E1). Without a knowledge entry there is no box.
  function guideBox(f, compact = false) {
    const e = kbOf(f);
    if (!e) return null;
    if (compact) return h("div", { class: "guide gtop" },
      h("div", { class: "row", style: "flex-wrap:nowrap" }, h("b", {}, `${f.name}, 뭐예요?`), h("span", { class: "sp" }),
        e ? hereLink("info", "자세히", () => kbSheet(e, f)) : null),
      h("p", {}, `${e.one_liner} ${e.purpose}`),
      e.method ? h("details", { class: "fold small" }, h("summary", {}, "더 보기 · 방식·검수 상태"),
        h("p", { class: "sub" }, e.method),
        h("div", { class: "row", style: "gap:var(--sp-1);margin-top:var(--sp-2)" }, reviewBadge(e), evidenceBadge(e)),
        h("button", { class: "linkbtn", type: "button", style: "margin-top:var(--sp-2)", onclick: () => nav(`guide?c=${encodeURIComponent(f.cat)}`) }, "시술 사전", icon("chevron-right", "xs"))) : null,
      e ? kbFoot(e) : h("p", { class: "tiny" }, "병원이 상품 이름에 적은 설명이에요."));
    return h("div", { class: "guide" },
      h("div", { class: "row", style: "flex-wrap:nowrap" }, h("b", {}, `${f.name}, 뭐예요?`), h("span", { class: "sp" }),
        e ? hereLink("info", "자세히", () => kbSheet(e, f)) : null,
        h("button", { class: "linkbtn", type: "button", onclick: () => nav(`guide?c=${encodeURIComponent(f.cat)}`) }, "시술 사전", icon("chevron-right", "xs"))),
      e ? h("p", {}, `${e.one_liner} ${e.purpose}`) : null,
      e && e.method ? h("p", { class: "sub" }, e.method) : null,
      e ? h("div", { class: "row", style: "gap:var(--sp-1);margin-top:var(--sp-2)" }, reviewBadge(e), evidenceBadge(e)) : null,
      e ? kbFoot(e) : h("p", { class: "tiny" }, "병원이 상품 이름에 적은 설명이에요."));
  }
  // what to check together with a price (docs/OBJECTIVE_DISPLAY_POLICY.md): the exact condition, genuine-product claims
  // (only what clinics wrote — the app does not verify devices or drugs), who treats (not collected), side effects, cautions
  // list row → the same clinic's dot in the distribution chart (and the chart's slider marks the row, see distChart)
  const dotHl = (b) => document.querySelectorAll(".lcsvg circle.dot").forEach((c) => c.classList.toggle("hl", b != null && +c.getAttribute("data-b") === b));
  function checkCard(k, fam, rk) {
    const e = fam ? kbOf(fam.f) : null;
    const genuine = rk.filter((x) => /정품/.test(S[ROWS[x.i][2]])).length;
    // the icon sits in the title line instead of its own 32px column, so the sentences get the card's full width (hierarchy
    // audit 17, L5: every word stays — folding any of it waits for chat C's answer on '함께 명시')
    const row = (ic, t, ...v) => h("div", { class: "chk" }, h("div", { class: "chk-b" }, h("b", {}, icon(ic, "xs"), t), h("div", { class: "sub" }, ...v)));
    return h("section", { class: "card checks", "aria-label": "가격과 함께 확인할 것" },
      h("div", { class: "row" }, h("h3", {}, "가격과 함께 꼭 확인하세요"), h("span", { class: "sp" }), e ? reviewBadge(e) : null),
      h("div", { class: "chks" },
        row("layers", "시술 조건", "1회 가격 · 용량·샷 수·횟수가 같은 것끼리 묶었어요. 지점마다 구성은 '가격 정보'에서 봐요."),
        row("badge-check", "장비·약제 정품 여부", genuine ? `${rk.length}곳 중 ${genuine}곳이 상품명에 '정품'이라고 적었어요(앱이 확인한 건 아니에요).`
          : "상품명에 정품 표기가 없어요. 앱은 확인하지 않으니 상담 때 물어보세요."),
        row("user", "시술 의료진", "앱은 의료진 정보를 모으지 않아요. 누가 시술하는지 병원에 확인하세요."),
        row("triangle-alert", "주요 부작용", e && e.side_effects.length ? h("ul", { class: "plain" }, e.side_effects.slice(0, 4).map((x) => h("li", {}, x))) : "정리된 설명이 아직 없어요. 상담 때 꼭 물어보세요."),
        e && e.cautions.length ? row("info", "주의사항", h("ul", { class: "plain" }, e.cautions.slice(0, 3).map((x) => h("li", {}, x)))) : null),
      e ? hereLink("info", "부작용·주의사항·근거 자세히", () => kbSheet(e, fam.f), { style: "margin-top:var(--sp-3)" }) : null,
      h("p", { class: "tiny" }, `${e ? `${DISCLAIM} ${KB_STATE()} ` : ""}가격이 낮다는 것만으로 고르지 마세요.`));
  }
  // quick view: everything the knowledge base has for one treatment
  function kbSheet(e, f) {
    f = f || FAM.find((x) => kbOf(x) === e);
    const sec = (t, body) => body && (!Array.isArray(body) || body.length) ? h("div", { class: "fact" }, h("dt", {}, t), h("dd", {}, Array.isArray(body) ? h("ul", { class: "notes" }, body.map((x) => h("li", {}, x))) : body)) : null;
    const issue = `${KB_REPO}/issues/new?${new URLSearchParams({ template: "knowledge-review.md", title: `[검수] ${e.id} ${e.title}`, labels: "knowledge-review", body: `항목 id: ${e.id}\n\n고칠 내용:\n\n근거:\n` })}`;
    sheet(e.title, (close) => h("div", {},
      h("div", { class: "row", style: "gap:var(--sp-1)" }, reviewBadge(e), evidenceBadge(e), e.updated ? h("span", { class: "sub" }, `수정 ${e.updated}`) : null),
      h("p", { class: "fw-bold", style: "margin:var(--sp-2) 0 0;line-height:1.5" }, e.one_liner),
      h("dl", { class: "facts" },
        sec("주로 받는 이유", e.purpose), sec("사용 부위", e.areas), sec("시술 방식·비슷한 시술과 차이", e.method), sec("관련 브랜드·종류", e.kinds),
        sec("주요 부작용", e.side_effects), sec("주의사항", e.cautions),
        h("div", { class: "fact" }, h("dt", {}, "근거와 검수"), h("dd", {},
          e.sources.length ? h("ul", { class: "notes" }, e.sources.map((x) => h("li", {}, h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.title), ` — ${x.publisher} · ${x.checked} 확인 (${x.how})`))) : null,
          h("p", { class: "sub", style: "margin:var(--sp-2) 0 0" }, e.evidence_note || ""),
          h("p", { class: "sub", style: "margin:var(--sp-2) 0 0" }, e.review.status === "approved" ? `검수: ${e.review.reviewer} · ${e.review.reviewed_at}` : "의료진 검수 전 초안이에요. 틀린 곳이 있으면 알려 주세요.")))),
      h("p", { class: "tiny" }, DISCLAIM),
      h("div", { class: "row", style: "margin-top:var(--sp-3)" },
        f ? h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => { close(); nav(`compare?k=${KEYS[f.main].id}`); } }, `${f.name} 가격 비교`) : null,
        h("a", { class: "btn gray", href: issue, target: "_blank", rel: "noopener", style: "text-decoration:none" }, "검수 의견 보내기"))));
  }
  // type a name → matching families anywhere (all categories)
  function famFinder() {
    const inp = h("input", { type: "search", placeholder: "다른 시술 찾기 (예: 리쥬란, 겨드랑이 제모)", "aria-label": "비교할 시술 찾기" });
    const out = h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" });
    let tm = 0;
    inp.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => { const r = famFind(inp.value);
      fill(out, inp.value.trim() && !r.length ? h("span", { class: "sub" }, "맞는 시술이 없어요. 짧게 써 보세요.") : null,
        r.slice(0, 12).map((f) => h("button", { class: "chip", type: "button", onclick: () => pickKey(f.main) }, `${f.name} · ${f.n}곳`))); }, 120); });
    return h("div", {}, searchBox(inp, { inset: true, style: "margin-top:var(--sp-2)" }), out);
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
      h("div", { class: "vchips scroll", role: "radiogroup", "aria-label": title }, vals.map((v) => h("button", { class: "chip", type: "button", role: "radio", "aria-checked": v === cur ? "true" : "false",
        onclick: () => onPick(v) }, show(v)))));
    const kinds = uniq(vs.map((x) => x.kind));
    const inKind = vs.filter((x) => x.kind === me.kind), amts = uniq(inKind.map((x) => x.amt));
    const inAmt = inKind.filter((x) => x.amt === me.amt), sesss = uniq(inAmt.map((x) => x.sess)).sort((a, b) => a - b);
    let n = 0;
    const s1 = step(kinds.length > 1 ? ++n : n, "종류", kinds, me.kind, (v) => v, (v) => pick({ ...me, kind: v, fix: ["kind"] }));
    const s2 = step(amts.length > 1 ? ++n : n, "용량·부위", amts, me.amt, (v) => v, (v) => pick({ ...me, amt: v, fix: ["kind", "amt"] }));
    const s3 = step(sesss.length > 1 ? ++n : n, "횟수", sesss, me.sess, (v) => (v === 1 ? "1회" : `${v}회 묶음`), (v) => pick({ ...me, sess: v, fix: ["kind", "amt", "sess"] }));
    return h("div", { class: "vsteps" }, s1, s2, s3, !s1 && !s2 && !s3 ? h("div", { class: "sub" }, "고를 옵션이 하나뿐이에요.") : null,
      h("p", { class: "tiny", style: "margin:var(--sp-2) 0 0" }, `전국 ${byKB[cur].size}곳에서 팔아요`));
  }
  // 규격 낱말 뜻 (data.json meta.kb.specs, C7): the chosen spec's words ('국산', '사각턱' …), one plain line each, at most 3.
  // Keyed by (family id, word) — Spec.notesFor; the words stand in the variant label and the family name ('스킨보톡스' → '스킨',
  // Spec.famWords). Drafts follow the knowledge-base rule (kbVisible: only while flags.showDraftKnowledge is on) and always
  // say '의료진 검수 전'. Data without meta.kb.specs (before C7): no box. fm: famOf[k]
  function specNotes(fm) {
    if (!fm || !Array.isArray(KB.specs) || !KB.specs.length) return null;
    const glued = Spec.famWords(fm.f.name, FAM.filter((x) => x.fid && x.fid === fm.f.fid).map((x) => x.name));
    const ns = Spec.notesFor(KB.specs, fm.f.fid, [fm.label, fm.f.name, glued], { drafts: FLAGS.showDraftKnowledge, max: 3 });
    if (!ns.length) return null;
    const all = ns.every((n) => n.draft);
    return h("div", { class: "specnotes", role: "note", "aria-label": "낱말 뜻" },
      h("ul", {}, ns.map((n) => h("li", {}, h("b", {}, n.spec), ` ${n.text}`, n.draft && !all ? h("span", { class: "k k4" }, "의료진 검수 전") : null))),
      h("p", { class: "tiny" }, `낱말 뜻만 적었어요${all ? "(의료진 검수 전)" : ""}.`));
  }
  function variantRows(groups, cur, scroll) {
    return h("div", { class: "vrows" }, groups.map(([g, xs]) => h("div", { class: "vrow" }, h("span", { class: "vg" }, g),
      h("div", { class: scroll ? "vchips scroll" : "vchips" }, xs.map(({ v, amt }) => { const rr = cmpRk(ranking(v.k, "price"));
        return h("button", { class: "opt", type: "button", "aria-pressed": v.k === cur ? "true" : "false", "aria-label": `${g} ${amt}${rr.length ? ` 최저 ${won(rr[0].p)}` : ""}`,
          onclick: () => pickKey(v.k) }, h("b", {}, amt), h("span", { class: "num" }, rr.length ? won(rr[0].p) : "없음")); })))));
  }
  // 시술 사전 (#guide) lives in screens/about.js (docs/APP_JS_SPLIT_PLAN.md 3-2)
  // 피부 고민으로 찾기 · 죠미와 대화 (#concern) live in screens/concern.js (docs/APP_JS_SPLIT_PLAN.md 3-3). The chat's reading
  // context stays here: 홈's box (routeQuery, specRoute) reads with it too.
  let chatCtxFor = null, chatCtxMemo = null;
  function chatCtx() {
    if (chatCtxMemo && chatCtxFor === D) return chatCtxMemo;
    const nl = nlCtx(), BRANDS = D.meta.brands.map((b) => b[0]);
    // one lowest live price per branch; a place or brand named in the message replaces the screen's filter for this answer
    const price = (id, w = {}) => {
      const k = KI[id], ps = [];
      if (k == null) return { n: 0 };
      for (const b of byKB[k].keys()) {
        if (w.brand ? BRANDS[BR[b].brand] !== w.brand : !brandOn(b)) continue;
        if (w.region ? !regOk(b, w.region) : !w.area && !regionOk(b)) continue;
        if (w.area && !areaOk(b, w.area)) continue;
        const i = bestAt(k, b);
        if (i >= 0) ps.push(ROWS[i][3]);
      }
      return JomiChat.summary(ps);
    };
    chatCtxMemo = JomiChat.ctx({ fams: FAM.map((f) => ({ name: f.name, cat: f.cat, fid: f.fid, desc: f.desc, n: f.n, src: f, keys: f.vs.map((v) => ({ id: KEYS[v.k].id, label: KEYS[v.k].label })) })),
      brands: nl.brands, sido: nl.sido, areas: nl.areas, concerns: CONC.concerns.length ? CONC : null, kbOf: (f) => kbOf(f.src), price });
    chatCtxFor = D;
    return chatCtxMemo;
  }
  let lastHero = null;   // {k, p}: the headline price animates when a setting changes it for the same treatment
  // ---- brand overview for one comparison key (same dose · sessions · origin): rk = ranking(k) rows of the branches in view
  function brandCard(k, per) {
    const HLb = FLAGS.lowestHighlight;
    const list = HLb ? [...per].sort((p, q) => p.xs[0].p - q.xs[0].p) : per;
    return h("div", { class: "card bcard" }, h("div", { class: "row" }, h("h3", {}, HLb ? "브랜드별 최저가" : "브랜드별 비교"), h("span", { class: "sp" }), h("span", { class: "sub" }, `${per.length}개 브랜드`)),
      h("div", { class: "sub" }, "지점마다 가장 싼 가격 하나 · 지점 수가 다르면 바로 견주기 어려워요."),
      h("div", { class: "tiles" }, list.map((y, n, arr) => {
        const f0 = y.xs[0], fl = y.xs[y.xs.length - 1], ps = y.xs.map((x) => x.p), cond = y.xs.filter((x) => !plainOk(x.i)).length;
        const last = y.xs.map((x) => verified(x.b)).sort().pop();
        return h("button", { class: "tile tbtn", type: "button", "aria-haspopup": "dialog", onclick: () => brandSheet(k, y) },
          h("span", { class: "k row" }, h("span", { class: "bdot", style: `background:${D.meta.brands[y.bi][1]}` }), D.meta.brands[y.bi][0], y.xs.length < 3 ? h("span", { class: "k k4" }, "지점 적음") : null),
          HLb ? [h("b", { class: "num" }, won(f0.p)), h("span", { class: "w" }, `${BR[f0.b].name}${n ? ` · +${won(f0.p - arr[0].xs[0].p)}` : " · 브랜드 중 최저"}`)]
            : h("b", { class: "num" }, rangeEl(f0.p, fl.p)),
          h("span", { class: "w" }, `${y.xs.length}곳 · 중간 ${won(median(ps))}`),
          h("span", { class: "w" }, `${cond ? `특가 ${cond}곳 · ` : "모두 일반가 · "}${last ? `확인 ${md(last)}` : "확인일 없음"}`));
      })));
  }
  function brandSheet(k, y) {
    const name = D.meta.brands[y.bi][0];
    const xs = FLAGS.lowestHighlight ? y.xs : [...y.xs].sort((a, b) => regionCmp(a.b, b.b) || BR[a.b].name.localeCompare(BR[b.b].name, "ko"));
    sheet(`${name} · ${k.label}`, (close) => h("div", {},
      h("div", { class: "sub" }, `${xs.length}곳 · ${regionName()} · 지점마다 가장 싼 가격 하나 · ${FLAGS.lowestHighlight ? "낮은 가격순" : "지역·이름순"}`),
      h("ul", { class: "list", style: "margin-top:var(--sp-2)" }, xs.map((x) => h("li", {}, h("div", { class: "item" },
        h("span", { class: "t row" }, bdot(x.b), bname(x.b)), h("span", { class: "p num" }, won(x.p)),
        h("span", { class: "m" }, S[ROWS[x.i][2]], kindBadge(ROWS[x.i]), h("span", {}, `확인 ${md(verified(x.b))}`), h("span", { class: "sp" }),
          h("button", { class: "linkbtn", type: "button", onclick: () => { close(); priceSheet(x.i); } }, icon("info", "xs"), "가격 정보"),
          goLink("지점", () => { close(); nav(`branch/${x.b}`); }))))))));
  }
  // price classes (docs/PRICING_ENGINE_QA.md §2): what kind of price a row is, from the clinic's own kind / tags
  const PCLS = [["regular", "일반가"], ["event", "체험가·한정가"], ["cond", "첫 방문·요일·시간"], ["posted", "고시가(정가표)"]];
  const priceClass = (r) => r[5] === 4 ? "posted" : r[5] === 1 || r[5] === 2 ? "event" : condOf(r) ? "cond" : r[5] === 3 ? "pass" : "regular";
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
    const lo = Math.min(...rows.map((x) => x.v[0])), hi = Math.max(...rows.map((x) => x.v[x.v.length - 1]));
    return h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "가격 종류별 범위"), h("span", { class: "sp" }), h("span", { class: "sub" }, regionName())),
      h("div", { class: "sub" }, "지점마다 종류별 가장 싼 가격이에요. 점 아래 숫자는 중간 가격이에요."),
      h("div", { class: "pcls", role: "list" }, rows.map((x) => { const L = axisLine(x.l, null, x.v.length, x.v[0], x.v[x.v.length - 1], median(x.v), [lo, hi]);
        return h("div", { class: "pcl", role: "listitem", "aria-label": L.name }, L.kids); })),
      axisEnds(lo, hi));
  }
  // one line of a card whose bars share one scale (가격 종류별 범위 · 지역별 가격 — one look for both): the name (and a badge),
  // 'N곳 · lo~hi원' on the right, then the range bar on the card's scale with '중간값 X원' under its dot. The ends are in
  // words on every line, so the light track is never the only sign of the range (2026-10-20 review: 지역별 had no ends in
  // words, its range only a 1.3:1 track). The line's own name says it all aloud; the bar is hidden from a screen reader.
  // → { name: the line's aria-label, kids: its children }
  function axisLine(name, badge, n, lo, hi, med, axis) {
    return { name: `${name} ${n}곳, ${lo === hi ? won(lo) : `${won(lo)}부터 ${won(hi)}까지`}, 중간 가격 ${won(med)}${badge ? `, ${badge.textContent}` : ""}`,
      kids: [h("div", { class: "row" }, h("b", {}, name), badge, h("span", { class: "sp" }), h("span", { class: "rv num" }, `${n}곳 · ${Pricing.rangeText(lo, hi)}`)),
        rangeBar(lo, hi, med, { axis, label: true, hidden: true })] };
  }
  // the shared scale's two ends, under its lines
  const axisEnds = (lo, hi) => h("div", { class: "row tiny", style: "margin-top:var(--sp-2)" }, h("span", {}, won(lo)), h("span", { class: "sp" }), h("span", {}, won(hi)));
  // a group whose rows name different products / devices (or some name none): say so above the price, and let the list be
  // narrowed to one (docs/TREATMENT_TAXONOMY.md §4 — e.g. '(여) 겨드랑이 제모 1회' across 아포지 플러스·클라리티Ⅱ·젠틀맥스)
  function mixNote(k) {
    const m = mixFor(k), named = [...m.named.keys()];
    if (!isMixed(m)) return null;
    // one line that opens: the price range right under it stays on the first screen (2026-10-15 audit)
    return h("details", { class: "note mixnote" }, h("summary", {}, icon("info", "sm"), m.mixed ? ` 제품·장비가 서로 다른 가격이 섞여 있어요(${named.length}종${m.none ? "·표기 없음" : ""})` : " 제품 표기가 섞여 있어요"), h("span", {},
      m.mixed ? `제품·장비가 서로 다른 가격이 함께 있어요: ${named.slice(0, 4).join(" · ")}${named.length > 4 ? " …" : ""}${m.none ? " · 표기 없음" : ""}. 제품이 다르면 효과·통증·유지 기간이 다를 수 있어요. 아래 목록에서 제품별로 볼 수 있어요.`
        : `${named[0]}라고 적은 곳과 제품명을 적지 않은 곳이 함께 있어요. 표기 없는 곳은 어떤 제품인지 병원에 확인하세요.`));
  }
  function mixChips(k, redraw) {
    const m = mixFor(k);
    if (!isMixed(m)) return null;
    // every chip has at least one branch: mixFor counts only the branches this list can show
    const opts = [...m.branches].filter(([, bs]) => bs.size > 0).sort((a, b) => (a[0] === "") - (b[0] === "") || b[1].size - a[1].size);
    const cur = prodOn(k);
    const set = (p) => { st.prod = p; st.prodK = k; track("prod_filter", { k: KEYS[k].id, p: p == null ? "all" : p || "none" }); redraw(); };
    return h("div", { class: "prodmix" }, h("span", { class: "tiny" }, "제품·장비"),
      h("div", { class: "chips", role: "radiogroup", "aria-label": "제품·장비로 거르기" },
        h("button", { class: "chip", type: "button", role: "radio", "aria-checked": cur == null ? "true" : "false", onclick: () => set(null) }, "전체"),
        opts.map(([p, bs]) => h("button", { class: "chip", type: "button", role: "radio", "aria-checked": cur === p ? "true" : "false", onclick: () => set(p) }, `${p || "표기 없음"} ${bs.size}곳`))));
  }
  let lastCmpK = null;   // compare_view is counted once per treatment, not on every redraw
  // 규격 미리 선택: the screen opened with nothing chosen shows the first category's start spec (CAT_START: the most widely
  // sold spec of that category), never key 0
  const defaultKey = () => { for (const c of CMP_CATS) { const i = KI[CAT_START[c]]; if (i != null) return i; } return FAM.length ? FAM[0].main : 0; };
  // 6.0 design ①: the sticky header — where am I (분야 › 시술 › 규격), the procedure in big type, ONE basis line for the
  // middle price (the price card's range and numbers follow it; the clinic list says its own '조건부 포함 N곳'), the middle
  // price, '담기' naming what it adds, and '⋯' for the tools the bottom bar used to hold
  function cmpHead(k, fam, rk, N) {
    // each part of the path goes to its own control: 분야 → the category chips and 시술 → the treatment list (both in '다른 시술
    // 고르기', opened), 규격 → the spec steps. Focus follows (the button's name promises the move) and the place flashes once,
    // so a second tap with the picker already in view still shows where it went
    const jump = (to) => { const el = $("#cmppick"); if (!el) return; const d = to === "spec" ? null : el.querySelector("details.cmpother"); if (d && !d.open) d.open = true;
      (d || el).scrollIntoView({ behavior: smooth(), block: "start" });
      const t = to === "cat" && d ? d.querySelector(".chip[aria-pressed=true]") || d.querySelector(".chip") || d.querySelector("summary")
        : to === "fam" && d ? d.querySelector("select") || d.querySelector("summary")
        : el.querySelector(".vchips [aria-checked=true], .vchips [aria-pressed=true], h3");
      if (!t) return;
      if (!t.matches("button, summary, select")) t.tabIndex = -1;
      t.focus({ preventScroll: true });
      const box = to === "cat" ? t.closest(".chips") || t : to === "fam" ? t.closest(".keyhead") || t : t;
      box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash"); setTimeout(() => box.classList.remove("flash"), 1300); };
    const SEG_T = { cat: "다른 분야 고르기", fam: "다른 시술 고르기", spec: "용량·종류 바꾸기" };
    // the step on screen (the last one) is the current place: dark and bold, 'aria-current'; every step stays a button with
    // its underline (위계 점검 20). '›' in the muted grey (5.3:1 light · 7.2:1 dark; --faint was 1.84:1)
    const seg = (t, to, cur) => h("button", { type: "button", class: cur ? "cur" : null, "aria-current": cur ? "page" : null, onclick: () => jump(to), "aria-label": `${t} — ${SEG_T[to]}로 가기` }, t);
    const sep = () => h("span", { class: "sep", "aria-hidden": "true" }, "›");
    const three = !!fam && fam.label !== k.label && fam.label !== fam.f.name;
    // the line right above the median says it is the median's basis: the list below counts every branch with a price
    // ('조건부 포함 185곳') and stays on screen under this sticky header (2026-10-16 hierarchy audit M2). 282px at 320 wide.
    // Folded (scrolled, 위계 점검 9) the line stays as it is, '중간값:' too: the list's own count shows under it then
    const basis = N ? `${regionName()} · ${N.ptop ? "일반가" : "특가 포함"} ${N.prices.length}곳 · ${st.vat === "incl" ? "부가세 포함가" : "병원 표시가"}`
      : `${regionName()} · 이 조건의 가격이 없어요`;
    return h("section", { class: "cmphead", "aria-label": "지금 비교하는 시술" },
      h("nav", { class: "crumb", "aria-label": "분야 › 시술 › 용량·종류" }, seg(k.cat, "cat"), sep(), seg(fam ? fam.f.name : k.label, "fam", !three),
        three ? [sep(), seg(fam.label, "spec", true)] : null),
      h("div", { class: "tline" }, h("h2", { class: "cmpt" }, k.label), favBtn("k", k.id, k.label)),
      h("div", { class: "basis" }, basis),
      h("div", { class: "hrow" }, h("div", { class: "hmed num" }, N ? [h("span", {}, "중간 가격"), won(N.med)] : null),
        rk.length ? addBtn(k.i) : null,
        h("button", { class: "morebtn", type: "button", "aria-label": "더 보기", "aria-haspopup": "dialog", onclick: () => cmpMoreSheet(k, rk, N) }, icon("ellipsis", "sm"))));
  }
  // a fold of the compare screen that stays open across redraws of the same procedure (♡, 담기, settings all call render())
  function cmpFold(name, k, title, ...kids) {
    // a block of its own: one card with the folds' summary line (위계 점검 30 · FOLD-1); the cards inside lose their frame (CSS)
    const key = `${name}:${k.id}`, d = h("details", { class: "card fold cmpfold" }, h("summary", {}, title), ...kids.filter(Boolean));
    if ((st.cmpOpen || (st.cmpOpen = new Set())).has(key)) d.open = true;
    d.addEventListener("toggle", () => { if (d.open) st.cmpOpen.add(key); else st.cmpOpen.delete(key); });
    return d;
  }
  // the sticky header's real height feeds scroll-padding (focus never lands under it) and the jump margins
  // (and the title row's height, --cmpt-h: how far the folded header moves up, see heads())
  let cmphRO = null, cmpEl = null;
  function watchCmpHead() {
    const el = $(".cmphead"), root = document.documentElement; cmpEl = el; root.classList.toggle("cmp-on", !!el);
    root.classList.toggle("br-on", !!$(".bhead"));
    if (cmphRO) cmphRO.disconnect();
    if (el && window.ResizeObserver) {
      const t = el.querySelector(".tline");
      cmphRO = new ResizeObserver(() => { root.style.setProperty("--cmph", `${Math.round(el.getBoundingClientRect().height)}px`);
        if (t) root.style.setProperty("--cmpt-h", `${Math.round(t.getBoundingClientRect().height)}px`); heads(); });
      cmphRO.observe(el); if (t) cmphRO.observe(t);
    }
    heads();
  }
  // What stays on top while a long screen scrolls (위계 점검 9·38). Called from the scroll handler (passive) and after each
  // draw; it only switches classes — never render() — so a press in progress and the typed words are untouched.
  //  · compare: the header sticks under the app bar as before. Once its own place in the page has scrolled past the top
  //    by its title row, html.cmp-fold: the app bar slides away and the header shows the path, the basis line and
  //    중간값 · 담기 · ⋯ (styles.css: the title row moves to the top, out of view). The header's height in the page never
  //    changes, so nothing below it moves; scrolling back up shows the full header and the bar again.
  //  · branch: once the price list is under the app bar, the list's small header (지점 · 분야 chips) shows (html.br-fold;
  //    on a short screen, max-height 700, the app bar slides away then too — styles.css)
  // Each switches back only HEADS_BACK px above where it switched on: a finger resting on the edge does not make it flicker.
  const HEADS_BACK = 24;
  function heads() {
    const root = document.documentElement;
    let fold = false;
    if (cmpEl && cmpEl.isConnected && getComputedStyle(cmpEl).position === "sticky") {
      const prev = cmpEl.previousElementSibling, t = cmpEl.querySelector(".tline"), cs = getComputedStyle(cmpEl);
      const at = prev ? prev.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(cmpEl.parentElement).rowGap) || 0) + (parseFloat(cs.marginTop) || 0)
        : cmpEl.parentElement.getBoundingClientRect().top;   // where the header sits in the page (its sticky place aside)
      fold = at <= -((t ? t.offsetHeight : 0) + (parseFloat(cs.paddingTop) || 0)) + (root.classList.contains("cmp-fold") ? HEADS_BACK : 0);
    }
    root.classList.toggle("cmp-fold", fold);
    const bh = $(".bhead");
    const on = !!bh && bh.parentElement.getBoundingClientRect().top < (parseFloat(getComputedStyle(root).getPropertyValue("--top-h")) || 60) + (bh.classList.contains("on") ? HEADS_BACK : 0);
    if (bh) bh.classList.toggle("on", on);
    root.classList.toggle("br-fold", on);
  }
  // what the compare screen's bottom bar and tools card held, in one list
  function cmpMoreSheet(k, rk, N) {
    sheet(k.label, (close) => { const act = (ic, label, fn, leaves) => h("button", { type: "button", onclick: () => { close(leaves ? true : undefined); fn(); } }, icon(ic, "sm"), label);
      return h("div", { class: "actsheet" },
        rk.length ? act("plus", "횟수·다른 옵션으로 담기", () => addKeySheet(k.i)) : null,
        act("bell", "가격 알림", () => alertSheet({ k: k.id })),
        rk.length ? act("map", "지도에서 보기", () => { st.mapKey = k.i; nav("map"); }, true) : null,
        rk.length ? act("copy", "가격 요약 복사", () => { const ps = rk.map((x) => x.p).sort((a, c) => a - c);
          copyText(FLAGS.lowestHighlight ? [`[${k.label}] ${regionName()} 최저가 (${D.meta.updated} 기준, ${st.vat === "incl" ? "부가세 포함가" : "병원 표시가"})`,
            ...[...rk].sort((x, y) => x.p - y.p).slice(0, 3).map((x, n) => `${n + 1}. ${bname(x.b)} ${won(x.p)} — ${S[ROWS[x.i][2]]}${S[ROWS[x.i][11]] ? ` (${S[ROWS[x.i][11]]})` : ""}`)].join("\n")
            : [`[${k.label}] ${regionName()} 가격 요약 (${D.meta.updated} 수집, ${st.vat === "incl" ? "부가세 포함가" : "병원 표시가"})`,
              N ? `${N.ptop ? "일반가" : "특가"} ${N.prices.length}곳 · ${Pricing.rangeText(N.lo, N.hi)} · 중간 가격 ${won(N.med)}` : `${ps.length}곳 · ${Pricing.rangeText(ps[0], ps[ps.length - 1])} · 중간 가격 ${won(median(ps))}`,
              "용량·조건·정품 여부·시술 의료진·부작용은 병원에 확인하세요. — 윤실장"].join("\n"), "가격 요약을 복사했어요"); }) : null,
        act("share-2", "이 비교 링크 공유", () => shareLink(`윤실장 · ${k.label}`, `compare?k=${encodeURIComponent(k.id)}`)),
        rk.length ? act("list-checks", "방문 전 체크리스트", () => checklistSheet({ id: `k:${k.id}`, title: k.label, k: k.i })) : null,
        rk.length ? act("bookmark", "이 비교 저장", () => saveSnap(snapOfKey(k.i, null))) : null,
        rk.length ? act("scale", shortKeys().length ? `빠른 비교 (${shortKeys().length}곳)` : "빠른 비교", () => { st.qk = k.i; nav(`quick?k=${encodeURIComponent(k.id)}`); }, true) : null);
    });
  }
  views.compare = (arg, params) => {
    const box = h("div", { class: "view" });
    if (params && params.get("k") && KI[params.get("k")] != null) st.key = KI[params.get("k")];
    if (st.key == null || !KEYS[st.key]) st.key = defaultKey();   // 규격 미리 선택: a widely sold spec, never key 0
    if (KEYS[st.key] && (!params || params.get("k") !== KEYS[st.key].id)) history.replaceState(null, "", `#compare?k=${KEYS[st.key].id}`);
    if (st.key != null && KEYS[st.key]) remember("k", KEYS[st.key].id);
    if (KEYS[st.key] && lastCmpK !== st.key) { lastCmpK = st.key; track("compare_view", { k: KEYS[st.key].id }); }
    box.append(cmpNav("compare"));
    const k = KEYS[st.key];
    const fam = famOf[k.i];
    // category → family (제품군) → variant (용량·부위·횟수). Families are ordered by how many branches sell them.
    const cats = CMP_CATS.filter((c) => FAM.some((f) => f.cat === c));
    const catChips = (h("div", { class: "chips" }, cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": c === k.cat ? "true" : "false",
      onclick: () => pickKey(KI[CAT_START[c]] ?? famsIn(c)[0].main) }, catIcon(c, "sm"), `${c} ${famsIn(c).length}`))));
    const sel = h("select", { class: "pick", "aria-label": "시술 고르기", onchange: (e) => pickKey(FAM[+e.target.value].main) },
      fam ? null : h("option", { value: "", selected: true }, k.label),
      famsIn(k.cat).map((f) => h("option", { value: f.idx, selected: !!fam && f === fam.f }, `${f.name} · ${f.n}곳`)));
    const rk = ranking(k.i);
    // 1) what is compared: the treatment, its exact spec, the settings that change the numbers
    // round-2 UX02: the treatment picker, then the PRICE, then the options and the explanation — the first screen answers
    // 'how much is it?' instead of opening with a description and three option steps
    // ---- the numbers, once: the header, the price card and the distribution's middle line all use this one basis
    // (audit U1·E7: one screen, one basis). basis = plain prices when there are any, else the comparable ones (keyNums).
    const N = keyNums(k.i, rk);
    if (N && N.shown.length) metric("compare_open");
    box.append(cmpHead(k, fam, rk, N));
    // 규격 바꾸기: the spec steps, other treatments and the settings that change the numbers. Below the list (the first screen
    // answers 'how much'); the header's path jumps here. With no price at all it comes right after the header.
    const card = h("div", { class: "card", id: "cmppick" });
    card.addEventListener("click", (e) => { if (e.target.closest(".opt, .chip, option, select, .famfind button")) st.cmpPickHold = true; }, true);
    card.append(h("div", { class: "row" }, h("h3", { style: "margin:0" }, "용량·종류 바꾸기"), h("span", { class: "sp" }), h("span", { class: "sub" }, k.label)));
    if (fam && fam.f.vs.length > 1) {
      // 쉬운 보기 (default): 종류 → 용량·부위 → 횟수, one step at a time. 자세히: every variant, grouped by kind (the earlier view)
      const easy = st.cmpMode !== "detail";
      // the steps under the card title 17 (위계 점검 20, 2026-10-19 type steps): the treatment 15/760 · its spec chips 15/600 · 분야 chips 13 (styles.css #cmppick)
      card.append(h("div", { class: "row", style: "margin-top:var(--sp-3)" }, h("span", { class: "sub", style: "flex:1;min-width:0" }, h("b", { class: "famname" }, fam.f.name), `${fam.f.vs.length}가지`),
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
    { const sn = specNotes(fam); if (sn) card.append(sn); }
    card.append(h("details", { class: "fold small cmpother" }, h("summary", {}, `다른 시술 고르기 · ${k.cat}`), catChips, h("div", { class: "keyhead", style: "margin-top:var(--sp-2)" }, sel),
      h("div", { style: "margin-top:var(--sp-2)" }, famFinder())));
    card.append(h("div", { class: "row", style: "margin-top:var(--sp-3)" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }), h("span", { class: "sp" }), whenChip()),
      h("div", { style: "margin-top:var(--sp-2)" }, brandChips()));
    let fold1 = null;
    if (rk.length) {
      // 2) the price. With flags.lowestHighlight off (default) the summary is the range and the median of the same-condition
      // prices — no clinic is named on top as 'the lowest'; each clinic's price is in the list and the distribution below.
      // With it on: the lowest plain price and its clinic (the earlier headline). Conditional prices are shown apart either way.
      const { plain, lowp, ptop, ctop, top, prices, med, lo, hi } = N;
      const r0 = ROWS[top.i], HL = FLAGS.lowestHighlight;
      const key = HL ? top.p : `${lo}-${hi}`, tick = lastHero && lastHero.k === k.i && lastHero.p !== key;
      lastHero = { k: k.i, p: key };
      const stat = (l, v, sub) => h("div", {}, h("span", {}, l), h("b", { class: "num" }, v), sub ? h("span", { class: "fw-reg" }, sub) : null);
      const spread = lo ? hi / lo : 1;
      const pc = h("section", { class: "card pricecard lift", "aria-label": "가격 요약" },
        h("div", { class: "spec" }, h("span", { class: "k ok" }, icon("check", "xs"), "같은 용량·횟수끼리")),   // the procedure's name is in the sticky header
        mixNote(k.i),
        HL ? h("div", { class: "hero" },
          h("span", { class: "hl" }, ptop ? `현재 최저가 · 일반가 ${plain.length}곳 중` : `특가만 있어요 · ${prices.length}곳`),
          h("span", { class: `hp num${tick ? " tick" : ""}` }, won(top.p)),
          h("span", { class: "hb" }, bdot(top.b), bname(top.b), top.d != null ? h("span", { class: "sub" }, km(top.d)) : null),
          h("div", { class: "meta" }, h("span", {}, S[r0[2]]), kindBadge(r0).slice(0, 3), h("span", {}, listedTxt(r0) || (st.vat === "incl" ? "부가세 포함가" : "병원 표시가")), h("span", {}, `확인 ${md(fresh(top.b).d)}`)),
          h("div", { class: "row", style: "gap:var(--sp-3);margin-top:var(--sp-2)" },
            h("button", { class: "linkbtn", type: "button", onclick: () => priceSheet(top.i) }, icon("info", "xs"), "가격 정보"),
            srcLink(top.i, "병원 사이트"),
            h("button", { class: "linkbtn", type: "button", onclick: () => basisSheet(k, rk, plain) }, icon("circle-help", "xs"), "계산 기준")))
        : h("div", { class: "hero" },
          h("span", { class: "hl" }, ptop ? "가격 범위" : "특가만 있어요"),
          h("span", { class: `hp range num${tick ? " tick" : ""}` }, rangeEl(lo, hi)),
          // the price range on one track with the middle price marked and named under it (6.0 design ②; the one range bar). A
          // middle outside the drawn range (low outliers) is not pinned to an edge: no bar then
          hi > lo && med != null && med >= lo && med <= hi ? rangeBar(lo, hi, med, { label: true }) : null,
          h("div", { class: "meta" }, h("span", {}, `${md(D.meta.updated)} 수집`)),
          h("div", { class: "row", style: "gap:var(--sp-3);margin-top:var(--sp-2)" },
            h("button", { class: "linkbtn", type: "button", onclick: () => basisSheet(k, rk, plain) }, icon("circle-help", "xs"), "계산 기준"),
            h("button", { class: "linkbtn", type: "button", onclick: () => { const el = $("#clinics"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); } }, icon("list", "xs"), "지점별 가격 보기"))),
        h("div", { class: "qstats" }, stat("중간 가격", won(med)),
          HL ? stat("가장 비싼 곳", won(prices[prices.length - 1])) : stat("가격 차이", spread >= 1.05 ? `최대 ${spread.toFixed(1)}배` : "거의 없음"),
          stat("비교 지점", `${prices.length}곳`, HL ? (spread >= 1.05 ? `최대 ${spread.toFixed(1)}배 차이` : "차이 거의 없음") : null)));
      // 조건부 가격 and 확인 필요 초저가 under a hairline, each with its badges (위계 점검 31 · CARD-1 — they were butter boxes inside
      // the card): the price's own kind / condition badges (kindBadge ①, butter) or '조건부'; the list's '초저가·조건 확인'
      const cb = ctop ? kindBadge(ROWS[ctop.i], { group: 0 }) : [];
      if (ptop && ctop.p < ptop.p) pc.append(h("div", { class: "condlow" },
        h("div", { class: "row" }, h("b", { class: "num" }, HL ? `특가 최저 ${won(ctop.p)}` : `특가 ${won(ctop.p)}~`), cb.length ? cb : h("span", { class: "k k1" }, "특가"), HL ? h("span", { class: "sub" }, bname(ctop.b)) : null, h("span", { class: "sp" }),
          hereLink("info", "조건 확인", () => priceSheet(ctop.i))),
        h("div", { class: "sub" }, (priceConds(ctop.i).join(" · ") || "이번 주 확인 안 된 지점") + " — 조건이 맞을 때만 이 가격이에요.")));
      if (ptop && lowp.length) pc.append(h("div", { class: "condlow" },
        h("div", { class: "row" }, h("b", { class: "num" }, `초저가 ${won(lowp[0].p)}`), kwBadge("확인 필요"), h("span", { class: "sub" }, HL ? `${bname(lowp[0].b)}${lowp.length > 1 ? ` 외 ${lowp.length - 1}곳` : ""}` : `${lowp.length}곳`), h("span", { class: "sp" }),
          hereLink("info", "가격 정보", () => priceSheet(lowp[0].i))),
        h("div", { class: "sub" }, `중간 가격의 ${Math.round(lowp[0].p / med * 100)}%이고 ${lowp.filter((x) => x.p === lowp[0].p).length}곳뿐이에요. 숨은 조건이나 입력 오류일 수 있어 확인 전까지 ${HL ? "최저가로 쓰지 않아요" : "범위에서 뺐어요"}.`)));
      if (HL && r0[4] && FLAGS.discountEmphasis) pc.append(h("div", { class: "sub", style: "margin-top:var(--sp-3)" }, `최저가는 병원이 적은 정가보다 ${Math.round((r0[4] - r0[3]) / r0[4] * 100)}% 싸요(정가 표기 기준, 가격 이력과 별개).`));
      // 2b) what to check with the price comes right after the price (docs/OBJECTIVE_DISPLAY_POLICY.md)
      box.append(pc, checkCard(k, fam, rk));
      // 4) folded for experts (6.0 design ④): the distribution, price kinds, regions, brands, history. The distribution's
      // middle line is the header's median (same basis), so no note explains two different middles.
      const dl = rk.map((x) => ({ b: x.b, i: x.i, p: x.p, cond: !plainOk(x.i) }));
      fold1 = cmpFold("more", k, "가격 종류별·브랜드별·지역별 보기",
        h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "병원별 가격 분포"), h("span", { class: "sp" }), h("span", { class: "sub" }, `${st.special ? "특가 포함" : "일반가"} ${rk.length}곳`)),
          h("div", { class: "sub" }, "지점마다 가장 싼 가격 하나 · 세로선은 중간 가격"),
          rk.length >= 3 ? distChart(dl, med, HL ? top.i : null, `${k.label} 병원별 가격 분포`, (d) => nav(`branch/${d.b}`))
            : emptyBox("chart-column", "분포는 3곳부터 그려요", `비교할 지점이 ${rk.length}곳이라 위 목록에서 보세요.`)));
      fold1.id = "cmpmore";
      { const pcc = priceClassCard(k.i); if (pcc) fold1.append(pcc); }
      { const rc = regionalCard(k.i); if (rc) fold1.append(rc); }
      // per brand (docs/BRAND_PRICE_COMPARISON.md): branches, range, median, conditional prices, last check — in brand order;
      // the cheapest branch of each brand only with lowestHighlight. A tap lists that brand's branches for this exact key.
      const per = D.meta.brands.map((bb, bi) => ({ bi, xs: rk.filter((y) => BR[y.b].brand === bi).sort((p, q) => p.p - q.p) })).filter((y) => y.xs.length);
      if (per.length > 1) fold1.append(brandCard(k, per));
    } else box.append(card);
    // favourite branches pinned for this procedure (price or 'not offered'); the gap to the cheapest only with lowestHighlight
    const fb = favs().b.map((id) => BK.get(id)).filter((b) => b != null);
    const favCard = !(fb.length && rk.length) ? null : (h("div", { class: "card flush" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "관심 지점")),
      h("ul", { class: "list" }, fb.map((b) => { const x = rk.find((y) => y.b === b);
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b}`) }, h("span", { class: "t row" }, bdot(b), bname(b)),
          h("span", { class: "p num" }, x ? won(x.p) : "없음"),
          h("span", { class: "m" }, x ? (FLAGS.lowestHighlight ? (() => { const mn = Math.min(...rk.map((y) => y.p)); return x.p === mn ? h("span", { class: "down" }, "최저가와 같아요") : h("span", {}, `최저보다 +${won(x.p - mn)}`); })() : h("span", {}, S[ROWS[x.i][2]]))
            : h("span", {}, "이 지점은 이 시술 가격이 없어요"),
            x ? kindBadge(ROWS[x.i]) : null))); }))));
    // how the price moved (only recorded weeks; hidden until 8 weeks) — in the fold
    { const kt = keyTrend(k); if (kt) { if (fold1) fold1.append(kt); else box.append(cmpFold("hist", k, "가격 이력", kt)); } }
    // list-price discount: a different thing from the price history above (clinics' own 정가 this week, not past prices)
    const trd = TR().disc[k.id];
    if (trd != null && FLAGS.discountEmphasis && fold1) fold1.append(h("div", { class: "card" }, h("h3", {}, "정가 대비 할인율 (이번 주)"),
      h("div", { class: "sub" }, `병원이 상품에 적은 정가와 판매가를 비교한 값이에요. 정가가 적힌 가격만 계산하고, 위 '가격 이력'(실제로 모은 과거 가격)과는 다른 숫자예요.`),
      h("div", { class: "tiles", style: "margin-top:var(--sp-2)" }, h("div", { class: "tile" }, h("span", { class: "k" }, "중간 할인율"), h("b", { class: "num" }, `${trd}%`), h("span", { class: "w" }, "병원 표기 정가 기준")))));
    // 5) every clinic, in the order the user picked (default: region · name; nearest once a location is set)
    // only this card is redrawn when the order or the view changes (the charts above stay): a quick tap response
    const curRk = () => (prodOn(k.i) != null ? prodRank(k.i, prodOn(k.i)) : ranking(k.i));
    const mixed = isMixed(mixFor(k.i));   // the branches on screen only: a region with no product named shows no tag
    const prodTag = (i) => mixed ? h("span", { class: "k prodk" }, rowProds(i).join("·") || "제품 표기 없음") : null;
    const clinicsCard = (rk) => {
      const medAll = median(rk.map((x) => x.p)), min0 = rk.length ? Math.min(...rk.map((x) => x.p)) : 0;
      // round-2 O3: the first rows go in with the tap; the rest follow in small batches after the screen has painted, so a
      // sort or view change answers at once instead of building ~170 rows (and laying them all out) before the next paint.
      // Same rows, same order, all of them in the end; batches stop if this card was replaced meanwhile.
      const inBatches = (ul, items, make) => {
        const FIRST = 30, STEP = 40;
        items.slice(0, FIRST).forEach(make);
        let at = FIRST;
        const more = () => { if (!ul.isConnected) return; const end = Math.min(items.length, at + STEP); for (; at < end; at++) make(items[at], at); if (at < items.length) setTimeout(more, 0); };
        if (at < items.length) requestAnimationFrame(() => setTimeout(more, 0));
      };
      // 6.0 ③: the first rows only ('결정에 필요한 만큼만'), then the shared '20곳 더 보기 (N곳 남음)' — '모두 보기' went from 10
      // rows to 185 in one tap, 24.8 screens (hierarchy audit 11 · L7). The count shown stays for this treatment while the card
      // is redrawn (order, list/cards); a short list (two more than the first rows at most) is shown whole
      const first = st.sort === "near" && st.loc ? 5 : 10;
      const rows = rk.slice(0, st.cmpN && st.cmpN.k === k.i ? Math.max(first, st.cmpN.n) : rk.length <= first + 2 ? rk.length : first);
      const more = moreBtn(rows.length, rk.length, "곳", (next) => {
        const cc = $("#clinics .ccards"), left = cc ? cc.scrollLeft : 0, at = rows.length; st.cmpN = { k: k.i, n: next }; redrawClinics();
        const nc = $("#clinics .ccards"); if (nc) nc.scrollLeft = left;
        // rows after the first 30 arrive in batches (inBatches): wait for the first new one before moving focus there
        const to = (tries) => { const el = $(`#clinics li.rk:nth-child(${at + 1})`) || $(`#clinics .ccard:nth-child(${at + 1})`); if (el) focusIn(el); else if (tries) setTimeout(() => to(tries - 1), 30); };
        to(20); });
      // only the view on screen is built (list or cards)
      const buildList = () => { const list = h("ul", { class: "list" });
      inBatches(list, rows, (x, n) => {
        const r = ROWS[x.i], low = rk.length >= 3 && medAll && x.p <= medAll * LOW_SHARE;
        // positions (1, 2, 3 …) read as a ranking: shown only with flags.lowestHighlight
        list.append(h("li", { class: "rk", "data-b": x.b, onmouseenter: () => dotHl(x.b), onfocusin: () => dotHl(x.b), onmouseleave: () => dotHl(null) }, h("button", { class: "rank" + (FLAGS.lowestHighlight ? (n < 3 && st.sort === "price" ? " top" : "") : " nonum"), type: "button", onclick: () => nav(`branch/${x.b}`) },
          h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))),
          h("span", { class: "p num" }, won(x.p)),
          // badges in the one order (kindBadge): the price's kind and conditions, warnings (초저가, 지난 자료), information (제품)
          h("span", { class: "m" }, S[r[2]], listS(r), kindBadge(r, { warn: [low ? (() => { const t = `이 목록(특가 포함) 중간 가격 ${won(medAll)}의 ${Math.round(x.p / medAll * 100)}%`;
            return checkedOk(x.i) ? h("span", { class: "k ok", title: t }, `초저가·확인됨 ${md(CHK.get(x.i).d)}`) : kwBadge("초저가·조건 확인", { title: t }); })() : null,
            fresh(x.b).stale ? kwBadge("지난 자료", {}, "history") : null], info: [prodTag(x.i)] }),
            FLAGS.lowestHighlight && x.p > min0 ? h("span", { class: "gap" }, `최저 +${won(x.p - min0)}`) : null, x.d != null ? h("b", {}, km(x.d)) : null)),
          infoBtn(x.i, bname(x.b))));
      });
      return more ? h("div", {}, list, more) : list; };
      // the same clinics, same order, as cards to swipe through (one clinic per card: price, conditions, checked date). Its three
      // actions are the branch head's grid of equal halves (.bbtns): 가격 근거 · 지점 보기, then 비교함 across the card (2+1) —
      // in one row they were 60~68px each at 360·390 and their words stacked a letter a line
      const buildCards = () => { const cards = h("ul", { class: "ccards", "aria-label": "지점별 가격 카드" });
      inBatches(cards, rows, (x, n) => {
        const r = ROWS[x.i], low = rk.length >= 3 && medAll && x.p <= medAll * LOW_SHARE;
        cards.append(h("li", { class: "ccard", "aria-label": `${n + 1} / ${rows.length}: ${bname(x.b)}` },
          h("div", { class: "ccard-h" }, bdot(x.b), h("b", {}, bname(x.b)), h("span", { class: "sp" }), h("span", { class: "tiny num" }, `${n + 1}/${rows.length}`)),
          h("div", { class: "ccard-p num" }, won(x.p), listS(r)),
          h("div", { class: "ccard-n" }, S[r[2]]),
          h("div", { class: "m" }, kindBadge(r, { warn: [low ? (checkedOk(x.i) ? h("span", { class: "k ok" }, `초저가·확인됨 ${md(CHK.get(x.i).d)}`) : kwBadge("초저가·조건 확인")) : null,
            fresh(x.b).stale ? kwBadge("지난 자료", {}, "history") : null], info: [prodTag(x.i)] }), x.d != null ? h("b", {}, km(x.d)) : null),
          h("div", { class: "tiny" }, `${BR[x.b].region || ""} · 확인 ${md(verified(x.b))}`),
          h("div", { class: "bbtns ccard-a" }, h("button", { class: "btn sm gray", type: "button", "aria-label": `${bname(x.b)} 가격 정보 보기`, onclick: () => priceSheet(x.i) }, icon("info", "sm"), "가격 정보"),
            h("button", { class: "btn sm gray", type: "button", onclick: () => nav(`branch/${x.b}`) }, "지점 보기"), shortBtn(x.b))));
      });
      const step = (d) => { const c = cards.querySelector(".ccard"); if (c) cards.scrollBy({ left: d * (c.offsetWidth + 10), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); };
      const cardBox = h("div", { class: "ccwrap" }, cards, rk.length > 1 ? h("div", { class: "row ccnav" }, h("span", { class: "tiny" }, "옆으로 넘겨 보세요"), h("span", { class: "sp" }),
        h("button", { class: "tbtn-i", type: "button", "aria-label": "이전 지점", onclick: () => step(-1) }, icon("chevron-left")),
        h("button", { class: "tbtn-i", type: "button", "aria-label": "다음 지점", onclick: () => step(1) }, icon("chevron-right"))) : null, more);
      return cardBox; };
      const setView = (v) => { st.cview = v; store.set("cmpView", v); redrawClinics(); };
      const viewSw = h("div", { class: "seg vsw", role: "group", "aria-label": "보기 방식" }, [["list", "목록"], ["cards", "카드"]].map(([v, l]) =>
        h("button", { type: "button", "aria-pressed": st.cview === v ? "true" : "false", onclick: () => { if (st.cview !== v) setView(v); } }, l)));
      const have = new Set(rk.map((y) => y.b));
      const none = BR.filter((y) => brandOn(y.i) && regionOk(y.i) && !have.has(y.i));
      const setSort = (v) => { if (v === "near" && !st.loc) locSheet(); st.sort = v; store.set("sort", v); redrawClinics(); };
      return h("div", { class: "card flush", id: "clinics" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("div", { class: "row" }, h("h3", {}, `지점별 가격 ${rk.length}곳`), h("span", { class: "sp" }), rk.length > 1 ? viewSw : null),
        shortLink(), mixChips(k.i, redrawClinics),
        h("div", { style: "margin-top:var(--sp-2)" }, sortChips(st.sort, setSort)),
        h("p", { class: "tiny", style: "margin-top:var(--sp-2)" }, `${SORT_L[st.sort] || "정렬"}${st.sort === "near" && !st.loc ? "(기준 위치를 정하면 가까운 순)" : ""} · 광고·제휴로 순서가 바뀌지 않아요.`),
        // no place to measure from yet: the way to 6.0's '가까운 지점 5곳' right above the list (hierarchy audit 7 · L3) — the
        // place sheet and the '가까운순' order that are already here; once a place is set the list opens on its nearest 5
        !st.loc && rk.length > 5 ? h("button", { class: "btn line block near5", type: "button", "aria-haspopup": "dialog", onclick: () => locSheet(() => { st.sort = "near"; store.set("sort", "near"); render(); }) },
          icon("map-pin", "sm"), "기준 위치 정하기 → 가까운 5곳") : null),
        rk.length ? (st.cview === "cards" && rk.length > 1 ? buildCards() : buildList()) : emptyBox("search", "조건에 맞는 지점이 없어요", "브랜드나 특가 설정을 바꿔 보세요."),
        none.length ? h("details", { class: "fold small", style: "padding:0 14px" }, h("summary", {}, `이 시술 가격이 없는 지점 ${none.length}곳`),
          h("div", { class: "sub", style: "padding:0 0 var(--sp-3)" }, none.map((y) => bname(y.i)).join(", "), " — 안 팔거나 용량·횟수가 달라요.")) : null);
    };
    const redrawClinics = () => { const old = box.querySelector("#clinics"), lbl = document.activeElement && old && old.contains(document.activeElement) ? document.activeElement.textContent : null;
      if (!old) { render(); return; } const fresh = clinicsCard(curRk()); old.replaceWith(fresh);
      const again = lbl != null && [...fresh.querySelectorAll("button")].find((x) => x.textContent === lbl); if (again) again.focus({ preventScroll: true }); };
    box.append(clinicsCard(curRk()));
    if (favCard) box.append(favCard);
    if (rk.length) box.append(card);
    if (fold1) box.append(fold1);
    // 시술 설명·규격 확인: folded (the short 'what is it' line and the spec check), for those who want it
    { const gb = fam ? guideBox(fam.f) : null, sc = specCard(k.i);
      if (gb || sc) { const f2 = cmpFold("about", k, fam ? `${fam.f.name}, 뭐예요? · 용량·종류 확인` : "용량·종류 확인", gb, sc); f2.id = "cmpabout"; box.append(f2); } }
    if (st.cmpPickHold) { st.cmpPickHold = false; requestAnimationFrame(() => { const el = $("#cmppick"); if (el) el.scrollIntoView({ block: "start" }); }); }
    box.append(h("p", { class: "foot" }, `${vatNote()} 패키지·추가 옵션·이용권·끝난 이벤트는 비교에서 빠져요.`));
    return box;
  };

  // cls "sm": the small one (내 견적 '전에 이 시술을 받아 봤어요', 위계 점검 46) — 36×22 to see, 44px to press
  function switchEl(label, on, set, aria, cls) {
    const inp = h("input", { type: "checkbox", checked: on, "aria-label": aria, onchange: (e) => set(e.target.checked) });
    return h("label", { class: cls ? `switch ${cls}` : "switch" }, inp, h("span", { class: "tr", "aria-hidden": "true" }), label);
  }
  function brandChips() {
    return h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, D.meta.brands.map((b, i) => !BR.some((x) => x.brand === i) ? null : h("button", {
      class: "chip bchip", type: "button", "aria-pressed": st.brands.includes(i) ? "true" : "false",
      onclick: () => {
        st.brands = st.brands.includes(i) ? st.brands.filter((x) => x !== i) : [...st.brands, i];
        if (!st.brands.length) st.brands = D.meta.brands.map((_, j) => j);
        store.set("brands", st.brands); render();
      } }, h("span", { class: "dot", style: `background:${b[1]}` }), b[0])));
  }

  // 지도 (#map) lives in screens/map.js (docs/APP_JS_SPLIT_PLAN.md 3-4). The area names stay here: the location sheet and
  // search use them too; an area picked moves the map through App.mapNow().
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
    const map = App.mapNow();   // the map screen's Leaflet map (screens/map.js), read after render() as before
    if (map && pts.length) map.fitBounds(L.latLngBounds(pts.map((b) => [b.lat, b.lng])).pad(0.4), { maxZoom: 14 });
  }
  function areaSearch(after) {
    const inp = h("input", { type: "search", placeholder: "동네·역 이름 (예: 강남, 홍대, 분당, 부평)", "aria-label": "지역 이름으로 찾기" });
    const out = h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" });
    inp.addEventListener("input", () => { const r = areaFind(inp.value);
      fill(out, inp.value.trim() && !r.length ? h("span", { class: "sub" }, "그 이름의 지점·동네가 없어요") : null,
        r.map((a) => h("button", { class: "chip", type: "button", onclick: () => { useArea(a); if (after) after(); } }, `${a.name} · ${a.bs.length}곳`))); });
    return h("div", {}, searchBox(inp, { inset: true }), out);
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
        return h("div", { class: "row", style: "margin-top:0;flex-wrap:nowrap" }, h("h2", { style: "flex:1;min-width:0" }, `${brandOf(b)[0]} ${x.name}`), favBtn("b", bkey(b), bname(b)),
          sib.length > 1 && n >= 0 ? h("span", { class: "sibs" }, h("button", { type: "button", "aria-label": "같은 브랜드 이전 지점", onclick: () => go(-1) }, icon("chevron-left", "sm")), h("span", { class: "sub" }, `${n + 1}/${sib.length}`),
            h("button", { type: "button", "aria-label": "같은 브랜드 다음 지점", onclick: () => go(1) }, icon("chevron-right", "sm"))) : null); })(),
      h("dl", { class: "kv", style: "margin-top:var(--sp-2)" }, h("dt", {}, "주소"), h("dd", {}, x.addr || "확인 못 함"),
        d != null ? [h("dt", {}, "거리"), h("dd", {}, `내 위치에서 ${km(d)}`)] : null,
        (() => { const f = fresh(b); return [h("dt", {}, "가격 확인"), h("dd", { class: f.stale ? "up" : "" }, f.d ? `${md(f.d)} (${f.n === 0 ? "오늘" : `${f.n}일 전`})${f.stale ? " · 최신이 아닐 수 있어요" : ""}` : "확인일 없음")]; })()),
      fresh(b).stale ? h("div", { class: "note", style: "margin-top:var(--sp-2)" }, "이번 주 가격을 읽지 못해 지난 가격이에요. 방문 전에 병원에 꼭 확인하세요.") : null,
      // the branch's actions in one grid of equal halves (위계 점검 35 · BTN-1 — they were 69~132px wide in rows of 3·2·1):
      // where it is (지도 · 길찾기), the clinic (병원 홈페이지 · 방문 기록), comparing (다른 지점과 비교 · 비교함). ↗ marks the two
      // that leave the app (outLink)
      h("div", { class: "bbtns" },
        x.lat != null ? h("button", { class: "btn sm gray", type: "button", onclick: () => { nav("map"); setTimeout(() => App.mapNow() && App.mapNow().setView([x.lat, x.lng], 16), 50); } }, icon("map", "sm"), "지도") : null,
        x.addr ? outLink(`https://map.kakao.com/?q=${encodeURIComponent(x.addr)}`, "navigation", "길찾기") : null,
        outLink(x.site, "building-2", "병원 홈페이지"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => recordSheet(null, { br: bkey(b) }) }, icon("receipt", "sm"), "방문 기록"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { st.vsA = b; st.vsB = null; nav("versus"); } }, icon("scale", "sm"), "다른 지점과 비교"), shortBtn(b)),
      // '이 병원에 다녀왔어요' at a branch with a revisit price (the cart's quote shows it for first-visit prices too), and at every
      // branch marked visited, so it can be turned off here whatever turned it on (review 2026-10-19). Without 특가 포함 the cart
      // takes neither kind of price (a line's own 특가 포함 or a pick aside): not offered, and when on the words say so
      (() => { const ls = byB[b].filter(live), rv = ls.some((i) => isRevisitRow(ROWS[i])), fv = ls.some((i) => isFirstVisit(ROWS[i]) && !isRevisitRow(ROWS[i]));
        return (rv && st.special) || visitedAt(b) ? visitSwitch(b, { rv, fv }, { vw: "head", where: "내 견적에서 이 지점의 ", tail: st.special ? "" : "(특가 포함일 때)",
          none: "이 지점 가격표엔 지금 재방문 가격도 첫 방문가도 없어 바뀌는 게 없어요" }) : null; })()));
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
        Object.keys(bs[5] || {}).length ? h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" }, Object.entries(bs[5]).map(([c, v]) => h("span", { class: "chip", style: "cursor:default" }, `${D.meta.cats[+c]} `, h("b", { class: lvClass(v) }, lvText(v))))) : null,
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "같은 옵션을 파는 지점들의 중간 가격과 비교했어요")));
      if (cheapHere.length) box.append(h("details", { class: "card flush fold" }, h("summary", {}, `이 지점이 제일 싼 시술 ${cheapHere.length}개`),
        (() => { const ul = h("ul", { class: "list" });   // the first 200, then the shared '더 보기'
          return [ul, moreList(ul, cheapHere, (x) => { const r = ROWS[x.i];
            return h("li", {}, h("div", { class: "item ra" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
              h("span", { class: "m" }, h("span", {}, `${x.n}곳 중 ${x.sole ? "혼자 " : "공동 "}최저`), h("span", { class: "down" }, pctTxt(r[3] / x.med - 1)), kindBadge(r), srcLink(x.i)), rowAddBtn(x.i))); }, { first: 200 })]; })()));
    }
    const rows = byB[b].filter((i) => st.special || !isSpecial(ROWS[i]));
    const cats = D.meta.cats.map((c, ci) => [c, rows.filter((i) => ROWS[i][1] === ci).length]).filter(([, n]) => n);
    if (st.bcat >= 0 && !cats.some(([c]) => D.meta.cats.indexOf(c) === st.bcat)) st.bcat = -1;
    const q = h("input", { type: "search", placeholder: "이 지점에서 시술 찾기", "aria-label": "이 지점에서 시술 찾기" });
    const list = h("ul", { class: "list" }), moreSlot = h("div", {});
    // one end date on nearly every line (블리비: '~10/31까지' on 849 of 851): said once above the list, and a line shows its
    // date only when it is another one (hierarchy audit 6 · BR-1; '기간 확인 필요' stays on its lines)
    const live1 = rows.filter((i) => !dupRows().has(i)), sameEnd = Stats.commonDate ? Stats.commonDate(rows.map((i) => endDate(ROWS[i]))) : null;
    // the 분야 chip that is on stays in sight after the redraw (render draws its sideways row again from the start: 4 of 블리비
    // 강남역점's 7 분야 sit past a 390 px screen's right edge, so the chip was on but out of sight — review of hierarchy 3-1).
    // left: where the row was scrolled before (a chip tapped there stays where the finger left it); jump: a 분야 heading's
    // '모두 보기' — the price card's head goes back just below the sticky top bar (not under it) and focus to the chip.
    // The redraw waits until the tap's click is over (render), so this waits for the chip to be on
    const catOn = (ci, { left = 0, jump = false } = {}) => { let tries = 20;
      const run = () => { const c = $("#bprices"), on = c && c.querySelector(`.bcats .chip[data-c="${ci}"]`);
        if (!on || on.getAttribute("aria-pressed") !== "true") { if (tries-- > 0) setTimeout(run, 30); return; }
        const row = on.parentElement, pad = 20; row.scrollLeft = left;
        const r = on.getBoundingClientRect(), w = row.getBoundingClientRect();
        if (r.left < w.left + pad || r.right > w.right - pad) row.scrollLeft += r.left - w.left - pad;
        if (!jump) return;
        // where the card sits in the page's layout (offsetTop: the new screen still slides 8 px up as it appears, viewin)
        const top = $("#top"), below = top ? top.getBoundingClientRect().bottom : 0; let y = 0;
        for (let e = c; e; e = e.offsetParent) y += e.offsetTop;
        scrollTo(0, Math.max(0, y - below - 8));
        on.focus({ preventScroll: true }); };
      setTimeout(run, 0); };
    const setCat = (ci, e) => { const row = e && e.currentTarget.parentElement, left = row ? row.scrollLeft : 0; st.bcat = ci; render(); catOn(ci, { left }); };
    const showCat = (ci) => { st.bcat = ci; render(); catOn(ci, { jump: true }); };
    // a price line: name · price, its badges, 담기 — and the ⓘ column for its evidence (위계 점검 47: the sheet's '원본' line
    // links the clinic's page, so the line no longer carries '가격 근거' · '출처' links of its own)
    const row = (i, withCat) => { const r = ROWS[i];
      return h("li", { class: "rk" }, h("div", { class: r[15] ? "item" : "item ra" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
        h("span", { class: "m" }, withCat ? D.meta.cats[r[1]] : null, listS(r), r[4] && FLAGS.discountEmphasis ? h("span", { class: "k k4" }, `${Math.round((r[4] - r[3]) / r[4] * 100)}%↓`) : null,
          kindBadge(r, { sameDate: sameEnd ? sameEnd.date : "" }),
          sessOf(i) > 1 ? h("span", {}, sessOf(i) >= 99 ? "이용권" : `${sessOf(i)}회`) : null,
          (() => { const x = FLAGS.lowestHighlight && !r[15] ? rowPos(i) : null;
            return x ? h("span", { class: x.vsMed < -0.005 ? "down" : x.vsMed > 0.005 ? "up" : "" }, `${x.n}곳 중 ${x.rank}위 · ${pctTxt(x.vsMed)}`) : null; })()),
        r[15] ? null : rowAddBtn(i)), infoBtn(i, S[r[2]])); };
    // 851 prices were 400 lines in one go — 60.6 screens, and with '전체' the first three 분야 filled all 400 so 피부·레이저 and
    // three more never showed; the rest was one line of text (hierarchy audit 6 · L2 · BR-1). Now:
    //  · '전체' in 카테고리순 with nothing typed: each 분야 under its own heading with its first 5 lines and '보톡스·필러 151개
    //    모두 보기' (the 분야 chip above, as if tapped) — every 분야 is on the first screens
    //  · a 분야 chosen, words typed or another order: the first 30 lines and the shared '20개 더 보기 (N개 남음)'. Typing draws
    //    the list again from 30 (paint), the words stay in the box; the 더 보기 adds lines in place
    const paint = () => {
      const t = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const pos = new Map();
      const vm = (i) => { if (!pos.has(i)) pos.set(i, rowPos(i)); const x = pos.get(i); return x ? x.vsMed : 9; };
      const disc = (i) => ROWS[i][4] ? (ROWS[i][4] - ROWS[i][3]) / ROWS[i][4] : 0;
      // 카테고리순: inside each 분야, a 추가 옵션 (sold only with another treatment) after the treatments themselves — the 분야's
      // first 5 lines and its '모두 보기' list open on what the 분야 sells (스킨부스터's first 5 were 4 '…1회 추가' lines,
      // review of hierarchy 3-1); the price orders stay price only
      const ao = (i) => (addonOf(ROWS[i]) ? 1 : 0);
      const so = { cat: (a, c) => ROWS[a][1] - ROWS[c][1] || ao(a) - ao(c) || ROWS[a][3] - ROWS[c][3], price: (a, c) => ROWS[a][3] - ROWS[c][3], priceDesc: (a, c) => ROWS[c][3] - ROWS[a][3], med: (a, c) => vm(a) - vm(c), disc: (a, c) => disc(c) - disc(a) }[st.bsort];
      const shown = live1.filter((i) => (st.bcat < 0 || ROWS[i][1] === st.bcat) && t.every((w) => S[ROWS[i][2]].toLowerCase().includes(w))).sort((a, c) => (ROWS[a][15] ? 1 : 0) - (ROWS[c][15] ? 1 : 0) || so(a, c));   // a row collected twice is one line (E4)
      list.replaceChildren(); moreSlot.replaceChildren();
      if (!shown.length) { list.replaceChildren(emptyLine("찾는 시술이 없어요", "li")); return; }
      if (st.bcat < 0 && st.bsort === "cat" && !t.length && Stats.groups) {
        for (const g of Stats.groups(shown, (i) => ROWS[i][1], 5)) {
          const name = D.meta.cats[g.key], few = g.total <= 7, ids = few ? shown.filter((i) => ROWS[i][1] === g.key) : g.first;
          list.append(h("li", { class: "bgh" }, h("h4", {}, name), h("span", { class: "sub" }, `${g.total.toLocaleString()}개`)), ...ids.map((i) => row(i, false)));
          if (!few) list.append(h("li", { class: "bgmore" }, h("button", { class: "morelist", type: "button", onclick: () => showCat(g.key) }, `${name} ${g.total.toLocaleString()}개 모두 보기`)));
        }
        return;
      }
      fill(moreSlot, moreList(list, shown, (i) => row(i, st.bcat < 0), { first: 30 }));
    };
    q.addEventListener("input", paint);
    box.append(h("div", { class: "card", id: "bprices" }, h("div", { class: "row" }, h("h3", {}, `가격표 ${rows.length}개`), h("span", { class: "sp" }),
      switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); })),
      sameEnd ? h("p", { class: "tiny bdate" }, h("span", { class: "k k4" }, `~${md2(sameEnd.date)}까지`),
        sameEnd.n === sameEnd.total ? " 모든 가격"
          : ` ${sameEnd.n.toLocaleString()}개 가격이 이날까지예요. 다른 날짜는 줄마다 적어요.`) : null,
      searchBox(q, { inset: true, style: "margin-top:var(--sp-2)" }),
      h("div", { class: "chips bcats", style: "margin-top:var(--sp-2)" }, h("button", { class: "chip", type: "button", "data-c": -1, "aria-pressed": st.bcat < 0 ? "true" : "false", onclick: (e) => setCat(-1, e) }, "전체"),
        cats.map(([c, n]) => h("button", { class: "chip", type: "button", "data-c": D.meta.cats.indexOf(c), "aria-pressed": D.meta.cats.indexOf(c) === st.bcat ? "true" : "false",
          onclick: (e) => setCat(D.meta.cats.indexOf(c), e) }, `${c} ${n}`))),
      h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, [["cat", "카테고리순"], ["price", "낮은 가격순"], ["priceDesc", "높은 가격순"], ...(FLAGS.discountEmphasis ? [["med", "중간보다 싼 순"], ["disc", "할인율 큰 순"]] : [])].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": st.bsort === v ? "true" : "false", onclick: () => { st.bsort = v; render(); } }, l)))));
    box.append(h("div", { class: "card flush" }, list, moreSlot));
    paint();
    // 위계 점검 38: deep in the list, a small header keeps which branch and which 분야 (heads() shows it once the list is under
    // the app bar). Its chips are the table's 분야 (st.bcat): a tap redraws the list in place (paint — the typed words stay),
    // marks the table's own chips the same and goes back up to the table's controls
    { const card = list.closest(".card"), tbl = q.closest(".card"), own = tbl && tbl.querySelector(".chips");
      const ciOf = (n) => (n === 0 ? -1 : D.meta.cats.indexOf(cats[n - 1][0]));
      if (card && own) card.prepend(branchHead(b, cats, (ci) => {
        st.bcat = ci;
        for (const row of [own, card.querySelector(".bhead .chips")]) [...row.children].forEach((c, n) => c.setAttribute("aria-pressed", ciOf(n) === ci ? "true" : "false"));
        paint(); tbl.scrollIntoView({ block: "start" });
        const on = own.querySelector('[aria-pressed="true"]'); if (on) on.focus({ preventScroll: true }); })); }
    return box;
  };
  // the branch price list's small sticky header: the branch and the same 분야 chips as the table (order: 전체, then cats).
  // The brand (13, grey) sits over the branch's own name (15, bold), so a narrow phone keeps the part that says which branch
  // ('블리비 부산 서…' at 320 when they were on one line)
  function branchHead(b, cats, pick) {
    const chip = (ci, label) => h("button", { class: "chip", type: "button", "aria-pressed": st.bcat === ci ? "true" : "false", onclick: () => pick(ci) }, label);
    return h("div", { class: "bhead", role: "group", "aria-label": `${bname(b)} 가격표 분야` },
      h("b", { class: "bn" }, h("span", { class: "bb" }, brandOf(b)[0]), " ", h("span", { class: "bs" }, BR[b].name)),
      h("div", { class: "chips" }, chip(-1, "전체"), cats.map(([c, n]) => chip(D.meta.cats.indexOf(c), `${c} ${n}`))));
  }

  // ---------------- 지점 순위: branch price level (geometric mean of price / median over shared options)
  views.rank = () => {
    const box = h("div", { class: "view" });
    box.append(cmpNav("rank"));
    if (!FLAGS.branchRanking) { box.append(h("div", { class: "card" }, emptyBox("scale", "지점 순위는 꺼 두었어요",
      "시술별 비교에서 지점별 가격을 지역·거리·가격 순으로 정렬해 볼 수 있어요."),
      h("button", { class: "btn block", type: "button", onclick: () => nav("compare") }, "시술별 비교로 가기", icon("chevron-right", "sm")))); return box; }
    const cats = D.meta.cats.map((c, ci) => ci).filter((ci) => (D.bstat || []).some((s) => s[5] && s[5][ci] != null));
    const list = branchRanks(st.rcat);
    box.append(h("div", { class: "card" }, h("h2", {}, "지점 순위"),
      h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "같은 옵션을 파는 지점들의 중간 가격과 비교해 이 지점이 평균 몇 % 싼지(기하평균). 같은 브랜드 지점끼리 겹치는 상품이 많아요."),
      h("div", { class: "row", style: "margin-top:var(--sp-2)" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); })),
      h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, h("button", { class: "chip", type: "button", "aria-pressed": st.rcat < 0 ? "true" : "false", onclick: () => { st.rcat = -1; render(); } }, "전체"),
        cats.map((ci) => h("button", { class: "chip", type: "button", "aria-pressed": st.rcat === ci ? "true" : "false", onclick: () => { st.rcat = ci; render(); } }, D.meta.cats[ci]))),
      brandChips()));
    box.append(h("div", { class: "card flush" }, list.length ? h("ul", { class: "list" }, list.map((x, n) => { const s = D.bstat[x.b];
      return h("li", {}, h("button", { class: "rank" + (n < 3 ? " top" : ""), type: "button", onclick: () => nav(`branch/${x.b}`) },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))),
        h("span", { class: `p ${lvClass(x.lv)}` }, lvText(x.lv)),
        h("span", { class: "m" }, divBar(x.lv), h("span", {}, `제일 싼 시술 ${s[3]}개`), h("span", {}, `비교 ${s[2]}개`), dist(x.b) != null ? h("b", {}, km(dist(x.b))) : null))); }))
      : emptyLine("조건에 맞는 지점이 없어요")));
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
      jprefs().detail === "long" ? h("p", { class: "sub", style: "margin-top:var(--sp-2)" }, x.long) : h("details", { class: "fold small" }, h("summary", {}, "조금 더 자세히"), h("p", { class: "sub", style: "margin:0 0 var(--sp-2)" }, x.long)),
      h("p", { class: "tiny", style: "margin-top:var(--sp-2)" }, x.kind === "price" ? "윤실장이 가격표를 읽는 방법을 설명한 거예요(의학 정보 아님)." : "일반적인 뜻이에요(의료진 검수 전). 나에게 맞는지·얼마나 필요한지는 의료진과 상담하세요."),
      h("button", { class: "btn sm gray", type: "button", style: "margin-top:var(--sp-2)", onclick: () => { close(); nav("terms"); } }, icon("book-open", "sm"), "용어 모두 보기")));
  }
  const termBtn = (w, label = w) => termOf(w) ? h("button", { class: "termb", type: "button", "aria-label": `${label} — 뜻 보기`, onclick: (e) => { e.stopPropagation(); termSheet(w); } }, label, icon("circle-help", "xs")) : label;
  // 쉬운 용어 (#terms) lives in screens/about.js (docs/APP_JS_SPLIT_PLAN.md 3-2)

  // ---- 시술 규격 확인 (Spec): what the clinic's option name says — product, origin, dose/shots, sessions, area; unknown stays unknown
  const keysOfRow = (i) => (S[ROWS[i][7]] || "").split(" ").map((id) => KI[id]).filter((x) => x != null);
  function specOfRow(i) { const ks = keysOfRow(i), fm = ks.map((k) => famOf[k]).find(Boolean);
    return Spec.parse(S[ROWS[i][2]], { family: fm ? fm.f.name : "", label: ks.length ? KEYS[ks[0]].label : "", sess: sessOf(i) }); }
  function specOfKey(k) { const fm = famOf[k]; return Spec.parse(KEYS[k].label, { family: fm ? fm.f.name : "", label: KEYS[k].label }); }
  const SPEC_TERM = { "용량": "U(유닛)", "샷 수": "샷", "횟수": "회차", "부위": "1부위", "원산지": "국산·수입", "실 개수": "줄", "에너지": "줄" };
  const stateTag = (s) => s === "known" ? h("span", { class: "k ok" }, "확인") : s === "assumed" ? h("span", { class: "k k4" }, "추정") : kwBadge("미확인");
  const specList = (sp) => h("dl", { class: "specs" }, sp.flatMap((x) => [h("dt", {}, SPEC_TERM[x.k] ? termBtn(SPEC_TERM[x.k], x.k) : x.k), h("dd", { class: `st-${x.state}` }, h("span", {}, x.v), stateTag(x.state))]));
  // similar but different: other specs of the same family (each compared on its own) and look-alike families
  function specCard(k) {
    const sp = specOfKey(k), fm = famOf[k];
    const sibs = fm ? fm.f.vs.filter((v) => v.k !== k).map((v) => ({ v, d: Spec.diff(sp, specOfKey(v.k)) })).filter((x) => x.d.length).slice(0, 6) : [];
    const looks = fm ? FAM.filter((f) => f !== fm.f && f.fid && f.fid === fm.f.fid).slice(0, 8) : [];
    return h("section", { class: "card speccard", "aria-label": "용량·종류 확인" },
      h("div", { class: "row" }, h("h3", {}, "용량·종류 확인"), h("span", { class: "sp" }), goLink("쉬운 용어", "terms")),
      h("div", { class: "sub" }, "비교 이름에서 읽었어요. '미확인'은 이름에 없다는 뜻이에요(앱이 채우지 않아요)."),
      specList(sp),
      sibs.length ? h("div", { class: "specsib" }, h("b", {}, "비슷하지만 다른 종류(따로 비교해요)"), h("ul", { class: "plain" }, sibs.map((x) => h("li", {},
        h("button", { class: "linkbtn", type: "button", onclick: () => { st.key = x.v.k; nav(`compare?k=${encodeURIComponent(KEYS[x.v.k].id)}`); } }, x.v.label), " — ", x.d.map((d) => `${d.k} ${d.a} ↔ ${d.b}`).join(", "))))) : null,
      looks.length ? h("div", { class: "specsib" }, h("b", {}, "이름이 비슷한 다른 시술"), h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" }, looks.map((f) =>
        h("button", { class: "chip", type: "button", onclick: () => { st.key = f.vs[0].k; nav(`compare?k=${encodeURIComponent(KEYS[f.vs[0].k].id)}`); } }, f.name))),
        goLink("무엇이 다른지 시술 사전에서", "guide", { style: "margin-top:var(--sp-2)" })) : null);
  }

  // ---- 가격 적용 조건 요약 (Spec.eligibility): first visit, trial price, VAT, period, other stated limits
  const tagsOf = (i) => (S[ROWS[i][6]] || "").split("·").filter(Boolean);
  const eligOf = (i) => { const r = ROWS[i]; return Spec.eligibility({ name: S[r[2]], kind: r[5], tags: tagsOf(i).filter((t) => t === "첫 방문"), vat: r[12], until: S[r[10]] || "", today: today(),
    revisit: isRevisitRow(r), conds: priceConds(i).filter((c) => !/첫 방문|신규|체험|한정|재방문/.test(c)) }); };
  const ELIG_IC = { limit: "lock", none: "circle-check", unknown: "circle-help" }, ELIG_T = { limit: "조건 있음", none: "제한 없음", unknown: "미확인" };
  const ELIG_TERM = { "첫 방문": "첫 방문", "체험 가격": "체험가", "부가세": "부가세 별도" };
  const eligList = (i) => h("ul", { class: "elig" }, eligOf(i).map((x) => h("li", { class: `el-${x.state}` }, h("span", { class: "ei2" }, icon(ELIG_IC[x.state], "sm")),
    h("span", { class: "ek" }, ELIG_TERM[x.k] ? termBtn(ELIG_TERM[x.k], x.k) : x.k), h("span", { class: "ev" }, x.v), h("span", { class: "sr" }, ` (${ELIG_T[x.state]})`))));
  // short form for comparison rows: only the stated limits, plus how many things are not stated
  // in the badge order of every price line (위계 점검 29): conditions (butter) → an event that has ended (coral: a price that
  // cannot be had, like '기간 끝남') and 미확인 (grey + icon) → the end date, the grey date badge of every line ('~10/31까지')
  const eligChips = (i) => { const e = eligOf(i), lim = e.filter((x) => x.state === "limit"), unk = e.filter((x) => x.state === "unknown").length;
    const end = lim.find((x) => x.k === "기간"), u = S[ROWS[i][10]] || "", ended = !!end && u < today();
    return [...lim.filter((x) => x !== end).map((x) => h("span", { class: "k kc" }, x.k === "부가세" ? "부가세 별도" : x.k === "체험 가격" ? x.v.split(" — ")[0] : x.k)),
      ended ? h("span", { class: "k kx" }, end.v) : null, unk ? kwBadge(`미확인 ${unk}`) : null, end && !ended ? h("span", { class: "k k4" }, `~${md2(u)}까지`) : null]; };

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
    // the toast every 담기 has (jomiToast — 2026-10-20 디자인 통일 U13; DESIGN_SYSTEM §3 '담은 뒤 알림은 어느 길로 담아도 같아요'): a fixed
    // first line with the count, the next step under it (not with 죠미 '끄기'), and one action — 되돌리기, or 빠른 비교 from two places.
    // It was a plain one-line toast cut to '한 곳 더 담으면 비교할 수 …' with no 되돌리기
    jomiToast("happy", `비교함에 담았어요 (${n}/${SHORT_MAX})`, n >= 2 ? ["빠른 비교", () => nav("quick")] : ["되돌리기", () => { store.set("short", L); render(); toast("되돌렸어요"); }],
      jprefs().freq === "off" ? null : n >= 2 ? `빠른 비교에서 ${n}곳을 나란히 볼 수 있어요.` : "한 곳 더 담으면 나란히 비교할 수 있어요.");
    return true;
  }
  // a button that shows and flips the state in place (works inside sheets, no page redraw)
  // a button that leaves the app (a clinic's site, the map app): its own icon, the words, and ↗ — the screen reader hears that
  // it opens elsewhere (위계 점검 35)
  const outLink = (href, ic, label) => h("a", { class: "btn sm gray out", href, target: "_blank", rel: "noopener" }, icon(ic, "sm"), label,
    icon("arrow-up-right", "xs"), h("span", { class: "sr" }, " — 새 창에서 열려요"));
  // 비교함에 있음 is a list the branch is in (like 담김), not one choice among others: the icon and words change and it turns 담김's
  // light green (.shortbtn[aria-pressed=true], 사용자 결정 2026-10-20 — the same state, the same look)
  const shortBtn = (b, cls = "btn sm gray") => { const el = h("button", { class: `${cls} shortbtn`, type: "button" });
    const paint = () => { const on = inShort(b); el.setAttribute("aria-pressed", on ? "true" : "false"); fill(el, icon(on ? "check" : "circle-plus", "sm"), on ? "비교함에 있음" : "비교함"); };
    el.addEventListener("click", (e) => { e.stopPropagation(); toggleShort(b); paint(); }); paint(); return el; };
  const shortLink = () => { const n = shortKeys().length; return n ? goLink(`비교함 ${n}/${SHORT_MAX} 보기`, "quick") : null; };
  function pickBranchSheet(title, except, done) {
    sheet(title, (close) => { let v = BR.find((x) => !except.includes(x.i) && regionOk(x.i))?.i ?? 0;
      return h("div", {}, brSelect(v, (x) => { v = x; }, "지점"), h("button", { class: "btn", type: "button", style: "width:100%;margin-top:var(--sp-3)", onclick: () => { if (except.includes(v)) { toast("이미 비교함에 있는 지점이에요"); return; } close(); done(v); } }, "고르기")); });
  }
  views.quick = (arg, params) => {
    const box = h("div", { class: "view" });
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
    const bs = shortList();
    const setL = (L) => { store.set("short", L.map((b) => bkey(b))); render(); };
    box.append(h("div", { class: "card" }, h("h2", {}, "빠른 비교"),
      h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, `지점 2~${SHORT_MAX}곳을 나란히 봐요(이 휴대폰에만 저장).`),
      h("ul", { class: "shortl" }, bs.map((b, n) => h("li", {}, bdot(b), h("b", {}, bname(b)), h("span", { class: "sp" }),
        h("button", { class: "linkbtn", type: "button", onclick: () => pickBranchSheet(`${bname(b)} 대신`, bs, (v) => { const L = [...bs]; L[n] = v; setL(L); }) }, "바꾸기"),
        h("button", { class: "tbtn-i", type: "button", "aria-label": `${bname(b)} 빼기`, onclick: () => { const before = bs; setL(bs.filter((x) => x !== b)); undoToast("비교함에서 뺐어요", () => setL(before)); } }, icon("x", "sm"))))),
      bs.length < SHORT_MAX ? h("button", { class: "btn sm gray", type: "button", onclick: () => pickBranchSheet("비교함에 지점 추가", bs, (v) => setL([...bs, v])) }, icon("circle-plus", "sm"), `지점 추가 (${bs.length}/${SHORT_MAX})`) : null));
    if (bs.length < 2) {
      const F = favs(), sug = [...new Set([...F.b.map((x) => BK.get(x)), ...store.get("recent", []).filter((x) => x.startsWith("b:")).map((x) => BK.get(x.slice(2)))])].filter((b) => b != null && BR[b] && !bs.includes(b)).slice(0, 6);
      box.append(h("div", { class: "card" }, jomiEmpty("cart", "비교할 지점을 2곳 이상 담아 줘",
        h("p", { class: "sub" }, "지점 화면이나 가격 정보의 '비교함', 또는 위 '지점 추가'로 담아요."),
        sug.length ? h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2);justify-content:center" }, sug.map((b) => h("button", { class: "chip", type: "button", onclick: () => setL([...bs, b]) }, icon("circle-plus", "xs"), bname(b)))) : null)));
      return box;
    }
    // the treatment: from the address (?k=), else the one being compared, else the cart's first, else the most shared
    const cand = KEYS.map((k) => ({ k: k.i, n: bs.filter((b) => bestAt(k.i, b) >= 0).length })).filter((x) => x.n >= 1).sort((a, c) => c.n - a.n || byKB[c.k].size - byKB[a.k].size);
    const cartK = cur().items.filter((it) => it.t === "k" && KI[it.k] != null).map((it) => KI[it.k]);
    const want = params.get("k") != null ? KI[params.get("k")] : null;
    const k = [want, st.qk, st.key, ...cartK].find((x) => x != null && cand.some((c) => c.k === x)) ?? (cand[0] && cand[0].k);
    if (k == null) { box.append(h("div", { class: "card" }, emptyBox("scale", "함께 파는 시술이 없어요", "담은 지점들이 함께 파는 시술이 없어요. 지점을 바꿔 보세요."))); return box; }
    st.qk = k;
    const go = (x) => { st.qk = x; history.replaceState(null, "", `#quick?k=${encodeURIComponent(KEYS[x].id)}`); render(); };
    const sel = h("select", { class: "pick", "aria-label": "비교할 시술", onchange: (e) => go(+e.target.value) }, cand.slice(0, 400).map((c) => h("option", { value: c.k, selected: c.k === k }, `${KEYS[c.k].label} · ${c.n}/${bs.length}곳`)));
    box.append(h("div", { class: "card" }, h("label", { class: "flabel" }, "비교할 시술", sel),
      cartK.length ? h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, h("span", { class: "sub", style: "align-self:center;flex:none" }, "내 견적"), [...new Set(cartK)].map((x) => h("button", { class: "chip", type: "button", "aria-pressed": x === k ? "true" : "false", onclick: () => go(x) }, KEYS[x].label))) : null,
      h("div", { class: "row", style: "margin-top:var(--sp-2)" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }))));
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
      h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, KEYS[k].label),
        h("div", { class: "sub" }, sp.filter((x) => x.state === "known" && x.k !== "시술").map((x) => `${x.k} ${x.v}`).join(" · ") || "이름에 용량·종류가 없어요"),
        ok.length >= 2 ? h("div", { class: "vsum", style: "margin-top:var(--sp-2)" }, lo === hi ? "고른 지점의 가격이 같아요" : `고른 ${ok.length}곳 사이 최대 ${won(hi - lo)} 차이`)
          : h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "같은 시술을 파는 곳이 1곳뿐이라 차이를 계산하지 않아요.")),
      h("ul", { class: "list qrows" }, rows.map((x) => x.i >= 0
        ? h("li", { class: "qrow2" }, h("div", { class: "row" }, bdot(x.b), h("b", { class: "qn" }, bname(x.b)), h("span", { class: "sp" }), h("b", { class: "num qp" }, won(x.p))),
          h("span", { class: "qbar", "aria-hidden": "true" }, h("i", { class: x === base ? "base" : "", style: `width:${hi ? Math.max(6, x.p / hi * 100) : 100}%` })),
          h("div", { class: "m" }, h("span", { class: "qd" }, ok.length < 2 ? "비교할 다른 곳 없음" : vsBase(x)), ...eligChips(x.i),
            x !== base && ok.length >= 2 ? h("button", { class: "linkbtn", type: "button", onclick: () => toFront(x.b) }, "기준으로") : null,
            h("span", { class: "tiny" }, `확인 ${md(verified(x.b))}`), srcLink(x.i), h("button", { class: "linkbtn", type: "button", onclick: () => priceSheet(x.i) }, icon("info", "xs"), "가격 정보")))
        : h("li", { class: "qrow2 na" }, h("div", { class: "row" }, bdot(x.b), h("b", { class: "qn" }, bname(x.b)), h("span", { class: "sp" }), h("span", { class: "k k4" }, "비교 불가")),
          h("div", { class: "m" }, h("span", {}, "같은 용량·횟수·원산지 가격이 없어요."),
            ...other(x.b).map((o) => h("span", {}, `비슷한 종류: ${o.v.label} ${won(ROWS[o.i][3])} — ${Spec.diff(sp, specOfKey(o.v.k)).map((d) => `${d.k}가 달라`).join(", ") || "종류가 달라"} 비교하지 않아요`)))))),
      h("div", { class: "row qact" }, h("button", { class: "btn sm gray", type: "button", onclick: () => checklistSheet({ id: `k:${KEYS[k].id}`, title: KEYS[k].label, k }) }, icon("list-checks", "sm"), "방문 전 체크리스트"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => saveSnap(snapOfKey(k, bs)) }, icon("bookmark", "sm"), "이 비교 저장"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => reportView(k, bs) }, icon("file-text", "sm"), "비교 보고서"), addBtn(k))));
    box.append(coverageCard(bs));
    box.append(h("p", { class: "foot" }, `${vatNote()} 정품 여부·의료진·부작용은 병원에 확인하세요.`));
    return box;
  };

  // ---- 지점별 제공 시술 표 (coverage): the cart's items × the shortlist; '없음' and '확인 안 됨' are never counted as offered
  function coverageCard(bs) {
    const its = cur().items;
    if (!its.length || bs.length < 1) return h("div", { class: "card sub" }, "내 견적에 시술을 담으면, 고른 지점마다 어떤 시술을 하는지 한 표로 보여줘요.");
    const lines = bs.map((b) => cartLinesAt(b, its));
    const cell = (j, n) => { const l = lines[n][j], b = bs[n];
      return l ? h("td", { class: "num", title: l.incomplete ? incTxt(l) : null }, l.incomplete ? `1회 ${won(l.total)}만` : won(l.total)) : fresh(b).stale ? h("td", { class: "cov-q" }, "확인 안 됨") : h("td", { class: "cov-x" }, "없음"); };
    const tot = bs.map((b, n) => { const got = lines[n].filter(okL); return { b, sum: got.reduce((s, l) => s + l.total, 0), miss: its.length - got.length }; });
    return h("section", { class: "card flush", "aria-label": "지점별 제공 시술" },
      h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "지점별 제공 시술"), h("div", { class: "sub" }, `'${cur().name}'의 ${its.length}개 시술 · 내 견적과 같은 계산(수량·첫 방문가 1개)`)),
      h("div", { class: "covwrap", tabindex: "0", role: "region", "aria-label": "지점별 제공 시술 표(옆으로 넘겨 보기)" }, h("table", { class: "cov" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "시술"), bs.map((b) => h("th", { scope: "col" }, BR[b].name)))),
        h("tbody", {}, its.map((it, j) => h("tr", {}, h("th", { scope: "row" }, `${itemLabel(it)} ×${it.q || 1}`), bs.map((_, n) => cell(j, n))))),
        h("tfoot", {}, h("tr", {}, h("th", { scope: "row" }, "있는 시술 합계"), tot.map((x) => h("td", { class: "num" }, won(x.sum), x.miss ? h("small", {}, ` · ${x.miss}개 없음`) : null)))))),
      h("p", { class: "tiny", style: "padding:var(--sp-2) 14px var(--sp-3)" }, "'없음' = 이번 주 그 지점 가격표에 같은 시술이 없어요. '확인 안 됨' = 그 지점 수집이 이번 주 실패했어요. 둘 다 0원으로 치지 않고 합계에서 뺐어요."));
  }

  // ---- 비교 보고서: chosen treatments (cart) or one treatment × the chosen branches, with conditions and the time it was made
  const stamp = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  function reportText(k, bs) {
    const at = new Date().toISOString(), its = cur().items;
    const head = [`[윤실장 비교 보고서] ${stamp(at)} 작성 · 가격 데이터 ${D.meta.updated} 수집 · ${st.vat === "incl" ? "부가세 포함가" : "병원 표시가"}`];
    if (its.length) {
      const lines = bs.map((b) => cartLinesAt(b, its)), full = bs.map((b, n) => lines[n].every(okL) ? lines[n].reduce((s, l) => s + l.total, 0) : null), baseT = full.find((x) => x != null);
      const vsT = (t) => t === baseT ? " (기준)" : ` (기준보다 ${t > baseT ? "+" : "−"}${won(Math.abs(t - baseT))})`;
      head.push(`시술: ${its.map((it) => `${itemLabel(it)} ×${it.q || 1}`).join(", ")}`, "지점별 예상 총액(내 견적 계산과 같음):");
      bs.forEach((b, n) => { const got = lines[n].filter(okL), miss = its.filter((_, j) => !okL(lines[n][j])), sp = got.filter((l) => l.special).length;
        head.push(full[n] != null ? `- ${bname(b)}: ${won(full[n])}${full.filter((x) => x != null).length > 1 ? (n === full.findIndex((x) => x != null) ? " (기준)" : vsT(full[n]).replace(" (기준)", " (기준과 같음)")) : ""}${sp ? ` · 특가 ${sp}개 포함` : ""}`
          : `- ${bname(b)}: 일부만 가능 — 없음: ${miss.map(itemLabel).join(", ")} (있는 것만 ${won(got.reduce((s, l) => s + l.total, 0))}, 총액 비교에서 뺌)`); });
      head.push(`가격 적용 조건: 체험가·한정가·첫 방문가는 첫 1회만(다음 가격이 없으면 2회째부터 가격 없음으로 빼요), 요일·시간 조건 가격은 회마다 그 가격${st.noStack ? ", 첫 방문가는 지점마다 1개만" : ""}. 없는 시술은 0원으로 치지 않았어요.`);
    } else {
      const rows = bs.map((b) => ({ b, i: bestAt(k, b) })), ok = rows.filter((x) => x.i >= 0), bp = ok.length ? ROWS[ok[0].i][3] : 0;
      head.push(`시술: ${KEYS[k].label} ×1 (같은 시술끼리)`);
      rows.forEach((x) => { if (x.i < 0) { head.push(`- ${bname(x.b)}: 같은 시술 없음(비교 불가)`); return; }
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
      h("div", { class: "row", style: "margin-top:var(--sp-3)" },
        h("button", { class: "btn sm gray", type: "button", onclick: () => copyText(rep.text, "보고서를 복사했어요") }, icon("copy", "sm"), "복사"),
        h("button", { class: "btn sm gray", type: "button", onclick: async () => { try { if (navigator.share) { await navigator.share({ title: "윤실장 비교 보고서", text: rep.text }); return; } } catch (e) { if (e && e.name === "AbortError") return; } copyText(rep.text, "공유 기능이 없어 복사했어요"); } }, icon("share-2", "sm"), "공유"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { saveSnap({ id: newId(), at: rep.at, data: D.meta.updated, kind: "report", title: `보고서 · ${cur().items.length ? cur().name : KEYS[k].label}`, text: rep.text }); close(); } }, icon("bookmark", "sm"), "보관")),
      h("p", { class: "tiny", style: "margin-top:var(--sp-2)" }, "이 휴대폰에서 만든 글이에요. 서버로 보내지 않아요.")));
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
    if (!s) { box.append(h("div", { class: "card" }, jomiEmpty("empty", "저장한 비교를 찾지 못했어요", "지웠거나 다른 휴대폰에서 저장했을 수 있어요."))); return box; }
    const del = h("button", { class: "btn sm gray", type: "button", onclick: () => { store.set("snaps", L.filter((x) => x.id !== s.id)); nav("saved"); undoToast("저장한 비교를 지웠어요", () => store.set("snaps", L)); } }, icon("trash-2", "sm"), "지우기");
    const same = s.data === D.meta.updated;
    box.append(h("div", { class: "card" }, h("h2", {}, s.title), h("dl", { class: "kv", style: "margin-top:var(--sp-2)" },
      h("dt", {}, "저장한 때"), h("dd", {}, `${mdhm(s.at)} (${md(s.data)} 수집 가격)`), h("dt", {}, "지금 가격"), h("dd", {}, `${md(D.meta.updated)} 수집`),
      s.region ? [h("dt", {}, "조건"), h("dd", {}, `${s.region} · ${s.vatMode === "incl" ? "부가세 포함가" : "병원 표시가"} · 특가 ${s.special ? "포함" : "제외"}`)] : null),
      h("p", { class: "sub", style: "margin-top:var(--sp-2)" }, same ? "저장한 뒤 가격 데이터가 아직 갱신되지 않았어요. 그래서 '저장 시점'과 '지금'이 같아요." : "왼쪽은 저장한 때의 가격, 오른쪽은 지금 데이터의 가격이에요."),
      h("div", { class: "row", style: "margin-top:var(--sp-2)" }, s.k && KI[s.k] != null ? h("button", { class: "btn sm", type: "button", onclick: () => nav(`compare?k=${encodeURIComponent(s.k)}`) }, "지금 비교 화면 열기") : null, del)));
    if (s.kind === "report") { box.append(h("div", { class: "card" }, h("pre", { class: "report" }, s.text), h("button", { class: "btn sm gray", type: "button", style: "margin-top:var(--sp-2)", onclick: () => copyText(s.text, "복사했어요") }, icon("copy", "sm"), "복사"))); return box; }
    const k = KI[s.k];
    const shown = (listed, vat) => Pricing.vatPrice(listed, vat, s.vatMode);
    box.append(h("div", { class: "card flush" }, h("div", { class: "covwrap" }, h("table", { class: "cov snapt" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "지점"), h("th", { scope: "col" }, "저장 시점"), h("th", { scope: "col" }, "지금"))),
      h("tbody", {}, s.items.map((x) => { const b = BK.get(x.b), i = k != null && b != null ? bestAt(k, b, s.special) : -1, now = i >= 0 ? shown(ROWS[i][14], ROWS[i][12]) : null, then = x.none ? null : shown(x.listed, x.vat);
        return h("tr", {}, h("th", { scope: "row" }, x.name, x.ver ? h("small", {}, ` · 확인 ${md(x.ver)}`) : null), h("td", { class: "num" }, then != null ? won(then) : "없었음"),
          h("td", { class: `num ${now != null && then != null && now !== then ? (now < then ? "down" : "up") : ""}` }, now != null ? won(now) : "지금 없음", now != null && then != null && now !== then ? h("small", {}, ` (${now < then ? "▼" : "▲"} ${won(Math.abs(now - then))})`) : null)); }))))));
    return box;
  }

  // ---- 방문 전 체크리스트: questions to ask before booking, from what the price says (and doesn't); checks kept on this phone
  function checklistItems(ctx) {
    const out = [], i = ctx.i, sp = i != null ? specOfRow(i) : ctx.k != null ? specOfKey(ctx.k) : [], el = i != null ? eligOf(i) : [];
    const g = (k) => el.find((x) => x.k === k);
    out.push(["incl", "가격 포함 범위", "이 가격에 마취크림·진정 관리·재료비가 들어 있나요?"]);
    const v = g("부가세");
    out.push(["vat", "부가세", v ? (v.state === "limit" ? "결제할 땐 부가세 포함 얼마인가요? (사이트 표기: 부가세 별도)" : v.state === "none" ? "부가세 포함 가격이 맞나요?" : "부가세가 포함된 가격인가요? (사이트에서 표기를 찾지 못했어요)") : "결제 금액에 부가세가 포함되나요?"]);
    const fv = g("첫 방문"), rv = g("재방문"), tr = g("체험 가격"), pd = g("기간");
    if ((fv && fv.state === "limit") || rv || (tr && tr.state === "limit")) out.push(["promo", "가격 조건", `제가 이 가격 조건(${[fv && fv.state === "limit" ? "첫 방문" : "", rv ? "재방문" : "", tr && tr.state === "limit" ? tr.v.split(" — ")[0] : ""].filter(Boolean).join(", ")})에 해당하나요?`]);
    else out.push(["promo", "가격 조건", "이 가격에 첫 방문·1인 1회 같은 조건이 있나요?"]);
    if (pd && pd.state === "limit") out.push(["period", "기간", `${pd.v} 가격이면, 그 안에 시술해야 하나요 아니면 예약만 하면 되나요?`]);
    for (const x of sp) {
      if (x.k === "제품·장비") out.push(["prod", "용량·종류", x.state === "known" ? `${x.v} 정품을 쓰나요? 확인할 수 있나요?` : "어떤 제품(제조사·원산지)을 쓰나요?"]);
      if (x.k === "용량·샷 수") out.push(["dose", "용량·종류", "용량(U·cc)이나 샷 수가 얼마인가요?"]);
      if ((x.k === "용량" || x.k === "샷 수") && x.state === "known") out.push(["dose", "용량·종류", `${x.k} ${x.v}가 맞나요? 상담 뒤 바뀔 수 있나요?`]);
      if (x.k === "부위") out.push(["area", "용량·종류", x.state === "known" ? `'${x.v}'의 범위가 어디부터 어디까지인가요?` : "어느 부위·범위까지인가요?"]);
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
        h("div", { class: "row", style: "margin-top:var(--sp-2)" }, h("button", { class: "btn sm gray", type: "button", onclick: () => copyText([`[방문 전 체크리스트] ${ctx.title}`, ...items.map(([id, grp, q]) => `${done.has(id) ? "☑" : "☐"} ${q}`)].join("\n"), "체크리스트를 복사했어요") }, icon("copy", "sm"), "복사"),
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
    const gl = Math.min(...regs.map((x) => x.lo)), gh = Math.max(...regs.map((x) => x.hi));
    // a line per region, the same line as '가격 종류별 범위' (axisLine): its name, 'N곳 · lo~hi원', then its range bar on the
    // card's one scale with '중간값 X원' under the dot — every bar the card's full width, so the regions are read on the same
    // scale (the bar used to share a line with the words, and its width followed the words': 102~110px at 390, 32~40px at 320).
    // The first 8 regions (most branches first), then the shared '더 보기' — 17 lines of a bar and a label made the card
    // 1,072px tall at 390. The scale is every region's, so the lines added later sit on it too; how many are shown stays
    // across redraws of the same procedure
    const ul = h("ul", { class: "regl" }), kid = KEYS[k].id, keep = st.regN && st.regN.k === kid ? st.regN.n : 0;
    const more = moreList(ul, regs, (x) => { const L = axisLine(x.rg, x.n < 3 ? h("span", { class: "k k4" }, "지점 적음") : null, x.n, x.lo, x.hi, x.med, [gl, gh]);
      return h("li", { "aria-label": L.name }, L.kids); }, { first: Math.max(8, keep), name: "지역", onMore: (n) => { st.regN = { k: kid, n }; } });
    return h("section", { class: "card", "aria-label": "지역별 같은 사양 가격" }, h("h3", {}, "지역별 가격"),
      h("div", { class: "sub" }, "일반가 · 전국(위 지역 선택과 상관없이) · 점 아래 숫자는 중간 가격"),
      ul, axisEnds(gl, gh),
      regs.some((x) => x.n < 3) ? h("p", { class: "tiny", style: "margin-top:var(--sp-2)" }, "3곳 미만인 지역은 지역 차이로 보기 어려워요.") : null,
      more);
  }

  // ---- 관심 시술 대시보드 + 업데이트 소식 (only what the weekly data actually recorded)
  function watchCard(favK) {
    if (!favK.length) return null;
    const tr = TR();
    return h("section", { class: "card flush", "aria-label": "관심 시술 가격" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "관심 시술 가격"),
      h("div", { class: "sub" }, `${regionName()} · 일반가의 중간 가격 · ${md(D.meta.updated)} 수집`)),
      h("ul", { class: "list" }, favK.map((k) => { const pl = plainRanking(k), ps = pl.map((x) => x.p), ch = keyChange(KEYS[k].id), last = pl.map((x) => verified(x.b)).sort().pop();
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k; nav(`compare?k=${encodeURIComponent(KEYS[k].id)}`); } },
          h("span", { class: "t row", style: "flex-wrap:nowrap" }, catIcon(KEYS[k].cat, "sm"), KEYS[k].label),
          h("span", { class: "p num" }, ps.length ? won(median(ps)) : "-"),
          h("span", { class: "m" }, ps.length ? [h("span", { class: "num" }, rangeEl(Math.min(...ps), Math.max(...ps))), h("span", {}, `${ps.length}곳`)] : h("span", {}, "지금 일반가가 없어요"),
            tr.dates.length > 1 ? chg(ch) : h("span", {}, "변화: 기록이 한 번뿐이라 아직 몰라요"), last ? h("span", {}, `확인 ${md(last)}`) : null))); })));
  }
  function feedCard(favK) {
    const want = new Set(favK), items = (D.changes || []).filter(([kid]) => want.has(kid)).slice(0, 30);
    return h("section", { class: "card", "aria-label": "관심 시술 업데이트" }, h("h3", {}, "관심 시술 가격 변동"),
      h("div", { class: "sub" }, D.meta.prev ? `${md(D.meta.prev)} → ${md(D.meta.updated)} 수집` : "매주 월요일, 관심 시술에서 바뀐 가격이 여기에 쌓여요."),
      items.length ? h("ul", { class: "list" }, items.map(([kid, b, before, after]) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, KEYS[kid].label),
          h("span", { class: `p num ${after < before ? "down" : "up"}` }, `${won(before)} → ${won(after)}`), h("span", { class: "m" }, bdot(b), bname(b))))))
          : emptyLine(D.meta.prev ? "지난 기록과 비교해 바뀐 관심 시술 가격이 없어요." : `첫 기록(${md(D.meta.updated)} 수집)이라 다음 수집부터 보여요.`));
  }
  function snapsCard() {
    const L = store.get("snaps", []);
    if (!L.length) return null;
    return h("section", { class: "card flush", "aria-label": "저장한 비교" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, `저장한 비교 ${L.length}개`), h("div", { class: "sub" }, "저장한 때의 가격과 지금 가격을 나란히 봐요 · 이 휴대폰에만 있어요")),
      h("ul", { class: "list" }, L.map((s) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`snap/${s.id}`) },
        h("span", { class: "t row", style: "flex-wrap:nowrap" }, icon(s.kind === "report" ? "file-text" : "bookmark", "sm"), s.title),
        h("span", { class: "sub" }, stamp(s.at)), h("span", { class: "m" }, s.kind === "report" ? "보고서" : `${s.kind === "quick" ? "빠른 비교" : "시술 비교"} · ${(s.items || []).length}곳 · 데이터 ${s.data}`))))));
  }
  function myReportsCard() {
    const reps = store.get("reports", []);
    if (!reps.length) return null;
    const VIA = { demo: "기기에만 저장(데모 · 서버 접수 아님)", github: "GitHub 등록 화면을 열었어요(제출했는지는 GitHub에서 확인)", copy: "내용을 복사했어요(직접 보내야 해요)" };
    return h("section", { class: "card flush", "aria-label": "내 가격 확인 요청" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, `가격 확인 요청 ${reps.length}개`)),
      h("ul", { class: "list" }, reps.slice(0, 10).map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, x.n), h("span", { class: "sub" }, md(x.at)),
        h("span", { class: "m" }, `${String(x.br || "").replace("|", " ")} · ${x.why}`, (x.via === "github" ? h("span", { class: "k k4" }, VIA[x.via]) : kwBadge(VIA[x.via] || "기기에 기록(예전 방식)"))))))));
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
      h("div", { class: "vpick" }, h("label", { class: "flabel" }, h("span", { class: "row" }, h("span", { class: "key", style: "background:var(--s1)" }), "A 지점"), brSelect(A, (v) => { st.vsA = v; render(); }, "A 지점")),
        h("button", { class: "swap", type: "button", "aria-label": "A와 B 바꾸기", onclick: () => { [st.vsA, st.vsB] = [st.vsB, st.vsA]; render(); } }, icon("arrow-down-up")),
        h("label", { class: "flabel" }, h("span", { class: "row" }, h("span", { class: "key", style: "background:var(--s2)" }), "B 지점"), brSelect(B, (v) => { st.vsB = v; render(); }, "B 지점"))),
      h("div", { class: "row", style: "margin-top:var(--sp-2)" },
        ["A", "B"].map((w) => h("button", { class: "btn sm gray", type: "button", onclick: () => { const cur0 = w === "A" ? st.vsA : st.vsB, other = w === "A" ? st.vsB : st.vsA;
          const sib = BR.filter((y) => y.brand === BR[cur0].brand && regionOk(y.i) && y.i !== other).sort((p, q) => p.name.localeCompare(q.name, "ko"));
          const n = sib.findIndex((y) => y.i === cur0), nx = sib[(n + 1) % sib.length]; if (!nx) return; if (w === "A") st.vsA = nx.i; else st.vsB = nx.i; render(); } }, `${w}: 같은 브랜드 다음 지점`))),
      h("div", { class: "row", style: "margin-top:var(--sp-2)" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }),
        switchEl("차이 있는 것만", st.vsDiff, (v) => { st.vsDiff = v; render(); }),
        cur().items.length ? switchEl("내 견적 시술만", !!st.vsCart, (v) => { st.vsCart = v; render(); }) : null)));
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
        shared.length ? h("div", { class: "vsum", style: "margin-top:var(--sp-2)" }, ta === tb ? "두 지점 합계가 같아요" : cheaperTxt(A, B, ta, tb)) : h("div", { class: "vsum", style: "margin-top:var(--sp-2)" }, "두 지점이 함께 하는 시술이 없어요"),
        shared.length ? h("dl", { class: "kv", style: "margin-top:var(--sp-2)" }, h("dt", {}, "A 합계"), h("dd", { class: "num" }, won(ta)), h("dt", {}, "B 합계"), h("dd", { class: "num" }, won(tb))) : null,
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, `둘 다 하는 ${shared.length}개만 더했어요. 한쪽에 없는 시술은 0원으로 치지 않고 아래에 따로 적었어요.${st.noStack ? " 첫 방문가는 지점마다 하나만 넣었어요." : ""}`)));
      const row = (x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, `${itemLabel(x.it)} ×${x.it.q || 1}`),
        h("span", { class: "p num" }, x.a && x.b ? (x.a.total === x.b.total ? "같음" : won(Math.abs(x.a.total - x.b.total)) + " 차이") : "한쪽 없음"),
        h("span", { class: "m" }, x.a && x.b ? pairBars(x.a.total, x.b.total) : null,
          h("span", { class: "row", style: "gap:var(--sp-1)" }, h("span", { class: "key", style: "background:var(--s1)" }), x.a ? h("b", {}, won(x.a.total)) : h("span", { class: "unav" }, "없음")),
          h("span", { class: "row", style: "gap:var(--sp-1)" }, h("span", { class: "key", style: "background:var(--s2)" }), x.b ? h("b", {}, won(x.b.total)) : h("span", { class: "unav" }, "없음")),
          x.a && x.b && x.a.total !== x.b.total ? h("span", { class: "vwin" }, cheaperTxt(A, B, x.a.total, x.b.total)) : null)));
      box.append(h("div", { class: "card flush" }, vsHead(), h("ul", { class: "list" }, [...shared, ...onlyA, ...onlyB, ...none].map(row)),
        onlyA.length || onlyB.length || none.length ? h("div", { class: "sub", style: "padding:var(--sp-2) 14px var(--sp-3)" },
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
    if (!items.length) { box.append(h("div", { class: "card" }, emptyBox("scale", "함께 파는 옵션이 없어요", "같은 브랜드 지점끼리 비교해 보세요."))); return box; }
    const lg = items.reduce((s, x) => s + Math.log(x.a / x.b), 0) / items.length, ratio = Math.exp(lg);
    const win = items.filter((x) => x.a < x.b).length, lose = items.filter((x) => x.a > x.b).length, tie = items.length - win - lose;
    box.append(h("div", { class: "card" },
      h("div", { class: "vsum" }, Math.abs(ratio - 1) < 0.005 ? "두 지점 가격이 거의 같아요" : ratio < 1 ? `A가 B보다 평균 ${Math.round((1 - ratio) * 100)}% 싸요` : `B가 A보다 평균 ${Math.round((1 - 1 / ratio) * 100)}% 싸요`),
      h("div", { class: "sub" }, `${bname(A)} vs ${bname(B)} · 함께 파는 옵션 ${items.length}개`),
      h("div", { class: "vbar", role: "img", "aria-label": `A가 싼 옵션 ${win}개, 같음 ${tie}개, B가 싼 옵션 ${lose}개` },
        win ? h("i", { style: `flex:${win};background:var(--s1)` }) : null, tie ? h("i", { style: `flex:${tie};background:var(--line)` }) : null, lose ? h("i", { style: `flex:${lose};background:var(--s2)` }) : null),
      h("div", { class: "stats" }, h("div", {}, h("b", { class: "num" }, win), h("span", {}, "A가 더 쌈")), h("div", {}, h("b", { class: "num" }, tie), h("span", {}, "같음")), h("div", {}, h("b", { class: "num" }, lose), h("span", {}, "B가 더 쌈"))),
      h("button", { class: "btn sm gray", type: "button", style: "margin-top:var(--sp-2)", onclick: () => copyText([`[지점 비교] A ${bname(A)} vs B ${bname(B)} (${D.meta.updated} 기준)`,
        `함께 파는 옵션 ${items.length}개 · A가 더 쌈 ${win} · 같음 ${tie} · B가 더 쌈 ${lose}`,
        ratio < 1 ? `A가 평균 ${Math.round((1 - ratio) * 100)}% 쌈` : ratio > 1 ? `B가 평균 ${Math.round((1 - 1 / ratio) * 100)}% 쌈` : "평균 같음",
        ...items.filter((x) => x.a !== x.b).sort((p, q) => Math.abs(q.a - q.b) - Math.abs(p.a - p.b)).slice(0, 5).map((x) => `- ${x.name}: A ${won(x.a)} / B ${won(x.b)}`)].join("\n"), "비교 결과를 복사했어요") }, "비교 결과 복사"),
      h("button", { class: "btn sm gray", type: "button", style: "margin:var(--sp-2) 0 0 var(--sp-2)", onclick: () => shareLink(`윤실장 · ${bname(A)} vs ${bname(B)}`, `versus/${A}/${B}`) }, icon("share-2", "sm"), "링크 공유")));
    // treatments only one of the two sells (same comparison key) — shown, not silently dropped
    const onlyAt = (x, y) => KEYS.filter((k) => bestAt(k.i, x) >= 0 && bestAt(k.i, y) < 0);
    const oa = onlyAt(A, B), ob = onlyAt(B, A);
    if (oa.length || ob.length) box.append(h("details", { class: "card flush fold" }, h("summary", {}, `한쪽에만 있는 시술: A에만 ${oa.length}개 · B에만 ${ob.length}개`),
      h("div", { style: "padding:0 14px var(--sp-3)" }, h("div", { class: "sub" }, "같은 용량·횟수로 묶은 시술 기준이에요. 아래 목록은 두 지점이 함께 파는 것만 맞대요."),
        oa.length ? h("p", { class: "sub" }, h("b", {}, `A ${bname(A)}: `), oa.slice(0, 30).map((k) => k.label).join(", "), oa.length > 30 ? ` 외 ${oa.length - 30}개` : "") : null,
        ob.length ? h("p", { class: "sub" }, h("b", {}, `B ${bname(B)}: `), ob.slice(0, 30).map((k) => k.label).join(", "), ob.length > 30 ? ` 외 ${ob.length - 30}개` : "") : null)));
    const cats = [...new Set(items.map((x) => x.cat))].sort((p, q) => p - q);
    if (st.vcat >= 0 && !cats.includes(st.vcat)) st.vcat = -1;
    const q = h("input", { type: "search", placeholder: "옵션 이름으로 찾기", "aria-label": "옵션 찾기" });
    const list = h("ul", { class: "list" }), moreSlot = h("div", {});
    const paint = () => {
      const w = q.value.trim().toLowerCase();
      let shown = items.filter((x) => (st.vcat < 0 || x.cat === st.vcat) && (!st.vsDiff || x.a !== x.b) && (!w || x.name.toLowerCase().includes(w)));
      const so = { diff: (p, r) => Math.abs(Math.log(r.a / r.b)) - Math.abs(Math.log(p.a / p.b)), name: (p, r) => p.name.localeCompare(r.name, "ko"), a: (p, r) => p.a / p.b - r.a / r.b, b: (p, r) => r.a / r.b - p.a / p.b }[st.vsort];
      shown = shown.sort(so);
      // the first 300 (they used to stop there with no word), then the shared '더 보기'
      list.replaceChildren();
      const mb = moreList(list, shown, (x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, x.name),
        h("span", { class: "p num" }, x.a === x.b ? "같음" : `${x.a < x.b ? "A" : "B"} ▼ ${won(Math.abs(x.a - x.b))}`),
        h("span", { class: "m" }, pairBars(x.a, x.b), h("span", { class: "row", style: "gap:var(--sp-1)" }, h("span", { class: "key", style: "background:var(--s1)" }), h("b", { class: x.a < x.b ? "down" : "" }, won(x.a))),
          h("span", { class: "row", style: "gap:var(--sp-1)" }, h("span", { class: "key", style: "background:var(--s2)" }), h("b", { class: x.b < x.a ? "down" : "" }, won(x.b))),
          x.a !== x.b ? h("span", { class: "vwin" }, cheaperTxt(A, B, x.a, x.b)) : null, h("span", {}, D.meta.cats[x.cat])))), { first: 300 });
      moreSlot.replaceChildren(...(mb ? [mb] : []));
      if (!shown.length) list.replaceChildren(emptyLine("찾는 옵션이 없어요"));
    };
    q.addEventListener("input", paint);
    box.append(h("div", { class: "card" }, searchBox(q, { inset: true }),
      h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, h("button", { class: "chip", type: "button", "aria-pressed": st.vcat < 0 ? "true" : "false", onclick: () => { st.vcat = -1; render(); } }, "전체"),
        cats.map((ci) => h("button", { class: "chip", type: "button", "aria-pressed": st.vcat === ci ? "true" : "false", onclick: () => { st.vcat = ci; render(); } }, D.meta.cats[ci]))),
      h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, [["diff", "차이 큰 순"], ["a", "A가 싼 것"], ["b", "B가 싼 것"], ["name", "이름순"]].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": st.vsort === v ? "true" : "false", onclick: () => { st.vsort = v; render(); } }, l)))));
    box.append(h("div", { class: "card flush" }, vsHead(), list, moreSlot));
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
    // the words as typed (no alias mapping: '보톡스' is not the product '보툴렉스'), and a place or clinic only as its own word
    // ('물광주사' does not name 광주) — 2026-10-15 audit
    const plain = (t) => String(t || "").toLowerCase().replace(/\s+/g, "");
    const nq = plain(qs);
    if (nq.length < 2) return null;
    const hit = (t) => { const x = plain(t); return x.length >= 2 && (nq.includes(x) || x.includes(nq)); };
    const qw = String(qs || "").toLowerCase().split(/[\s,·]+/).filter(Boolean);
    const word = (t) => { const x = plain(t); return x.length >= 2 && qw.some((w) => w === x || (w.startsWith(x) && /^(역|점|구|동|시|에서|근처|주변|은|는|이|가)?$/.test(w.slice(x.length)))
      || (w.length >= 2 && x.startsWith(w) && /^(역|점|구|동|시|본점|역점)$/.test(x.slice(w.length)))); };   // '강남' → 강남역점 · 강남구
    const prods = prodNames().filter(([p]) => hit(p)).map(([p, rx]) => [p, prodBranches(p, rx)]).filter(([, bs]) => bs.size).sort((a, b) => b[1].size - a[1].size).slice(0, 6);
    const clinics = BR.filter((b) => word(`${brandOf(b.i)[0]}${b.name}`) || word(b.name.replace(/(본점|점)$/, "")) || plain(qs) === plain(`${brandOf(b.i)[0]}${b.name}`)).slice(0, 6);
    const areas = areaFind(qs).filter((a) => a.name.length >= 2 && word(a.name)).slice(0, 5);
    const conc = FLAGS.concernSearch && CONC.concerns.length ? Concern.classify(qs, CONC).matches.map((m) => CONC.concerns.find((c) => c.id === m.id)).filter(Boolean) : [];
    const groups = [["시술", fams.length + keys.length], ["제품·장비", prods.length], ["병원", clinics.length], ["지역", areas.length], ["고민", conc.length]].filter(([, n]) => n);
    if (!prods.length && !clinics.length && !areas.length) return groups.length ? h("p", { class: "tiny typedsum" }, `찾은 종류: ${groups.map(([g, n]) => `${g} ${n}`).join(" · ")}`) : null;
    const sec = (title, kids) => kids.length ? h("div", { class: "tsec" }, h("b", { class: "sh" }, title), h("div", { class: "chips wrapc" }, kids)) : null;
    return h("div", { class: "card typed", "data-place": clinics.length || areas.length ? "1" : null }, h("div", { class: "row" }, h("h3", {}, "검색어가 가리키는 것"), h("span", { class: "sp" }), h("span", { class: "tiny" }, groups.map(([g, n]) => `${g} ${n}`).join(" · "))),
      sec("제품·장비", prods.map(([p, bs]) => h("button", { class: "chip", type: "button", onclick: () => nav(`table?q=${encodeURIComponent(p)}`) }, icon("tag", "sm"), `${p} · ${bs.size}곳`))),
      sec("병원", clinics.map((b) => h("button", { class: "chip", type: "button", onclick: () => nav(`branch/${b.i}`) }, bdot(b.i), bname(b.i)))),
      sec("지역", areas.map((a) => h("button", { class: "chip", type: "button", onclick: () => { useArea(a); nav("map"); } }, icon("map-pin", "sm"), `${a.name} · ${a.bs.length}곳`))),
      h("p", { class: "tiny", style: "margin:var(--sp-2) 0 0" }, "제품·장비는 상품명에 적힌 것만 찾아요. 지역을 누르면 지도가 열려요."));
  }
  views.search = (arg, params) => {
    let qs = ""; try { qs = decodeURIComponent(arg || ""); } catch (e) { qs = String(arg || ""); }   // a malformed %-sequence in the link
    // natural language → filters, once per new search (?nl=1 marks it as done; ?nl=0 = take the words literally)
    if (qs && !params.has("nl") && !Search.hasOps(qs)) {
      const it = Search.interpret(qs, nlCtx());
      // question words never stay in the search ('카프리 레이저 가격' searched for '가격' too and found nothing — 2026-10-15)
      const clean = JomiChat.cleanQuery(it.q) || it.q;
      if (clean !== it.q) it.q = clean;
      if (it.chips.length || it.q !== qs) {
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
    const run = (v) => findGo(v, true);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") run(q.value.trim()); });
    box.append(searchBox(withSuggest(q, run)), searchTips((v) => nav(`search/${encodeURIComponent(v)}?nl=0`)));
    if (FLAGS.concernSearch && CONC.concerns.length) {
      const cm = Concern.classify(qs, CONC).matches.map((m) => CONC.concerns.find((c) => c.id === m.id)).filter(Boolean);
      if (cm.length) box.append(h("div", { class: "row", style: "margin:-16px 0 0" }, h("span", { class: "sub" }, "고민으로 보기:"),
        cm.map((c) => goLink(c.name, `concern?c=${c.id}`))));
    }
    // comparison keys whose label matches (same normalization as prices)
    const qc = Search.compile(qs, searchIndex()), tokens = qc.empty ? [] : qc.raw;
    // kinds of this procedure with a plain-language line each ('보톡스' → 주름·스킨·사각턱·바디 …)
    const fams = tokens.length ? famFind(qs) : [];
    // main types side by side when the search hits a group people often mix up (보톡스, 필러)
    const grp = Object.entries(MAIN_TYPES).map(([g, names]) => [g, names.map((n) => (famsByName.get(n) || []).find((f) => fams.includes(f) && kbOf(f))).filter(Boolean)]).find(([, x]) => x.length >= 3);
    const main = grp && grp[1], how = grp && (grp[0] === "lifting" || grp[0] === "toning");   // devices differ by method, injections by place
    const mainCard = !main ? null : (h("div", { class: "card" }, h("h3", {}, "주요 종류 한눈에 비교"),
      h("div", { class: "sub" }, "이름은 비슷해도 놓는 곳과 목적이 달라요. 어떤 게 맞는지는 의료진과 상담하세요."),
      h("div", { class: "ttable", role: "table", "aria-label": "주요 종류 비교" },
        h("div", { class: "tr th", role: "row" }, h("span", { role: "columnheader" }, "종류"), h("span", { role: "columnheader" }, how ? "방식" : "놓는 곳"), h("span", { role: "columnheader" }, "주로 받는 이유")),
        main.map((f) => { const e = kbOf(f); return h("div", { class: "tr", role: "row" },
          h("span", { role: "cell" }, h("button", { class: "linkbtn", type: "button", onclick: () => kbSheet(e, f) }, f.name)), h("span", { role: "cell" }, how ? e.one_liner : e.areas), h("span", { role: "cell" }, e.purpose)); })),
      h("p", { class: "tiny" }, "종류 이름을 누르면 부작용·주의사항·근거까지 볼 수 있어요. " + KB_STATE())));
    // a key's numbers once for both cards below (a kind's main key is often a shortcut too)
    const numsMemo = new Map();
    // the price is the region's median of the kind's main key, and the count next to it (no description) is that median's
    // branch count — not f.n, every branch and every size in the country (review of hierarchy audit 13: '패키지 · 204곳'
    // under a 15-branch 부산)
    const keys = KEYS.filter((k) => tokens.length && qc.test(Search.norm(`${k.label} ${k.cat} ${famOf[k.i] ? famOf[k.i].f.name : ""}`)))
      .sort((a, b) => byKB[b.i].size - byKB[a.i].size).slice(0, 8);
    // decision material first (hierarchy audit 5): what the page opens on depends on the words —
    //  · a spec in them ('리쥬란 2cc', '사각턱 50U'): the matching specs ('같은 조건 가격 비교', each with the region's median,
    //    range and branch count) open at the top, the kinds folded under them (2 of 리쥬란 2cc's 3 kinds were packages)
    //  · a name alone ('보톡스'): its kinds open at the top — how to pick one — and the specs folded under them
    // Both lists show their first rows and the shared '더 보기' (8 specs at once were 695 px, 12 kinds ~1,200), so the first
    // price line is within the first two screens (audit 16: it was at 2.97 and 4.82). A spec in the words with no matching
    // spec to compare ('스킨보톡스 100U') opens the kinds like a name alone — never a page whose only open card is folded
    const specFirst = (!!Search.unitOf(qs) && keys.length > 0) || !fams.length;
    // one row per comparison key, on the home card's basis (hierarchy audit H12·L11·SRCH-3): the median and the range of the
    // region on screen with its branch count — the compare header's numbers (keyNums) — never the lowest with '~'
    // (flags.lowestHighlight brings the lowest and its clinic back, B1-1); 분야 and the rest are separate words
    const keysCard = !keys.length ? null : (() => { const ul = h("ul", { class: "list", style: "margin-top:var(--sp-2)" });
      const more = moreList(ul, keys, (k) => { const kp = keyPrice(k.i, numsMemo);
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k.i; nav("compare"); } }, h("span", { class: "t" }, k.label),
          kp.p, h("span", { class: "m" }, h("span", {}, kp.m ? `${k.cat} · ${kp.m}` : k.cat)))); }, { first: 3, name: "용량·종류별 가격 비교" });
      const basis = h("span", { class: "sub" }, `${regionName()} · ${FLAGS.lowestHighlight ? "최저가" : "중간 가격"}`);
      return specFirst ? h("div", { class: "card keys" }, h("div", { class: "row" }, h("h3", {}, "용량·종류별 가격 비교"), h("span", { class: "sp" }), basis), ul, more)
        : h("details", { class: "card fold sfold keys" }, h("summary", {}, `용량·종류별 가격 비교 ${keys.length}개`), h("div", { class: "fambody" }, h("div", { class: "row" }, basis), ul, more)); })();
    // the kinds: the first 5, then the shared '더 보기' ('부위' is in each kind's ⓘ, with the rest of its description)
    const famsCard = !fams.length ? null : (() => { const ul = h("ul", { class: "list", style: "margin-top:var(--sp-2)" });
      const more = moreList(ul, fams, (f) => { const e = kbOf(f), kp = keyPrice(f.main, numsMemo);
        return h("li", { class: "rk" }, h("button", { class: "item", type: "button", onclick: () => nav(`compare?k=${KEYS[f.main].id}`) }, h("span", { class: "t" }, f.name),
          kp.p, h("span", { class: "m" }, e ? e.purpose : `${f.cat} · ${kp.n ? `${kp.n}곳` : `${regionName()} 가격 없음`}`)),
          e ? h("button", { class: "infob", type: "button", "aria-label": `${f.name} 설명 보기`, onclick: () => kbSheet(e, f) }, icon("info")) : null); }, { first: 5, unit: "가지", name: `‘${qs}’ 종류` });
      const basis = h("span", { class: "sub" }, `${regionName()} · ${FLAGS.lowestHighlight ? "최저가" : "중간 가격"}`);
      const body = [h("div", { class: "sub" }, "이름이 비슷해도 놓는 곳과 목적이 달라요."), ul, more,
        h("button", { class: "linkbtn", type: "button", style: "margin-top:var(--sp-2)", onclick: () => nav(`guide?q=${encodeURIComponent(qs)}`) }, fams.length > 12 ? `시술 사전에서 ${fams.length}가지 모두 보기` : "시술 사전에서 자세히 보기", icon("chevron-right", "xs"))];
      return !specFirst ? h("div", { class: "card fams" }, h("div", { class: "row" }, h("h3", {}, `‘${qs}’ 종류 ${fams.length}가지`), h("span", { class: "sp" }), basis), body)
        : h("details", { class: "card fold sfold fams" }, h("summary", {}, `‘${qs}’ 비슷한 종류 ${fams.length}가지`), h("div", { class: "fambody" }, h("div", { class: "row" }, basis), body)); })();
    for (const c of specFirst ? [keysCard, famsCard] : [famsCard, keysCard]) if (c) box.append(c);
    // typed results (docs/SEARCH_ENGINE_QA.md): what else the words name — a product / device, a clinic, a place, a concern —
    // each with where it leads; the counts are real (branches selling, branches in the place). Words that name a clinic or a
    // place keep it above the price lines (that is what was asked); otherwise it and the side-by-side kinds follow the price
    // lines, so the first price line is within the first two screens (hierarchy audit 5 · 16)
    const tc = typedResults(params.get("orig") || qs, fams, keys), tcFirst = !!(tc && tc.dataset.place);
    if (tcFirst) box.append(tc);
    const orig = params.get("orig");
    box.append(priceTable(`search/${encodeURIComponent(qs)}`, params, { q: qs, n: 20, foldFacets: true, mixHint: keys.length ? "같은 용량끼리는 위 '용량·종류별 가격 비교'에서 봐요." : "",
      head: [h("h3", {}, qs ? "이름에 검색어가 들어간 모든 가격" : "조건에 맞는 모든 가격"),
      orig ? h("div", { class: "note", style: "margin-top:var(--sp-2)" }, `‘${orig}’를 검색어 ‘${qs || "(없음)"}’와 아래 필터로 나눠 찾았어요. `,
        h("button", { class: "linkbtn", type: "button", onclick: () => nav(`search/${encodeURIComponent(orig)}?nl=0`, true) }, "문장 그대로 찾기")) : null] }));
    if (tc && !tcFirst) box.append(tc);
    if (mainCard) box.append(mainCard);
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
    // in won like the summary card's '2,022,680~4,936,800원' and plans B·C·D: the same total never in two units (T7)
    const rng = (xs) => { if (!xs.length) return null; return rangeEl(Math.min(...xs), Math.max(...xs), WON); };
    const near = st.loc ? [...full].filter((x) => x.d != null).sort((a, b) => a.d - b.d)[0] : null;
    const open = (tab, extra) => () => { st.cartTab = tab; st.cartCmp = true; if (extra) extra(); track("scenario_open", { tab, max: st.maxPlaces || 0 }); render(); setTimeout(() => { const t = $("#main .seg[role=tablist]"); if (t) t.scrollIntoView({ block: "start", behavior: "smooth" }); }, 50); };
    const tile = (id, title, visits, total, sub, act, actL) => h("div", { class: "scen" }, h("div", { class: "row" }, h("b", { class: "scen-id" }, id), h("b", {}, title)),
      h("div", { class: "scen-v" }, h("span", { class: "k" }, visits), h("b", { class: "num" }, total || "-")),
      h("div", { class: "tiny" }, sub), act ? hereLink("list", actL, act) : null);
    const pair = plan.pair;
    return h("section", { class: "card scens", "aria-label": "방문 계획 A~D" }, h("h3", {}, "방문 계획 비교"),
      h("div", { class: "sub" }, "나눠 받는 방법에 따라 합계와 방문 횟수가 달라요."),
      h("div", { class: "scengrid" },
        tile("A", "한 곳에서 모두", "방문 1곳", full.length ? (HL ? won(full[0].total) : rng(full.map((x) => x.total))) : null,
          full.length ? `${full.length}곳${HL ? "" : " 합계 범위"}` : "담은 시술을 모두 파는 지점이 없어요", full.length ? open("one") : null, "지점별로 보기"),
        tile("B", "시술별로 나눠서", `방문 ${plan.mix.places}곳`, plan.mix.missing ? null : won(plan.mix.total),
          plan.mix.missing ? `${plan.mix.missing}개는 어느 지점에서도 가격을 찾지 못해 합계를 만들지 않아요` : plan.mix.places > 1 ? "시술마다 가장 싼 지점 · 이동·상담이 늘어요" : "한 지점에서 받는 것과 같아요", open("mix", () => { st.maxPlaces = 0; }), "어디서 받는지 보기"),
        tile("C", "최대 2곳", pair ? "방문 2곳" : "방문 1~2곳", pair ? won(pair.total) : null,
          pair ? `한 곳보다 ${won(full.length ? full[0].total - pair.total : 0)} 적어요` : "2곳으로 나눠도 한 곳보다 싸지지 않거나, 두 곳으로 다 채울 수 없어요", pair ? open("mix", () => { st.maxPlaces = 2; }) : null, "두 곳 보기"),
        tile("D", "가까운 한 곳", "방문 1곳", near ? won(near.total) : null,
          !st.loc ? "위치를 정하면 가장 가까운 곳 합계를 보여 줘요" : near ? `${km(near.d)} · 모두 받을 수 있는 가장 가까운 곳` : "위치 정보가 있는 지점 중 모두 받을 수 있는 곳이 없어요",
          st.loc ? (near ? open("one", () => { st.sort = "near"; }) : null) : () => locSheet(), st.loc ? "가까운 순으로 보기" : "기준 위치 정하기")),
      h("p", { class: "tiny", style: "margin:var(--sp-2) 0 0" }, "실제 결제가는 상담·조건에 따라 달라요."));
  }
  views.cart = () => {
    const box = h("div", { class: "view" });
    const c = cur();
    metric("cart_open");
    const newCart = () => nameSheet("새 견적", `견적 ${st.carts.length + 1}`, (name) => { st.carts.push({ id: newId(), name, items: [] }); st.ci = st.carts.length - 1; saveCarts(); render(); });
    box.append(h("div", { class: "row", style: "padding:0" }, h("h2", { class: "display" }, "내 견적"), h("span", { class: "sp" }),
      h("button", { class: "btn sm gray", type: "button", onclick: newCart }, icon("plus", "sm"), "새 견적")),
      // round-2 UX03: not a booking, not a final bill
      h("p", { class: "sub", style: "margin:-16px 0 0" }, "예약·결제가 아니라 비교용 예상 합계예요. 가격 없는 횟수·추가 비용은 빠져요."));
    if (st.carts.length > 1) box.append(h("div", { class: "chips" }, st.carts.map((x, i) => h("button", { class: "chip", type: "button", "aria-pressed": i === st.ci ? "true" : "false",
      onclick: () => { st.ci = i; st.open.clear(); saveCarts(); render(); } }, `${x.name} ${x.items.length}`))));
    const manage = h("details", { class: "fold small" }, h("summary", {}, icon("settings", "sm"), `'${c.name}' 관리 · 이름·복사·${st.carts.length > 1 ? "삭제" : "비우기"}`),
      h("div", { class: "row", style: "margin:var(--sp-2) 0" },
        h("button", { class: "btn sm gray", type: "button", onclick: () => nameSheet("이름 바꾸기", c.name, (name) => { c.name = name; saveCarts(); render(); }) }, icon("pencil", "sm"), "이름 바꾸기"),
        c.items.length ? h("button", { class: "btn sm gray", type: "button", onclick: () => { st.carts.push({ id: newId(), name: `${c.name} 복사본`.slice(0, 30), items: JSON.parse(JSON.stringify(c.items)), budget: c.budget }); st.ci = st.carts.length - 1; saveCarts(); render(); toast("복사했어요"); } }, icon("copy", "sm"), "복사") : null,
        h("span", { class: "sp" }),
        h("button", { class: "btn sm gray", type: "button", onclick: () => {
          const snap = JSON.parse(JSON.stringify(st.carts)), ci = st.ci, many = st.carts.length > 1;
          if (many) { st.carts.splice(st.ci, 1); st.ci = 0; } else c.items = [];
          saveCarts(); render();
          undoToast(many ? `'${c.name}'을(를) 지웠어요` : "내 견적을 비웠어요", () => { st.carts = snap; st.ci = ci; saveCarts(); render(); });
        } }, icon("trash-2", "sm"), st.carts.length > 1 ? "삭제" : "비우기")));
    if (!c.items.length) {
      box.append(h("div", { class: "card" }, jomiEmpty("cart", jline("emptyCart") || "내 견적이 비어 있어요", h("span", { style: "display:block;color:var(--ink-2);margin-bottom:var(--sp-2)" }, jline("emptyCartSub") || "시술을 담으면 병원별 비용을 비교할 수 있어요."),
        "시술 화면이나 가격표의 '담기'로 담으면 지점마다 예상 총액을 계산해 드려요."),
        h("button", { class: "btn block", type: "button", onclick: () => nav("compare") }, "시술 고르러 가기", icon("chevron-right", "sm")), st.carts.length > 1 ? manage : null));
      return box;
    }
    // the items: name, spec, quantity, the line's lowest price, remove
    const items = c.items.filter(itemOk);
    const lost = c.items.length - items.length;
    // estimated total, the cheapest branch, and the button to the per-clinic comparison (worked out before the items so the
    // first screen can carry the total too)
    const plan = items.length ? cartPlan(items) : null, best = plan && plan.full[0];
    const HL = FLAGS.lowestHighlight, totals = plan ? plan.full.map((x) => x.total) : [], tmin = totals.length ? Math.min(...totals) : null, tmax = totals.length ? Math.max(...totals) : null;
    // the total in the first screen (hierarchy audit 10, T8·L8): one line under '담은 시술 N개', the summary card's numbers in
    // the summary card's unit (won, like the bottom bar); a tap takes you — and the focus — to that card. Nothing when no clinic
    // has all of it (the card then says so itself), and nothing with one item: its own line below already shows the same range
    // and clinic count. The bottom bar keeps its own rule (shown once the card has scrolled away).
    // '· N곳 ↓' never breaks apart (a narrow phone wraps the line before the '·', not after it)
    const totLine = best && items.length > 1 ? h("button", { class: "totline", type: "button", "aria-label": `예상 총액 ${HL ? won(best.total) : Pricing.rangeText(tmin, tmax, WON)} · ${plan.full.length}곳, 요약 카드로 이동`,
      onclick: () => { const sc = $("#main .cartsum"); if (!sc) return; sc.scrollIntoView({ block: "start", behavior: smooth() }); sc.focus({ preventScroll: true }); } },
      h("span", { class: "tl" }, "예상 총액"), " ", h("b", { class: "num" }, HL ? won(best.total) : rangeEl(tmin, tmax, WON)), " ",
      h("span", { class: "tn" }, `· ${plan.full.length}곳 `, h("span", { class: "ta", "aria-hidden": "true" }, "↓"))) : null;
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, `담은 시술 ${c.items.length}개`), h("span", { class: "sp" }), h("span", { class: "sub" }, c.name)),
      totLine,
      h("div", { class: "cart-items" }, c.items.map((it) => {
        const ok = itemOk(it), fam = it.t === "k" && ok ? famOf[KI[it.k]] : null, e = fam ? kbOf(fam.f) : null;
        const cat = it.t === "k" && ok ? KEYS[KI[it.k]].cat : ok ? D.meta.cats[ROWS[(byName.get(SI.get(it.n)) || [])[0]][1]] : "";
        const setQ = (v) => { it.q = v; saveCarts(); render(); };
        const nOv = it.ov ? Object.keys(it.ov).length - BR.filter((x) => ovDropped(it, x.i)).length : 0, best = ok ? itemBest(it) : null;
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
            !ok ? h("span", { class: "unav" }, "이번 주 가격표에 없어요") : null,
            nOv ? h("button", { class: "linkbtn", type: "button", onclick: () => { it.ov = {}; saveCarts(); render(); } }, `지점별로 바꾼 옵션 ${nOv}곳 · 되돌리기`) : null,
            ok && st.cartAdv ? h("button", { class: "chip mini-chip", type: "button", "aria-pressed": (it.sp ?? st.special) ? "true" : "false", title: "이 시술만 특가 포함/빼기",
              onclick: () => { it.sp = !(it.sp ?? st.special); saveCarts(); render(); } }, (it.sp ?? st.special) ? "특가 포함" : "특가 빼기") : null),
          // had it before: the once prices (체험가·한정가·첫 방문·1인 1회) are not theirs — shown where the item has one (or it is on).
          // A revisit price is about the clinic: '이 병원에 다녀왔어요' in the clinic's quote (visitSwitch) — a revisit 체험가 is about
          // both (shown here once its clinic is marked: itemHasOnce)
          ok && (it.done || ((it.sp ?? st.special) && itemHasOnce(it))) ? h("div", { class: "cdone" },
            switchEl("전에 이 시술을 받아 봤어요", !!it.done, (v) => { if (v) it.done = true; else delete it.done; saveCarts(); render(); }, undefined, "sm"),
            it.done ? h("span", { class: "sub" }, "체험가·첫 방문가 같은 1회 가격은 빼고 계산해요") : null) : null,
          // '이 병원에 다녀왔어요' where it decides whether the item has a price at a clinic (only revisit or only first-visit prices there)
          ok ? itemVisitSw(it, best) : null,
          h("div", { class: "cf" }, qtyEl(() => it.q || 1, setQ), FLAGS.lowestHighlight ? h("span", { class: "cp num" }, best ? won(best.total) : "-",
            h("small", {}, best ? `가장 싼 곳 · ${BR[best.b].name}` : ok ? "가능한 지점 없음" : "계산에서 빠짐"))
            : h("span", { class: "cp num" }, best ? rangeEl(best.total, best.hi, WON) : "-",
              h("small", {}, best ? `지점별 · ${best.n}곳` : ok ? "가능한 지점 없음" : "계산에서 빠짐"))));
      })),
      lost ? h("div", { class: "note", style: "margin-top:var(--sp-2)" }, `${lost}개는 이번 주 가격표에서 찾지 못해 계산에서 빠졌어요.`) : null, manage));
    if (!items.length) return box;
    const usesCond = best && best.lines.some((l) => l && l.special);
    const totalNow = HL ? (best ? best.total : null) : `${tmin}-${tmax}`, tick = lastTotal && lastTotal.id === c.id && lastTotal.t !== totalNow;
    lastTotal = { id: c.id, t: totalNow };
    const sumrow = (l, v) => h("div", { class: "sumrow" }, h("span", {}, l), h("b", { class: "num" }, v));
    // sticky summary at the bottom once the summary card has scrolled away (hidden while the card is on screen)
    const endBar = h("div", { class: "actions cartbar", hidden: true },
      h("div", { class: "cb-t" }, h("span", { class: "tiny" }, best ? `예상 총액 · ${plan.full.length}곳` : "예상 총액"),
        h("b", { class: "num" }, best ? (HL ? won(best.total) : rangeEl(tmin, tmax, WON)) : plan.mix.missing ? "일부 가격 미확인" : `섞으면 ${won(plan.mix.total)}`)),
      h("button", { class: "btn", type: "button", onclick: () => { if (!st.cartCmp) { st.cartCmp = true; render(); } setTimeout(() => { const t = $("#main .seg[role=tablist]") || $("#main .cartsum"); if (t) t.scrollIntoView({ block: "start", behavior: "smooth" }); }, 50); } },
        st.cartCmp ? "병원별 비교로" : "병원별 비교 보기"));
    box.append(h("div", { class: "card cartsum lift", "aria-live": "polite", tabindex: "-1" },
      h("span", { class: "hl" }, best ? (HL ? "한 곳에서 다 받을 때 예상 총액" : "한 곳에서 다 받을 때 예상 총액") : "한 곳에서 모두 받는 지점이 없어요"),
      best ? h("span", { class: `hp num${tick ? " tick" : ""}${HL ? "" : " range"}` }, HL ? won(best.total) : rangeEl(tmin, tmax, WON))
        : h("span", { class: "hp num" }, plan.mix.missing ? "일부 가격 미확인" : `섞으면 ${won(plan.mix.total)}`),
      best && HL ? h("span", { class: "hb" }, bdot(best.b), `최저가 지점: ${bname(best.b)}${best.d != null ? ` · ${km(best.d)}` : ""}`) : null,
      h("div", { style: "margin-top:var(--sp-2);padding-top:var(--sp-2);border-top:1px solid var(--line-soft)" },
        sumrow("모두 받을 수 있는 지점", `${regionName()} ${plan.full.length}곳`),
        plan.partial.length ? sumrow("일부만 가능", `${plan.partial.length}곳`) : null,
        plan.savings > 0 ? (HL ? sumrow("여러 곳 섞으면", `${won(plan.mix.total)} · ${won(plan.savings)} 아낌`) : sumrow("여러 곳에 나눠 받으면", `${won(plan.mix.total)}부터`)) : null,
        sumrow("가격 기준", st.vat === "incl" ? "부가세 포함가" : "병원 표시가")),
      usesCond ? h("span", { class: "k kc", style: "justify-self:start;margin-top:var(--sp-2);white-space:normal" }, "특가(첫 방문·체험가 등) 포함 — 고급 설정에서 뺄 수 있어요") : null,
      // a visit day / time price is counted on every session: with no visit date the app can't tell which of them apply
      !st.when && [...plan.byB.values()].some((ls) => ls.some((l) => l && l.repeat)) ? h("div", { class: "whenask" },
        h("span", { class: "sub" }, "방문일을 정하면 그 요일·시간에 되는 가격만 계산해요"),
        h("button", { class: "linkbtn", type: "button", onclick: whenSheet }, icon("calendar", "xs"), "방문일 정하기")) : null,
      c.budget && best ? (HL ? h("span", { class: `k ${best.total > c.budget ? "k4" : "ok"}`, style: "justify-self:start;margin-top:var(--sp-2)" }, best.total > c.budget ? `예산보다 ${won(best.total - c.budget)} 많아요` : `예산 ${won(c.budget)} 안이에요`)
        : (() => { const n = totals.filter((t) => t <= c.budget).length; return h("span", { class: `k ${n ? "ok" : "k4"}`, style: "justify-self:start;margin-top:var(--sp-2)" }, n ? `예산 ${won(c.budget)} 안 지점 ${n}곳` : `예산 ${won(c.budget)} 안 지점이 없어요`); })()) : null,
      h("button", { class: "btn", type: "button", "aria-expanded": st.cartCmp ? "true" : "false", onclick: () => { st.cartCmp = !st.cartCmp; render(); } },
        st.cartCmp ? "병원별 비교 접기" : `병원별 비교 보기 (${plan.full.length + plan.partial.length}곳)`, icon(st.cartCmp ? "chevron-up" : "chevron-down", "sm")),
      h("div", { class: "tools" },
        h("button", { class: "linkbtn", type: "button", onclick: () => shareCart(c) }, icon("share-2", "xs"), "공유하기"),
        h("button", { class: "linkbtn", type: "button", onclick: () => alertSheet({ cart: c.name }) }, icon("bell", "xs"), "합계 알림"),
        h("span", { class: "sub", style: "display:inline-flex;align-items:center;gap:var(--sp-1)" }, icon("check", "xs"), "이 휴대폰에 자동 저장"))));
    box.append(scenarioCard(items, plan));
    // advanced comparison settings — every option the cart had, folded and summarised
    const on = [st.special ? "특가 포함" : "일반가만", st.noStack ? "첫 방문가 지점당 1개" : null, st.when ? `방문 ${st.when.date.slice(5)}${st.when.time ? " " + st.when.time : ""}` : null,
      c.budget ? `예산 ${won(c.budget)}` : null, st.maxKm ? `${st.maxKm}km 안` : null, st.brands.length < D.meta.brands.length ? `브랜드 ${st.brands.length}개` : null].filter(Boolean);
    const adv = h("details", { class: "card advset", open: !!st.cartAdv }, h("summary", {}, h("b", {}, "고급 비교 설정"), h("span", { class: "sub" }, ` · ${on.join(" · ")}`)),
      h("div", { class: "advgrid" },
        h("div", {}, h("div", { class: "flabel" }, "예산 상한"), budgetEl(c)),
        h("div", {}, h("div", { class: "flabel" }, "특가 적용"), switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }),
          h("div", { class: "sub" }, "담은 시술마다 '특가 포함/빼기'를 따로 정할 수도 있어요(위 목록).")),
        h("div", {}, h("div", { class: "flabel" }, "첫 방문 조건"), switchEl("첫 방문가는 지점당 1개만", st.noStack, (v) => { st.noStack = v; store.set("noStack", v); render(); })),
        h("div", {}, h("div", { class: "flabel" }, "방문일"), whenChip()),
        h("div", {}, h("div", { class: "flabel" }, "여러 병원 조합"), h("div", { class: "chips" }, [[0, "제한 없음"], [2, "최대 2곳"]].map(([v, l]) =>
          h("button", { class: "chip", type: "button", "aria-pressed": st.maxPlaces === v ? "true" : "false", onclick: () => { st.maxPlaces = v; st.cartTab = "mix"; st.cartCmp = true; render(); } }, l)))),
        h("div", {}, h("div", { class: "flabel" }, "거리"), st.loc ? h("select", { class: "mini", "aria-label": "거리", onchange: (ev) => { st.maxKm = +ev.target.value; render(); } },
          [[0, "거리 제한 없음"], [3, "3km 안"], [5, "5km 안"], [10, "10km 안"], [20, "20km 안"], [50, "50km 안"]].map(([v, l]) => h("option", { value: v, selected: v === st.maxKm }, l)))
          : h("button", { class: "btn sm gray", type: "button", onclick: () => locate("keep") }, "내 위치로 거리 보기")),
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
    // the caution above the clinics, not after 40 of them (hierarchy audit 18, L9): the same sentence as before
    box.append(h("p", { class: "note cmpwarn" }, "가격만으로 고르지 마세요. 용량·조건·정품 여부·의료진·부작용은 담은 시술의 ⓘ에서 봐요."));
    if (st.cartTab === "one") box.append(oneView(items, plan.full, plan.partial));
    else if (st.cartTab === "mix") box.append(mixView(items, plan));
    else if (st.cartTab === "pkg") box.append(pkgView(items, plan));
    else box.append(sumView(plan.full));
    // under the list: the price basis in view, how the totals are made folded (same sentences, one per line)
    box.append(h("div", { class: "note cartnotes" },
      h("ul", { class: "dots" }, h("li", {}, `${vatNote()} 방문 전에 병원에 꼭 확인하세요.`)),
      keptFold("cartCalc", "minifold", h("summary", {}, "합계 계산 방법"),
        h("ul", { class: "dots" },
          h("li", {}, "체험가·한정가·첫 방문가는 첫 1회만, 2회째부터는 그 지점의 다른 가격으로 계산해요. 요일·시간 조건 가격은 조건이 맞을 때 매번 그 가격으로 계산해요."),
          h("li", {}, "지점 이름을 누르면 시술별 견적이 펼쳐지고 옵션을 바꿀 수 있어요. 3회·5회 묶음을 고르면 횟수에 맞춰 계산해요.")))));
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
      h("span", { class: "m" }, x.missing && x.missing.length ? h("span", { class: "unav" }, `${items.length}개 중 ${x.n}개 가능 · 없음: ${x.missing.map((j) => itemLabel(items[j])).join(", ")}`) : best ? (x.total === best ? "가장 싸요" : `최저 합계보다 +${won(x.total - best)}`) : null,
        cur().budget && !(x.missing && x.missing.length) ? (x.total > cur().budget ? h("span", { class: "k k4" }, `예산 +${won(x.total - cur().budget)}`) : h("span", { class: "k ok" }, "예산 안")) : null,
        isFav("b", bkey(x.b)) ? h("span", { class: "k k4" }, "관심 지점") : null,
        (() => { const n = quoteWarnings(x, items).length; return n ? h("span", { class: "k kc", title: "합계는 예상이에요. 견적을 펼쳐 조건을 확인하세요" }, `확인할 조건 ${n}개`) : null; })(),
        x.d != null ? h("b", {}, km(x.d)) : null, h("span", { class: "chev" }, open ? "접기" : "견적")));   // the folds' one chevron (styles.css, 위계 점검 30)
    li.append(headBtn);
    if (!open) return li;
    const body = h("div", { class: "qbody" });
    // '이 병원에 다녀왔어요' above this clinic's lines, when its revisit or first-visit prices are among them
    const vsw = visitSwitch(x.b, visitStake(items, x.b), { vw: "q", flip: (v) => flipVisit(x, items, v) });
    if (vsw) body.append(vsw);
    const vis = visitedAt(x.b);
    items.forEach((it, j) => {
      const l = x.lines[j];
      const alts = altRows(it, x.b);
      const sel = h("select", { class: "mini", "aria-label": "이 지점에서 옵션 바꾸기", onchange: (e) => {
        it.ov = it.ov || {};
        if (e.target.value === "") delete it.ov[bkey(x.b)]; else it.ov[bkey(x.b)] = S[ROWS[+e.target.value][2]];
        saveCarts(); render(); } },
        h("option", { value: "" }, "자동 (가장 싼 같은 시술)"),
        // a price the switches leave out (ovDropped) can't be picked: a revisit one until the clinic is marked visited, a first-visit
        // one once it is, a once price with '전에 이 시술을 받아 봤어요' on
        alts.map((i) => { const r = ROWS[i], ss = sessOf(i), c = asC(i), no = !Pricing.canTake(c, !!it.done, vis);
          const why = !no ? "" : c.revisit && !vis && Pricing.canTake(c, !!it.done, true) ? " (다녀왔어요를 켜면)" : vis && c.first ? " (다녀온 병원: 빠짐)" : " (받아 봤어요: 빠짐)";
          return h("option", { value: i, selected: l && l.ov && l.rows[0] === i, disabled: no }, `${S[r[2]]} · ${won(r[3])}${ss > 1 ? (ss >= 99 ? " (이용권)" : ` (${ss}회)`) : ""}${isSpecial(r) ? " · 특가" : ""}${c.revisit ? " · 재방문" : ""}${why}`); }));
      if (!l) {
        // the clinic sells it, at first-visit prices only: marked visited, it says so (not just '없음')
        body.append(h("div", { class: "qline" }, h("div", { class: "row" }, h("b", {}, itemLabel(it)), h("span", { class: "sp" }), h("span", { class: "fw-bold unav" }, "없음")),
          vis && lineAt(it, x.b, false, false) ? h("div", { class: "sub" }, VIS_GONE) : null,
          alts.length ? h("div", { class: "row", style: "margin-top:var(--sp-2)" }, h("span", { class: "sub" }, "비슷한 상품으로 대신:"), sel) : h("div", { class: "sub" }, "이 지점 가격표에 비슷한 상품이 없어요")));
        return;
      }
      const r = ROWS[l.rows[0]], ss = sessOf(l.rows[0]);
      const pct = r[4] ? Math.round((r[4] - r[3]) / r[4] * 100) : 0;
      const r2 = laterRow(l);
      const detail = l.incomplete ? incTxt(l)
        : r2 ? `첫 회 ${won(r[3])} + ${(it.q || 1) - 1}회 × ${won(r2[3])}`
        : l.ov ? (ss >= 99 ? "이용권 1개" : ss > 1 ? `${ss}회 묶음 × ${l.units}` : `× ${l.units}`)
        : (it.q || 1) > 1 ? `${won(r[3])} × ${it.q}` : "";
      // in view on every line (hierarchy audit 48, L13): the conditions (조건 배지, '기간 확인 필요'), how the total was made, the
      // clinic's own price + VAT and the source. The clinic's product name, the later sessions' product and the option picker
      // fold into the line's '자세히' (kept open through render(), so changing the option there leaves it open)
      const b2 = r2 ? kindBadge(r2) : [], rpt = l.repeat && (it.q || 1) > 1;
      body.append(h("div", { class: "qline" },
        h("div", { class: "row" }, h("b", {}, `${itemLabel(it)} ×${it.q || 1}`), h("span", { class: "sp" }), h("b", { class: "num" }, l.incomplete ? `${won(l.total)}~?` : won(l.total))),
        h("div", { class: "m" }, listS(r), pct > 0 && FLAGS.discountEmphasis ? h("span", { class: "k k4" }, `${pct}%↓`) : null,
          kindBadge(r, { warn: [l.restacked ? h("span", { class: "k kc" }, "첫 방문가 중복 안 함") : null, l.stackWarn ? h("span", { class: "k kc" }, "첫 방문가 중복 확인") : null],
            info: [l.ov ? h("span", { class: "k k4" }, "직접 고름") : null] }),
          detail ? h("span", {}, detail) : null, listedTxt(r) ? h("span", {}, listedTxt(r)) : null, srcLink(l.rows[0]),
          // the later sessions' conditions stay in view after '2회째부터', then the repeat words that are about them — on a line
          // of their own (위계 점검 34 · QUOTE-1): the first price's 출처 ends the line above, so it never reads as the source
          // of the later product, nor its '~10/31까지' as the first price's (.qbr: an empty full-width break, styles.css)
          r2 && (b2.length || rpt) ? [h("span", { class: "qbr", "aria-hidden": "true" }), h("span", { class: "lat" }, h("b", {}, "2회째부터"), b2, rpt ? h("span", { class: "rpt" }, REPEAT_TXT) : null)]
            : rpt ? h("span", { class: "rpt" }, REPEAT_TXT) : null,
          keptFold(`q:${bkey(x.b)}:${it.t === "k" ? it.k : `${it.n}|${it.br}`}`, "minifold qmore",
            h("summary", { "aria-label": `${itemLabel(it)} 상품명·옵션 자세히` }, "자세히"),
            h("div", { class: "qmd" }, h("span", { class: "qname" }, S[r[2]]), r2 ? h("span", { class: "later" }, `2회째부터 ${S[r2[2]]}`) : null,
              alts.length > 1 || l.ov ? sel : null)))));
    });
    const warns = quoteWarnings(x, items);
    body.append(h("div", { class: "row", style: "margin-top:var(--sp-2)" }, h("b", {}, x.missing && x.missing.length ? "확인된 시술만 예상 합계" : "예상 합계(비교용)"), h("span", { class: "sp" }), h("b", { class: "num t-sec" }, won(x.total))),
      h("div", { class: "sub" }, `${st.vat === "incl" ? "부가세 포함가" : "병원 표시가"} · 확인 ${md(fresh(x.b).d)}`),
      warns.length ? h("ul", { class: "warns" }, warns.map((s) => h("li", {}, s))) : null,
      // the same grid of equal halves as a branch's actions (위계 점검 35): 견적 복사 first, 길찾기 with its ↗
      h("div", { class: "bbtns" },
        h("button", { class: "btn sm", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(quoteText(x, items)); toast("견적을 복사했어요"); } catch (e) { toast("복사하지 못했어요"); } } }, "견적 복사"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => nav(`branch/${x.b}`) }, "지점 가격표"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => recordQuote(x, items) }, "받았어요 · 기록"),
        BR[x.b].addr ? outLink(`https://map.kakao.com/?q=${encodeURIComponent(BR[x.b].addr)}`, "navigation", "길찾기") : null));
    li.append(body);
    return li;
  }
  // 'total' order picked by the user → the first three, with what to check before trusting the total (no ranking words)
  function top3Card(xs, items) {
    const lines = (x) => x.lines.filter(Boolean).map((l) => l.rows[0]);
    const body = () => ["[윤실장 합계 낮은순 맨 위 3곳 재확인 요청]", ...xs.map((x) => `- ${bname(x.b)}: ${won(x.total)} (윤실장 수집 ${fresh(x.b).d || "-"})\n${lines(x).map((i) => `  · ${S[ROWS[i][2]]} ${won(ROWS[i][14])} ${S[ROWS[i][11]] || ""}`).join("\n")}`),
      `시술: ${items.map((it) => `${itemLabel(it)} ×${it.q || 1}`).join(", ")}`, `앱 데이터: ${D.meta.updated}`].join("\n");
    return h("div", { class: "card t3card", style: "margin:var(--sp-2) 14px 0" }, h("div", { class: "row" }, h("h3", {}, "맨 위 3곳, 이것부터 확인하세요"), h("span", { class: "sp" }), h("span", { class: "sub" }, "합계 낮은순")),
      h("ul", { class: "plain t3" }, xs.map((x) => { const w = quoteWarnings(x, items), f = fresh(x.b);
        return h("li", {}, h("div", { class: "row" }, bdot(x.b), h("b", {}, bname(x.b)), h("span", { class: "sp" }), h("b", { class: "num" }, won(x.total))),
          h("div", { class: "sub" }, `수집 ${f.d || "-"}${f.stale ? " · 이번 주 수집 실패" : ""} · ${w.length ? `확인할 조건 ${w.length}개` : "표시된 조건 없음"} · 원본 ${lines(x).filter((i) => S[ROWS[i][11]]).length}/${lines(x).length}개 링크`),
          w.length ? h("ul", { class: "warns" }, w.slice(0, 3).map((t) => h("li", {}, t))) : null); })),
      h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "각 견적의 병원 링크로 직접 보거나 운영자에게 재확인을 요청할 수 있어요(앱이 바로 다시 읽지는 못해요)."),
      h("a", { class: "btn sm gray", style: "margin-top:var(--sp-2);text-decoration:none", target: "_blank", rel: "noopener",
        href: `https://github.com/lsy2825/skin/issues/new?${new URLSearchParams({ title: `[재확인 요청] 내 견적 합계 맨 위 3곳 (${D.meta.updated})`, body: body(), labels: "price-recheck" })}` }, icon("send", "sm"), "3곳 재확인 요청 (GitHub, 실제 접수)"));
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
      res.append(h("div", { class: ok ? "note" : "note warnnote", style: "margin:var(--sp-2) 14px 0" }, ok ? `예산 ${won(budget)} 안에서 모두 받을 수 있는 곳 ${ok}곳` : `예산 ${won(budget)} 안에서 모두 받을 수 있는 곳이 없어요.${HL && full.length ? ` 가장 싼 곳은 ${won(minT)}이에요.` : ""}`));
      if (st.inBudget) full = full.filter((x) => x.total <= budget);
    }
    if (!full.length) res.append(emptyBox("store", "한 곳에서 모두 받는 지점이 없어요", `'${FLAGS.lowestHighlight ? "여러 곳 섞기" : "나눠 받기"}'를 보거나 아래에서 일부만 되는 곳${part.length ? `(${part.length}곳)` : ""}을 확인하세요.`));
    else {
      const near = st.loc ? [...full].filter((x) => x.d != null).sort((a, b) => a.d - b.d)[0] : null;
      res.append(h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, `모두 받을 수 있는 곳 ${full.length}곳`), h("div", { class: "sub" }, `${QS[st.qsort]} · 눌러서 시술별 견적과 옵션 바꾸기`),
        h("div", { class: "chips sortchips", role: "radiogroup", "aria-label": "병원 정렬", style: "margin-top:var(--sp-2)" }, Object.entries(QS).map(([v, l]) =>
          h("button", { class: "chip", type: "button", role: "radio", "aria-checked": st.qsort === v ? "true" : "false",
            onclick: () => { if (v === "near" && !st.loc) locSheet(); st.qsort = v; render(); } }, l)))));
      if (HL) res.append(h("div", { class: "hero flat", style: "margin:var(--sp-2) 14px 0" }, h("span", { class: "hl" }, "가장 싼 곳"), h("span", { class: "hb" }, bname(full.find((x) => x.total === minT).b)), h("span", { class: "hp num" }, won(minT))));
      if (near && (HL ? near.total !== minT : st.qsort !== "near")) res.append(h("div", { class: "hero alt", style: "margin:var(--sp-2) 14px 0" }, h("span", { class: "hl" }, "가장 가까운 곳"), h("span", { class: "hb" }, `${bname(near.b)} · ${km(near.d)}`), h("span", { class: "hp num" }, won(near.total))));
      if (st.qsort === "total" && full.length) res.append(top3Card(full.slice(0, 3), items));
      // 40 clinics, then the shared '20곳 더 보기 (73곳 남음)' (hierarchy audit 8 · L4: the other 73 of 113 were one grey line
      // with no way to them). The count stays while this card is redrawn (a quote opened or closed) for the same list, and an
      // opened quote further down stays drawn (its '이 병원에 다녀왔어요' may have moved it there: flipVisit)
      const fl = h("ul", { class: "list" }), sig = `${cur().id}|${st.qsort}|${st.inBudget}|${full.length}`;
      res.append(fl);
      const fm = moreList(fl, full, (x, n) => quoteRow(x, items, n, HL ? minT : 0), { first: Math.max(st.qN && st.qN.sig === sig ? Math.max(40, st.qN.n) : 40, full.reduce((m, x, n) => (st.open.has(x.b) ? n + 1 : m), 0)), unit: "곳", name: "모두 받을 수 있는 곳", onMore: (n) => { st.qN = { sig, n }; } });
      if (fm) res.append(fm);
    }
    if (part.length) {
      res.append(h("button", { class: "morelist", type: "button", "aria-expanded": st.showPart ? "true" : "false", onclick: () => { st.showPart = !st.showPart; render(); } }, st.showPart ? "일부만 되는 곳 접기" : `일부만 되는 곳 ${part.length}곳 보기`));
      if (st.showPart) {   // 30 at first (they used to stop there silently), then the same '더 보기'
        const pl = h("ul", { class: "list" }), sig = `${cur().id}|${st.qsort}|${part.length}`;
        res.append(pl);
        const pm = moreList(pl, part, (x, n) => quoteRow(x, items, n, 0), { first: Math.max(st.pN && st.pN.sig === sig ? Math.max(30, st.pN.n) : 30, part.reduce((m, x, n) => (st.open.has(x.b) ? n + 1 : m), 0)), unit: "곳", name: "일부만 되는 곳", onMore: (n) => { st.pN = { sig, n }; } });
        if (pm) res.append(pm);
      }
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
        // a revisit package only at a clinic marked visited, a first-visit one only where it is not (Pricing.canTake, as the lines)
        if (!Pricing.canTake(asC(i), false, visitedAt(x.i))) continue;
        const m = Pricing.matchPackage(name, specs, Search.norm, S[r[18]] || "");
        if (m.matched.length < 2) continue;
        const sep = m.matched.every((y) => singles[y.j]) ? m.matched.reduce((s, y) => s + singles[y.j].total, 0) : null;
        const qtyOk = m.matched.every((y) => (items[y.j].q || 1) === 1 && sessOf(i) <= 1);    // a 1-session package vs 1 of each
        found.push({ i, b: x.i, m, sep, qtyOk, gain: m.full && qtyOk && sep != null ? sep - r[3] : null });
      }
    }
    found.sort((a, b) => (b.m.full - a.m.full) || ((b.gain ?? -1e12) - (a.gain ?? -1e12)) || b.m.matched.length - a.m.matched.length || ROWS[a.i][3] - ROWS[b.i][3]);
    const res = h("div", { class: "card flush" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "담은 시술 2개 이상이 들어 있는 병원 패키지"),
      h("div", { class: "sub" }, "이름에 '+'로 묶인 상품만 찾아요. 샷 수·용량이 같고 다른 구성이 없을 때만 따로 살 때와 비교해요.")));
    if (!found.length) { res.append(emptyBox("gift", "패키지를 찾지 못했어요", "담은 시술을 2개 이상 묶은 패키지가 없어요.")); return res; }
    const stateTxt = { match: "같은 시술", spec: "용량·부위·제품 다름", check: "구성 확인 필요" };
    res.append(h("ul", { class: "list pkgs" }, found.slice(0, 30).map((y) => { const r = ROWS[y.i];
      return h("li", {}, h("div", { class: "item ra" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
        h("span", { class: "m" }, h("button", { class: "linkbtn", type: "button", onclick: () => nav(`branch/${y.b}`) }, bdot(y.b), bname(y.b)), kindBadge(r),
          ...y.m.matched.map((z) => z.state === "match" ? h("span", { class: "k ok" }, `${itemLabel(items[z.j])}: ${stateTxt[z.state]}`) : kwBadge(`${itemLabel(items[z.j])}: ${stateTxt[z.state]}`)),
          y.m.extras.length ? h("span", { class: "k k4" }, `추가 구성: ${y.m.extras.join(", ")}`) : null,
          y.gain != null ? h("b", { class: y.gain > 0 ? "down" : "up" }, y.gain > 0 ? `따로(${won(y.sep)})보다 ${won(y.gain)} 싸요` : `따로(${won(y.sep)})가 ${won(-y.gain)} 싸요`)
            : h("span", {}, y.sep == null ? "같은 지점 단품 가격이 없어 비교 못 함" : !y.qtyOk && y.m.full ? `같은 지점에서 따로 ${won(y.sep)} · 횟수가 달라 직접 비교 안 함` : `같은 지점에서 따로 ${won(y.sep)} · 구성이 달라 직접 비교 안 함`),
          srcLink(y.i)), rowAddBtn(y.i))); })));
    return res;
  }

  // several branches: at most 1 / 2 / any number of visits
  function mixView(items, plan) {
    const { full, mix, pair } = plan;
    const res = h("div", { class: "card" });
    const HL = FLAGS.lowestHighlight;
    res.append(h("div", { class: "row" }, h("h3", {}, HL ? "여러 곳 섞어서 받으면" : "여러 곳에 나눠 받을 때 예상 합계"), h("span", { class: "sp" })),
      h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, [[2, "최대 2곳"], [0, "제한 없음"]].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": st.maxPlaces === v ? "true" : "false", onclick: () => { st.maxPlaces = v; render(); } }, l))));
    const single = full[0];
    let picks, total, places, note;
    if (st.maxPlaces === 2) {
      if (!pair) {
        res.append(emptyLine(single ? (HL ? `두 곳을 섞어도 한 곳(${bname(single.b)} ${won(single.total)})보다 싸지지 않아요.` : "두 곳으로 나눠도 한 곳에서 다 받을 때보다 합계가 낮아지지 않아요.") : "두 곳으로 담은 시술을 모두 받을 수 있는 조합이 없어요."));
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
    if (!HL) note += " 시술마다 합계가 가장 낮은 곳을 골라 계산한 참고값이에요.";
    res.append(h("div", { class: "hero minor", style: "margin-top:var(--sp-2)" }, h("span", { class: "hl" }, `${places}곳 방문${st.maxPlaces !== 2 && mix.missing ? ` · ${mix.missing}개는 가능한 지점 없음` : ""}`),
        h("span", { class: "hb" }, st.vat === "incl" ? "합계 (부가세 포함가)" : "합계 (병원 표시가)"), h("span", { class: "hp num" }, won(total))),
      h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, note),
      cur().budget ? h("div", { class: total <= cur().budget ? "sub down" : "sub up", style: "margin-top:var(--sp-2)" }, total <= cur().budget ? `예산 ${won(cur().budget)} 안이에요` : `예산보다 ${won(total - cur().budget)} 많아요`) : null,
      h("ul", { class: "list", style: "margin-top:var(--sp-2)" }, items.map((it, j) => { const p = picks[j];
        if (!p || !p.line) return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, `${itemLabel(it)} ×${it.q || 1}`), h("span", { class: "p unav" }, "가격 미확인")));
        const r = ROWS[p.line.rows[0]];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${p.b}`) }, h("span", { class: "t" }, `${itemLabel(it)} ×${it.q || 1}`), h("span", { class: "p num" }, won(p.line.total)),
          h("span", { class: "m" }, bdot(p.b), bname(p.b), h("span", {}, S[r[2]]), kindBadge(r, { info: [p.line.ov ? h("span", { class: "k k4" }, "직접 고름") : null] }),
            (() => { const r2 = laterRow(p.line); return r2 && isSpecial(r2) ? [h("span", {}, "2회째부터"), ...kindBadge(r2)] : null; })(), dist(p.b) != null ? h("b", {}, km(dist(p.b))) : null)));
      })),
      picks.some((p) => p && p.line && p.line.special) ? h("div", { class: "note", style: "margin-top:var(--sp-2)" }, "특가(체험가·한정가·첫 방문)가 들어 있어요. 1인 1회 등 조건을 꼭 확인하세요.") : null);
    return res;
  }
  function sumView(full) {
    const box = h("div", { class: "view", style: "animation:none" }), HL = FLAGS.lowestHighlight;
    if (!full.length) { box.append(h("div", { class: "card" }, emptyBox("store", "브랜드·지역별 합계를 낼 수 없어요", "담은 시술을 한 지점에서 모두 하는 곳이 없어요."))); return box; }
    const group = (keyOf) => { const m = new Map(); for (const x of full) { const k = keyOf(x); if (!m.has(k)) m.set(k, { best: x, n: 0, near: null, lo: x.total, hi: x.total }); const g = m.get(k); g.n++;
      if (x.total < g.best.total) g.best = x; g.lo = Math.min(g.lo, x.total); g.hi = Math.max(g.hi, x.total);
      if (x.d != null && (!g.near || x.d < g.near.d)) g.near = x; } return [...m.entries()].sort((a, b) => a[1].best.total - b[1].best.total); };
    // the cart's totals are in won (the summary card above: 서울's range can be that very total); the line breaks at '~' only
    // and the name keeps its width at 320 (.item.sumr)
    const rng = (g) => rangeEl(g.lo, g.hi, WON);
    const brands = group((x) => BR[x.b].brand);
    if (HL) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "브랜드별 최저"), h("div", { class: "sub" }, "각 브랜드에서 담은 시술을 모두 받는 가장 싼 지점")),
      h("ul", { class: "list" }, brands.map(([bi, g], n) => h("li", {}, h("button", { class: "rank" + (n === 0 ? " top" : ""), type: "button", onclick: () => { st.cartTab = "one"; st.open.add(g.best.b); render(); } },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, h("span", { class: "bdot", style: `background:${D.meta.brands[bi][1]}` }), h("span", {}, D.meta.brands[bi][0])), h("span", { class: "p num" }, won(g.best.total)),
        h("span", { class: "m" }, h("span", {}, `${BR[g.best.b].name} · 가능 ${g.n}곳`), n ? h("span", {}, `1위보다 +${won(g.best.total - brands[0][1].best.total)}`) : null,
          g.near ? h("b", {}, `가까운 곳 ${BR[g.near.b].name} ${km(g.near.d)} ${won(g.near.total)}`) : null)))))));
    // neutral (default): each brand's / region's range of totals, in brand order / region name order, no branch named
    else box.append(h("div", { class: "card flush" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "브랜드별 합계 범위"), h("div", { class: "sub" }, "각 브랜드에서 담은 시술을 모두 받을 수 있는 지점들의 합계")),
      h("ul", { class: "list" }, [...brands].sort((a, b) => a[0] - b[0]).map(([bi, g]) => h("li", {}, h("div", { class: "item sumr" },
        h("span", { class: "t row", style: "flex-wrap:nowrap" }, h("span", { class: "bdot", style: `background:${D.meta.brands[bi][1]}` }), D.meta.brands[bi][0]), h("span", { class: "p num" }, rng(g)),
        h("span", { class: "m" }, `가능 ${g.n}곳`, g.near ? h("b", {}, `가까운 곳 ${BR[g.near.b].name} ${km(g.near.d)}`) : null)))))));
    const regs = group((x) => BR[x.b].region || "기타");
    box.append(h("div", { class: "card flush" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, HL ? "지역별 최저" : "지역별 합계 범위"), h("div", { class: "sub" }, HL ? "시·도마다 담은 시술을 모두 받는 가장 싼 지점" : "시·도마다 담은 시술을 모두 받을 수 있는 지점들의 합계")),
      h("ul", { class: "list" }, (HL ? regs : [...regs].sort((a, b) => a[0].localeCompare(b[0], "ko"))).map(([rg, g]) => h("li", {}, HL ? h("button", { class: "item", type: "button", onclick: () => { st.cartTab = "one"; st.open.add(g.best.b); render(); } },
        h("span", { class: "t" }, rg), h("span", { class: "p num" }, won(g.best.total)),
        h("span", { class: "m" }, bdot(g.best.b), h("span", {}, bname(g.best.b)), h("span", {}, `가능 ${g.n}곳`)))
        : h("div", { class: "item sumr" }, h("span", { class: "t" }, rg), h("span", { class: "p num" }, rng(g)), h("span", { class: "m" }, `가능 ${g.n}곳`)))))));
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
    if (!c || !c.items.length) { box.append(h("div", { class: "card" }, jomiEmpty("empty", "공유 링크를 읽지 못했어요", "링크가 잘렸거나 바뀌었을 수 있어요. 보낸 사람에게 다시 받아 보세요."))); return box; }
    const okItems = c.items.filter((it) => it && (it.t === "k" || it.t === "r") && itemOk(it));
    const now = okItems.length === c.items.length && okItems.length ? cartPlan(okItems, false).full[0] : null;   // the sender's basis (shareCart)
    box.append(h("div", { class: "card" }, h("h2", {}, `${c.from ? `${String(c.from).slice(0, 20)}님이 보낸 ` : "공유받은 "}견적: ${c.name || "견적"}`),
      c.note ? h("div", { class: "note", style: "margin-top:var(--sp-2)" }, String(c.note).slice(0, 200)) : null,
      c.sent && now ? h("div", { class: "note", style: "margin-top:var(--sp-2)" }, c.sent.total === now.total && c.sent.vat === st.vat
        ? `보낸 때(${c.sent.date})와 같은 가격이에요: 한 곳 최저 ${won(now.total)}`
        : `보낸 때(${c.sent.date}) 한 곳 최저 ${won(c.sent.total)}${c.sent.vat !== st.vat ? "(표시 방식 다름)" : ""} → 지금 ${FLAGS.lowestHighlight ? `${bname(now.b)} ` : ""}${won(now.total)}. 그사이 가격이 바뀌었어요.`) : null,
      h("ul", { class: "list", style: "margin-top:var(--sp-2)" }, c.items.map((it) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, itemLabel(it)), h("span", { class: "sub" }, `×${it.q || 1}`),
        !itemOk(it) ? h("span", { class: "m unav" }, "이번 주 가격표에 없음") : null)))),
      h("button", { class: "btn", type: "button", style: "width:100%;margin-top:var(--sp-3)", onclick: () => {
        st.carts.push({ id: newId(), name: c.name || "공유받은 견적", items: c.items.map((it) => JSON.parse(JSON.stringify(it))) });
        st.ci = st.carts.length - 1; metric("keep_cart"); saveCarts(); toast("내 견적으로 저장했어요"); nav("cart", true); } }, "내 견적으로 저장")));
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
    if (A && A.user) A.saveProfile(st.me, A.user.id).catch(() => toast("계정에 저장하지 못했어요(이 휴대폰에는 저장됨)"));
  }
  function saveRecs(changed) {
    sortRecs(); store.set("recs", st.recs);
    const A = auth();
    if (A && A.user && changed && changed.length) A.saveRecords(changed, A.user.id).catch(() => toast("계정에 저장하지 못했어요(이 휴대폰에는 저장됨)"));
  }
  // the personal state in memory, read again from the current space (sign-in, sign-out, another account)
  function reloadPersonal() {
    st.me = store.get("me", { nick: "", gender: "", age: "" }); st.recs = store.get("recs", []);
    st.alerts = store.get("alerts", []); st.notes = store.get("notes", []);
    st.carts = loadCarts(); st.ci = Math.min(store.get("ci", 0) || 0, st.carts.length - 1);
    cartQ.clear(); clearTimeout(cartPush);
    pushSync();   // the push subscription is this phone's: the rules follow whoever uses it now
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
      h("p", {}, `로그인 전에 이 휴대폰에 저장한 기록 ${recs.length}개와 견적 ${carts.length}개가 있어요. 이 계정으로 옮길까요?`),
      h("p", { class: "sub" }, "옮기지 않으면 로그아웃했을 때 이 휴대폰에서 그대로 볼 수 있어요. 다른 사람의 기록이라면 옮기지 마세요."),
      h("div", { class: "row", style: "margin-top:var(--sp-3)" },
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
          close(); render(); toast(`기록 ${add.length}개와 내 견적을 이 계정으로 옮겼어요`);
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
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "이 휴대폰에만 저장돼요(로그인을 켜면 계정에도 저장)."),
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:var(--sp-3)", onclick: ok }, "저장"));
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
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:var(--sp-3)", onclick: () => { st.me = { nick: nick.value.trim().slice(0, 20), gender: s.gender || "", age: s.age || "" }; saveMe(); close(); render(); toast("저장했어요"); } }, "저장"));
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
        h("div", { class: "row", style: "margin-top:var(--sp-3)" },
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
  // '받았어요 · 기록' in a clinic's quote: the records are saved first; then, at a clinic not marked '이 병원에 다녀왔어요' yet,
  // the same toast asks whether to mark it (user decision 2026-10-19) — '켜기' turns the quote's own switch (flipVisit: the
  // 내 견적 합계 alerts take the new totals as their base, a move to the other list is said with undo), '아니요' just closes
  function recordQuote(x, items) {
    const add = items.map((it, j) => okL(x.lines[j]) ? { id: uid(), date: today(), n: `${itemLabel(it)}${(it.q || 1) > 1 ? ` ×${it.q}` : ""}`, br: bkey(x.b), p: x.lines[j].total, memo: S[ROWS[x.lines[j].rows[0]][2]], at: Date.now() } : null).filter(Boolean);
    st.recs.push(...add); saveRecs(add);
    const said = `받은 시술 ${add.length}개를 내정보에 기록했어요`;
    if (!add.length || visitedAt(x.b)) { toast(said); return; }
    actToast(`${said}. '${VISIT_SW}'를 켤까요?`, ["켜기", () => { if (!flipVisit(x, items, true)) undoToast(`${bname(x.b)}: '${VISIT_SW}'를 켰어요`, () => setVisited(x.b, false)); }], ["아니요", () => {}]);
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
      h("div", { class: "row", style: "flex-wrap:nowrap;gap:var(--sp-3)" }, h("div", { class: "avatar", "aria-hidden": "true" }, me.nick ? me.nick.slice(0, 1) : icon("user")),
        h("div", { style: "min-width:0" }, h("h2", {}, me.nick || "닉네임을 정해 주세요"),
          h("div", { class: "sub" }, [me.gender, me.age].filter((x) => x && x !== "선택 안 함").join(" · ") || "성별·나이 미입력")),
      ),
      h("div", { class: "row", style: "margin-top:var(--sp-2)" },
        h("button", { class: "btn sm gray", type: "button", onclick: nickSheet }, "닉네임 바꾸기"), h("button", { class: "btn sm gray", type: "button", onclick: profileSheet }, "성별·나이 입력")),
      h("div", { class: "stats" },
        h("div", {}, h("b", { class: "num" }, st.recs.length), h("span", {}, "받은 시술")),
        h("div", {}, h("b", { class: "num" }, spent >= 10000 ? `${Math.round(spent / 1000) / 10}만` : spent.toLocaleString()), h("span", {}, "쓴 돈(원)")),
        h("div", {}, h("b", { class: "num" }, visits.size), h("span", {}, "다닌 지점"))),
      A ? (A.user
        ? h("div", { class: "row", style: "margin-top:var(--sp-3)" }, h("span", { class: "sub" }, `${PROVIDER_L[A.providerName(A.user)] || "소셜"} 계정으로 로그인됨 · 기록이 계정에 저장돼요`), h("span", { class: "sp" }),
          h("button", { class: "btn sm gray", type: "button", onclick: async () => { await A.signOut(); render(); } }, "로그아웃"))
        : h("div", { style: "margin-top:var(--sp-3)" }, h("div", { class: "sub", style: "margin-bottom:var(--sp-2)" }, "로그인하면 휴대폰을 바꿔도 기록이 남아요"),
          h("div", { class: "row" }, A.providers.map((pv) => h("button", { class: `btn sm login-${pv}`, type: "button", onclick: () => A.signIn(pv).catch(() => toast("로그인하지 못했어요")) },
            `${PROVIDER_L[pv]}로 시작하기`)))))
        // demo: login is not connected — say so, list what is prepared, offer no button that pretends to work
        : h("div", { class: "acctprep" }, h("div", { class: "row" }, icon("lock", "sm"), h("b", {}, "계정 연결은 정식 출시 때 열려요")),
          h("p", { class: "sub" }, "지금은 시연 단계라 로그인·회원가입·약관 동의가 없어요. 기록·내 견적·관심은 이 휴대폰에만 저장돼요."))));
    // records
    box.append(h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "최근 받은 시술"), h("span", { class: "sp" }),
      h("button", { class: "btn sm gray", type: "button", onclick: () => recordSheet(null) }, icon("plus", "sm"), "기록하기")),
      st.recs.length ? h("ul", { class: "list" }, st.recs.slice(0, st.allRecs ? 500 : 8).map((r) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => recordSheet(r) },
        h("span", { class: "t" }, r.n), h("span", { class: "p num" }, r.p ? won(r.p) : "-"),
        h("span", { class: "m" }, h("span", {}, r.date), h("span", {}, brLabel(r.br) || "지점 미입력"), r.memo ? h("span", {}, r.memo) : null)))))
        : emptyBox("receipt", "아직 기록이 없어요", "받은 시술을 기록하면 언제·어디서·얼마에 받았는지 한눈에 볼 수 있어요. 내 견적에서 '받았어요'를 눌러도 기록돼요."),
      st.recs.length > 8 ? h("button", { class: "morelist", type: "button", onclick: () => { st.allRecs = !st.allRecs; render(); } }, st.allRecs ? "접기" : `전체 ${st.recs.length}개 보기`) : null));
    // visited branches
    if (visits.size) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "방문한 지점")),
      h("ul", { class: "list" }, [...visits.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([br, v]) => { const b = BK.get(br);
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { if (b != null) nav(`branch/${b}`); } },
          h("span", { class: "t row" }, b != null ? bdot(b) : null, brLabel(br) || "지점 미입력"), h("span", { class: "p num" }, `${v.n}회`),
          h("span", { class: "m" }, h("span", {}, `마지막 ${v.last}`), v.sum ? h("span", {}, `합계 ${won(v.sum)}`) : null, b == null ? h("span", {}, "앱 목록에 없는 곳") : null))); }))));
    // more pages ('개인정보 처리방침' only while 익명 집계 or 푸시 is set up — #privacy)
    box.append(h("div", { class: "card flush menu" }, h("ul", { class: "list" }, [["saved", "heart", "관심·가격 알림", "관심 시술·지점, 알림, 최근 본 것"], ["guide", "book-open", "시술 사전", "헷갈리는 시술 종류와 차이를 쉽게"], ["table", "table", "전체 가격표", "모든 지점·모든 가격을 조건으로 찾기"], ["change", "trending-down", "가격 변동", "지난번보다 오르내린 가격"], ["data", "database", "데이터 상태·앱 설치", "언제·어디서 모았나, 비교 기준, 설치"], ["privacy", "lock", "개인정보 처리방침", privacyParts().map((x) => x.title).join(" · ")], ["ops", "shield", "운영 현황", "수집 상태·신선도·검토 큐·출처 정책"]].filter(([v]) => (v !== "ops" || adminHost()) && (v !== "privacy" || privacyParts().length)).map(([v, ic, l, s]) =>
      h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(v) }, h("span", { class: "t" }, h("span", { class: "mi" }, icon(ic, "sm")), h("span", {}, h("span", { style: "display:block" }, l), h("span", { class: "sub fw-reg", style: "display:block" }, s))), icon("chevron-right", "sm")))))));
    // ---- 내 설정 (what this phone shows) — separate from the data information below
    const theme = store.get("theme", "auto");
    const radios = (label, opts, curV, set) => h("div", { class: "seg setseg", role: "radiogroup", "aria-label": label }, opts.map(([v, l]) =>
      h("button", { type: "button", role: "radio", "aria-checked": curV === v ? "true" : "false", onclick: () => set(v) }, l)));
    // one line per setting — '이름 · 지금: 값' — that opens to its controls (hierarchy audit 49, L15); a row stays open after a
    // change redraws the screen (keptFold), so the new value shows where it was picked
    const setRow = (id, name, now, ...body) => keptFold(`set:${id}`, "setrow", h("summary", { class: "flabel" }, h("span", {}, name), h("b", { class: "now" }, now)), h("div", { class: "setbody" }, ...body));
    box.append(h("div", { class: "card settings" }, h("h2", { class: "t-sec" }, "내 설정"), h("div", { class: "sub" }, "이 휴대폰에서 보이는 방식을 바꿔요."),
      setRow("vat", "가격 표시", st.vat === "incl" ? "지금: 부가세 포함가" : "지금: 병원 표시가",
        radios("가격 표시", [["incl", "부가세 포함가"], ["listed", "병원 표시가"]], st.vat, (v) => { st.vat = v; store.set("vat", v); applyVat(); render(); toast(v === "incl" ? "부가세 포함가로 보여요" : "병원이 적은 가격 그대로 보여요"); }),
        h("div", { class: "sub" }, st.vat === "incl" ? `병원이 '부가세 별도'라고 적은 가격에 10%를 더해 보여줘요. ${vatBrandsNote()}` : "병원 사이트에 적힌 숫자 그대로예요. 실제 결제는 부가세 10%가 더해질 수 있어요.")),
      setRow("theme", "화면 테마", `지금: ${{ auto: "기기 설정 따름", light: "밝게", dark: "어둡게" }[theme]}`,
        radios("화면 테마", [["auto", "기기 설정"], ["light", "밝게"], ["dark", "어둡게"]], theme, (t) => { store.set("theme", t); applyTheme(); render(); })),
      setRow("region", "지역", `지금: ${regionName()} ${regionCount()}곳`,
        regionSelect(), h("div", { class: "sub" }, "고르면 비교·내 견적·검색에 이 지역 지점만 보여요.")),
      (() => { const P = jprefs(), set = (k, v) => { store.set("jomiPrefs", { ...P, [k]: v }); applyMotion(); render(); };
        return setRow("jomi", "죠미 설정", `지금: 안내 ${{ often: "자주", some: "가끔", off: "끄기" }[P.freq]} · 움직임 ${{ auto: "기기 설정", on: "켜기", off: "끄기" }[P.motion]} · 설명 ${{ short: "간략", long: "상세" }[P.detail]}`,
          h("div", { class: "sub", style: "margin:var(--sp-2) 0" }, "안내 빈도 — '가끔'은 홈 인사·사전 한마디를 줄이고, '끄기'는 죠미 얼굴 없이 글로만 알려줘요."),
          radios("죠미 안내 빈도", [["often", "자주"], ["some", "가끔"], ["off", "끄기"]], P.freq, (v) => set("freq", v)),
          h("div", { class: "sub", style: "margin:var(--sp-2) 0" }, "움직임 — '기기 설정'은 휴대폰의 '동작 줄이기'를 따라요."),
          radios("움직임", [["auto", "기기 설정"], ["on", "켜기"], ["off", "끄기"]], P.motion, (v) => set("motion", v)),
          h("div", { class: "sub", style: "margin:var(--sp-2) 0" }, "용어 설명"),
          radios("설명 길이", [["short", "간략"], ["long", "상세"]], P.detail, (v) => set("detail", v))); })(),
      setRow("hist", "보기 기록", histOn() ? "지금: 남김" : "지금: 남기지 않음",
        switchEl("최근 본 것·최근 검색·이어서 보기 기록 남기기", histOn(), (v) => { store.set("histOff", !v); render(); toast(v ? "다시 기록해요" : "이제 기록하지 않아요(이미 있는 기록은 그대로)"); }),
        switchEl("사용 통계 남기기 (이 휴대폰에만 · 시연)", anOn(), (v) => { store.set("analytics", v ? "on" : "off"); render(); toast(v ? "이 휴대폰에만 사용 통계를 남겨요(서버로 보내지 않아요)" : "사용 통계를 남기지 않아요(이미 있는 기록은 '보기'에서 지울 수 있어요)"); }),
        hereLink("list", "사용 통계 보기·지우기", () => eventsSheet()),
        h("div", { class: "row", style: "margin-top:var(--sp-2)" }, h("button", { class: "btn sm gray", type: "button", onclick: () => {
          const before = Object.fromEntries(HIST_KEYS.map((k) => [k, store.get(k, null)]));
          for (const k of HIST_KEYS) { try { localStorage.removeItem("pc:" + k); } catch (e) { /* storage unavailable */ } }
          try { localStorage.removeItem("pc:lastTable"); } catch (e) { /* an older version's key */ }
          render(); undoToast("보기 기록을 지웠어요", () => { for (const [k, v] of Object.entries(before)) if (v != null) store.set(k, v); render(); }); } }, "기록 지우기")),
        h("div", { class: "sub" }, "이 휴대폰에만 있어요(서버로 보내지 않아요). 내 견적·관심·알림은 지우지 않아요.")),
      // 단계별 익명 집계(B5, user decision 2026-10-15: a switch, on by default). Its own row: unlike the one above it does go to
      // a server. Shown only when it is set up (config.js). Off = nothing new stored or sent from this phone; the day's one
      // record stays, so switching back on the same day does not count the phone twice.
      metrics.available ? setRow("metrics", "익명 이용 집계", metricsOff() ? "지금: 보내지 않음" : "지금: 보냄",
        // the switch's name, the 'off' toast and the line under it: §4 '집계 칸' (docs/legal/PRIVACY_POLICY_DRAFT.md, chat C, 2026-10-16)
        switchEl("익명 이용 집계 보내기 (단계 이름만 · 단계마다 하루 한 번)", !metricsOff(), (v) => {
          store.set("metricsOff", !v);
          const kept = store.get("metricsOff", null) === !v;   // false: storage blocked or full — memory only
          metricsOffMem = !v;
          render(); toast(v ? "익명 이용 집계를 보내요" : kept ? "이제 이 브라우저에서는 집계를 보내지 않아요" : "이 화면을 닫기 전까지 집계를 보내지 않아요(설정을 저장하지 못했어요)"); }),
        h("div", { class: "sub" }, "앱을 쓴 단계 이름만, 단계마다 하루 한 번 서버로 보내요(기기·위치·검색어는 보내지 않아요). 끄면 이 브라우저에서는 보내지 않아요(앱 데이터를 지우면 다시 켜져요)."),
        privacyLink()) : null,
      h("div", { class: "row", style: "margin-top:var(--sp-3)" }, h("button", { class: "btn sm gray", type: "button", onclick: () => window.lockApp && window.lockApp() }, "지금 잠그기"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { store.set("brands", null); store.set("special", true); location.reload(); } }, "설정 초기화"))));
    // ---- 데이터 안내 (information, not settings)
    const counts = D.meta.brands.map((_, i) => [BR.filter((b) => b.brand === i).length, D.rows.filter((r) => BR[r[0]].brand === i).length]);
    box.append(h("div", { class: "card info" }, h("h2", { class: "t-sec" }, "데이터 안내"),
      h("dl", { class: "kv", style: "margin-top:var(--sp-2)" }, h("dt", {}, "수집일"), h("dd", {}, `${md(D.meta.updated)} (매주 월요일 자동 갱신)`),
        h("dt", {}, "지점"), h("dd", {}, branchCountText()), h("dt", {}, "가격 수"), h("dd", {}, `${D.meta.rows.toLocaleString()}개 (전국)`)),
      h("ul", { class: "list", style: "margin-top:var(--sp-2)" }, D.meta.brands.map((b, i) => !counts[i][0] ? null : h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "dot bdot", style: `background:${b[1]}` }), b[0]),
        h("span", { class: "sub" }, `${counts[i][0]}곳 · ${counts[i][1].toLocaleString()}개`), h("span", { class: "m" }, b[2]))))),
      // how to read the prices: the same sentences, one per line — the first two in view, the rest under '자세히' (hierarchy audit 49)
      (() => { const pts = ["체험가·한정가는 보통 1인 1회예요. 일반가와 특가는 따로 보여줘요.",
        `'${Pricing.condLabel("평일 낮")}'(평일 낮·화수목·평일 해피아워 등), '${Pricing.condLabel("시간대")}'(점심·해피아워 등), '일요일'${WHEN_COL ? `·'${Pricing.whenBadge(32, 0)}'` : ""} 같은 표시는 그 요일·시간에만 되는 가격이에요.`, vatNote(),
        "종료일이 지난 이벤트, 지난 수집보다 90% 넘게 내리거나 10배 넘게 오른 가격(확인 중)은 비교에서 빠져요. 가격마다 ⓘ(가격 정보)로 조건과 병원 페이지를 볼 수 있어요.",
        "병원 사이트 표기 오류(정가가 판매가보다 낮거나 10배 넘는 값)는 정가를 지웠고, 안내 문구·서류 발급비는 뺐어요."];
        return h("div", { class: "note datanote", style: "margin-top:var(--sp-2)" }, h("ul", { class: "dots" }, pts.slice(0, 2).map((x) => h("li", {}, x))),
          keptFold("meData", "minifold", h("summary", {}, `자세히 · ${pts.length - 2}개 더`), h("ul", { class: "dots" }, pts.slice(2).map((x) => h("li", {}, x))))); })(),
      h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "지도 © OpenStreetMap 기여자. 가격 출처는 각 병원 홈페이지예요.")));
    const shown = BR.filter((b) => regionOk(b.i));
    box.append(h("details", { class: "card flush fold" }, h("summary", {}, `지점 전체 목록 · ${regionName()} ${shown.length}곳`),
      h("ul", { class: "list" }, shown.sort((a, b) => a.brand - b.brand || a.name.localeCompare(b.name, "ko")).map((b) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b.i}`) },
        h("span", { class: "t row" }, bdot(b.i), bname(b.i)), h("span", { class: "sub" }, dist(b.i) != null ? km(dist(b.i)) : b.region), h("span", { class: "m" }, b.addr)))))));
    if (A && A.user) box.append(h("div", { class: "card" }, h("h3", {}, "계정"),
      h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "탈퇴하면 계정의 프로필·기록·내 견적·관심·알림이 바로 지워져요. 이 휴대폰에 남은 이 계정의 기록도 함께 지워요."),
      h("button", { class: "btn sm gray", type: "button", style: "margin-top:var(--sp-2)", onclick: async () => {
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
    if (partial()) { el.hidden = true; document.body.classList.remove("has-fcart"); return; }   // totals need every row
    const items = cur().items.filter(itemOk);
    // pages with their own bottom bar (compare's actions, the concern composer), the cart itself, settings (and the policy page) and the map don't show it
    if (["cart", "import", "compare", "concern", "me", "about", "privacy", "ops", "map"].includes(view) || !items.length) { el.hidden = true; document.body.classList.remove("has-fcart"); return; }
    document.body.classList.add("has-fcart");
    const plan = cartPlan(items), best = plan.full[0];
    el.replaceChildren(icon("shopping-bag", "sm"), FLAGS.lowestHighlight ? `${items.length}개 · ${best ? `한 곳 ${won(best.total)}부터` : plan.mix.missing ? "일부 가격 미확인" : `섞으면 ${won(plan.mix.total)}`}`
      : `내 견적 ${items.length}개 · 병원별 견적 ${plan.full.length + plan.partial.length}곳`);
    el.hidden = false;
  }
  // removing a focused input can fire change/blur handlers that render again: never nest renders
  let rendering = false;
  // a redraw between pointerdown and pointerup replaces the control under the finger, so the browser sends no click (the tap
  // is lost — 2026-10-14: typing a budget or a min/max price, then tapping a chip, did nothing because the box's change /
  // focusout handler redrew the page on that same press). While a press is in progress the redraw waits until its click has
  // run; tests/e2e/clickable.js checks every screen for this.
  // On a phone the focus (and so the box's change/blur) moves at the tap's synthesized mousedown, after pointerup, so the
  // press counts from pointerdown or mousedown until just after its click.
  let pressing = false, heldRender = false, pressTimer = 0;
  const release = (ms) => {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { pressing = false; if (heldRender) { heldRender = false; render(); } }, ms);
  };
  const press = (e) => { if (e.isPrimary === false || e.button > 0) return; pressing = true; release(1500); };   // a long press never holds the screen for long
  document.addEventListener("pointerdown", press, true);
  document.addEventListener("mousedown", press, true);
  document.addEventListener("pointerup", () => { if (pressing) release(400); }, true);   // the tap's click comes well within this
  document.addEventListener("pointercancel", () => release(0), true);                   // a scroll, not a tap
  document.addEventListener("click", () => { if (pressing) release(0); }, true);        // flush after the click's own handlers
  function render() {
    if (!D) return;
    if (pressing) { heldRender = true; return; }
    if (rendering) { setTimeout(render, 0); return; }
    rendering = true;
    try { renderNow(); } finally { rendering = false; }
  }
  function renderNow() {
    visMemo = null;   // '이 병원에 다녀왔어요' read again once per screen (another tab may have changed it)
    const bell = bellMark();   // a phone notification tapped: the bell panel opens on this screen (below)
    const [path, qs] = (location.hash.replace(/^#/, "") || "home").split("?");
    const [name, ...rest] = path.split("/");
    const params = new URLSearchParams(qs || "");
    // #privacy with neither 집계 nor 푸시 set up (no such view): the 마이 screen, where its way in would be
    const view = views[name] ? name : name === "more" || name === "privacy" ? "me" : name === "favorites" ? "saved" : name === "data" ? "about" : "home";
    const main = $("#main"), same = view === current && path === lastPath, mark = focusMark(main, document.activeElement);
    if (!same) { for (const c of [...openSheets]) c(true); pending = null; }
    if (!same) closeNoti(true);   // the bell panel does not outlive its screen either
    current = view; lastPath = path;
    if ((ROUTE_NAME[view] || view === "branch") && histOn()) store.set("lastRoute", path + (qs ? `?${qs}` : ""));
    const tab = { search: "home", import: "cart", compare: "explore", rank: "explore", versus: "explore", change: "explore", table: "explore", guide: "explore", concern: "explore",
      map: "explore", branch: "explore", about: "me", principles: "me", privacy: "me", ops: "me", quick: "explore", terms: "explore", snap: "saved" }[view] ?? view;
    document.querySelectorAll("#tabs button").forEach((b) => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    // one screen failing must not leave the previous one up or a blank page (round-2 D5): show what happened and a way back
    let node = partial() && view !== "home" ? fullWait() : null;
    if (!node) try { node = views[view](rest.join("/"), params); }
    catch (e) {
      console.error(e);
      node = h("div", { class: "view" }, jomiEmpty("error", "이 화면을 그리다가 문제가 생겼어요. 링크가 잘못됐거나 앱 오류일 수 있어요."),
        h("div", { class: "row", style: "margin-top:var(--sp-3)" }, h("button", { class: "btn line", type: "button", onclick: () => history.back() }, "뒤로"),
          h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => nav("home") }, "홈으로")));
    }
    main.replaceChildren(node);
    main.removeAttribute("aria-busy");
    // a clinic's '이 병원에 다녀왔어요' turned in its quote (flipVisit): the quote may be in the other list now — the page moves so
    // the switch is where it was (the cart line's copy when the clinic left both lists); no slide-in (.view's 8px) on this redraw
    if (visAnchor) { const a = visAnchor; visAnchor = null;
      const el = same && (main.querySelector(`.visit[data-vb="${a.b}"][data-vw="q"]`) || main.querySelector(`.visit[data-vb="${a.b}"]`));
      if (el) { node.style.animation = "none"; window.scrollBy(0, el.getBoundingClientRect().top - a.top); } }
    // same page redrawn (filter, quantity …): focus goes back to that control; new page opened from the content: focus
    // the page itself so the next Tab starts in the new content instead of the header
    if (mark) { if (same) focusBack(main, mark); else main.focus({ preventScroll: true }); }
    paintFloatCart(view);
    watchCmpHead();
    seePrice();
    document.body.classList.toggle("has-bar", view === "concern" || view === "cart");
    if (bell) openNoti(); else paintNoti();
  }
  window.addEventListener("popstate", render);
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => nav(b.dataset.tab)));
  $("#locbtn").addEventListener("click", () => { if (D) locSheet(); });
  $("#notibtn").addEventListener("click", () => { if (noti) closeNoti(); else openNoti(); });   // the bell panel (openNoti)
  // the top bar gets a hairline once the page scrolls under it; the sticky headers fold and unfold (heads, 위계 점검 9·38)
  window.addEventListener("scroll", () => { $("#top").classList.toggle("scrolled", window.scrollY > 4); heads(); seePrice(); }, { passive: true });
  window.addEventListener("resize", heads, { passive: true });   // a turned phone: the header is no longer sticky below 500px high
  // the logo goes home the way the 홈 tab does: pushed, drawn, at the top (위계 점검 23 — as a plain '#home' link it kept the
  // scroll of the screen it left, 1485px down). Back (popstate) is unchanged: the screen left comes back as before.
  $("#top a.brand").addEventListener("click", (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); nav("home"); });

  // the ops screen (app/screens/ops.js, chat A) has content only on the admin address behind Cloudflare Access (A6): the two
  // ways in (마이 menu, the data-state card) are drawn only there. ops.js sets App.onAdminHost; without it, nowhere.
  function adminHost() { return !!(App.onAdminHost && App.onAdminHost()); }
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
  // split-out screens (screens/*.js, loaded before this file) get the helpers this file still owns, then register their views.
  // Data that is replaced on refresh is read through App.state() at render time, never copied (docs/APP_JS_SPLIT_PLAN.md).
  Object.assign(App, { views, FLAGS, fresh, verified, recheckQueue, bdot, bname, kbOf, nav,
    // screens/about.js (3-2): 데이터 안내·운영 원칙·처리방침·시술 사전·쉬운 용어
    render, adminHost, syncState, liveBrands, moreList, kwBadge, md, vatNote, branchCountText, REVISIT_CART, isIOS, standalone,
    notifySupported, PUSH, pushState, privacyParts, jomiSay, jprefs, CMP_CATS, famFind, kbSheet, reviewBadge, evidenceBadge, DISCLAIM, KB_STATE,
    // screens/concern.js (3-3): 피부 고민·죠미와 대화
    mdhm, rangeEl, goLink, hereLink, kbVisible, chatCtx, jomiImg, jomiEmpty, regionName, st, J, track,
    // screens/map.js (3-4): 지도
    ranking, brandOn, brandOf, dist, regionCmp, locate, savePlace, usePlace, areaSearch, brandChips,
    state: () => ({ D, BR, byB, ROWS, KB, FAM, KEYS, byKB, kbFind, WHEN_COL, current, CONC }) });
  for (const install of App.screens || []) install();
  // start: no splash delay — the page shows as soon as data.json is read; a slow read says so after 12 s, a failed one
  // explains what failed (only that the price file could not be read) and retries in place
  function boot() {
    const slow = setTimeout(() => { const m = $("#load-msg"); if (!m || D) return; m.textContent = jline("slow") || "평소보다 오래 걸리고 있어요.";
      m.parentElement.append(h("button", { class: "btn sm gray", type: "button", onclick: () => location.reload() }, icon("refresh-cw", "sm"), "새로고침")); }, 12000);
    loadData().then(() => { clearTimeout(slow);
      // a stored region no branch has (an old version's value, a typo) would empty every list: back to the default
      if (st.region && st.region !== "수도권" && !BR.some((b) => b.region === st.region)) { st.region = "수도권"; store.set("region", st.region); paintRegion(); }
      if (store.get("locPlace", "")) usePlace(store.get("locPlace", "")); render(); loadJomiLines();
      if (!partial()) { checkAlerts(); pushCheck(); if (window.Auth && window.Auth.enabled) onAccount(window.Auth.user); } }).catch((e) => {   // with home.json first: fullArrived
      clearTimeout(slow); D = null; console.error(e);
      const main = $("#main"); main.removeAttribute("aria-busy");
      main.replaceChildren(h("div", { class: "view" }, h("div", { class: "card", role: "alert" }, jomiEmpty("error", jline("error") || "문제가 생겼어요",
        "가격 데이터를 불러오지 못했어요. 인터넷 연결이 끊겼거나 서버가 잠시 응답하지 않을 수 있어요.",
        SYNC.failed ? h("span", { class: "tiny", style: "display:block;margin-top:var(--sp-2)" }, `자세히: ${SYNC.failed}${SYNC.tries > 1 ? ` (${SYNC.tries}번 시도)` : ""}`) : null,
        h("button", { class: "btn block", type: "button", style: "margin-top:var(--sp-3)", onclick: () => {
          main.setAttribute("aria-busy", "true");
          main.replaceChildren(h("div", { class: "view" }, h("div", { class: "jomi-load", role: "status" }, jomiImg("sleeping", "face", 40), h("span", { id: "load-msg" }, jline("retrying") || jline("loading") || "불러오는 중…")), h("div", { class: "skel", style: "height:180px" })));
          boot(); } }, icon("refresh-cw", "sm"), "다시 시도")))));
    });
  }
  if (!unseen()) metrics.opened();
  window.addEventListener("unlocked", () => { metrics.opened(); render(); });   // the view runs again: compare_open, cart_open, first_price
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !unseen()) { metrics.opened(); seePrice(); } });
  boot();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    const hadSW = !!navigator.serviceWorker.controller;   // first install also fires controllerchange: no notice then
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadSW) actToast(jline("appUpdated") || "앱이 새 버전으로 바뀌었어요", ["새로고침", () => location.reload()]); });
    navigator.serviceWorker.register("sw.js").catch(() => {});
    // a phone notification tapped while the app is open (sw.js): 관심 탭 with the bell panel open (bellMark)
    navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "nav" && e.data.to === "saved") nav(e.data.panel === true ? "saved?bell=1" : "saved"); });
  }
})();
