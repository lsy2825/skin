// 피부과 가격비교 — app logic. Data: data.json (built by build2/appdata.py). No framework.
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
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  };
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((c) => c != null && c !== false));
  const won = (n) => Math.round(n).toLocaleString("ko-KR") + "원";
  const km = (d) => d == null ? "" : d < 1 ? Math.round(d * 1000) + "m" : (d < 10 ? d.toFixed(1) : Math.round(d)) + "km";
  const store = {
    get(k, d) { try { const v = localStorage.getItem("pc:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("pc:" + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  let toastT;
  const toast = (t) => { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 1800); };

  // ---------------- state
  const st = {
    special: store.get("special", true),          // include 체험가 · 한정가 · 시간 조건 prices
    vat: store.get("vat", "incl"),                // "incl" VAT 포함 예상가 · "listed" 병원 표시가
    brands: store.get("brands", null),             // null = all
    carts: loadCarts(),                            // [{name, items: [{t:"k", k: key id, q, ov} | {t:"r", n: row name, br, p, q, ov}]}]
    ci: 0,                                         // current cart
    cartTab: "one", open: new Set(), showPart: false, maxKm: 0, maxPlaces: 0, noStack: store.get("noStack", true), when: store.get("when", null),
    hcat: null, hmove: "down", cbr: null, tf: null, rcat: -1, vsA: null, vsB: null, vcat: -1, vsort: "diff", bsort: "cat", ccat: -1, csort: "pct", cdir: "all",
    me: store.get("me", { nick: "", gender: "", age: "" }), recs: store.get("recs", []), allRecs: false, tcat: null,
    loc: null, locName: "",
    sort: "price", cat: 0, key: null, mapKey: null, bcat: -1, region: "",
  };
  let D, S, BR, KEYS, ROWS, KI, byKB, byB, nameIdx, FAM, famOf, BK, SI, byName, GR, byG, gcache;
  // carts: old single cart [{k, q}] becomes the first saved cart
  function loadCarts() {
    const c = store.get("carts", null);
    if (Array.isArray(c) && c.length) return c;
    return [{ name: "내 장바구니", items: store.get("cart", []).map((x) => ({ t: "k", k: x.k, q: x.q || 1 })) }];
  }

  // ---------------- data
  async function loadData() {
    const r = await fetch("data.json", { cache: "no-cache" });
    D = await r.json();
    S = D.s;
    BR = D.branches.map((b, i) => ({ i, brand: b[0], name: S[b[1]], addr: S[b[2]], lat: b[3], lng: b[4], region: S[b[5]], site: S[b[6]] }));
    KEYS = D.keys.map(([id, cat, label], i) => ({ i, id, cat, label }));
    KI = Object.fromEntries(KEYS.map((k) => [k.id, k.i]));
    ROWS = D.rows;
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
    FAM = (D.meta.fam || []).map(([name, rx, vs]) => ({ name, rx: new RegExp(rx), vs: vs.map(([id, label]) => ({ k: KI[id], label })).filter((v) => v.k != null) }));
    famOf = KEYS.map(() => null);
    FAM.forEach((f) => f.vs.forEach((v) => { famOf[v.k] = { f, label: v.label }; }));
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
    $("#upd").textContent = `${D.meta.updated} 기준 · ${BR.length}개 지점`;
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
  function paintRegion() { const el = $("#regbtn span"); if (el) el.textContent = regionName(); }
  function regionSheet() { sheet("지역", (close) => h("div", {}, h("div", { class: "sub", style: "margin:4px 0 10px" }, "비교·장바구니·검색·순위에 이 지역 지점만 보여요"), regionSelect(close))); }

  // ---------------- location
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
      toast(e.code === 1 ? "위치 권한을 허용해 주세요" : "위치를 찾지 못했어요");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  // ---------------- cart
  const bkey = (b) => `${D.meta.brands[BR[b].brand][0]}|${BR[b].name}`;
  const cur = () => st.carts[st.ci];
  const saveCarts = () => { store.set("carts", st.carts); store.set("ci", st.ci); paintCartN(); };
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
  function sheet(title, body) {
    const bg = h("div", { class: "sheet-bg", onclick: (e) => { if (e.target === bg) close(); } });
    const close = () => { bg.remove(); document.removeEventListener("keydown", esc); };
    const esc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    bg.append(h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "row" }, h("h3", {}, title), h("span", { class: "sp" }), h("button", { class: "btn sm gray", type: "button", onclick: () => close() }, "닫기")), body(close)));
    document.body.append(bg);
    return close;
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
            have ? h("button", { class: "btn gray", type: "button", onclick: () => { const c = st.carts[s.ci]; c.items = c.items.filter((x) => x !== have); saveCarts(); toast("장바구니에서 뺐어요"); close(); render(); } }, "빼기") : null,
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
        h("button", { class: "btn", type: "button", style: "width:100%;margin-top:14px", onclick: () => {
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
  // conditions to check before visiting, for one branch's quote
  function quoteWarnings(x) {
    const w = [];
    const ls = x.lines.filter(Boolean);
    const sp = ls.filter((l) => isSpecial(ROWS[l.rows[0]])).length;
    if (sp) w.push(`체험가·한정가·시간 조건 가격 ${sp}개 — 1인 1회·첫 방문·시간대 조건을 병원에 확인하세요`);
    if (ls.some((l) => l.restacked)) w.push("첫 방문가가 여러 개라 하나만 첫 방문가로, 나머지는 다음 가격으로 계산했어요");
    if (ls.some((l) => l.stackWarn)) w.push("첫 방문가만 있는 시술이 여러 개예요 — 함께 적용되는지 병원에 확인하세요");
    if (ls.some((l) => ROWS[l.rows[0]][17] === 2)) w.push("방문 시간에 되는 가격인지 확인이 필요해요(시간대 미표기)");
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
      const text = () => [`${from.value.trim() ? `${from.value.trim()}님이 보낸 ` : ""}피부과 장바구니 '${c.name}'`,
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
              if (navigator.share) await navigator.share({ title: "피부과 장바구니", text: text(), url: link() });
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
      h("div", { class: "sub" }, "일반가 중간값(전 지점, 병원 표시가 기준) · 정가 대비는 각 병원이 적은 정가에서 할인된 정도"),
      h("div", { class: "chips", style: "margin-top:10px" }, cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": c === st.tcat ? "true" : "false", onclick: () => { st.tcat = c; render(); } }, c))),
      h("div", { class: "row", style: "margin-top:10px" }, h("b", {}, `${st.tcat} 평균`), avg == null ? h("span", { class: "sub" }, tr.dates.length < 2 ? "다음 주 월요일부터 지난주 대비 변동이 보여요" : "변동 없음")
        : chg({ pct: avg }))),
      h("ul", { class: "list" }, keys.map((k) => { const v = (tr.k[k.id] || []).map((x) => x && x[0]); const now = v[v.length - 1]; const disc = tr.disc[k.id];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k.i; nav("compare"); } },
          h("span", { class: "t" }, k.label), h("span", { class: "p num" }, now != null ? won(now) : "-"),
          h("span", { class: "m" }, chg(keyChange(k.id)), disc != null ? h("span", {}, `정가 대비 −${disc}%`) : null, h("span", { class: "sp" }), sparkline(v)))); })));
    return card;
  }
  function keyTrend(k) {
    const tr = TR(), v = tr.k[k.id];
    if (!v || !tr.dates.length) return null;
    const card = h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "가격 동향"), h("span", { class: "sp" }), chg(keyChange(k.id))),
      h("div", { class: "sub" }, `${k.label} · 일반가, 전 브랜드 지점, 병원 표시가 기준`),
      lineChart(tr.dates, [{ name: "중간값", color: "var(--s1)", values: v.map((x) => x && x[0]) }, { name: "최저가", color: "var(--s2)", values: v.map((x) => x && x[1]) }], `${k.label} 주별 가격`));
    if (tr.disc[k.id] != null) card.append(h("div", { class: "note", style: "margin-top:8px" }, `이번 주 병원들이 적은 정가보다 중간값 ${tr.disc[k.id]}% 싸게 팔고 있어요.`));
    if (tr.dates.length < 2) card.append(h("div", { class: "sub", style: "margin-top:6px" }, "매주 월요일 갱신 때마다 점이 하나씩 늘어 선이 돼요."));
    return card;
  }

  // ---------------- views
  const views = {};
  let current = "home";

  // ---------------- price changes since the previous weekly snapshot (listed prices): key + auto-group moves
  const EMO = { "톡신": "💉", "윤곽·필러": "💧", "리프팅": "✨", "부스터": "🌿", "피부": "🌟", "제모·바디": "🪒" };
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
    // shortcuts
    const ch = changeItems(), dn = ch.filter((x) => x.t === "down").length, up = ch.filter((x) => x.t === "up").length;
    const top1 = branchRanks()[0];
    box.append(h("div", { class: "quick" },
      h("button", { class: "qbtn", type: "button", onclick: () => nav("change") }, h("span", { class: "qi" }, "📉"), h("b", {}, "가격 변동"), h("small", {}, D.meta.prev ? `↓${dn} ↑${up}` : "다음 주부터")),
      h("button", { class: "qbtn", type: "button", onclick: () => nav("rank") }, h("span", { class: "qi" }, "🏆"), h("b", {}, "지점 순위"), h("small", {}, top1 ? BR[top1.b].name : "-")),
      h("button", { class: "qbtn", type: "button", onclick: () => nav("versus") }, h("span", { class: "qi" }, "⚖️"), h("b", {}, "지점 비교"), h("small", {}, "A vs B")),
      h("button", { class: "qbtn", type: "button", onclick: () => nav("cart") }, h("span", { class: "qi" }, "🛒"), h("b", {}, "장바구니"), h("small", {}, `${cur().items.length}개`))));
    box.append(recentChips() || "");
    // popular / category cards: cheapest place, how far below the middle, + 담기
    const cats = [...new Set(KEYS.map((k) => k.cat))];
    if (st.hcat && !cats.includes(st.hcat)) st.hcat = null;
    const popular = [...KEYS].sort((a, b) => byKB[b.i].size - byKB[a.i].size).slice(0, 8);
    const keys = st.hcat ? KEYS.filter((k) => k.cat === st.hcat) : popular;
    const sec = h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, st.loc ? "내 주변, 여기가 제일 싸요" : "인기 시술, 여기가 제일 싸요"), h("span", { class: "sp" }),
      h("span", { class: "sub" }, st.loc ? "10km 안" : regionName())),
      h("div", { class: "chips", style: "margin-top:10px" }, h("button", { class: "chip", type: "button", "aria-pressed": !st.hcat ? "true" : "false", onclick: () => { st.hcat = null; render(); } }, "👑 인기"),
        cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": st.hcat === c ? "true" : "false", onclick: () => { st.hcat = c; render(); } }, `${EMO[c] || ""} ${c}`))));
    const grid = h("div", { class: "grid", style: "margin-top:12px" });
    for (const k of keys) {
      let rk = ranking(k.i, "price");
      if (st.loc) rk = rk.filter((x) => x.d != null && x.d <= 10);
      if (!rk.length) continue;
      const top = rk[0], r = ROWS[top.i], ps = rk.map((x) => x.p), med = ps[ps.length >> 1];
      const below = med ? Math.round((1 - top.p / med) * 100) : 0;
      grid.append(h("div", { class: "pwrap" }, h("button", { class: "pc", type: "button", onclick: () => { st.key = k.i; nav("compare"); } },
        h("span", { class: "pico", "aria-hidden": "true" }, EMO[k.cat] || "•"), h("span", { class: "l" }, k.label), h("span", { class: "p num" }, won(top.p)),
        h("span", { class: below > 0 ? "save" : "save flat" }, below > 0 ? `중간보다 ${below}% 싸요` : `${rk.length}곳 비교`),
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
  // autocomplete dropdown under a search input; pick(text) runs the search
  function withSuggest(input, pick) {
    const list = h("ul", { class: "suggest", role: "listbox", hidden: true });
    let n = -1;
    const show = () => {
      const v = input.value.trim();
      const items = v ? Search.suggest(v, searchIndex(), suggestTerms()) : [];
      n = -1;
      list.replaceChildren(...items.map((x) => h("li", { role: "option" }, h("button", { type: "button", onmousedown: (e) => e.preventDefault(), onclick: () => { input.value = x; list.hidden = true; pick(x); } }, x))));
      list.hidden = !items.length;
    };
    input.setAttribute("autocomplete", "off");
    input.addEventListener("input", show);
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
  function priceTable(route, params, opt = {}) {
    const P = (k, d = "") => params.get(k) ?? d;
    const f = { q: opt.q ?? P("q"), cat: +P("cat", -1), brand: +P("brand", -1), b: +P("b", -1), kind: +P("kind", -1), sort: P("sort", "price"),
      min: +P("min", 0) || 0, max: +P("max", 0) || 0, sess: P("sess", ""), cond: P("cond", ""), unit: P("unit", ""), exact: P("exact") === "1", n: +P("n", 100) };
    const go = (patch) => {
      const np = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) { if (v === "" || v == null || v === -1 || v === false || (k === "n" && v === 100)) np.delete(k); else np.set(k, v === true ? "1" : v); }
      if (!("n" in patch)) np.delete("n");
      const s = np.toString();
      history.replaceState(null, "", `#${route}${s ? "?" + s : ""}`);    // filter change: same page, keep the scroll position
      render();
    };
    const box = h("div", { class: "view", style: "animation:none" });
    const sel = (label, val, opts, key, extra = {}) => h("label", { class: "flabel" }, label, h("select", { class: "pick", onchange: (e) => go({ [key]: e.target.value, ...extra }) },
      opts.map(([v, l]) => h("option", { value: v, selected: String(v) === String(val) }, l))));
    const brs = BR.filter((x) => (f.brand < 0 || x.brand === f.brand) && regionOk(x.i)).sort((a, b) => a.brand - b.brand || a.name.localeCompare(b.name, "ko"));
    const minIn = h("input", { class: "pick", type: "number", inputmode: "numeric", min: "0", step: "1000", value: f.min || "", placeholder: "최소", "aria-label": "최소 가격" });
    const maxIn = h("input", { class: "pick", type: "number", inputmode: "numeric", min: "0", step: "1000", value: f.max || "", placeholder: "최대", "aria-label": "최대 가격" });
    const applyRange = () => setTimeout(() => go({ min: Math.max(0, Math.round(+minIn.value || 0)) || "", max: Math.max(0, Math.round(+maxIn.value || 0)) || "" }), 0);
    minIn.addEventListener("change", applyRange); maxIn.addEventListener("change", applyRange);
    box.append(h("div", { class: "card" }, opt.head || null,
      h("div", { class: "fgrid" },
        sel("카테고리", f.cat, [[-1, "전체"], ...D.meta.cats.map((c, i) => [i, c])], "cat"),
        sel("브랜드", f.brand, [[-1, "전체"], ...D.meta.brands.map((b, i) => BR.some((x) => x.brand === i) ? [i, b[0]] : null).filter(Boolean)], "brand", { b: "" }),
        sel("지점", f.b, [[-1, "전체"], ...brs.map((x) => [x.i, bname(x.i)])], "b"),
        sel("가격 종류", f.kind, [[-1, "전체"], ...D.meta.kinds.map((k, i) => [i, k])], "kind"),
        sel("회차", f.sess, [["", "전체"], ["1", "1회 가격"], ["pkg", "2회 이상 패키지"], ["pass", "이용권·무제한"]], "sess"),
        sel("조건", f.cond, [["", "전체"], ["plain", "조건 없는 가격만"], ["special", "체험가·한정가·시간 조건만"]], "cond"),
        sel("정렬", f.sort, SORTS, "sort", { unit: "" }),
        h("div", { class: "flabel wide" }, "가격 범위(원)", h("div", { class: "range" }, minIn, h("span", {}, "~"), maxIn))),
      h("div", { class: "row" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }), whenChip())));
    // filter
    const idx = f.q ? searchIndex() : null;
    const parsed = f.q ? (f.exact ? { tokens: f.q.split(/\s+/).map(Search.norm).filter(Boolean), fixes: [] } : Search.parse(f.q, idx)) : { tokens: [], fixes: [] };
    let hits = [];
    for (let i = 0; i < ROWS.length; i++) {
      const r = ROWS[i];
      if (!live(i) || !brandOn(r[0]) || !regionOk(r[0]) || (!st.special && isSpecial(r))) continue;
      if ((f.cat >= 0 && r[1] !== f.cat) || (f.brand >= 0 && BR[r[0]].brand !== f.brand) || (f.b >= 0 && r[0] !== f.b) || (f.kind >= 0 && r[5] !== f.kind)) continue;
      if ((f.min && r[3] < f.min) || (f.max && r[3] > f.max)) continue;
      const ss = sessOf(i);
      if ((f.sess === "1" && ss !== 1) || (f.sess === "pkg" && (ss < 2 || ss >= 99)) || (f.sess === "pass" && ss < 99)) continue;
      if ((f.cond === "plain" && isSpecial(r)) || (f.cond === "special" && !isSpecial(r))) continue;
      if (parsed.tokens.length && !Search.matches(normBySid.get(r[2]), parsed.tokens)) continue;
      hits.push(i);
    }
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
      if (!st.loc) notes.push("거리순은 내 위치가 필요해요. 화면 위 '내 위치'를 눌러 주세요.");
      hits.sort((a, b) => (dist(ROWS[a][0]) ?? 1e9) - (dist(ROWS[b][0]) ?? 1e9) || ROWS[a][3] - ROWS[b][3]);
    } else if (f.sort === "recent") hits.sort((a, b) => ver(b).localeCompare(ver(a)) || ROWS[a][3] - ROWS[b][3]);
    else if (f.sort === "name") hits.sort((a, b) => S[ROWS[a][2]].localeCompare(S[ROWS[b][2]], "ko") || ROWS[a][3] - ROWS[b][3]);
    else if (f.sort === "pos") { const pos = new Map(); const vm = (i) => { if (!pos.has(i)) { const x = rowPos(i); pos.set(i, x ? x.vsMed : 9); } return pos.get(i); }; hits.sort((a, b) => vm(a) - vm(b) || ROWS[a][3] - ROWS[b][3]); }
    else hits.sort((a, b) => ROWS[a][3] - ROWS[b][3] || tie(a, b));
    if (parsed.fixes.length) box.append(h("div", { class: "note" }, parsed.fixes.map(([a, b]) => `‘${a}’ 대신 ‘${b}’로 찾았어요. `), h("button", { class: "linkbtn", type: "button", onclick: () => go({ exact: true }) }, "입력한 그대로 찾기")));
    if (unitInfo && unitInfo.units.length > 1) box.append(h("div", { class: "chips" }, unitInfo.units.map(([u, n]) => h("button", { class: "chip", type: "button", "aria-pressed": u === unitInfo.unit ? "true" : "false", onclick: () => go({ unit: u, sort: "unit" }) }, `${u === "샷" ? "100샷" : u === "U" ? "10U" : "1" + u}당 · ${n}개`))));
    for (const n of notes) box.append(h("div", { class: "note" }, n));
    const minP = hits.length ? Math.min(...hits.map((i) => ROWS[i][3])) : 0;
    box.append(h("div", { class: "searchstat" }, hits.length ? `가격 ${hits.length.toLocaleString()}개 · 가장 싼 ${won(minP)} (${new Set(hits.filter((i) => ROWS[i][3] === minP).map((i) => ROWS[i][0])).size}개 지점)` : "조건에 맞는 가격이 없어요"));
    if (!hits.length) { box.append(h("div", { class: "card empty" }, f.q ? "검색 결과가 없어요. 짧게 써 보거나(예: 슈링크) 필터를 풀어 보세요." : "필터를 풀어 보세요.")); return box; }
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
      h("div", { class: "sub", style: "margin-top:12px" }, `기준일 ${D.meta.updated} · 가격 ${D.meta.rows.toLocaleString()}개 · 지점 ${BR.length}곳. 지도 © OpenStreetMap 기여자.`)));
    return box;
  };

  // 비교 tab sub-navigation: 시술별 / 지점 순위 / 지점 비교 / 전체 가격표
  const cmpNav = (cur) => h("div", { class: "seg seg4", role: "tablist" }, [["compare", "시술별"], ["rank", "지점 순위"], ["versus", "지점 비교"], ["table", "전체 가격표"]].map(([v, l]) =>
    h("button", { type: "button", role: "tab", "aria-selected": cur === v ? "true" : "false", onclick: () => nav(v) }, l)));
  views.compare = (arg, params) => {
    const box = h("div", { class: "view" });
    if (params && params.get("k") && KI[params.get("k")] != null) st.key = KI[params.get("k")];
    if (st.key == null) st.key = 0;
    if (KEYS[st.key] && (!params || params.get("k") !== KEYS[st.key].id)) history.replaceState(null, "", `#compare?k=${KEYS[st.key].id}`);
    if (st.key != null && KEYS[st.key]) remember("k", KEYS[st.key].id);
    box.append(cmpNav("compare"));
    if (st.key == null) st.key = 0;
    const k = KEYS[st.key];
    const cats = [...new Set(KEYS.map((x) => x.cat))];
    box.append(h("div", { class: "chips" }, cats.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": c === k.cat ? "true" : "false",
      onclick: () => { st.key = KEYS.find((x) => x.cat === c).i; render(); } }, c))));
    const sel = h("select", { class: "pick", "aria-label": "시술 고르기", onchange: (e) => { st.key = +e.target.value; render(); } },
      KEYS.filter((x) => x.cat === k.cat).map((x) => h("option", { value: x.i, selected: x.i === k.i }, x.label)));
    const rk = ranking(k.i);
    const card = h("div", { class: "card" });
    card.append(h("div", { class: "keyhead" }, sel));
    const fam = famOf[k.i];
    if (fam && fam.f.vs.length > 1) card.append(h("div", { class: "opts", style: "margin-top:10px" }, fam.f.vs.map((v) => { const tp = ranking(v.k, "price")[0];
      return h("button", { class: "opt", type: "button", "aria-pressed": v.k === k.i ? "true" : "false", onclick: () => { st.key = v.k; render(); } },
        h("b", {}, `${fam.f.name} ${v.label}`), h("span", { class: "num" }, tp ? `최저 ${won(tp.p)}` : "가격 없음")); })));
    const controls = h("div", { class: "row", style: "margin-top:12px" },
      h("button", { class: "chip", type: "button", "aria-pressed": st.sort === "price" ? "true" : "false", onclick: () => { st.sort = "price"; render(); } }, "가격순"),
      h("button", { class: "chip", type: "button", "aria-pressed": st.sort === "near" ? "true" : "false", onclick: () => { if (!st.loc) locate("keep"); st.sort = "near"; render(); } }, "가까운순"),
      h("span", { class: "sp" }),
      switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }));
    card.append(controls, h("div", { class: "row", style: "margin-top:8px" }, whenChip()), brandChips());
    if (rk.length) {
      const top = st.sort === "price" ? rk[0] : [...rk].sort((x, y) => x.p - y.p)[0];
      const prices = rk.map((x) => x.p).sort((a, b) => a - b);
      card.append(h("div", { class: "hero", style: "margin-top:14px" }, h("span", { class: "hl" }, `가장 싼 곳 · ${rk.length}개 지점 중`),
        h("span", { class: "hb" }, bname(top.b)), h("span", { class: "hp num" }, won(top.p)),
        h("span", { class: "hl", style: "color:var(--muted);font-weight:600" }, `중간값 ${won(prices[prices.length >> 1])} · 가장 비싼 곳 ${won(prices[prices.length - 1])}`),
        h("span", { class: "hl row", style: "color:var(--muted);font-weight:600;gap:8px" }, h("span", {}, S[ROWS[top.i][2]]), kindBadge(ROWS[top.i]),
          listedTxt(ROWS[top.i]) ? h("span", {}, listedTxt(ROWS[top.i])) : null, h("span", {}, `${fresh(top.b).d} 확인`), srcLink(top.i, "출처 보기"))));
      card.append(h("div", { class: "row", style: "margin-top:12px" }, addBtn(k.i),
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
    box.append(keyTrend(k) || "");
    const list = h("ul", { class: "list" });
    rk.slice(0, 300).forEach((x, n) => {
      const r = ROWS[x.i];
      list.append(h("li", {}, h("button", { class: "rank" + (n < 3 && st.sort === "price" ? " top" : ""), type: "button", onclick: () => nav(`branch/${x.b}`) },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))),
        h("span", { class: "p num" }, won(x.p)),
        h("span", { class: "m" }, S[r[2]], r[4] ? h("s", {}, won(r[4])) : null, kindBadge(r), x.d != null ? h("b", {}, km(x.d)) : null))));
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
  views.map = () => {
    const box = h("div", { class: "view" });
    const keySel = h("select", { class: "pick", "aria-label": "지도에 표시할 시술", onchange: (e) => { st.mapKey = e.target.value === "" ? null : +e.target.value; drawMap(); paintNear(); } },
      h("option", { value: "" }, "지점 위치만 보기"), KEYS.map((x) => h("option", { value: x.i, selected: x.i === st.mapKey }, `${x.cat} · ${x.label}`)));
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, "지도"), h("span", { class: "sp" }),
      h("button", { class: "btn sm soft", type: "button", onclick: () => locate(() => { if (map && st.loc) map.setView([st.loc.lat, st.loc.lng], 13); }) }, "내 위치로")),
      h("div", { style: "margin-top:10px" }, keySel), brandChips()));
    box.append(h("div", { id: "map", role: "application", "aria-label": "지점 지도" }));
    box.append(h("div", { class: "card flush", id: "near" }));
    setTimeout(() => { initMap(); drawMap(); paintNear(); }, 0);
    return box;
  };
  function initMap() {
    if (typeof L === "undefined") { $("#map").replaceWith(h("div", { class: "card empty" }, "지도를 불러오지 못했어요(인터넷 연결 확인).")); return; }
    if (map) { map.remove(); map = null; }
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView(st.loc ? [st.loc.lat, st.loc.lng] : st.region === "수도권" ? [37.5, 126.98] : [36.4, 127.8], st.loc ? 13 : st.region === "수도권" ? 10 : 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on("moveend", paintNear);
  }
  function drawMap() {
    if (!map) return;
    layer.clearLayers();
    let prices = null, min = Infinity;
    if (st.mapKey != null) {
      prices = new Map(ranking(st.mapKey, "price").map((x) => [x.b, x]));
      for (const x of prices.values()) min = Math.min(min, x.p);
    }
    for (const b of BR) {
      if (b.lat == null || !brandOn(b.i) || (prices && !prices.has(b.i))) continue;
      const color = brandOf(b.i)[1];
      let m;
      if (prices) {
        const x = prices.get(b.i);
        const label = x.p >= 10000 ? (x.p / 10000).toFixed(x.p % 10000 ? 1 : 0).replace(/\.0$/, "") + "만" : x.p.toLocaleString();
        m = L.marker([b.lat, b.lng], { icon: L.divIcon({ className: "", html: `<span class="pin-price${x.p === min ? " best" : ""}" style="--c:${color}">${label}</span>`, iconSize: [0, 0] }) });
      } else {
        m = L.circleMarker([b.lat, b.lng], { radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 });
      }
      const pop = h("div", {}, h("b", {}, bname(b.i)), h("br"), h("span", { class: "sub" }, b.addr || ""),
        prices ? h("div", { style: "margin-top:4px;font-weight:800" }, won(prices.get(b.i).p)) : null,
        dist(b.i) != null ? h("div", { class: "sub" }, `내 위치에서 ${km(dist(b.i))}`) : null,
        h("button", { class: "btn sm", type: "button", style: "margin-top:8px", onclick: () => nav(`branch/${b.i}`) }, "이 지점 가격 보기"));
      m.bindPopup(pop);
      layer.addLayer(m);
    }
    if (st.loc) {
      meMarker = L.marker([st.loc.lat, st.loc.lng], { icon: L.divIcon({ className: "", html: '<div class="me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false });
      layer.addLayer(meMarker);
    }
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
    el.replaceChildren(h("div", { style: "padding:12px 12px 4px" }, h("h3", {}, st.loc ? "가까운 지점" : "지도에 보이는 지점"), h("div", { class: "sub" }, `${list.length}곳${st.loc ? "" : " · 내 위치를 켜면 거리순으로 보여요"}`)),
      h("ul", { class: "list" }, list.slice(0, 40).map((x) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${x.b.i}`) },
        h("span", { class: "t row" }, bdot(x.b.i), bname(x.b.i)), h("span", { class: "p num" }, x.p != null ? won(x.p) : km(x.d)),
        h("span", { class: "m" }, x.b.addr, x.p != null && x.d != null ? h("b", {}, km(x.d)) : null))))));
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
      h("h2", { style: "margin-top:2px" }, `${brandOf(b)[0]} ${x.name}`),
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
            (() => { const x = r[15] ? null : rowPos(i); return x ? h("span", { class: x.vsMed < -0.005 ? "down" : x.vsMed > 0.005 ? "up" : "" }, `${x.n}곳 중 ${x.rank}위 · ${pctTxt(x.vsMed)}`) : null; })(),
            srcLink(i), h("span", { class: "sp" }), r[15] ? null : rowAddBtn(i)))); }));
      if (!shown.length) list.replaceChildren(h("div", { class: "empty" }, "찾는 시술이 없어요"));
      else if (shown.length > 400) list.append(h("div", { class: "empty" }, `${shown.length}개 중 400개만 보여요. 검색으로 좁혀 보세요.`));
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
      h("div", { class: "row", style: "margin-top:10px" }, switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }))));
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
      h("div", { class: "stats" }, h("div", {}, h("b", { class: "num" }, win), h("span", {}, "A가 더 쌈")), h("div", {}, h("b", { class: "num" }, tie), h("span", {}, "같음")), h("div", {}, h("b", { class: "num" }, lose), h("span", {}, "B가 더 쌈")))));
    const cats = [...new Set(items.map((x) => x.cat))].sort((p, q) => p - q);
    if (st.vcat >= 0 && !cats.includes(st.vcat)) st.vcat = -1;
    const q = h("input", { type: "search", placeholder: "옵션 이름으로 찾기", "aria-label": "옵션 찾기" });
    const list = h("ul", { class: "list" });
    const paint = () => {
      const w = q.value.trim().toLowerCase();
      let shown = items.filter((x) => (st.vcat < 0 || x.cat === st.vcat) && (!w || x.name.toLowerCase().includes(w)));
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
    const qs = decodeURIComponent(arg || "");
    const box = h("div", { class: "view" });
    const q = h("input", { type: "search", value: qs, "aria-label": "시술 검색", enterkeyhint: "search", placeholder: "시술 검색 (예: 슈링크 300샷, rejuran)" });
    const run = (v) => { if (v) nav(`search/${encodeURIComponent(v)}`, true); };
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") run(q.value.trim()); });
    box.append(h("div", { class: "search" }, h("span", { html: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' }), withSuggest(q, run)));
    // comparison keys whose label matches (same normalization as prices)
    const { tokens } = Search.parse(qs, searchIndex());
    const keys = KEYS.filter((k) => tokens.length && Search.matches(Search.norm(`${k.label} ${k.cat} ${famOf[k.i] ? famOf[k.i].f.name : ""}`), tokens));
    if (keys.length) box.append(h("div", { class: "card" }, h("h3", {}, "브랜드끼리 비교할 수 있는 시술"),
      h("ul", { class: "list", style: "margin-top:4px" }, keys.map((k) => { const top = ranking(k.i, "price")[0];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k.i; nav("compare"); } }, h("span", { class: "t" }, k.label),
          h("span", { class: "p num" }, top ? won(top.p) + "~" : "-"), h("span", { class: "m" }, k.cat, top ? `최저 ${bname(top.b)}` : ""))); }))));
    box.append(priceTable(`search/${encodeURIComponent(qs)}`, params, { q: params.get("exact") === "1" ? qs : qs, head: h("h3", {}, "이름에 검색어가 들어간 모든 가격") }));
    if (!params.toString()) setTimeout(() => q.focus(), 0);
    return box;
  };

  // ---------------- cart
  views.cart = () => {
    const box = h("div", { class: "view" });
    const c = cur();
    // saved carts
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, "장바구니"), h("span", { class: "sp" }),
      h("button", { class: "btn sm soft", type: "button", onclick: () => { const name = prompt("새 장바구니 이름", `장바구니 ${st.carts.length + 1}`); if (!name) return;
        st.carts.push({ name: name.trim().slice(0, 30), items: [] }); st.ci = st.carts.length - 1; saveCarts(); render(); } }, "+ 새로")),
      h("div", { class: "chips", style: "margin-top:10px" }, st.carts.map((x, i) => h("button", { class: "chip", type: "button", "aria-pressed": i === st.ci ? "true" : "false",
        onclick: () => { st.ci = i; st.open.clear(); saveCarts(); render(); } }, `${x.name} ${x.items.length}`))),
      h("div", { class: "row", style: "margin-top:10px" },
        h("button", { class: "btn sm gray", type: "button", onclick: () => { const name = prompt("이름 바꾸기", c.name); if (name) { c.name = name.trim().slice(0, 30); saveCarts(); render(); } } }, "이름 바꾸기"),
        c.items.length ? h("button", { class: "btn sm gray", type: "button", onclick: () => shareCart(c) }, "공유") : null,
        c.items.length ? h("button", { class: "btn sm gray", type: "button", onclick: () => { st.carts.push({ name: `${c.name} 복사본`, items: JSON.parse(JSON.stringify(c.items)) }); st.ci = st.carts.length - 1; saveCarts(); render(); } }, "복사") : null,
        h("span", { class: "sp" }),
        h("button", { class: "btn sm gray", type: "button", onclick: () => {
          if (!confirm(st.carts.length > 1 ? `'${c.name}'을(를) 지울까요?` : "담은 시술을 모두 비울까요?")) return;
          if (st.carts.length > 1) { st.carts.splice(st.ci, 1); st.ci = 0; } else c.items = [];
          saveCarts(); render(); } }, st.carts.length > 1 ? "삭제" : "비우기"))));
    if (!c.items.length) {
      box.append(h("div", { class: "card" }, h("div", { class: "empty" }, "받고 싶은 시술을 담으면 한 곳에서 다 받을 때, 여러 곳을 섞을 때, 브랜드·지역별로 어디가 가장 싼지 계산해 드려요.", h("br"),
        "비교 탭의 '+ 담기'나 지점 가격표·검색 결과의 '+ 담기'로 실제 옵션을 그대로 담을 수 있어요."),
        h("button", { class: "btn", type: "button", style: "width:100%", onclick: () => nav("compare") }, "시술 고르러 가기")));
      return box;
    }
    // items with option / sessions controls
    const items = c.items.filter(itemOk);
    const lost = c.items.length - items.length;
    box.append(h("div", { class: "card" }, h("h3", {}, `담은 시술 ${c.items.length}개`),
      h("ul", { class: "list", style: "margin-top:4px" }, c.items.map((it) => {
        const ok = itemOk(it), fam = it.t === "k" && ok ? famOf[KI[it.k]] : null;
        const setQ = (v) => { it.q = v; saveCarts(); render(); };
        const nOv = it.ov ? Object.keys(it.ov).length : 0;
        return h("li", {}, h("div", { class: "item" },
          h("span", { class: "t" }, fam ? fam.f.name : itemLabel(it)),
          qtyEl(() => it.q || 1, setQ),
          h("span", { class: "m" },
            fam && fam.f.vs.length > 1 ? h("select", { class: "mini", "aria-label": "옵션", onchange: (e) => { it.k = KEYS[+e.target.value].id; it.ov = {}; saveCarts(); render(); } },
              fam.f.vs.map((v) => h("option", { value: v.k, selected: v.k === KI[it.k] }, v.label))) : fam ? h("span", {}, fam.label) : null,
            it.t === "r" ? h("span", {}, `담은 곳: ${it.br.replace("|", " ")} · ${won(it.p)} · 같은 이름 상품끼리 비교`) : null,
            !ok ? h("span", { style: "color:var(--pricey)" }, "이번 주 가격표에 없어요") : null,
            nOv ? h("button", { class: "linkbtn", type: "button", onclick: () => { it.ov = {}; saveCarts(); render(); } }, `지점별로 바꾼 옵션 ${nOv}곳 · 되돌리기`) : null,
            ok ? h("button", { class: "chip mini-chip", type: "button", "aria-pressed": (it.sp ?? st.special) ? "true" : "false", title: "이 시술만 체험가·한정가 포함/제외",
              onclick: () => { it.sp = !(it.sp ?? st.special); saveCarts(); render(); } }, (it.sp ?? st.special) ? "특가 포함" : "특가 빼기") : null,
            h("span", { class: "sp" }),
            h("button", { class: "addbtn", type: "button", style: "padding:2px 9px", onclick: () => { c.items = c.items.filter((x) => x !== it); saveCarts(); render(); } }, "빼기"))));
      })),
      lost ? h("div", { class: "note", style: "margin-top:8px" }, `${lost}개는 이번 주 가격표에서 찾지 못해 계산에서 빠졌어요.`) : null,
      h("div", { class: "row", style: "margin-top:12px" }, switchEl("특가 포함(첫 1회)", st.special, (v) => { st.special = v; store.set("special", v); render(); }),
        h("span", { class: "sp" }),
        st.loc ? h("select", { class: "mini", "aria-label": "거리", onchange: (e) => { st.maxKm = +e.target.value; render(); } },
          [[0, "거리 제한 없음"], [3, "3km 안"], [5, "5km 안"], [10, "10km 안"], [20, "20km 안"], [50, "50km 안"]].map(([v, l]) => h("option", { value: v, selected: v === st.maxKm }, l)))
          : h("button", { class: "btn sm soft", type: "button", onclick: () => locate("keep") }, "내 위치로 거리 보기")),
      h("div", { class: "row", style: "margin-top:8px" }, switchEl("첫 방문가는 지점당 1개만", st.noStack, (v) => { st.noStack = v; store.set("noStack", v); render(); }), whenChip()),
      brandChips(), h("div", { class: "sub", style: "margin-top:8px" }, `지역: ${regionName()} (화면 위 지역 버튼에서 바꿔요)`)));
    if (!items.length) return box;
    const tabs = [["one", "한 곳에서"], ["mix", "여러 곳 섞기"], ["pkg", "병원 패키지"], ["sum", "브랜드·지역"]];
    box.append(h("div", { class: "seg", role: "tablist" }, tabs.map(([v, l]) => h("button", { type: "button", role: "tab", "aria-selected": st.cartTab === v ? "true" : "false", onclick: () => { st.cartTab = v; render(); } }, l))));
    const plan = cartPlan(items);
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
      h("span", { class: "m" }, x.missing && x.missing.length ? h("span", { style: "color:var(--pricey)" }, `${items.length}개 중 ${x.n}개 가능`) : best ? (n ? `1위보다 +${won(x.total - best)}` : "가장 싸요") : null,
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
  views.import = (arg) => {
    const box = h("div", { class: "view" });
    let c = null;
    try { c = dec(arg); } catch (e) { /* bad link */ }
    if (!c || !Array.isArray(c.items)) { box.append(h("div", { class: "card empty" }, "공유 링크를 읽지 못했어요.")); return box; }
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
        st.carts.push({ name: String(c.name || "공유받은 장바구니").slice(0, 30), items: c.items.filter((it) => it && (it.t === "k" || it.t === "r")).map((it) => ({ ...it, q: Math.max(1, Math.min(20, +it.q || 1)) })) });
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
      render();
    } catch (e) { console.warn(e); toast("계정 정보를 불러오지 못했어요"); }
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
            if (!confirm("이 기록을 지울까요?")) return;
            st.recs = st.recs.filter((x) => x.id !== s.id); saveRecs();
            const A = auth(); if (A && A.user) A.deleteRecord(s.id).catch(() => {});
            close(); render(); } }, "삭제") : null,
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
        h("span", { class: "sp" }), h("button", { class: "btn sm gray", type: "button", onclick: profileSheet }, "수정")),
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
    box.append(h("div", { class: "card flush" }, h("ul", { class: "list" }, [["table", "📋", "전체 가격표", "모든 지점·모든 가격을 조건으로 찾기"], ["change", "📉", "가격 변동", "지난주보다 내리거나 오른 가격"], ["rank", "🏆", "지점 순위", "같은 상품 기준 싼 지점"], ["about", "ℹ️", "알아두면 좋은 점", "가격 종류·비교 기준·부가세·출처"]].map(([v, e, l, s]) =>
      h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(v) }, h("span", { class: "t" }, `${e} ${l}`), h("span", { class: "sub" }, "›"), h("span", { class: "m" }, s)))))));
    // data guide, region, branch list, settings (former 더보기)
    const counts = D.meta.brands.map((_, i) => [BR.filter((b) => b.brand === i).length, D.rows.filter((r) => BR[r[0]].brand === i).length]);
    box.append(h("div", { class: "card" }, h("h2", {}, "데이터 안내"),
      h("dl", { class: "kv", style: "margin-top:10px" }, h("dt", {}, "기준일"), h("dd", {}, `${D.meta.updated} (매주 월요일 자동 갱신)`),
        h("dt", {}, "가격 수"), h("dd", {}, `${D.meta.rows.toLocaleString()}개 · ${BR.length}개 지점`)),
      h("ul", { class: "list", style: "margin-top:8px" }, D.meta.brands.map((b, i) => !counts[i][0] ? null : h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "dot bdot", style: `background:${b[1]}` }), b[0]),
        h("span", { class: "sub" }, `${counts[i][0]}곳 · ${counts[i][1].toLocaleString()}개`), h("span", { class: "m" }, b[2]))))),
      h("div", { class: "note", style: "margin-top:10px" }, "• 체험가·한정가는 보통 1인 1회예요. '특가 포함'을 끄면 일반가만 비교해요.", h("br"),
        "• '평일 낮', '일요일' 같은 표시는 그 시간에만 되는 가격이에요.", h("br"), `• ${vatNote()} 4개 브랜드 모두 사이트에 부가세 10% 별도라고 적혀 있어요(내정보 → 설정에서 표시 방식 변경).`, h("br"),
        "• 종료일이 지난 이벤트, 지난주보다 90% 넘게 내리거나 10배 넘게 오른 가격(확인 중)은 비교에서 빠져요. 가격마다 '출처'로 병원 페이지를 열 수 있어요.", h("br"),
        "• 병원 사이트 표기 오류(정가가 판매가보다 낮거나 10배 넘는 값)는 정가를 지웠고, 안내 문구·서류 발급비는 뺐어요.")));
    // branch list by brand
    box.append(h("div", { class: "card" }, h("h2", {}, "지역"), h("div", { class: "sub" }, "고르면 비교·장바구니·검색·순위가 이 지역 지점만 보여 줘요(데이터는 전국을 모두 모아요)"), h("div", { style: "margin-top:10px" }, regionSelect())));
    const shown = BR.filter((b) => regionOk(b.i));
    box.append(h("details", { class: "card flush fold" }, h("summary", {}, `지점 전체 목록 ${shown.length}곳`),
      h("ul", { class: "list" }, shown.sort((a, b) => a.brand - b.brand || a.name.localeCompare(b.name, "ko")).map((b) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b.i}`) },
        h("span", { class: "t row" }, bdot(b.i), bname(b.i)), h("span", { class: "sub" }, dist(b.i) != null ? km(dist(b.i)) : b.region), h("span", { class: "m" }, b.addr)))))));
    const theme = store.get("theme", "auto");
    box.append(h("div", { class: "card" }, h("h2", {}, "설정"),
      h("div", { class: "row", style: "margin-top:10px" }, ["auto", "light", "dark"].map((t) => h("button", { class: "chip", type: "button", "aria-pressed": theme === t ? "true" : "false",
        onclick: () => { store.set("theme", t); applyTheme(); render(); } }, { auto: "기기 설정", light: "밝게", dark: "어둡게" }[t]))),
      h("div", { class: "sub", style: "margin-top:14px" }, "가격 표시"),
      h("div", { class: "row", style: "margin-top:6px" }, [["incl", "부가세 포함 예상가"], ["listed", "병원 표시가"]].map(([v, l]) => h("button", { class: "chip", type: "button", "aria-pressed": st.vat === v ? "true" : "false",
        onclick: () => { st.vat = v; store.set("vat", v); applyVat(); render(); } }, l))),
      h("div", { class: "sub", style: "margin-top:4px" }, "4개 브랜드 모두 사이트에 '부가세 10% 별도'라고 적혀 있어요(2026-10-13 확인). 상품명에 '부가세 포함'이 따로 있는 가격은 그대로 써요."),
      h("div", { class: "row", style: "margin-top:12px" }, h("button", { class: "btn sm gray", type: "button", onclick: () => window.lockApp && window.lockApp() }, "지금 잠그기"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { store.set("brands", null); store.set("special", true); location.reload(); } }, "설정 초기화")),
      h("div", { class: "sub", style: "margin-top:12px" }, "지도 © OpenStreetMap 기여자. 가격 출처는 각 병원 홈페이지예요.")));
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
    current = view;
    const tab = { branch: null, search: "home", import: "cart", more: "me", rank: "compare", versus: "compare", change: "home", table: "compare", about: "me" }[view] ?? view;
    document.querySelectorAll("#tabs button").forEach((b) => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    $("#main").replaceChildren(views[view](rest.join("/"), params));
    paintFloatCart(view);
  }
  window.addEventListener("popstate", render);
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => nav(b.dataset.tab)));
  $("#locbtn").addEventListener("click", () => locate());

  applyTheme();
  if (st.when && (!st.when.date || st.when.date < new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))) { st.when = null; store.set("when", null); }
  st.region = store.get("region", "수도권");
  paintRegion();
  $("#regbtn").addEventListener("click", () => { if (D) regionSheet(); });
  paintCartN();
  if (window.Auth && window.Auth.enabled) window.Auth.onChange((u) => { if (u && D) syncFromAccount(); else if (D) render(); });
  loadData().then(() => { render(); if (window.Auth && window.Auth.user) syncFromAccount(); }).catch((e) => { $("#main").replaceChildren(h("div", { class: "card empty" }, "데이터를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.")); console.error(e); });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
