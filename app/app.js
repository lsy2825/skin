// 윤실장 (피부과 가격비교) — app logic. Data: data.json (built by build2/appdata.py). No framework.
(function () {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "style") e.setAttribute("style", v);
      else if ((k === "href" || k === "src") && !safeUrl(v)) continue;   // links built from scraped data
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };
  // only relative links and http(s) / mailto / tel: a 'javascript:' or 'data:' URL from scraped data never becomes a link
  function safeUrl(v) { const m = /^\s*([a-z][a-z0-9+.-]*):/i.exec(String(v)); return !m || /^(https?|mailto|tel)$/i.test(m[1]); }
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((c) => c != null && c !== false));
  const won = (n) => Math.round(n).toLocaleString("ko-KR") + "원";
  const km = (d) => d == null ? "" : d < 1 ? Math.round(d * 1000) + "m" : (d < 10 ? d.toFixed(1) : Math.round(d)) + "km";
  const store = {
    get(k, d) { try { const v = localStorage.getItem("pc:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("pc:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  let toastT;
  const toast = (t) => { const el = $("#toast"); el.classList.remove("act"); el.textContent = t; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 1800); };
  async function copyText(text, done = "복사했어요") { try { await navigator.clipboard.writeText(text); toast(done); } catch (e) { toast("복사하지 못했어요"); } }
  // a toast with a '되돌리기' button for 6 s (deleting carts, items, alerts, records, presets)
  function undoToast(text, undo) {
    const el = $("#toast");
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = "되돌리기";
    btn.addEventListener("click", () => { el.classList.remove("on", "act"); clearTimeout(toastT); undo(); toast("되돌렸어요"); });
    el.replaceChildren(document.createTextNode(text + " "), btn);
    el.classList.add("on", "act"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on", "act"), 6000);
  }

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
    sort: store.get("sort", "price"), cat: 0, key: null, mapKey: null, bcat: -1, region: "",
  };
  let CHK = new Map();
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
  async function loadData() {
    const r = await fetch("data.json", { cache: "no-cache" });
    D = await r.json();
    S = D.s;
    BR = D.branches.map((b, i) => ({ i, brand: b[0], name: S[b[1]], addr: S[b[2]], lat: b[3], lng: b[4], region: S[b[5]], site: S[b[6]], geo: b[9] ?? 0 }));
    KEYS = D.keys.map(([id, cat, label], i) => ({ i, id, cat, label }));
    KI = Object.fromEntries(KEYS.map((k) => [k.id, k.i]));
    ROWS = D.rows;
    // source re-checks of low prices (scrape/verify_prices.py): row → { s: 1 found · 2 name only · 3 not found · 4 fetch error, d: date }
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
    nameIdx = null;
    GR = (D.groups || []).map(([s, cat, nb, med, mn, mx], i) => ({ i, label: S[s], cat, nb, med, mn, mx }));
    byG = GR.map(() => []);
    ROWS.forEach((r, i) => { if (r[9] != null && r[9] >= 0) byG[r[9]].push(i); });
    gcache = new Map();
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
    paintUpd();
  }
  const brandOf = (b) => D.meta.brands[BR[b].brand];
  const brandOn = (b) => st.brands.includes(BR[b].brand);
  // region view: "" = 전국, "수도권" = 서울·경기·인천, otherwise one 시·도 (data stays nationwide)
  const CAPITAL = ["서울", "경기", "인천"];
  const regionOk = (b) => !st.region || (st.region === "수도권" ? CAPITAL.includes(BR[b].region) : BR[b].region === st.region);
  const regionName = () => st.region || "전국";
  const isSpecial = (r) => r[5] === 1 || r[5] === 2 || S[r[6]] !== "";
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
  // every branch selling key k, cheapest first (or nearest first)
  function ranking(k, sort = st.sort) {
    const out = [];
    for (const b of byKB[k].keys()) {
      if (!brandOn(b) || !regionOk(b)) continue;
      const i = bestAt(k, b);
      if (i >= 0) out.push({ b, i, p: ROWS[i][3], d: dist(b) });
    }
    // equal prices: newer verification first, then nearer
    out.sort(sort === "near" && st.loc ? (x, y) => (x.d ?? 1e9) - (y.d ?? 1e9) || x.p - y.p
      : (x, y) => x.p - y.p || verified(y.b).localeCompare(verified(x.b)) || (x.d ?? 1e9) - (y.d ?? 1e9));
    return out;
  }
  // ---------------- auto groups (same option at several branches): per-branch lowest price, median, rank
  // gstat(g) → { per: Map(branch → {p, i}), sorted prices, med }  (respects 특가 포함; brand filter is applied by callers)
  function gstat(g, special = st.special) {
    const ck = g * 2 + (special ? 1 : 0);
    if (gcache.has(ck)) return gcache.get(ck);
    const per = new Map();
    for (const i of byG[g]) {
      const r = ROWS[i];
      if (!live(i) || (!special && isSpecial(r))) continue;
      const cur = per.get(r[0]);
      if (!cur || r[3] < cur.p) per.set(r[0], { p: r[3], i });
    }
    const prices = [...per.values()].map((x) => x.p).sort((a, b) => a - b);
    const n = prices.length;
    const out = { per, prices, med: n ? (n % 2 ? prices[n >> 1] : (prices[n / 2 - 1] + prices[n / 2]) / 2) : 0 };
    gcache.set(ck, out);
    return out;
  }
  // where row i stands among branches selling the same option: {rank, n, vsMed (−0.12 = 12% below median)}
  function rowPos(i) {
    const r = ROWS[i];
    if (r[9] == null || r[9] < 0) return null;
    const g = gstat(r[9], true);
    if (g.prices.length < 3) return null;
    return { rank: g.prices.filter((p) => p < r[3]).length + 1, n: g.prices.length, vsMed: g.med ? r[3] / g.med - 1 : 0 };
  }
  const lvText = (x) => x == null ? "-" : Math.abs(1 - x) < 0.005 ? "중간 수준" : x < 1 ? `${Math.round((1 - x) * 100)}% 싸요` : `${Math.round((x - 1) * 100)}% 비싸요`;
  const lvClass = (x) => x == null || Math.abs(1 - x) < 0.005 ? "" : x < 1 ? "down" : "up";
  const pctTxt = (v) => Math.abs(v) < 0.005 ? "중간값" : v < 0 ? `중간보다 ${Math.round(-v * 100)}% ↓` : `중간보다 ${Math.round(v * 100)}% ↑`;
  // diverging bar around the median (1.0); ±40% fills the half
  const divBar = (x) => { const v = Math.max(-0.4, Math.min(0.4, (x ?? 1) - 1)); const w = Math.abs(v) / 0.4 * 50;
    return h("span", { class: "dbar", "aria-hidden": "true" }, h("i", { class: v < 0 ? "neg" : "pos", style: v < 0 ? `right:50%;width:${w}%` : `left:50%;width:${w}%` })); };
  const levelOf = (b, cat = -1) => { const s = (D.bstat || [])[b]; if (!s) return null; if (cat >= 0) return s[5] ? s[5][cat] ?? null : null; return st.special ? s[1] : s[0]; };
  function branchRanks(cat = -1) {
    const list = BR.filter((x) => brandOn(x.i) && regionOk(x.i)).map((x) => ({ b: x.i, lv: levelOf(x.i, cat) })).filter((x) => x.lv != null);
    list.sort((a, c) => a.lv - c.lv);
    return list;
  }
  const brSelect = (val, set, label) => h("select", { class: "pick", "aria-label": label, onchange: (e) => set(+e.target.value) },
    D.meta.brands.map((bb, bi) => !BR.some((x) => x.brand === bi) ? null : h("optgroup", { label: bb[0] }, BR.filter((x) => x.brand === bi).sort((a, c) => a.name.localeCompare(c.name, "ko"))
      .map((x) => h("option", { value: x.i, selected: x.i === val }, `${bb[0]} ${x.name}`)))));

  const md2 = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  const kindBadge = (r) => {
    const out = [];
    if (r[15] === 1) out.push(h("span", { class: "k kx" }, "기간 끝남"));
    if (r[17] === 1) out.push(h("span", { class: "k kx" }, "방문일엔 안 됨"));
    if (r[17] === 2) out.push(h("span", { class: "k kx", title: "병원 사이트에 시간대가 적혀 있지 않아요" }, "시간 확인 필요"));
    if (r[15] === 2) out.push(h("span", { class: "k kx", title: "지난주보다 90% 넘게 내리거나 10배 넘게 올라 확인 중이에요" }, "급변·확인 중"));
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
  const whenChip = () => h("button", { class: "chip", type: "button", "aria-pressed": st.when ? "true" : "false", onclick: whenSheet }, `📅 ${whenLabel()}`);
  function setWhen(w) { st.when = w; store.set("when", w); applyWhen(); render(); }
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
  function paintUpd() { const el = $("#upd"); if (el && D) el.textContent = `${D.meta.updated} 기준 · ${branchCountText()}`; }
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
        h("button", { class: "opt", type: "button", onclick: () => { close(); locate(); } }, h("b", {}, "📍 현재 위치"), h("span", {}, "GPS 권한 필요")),
        ["집", "직장"].map((n) => h("button", { class: "opt", type: "button", "aria-pressed": st.locName === n ? "true" : "false", disabled: !p[n], onclick: () => { close(); usePlace(n); } },
          h("b", {}, n === "집" ? "🏠 집" : "🏢 직장"), h("span", {}, p[n] ? "저장됨" : "아직 없음")))),
      st.loc ? h("div", { class: "row", style: "margin-top:12px" },
        ["집", "직장"].map((n) => h("button", { class: "btn sm gray", type: "button", onclick: () => { savePlace(n, st.loc.lat, st.loc.lng); close(); render(); } }, `지금 기준을 ${n}으로 저장`)),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { st.loc = null; st.locName = ""; store.set("locPlace", ""); $("#locbtn").classList.remove("on"); $("#locbtn span").textContent = "내 위치"; close(); render(); } }, "위치 끄기")) : null,
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
      if (st.sort === "price" && then !== "keep") st.sort = "near";
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
    store.set("favs", f); render();
    if (on) undoToast(`즐겨찾기에서 뺐어요: ${label}`, () => { const g = favs(); g[kind] = [id, ...g[kind]]; store.set("favs", g); render(); });
    else toast(`즐겨찾기에 넣었어요: ${label}`);
  }
  const favBtn = (kind, id, label) => h("button", { class: "favbtn", type: "button", "aria-pressed": isFav(kind, id) ? "true" : "false", "aria-label": isFav(kind, id) ? `${label} 즐겨찾기 빼기` : `${label} 즐겨찾기`,
    onclick: (e) => { e.stopPropagation(); toggleFav(kind, id, label); } }, isFav(kind, id) ? "★" : "☆");

  // ---------------- cart
  const bkey = (b) => `${D.meta.brands[BR[b].brand][0]}|${BR[b].name}`;
  const cur = () => st.carts[st.ci];
  let cartPush = null;
  const saveCarts = () => {
    for (const x of st.carts) if (!x.id) x.id = newId();
    store.set("carts", st.carts); store.set("ci", st.ci); paintCartN();
    const A = window.Auth && window.Auth.enabled ? window.Auth : null;
    if (A && A.user) { clearTimeout(cartPush); cartPush = setTimeout(() => Promise.all(st.carts.map((c) => A.saveCart(c))).catch(() => toast("장바구니를 계정에 저장하지 못했어요(이 기기에는 저장됨)")), 800); }
  };
  const inCart = (k) => cur().items.some((c) => c.t === "k" && c.k === KEYS[k].id);
  const sessOf = (i) => ROWS[i][8] || 1;
  const itemLabel = (it) => it.t === "k" ? (KI[it.k] != null ? KEYS[KI[it.k]].label : it.k) : it.n;
  const itemOk = (it) => it.t === "k" ? KI[it.k] != null : SI.has(it.n);
  function paintCartN() {
    const n = st.carts[st.ci] ? st.carts[st.ci].items.length : 0, el = $("#cart-n");
    el.hidden = !n; el.textContent = n;
  }
  const addBtn = (k) => {
    const b = h("button", { class: "addbtn", type: "button", "aria-pressed": inCart(k) ? "true" : "false" }, inCart(k) ? "담김 ✓" : "+ 담기");
    b.addEventListener("click", (e) => { e.stopPropagation(); addKeySheet(k); });
    return b;
  };
  const rowAddBtn = (i) => h("button", { class: "addbtn", type: "button", style: "padding:3px 9px", onclick: (e) => { e.stopPropagation(); addRowSheet(i); } }, "+ 담기");

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
  function sheet(title, body) {
    const opener = document.activeElement, om = focusMark($("#main"), opener);
    const bg = h("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } });
    // the opener may have been redrawn while the sheet was open (e.g. '+ 담기' → '담김 ✓'): fall back to its twin
    const close = () => { bg.remove(); document.removeEventListener("keydown", key); if (opener && opener.isConnected) opener.focus(); else focusBack($("#main"), om); };
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
      h("div", { class: "row" }, h("h3", {}, title), h("span", { class: "sp" }), h("button", { class: "btn sm gray", type: "button", onclick: () => close() }, "닫기")), body(close));
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
    h("button", { type: "button", "aria-label": "하나 빼기", onclick: () => set(Math.max(1, get() - 1)) }, "−"), h("b", { class: "num" }, get()),
    h("button", { type: "button", "aria-label": "하나 더", onclick: () => set(Math.min(max, get() + 1)) }, "+"));
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
        const top = ranking(s.k, "price")[0];
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
            h("span", { class: "hp num" }, won(top.p))) : null,
          h("div", { class: "row", style: "margin-top:14px" },
            have ? h("button", { class: "btn gray", type: "button", onclick: () => { const c = st.carts[s.ci], pos = c.items.indexOf(have); c.items = c.items.filter((x) => x !== have); saveCarts(); close(); render();
              undoToast("장바구니에서 뺐어요", () => { c.items.splice(pos, 0, have); saveCarts(); render(); }); } }, "빼기") : null,
            h("button", { class: "btn", type: "button", style: "flex:1", onclick: () => {
              if (have) have.q = s.q; else st.carts[s.ci].items.push({ t: "k", k: KEYS[s.k].id, q: s.q });
              saveCarts(); toast(have ? "횟수를 바꿨어요" : `'${st.carts[s.ci].name}'에 담았어요`); close(); render();
            } }, have ? `${s.q}회로 바꾸기` : `${s.q}회 담기`)));
      };
      paint();
      return box;
    });
  }
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
  const median = (ps) => { const a = [...ps].sort((x, y) => x - y), n = a.length; return n ? (n % 2 ? a[n >> 1] : Math.round((a[n / 2 - 1] + a[n / 2]) / 2)) : null; };
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
    3: "원본 페이지에서 이 상품을 찾지 못했어요 — 행사가 끝났거나 이름이 바뀌었을 수 있어요", 4: "원본 페이지를 읽지 못했어요" };
  function priceSheet(i) {
    const r = ROWS[i], b = r[0], f = fresh(b), conds = priceConds(i), stx = priceStats(i), low = isLow(i, stx);
    const vatTxt = r[12] === 2 ? (st.vat === "incl" ? `병원 표시가 ${won(r[14])} + 부가세 10% = ${won(r[3])} (병원이 '부가세 별도'라고 적어 둠)` : `병원 표시가 ${won(r[14])} (부가세 별도, 결제 땐 10% 더 붙을 수 있어요)`)
      : r[12] === 1 ? `${won(r[3])} (병원이 '부가세 포함'이라고 적음)` : `${won(r[3])} (부가세 포함 여부를 사이트에서 찾지 못했어요)`;
    const u = S[r[10]] || "";
    const row = (k, v) => h("div", { class: "fact" }, h("dt", {}, k), h("dd", {}, v));
    sheet("가격 확인", (close) => h("div", {},
      h("div", { class: "item", style: "padding:6px 0 10px" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])), h("span", { class: "m" }, bdot(b), bname(b), kindBadge(r))),
      low ? h("div", { class: "warnnote" }, `아주 낮은 가격이에요: ${stx.by} ${stx.n}곳 중간값 ${won(stx.med)}의 ${Math.round(r[3] / stx.med * 100)}%예요. 첫 방문 체험가, 적은 용량, 추가 옵션인 경우가 많아요. 아래 조건과 원본 페이지를 꼭 확인하세요.`) : null,
      h("dl", { class: "facts" },
        row("가격과 부가세", vatTxt),
        row("조건", conds.length ? h("ul", { class: "warns" }, conds.map((c) => h("li", {}, c))) : "상품명에 조건 문구가 없어요. 그래도 실제 조건은 병원 원문으로 확인하세요."),
        row("회차", sessOf(i) >= 99 ? "이용권·무제한" : sessOf(i) > 1 ? `${sessOf(i)}회 묶음 가격` : "1회 가격(또는 회차 표기 없음)"),
        row("정가(병원 표기)", r[4] ? `${won(r[4])} → 할인율 ${Math.round((r[4] - r[3]) / r[4] * 100)}% · 병원이 적은 정가 기준이고, 가격 이력과는 별개예요` : "정가 표기 없음 — 할인율을 만들지 않아요"),
        row("유효기간", /^\d{4}-\d{2}-\d{2}$/.test(u) ? `${u}까지${r[15] === 1 ? " (끝남 — 비교에서 빠져요)" : ""}` : u.startsWith("posted:") ? `고시표 게시일 ${u.slice(7)}` : "적혀 있지 않아요"),
        row("비교 기준", stx ? `${stx.by} ${stx.n}곳의 지점별 최저가 중 ${stx.rank}번째 · 중간값 ${won(stx.med)}${stx.special ? " (특가 포함)" : " (일반가만)"}` : "같이 비교할 지점이 3곳 미만이에요"),
        row("확인일", `${f.d || "-"} 수집${f.stale ? " · 이번 주 수집 실패, 지난 자료라 최저가에서 빼요" : " · 이번 주 확인됨"}`),
        row("원본", S[r[11]] ? h("a", { href: S[r[11]], target: "_blank", rel: "noopener noreferrer" }, "병원 원본 페이지 열기 ↗") : "원본 링크 없음"),
        row("원본 대조", CHK.has(i) ? `${CHK.get(i).d} · ${CHECK_TXT[CHK.get(i).s]}` : low ? "아직 다시 확인하지 않았어요 (초저가 원본 대조는 운영자가 따로 돌려요)" : "대조 대상 아님 (초저가만 다시 확인해요)"),
        r[15] === 2 ? row("검토", "지난주보다 크게 바뀌어 운영자 확인 전이라 비교에서 빠져요") : null),
      h("button", { class: "btn gray", type: "button", style: "width:100%;margin-top:12px", onclick: () => { close(); reportSheet(i); } }, "⚠️ 원본과 달라요 (신고)")));
  }
  function addRowSheet(i) {
    const r = ROWS[i], n = S[r[2]], keys = S[r[7]] ? S[r[7]].split(" ").map((id) => KI[id]).filter((x) => x != null) : [];
    const s = { q: 1, ci: st.ci, how: "row" };
    const same = (byName.get(r[2]) || []).map((x) => ROWS[x][0]).filter((b, j, a) => a.indexOf(b) === j).length;
    sheet("장바구니에 담기", (close) => {
      const box = h("div", {});
      const paint = () => fill(box,
        h("div", { class: "item", style: "padding:10px 0" }, h("span", { class: "t" }, n), h("span", { class: "p num" }, won(r[3])),
          h("span", { class: "m" }, bdot(r[0]), bname(r[0]), r[4] ? h("s", {}, won(r[4])) : null, kindBadge(r), sessOf(i) > 1 ? h("span", { class: "k k4" }, sessOf(i) >= 99 ? "이용권" : `${sessOf(i)}회 가격`) : null)),
        h("div", { class: "opts" },
          h("button", { class: "opt", type: "button", "aria-pressed": s.how === "row" ? "true" : "false", onclick: () => { s.how = "row"; paint(); } },
            h("b", {}, "이 옵션 그대로"), h("span", {}, `같은 이름 상품이 있는 ${same}개 지점끼리 비교`)),
          keys.map((k) => h("button", { class: "opt", type: "button", "aria-pressed": s.how === k ? "true" : "false", onclick: () => { s.how = k; paint(); } },
            h("b", {}, `같은 시술로: ${KEYS[k].label}`), h("span", {}, "모든 브랜드·지점과 비교")))),
        h("div", { class: "row", style: "margin-top:14px" }, h("span", { class: "sub" }, "횟수(회차)"), h("span", { class: "sp" }), qtyEl(() => s.q, (v) => { s.q = v; paint(); })),
        cartPicker(s.ci, (x) => { s.ci = x; paint(); }),
        h("button", { class: "btn gray", type: "button", style: "width:100%;margin-top:14px", onclick: () => { close(); priceSheet(i); } }, "🔎 가격 근거 보기 (조건·부가세·원본)"),
        h("button", { class: "btn gray", type: "button", style: "width:100%;margin-top:8px", onclick: () => { close(); reportSheet(i); } }, "⚠️ 가격이 달라요 (신고)"),
        h("button", { class: "btn gray", type: "button", style: "width:100%;margin-top:8px", onclick: () => { close(); alertSheet({ row: { n, br: bkey(r[0]) } }); } }, /^\d{4}-\d{2}-\d{2}$/.test(S[r[10]] || "") ? "🔔 종료 전·가격 알림" : "🔔 가격 알림"),
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:8px", onclick: () => {
          const items = st.carts[s.ci].items;
          if (s.how === "row") {
            const ov = {};
            items.push({ t: "r", n, br: bkey(r[0]), p: r[3], q: s.q, ov });
          } else {
            const id = KEYS[s.how].id, have = items.find((c) => c.t === "k" && c.k === id);
            if (have) have.q = s.q; else items.push({ t: "k", k: id, q: s.q, ov: { [bkey(r[0])]: n } });
          }
          saveCarts(); toast(`'${st.carts[s.ci].name}'에 담았어요`); close(); render();
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
        best ? `한 곳 최저: ${bname(best.b)} ${won(best.total)} (${today()} 기준, ${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"})` : null,
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
      ...items.map((it, j) => { const l = x.lines[j]; return l ? `- ${itemLabel(it)} ×${it.q || 1}: ${won(l.total)} (${S[ROWS[l.rows[0]][2]]})` : `- ${itemLabel(it)}: 이 지점에 없음`; }),
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
  const chg = (c) => !c ? h("span", { class: "sub" }, "변동 기록 전") : Math.abs(c.pct) < 0.5 ? h("span", { class: "sub" }, "지난주와 같음")
    : h("span", { class: c.pct < 0 ? "down" : "up" }, `${c.pct < 0 ? "▼" : "▲"} ${Math.abs(c.pct).toFixed(1)}%`);
  function sparkline(vals) {
    const pts = vals.map((v, i) => [i, v]).filter((p) => p[1] != null);
    if (pts.length < 2) return null;
    const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1])), n = vals.length - 1;
    const d = pts.map(([i, v], j) => `${j ? "L" : "M"}${(i / n * 56 + 2).toFixed(1)},${(hi === lo ? 11 : 20 - (v - lo) / (hi - lo) * 18).toFixed(1)}`).join("");
    return svg("svg", { viewBox: "0 0 60 22", width: 60, height: 22, class: "spark", "aria-hidden": "true" }, svg("path", { d }));
  }
  // line chart: one axis, 2px lines, end labels, crosshair tooltip, table view
  function lineChart(dates, series, title) {
    const W = 340, H = 190, L = 44, R = 64, T = 14, B = 26;
    const all = series.flatMap((s) => s.values.filter((v) => v != null));
    const wrap = h("div", { class: "lc" });
    if (!all.length) return wrap;
    let lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.15 || hi * 0.1 || 1; lo = Math.max(0, lo - pad); hi += pad;
    const raw = (hi - lo) / 3, mag = 10 ** Math.floor(Math.log10(raw)), stepv = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    lo = Math.floor(lo / stepv) * stepv; hi = lo + stepv * 3; while (hi < Math.max(...all)) hi += stepv;
    const x = (i) => dates.length < 2 ? L + (W - L - R) / 2 : L + i / (dates.length - 1) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "lcsvg", role: "img", "aria-label": title });
    for (let v = lo; v <= hi + 1e-6; v += stepv) {
      const yy = y(v);
      g.append(svg("line", { x1: L, x2: W - R, y1: yy, y2: yy, class: "grid" }));
      const tx = svg("text", { x: L - 6, y: yy + 4, class: "ax", "text-anchor": "end" }); tx.textContent = man(Math.round(v)); g.append(tx);
    }
    const step = Math.max(1, Math.ceil(dates.length / 5));
    dates.forEach((d, i) => { if (i % step && i !== dates.length - 1) return; const tx = svg("text", { x: x(i), y: H - 8, class: "ax", "text-anchor": "middle" }); tx.textContent = md(d); g.append(tx); });
    series.forEach((s) => {
      const pts = s.values.map((v, i) => [i, v]).filter((p) => p[1] != null);
      if (pts.length > 1) g.append(svg("path", { d: pts.map(([i, v], j) => `${j ? "L" : "M"}${x(i)},${y(v)}`).join(""), class: "ln", style: `stroke:${s.color}` }));
      pts.forEach(([i, v]) => g.append(svg("circle", { cx: x(i), cy: y(v), r: 4, class: "mk", style: `fill:${s.color}` })));
      const last = pts[pts.length - 1];
      if (last) { const tx = svg("text", { x: x(last[0]) + 8, y: y(last[1]) + 4, class: "dl" }); tx.textContent = `${s.name} ${man(last[1])}`; g.append(tx); }
    });
    // crosshair + tooltip
    const hair = svg("line", { y1: T, y2: H - B, class: "hair", visibility: "hidden" });
    const hit = svg("rect", { x: L - 10, y: 0, width: W - L - R + 20, height: H, fill: "transparent", tabindex: "0" });
    g.append(hair, hit);
    const tip = h("div", { class: "lctip", hidden: true });
    const show = (i) => {
      hair.setAttribute("x1", x(i)); hair.setAttribute("x2", x(i)); hair.setAttribute("visibility", "visible");
      tip.replaceChildren(h("div", { class: "sub" }, dates[i]), ...series.map((s) => h("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" },
        h("span", { class: "key", style: `background:${s.color}` }), h("b", { class: "num" }, s.values[i] != null ? won(s.values[i]) : "-"), h("span", { class: "sub" }, s.name))));
      tip.hidden = false; tip.style.left = `${x(i) / W * 100}%`;
    };
    const near = (e) => { const r = g.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W; let bi = 0; dates.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(bi) - px)) bi = i; }); return bi; };
    hit.addEventListener("pointermove", (e) => show(near(e)));
    hit.addEventListener("pointerdown", (e) => show(near(e)));
    hit.addEventListener("pointerleave", () => { tip.hidden = true; hair.setAttribute("visibility", "hidden"); });
    hit.addEventListener("focus", () => show(dates.length - 1));
    hit.addEventListener("blur", () => { tip.hidden = true; hair.setAttribute("visibility", "hidden"); });
    const legend = series.length > 1 ? h("div", { class: "row lclegend" }, series.map((s) => h("span", { class: "row", style: "gap:6px" }, h("span", { class: "key", style: `background:${s.color}` }), s.name))) : null;
    const table = h("table", { class: "lctable", hidden: true }, h("thead", {}, h("tr", {}, h("th", {}, "날짜"), series.map((s) => h("th", {}, s.name)))),
      h("tbody", {}, dates.map((d, i) => h("tr", {}, h("td", {}, d), series.map((s) => h("td", { class: "num" }, s.values[i] != null ? won(s.values[i]) : "-"))))));
    const tbtn = h("button", { class: "linkbtn", type: "button", onclick: () => { table.hidden = !table.hidden; tbtn.textContent = table.hidden ? "표로 보기" : "표 닫기"; } }, "표로 보기");
    wrap.append(legend || "", h("div", { class: "lcbox" }, g, tip), h("div", { class: "row" }, h("span", { class: "sp" }), tbtn), table);
    return wrap;
  }
  function trendCard() {
    const tr = TR();
    if (!tr.dates.length) return null;
    const cats = [...new Set(KEYS.map((k) => k.cat))];
    if (!st.tcat || !cats.includes(st.tcat)) st.tcat = cats[0];
    const keys = KEYS.filter((k) => k.cat === st.tcat);
    const chs = keys.map((k) => keyChange(k.id)).filter(Boolean);
    const avg = chs.length ? chs.reduce((s, c) => s + c.pct, 0) / chs.length : null;
    const card = h("div", { class: "card flush" });
    card.append(h("div", { style: "padding:12px 12px 0" }, h("div", { class: "row" }, h("h2", {}, "가격 동향"), h("span", { class: "sp" }),
      h("span", { class: "sub" }, tr.dates.length > 1 ? `${md(tr.dates[0])}~${md(tr.dates[tr.dates.length - 1])} · ${tr.dates.length}주` : `기록 시작 ${md(tr.dates[0])}`)),
      h("div", { class: "sub" }, "선과 '지난주 대비'는 실제로 모은 일반가 중간값의 변화(가격 이력)예요. '정가 표기 대비'는 이번 주 병원이 적은 정가에서 할인된 정도라 이력과 다른 숫자예요."),
      h("div", { class: "chips", style: "margin-top:10px" }, cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": c === st.tcat ? "true" : "false", onclick: () => { st.tcat = c; render(); } }, c))),
      h("div", { class: "row", style: "margin-top:10px" }, h("b", {}, `${st.tcat} 평균`), avg == null ? h("span", { class: "sub" }, tr.dates.length < 2 ? "다음 주 월요일부터 지난주 대비 변동이 보여요" : "변동 없음")
        : chg({ pct: avg }))),
      h("ul", { class: "list" }, keys.map((k) => { const v = (tr.k[k.id] || []).map((x) => x && x[0]); const now = v[v.length - 1]; const disc = tr.disc[k.id];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k.i; nav("compare"); } },
          h("span", { class: "t" }, k.label), h("span", { class: "p num" }, now != null ? won(now) : "-"),
          h("span", { class: "m" }, h("span", { class: "sub" }, "지난주 대비"), chg(keyChange(k.id)), disc != null ? h("span", { class: "k k4", title: "병원이 적은 정가와 판매가 비교(이번 주). 가격 이력과 별개" }, `정가 표기 대비 −${disc}%`) : null, h("span", { class: "sp" }), sparkline(v)))); })));
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
      h("div", { class: "chips", style: "margin-top:8px" }, ranges.map(([r, l]) => h("button", { class: "chip", type: "button", "aria-pressed": (st.hrange || "") === r ? "true" : "false", onclick: () => { st.hrange = r; render(); } }, l))));
    if (!s) { card.append(h("div", { class: "empty" }, "이 기간에 관측된 가격이 없어요")); return card; }
    card.append(h("div", { class: "tiles" },
      h("div", { class: "tile" }, h("span", { class: "k" }, "현재 최저가"), h("b", { class: "num" }, won(s.cur)), h("span", { class: "w" }, `${s.last} 확인`)),
      h("div", { class: "tile" }, h("span", { class: "k" }, "관측 최저 / 최고"), h("b", { class: "num" }, `${won(s.min)}`), h("span", { class: "w" }, `최고 ${won(s.max)} · 최저 마지막 ${s.minLast}`)),
      h("div", { class: "tile" }, h("span", { class: "k" }, "기간 중앙값"), h("b", { class: "num" }, won(sm ? sm.median : s.median)), h("span", { class: "w" }, "지점 중간값들의 중앙값")),
      h("div", { class: "tile" }, h("span", { class: "k" }, "최저가 변동"), h("b", { class: "num" }, `${s.changes}번`), h("span", { class: "w" }, `${s.points}번 관측 (${s.first}~)`))),
      lineChart(dates, [{ name: "중간값", color: "var(--s1)", values: med }, { name: "최저가", color: "var(--s2)", values: low }], `${k.label} 가격 이력`));
    if (tr.dates.length < 2) card.append(h("div", { class: "sub", style: "margin-top:6px" }, "가격을 모을 때마다(매주 월요일, 이벤트가 끝난 다음 날) 점이 하나씩 늘어요. 모으지 않은 날은 채우지 않아요."));
    return card;
  }

  // ---------------- saved treatments & price alerts (checked when the app opens; e-mail/push later with sign-in)
  const ALERT_TYPES = { target: "목표가 이하", newlow: "새 최저가", newmatch: "파는 지점이 늘면", cartdrop: "장바구니 합계", expiring: "이벤트 종료 3일 전" };
  const saveAlerts = () => { store.set("alerts", st.alerts); store.set("notes", st.notes.slice(0, 30)); paintMeN(); };
  function paintMeN() { const el = $("#me-n"); if (!el) return; const n = st.notes.filter((x) => !x.read).length; el.hidden = !n; el.textContent = n; }
  function alertNow(a) {
    if (a.k) { const k = KI[a.k]; if (k == null) return null; const rk = ranking(k, "price"); return { value: rk[0] ? rk[0].p : null, count: rk.length }; }
    if (a.cart != null) { const c = st.carts.find((x) => x.name === a.cart); if (!c) return null; const items = c.items.filter(itemOk); if (!items.length) return null; const b = cartPlan(items).full[0]; return { value: b ? b.total : null }; }
    if (a.row) { const sid = SI.get(a.row.n), b = BK.get(a.row.br); if (sid == null || b == null) return null; const i = (byName.get(sid) || []).find((x) => ROWS[x][0] === b); return i == null ? null : { value: ROWS[i][3], until: S[ROWS[i][10]] }; }
    return null;
  }
  const alertName = (a) => a.k ? (KI[a.k] != null ? KEYS[KI[a.k]].label : a.k) : a.cart != null ? `장바구니 '${a.cart}'` : a.row ? `${a.row.n} (${a.row.br.replace("|", " ")})` : "";
  function checkAlerts() {
    const td = today();
    let fired = 0;
    for (const a of st.alerts) {
      const r = Intel.evalAlert(a, alertNow(a), td);
      Object.assign(a, r.patch);
      if (r.fire) { st.notes.unshift({ at: td, text: `${alertName(a)} — ${r.text}`, id: a.id, read: false }); fired++; }
    }
    saveAlerts();
    if (fired) toast(`가격 알림 ${fired}개 — 내정보에서 확인하세요`);
  }
  function addAlert(a) {
    if (st.alerts.length >= 20) { toast("알림은 20개까지예요. 내정보에서 정리해 주세요"); return; }
    const al = { id: uid(), created: today(), ...a };
    Object.assign(al, Intel.evalAlert({ ...al, lastAt: today() }, alertNow(al), "0000-00-00").patch);   // set the baseline only
    delete al.lastAt;
    if (al.type === "target" || al.type === "cartdrop") delete al.last;
    st.alerts.push(al); saveAlerts(); toast("알림을 만들었어요 · 앱을 열 때 확인해요");
  }
  function alertSheet(base) {
    const now = alertNow(base);
    sheet("가격 알림", (close) => {
      const box = h("div", {});
      const types = base.k ? ["target", "newlow", "newmatch"] : base.cart != null ? ["cartdrop"] : ["expiring", "target"];
      const s = { type: types[0] };
      const tgt = h("input", { class: "field", type: "number", inputmode: "numeric", min: "0", step: "1000", value: now && now.value ? Math.floor(now.value * 0.9 / 1000) * 1000 : "", "aria-label": "목표 금액" });
      const paint = () => fill(box,
        h("div", { class: "sub" }, `${alertName(base)}${now && now.value ? ` · 지금 ${base.cart != null ? "한 곳 최저 합계" : "최저"} ${won(now.value)}` : ""}`),
        h("div", { class: "opts", style: "margin-top:10px" }, types.map((ty) => h("button", { class: "opt", type: "button", "aria-pressed": s.type === ty ? "true" : "false", onclick: () => { s.type = ty; paint(); } }, h("b", {}, ALERT_TYPES[ty])))),
        s.type === "target" || s.type === "cartdrop" ? h("label", { class: "flabel" }, s.type === "cartdrop" ? "이 금액 이하가 되면 (비우면 지금보다 내리면)" : "이 금액 이하가 되면", tgt) : null,
        h("div", { class: "sub", style: "margin-top:8px" }, "앱을 열 때 확인해서 내정보와 알림 표시로 알려요. 같은 가격은 다시 알리지 않고, 하루에 한 번까지예요. 이메일·푸시 알림은 로그인 기능을 켠 뒤에 붙일 수 있어요."),
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:14px", onclick: () => {
          const v = Math.round(+tgt.value || 0);
          if (s.type === "target" && !v) { toast("목표 금액을 적어 주세요"); return; }
          addAlert({ ...base, type: s.type, target: s.type === "target" || s.type === "cartdrop" ? (v || null) : null }); close(); render();
        } }, "알림 만들기"));
      paint();
      return box;
    });
  }
  function alertsCard() {
    const card = h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:12px 12px 0" }, h("h3", {}, "🔔 관심 시술·가격 알림"), h("span", { class: "sp" }),
      h("span", { class: "sub" }, `${st.alerts.length}/20`)));
    const unread = st.notes.filter((x) => !x.read);
    if (st.notes.length) card.append(h("ul", { class: "list" }, st.notes.slice(0, 8).map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, `${x.read ? "" : "● "}${x.text}`), h("span", { class: "sub" }, x.at))))));
    if (unread.length) setTimeout(() => { for (const x of unread) x.read = true; saveAlerts(); }, 1500);
    card.append(st.alerts.length ? h("ul", { class: "list" }, st.alerts.map((a) => { const now = alertNow(a);
      return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, alertName(a)), h("span", { class: "p num" }, now && now.value != null ? won(now.value) : "-"),
        h("span", { class: "m" }, h("span", { class: "k k4" }, ALERT_TYPES[a.type]), a.target ? h("span", {}, `목표 ${won(a.target)}`) : null, a.base != null && a.type !== "newmatch" ? h("span", {}, `기준 ${won(a.base)}`) : null,
          a.type === "newmatch" && a.base != null ? h("span", {}, `기준 ${a.base}곳`) : null, h("span", { class: "sp" }),
          h("button", { class: "addbtn", type: "button", style: "padding:2px 9px", "aria-label": `${alertName(a)} 알림 해지`, onclick: () => {
            const before = st.alerts.slice(); st.alerts = st.alerts.filter((x) => x !== a); saveAlerts(); render();
            undoToast("알림을 해지했어요", () => { st.alerts = before; saveAlerts(); render(); }); } }, "해지")))); }))
      : h("div", { class: "empty" }, "비교 탭·장바구니·지점 가격표에서 🔔 를 눌러 알림을 만들 수 있어요."));
    return card;
  }

  // ---------------- views
  const views = {};
  let current = "home", lastPath = "";

  // ---------------- price changes since the previous weekly snapshot (listed prices): key + auto-group moves
  const EMO = { "톡신": "💉", "윤곽·필러": "💧", "리프팅": "✨", "부스터": "🌿", "피부": "🌟", "제모·바디": "🪒", "패키지": "🎁", "기타": "➕" };
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
  function remember(kind, id) {
    const v = `${kind}:${id}`;
    const list = [v, ...store.get("recent", []).filter((x) => x !== v)].slice(0, 8);
    store.set("recent", list);
  }
  function recentChips() {
    const items = store.get("recent", []).map((v) => {
      const [kind, ...rest] = v.split(":"), id = rest.join(":");
      if (kind === "k" && KI[id] != null) return h("button", { class: "chip", type: "button", onclick: () => { st.key = KI[id]; nav("compare"); } }, `${EMO[KEYS[KI[id]].cat] || ""} ${KEYS[KI[id]].label}`);
      if (kind === "b" && BK.has(id)) return h("button", { class: "chip", type: "button", onclick: () => nav(`branch/${BK.get(id)}`) }, bdot(BK.get(id)), ` ${bname(BK.get(id))}`);
      return null;
    }).filter(Boolean);
    return items.length ? h("div", {}, h("div", { class: "sub", style: "margin:0 0 6px" }, "최근 본 것"), h("div", { class: "chips" }, items)) : null;
  }

  views.home = () => {
    const box = h("div", { class: "view" });
    const q = h("input", { type: "search", placeholder: "시술 검색 (예: 슈링크 300샷, 리쥬란)", "aria-label": "시술 검색", enterkeyhint: "search" });
    const go = () => { if (q.value.trim()) nav(`search/${encodeURIComponent(q.value.trim())}`); };
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    box.append(h("div", { class: "search" }, h("span", { html: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' }),
      withSuggest(q, (v) => nav(`search/${encodeURIComponent(v)}`)), h("button", { type: "button", onclick: go }, "검색")));
    box.append(h("button", { class: "linkbtn", type: "button", style: "justify-self:start;margin:-4px 4px 0", onclick: () => nav("guide") }, "📖 주름 보톡스? 스킨보톡스? 헷갈리면 시술 사전"));
    // shortcuts
    const ch = changeItems(), dn = ch.filter((x) => x.t === "down").length, up = ch.filter((x) => x.t === "up").length;
    const top1 = branchRanks()[0];
    box.append(h("div", { class: "quick" },
      h("button", { class: "qbtn", type: "button", onclick: () => nav("change") }, h("span", { class: "qi" }, "📉"), h("b", {}, "가격 변동"), h("small", {}, D.meta.prev ? `↓${dn} ↑${up}` : "다음 주부터")),
      h("button", { class: "qbtn", type: "button", onclick: () => nav("rank") }, h("span", { class: "qi" }, "🏆"), h("b", {}, "지점 순위"), h("small", {}, top1 ? BR[top1.b].name : "-")),
      h("button", { class: "qbtn", type: "button", onclick: () => nav("versus") }, h("span", { class: "qi" }, "⚖️"), h("b", {}, "지점 비교"), h("small", {}, "A vs B")),
      h("button", { class: "qbtn", type: "button", onclick: () => nav("cart") }, h("span", { class: "qi" }, "🛒"), h("b", {}, "장바구니"), h("small", {}, `${cur().items.length}개`))));
    box.append(recentChips() || "");
    const F = favs();
    if (F.k.length || F.b.length) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, "★ 즐겨찾기")),
      h("ul", { class: "list" },
        F.k.map((id) => KI[id]).filter((k) => k != null).map((k) => { const top = ranking(k, "price")[0];
          return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k; nav(`compare?k=${KEYS[k].id}`); } }, h("span", { class: "t" }, KEYS[k].label), h("span", { class: "p num" }, top ? won(top.p) : "-"),
            h("span", { class: "m" }, top ? h("span", {}, `${regionName()} 최저 · ${bname(top.b)}`) : null))); }),
        F.b.map((id) => BK.get(id)).filter((b) => b != null).map((b) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b}`) }, h("span", { class: "t row" }, bdot(b), bname(b)),
          h("span", { class: "sub" }, dist(b) != null ? km(dist(b)) : BR[b].region), h("span", { class: "m" }, `가격 ${byB[b].length}개 · 확인 ${verified(b)}`)))))));
    // popular / category cards: cheapest place, how far below the middle, + 담기
    const cats = [...new Set(KEYS.map((k) => k.cat))];
    if (st.hcat && !cats.includes(st.hcat)) st.hcat = null;
    const popular = [...KEYS].sort((a, b) => byKB[b.i].size - byKB[a.i].size).slice(0, 8);
    // a category tab: the main variant of its 8 most-sold families (not every variant — 톡신 alone has 250+)
    const keys = st.hcat ? famsIn(st.hcat).slice(0, 8).map((f) => KEYS[f.main]) : popular;
    const sec = h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, st.loc ? "내 주변, 여기가 제일 싸요" : "인기 시술, 여기가 제일 싸요"), h("span", { class: "sp" }),
      h("span", { class: "sub" }, st.loc ? "10km 안" : regionName())),
      h("div", { class: "chips", style: "margin-top:10px" }, h("button", { class: "chip", type: "button", "aria-pressed": !st.hcat ? "true" : "false", onclick: () => { st.hcat = null; render(); } }, "👑 인기"),
        cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": st.hcat === c ? "true" : "false", onclick: () => { st.hcat = c; render(); } }, `${EMO[c] || ""} ${c}`))));
    const grid = h("div", { class: "grid", style: "margin-top:12px" });
    for (const k of keys) {
      let rk = ranking(k.i, "price"), pl = plainRanking(k.i);
      if (st.loc) { rk = rk.filter((x) => x.d != null && x.d <= 10); pl = pl.filter((x) => x.d != null && x.d <= 10); }
      if (!rk.length) continue;
      // headline: lowest plain price (no 첫 방문·체험가 condition, not far below the median); the median is over the plain set
      const { normal, lowp } = splitLow(pl), lowI = new Set(lowp.map((x) => x.i));
      const base = pl.length ? pl : rk, top = (normal.length ? normal : rk)[0], r = ROWS[top.i], med = median(base.map((x) => x.p));
      const below = med ? Math.round((1 - top.p / med) * 100) : 0, c0 = rk.find((x) => !lowI.has(x.i)), cond = c0 && c0.p < top.p ? c0 : null;
      grid.append(h("div", { class: "pwrap" }, h("button", { class: "pc", type: "button", onclick: () => { st.key = k.i; nav("compare"); } },
        h("span", { class: "pico", "aria-hidden": "true" }, EMO[k.cat] || "•"), h("span", { class: "l" }, k.label), h("span", { class: "p num" }, won(top.p)),
        h("span", { class: below > 0 ? "save" : "save flat" }, below > 0 ? `중간보다 ${below}% 싸요` : `${base.length}곳 비교`),
        h("span", { class: "basis" }, `${pl.length ? "조건 없는 가격" : "조건부 가격"} ${base.length}곳 · 중간값 ${won(med)}`),
        cond ? h("span", { class: "basis" }, `조건부 ${won(cond.p)}~ (${priceConds(cond.i)[0] || "조건 있음"})`) : null,
        lowp.length ? h("span", { class: "basis" }, `확인 필요 초저가 ${won(lowp[0].p)} (중간값의 ${Math.round(lowp[0].p / med * 100)}%)`) : null,
        h("span", { class: "row", style: "gap:4px;min-height:18px" }, kindBadge(r)),
        h("span", { class: "w" }, `${bname(top.b)}${top.d != null ? " · " + km(top.d) : ""}`)), addBtn(k.i)));
    }
    sec.append(grid, h("button", { class: "more-link", type: "button", onclick: () => nav("compare") }, `시술 ${KEYS.length}개 전체 비교 →`));
    box.append(sec);
    // TOP 5 branches by price level
    const tops = branchRanks().slice(0, 5);
    if (tops.length) box.append(h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:12px 12px 0" }, h("h2", {}, "가격 착한 지점 TOP 5"), h("span", { class: "sp" }), h("span", { class: "sub" }, regionName())),
      h("ul", { class: "list" }, tops.map((x, n) => h("li", {}, h("button", { class: "rank top", type: "button", onclick: () => nav(`branch/${x.b}`) },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))), h("span", { class: `p ${lvClass(x.lv)}` }, lvText(x.lv)),
        h("span", { class: "m" }, divBar(x.lv), h("span", {}, `제일 싼 시술 ${D.bstat[x.b][3]}개`), dist(x.b) != null ? h("b", {}, km(dist(x.b))) : null))))),
      h("button", { class: "more-link", type: "button", onclick: () => nav("rank") }, "지점 순위 전체 →")));
    box.append(trendCard() || "");
    // biggest moves since last week (max 2 per branch)
    const pick = (t) => { const per = new Map(); return ch.filter((x) => x.t === t).sort((a, b) => Math.abs(b.after - b.before) / b.before - Math.abs(a.after - a.before) / a.before)
      .filter((x) => { const n = per.get(x.b) || 0; per.set(x.b, n + 1); return n < 2; }).slice(0, 5); };
    if (D.meta.prev && (dn || up)) {
      const t = st.hmove || "down", list = pick(t);
      box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, `${md(D.meta.prev)}보다 ${t === "down" ? "내렸어요" : "올랐어요"}`), h("span", { class: "sp" }),
        h("button", { class: "chip", type: "button", onclick: () => { st.hmove = t === "down" ? "up" : "down"; render(); } }, t === "down" ? `오른 것 ${up}` : `내린 것 ${dn}`)),
        h("ul", { class: "list", style: "margin-top:6px" }, list.map((x) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${x.b}`) },
          h("span", { class: "t" }, x.name), h("span", { class: `p num ${t}` }, won(x.after)),
          h("span", { class: "m" }, bdot(x.b), bname(x.b), h("s", {}, won(x.before)), h("span", { class: t }, `${t === "down" ? "−" : "+"}${Math.round(Math.abs(x.after - x.before) / x.before * 100)}%`)))))),
        h("button", { class: "more-link", type: "button", onclick: () => nav("change") }, "가격 변동 전체 →")));
    }
    box.append(h("div", { class: "note" }, `가격은 각 병원 홈페이지에 올라온 값을 매주 월요일(이벤트가 끝나면 그다음 날에도) 자동으로 모은 거예요. ${vatNote()} 체험가·한정가는 1인 1회예요. 방문 전에 병원에서 꼭 확인하세요. `,
      h("button", { class: "linkbtn", type: "button", onclick: () => nav("about") }, "알아두면 좋은 점 →")));
    return box;
  };

  // ---------------- 가격 변동: everything that moved since the previous snapshot
  views.change = () => {
    const box = h("div", { class: "view" });
    const all = changeItems();
    box.append(h("div", { class: "card" }, h("h2", {}, "가격 변동"),
      h("div", { class: "sub", style: "margin-top:4px" }, D.meta.prev ? `${D.meta.prev} → ${D.meta.updated} · 일반가(병원 표시가) 기준 · ${regionName()}` : "지난주 기록과 비교해요. 첫 기록이 2026-10-13이라 다음 갱신(10/19 월)부터 보여요."),
      h("div", { class: "tiles" }, [["down", "내렸어요"], ["up", "올랐어요"], ["new", "새로 생겼어요"], ["gone", "없어졌어요"]].map(([v, l]) =>
        h("button", { class: "tile tbtn", type: "button", "aria-pressed": st.cdir === v ? "true" : "false", onclick: () => { st.cdir = st.cdir === v ? "all" : v; render(); } },
          h("span", { class: "k" }, l), h("b", { class: `num ${v === "down" ? "down" : v === "up" ? "up" : ""}` }, all.filter((x) => x.t === v).length), h("span", { class: "w" }, st.cdir === v ? "선택됨 · 다시 누르면 전체" : "눌러서 보기"))))));
    if (!all.length) { box.append(h("div", { class: "card empty" }, D.meta.prev ? "지난주와 달라진 가격이 없어요." : "아직 비교할 지난 기록이 없어요. 다음 주 월요일 갱신 뒤에 보여요.")); return box; }
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
          x.t === "new" ? h("span", { class: "k k1" }, "새로 생김") : null, x.t === "gone" ? h("span", { class: "k k4" }, `지난주 ${won(x.before)}`) : null)))));
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
  function rememberQuery(q) { if (!q) return; store.set("recentQ", [q, ...store.get("recentQ", []).filter((x) => x !== q)].slice(0, 8)); }
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
  const SORTS = [["price", "싼 순"], ["unit", "단위당 가격"], ["recent", "최근 확인순"], ["near", "가까운 순"], ["disc", "할인율 큰 순"], ["pos", "중간보다 싼 순"], ["name", "이름순"]];
  const SESS_L = { "1": "1회 가격", pkg: "2회 이상 패키지", pass: "이용권·무제한" }, COND_L = { plain: "조건 없는 가격만", special: "체험가·한정가·시간 조건만" };
  const amtOf = (i) => { const u = Search.unitOf(S[ROWS[i][2]]); return u && !/\+/.test(S[ROWS[i][2]]) ? `${u.qty}${u.unit}` : ""; };
  const areaOk = (b, area) => !area || BR[b].name.includes(area) || (BR[b].addr || "").includes(area);
  const regOk = (b, reg) => !reg ? regionOk(b) : reg === "수도권" ? CAPITAL.includes(BR[b].region) : reg === "전국" ? true : BR[b].region === reg;
  function readFilters(params, q) {
    const P = (k, d = "") => params.get(k) ?? d;
    return { q: q ?? P("q"), cat: +P("cat", -1), brand: +P("brand", -1), b: +P("b", -1), kind: +P("kind", -1), sort: P("sort", "") || store.get("tableSort", "price"),
      min: +P("min", 0) || 0, max: +P("max", 0) || 0, sess: P("sess", ""), cond: P("cond", ""), unit: P("unit", ""), amt: P("amt", ""), area: P("area", ""), reg: P("reg", ""),
      exact: P("exact") === "1", n: +P("n", 100) };
  }
  // every filter as a predicate; skip = one dimension to ignore (for 'how many results would this option give')
  function rowPasses(i, f, tokens, skip = "") {
    const r = ROWS[i];
    if (!live(i) || !brandOn(r[0]) || (!st.special && isSpecial(r))) return false;
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
    if (skip !== "q" && tokens.length && !Search.matches(normBySid.get(r[2]), tokens)) return false;
    return true;
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
      if (route === "table") store.set("lastTable", s);
      render();
    };
    const idx = searchIndex();
    const parsed = f.q ? (f.exact ? { tokens: f.q.split(/\s+/).map(Search.norm).filter(Boolean), fixes: [] } : Search.parse(f.q, idx)) : { tokens: [], fixes: [] };
    const toks = parsed.tokens;
    // results + per-option counts (each count ignores its own filter)
    let hits = [];
    const cnt = { cat: {}, brand: {}, kind: {}, sess: {}, cond: {}, amt: {} };
    const pr = [];
    for (let i = 0; i < ROWS.length; i++) {
      if (!live(i) || !brandOn(ROWS[i][0])) continue;
      const all = rowPasses(i, f, toks);
      if (all) hits.push(i);
      const r = ROWS[i];
      if (rowPasses(i, f, toks, "cat")) cnt.cat[r[1]] = (cnt.cat[r[1]] || 0) + 1;
      if (rowPasses(i, f, toks, "brand")) cnt.brand[BR[r[0]].brand] = (cnt.brand[BR[r[0]].brand] || 0) + 1;
      if (rowPasses(i, f, toks, "kind")) cnt.kind[r[5]] = (cnt.kind[r[5]] || 0) + 1;
      if (rowPasses(i, f, toks, "sess")) { const ss = sessOf(i), k = ss >= 99 ? "pass" : ss >= 2 ? "pkg" : "1"; cnt.sess[k] = (cnt.sess[k] || 0) + 1; }
      if (rowPasses(i, f, toks, "cond")) { const k = isSpecial(r) ? "special" : "plain"; cnt.cond[k] = (cnt.cond[k] || 0) + 1; }
      if (toks.length && rowPasses(i, f, toks, "amt")) { const a = amtOf(i); if (a) cnt.amt[a] = (cnt.amt[a] || 0) + 1; }
      if (rowPasses(i, f, toks, "range")) pr.push(r[3]);
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
    if (f.min || f.max) act.push([`${f.min ? won(f.min) : "0원"} ~ ${f.max ? won(f.max) : "제한 없음"}`, { min: "", max: "" }]);
    const presets = store.get("presets", []);
    const curQs = (() => { const np = new URLSearchParams(params); np.delete("n"); return np.toString(); })();
    box.append(h("div", { class: "card" }, opt.head || null,
      presets.length ? h("div", { class: "chips", style: "margin-top:10px" }, h("span", { class: "sub", style: "align-self:center;flex:none" }, "내 필터"), presets.map((x) => h("span", { class: "chip pchip" },
        h("button", { type: "button", class: "plink", onclick: () => nav(`${x.route}${x.qs ? "?" + x.qs : ""}`) }, x.name),
        h("button", { type: "button", class: "px", "aria-label": `${x.name} 필터 지우기`, onclick: () => { const before = store.get("presets", []); store.set("presets", before.filter((y) => y.id !== x.id)); render(); undoToast(`'${x.name}' 필터를 지웠어요`, () => { store.set("presets", before); render(); }); } }, "×")))) : null,
      act.length ? h("div", { class: "chips", style: "margin-top:10px" }, act.map(([l, patch]) => h("button", { class: "chip on", type: "button", "aria-label": `${l} 해제`, onclick: () => go(patch) }, `${l} ✕`)),
        h("button", { class: "chip", type: "button", onclick: () => go({ reg: "", area: "", cat: -1, brand: -1, b: -1, kind: -1, sess: "", cond: "", amt: "", min: "", max: "" }) }, "모두 해제")) : null,
      h("div", { class: "fgrid" },
        sel("카테고리", "cat", f.cat, [[-1, "전체", null], ...D.meta.cats.map((c, i) => [i, c, cnt.cat[i] || 0])]),
        sel("브랜드", "brand", f.brand, [[-1, "전체", null], ...D.meta.brands.map((b, i) => BR.some((x) => x.brand === i) ? [i, b[0], cnt.brand[i] || 0] : null).filter(Boolean)], { b: "" }),
        sel("지점", "b", f.b, [[-1, "전체", null], ...brs.map((x) => [x.i, bname(x.i), null])]),
        sel("가격 종류", "kind", f.kind, [[-1, "전체", null], ...D.meta.kinds.map((k, i) => [i, k, cnt.kind[i] || 0])]),
        sel("회차", "sess", f.sess, [["", "전체", null], ...Object.entries(SESS_L).map(([k, l]) => [k, l, cnt.sess[k] || 0])]),
        sel("조건", "cond", f.cond, [["", "전체", null], ...Object.entries(COND_L).map(([k, l]) => [k, l, cnt.cond[k] || 0])]),
        sel("정렬", "sort", f.sort, SORTS.map(([v, l]) => [v, l, null]), { unit: "" }),
        h("div", { class: "flabel wide" }, `가격 범위(원) · 최대 ${won(smax)}까지`, rangeBox, h("div", { class: "sliders" }, minR, maxR), err)),
      Object.keys(cnt.amt).length > 1 ? h("div", {}, h("div", { class: "sub", style: "margin:8px 0 6px" }, "용량·샷 수"), h("div", { class: "chips" },
        Object.entries(cnt.amt).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([a, n]) => h("button", { class: "chip", type: "button", "aria-pressed": f.amt === a ? "true" : "false", onclick: () => go({ amt: f.amt === a ? "" : a }) }, `${a} (${n})`)))) : null,
      h("div", { class: "row", style: "margin-top:4px" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }), whenChip(),
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
    else hits.sort((a, b) => ROWS[a][3] - ROWS[b][3] || tie(a, b));
    if (parsed.fixes.length) box.append(h("div", { class: "note" }, parsed.fixes.map(([a, b]) => `‘${a}’ 대신 ‘${b}’로 찾았어요. `), h("button", { class: "linkbtn", type: "button", onclick: () => go({ exact: true }) }, "입력한 그대로 찾기")));
    if (unitInfo && unitInfo.units.length > 1) box.append(h("div", { class: "chips" }, unitInfo.units.map(([u, n]) => h("button", { class: "chip", type: "button", "aria-pressed": u === unitInfo.unit ? "true" : "false", onclick: () => go({ unit: u, sort: "unit" }) }, `${u === "샷" ? "100샷" : u === "U" ? "10U" : "1" + u}당 · ${n}개`))));
    for (const n of notes) box.append(h("div", { class: "note" }, n));
    const minP = hits.length ? Math.min(...hits.map((i) => ROWS[i][3])) : 0;
    box.append(h("div", { class: "searchstat", role: "status" }, hits.length ? `가격 ${hits.length.toLocaleString()}개 · 가장 싼 ${won(minP)} (${new Set(hits.filter((i) => ROWS[i][3] === minP).map((i) => ROWS[i][0])).size}개 지점)` : "조건에 맞는 가격이 없어요"));
    if (!hits.length) { box.append(noResults(f, toks, go)); return box; }
    box.append(h("div", { class: "card flush" }, h("ul", { class: "list" }, hits.slice(0, f.n).map((i) => { const r = ROWS[i], x = rowPos(i), u = Search.unitPrice(S[r[2]], r[3]);
      return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
        h("span", { class: "m" }, h("button", { class: "linkbtn", type: "button", onclick: () => nav(`branch/${r[0]}`) }, bdot(r[0]), bname(r[0])), r[4] ? h("s", {}, won(r[4])) : null,
          r[4] ? h("span", { class: "k kt" }, `${Math.round(disc(i) * 100)}%↓`) : null, kindBadge(r),
          u ? h("span", { class: "unitp" }, `${u.unit === "샷" ? "100샷" : u.unit === "U" ? "10U" : "1" + u.unit}당 ${won(u.price)}`) : null,
          x ? h("span", { class: x.vsMed < -0.005 ? "down" : x.vsMed > 0.005 ? "up" : "" }, `${x.n}곳 중 ${x.rank}위`) : null,
          f.sort === "recent" ? h("span", {}, `${ver(i)} 확인`) : null, dist(r[0]) != null ? h("b", {}, km(dist(r[0]))) : null,
          srcLink(i), h("span", { class: "sp" }), rowAddBtn(i)))); })),
      hits.length > f.n ? h("button", { class: "more-link", type: "button", onclick: () => go({ n: f.n + 200 }) }, `더 보기 (${(hits.length - f.n).toLocaleString()}개 남음)`) : null));
    return box;
  }
  // zero results: offer the nearest searches that do return something
  function noResults(f, toks, go) {
    const count = (ff, tk) => { let n = 0; for (let i = 0; i < ROWS.length; i++) if (rowPasses(i, ff, tk)) n++; return n; };
    const bare = { ...f, cat: -1, brand: -1, b: -1, kind: -1, sess: "", cond: "", amt: "", min: 0, max: 0, area: "", reg: "전국" };
    const tips = [];
    const hasF = f.cat >= 0 || f.brand >= 0 || f.b >= 0 || f.kind >= 0 || f.sess || f.cond || f.amt || f.min || f.max || f.area || f.reg;
    if (hasF) { const n = count(bare, toks); if (n) tips.push([`필터 모두 빼고 찾기 (${n.toLocaleString()}개)`, () => go({ reg: "전국", area: "", cat: -1, brand: -1, b: -1, kind: -1, sess: "", cond: "", amt: "", min: "", max: "" })]); }
    if (!f.reg || f.reg !== "전국") { const n = count({ ...f, reg: "전국" }, toks); if (n) tips.push([`전국에서 찾기 (${n.toLocaleString()}개)`, () => go({ reg: "전국" })]); }
    if (toks.length > 1) toks.forEach((tk, j) => { const rest = toks.filter((_, k) => k !== j); const n = count(f, rest); if (n) tips.push([`‘${tk}’ 빼고 찾기 (${n.toLocaleString()}개)`, () => go({ q: rest.join(" ") })]); });
    if (toks.length) for (const s of Search.suggest(toks[0], searchIndex(), suggestTerms(), 3)) tips.push([`‘${s}’ 찾기`, () => nav(`search/${encodeURIComponent(s)}`)]);
    return h("div", { class: "card" }, h("div", { class: "empty", style: "padding:12px 0" }, "이 조건으로는 가격이 없어요."),
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
      h("div", { class: "search", style: "margin-top:10px;box-shadow:none;background:var(--fill)" }, withSuggest(q, run))] }));
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
      const keep = () => { const list = store.get("reports", []); list.unshift({ at: today(), n: S[r[2]], br: bkey(r[0]), why: s.why }); store.set("reports", list.slice(0, 50)); };
      const paint = () => fill(box,
        h("div", { class: "sub" }, `${bname(r[0])} · ${S[r[2]]} · ${won(r[3])}`),
        h("div", { class: "opts", style: "margin-top:10px" }, reasons.map((x) => h("button", { class: "opt", type: "button", "aria-pressed": s.why === x ? "true" : "false", onclick: () => { s.why = x; paint(); } }, h("b", {}, x)))),
        h("label", { class: "flabel" }, "메모 (선택)", note),
        h("div", { class: "sub", style: "margin-top:8px" }, "신고는 운영자가 확인해 다음 갱신에 반영해요. GitHub 계정이 없으면 '내용 복사'로 운영자에게 보내 주세요."),
        h("div", { class: "sub", style: "margin-top:4px;color:var(--pricey)" }, "GitHub 신고는 누구나 볼 수 있는 공개 글이에요. 메모에 이름·연락처 같은 개인정보를 적지 마세요."),
        h("div", { class: "row", style: "margin-top:12px" },
          h("button", { class: "btn gray", type: "button", onclick: () => { keep(); copyText(body(), "신고 내용을 복사했어요"); close(); } }, "내용 복사"),
          h("a", { class: "btn", style: "flex:1;text-align:center;text-decoration:none", target: "_blank", rel: "noopener",
            href: `https://github.com/lsy2825/skin/issues/new?${new URLSearchParams({ title: `[가격 신고] ${bname(r[0])} ${S[r[2]]}`.slice(0, 120), body: body(), labels: "price-report" })}`,
            onclick: () => { keep(); setTimeout(close, 100); } }, "GitHub로 신고")));
      paint();
      return box;
    });
  }

  // ---------------- 운영 현황 (ingestion status, freshness, review queue, source policy) — behind the PIN screen
  const FLAGS = Object.assign({ ops: true, ads: false, booking: false, emailAlerts: false, publicIndex: false }, (window.APP_CONFIG || {}).flags || {});
  views.ops = () => {
    const box = h("div", { class: "view" });
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, "‹ 뒤로"));
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
    // review queue
    const rv = A.review || [];
    box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, `검토 큐 ${rv.filter((x) => x.status === "검토 대기").length}개`),
      h("div", { class: "sub" }, "지난주보다 90% 넘게 내리거나 10배 넘게 오른 가격. 확인 전까지 비교에서 빠져요."),
      h("div", { class: "sub", style: "margin-top:4px" }, "승인: data2/review_ok.csv 에 brand,branch,name,price 한 줄을 추가 → 다음 빌드부터 반영(변경은 git 기록으로 남아요). ",
        h("a", { class: "linkbtn src", href: `${REPO}/blob/main/data2/review.csv`, target: "_blank", rel: "noopener" }, "review.csv"))),
      rv.length ? h("ul", { class: "list" }, rv.map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, x.name), h("span", { class: "p num" }, `${(+x.price).toLocaleString()}원`),
        h("span", { class: "m" }, h("span", {}, `${x.brand} ${x.branch}`), h("s", {}, `${(+x.before).toLocaleString()}원`), h("span", { class: "up" }, x.change), h("span", { class: x.status === "승인됨" ? "k k1" : "k kx" }, x.status),
          x.url ? h("a", { class: "linkbtn src", href: x.url, target: "_blank", rel: "noopener noreferrer" }, "출처") : null)))))
        : h("div", { class: "empty" }, D.meta.prev ? "검토할 가격이 없어요" : "지난주 기록이 생긴 뒤(다음 갱신)부터 확인해요")));
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
      h("div", { class: "chips wrapc", style: "margin-top:8px" }, Object.entries({ ops: "운영 현황", ads: "광고", booking: "예약 연결", emailAlerts: "메일 알림", publicIndex: "검색 노출" }).map(([k, l]) =>
        h("span", { class: "chip", style: "cursor:default" }, `${l}: ${FLAGS[k] ? "켬" : "끔"}`))),
      h("div", { class: "sub", style: "margin-top:8px" }, `로그인: ${window.Auth && window.Auth.enabled ? "켬" : "끔(키 없음)"}`)));
    return box;
  };

  // ---------------- 알아두면 좋은 점: how prices are collected, compared and checked
  views.about = () => {
    const box = h("div", { class: "view" });
    const A = D.meta.about || {}, src = A.sources || {};
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, "‹ 뒤로"));
    box.append(h("div", { class: "card" }, h("h2", {}, "알아두면 좋은 점"),
      h("div", { class: "note", style: "margin-top:10px" }, "이 앱은 병원 홈페이지에 공개된 가격을 모아 비교만 해요. 의료 상담·진단을 하지 않고 시술 효과나 안전을 보장하지 않아요. 예약·결제·광고·수수료가 없고, 어떤 병원과도 금전 관계가 없어요."),
      h("h3", { style: "margin-top:16px" }, "가격 종류"),
      h("dl", { class: "kv", style: "margin-top:8px" },
        h("dt", {}, h("span", { class: "k k1" }, "체험가")), h("dd", {}, "처음 한 번만 되는 가격(보통 1인 1회)"),
        h("dt", {}, h("span", { class: "k k2" }, "한정가")), h("dd", {}, "기간·수량·첫 방문 등 조건이 붙은 가격"),
        h("dt", {}, h("span", { class: "k kt" }, "평일 낮 등")), h("dd", {}, "그 시간·요일에만 되는 가격"),
        h("dt", {}, h("span", { class: "k k4" }, "고시가")), h("dd", {}, "리엔장 비급여 진료비 고시표(정가). 이벤트가가 아니에요"),
        h("dt", {}, h("span", { class: "k k4" }, "~10/17까지")), h("dd", {}, "병원이 적은 이벤트 종료일. 지나면 비교에서 빠지고, 다음 날 아침 다시 모아요"),
        h("dt", {}, h("span", { class: "k kx" }, "급변·확인 중")), h("dd", {}, "지난주보다 90% 넘게 내리거나 10배 넘게 오른 가격. 확인 전까지 비교에서 빠져요")),
      h("h3", { style: "margin-top:16px" }, "어떻게 비교하나요"),
      h("ul", { class: "plain" },
        h("li", {}, "같은 조건끼리만 비교해요. 브랜드가 다르면 용량·샷 수·회차·원산지가 같은 36개 시술만 맞대고, 그 밖은 이름이 똑같은 옵션을 3곳 이상이 팔 때만 묶어요. 비슷하지만 다른 상품은 묶지 않아요."),
        h("li", {}, "지점 순위의 '몇 % 싸요'는 같은 옵션을 파는 지점들의 중간 가격 대비 평균(기하평균)이에요."),
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
  const cmpNav = (cur) => h("div", { class: "seg seg4", role: "tablist" }, [["compare", "시술별"], ["rank", "지점 순위"], ["versus", "지점 비교"], ["table", "전체 가격표"]].map(([v, l]) =>
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
      h("div", { class: "fact" }, h("dt", {}, "빼는 가격"), h("dd", {}, "기간이 끝난 이벤트, 지난주보다 급변해 확인 중인 가격, 고른 방문일에 안 되는 가격은 모든 계산에서 빼요. 수집에 실패한 지점은 '조건 없는 최저가'에서 빼요.")),
      h("div", { class: "fact" }, h("dt", {}, "초저가 표시"), h("dd", {}, `중간값의 ${Math.round(LOW_SHARE * 100)}% 이하인 가격에 '초저가·조건 확인'을 붙여요. 조건 문구가 없어도 이런 가격을 1~2곳만 내고 있으면 원본을 확인하기 전까지 '조건 없는 최저가'로 쓰지 않고 '확인 필요'로 따로 보여줘요(여러 지점이 같은 값이면 그 체인의 보통 가격으로 봐요). ⓘ를 누르면 조건·부가세·원본을 볼 수 있어요.`)))));
  }
  // ---------------- families and plain-language notes (시술 사전)
  const CMP_CATS = ["톡신", "윤곽·필러", "리프팅", "부스터", "피부", "제모·바디", "패키지", "기타"];
  const CAT_START = { "톡신": "X01", "윤곽·필러": "X09", "리프팅": "X12", "부스터": "X24", "피부": "X28", "제모·바디": "X35" };
  const famsIn = (c) => FAM.filter((f) => f.cat === c).sort((a, b) => b.n - a.n);
  const famNorm = (f) => f.norm || (f.norm = Search.norm(`${f.name} ${f.cat} ${f.vs.map((v) => v.label).join(" ")} ${KEYS[f.main].label}`));
  const famFind = (text) => { const t = text.trim() ? Search.parse(text, searchIndex()).tokens : []; return t.length ? FAM.filter((f) => Search.matches(famNorm(f), t)).sort((a, b) => b.n - a.n) : []; };
  const kbOf = (f) => (f && (kbByFam.get(f.name) || kbByFid.get(f.fid))) || null;
  const famByName = (n) => FAM.find((f) => f.name === n);
  const MAIN_TYPES = { toxin: ["주름 보톡스", "사각턱 보톡스", "스킨보톡스", "다한증 보톡스", "바디 보톡스"], filler: ["코 필러", "턱끝 필러", "애교 필러", "눈밑 필러", "입술 필러"],
    lifting: ["슈링크 유니버스", "울쎄라", "써마지 FLX", "인모드", "올리지오"], toning: ["레이저토닝", "피코토닝", "제네시스", "착색토닝"] };
  const DISCLAIM = "일반적인 설명이에요. 진단이나 효과 보장이 아니고 특정 시술을 권하지 않아요. 나에게 맞는지는 의료진과 상담하세요.";
  const KB_REPO = "https://github.com/lsy2825/skin";
  const reviewBadge = (e) => { const r = e.review || {}; const t = (KB.statuses || {})[r.status] || r.status;
    return h("span", { class: `k ${r.status === "approved" ? "k1" : "kx"}`, title: r.status === "approved" ? `${r.reviewer} · ${r.reviewed_at}` : "의료진이 아직 확인하지 않은 초안이에요" }, r.status === "approved" ? `✓ ${t}` : t); };
  const evidenceBadge = (e) => h("span", { class: `k ${e.sources.length ? "k4" : "kx"}` }, e.sources.length ? `근거 출처 ${e.sources.length}개` : "근거 자료 미정리");
  // short card on the compare tab: one line + purpose + how it differs, review state, quick view
  function guideBox(f) {
    const e = kbOf(f);
    if (!e && !f.desc.length) return null;
    return h("div", { class: "guide" },
      h("div", { class: "row", style: "gap:6px;flex-wrap:nowrap" }, h("b", {}, `${f.name}, 뭐예요?`), h("span", { class: "sp" }),
        e ? h("button", { class: "linkbtn", type: "button", onclick: () => kbSheet(e, f) }, "자세히") : null,
        h("button", { class: "linkbtn", type: "button", onclick: () => nav(`guide?c=${encodeURIComponent(f.cat)}`) }, "시술 사전 →")),
      e ? h("p", {}, `${e.one_liner} ${e.purpose}`) : null,
      e && e.method ? h("p", { class: "sub" }, e.method) : null,
      f.desc.length ? h("p", { class: "sub" }, `병원 설명: ${f.desc.join(" · ")}`) : null,
      e ? h("div", { class: "row", style: "gap:4px;margin-top:6px" }, reviewBadge(e), evidenceBadge(e)) : null,
      h("p", { class: "tiny" }, e ? DISCLAIM : "병원이 상품 이름에 적은 설명이에요."));
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
  function variantRows(vs, cur) {
    const groups = new Map();
    for (const v of vs) {
      const amt = (v.label.match(UNIT_RX) || []).map((x) => x.trim()).join(" ");
      const g = v.label.replace(UNIT_RX, " ").replace(/\s+/g, " ").trim() || "기본";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ v, amt: amt || "1회" });
    }
    return h("div", { class: "vrows" }, [...groups].map(([g, xs]) => h("div", { class: "vrow" }, h("span", { class: "vg" }, g),
      h("div", { class: "vchips" }, xs.map(({ v, amt }) => { const rr = ranking(v.k, "price");
        return h("button", { class: "vchip", type: "button", "aria-pressed": v.k === cur ? "true" : "false", "aria-label": `${g} ${amt}${rr.length ? ` 최저 ${won(rr[0].p)}` : ""}`,
          onclick: () => pickKey(v.k) }, h("b", {}, amt), h("span", { class: "num" }, rr.length ? won(rr[0].p) : "없음")); })))));
  }
  views.guide = (arg, params) => {
    const box = h("div", { class: "view" });
    const c = params.get("c") || "";
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, "‹ 뒤로"));
    const q = h("input", { type: "search", class: "field", placeholder: "시술 이름으로 찾기 (예: 보톡스)", "aria-label": "시술 사전에서 찾기", value: params.get("q") || "" });
    const list = h("div", {});
    box.append(h("div", { class: "card" }, h("h2", {}, "시술 사전"),
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
      fill(list, out.length ? out : h("div", { class: "empty" }, "맞는 시술이 없어요."), h("p", { class: "tiny", style: "margin-top:12px" }, DISCLAIM + " 설명이 없는 시술은 병원이 상품 이름에 적은 설명만 보여줘요. 설명은 의료진 검수 전 초안이에요."));
    };
    let tm = 0;
    q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(paint, 150); });
    paint();
    return box;
  };
  views.compare = (arg, params) => {
    const box = h("div", { class: "view" });
    if (params && params.get("k") && KI[params.get("k")] != null) st.key = KI[params.get("k")];
    if (st.key == null) st.key = 0;
    if (KEYS[st.key] && (!params || params.get("k") !== KEYS[st.key].id)) history.replaceState(null, "", `#compare?k=${KEYS[st.key].id}`);
    if (st.key != null && KEYS[st.key]) remember("k", KEYS[st.key].id);
    box.append(cmpNav("compare"));
    if (st.key == null) st.key = 0;
    const k = KEYS[st.key];
    const fam = famOf[k.i];
    // category → family (제품군) → variant (용량·부위·횟수). Families are ordered by how many branches sell them.
    const cats = CMP_CATS.filter((c) => FAM.some((f) => f.cat === c));
    box.append(h("div", { class: "chips" }, cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": c === k.cat ? "true" : "false",
      onclick: () => pickKey(KI[CAT_START[c]] ?? famsIn(c)[0].main) }, `${c} ${famsIn(c).length}`))));
    const sel = h("select", { class: "pick", "aria-label": "시술 고르기", onchange: (e) => pickKey(FAM[+e.target.value].main) },
      fam ? null : h("option", { value: "", selected: true }, k.label),
      famsIn(k.cat).map((f) => h("option", { value: f.idx, selected: !!fam && f === fam.f }, `${f.name} · ${f.n}곳`)));
    const rk = ranking(k.i);
    const card = h("div", { class: "card" });
    card.append(h("div", { class: "keyhead" }, h("div", { class: "row", style: "flex-wrap:nowrap" }, sel, favBtn("k", k.id, k.label))));
    card.append(famFinder());
    if (fam && fam.f.vs.length > 1) {
      // one row per kind ('힐러', 'HB 플러스', '아이 힐러' …), one chip per amount; packages of several sessions folded
      const one = fam.f.vs.filter((v) => !/\d+회$/.test(v.label)), many = fam.f.vs.filter((v) => /\d+회$/.test(v.label));
      card.append(h("div", { class: "sub", style: "margin-top:12px" }, `${fam.f.name} ${fam.f.vs.length}가지 · 용량·부위·횟수가 같은 것끼리만 비교해요`));
      if (one.length) card.append(variantRows(one, k.i));
      if (many.length) card.append(h("details", { class: "fold small", open: many.some((v) => v.k === k.i) }, h("summary", {}, `여러 회 묶음 ${many.length}가지`), variantRows(many, k.i)));
    }
    if (fam) card.append(guideBox(fam.f) || "");
    const controls = h("div", { class: "row", style: "margin-top:12px" },
      h("button", { class: "chip", type: "button", "aria-pressed": st.sort === "price" ? "true" : "false", onclick: () => { st.sort = "price"; store.set("sort", "price"); render(); } }, "가격순"),
      h("button", { class: "chip", type: "button", "aria-pressed": st.sort === "near" ? "true" : "false", onclick: () => { if (!st.loc) locSheet(); st.sort = "near"; store.set("sort", "near"); render(); } }, "가까운순"),
      h("span", { class: "sp" }),
      switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }));
    card.append(controls, h("div", { class: "row", style: "margin-top:8px" }, whenChip()), brandChips());
    if (rk.length) {
      // headline = the lowest price with no condition at a branch read this week; conditional ones (첫 방문 체험가 …) shown apart
      const plain = plainRanking(k.i), { normal, lowp } = splitLow(plain), ptop = normal[0], lowI = new Set(lowp.map((x) => x.i));
      const ctop = [...rk].filter((x) => !lowI.has(x.i)).sort((x, y) => x.p - y.p)[0];
      const top = ptop || ctop || lowp[0];
      // the median is taken over the same set as the headline (plain prices when there are any), so the two never disagree
      const prices = (ptop ? plain : rk).map((x) => x.p).sort((a, b) => a - b), med = median(prices);
      card.append(h("div", { class: "hero", style: "margin-top:14px" }, h("span", { class: "hl" }, ptop ? `조건 없는 최저가 · 확인된 ${plain.length}곳 중` : `조건이 붙은 가격만 있어요 · ${rk.length}곳`),
        h("span", { class: "hb" }, bname(top.b)), h("span", { class: "hp num" }, won(top.p)),
        h("span", { class: "hl", style: "color:var(--muted);font-weight:600" }, `중간값 ${won(med)} · 가장 비싼 곳 ${won(prices[prices.length - 1])} `,
          h("button", { class: "linkbtn", type: "button", onclick: () => basisSheet(k, rk, plain) }, "계산 기준")),
        h("span", { class: "hl row", style: "color:var(--muted);font-weight:600;gap:8px" }, h("span", {}, S[ROWS[top.i][2]]), kindBadge(ROWS[top.i]),
          listedTxt(ROWS[top.i]) ? h("span", {}, listedTxt(ROWS[top.i])) : null, h("span", {}, `${fresh(top.b).d} 확인`),
          h("button", { class: "linkbtn", type: "button", onclick: () => priceSheet(top.i) }, "가격 근거"), srcLink(top.i, "출처 보기"))));
      if (ptop && ctop.p < ptop.p) card.append(h("div", { class: "condlow" },
        h("div", { class: "row", style: "gap:6px" }, h("b", { class: "num" }, `조건부 최저 ${won(ctop.p)}`), h("span", { class: "sub" }, bname(ctop.b)), h("span", { class: "sp" }),
          h("button", { class: "linkbtn", type: "button", onclick: () => priceSheet(ctop.i) }, "조건 확인 →")),
        h("div", { class: "sub" }, (priceConds(ctop.i).join(" · ") || "이번 주 확인 안 된 지점") + " — 조건이 맞을 때만 이 가격이에요.")));
      if (ptop && lowp.length) card.append(h("div", { class: "condlow" },
        h("div", { class: "row", style: "gap:6px" }, h("b", { class: "num" }, `확인 필요 초저가 ${won(lowp[0].p)}`), h("span", { class: "sub" }, `${bname(lowp[0].b)}${lowp.length > 1 ? ` 외 ${lowp.length - 1}곳` : ""}`), h("span", { class: "sp" }),
          h("button", { class: "linkbtn", type: "button", onclick: () => priceSheet(lowp[0].i) }, "가격 근거 →")),
        h("div", { class: "sub" }, `조건 문구는 없지만 중간값의 ${Math.round(lowp[0].p / med * 100)}%이고 이 가격인 지점이 ${lowp.filter((x) => x.p === lowp[0].p).length}곳뿐이에요. 표시 안 된 행사나 입력 오류일 수 있어서, 원본을 확인하기 전까지 최저가로 쓰지 않아요.`)));
      card.append(h("div", { class: "row", style: "margin-top:12px" }, addBtn(k.i),
        h("button", { class: "btn sm gray", type: "button", onclick: () => alertSheet({ k: k.id }) }, "🔔 알림"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => copyText([`[${k.label}] ${regionName()} 최저가 (${D.meta.updated} 기준, ${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"})`,
          ...rk.slice(0, 3).map((x, n) => `${n + 1}. ${bname(x.b)} ${won(x.p)} — ${S[ROWS[x.i][2]]}${S[ROWS[x.i][11]] ? ` (${S[ROWS[x.i][11]]})` : ""}`)].join("\n"), "최저가 3곳을 복사했어요") }, "복사"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { st.mapKey = k.i; nav("map"); } }, "지도에서 보기")));
      const spread = prices[0] ? prices[prices.length - 1] / prices[0] : 1;
      const r0 = ROWS[top.i];
      card.append(h("div", { class: "sub", style: "margin-top:10px" }, [
        spread >= 1.05 ? `가장 싼 곳과 비싼 곳은 최대 ${spread.toFixed(1)}배 차이` : "지점 간 차이가 거의 없어요",
        r0[4] ? `최저가는 병원 정가보다 ${Math.round((r0[4] - r0[3]) / r0[4] * 100)}% 싸요` : null].filter(Boolean).join(" · ")));
      // best per brand
      const per = D.meta.brands.map((bb, bi) => ({ bi, x: rk.filter((y) => BR[y.b].brand === bi).sort((p, q) => p.p - q.p)[0] })).filter((y) => y.x);
      if (per.length > 1) card.append(h("div", { class: "tiles", style: "margin-top:12px" }, per.sort((p, q) => p.x.p - q.x.p).map((y, n) => h("button", { class: "tile tbtn", type: "button", onclick: () => nav(`branch/${y.x.b}`) },
        h("span", { class: "k row", style: "gap:6px" }, h("span", { class: "bdot", style: `background:${D.meta.brands[y.bi][1]}` }), D.meta.brands[y.bi][0]),
        h("b", { class: "num" }, won(y.x.p)), h("span", { class: "w" }, `${BR[y.x.b].name}${n ? ` · +${won(y.x.p - per[0].x.p)}` : " · 브랜드 중 최저"}`)))));
      // branches (of the brands shown, in this region) with no price for it
      const have = new Set(rk.map((y) => y.b));
      const none = BR.filter((y) => brandOn(y.i) && regionOk(y.i) && !have.has(y.i));
      if (none.length) card.append(h("details", { class: "fold small" }, h("summary", {}, `이 시술 가격이 없는 지점 ${none.length}곳`),
        h("div", { class: "sub", style: "padding:0 4px 8px" }, none.map((y) => bname(y.i)).join(", "), " — 같은 시술을 팔지 않거나, 용량·회차가 달라 묶지 않은 곳이에요.")));
    }
    box.append(card);
    // favorite branches pinned for this procedure (price or 'not offered'), with the gap to the cheapest
    const fb = favs().b.map((id) => BK.get(id)).filter((b) => b != null);
    if (fb.length && rk.length) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, "★ 즐겨찾는 지점")),
      h("ul", { class: "list" }, fb.map((b) => { const x = rk.find((y) => y.b === b);
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b}`) }, h("span", { class: "t row" }, bdot(b), bname(b)),
          h("span", { class: "p num" }, x ? won(x.p) : "없음"),
          h("span", { class: "m" }, x ? (x.p === rk[0].p ? h("span", { class: "down" }, "최저가와 같아요") : h("span", {}, `최저보다 +${won(x.p - rk[0].p)} · ${rk.indexOf(x) + 1}위`)) : h("span", {}, "이 지점은 이 시술 가격이 없어요"),
            x ? kindBadge(ROWS[x.i]) : null))); }))));
    box.append(keyTrend(k) || "");
    // list-price discount: a different thing from the price history above (clinics' own 정가 this week, not past prices)
    const trd = TR().disc[k.id];
    if (trd != null) box.append(h("div", { class: "card" }, h("h3", {}, "정가 대비 할인율 (이번 주)"),
      h("div", { class: "sub" }, `병원이 상품에 적은 정가와 판매가를 비교한 값이에요. 정가가 적힌 가격만 계산하고, 위 '가격 이력'(실제로 관측한 과거 가격)과는 다른 숫자예요.`),
      h("div", { class: "tiles", style: "margin-top:8px" }, h("div", { class: "tile" }, h("span", { class: "k" }, "할인율 중간값"), h("b", { class: "num" }, `${trd}%`), h("span", { class: "w" }, "병원 표기 정가 기준")))));
    const list = h("ul", { class: "list" });
    const medAll = median(rk.map((x) => x.p));
    rk.slice(0, 300).forEach((x, n) => {
      const r = ROWS[x.i], low = rk.length >= 3 && medAll && x.p <= medAll * LOW_SHARE;
      list.append(h("li", { class: "rk" }, h("button", { class: "rank" + (n < 3 && st.sort === "price" ? " top" : ""), type: "button", onclick: () => nav(`branch/${x.b}`) },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))),
        h("span", { class: "p num" }, won(x.p)),
        h("span", { class: "m" }, S[r[2]], r[4] ? h("s", {}, won(r[4])) : null, low ? h("span", { class: checkedOk(x.i) ? "k k1" : "k kx", title: `중간값 ${won(medAll)}의 ${Math.round(x.p / medAll * 100)}%` }, checkedOk(x.i) ? `초저가·원본 확인 ${CHK.get(x.i).d.slice(5)}` : "초저가·조건 확인") : null,
          kindBadge(r), fresh(x.b).stale ? h("span", { class: "k kx" }, "지난 자료") : null, x.d != null ? h("b", {}, km(x.d)) : null)),
        h("button", { class: "infob", type: "button", "aria-label": `${bname(x.b)} 가격 근거 보기`, onclick: () => priceSheet(x.i) }, "ⓘ")));
    });
    box.append(h("div", { class: "card flush" }, rk.length ? list : h("div", { class: "empty" }, "조건에 맞는 지점이 없어요. 브랜드나 특가 설정을 바꿔 보세요.")));
    box.append(h("div", { class: "note" }, `${vatNote()} 같은 시술로 묶는 기준: 용량·샷 수·회차·원산지가 같은 1회 가격. 다른 시술과 묶인 패키지, 추가 옵션, 구독권은 빠져요. 종료일이 지난 이벤트와 확인 중인 급변 가격도 빠져요.`));
    return box;
  };

  function switchEl(label, on, set) {
    const inp = h("input", { type: "checkbox", checked: on, onchange: (e) => set(e.target.checked) });
    return h("label", { class: "switch" }, inp, h("span", { class: "tr", "aria-hidden": "true" }), label);
  }
  function brandChips() {
    return h("div", { class: "chips", style: "margin-top:10px" }, D.meta.brands.map((b, i) => !BR.some((x) => x.brand === i) ? null : h("button", {
      class: "chip", type: "button", "aria-pressed": st.brands.includes(i) ? "true" : "false",
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
      h("button", { class: "btn sm soft", type: "button", onclick: () => locate(() => { if (map && st.loc) map.setView([st.loc.lat, st.loc.lng], 13); }) }, "내 위치로")),
      h("div", { style: "margin-top:8px" }, areaSearch()),
      h("div", { class: "row", style: "margin-top:8px" }, ["집", "직장"].map((n) => h("button", { class: "btn sm gray", type: "button", onclick: () => { if (!map) return; const c = map.getCenter(); savePlace(n, c.lat, c.lng); usePlace(n); } }, `지도 가운데를 ${n}으로`))),
      h("div", { style: "margin-top:10px" }, keySel), brandChips()));
    // touch screens: the map starts locked so a finger scrolls the page; '지도 움직이기' unlocks one-finger panning
    const touch = typeof L !== "undefined" && L.Browser.mobile;
    const lockBtn = h("button", { class: "mapbtn", type: "button", "aria-pressed": "false", onclick: () => setMapLock(!st.mapLocked) }, "");
    const again = h("button", { class: "mapbtn again", type: "button", hidden: true, onclick: () => { again.hidden = true; paintNear(); } }, "↻ 이 지역 재검색");
    box.append(h("div", { class: "mapwrap" }, h("div", { id: "map", role: "application", "aria-label": "지점 지도" }), h("div", { class: "mapbar" }, touch ? lockBtn : null, again)));
    box.append(h("div", { class: "card flush", id: "near" }));
    st.mapLocked = touch;
    setTimeout(() => { initMap(again); setMapLock(st.mapLocked, lockBtn); drawMap(); paintNear(); }, 0);
    return box;
  };
  function setMapLock(v, btn) {
    st.mapLocked = v; btn = btn || $(".mapbtn[aria-pressed]");
    if (map) { if (v) { map.dragging.disable(); } else { map.dragging.enable(); } }
    if (btn) { btn.setAttribute("aria-pressed", v ? "false" : "true"); btn.textContent = v ? "🔒 지도 움직이기" : "🔓 움직이는 중 · 잠그기"; }
  }
  function initMap(again) {
    if (typeof L === "undefined") { $("#map").replaceWith(h("div", { class: "card empty" }, "지도를 불러오지 못했어요(인터넷 연결 확인).")); return; }
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
    const pts = BR.filter((b) => b.lat != null && brandOn(b.i) && (!prices || prices.has(b.i)));
    // grid clustering in screen space: branches closer than ~48px at this zoom become one marker with a count
    const z = map.getZoom(), cell = 48, cells = new Map();
    for (const b of pts) { const q = map.project([b.lat, b.lng], z); const key = `${Math.floor(q.x / cell)}:${Math.floor(q.y / cell)}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(b); }
    for (const grp of cells.values()) {
      if (grp.length > 1 && z < 16) {
        const lat = grp.reduce((s, b) => s + b.lat, 0) / grp.length, lng = grp.reduce((s, b) => s + b.lng, 0) / grp.length;
        const lo = prices ? Math.min(...grp.map((b) => prices.get(b.i).p)) : null;
        const sel = grp.some((b) => b.i === st.mapSel);
        const m = L.marker([lat, lng], { icon: L.divIcon({ className: "", html: `<span class="pin-cluster${sel ? " sel" : ""}${lo === min ? " best" : ""}">${grp.length}곳${lo != null ? ` · ${priceLabel(lo)}~` : ""}</span>`, iconSize: [0, 0] }),
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
      m = L.marker(ll, { icon: L.divIcon({ className: "", html: `<span class="pin-price${x.p === min ? " best" : ""}${sel ? " sel" : ""}" style="--c:${color}">${priceLabel(x.p)}</span>`, iconSize: [0, 0] }), keyboard: true, title: bname(b.i) });
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
    m.on("click", () => { st.mapSel = b.i; markListSel(true); });
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
  function paintNear() {
    const el = $("#near");
    if (!el || !map) return;
    const bounds = map.getBounds();
    let list = BR.filter((b) => b.lat != null && brandOn(b.i) && bounds.contains([b.lat, b.lng]));
    const price = st.mapKey != null ? new Map(ranking(st.mapKey, "price").map((x) => [x.b, x])) : null;
    if (price) list = list.filter((b) => price.has(b.i));
    list = list.map((b) => ({ b, d: dist(b.i), p: price ? price.get(b.i).p : null }))
      .sort((x, y) => st.loc ? (x.d - y.d) : price ? x.p - y.p : x.b.name.localeCompare(y.b.name, "ko"));
    el.replaceChildren(h("div", { style: "padding:12px 12px 4px" }, h("h3", {}, st.loc ? `가까운 지점${st.locName ? ` · ${st.locName} 기준` : ""}` : "지도에 보이는 지점"),
      h("div", { class: "sub" }, `${list.length}곳 · 지도를 옮긴 뒤 '이 지역 재검색'을 누르면 목록이 바뀌어요${st.loc ? "" : " · 위치나 동네를 정하면 거리순"}`)),
      list.length ? h("ul", { class: "list" }, list.slice(0, 40).map((x) => h("li", { class: "rk" + (x.b.i === st.mapSel ? " sel" : ""), "data-b": x.b.i },
        h("button", { class: "item", type: "button", onclick: () => nav(`branch/${x.b.i}`) },
          h("span", { class: "t row" }, bdot(x.b.i), bname(x.b.i)), h("span", { class: "p num" }, x.p != null ? won(x.p) : km(x.d)),
          h("span", { class: "m" }, x.b.addr, x.p != null && x.d != null ? h("b", {}, km(x.d)) : null)),
        h("button", { class: "infob", type: "button", "aria-label": `${bname(x.b.i)} 지도에서 보기`, onclick: () => focusBranch(x.b.i) }, "📍"))))
        : h("div", { class: "empty" }, "이 지역에 표시할 지점이 없어요. 지도를 넓히거나 동네 이름으로 찾아보세요."));
  }

  // ---------------- branch detail
  views.branch = (arg) => {
    const b = +arg, x = BR[b];
    if (!x) return views.home();
    remember("b", bkey(b));
    const box = h("div", { class: "view" });
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, "‹ 뒤로"));
    const d = dist(b);
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, bdot(b), h("span", { class: "sub" }, brandOf(b)[0])),
      (() => { const sib = BR.filter((y) => y.brand === x.brand && (regionOk(y.i) || y.i === b)).sort((p, q) => p.name.localeCompare(q.name, "ko")); const n = sib.findIndex((y) => y.i === b);
        const go = (d) => { const y = sib[(n + d + sib.length) % sib.length]; if (y) nav(`branch/${y.i}`, true); };
        return h("div", { class: "row", style: "margin-top:2px;flex-wrap:nowrap" }, h("h2", { style: "flex:1;min-width:0" }, `${brandOf(b)[0]} ${x.name}`), favBtn("b", bkey(b), bname(b)),
          sib.length > 1 && n >= 0 ? h("span", { class: "sibs" }, h("button", { type: "button", "aria-label": "같은 브랜드 이전 지점", onclick: () => go(-1) }, "‹"), h("span", { class: "sub" }, `${n + 1}/${sib.length}`),
            h("button", { type: "button", "aria-label": "같은 브랜드 다음 지점", onclick: () => go(1) }, "›")) : null); })(),
      h("dl", { class: "kv", style: "margin-top:10px" }, h("dt", {}, "주소"), h("dd", {}, x.addr || "확인 못 함"),
        d != null ? [h("dt", {}, "거리"), h("dd", {}, `내 위치에서 ${km(d)}`)] : null,
        (() => { const f = fresh(b); return [h("dt", {}, "가격 확인"), h("dd", { class: f.stale ? "up" : "" }, f.d ? `${f.d} (${f.n === 0 ? "오늘" : `${f.n}일 전`})${f.stale ? " · 최신이 아닐 수 있어요" : ""}` : "확인일 없음")]; })()),
      fresh(b).stale ? h("div", { class: "note", style: "margin-top:8px" }, "이번 수집에서 이 지점 가격을 새로 읽지 못해 지난 자료를 보여 주고 있어요. 방문 전에 병원에 꼭 확인하세요.") : null,
      h("div", { class: "row", style: "margin-top:12px" },
        x.lat != null ? h("button", { class: "btn sm soft", type: "button", onclick: () => { nav("map"); setTimeout(() => map && map.setView([x.lat, x.lng], 16), 50); } }, "지도") : null,
        x.addr ? h("a", { class: "btn sm gray", href: `https://map.kakao.com/?q=${encodeURIComponent(x.addr)}`, target: "_blank", rel: "noopener" }, "길찾기") : null,
        h("a", { class: "btn sm gray", href: x.site, target: "_blank", rel: "noopener" }, "병원 홈페이지"),
        h("button", { class: "btn sm soft", type: "button", onclick: () => recordSheet(null, { br: bkey(b) }) }, "방문 기록"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { st.vsA = b; st.vsB = null; nav("versus"); } }, "다른 지점과 비교"))));
    // level tiles + options this branch is the cheapest for
    const bs = (D.bstat || [])[b];
    if (bs) {
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
      const so = { cat: (a, c) => ROWS[a][1] - ROWS[c][1] || ROWS[a][3] - ROWS[c][3], price: (a, c) => ROWS[a][3] - ROWS[c][3], med: (a, c) => vm(a) - vm(c), disc: (a, c) => disc(c) - disc(a) }[st.bsort];
      const shown = rows.filter((i) => (st.bcat < 0 || ROWS[i][1] === st.bcat) && t.every((w) => S[ROWS[i][2]].toLowerCase().includes(w))).sort((a, c) => (ROWS[a][15] ? 1 : 0) - (ROWS[c][15] ? 1 : 0) || so(a, c));
      list.replaceChildren(...shown.slice(0, 400).map((i) => { const r = ROWS[i];
        return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
          h("span", { class: "m" }, D.meta.cats[r[1]], r[4] ? h("s", {}, won(r[4])) : null, r[4] ? h("span", { class: "k kt" }, `${Math.round((r[4] - r[3]) / r[4] * 100)}%↓`) : null, kindBadge(r),
            sessOf(i) > 1 ? h("span", {}, sessOf(i) >= 99 ? "이용권" : `${sessOf(i)}회`) : null,
            (() => { const x = r[15] ? null : rowPos(i); return x ? h("button", { class: `linkbtn ${x.vsMed < -0.005 ? "down" : x.vsMed > 0.005 ? "up" : ""}`, type: "button", title: "계산 기준·조건·원본 보기", onclick: () => priceSheet(i) }, `${x.n}곳 중 ${x.rank}위 · ${pctTxt(x.vsMed)} ⓘ`) : null; })(),
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
      h("div", { class: "chips", style: "margin-top:8px" }, [["cat", "카테고리순"], ["price", "싼 순"], ["med", "중간보다 싼 순"], ["disc", "할인율 큰 순"]].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": st.bsort === v ? "true" : "false", onclick: () => { st.bsort = v; render(); } }, l)))));
    box.append(h("div", { class: "card flush" }, list));
    paint();
    return box;
  };

  // ---------------- 지점 순위: branch price level (geometric mean of price / median over shared options)
  views.rank = () => {
    const box = h("div", { class: "view" });
    box.append(cmpNav("rank"));
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
        h("button", { class: "swap", type: "button", "aria-label": "A와 B 바꾸기", onclick: () => { [st.vsA, st.vsB] = [st.vsB, st.vsA]; render(); } }, "⇅"),
        h("label", { class: "flabel" }, h("span", { class: "row", style: "gap:6px" }, h("span", { class: "key", style: "background:var(--s2)" }), "B 지점"), brSelect(B, (v) => { st.vsB = v; render(); }, "B 지점"))),
      h("div", { class: "row", style: "margin-top:8px" },
        ["A", "B"].map((w) => h("button", { class: "btn sm gray", type: "button", onclick: () => { const cur0 = w === "A" ? st.vsA : st.vsB, other = w === "A" ? st.vsB : st.vsA;
          const sib = BR.filter((y) => y.brand === BR[cur0].brand && regionOk(y.i) && y.i !== other).sort((p, q) => p.name.localeCompare(q.name, "ko"));
          const n = sib.findIndex((y) => y.i === cur0), nx = sib[(n + 1) % sib.length]; if (!nx) return; if (w === "A") st.vsA = nx.i; else st.vsB = nx.i; render(); } }, `${w}: 같은 브랜드 다음 지점 ›`))),
      h("div", { class: "row", style: "margin-top:10px" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }),
        switchEl("차이 있는 것만", st.vsDiff, (v) => { st.vsDiff = v; render(); }))));
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
        ...items.filter((x) => x.a !== x.b).sort((p, q) => Math.abs(q.a - q.b) - Math.abs(p.a - p.b)).slice(0, 5).map((x) => `- ${x.name}: A ${won(x.a)} / B ${won(x.b)}`)].join("\n"), "비교 결과를 복사했어요") }, "비교 결과 복사")));
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
        h("span", { class: "m" }, h("span", { class: "row", style: "gap:4px" }, h("span", { class: "key", style: "background:var(--s1)" }), h("b", { class: x.a < x.b ? "down" : "" }, won(x.a))),
          h("span", { class: "row", style: "gap:4px" }, h("span", { class: "key", style: "background:var(--s2)" }), h("b", { class: x.b < x.a ? "down" : "" }, won(x.b))), h("span", {}, D.meta.cats[x.cat]))))));
      if (!shown.length) list.replaceChildren(h("div", { class: "empty" }, "찾는 옵션이 없어요"));
    };
    q.addEventListener("input", paint);
    box.append(h("div", { class: "card" }, h("div", { class: "search", style: "box-shadow:none;background:var(--fill)" }, q),
      h("div", { class: "chips", style: "margin-top:10px" }, h("button", { class: "chip", type: "button", "aria-pressed": st.vcat < 0 ? "true" : "false", onclick: () => { st.vcat = -1; render(); } }, "전체"),
        cats.map((ci) => h("button", { class: "chip", type: "button", "aria-pressed": st.vcat === ci ? "true" : "false", onclick: () => { st.vcat = ci; render(); } }, D.meta.cats[ci]))),
      h("div", { class: "chips", style: "margin-top:8px" }, [["diff", "차이 큰 순"], ["a", "A가 싼 것"], ["b", "B가 싼 것"], ["name", "이름순"]].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": st.vsort === v ? "true" : "false", onclick: () => { st.vsort = v; render(); } }, l)))));
    box.append(h("div", { class: "card flush" }, list));
    paint();
    return box;
  };

  // ---------------- search over every price
  views.search = (arg, params) => {
    let qs = ""; try { qs = decodeURIComponent(arg || ""); } catch (e) { qs = String(arg || ""); }   // a malformed %-sequence in the link
    // natural language → filters, once per new search (?nl=1 marks it as done; ?nl=0 = take the words literally)
    if (qs && !params.has("nl")) {
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
    const box = h("div", { class: "view" });
    const q = h("input", { type: "search", value: qs, "aria-label": "시술 검색", enterkeyhint: "search", placeholder: "시술 검색 (예: 슈링크 300샷, rejuran)" });
    const run = (v) => { if (v) nav(`search/${encodeURIComponent(v)}`, true); };
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") run(q.value.trim()); });
    box.append(h("div", { class: "search" }, h("span", { html: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' }), withSuggest(q, run)));
    // comparison keys whose label matches (same normalization as prices)
    const { tokens } = Search.parse(qs, searchIndex());
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
      h("p", { class: "tiny" }, "종류 이름을 누르면 부작용·주의사항·근거까지 볼 수 있어요. 설명은 의료진 검수 전 초안이에요.")));
    if (fams.length) box.append(h("div", { class: "card" }, h("h3", {}, `‘${qs}’ 종류 ${fams.length}가지`),
      h("div", { class: "sub" }, "이름이 비슷해도 놓는 곳과 목적이 달라요. 누르면 지점별 가격을 비교해요."),
      h("ul", { class: "list", style: "margin-top:4px" }, fams.slice(0, 12).map((f) => { const e = kbOf(f), top = ranking(f.main, "price")[0];
        return h("li", { class: "rk" }, h("button", { class: "item", type: "button", onclick: () => nav(`compare?k=${KEYS[f.main].id}`) }, h("span", { class: "t" }, f.name),
          h("span", { class: "p num" }, top ? won(top.p) + "~" : "-"), h("span", { class: "m" }, e ? e.purpose : f.desc[0] || `${f.cat} · ${f.n}곳`),
          e && e.areas ? h("span", { class: "m" }, `부위: ${e.areas}`) : null),
          e ? h("button", { class: "infob", type: "button", "aria-label": `${f.name} 설명 보기`, onclick: () => kbSheet(e, f) }, "ⓘ") : null); })),
      h("button", { class: "linkbtn", type: "button", style: "margin-top:8px", onclick: () => nav(`guide?q=${encodeURIComponent(qs)}`) }, fams.length > 12 ? `시술 사전에서 ${fams.length}가지 모두 보기 →` : "시술 사전에서 자세히 보기 →")));
    const keys = KEYS.filter((k) => tokens.length && Search.matches(Search.norm(`${k.label} ${k.cat} ${famOf[k.i] ? famOf[k.i].f.name : ""}`), tokens))
      .sort((a, b) => byKB[b.i].size - byKB[a.i].size).slice(0, 8);
    if (keys.length) box.append(h("div", { class: "card" }, h("h3", {}, "같은 조건 가격 비교 바로가기"),
      h("ul", { class: "list", style: "margin-top:4px" }, keys.map((k) => { const top = ranking(k.i, "price")[0];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k.i; nav("compare"); } }, h("span", { class: "t" }, k.label),
          h("span", { class: "p num" }, top ? won(top.p) + "~" : "-"), h("span", { class: "m" }, k.cat, top ? `최저 ${bname(top.b)}` : ""))); }))));
    const orig = params.get("orig");
    box.append(priceTable(`search/${encodeURIComponent(qs)}`, params, { q: qs, head: [h("h3", {}, qs ? "이름에 검색어가 들어간 모든 가격" : "조건에 맞는 모든 가격"),
      orig ? h("div", { class: "note", style: "margin-top:8px" }, `‘${orig}’를 검색어 ‘${qs || "(없음)"}’와 아래 필터로 나눠 찾았어요. `,
        h("button", { class: "linkbtn", type: "button", onclick: () => nav(`search/${encodeURIComponent(orig)}?nl=0`, true) }, "문장 그대로 찾기")) : null] }));
    if (!params.toString()) setTimeout(() => q.focus(), 0);
    return box;
  };

  // ---------------- cart
  views.cart = () => {
    const box = h("div", { class: "view" });
    const c = cur();
    // saved carts: switch on top, management (rename · share · alert · copy · delete) folded
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, "장바구니"), h("span", { class: "sp" }),
      h("button", { class: "btn sm soft", type: "button", onclick: () => nameSheet("새 장바구니", `장바구니 ${st.carts.length + 1}`, (name) => {
        st.carts.push({ id: newId(), name, items: [] }); st.ci = st.carts.length - 1; saveCarts(); render(); }) }, "+ 새로")),
      h("div", { class: "chips", style: "margin-top:10px" }, st.carts.map((x, i) => h("button", { class: "chip", type: "button", "aria-pressed": i === st.ci ? "true" : "false",
        onclick: () => { st.ci = i; st.open.clear(); saveCarts(); render(); } }, `${x.name} ${x.items.length}`))),
      h("details", { class: "fold small", style: "margin-top:8px" }, h("summary", {}, "장바구니 관리 (이름·공유·알림·복사·삭제)"),
        h("div", { class: "row", style: "margin-top:8px" },
          h("button", { class: "btn sm gray", type: "button", onclick: () => nameSheet("이름 바꾸기", c.name, (name) => { c.name = name; saveCarts(); render(); }) }, "이름 바꾸기"),
          c.items.length ? h("button", { class: "btn sm gray", type: "button", onclick: () => shareCart(c) }, "공유") : null,
          c.items.length ? h("button", { class: "btn sm gray", type: "button", onclick: () => alertSheet({ cart: c.name }) }, "🔔 합계 알림") : null,
          c.items.length ? h("button", { class: "btn sm gray", type: "button", onclick: () => { st.carts.push({ id: newId(), name: `${c.name} 복사본`.slice(0, 30), items: JSON.parse(JSON.stringify(c.items)), budget: c.budget }); st.ci = st.carts.length - 1; saveCarts(); render(); toast("복사했어요"); } }, "복사") : null,
          h("span", { class: "sp" }),
          h("button", { class: "btn sm gray", type: "button", onclick: () => {
            const snap = JSON.parse(JSON.stringify(st.carts)), ci = st.ci, many = st.carts.length > 1;
            if (many) { st.carts.splice(st.ci, 1); st.ci = 0; } else c.items = [];
            saveCarts(); render();
            undoToast(many ? `'${c.name}'을(를) 지웠어요` : "장바구니를 비웠어요", () => { st.carts = snap; st.ci = ci; saveCarts(); render(); });
          } }, st.carts.length > 1 ? "삭제" : "비우기")))));
    if (!c.items.length) {
      box.append(h("div", { class: "card" }, h("div", { class: "empty" }, "받고 싶은 시술을 담으면 한 곳에서 다 받을 때, 여러 곳을 섞을 때, 브랜드·지역별로 어디가 가장 싼지 계산해 드려요.", h("br"),
        "비교 탭의 '+ 담기'나 지점 가격표·검색 결과의 '+ 담기'로 실제 옵션을 그대로 담을 수 있어요."),
        h("button", { class: "btn", type: "button", style: "width:100%", onclick: () => nav("compare") }, "시술 고르러 가기")));
      return box;
    }
    // 1-2) the items: name, spec (inline), quantity, remove
    const items = c.items.filter(itemOk);
    const lost = c.items.length - items.length;
    box.append(h("div", { class: "card" }, h("h3", {}, `담은 시술 ${c.items.length}개`),
      h("ul", { class: "list", style: "margin-top:4px" }, c.items.map((it) => {
        const ok = itemOk(it), fam = it.t === "k" && ok ? famOf[KI[it.k]] : null, e = fam ? kbOf(fam.f) : null;
        const setQ = (v) => { it.q = v; saveCarts(); render(); };
        const nOv = it.ov ? Object.keys(it.ov).length : 0;
        return h("li", {}, h("div", { class: "item" },
          h("span", { class: "t row", style: "gap:4px" }, fam ? fam.f.name : itemLabel(it), e ? h("button", { class: "linkbtn", type: "button", "aria-label": `${fam.f.name} 설명 보기`, onclick: () => kbSheet(e, fam.f) }, "ⓘ") : null),
          qtyEl(() => it.q || 1, setQ),
          h("span", { class: "m" },
            fam && fam.f.vs.length > 1 ? h("select", { class: "mini", "aria-label": "옵션", onchange: (ev) => { it.k = KEYS[+ev.target.value].id; it.ov = {}; saveCarts(); render(); } },
              fam.f.vs.map((v) => h("option", { value: v.k, selected: v.k === KI[it.k] }, v.label))) : fam ? h("span", {}, fam.label) : null,
            it.t === "r" ? h("span", {}, `담은 곳: ${it.br.replace("|", " ")} · ${won(it.p)} · 같은 이름 상품끼리 비교`) : null,
            !ok ? h("span", { style: "color:var(--pricey)" }, "이번 주 가격표에 없어요") : null,
            nOv ? h("button", { class: "linkbtn", type: "button", onclick: () => { it.ov = {}; saveCarts(); render(); } }, `지점별로 바꾼 옵션 ${nOv}곳 · 되돌리기`) : null,
            ok && st.cartAdv ? h("button", { class: "chip mini-chip", type: "button", "aria-pressed": (it.sp ?? st.special) ? "true" : "false", title: "이 시술만 체험가·한정가 포함/제외",
              onclick: () => { it.sp = !(it.sp ?? st.special); saveCarts(); render(); } }, (it.sp ?? st.special) ? "특가 포함" : "특가 빼기") : null,
            h("span", { class: "sp" }),
            h("button", { class: "addbtn", type: "button", style: "padding:2px 9px", "aria-label": `${itemLabel(it)} 빼기`, onclick: () => {
              const pos = c.items.indexOf(it); c.items = c.items.filter((x) => x !== it); saveCarts(); render();
              undoToast(`뺐어요: ${itemLabel(it)}`, () => { c.items.splice(pos, 0, it); saveCarts(); render(); }); } }, "빼기"))));
      })),
      lost ? h("div", { class: "note", style: "margin-top:8px" }, `${lost}개는 이번 주 가격표에서 찾지 못해 계산에서 빠졌어요.`) : null));
    if (!items.length) return box;
    // 3-5) estimated total, the cheapest branch, and the button to the per-clinic comparison
    const plan = cartPlan(items), best = plan.full[0];
    const usesCond = best && best.lines.some((l) => l && l.special);
    box.append(h("div", { class: "card cartsum", "aria-live": "polite" },
      h("span", { class: "hl" }, best ? "한 곳에서 다 받을 때 예상 총액" : "한 곳에서 모두 받는 지점이 없어요"),
      best ? h("span", { class: "hp num" }, won(best.total)) : h("span", { class: "hp num" }, plan.mix.missing ? "일부 가격 미확인" : `섞으면 ${won(plan.mix.total)}`),
      best ? h("span", { class: "hb" }, `최저가 지점: ${bname(best.b)}${best.d != null ? ` · ${km(best.d)}` : ""}`) : null,
      h("span", { class: "sub" }, [`${regionName()} ${plan.full.length}곳에서 모두 가능`, plan.partial.length ? `일부만 가능 ${plan.partial.length}곳` : null,
        plan.savings > 0 ? `여러 곳 섞으면 ${won(plan.mix.total)} (${won(plan.savings)} 아낌)` : null, `${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"}`].filter(Boolean).join(" · ")),
      usesCond ? h("span", { class: "k kx", style: "justify-self:start" }, "첫 방문·체험가 같은 조건부 가격 포함 — 고급 설정에서 뺄 수 있어요") : null,
      c.budget && best ? h("span", { class: `k ${best.total > c.budget ? "kx" : "k1"}`, style: "justify-self:start" }, best.total > c.budget ? `예산보다 ${won(best.total - c.budget)} 많아요` : `예산 ${won(c.budget)} 안이에요`) : null,
      h("button", { class: "btn", type: "button", "aria-expanded": st.cartCmp ? "true" : "false", style: "margin-top:8px", onclick: () => { st.cartCmp = !st.cartCmp; render(); } },
        st.cartCmp ? "병원별 비교 접기 ▲" : `병원별 비교 보기 (${plan.full.length + plan.partial.length}곳) ▼`)));
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
    if (!st.cartCmp) return box;
    const tabs = [["one", "한 곳에서"], ["mix", "여러 곳 섞기"], ["pkg", "병원 패키지"], ["sum", "브랜드·지역"]];
    box.append(h("div", { class: "seg", role: "tablist" }, tabs.map(([v, l]) => h("button", { type: "button", role: "tab", "aria-selected": st.cartTab === v ? "true" : "false", onclick: () => { st.cartTab = v; render(); } }, l))));
    if (st.cartTab === "one") box.append(oneView(items, plan.full, plan.partial));
    else if (st.cartTab === "mix") box.append(mixView(items, plan));
    else if (st.cartTab === "pkg") box.append(pkgView(items, plan));
    else box.append(sumView(plan.full));
    box.append(h("div", { class: "note" }, "• 특가(체험가·한정가)는 첫 1회만, 2회째부터는 그 지점 일반가로 계산해요.", h("br"),
      "• 지점 이름을 누르면 시술별 견적이 펼쳐지고, 옵션을 그 지점의 다른 상품(용량·회차 패키지 등)으로 바꿀 수 있어요. 3회·5회 패키지를 고르면 횟수에 맞춰 묶음 수로 계산해요.", h("br"),
      `• ${vatNote()} 방문 전에 병원에 꼭 확인하세요.`));
    return box;
  };
  // one branch's quote, expandable, with a per-line option picker
  function quoteRow(x, items, n, best) {
    const open = st.open.has(x.b);
    const li = h("li", { class: "qrow" + (open ? " open" : "") });
    const headBtn = h("button", { class: "rank" + (n < 3 && best ? " top" : ""), type: "button", "aria-expanded": open ? "true" : "false",
      onclick: () => { if (st.open.has(x.b)) st.open.delete(x.b); else st.open.add(x.b); render(); } },
      h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))), h("span", { class: "p num" }, won(x.total)),
      h("span", { class: "m" }, x.missing && x.missing.length ? h("span", { style: "color:var(--pricey)" }, `${items.length}개 중 ${x.n}개 가능 · 없음: ${x.missing.map((j) => itemLabel(items[j])).join(", ")}`) : best ? (n ? `1위보다 +${won(x.total - best)}` : "가장 싸요") : null,
        cur().budget && !(x.missing && x.missing.length) ? (x.total > cur().budget ? h("span", { class: "k kx" }, `예산 +${won(x.total - cur().budget)}`) : h("span", { class: "k k1" }, "예산 안")) : null,
        isFav("b", bkey(x.b)) ? h("span", { class: "k k4" }, "★ 즐겨찾기") : null,
        x.d != null ? h("b", {}, km(x.d)) : null, h("span", { class: "chev" }, open ? "접기 ▲" : "견적 보기 ▼")));
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
          return h("option", { value: i, selected: l && l.ov && l.rows[0] === i }, `${S[r[2]]} · ${won(r[3])}${ss > 1 ? (ss >= 99 ? " (이용권)" : ` (${ss}회)`) : ""}${isSpecial(r) ? " ★" : ""}`); }));
      if (!l) {
        body.append(h("div", { class: "qline" }, h("div", { class: "row" }, h("b", {}, itemLabel(it)), h("span", { class: "sp" }), h("span", { style: "color:var(--pricey);font-weight:700" }, "없음")),
          alts.length ? h("div", { class: "row", style: "margin-top:6px" }, h("span", { class: "sub" }, "비슷한 상품으로 대신:"), sel) : h("div", { class: "sub" }, "이 지점 가격표에 비슷한 상품이 없어요")));
        return;
      }
      const r = ROWS[l.rows[0]], ss = sessOf(l.rows[0]);
      const pct = r[4] ? Math.round((r[4] - r[3]) / r[4] * 100) : 0;
      const detail = l.ov ? (ss >= 99 ? "이용권 1개" : ss > 1 ? `${ss}회 묶음 × ${l.units}` : `× ${l.units}`)
        : l.rows.length > 1 ? `첫 회 ${won(r[3])} + ${(it.q || 1) - 1}회 × ${won(ROWS[l.rows[1]][3])}` : (it.q || 1) > 1 ? `${won(r[3])} × ${it.q}` : "";
      body.append(h("div", { class: "qline" },
        h("div", { class: "row" }, h("b", {}, `${itemLabel(it)} ×${it.q || 1}`), h("span", { class: "sp" }), h("b", { class: "num" }, won(l.total))),
        h("div", { class: "m" }, h("span", {}, S[r[2]]), r[4] ? h("s", {}, won(r[4])) : null, pct > 0 ? h("span", { class: "k kt" }, `${pct}%↓`) : null, kindBadge(r),
          l.ov ? h("span", { class: "k k4" }, "직접 고름") : null, l.restacked ? h("span", { class: "k kx" }, "첫 방문가 중복 안 함") : null, l.stackWarn ? h("span", { class: "k kx" }, "첫 방문가 중복 확인") : null,
          detail ? h("span", {}, detail) : null, listedTxt(r) ? h("span", {}, listedTxt(r)) : null, srcLink(l.rows[0])),
        alts.length > 1 || l.ov ? h("div", { style: "margin-top:6px" }, sel) : null));
    });
    const warns = quoteWarnings(x);
    body.append(h("div", { class: "row", style: "margin-top:10px" }, h("b", {}, x.missing && x.missing.length ? "확인된 시술 합계" : "합계"), h("span", { class: "sp" }), h("b", { class: "num", style: "font-size:20px" }, won(x.total))),
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
  function oneView(items, full, part) {
    const res = h("div", { class: "card flush" });
    const budget = cur().budget;
    if (budget) {
      const ok = full.filter((x) => x.total <= budget).length;
      res.append(h("div", { class: ok ? "note" : "note warnnote", style: "margin:10px 12px 0" }, ok ? `예산 ${won(budget)} 안에서 모두 받을 수 있는 곳 ${ok}곳` : `예산 ${won(budget)} 안에서 모두 받을 수 있는 곳이 없어요. 가장 싼 곳은 ${full[0] ? won(full[0].total) : "-"}이에요.`));
      if (st.inBudget) full = full.filter((x) => x.total <= budget);
    }
    if (!full.length) res.append(h("div", { class: "empty" }, `담은 시술을 한 지점에서 모두 하는 곳이 없어요${part.length ? ` (일부만 하는 곳 ${part.length}곳)` : ""}. '여러 곳 섞기'를 보거나 아래에서 일부만 되는 곳을 확인하세요.`));
    else {
      const near = st.loc ? [...full].filter((x) => x.d != null).sort((a, b) => a.d - b.d)[0] : null;
      res.append(h("div", { style: "padding:12px 12px 0" }, h("h3", {}, `모두 받을 수 있는 곳 ${full.length}곳`), h("div", { class: "sub" }, "합계가 싼 순 · 눌러서 시술별 견적과 옵션 바꾸기")));
      res.append(h("div", { class: "hero", style: "margin:10px 12px 0" }, h("span", { class: "hl" }, "가장 싼 곳"), h("span", { class: "hb" }, bname(full[0].b)), h("span", { class: "hp num" }, won(full[0].total))));
      if (near && near.b !== full[0].b) res.append(h("div", { class: "hero alt", style: "margin:8px 12px 0" }, h("span", { class: "hl" }, "가장 가까운 곳"), h("span", { class: "hb" }, `${bname(near.b)} · ${km(near.d)}`), h("span", { class: "hp num" }, won(near.total))));
      res.append(h("ul", { class: "list" }, full.slice(0, 40).map((x, n) => quoteRow(x, items, n, full[0].total))));
      if (full.length > 40) res.append(h("div", { class: "sub", style: "text-align:center;padding:8px" }, `싼 순으로 40곳까지 보여요 (전체 ${full.length}곳)`));
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
    res.append(h("div", { class: "row" }, h("h3", {}, "여러 곳 섞어서 받으면"), h("span", { class: "sp" })),
      h("div", { class: "chips", style: "margin-top:8px" }, [[2, "최대 2곳"], [0, "제한 없음"]].map(([v, l]) =>
        h("button", { class: "chip", type: "button", "aria-pressed": st.maxPlaces === v ? "true" : "false", onclick: () => { st.maxPlaces = v; render(); } }, l))));
    const single = full[0];
    let picks, total, places, note;
    if (st.maxPlaces === 2) {
      if (!pair) {
        res.append(h("div", { class: "empty" }, single ? `두 곳을 섞어도 한 곳(${bname(single.b)} ${won(single.total)})보다 싸지지 않아요.` : "두 곳으로 담은 시술을 모두 받을 수 있는 조합이 없어요."));
        return res;
      }
      picks = items.map((it, j) => ({ b: pair.assign[j], line: lineAt(it, pair.assign[j]) }));
      total = pair.total; places = 2;
    } else {
      picks = mix.picks; total = mix.total; places = mix.places;
    }
    note = single ? (total < single.total ? `한 곳에서 다 받는 최저(${bname(single.b)} ${won(single.total)})보다 ${won(single.total - total)} 싸요. 대신 ${places}곳을 다녀야 해요.`
      : `한 곳(${bname(single.b)})에서 다 받아도 같은 값이에요.`) : "한 곳에서 모두 받을 수 있는 지점은 없어요.";
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
    const box = h("div", { class: "view", style: "animation:none" });
    if (!full.length) { box.append(h("div", { class: "card empty" }, "담은 시술을 한 지점에서 모두 하는 곳이 없어 브랜드·지역별 합계를 낼 수 없어요.")); return box; }
    const group = (keyOf) => { const m = new Map(); for (const x of full) { const k = keyOf(x); if (!m.has(k)) m.set(k, { best: x, n: 0, near: null }); const g = m.get(k); g.n++;
      if (x.d != null && (!g.near || x.d < g.near.d)) g.near = x; } return [...m.entries()].sort((a, b) => a[1].best.total - b[1].best.total); };
    const brands = group((x) => BR[x.b].brand);
    box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, "브랜드별 최저"), h("div", { class: "sub" }, "각 브랜드에서 담은 시술을 모두 받는 가장 싼 지점")),
      h("ul", { class: "list" }, brands.map(([bi, g], n) => h("li", {}, h("button", { class: "rank" + (n === 0 ? " top" : ""), type: "button", onclick: () => { st.cartTab = "one"; st.open.add(g.best.b); render(); } },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, h("span", { class: "bdot", style: `background:${D.meta.brands[bi][1]}` }), h("span", {}, D.meta.brands[bi][0])), h("span", { class: "p num" }, won(g.best.total)),
        h("span", { class: "m" }, h("span", {}, `${BR[g.best.b].name} · 가능 ${g.n}곳`), n ? h("span", {}, `1위보다 +${won(g.best.total - brands[0][1].best.total)}`) : null,
          g.near ? h("b", {}, `가까운 곳 ${BR[g.near.b].name} ${km(g.near.d)} ${won(g.near.total)}`) : null)))))));
    const regs = group((x) => BR[x.b].region || "기타");
    box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, "지역별 최저"), h("div", { class: "sub" }, "시·도마다 담은 시술을 모두 받는 가장 싼 지점")),
      h("ul", { class: "list" }, regs.map(([rg, g]) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.cartTab = "one"; st.open.add(g.best.b); render(); } },
        h("span", { class: "t" }, rg), h("span", { class: "p num" }, won(g.best.total)),
        h("span", { class: "m" }, bdot(g.best.b), h("span", {}, bname(g.best.b)), h("span", {}, `가능 ${g.n}곳`))))))));
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
        : `보낸 때(${c.sent.date}) 한 곳 최저 ${won(c.sent.total)}${c.sent.vat !== st.vat ? "(표시 방식 다름)" : ""} → 지금 ${bname(now.b)} ${won(now.total)}. 그사이 가격이 바뀌었어요.`) : null,
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
  function saveMe() {
    store.set("me", st.me);
    const A = auth();
    if (A && A.user) A.saveProfile(st.me).catch(() => toast("계정에 저장하지 못했어요(이 기기에는 저장됨)"));
  }
  function saveRecs(changed) {
    sortRecs(); store.set("recs", st.recs);
    const A = auth();
    if (A && A.user && changed && changed.length) A.saveRecords(changed).catch(() => toast("계정에 저장하지 못했어요(이 기기에는 저장됨)"));
  }
  // after sign-in: merge the account's copy with this phone's (records by id; profile fields the phone lacks)
  async function syncFromAccount() {
    const A = auth();
    if (!A || !A.user) return;
    try {
      const s = await A.pull();
      if (!s) return;
      if (s.profile) {
        st.me = { nick: st.me.nick || s.profile.nick || "", gender: st.me.gender || s.profile.gender || "", age: st.me.age || s.profile.age_band || "" };
        store.set("me", st.me);
      }
      const have = new Set(st.recs.map((x) => x.id));
      for (const r of s.records) if (!have.has(r.id)) st.recs.push({ id: r.id, date: r.done_on, n: r.procedure, br: `${r.brand}|${r.branch}`, p: r.price || 0, memo: r.memo || "", at: 0 });
      const onServer = new Set(s.records.map((r) => r.id));
      saveRecs(st.recs.filter((x) => !onServer.has(x.id)));
      await A.saveProfile(st.me);
      // carts: server carts this phone doesn't have are added; this phone's carts are pushed
      const remote = await A.pullCarts();
      const ids = new Set(st.carts.map((c) => c.id));
      for (const c of remote) if (!ids.has(c.id)) st.carts.push({ id: c.id, name: c.name, items: c.items });
      st.carts = st.carts.filter((c) => c.items.length || st.carts.length === 1);
      saveCarts();
      render();
    } catch (e) { console.warn(e); toast("계정 정보를 불러오지 못했어요"); }
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
            const A = auth(); if (A && A.user) A.deleteRecord(s.id).catch(() => {});
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
    const add = items.map((it, j) => x.lines[j] ? { id: uid(), date: today(), n: `${itemLabel(it)}${(it.q || 1) > 1 ? ` ×${it.q}` : ""}`, br: bkey(x.b), p: x.lines[j].total, memo: S[ROWS[x.lines[j].rows[0]][2]], at: Date.now() } : null).filter(Boolean);
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
      h("div", { class: "row", style: "flex-wrap:nowrap" }, h("div", { class: "avatar", "aria-hidden": "true" }, (me.nick || "?").slice(0, 1)),
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
        ? h("div", { class: "row", style: "margin-top:12px" }, h("span", { class: "sub" }, `${A.providerName(A.user) === "kakao" ? "카카오" : "구글"} 계정으로 로그인됨 · 기록이 계정에 저장돼요`), h("span", { class: "sp" }),
          h("button", { class: "btn sm gray", type: "button", onclick: async () => { await A.signOut(); render(); } }, "로그아웃"))
        : h("div", { style: "margin-top:12px" }, h("div", { class: "sub", style: "margin-bottom:8px" }, "로그인하면 휴대폰을 바꿔도 기록이 남아요"),
          h("div", { class: "row" }, A.providers.map((pv) => h("button", { class: `btn sm login-${pv}`, type: "button", onclick: () => A.signIn(pv).catch(() => toast("로그인하지 못했어요")) },
            pv === "kakao" ? "카카오로 시작하기" : "구글로 시작하기")))))
        : h("div", { class: "sub", style: "margin-top:12px" }, "기록은 이 휴대폰에만 저장돼요.")));
    box.append(alertsCard());
    // records
    box.append(h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:12px 12px 0" }, h("h3", {}, "최근 받은 시술"), h("span", { class: "sp" }),
      h("button", { class: "btn sm soft", type: "button", onclick: () => recordSheet(null) }, "+ 기록하기")),
      st.recs.length ? h("ul", { class: "list" }, st.recs.slice(0, st.allRecs ? 500 : 8).map((r) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => recordSheet(r) },
        h("span", { class: "t" }, r.n), h("span", { class: "p num" }, r.p ? won(r.p) : "-"),
        h("span", { class: "m" }, h("span", {}, r.date), h("span", {}, brLabel(r.br) || "지점 미입력"), r.memo ? h("span", {}, r.memo) : null)))))
        : h("div", { class: "empty" }, "받은 시술을 기록하면 언제·어디서·얼마에 받았는지 한눈에 볼 수 있어요.", h("br"), "장바구니 견적에서 '받았어요'를 눌러도 기록돼요."),
      st.recs.length > 8 ? h("button", { class: "more-link", type: "button", onclick: () => { st.allRecs = !st.allRecs; render(); } }, st.allRecs ? "접기" : `전체 ${st.recs.length}개 보기`) : null));
    // visited branches
    if (visits.size) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, "방문한 지점")),
      h("ul", { class: "list" }, [...visits.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([br, v]) => { const b = BK.get(br);
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { if (b != null) nav(`branch/${b}`); } },
          h("span", { class: "t row" }, b != null ? bdot(b) : null, brLabel(br) || "지점 미입력"), h("span", { class: "p num" }, `${v.n}회`),
          h("span", { class: "m" }, h("span", {}, `마지막 ${v.last}`), v.sum ? h("span", {}, `합계 ${won(v.sum)}`) : null, b == null ? h("span", {}, "앱 목록에 없는 곳") : null))); }))));
    // more pages
    box.append(h("div", { class: "card flush" }, h("ul", { class: "list" }, [["guide", "📖", "시술 사전", "헷갈리는 시술 종류와 차이를 쉽게"], ["table", "📋", "전체 가격표", "모든 지점·모든 가격을 조건으로 찾기"], ["change", "📉", "가격 변동", "지난주보다 내리거나 오른 가격"], ["rank", "🏆", "지점 순위", "같은 상품 기준 싼 지점"], ["about", "ℹ️", "알아두면 좋은 점", "가격 종류·비교 기준·부가세·출처"], ["ops", "🛠️", "운영 현황", "수집 상태·신선도·검토 큐·출처 정책"]].map(([v, e, l, s]) =>
      h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(v) }, h("span", { class: "t" }, `${e} ${l}`), h("span", { class: "sub" }, "›"), h("span", { class: "m" }, s)))))));
    // ---- 내 설정 (what this phone shows) — separate from the data information below
    const theme = store.get("theme", "auto");
    const radios = (label, opts, curV, set) => h("div", { class: "seg setseg", role: "radiogroup", "aria-label": label }, opts.map(([v, l]) =>
      h("button", { type: "button", role: "radio", "aria-checked": curV === v ? "true" : "false", onclick: () => set(v) }, curV === v ? `✓ ${l}` : l)));
    box.append(h("div", { class: "card settings" }, h("h2", {}, "⚙️ 내 설정"), h("div", { class: "sub" }, "이 휴대폰에서 보이는 방식을 바꿔요. 데이터 자체는 바뀌지 않아요."),
      h("div", { class: "setrow" }, h("div", { class: "flabel" }, h("span", {}, "가격 표시"), h("b", { class: "now" }, st.vat === "incl" ? "지금: 부가세 포함 예상가" : "지금: 병원 표시가")),
        radios("가격 표시", [["incl", "부가세 포함 예상가"], ["listed", "병원 표시가"]], st.vat, (v) => { st.vat = v; store.set("vat", v); applyVat(); render(); toast(v === "incl" ? "부가세 포함 예상가로 보여요" : "병원이 적은 가격 그대로 보여요"); }),
        h("div", { class: "sub" }, st.vat === "incl" ? "병원이 '부가세 별도'라고 적은 가격에 10%를 더해 보여줘요. 4개 브랜드 모두 사이트에 '부가세 10% 별도'라고 적혀 있어요(2026-10-13 확인)." : "병원 사이트에 적힌 숫자 그대로예요. 실제 결제는 부가세 10%가 더해질 수 있어요.")),
      h("div", { class: "setrow" }, h("div", { class: "flabel" }, h("span", {}, "화면 테마"), h("b", { class: "now" }, `지금: ${{ auto: "기기 설정 따름", light: "밝게", dark: "어둡게" }[theme]}`)),
        radios("화면 테마", [["auto", "기기 설정"], ["light", "밝게"], ["dark", "어둡게"]], theme, (t) => { store.set("theme", t); applyTheme(); render(); })),
      h("div", { class: "setrow" }, h("div", { class: "flabel" }, h("span", {}, "지역"), h("b", { class: "now" }, `지금: ${regionName()} ${regionCount()}곳`)),
        regionSelect(), h("div", { class: "sub" }, "고르면 비교·장바구니·검색·순위가 이 지역 지점만 보여줘요(데이터는 전국을 모두 모아요).")),
      h("div", { class: "row", style: "margin-top:14px" }, h("button", { class: "btn sm gray", type: "button", onclick: () => window.lockApp && window.lockApp() }, "지금 잠그기"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { store.set("brands", null); store.set("special", true); location.reload(); } }, "설정 초기화"))));
    // ---- 데이터 안내 (information, not settings)
    const counts = D.meta.brands.map((_, i) => [BR.filter((b) => b.brand === i).length, D.rows.filter((r) => BR[r[0]].brand === i).length]);
    box.append(h("div", { class: "card info" }, h("h2", {}, "ℹ️ 데이터 안내"),
      h("dl", { class: "kv", style: "margin-top:10px" }, h("dt", {}, "기준일"), h("dd", {}, `${D.meta.updated} (매주 월요일 자동 갱신)`),
        h("dt", {}, "지점"), h("dd", {}, branchCountText()), h("dt", {}, "가격 수"), h("dd", {}, `${D.meta.rows.toLocaleString()}개 (전국)`)),
      h("ul", { class: "list", style: "margin-top:8px" }, D.meta.brands.map((b, i) => !counts[i][0] ? null : h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "dot bdot", style: `background:${b[1]}` }), b[0]),
        h("span", { class: "sub" }, `${counts[i][0]}곳 · ${counts[i][1].toLocaleString()}개`), h("span", { class: "m" }, b[2]))))),
      h("div", { class: "note", style: "margin-top:10px" }, "• 체험가·한정가는 보통 1인 1회예요. 최저가는 '조건 없는 가격'을 먼저 보여주고, 조건부 가격은 따로 표시해요.", h("br"),
        "• '평일 낮', '일요일' 같은 표시는 그 시간에만 되는 가격이에요.", h("br"), `• ${vatNote()}`, h("br"),
        "• 종료일이 지난 이벤트, 지난주보다 90% 넘게 내리거나 10배 넘게 오른 가격(확인 중)은 비교에서 빠져요. 가격마다 ⓘ나 '출처'로 근거와 병원 페이지를 볼 수 있어요.", h("br"),
        "• 병원 사이트 표기 오류(정가가 판매가보다 낮거나 10배 넘는 값)는 정가를 지웠고, 안내 문구·서류 발급비는 뺐어요."),
      h("div", { class: "sub", style: "margin-top:10px" }, "지도 © OpenStreetMap 기여자. 가격 출처는 각 병원 홈페이지예요.")));
    const shown = BR.filter((b) => regionOk(b.i));
    box.append(h("details", { class: "card flush fold" }, h("summary", {}, `지점 전체 목록 · ${regionName()} ${shown.length}곳`),
      h("ul", { class: "list" }, shown.sort((a, b) => a.brand - b.brand || a.name.localeCompare(b.name, "ko")).map((b) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b.i}`) },
        h("span", { class: "t row" }, bdot(b.i), bname(b.i)), h("span", { class: "sub" }, dist(b.i) != null ? km(dist(b.i)) : b.region), h("span", { class: "m" }, b.addr)))))));
    if (A && A.user) box.append(h("div", { class: "card" }, h("h3", {}, "계정"),
      h("div", { class: "sub", style: "margin-top:6px" }, "탈퇴하면 계정에 저장된 프로필과 기록이 모두 지워져요. 이 휴대폰의 기록은 남아요."),
      h("button", { class: "btn sm gray", type: "button", style: "margin-top:10px", onclick: async () => {
        if (!confirm("정말 탈퇴할까요? 계정의 프로필·기록이 모두 지워져요.")) return;
        try { await A.deleteAccount(); toast("탈퇴했어요"); render(); } catch (e) { toast("탈퇴하지 못했어요"); } } }, "회원 탈퇴")));
    return box;
  };

  function applyTheme() {
    const t = store.get("theme", "auto");
    if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
    // the status bar follows a theme picked here too (the two meta tags otherwise follow the device setting)
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (!m.dataset.c) m.dataset.c = m.content;
      m.content = t === "auto" ? m.dataset.c : t === "dark" ? "#161013" : "#fbf2f4";
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
    if (view === "cart" || view === "import" || !items.length) { el.hidden = true; return; }
    const plan = cartPlan(items), best = plan.full[0];
    el.textContent = `🛒 ${items.length}개 · ${best ? `한 곳 ${won(best.total)}부터` : plan.mix.missing ? "일부 가격 미확인" : `섞으면 ${won(plan.mix.total)}`}`;
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
    const view = views[name] ? name : name === "more" ? "me" : "home";
    const main = $("#main"), same = view === current && path === lastPath, mark = focusMark(main, document.activeElement);
    current = view; lastPath = path;
    const tab = { branch: null, search: "home", import: "cart", more: "me", rank: "compare", versus: "compare", change: "home", table: "compare", about: "me", ops: "me", guide: "compare" }[view] ?? view;
    document.querySelectorAll("#tabs button").forEach((b) => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    main.replaceChildren(views[view](rest.join("/"), params));
    main.removeAttribute("aria-busy");
    // same page redrawn (filter, quantity …): focus goes back to that control; new page opened from the content: focus
    // the page itself so the next Tab starts in the new content instead of the header
    if (mark) { if (same) focusBack(main, mark); else main.focus({ preventScroll: true }); }
    paintFloatCart(view);
  }
  window.addEventListener("popstate", render);
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => nav(b.dataset.tab)));
  $("#locbtn").addEventListener("click", () => { if (D) locSheet(); });

  applyTheme();
  if (st.when && (!st.when.date || st.when.date < new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))) { st.when = null; store.set("when", null); }
  st.region = store.get("region", "수도권");
  paintRegion();
  $("#regbtn").addEventListener("click", () => { if (D) regionSheet(); });
  $("#fcart").addEventListener("click", () => nav("cart"));   // no inline handlers: the CSP allows scripts from files only
  paintCartN();
  if (window.Auth && window.Auth.enabled) window.Auth.onChange((u) => { if (u && D) syncFromAccount(); else if (D) render(); });
  loadData().then(() => { if (store.get("locPlace", "")) usePlace(store.get("locPlace", "")); render(); checkAlerts(); if (window.Auth && window.Auth.user) syncFromAccount(); }).catch((e) => { $("#main").replaceChildren(h("div", { class: "card empty" }, "데이터를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.")); console.error(e); });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
