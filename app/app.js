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
    brands: store.get("brands", null),             // null = all
    cart: store.get("cart", []),                   // [{k: key id, q}]
    loc: null, locName: "",
    sort: "price", cat: 0, key: null, mapKey: null, bcat: -1, region: "",
  };
  let D, S, BR, KEYS, ROWS, KI, byKB, byB, nameIdx;

  // ---------------- data
  async function loadData() {
    const r = await fetch("data.json", { cache: "no-cache" });
    D = await r.json();
    S = D.s;
    BR = D.branches.map((b, i) => ({ i, brand: b[0], name: S[b[1]], addr: S[b[2]], lat: b[3], lng: b[4], region: S[b[5]], site: S[b[6]] }));
    KEYS = D.keys.map(([id, cat, label], i) => ({ i, id, cat, label }));
    KI = Object.fromEntries(KEYS.map((k) => [k.id, k.i]));
    ROWS = D.rows;
    byKB = KEYS.map(() => new Map());
    byB = BR.map(() => []);
    ROWS.forEach((r, i) => {
      byB[r[0]].push(i);
      const ks = S[r[7]];
      if (ks) for (const id of ks.split(" ")) { const m = byKB[KI[id]]; if (!m.has(r[0])) m.set(r[0], []); m.get(r[0]).push(i); }
    });
    nameIdx = null;
    if (!st.brands) st.brands = D.meta.brands.map((_, i) => i);
    // a brand added after the filter was saved starts switched on (4 = brands before 포에버 was added)
    const added = D.meta.brands.map((_, i) => i).filter((i) => i >= store.get("nbrands", 4) && !st.brands.includes(i));
    if (added.length && store.get("brands", null)) { st.brands.push(...added); store.set("brands", st.brands); }
    store.set("nbrands", D.meta.brands.length);
    $("#upd").textContent = `${D.meta.updated} 기준 · ${BR.length}개 지점`;
  }
  const brandOf = (b) => D.meta.brands[BR[b].brand];
  const brandOn = (b) => st.brands.includes(BR[b].brand);
  const isSpecial = (r) => r[5] === 1 || r[5] === 2 || S[r[6]] !== "";
  const dist = (b) => {
    const x = BR[b];
    if (!st.loc || x.lat == null) return null;
    const R = 6371, rad = Math.PI / 180, dLat = (x.lat - st.loc.lat) * rad, dLng = (x.lng - st.loc.lng) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(st.loc.lat * rad) * Math.cos(x.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };
  // cheapest row for key k at branch b under the current settings (special: override st.special)
  function bestAt(k, b, special = st.special) {
    let best = -1;
    for (const i of byKB[k].get(b) || []) {
      const r = ROWS[i];
      if (!special && isSpecial(r)) continue;
      if (best < 0 || r[3] < ROWS[best][3] || (r[3] === ROWS[best][3] && isSpecial(ROWS[best]) && !isSpecial(r))) best = i;
    }
    return best;
  }
  // every branch selling key k, cheapest first (or nearest first)
  function ranking(k, sort = st.sort) {
    const out = [];
    for (const b of byKB[k].keys()) {
      if (!brandOn(b) || (st.region && BR[b].region !== st.region)) continue;
      const i = bestAt(k, b);
      if (i >= 0) out.push({ b, i, p: ROWS[i][3], d: dist(b) });
    }
    out.sort(sort === "near" && st.loc ? (x, y) => (x.d ?? 1e9) - (y.d ?? 1e9) || x.p - y.p : (x, y) => x.p - y.p || (x.d ?? 1e9) - (y.d ?? 1e9));
    return out;
  }
  const kindBadge = (r) => {
    const out = [];
    if (r[5] === 1) out.push(h("span", { class: "k k1" }, "체험가"));
    if (r[5] === 2) out.push(h("span", { class: "k k2" }, "한정가"));
    if (r[5] === 4) out.push(h("span", { class: "k k4" }, "고시가"));
    const t = S[r[6]];
    if (t) for (const x of t.split("·")) out.push(h("span", { class: "k kt" }, x));
    return out;
  };
  const bname = (b) => `${D.meta.brands[BR[b].brand][0]} ${BR[b].name}`;
  const bdot = (b) => h("span", { class: "bdot", style: `background:${brandOf(b)[1]}` });

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
  const inCart = (k) => st.cart.some((c) => c.k === KEYS[k].id);
  function toggleCart(k) {
    const id = KEYS[k].id;
    if (inCart(k)) { st.cart = st.cart.filter((c) => c.k !== id); toast("장바구니에서 뺐어요"); }
    else { st.cart.push({ k: id, q: 1 }); toast("장바구니에 담았어요"); }
    store.set("cart", st.cart);
    paintCartN();
  }
  function paintCartN() {
    const n = st.cart.length, el = $("#cart-n");
    el.hidden = !n; el.textContent = n;
  }
  const addBtn = (k) => {
    const b = h("button", { class: "addbtn", type: "button", "aria-pressed": inCart(k) ? "true" : "false" }, inCart(k) ? "담김" : "+ 담기");
    b.addEventListener("click", (e) => { e.stopPropagation(); toggleCart(k); b.setAttribute("aria-pressed", inCart(k)); b.textContent = inCart(k) ? "담김" : "+ 담기"; });
    return b;
  };
  // price of q units of key k at branch b: the first one may be a special price, the rest use the regular price
  function lineAt(k, b, q) {
    const first = bestAt(k, b);
    if (first < 0) return null;
    if (q <= 1) return { total: ROWS[first][3], rows: [first] };
    const reg = bestAt(k, b, false);
    const rest = reg >= 0 ? reg : first;
    return { total: ROWS[first][3] + ROWS[rest][3] * (q - 1), rows: [first, rest] };
  }
  function cartTotals() {
    const items = st.cart.map((c) => ({ k: KI[c.k], q: c.q })).filter((c) => c.k != null);
    if (!items.length) return { items, full: [], part: 0 };
    const full = [];
    let part = 0;
    for (const b of BR.map((x) => x.i)) {
      if (!brandOn(b) || (st.region && BR[b].region !== st.region)) continue;
      const lines = items.map((it) => lineAt(it.k, b, it.q));
      if (lines.every(Boolean)) full.push({ b, total: lines.reduce((s, l) => s + l.total, 0), lines, d: dist(b) });
      else if (lines.some(Boolean)) part++;
    }
    full.sort((x, y) => x.total - y.total);
    return { items, full, part };
  }

  // ---------------- views
  const views = {};
  let current = "home";

  views.home = () => {
    const box = h("div", { class: "view" });
    const q = h("input", { type: "search", placeholder: "시술 검색 (예: 슈링크 300샷, 리쥬란)", "aria-label": "시술 검색", enterkeyhint: "search" });
    const go = () => { if (q.value.trim()) nav(`search/${encodeURIComponent(q.value.trim())}`); };
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    box.append(h("div", { class: "search" }, h("span", { html: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' }), q, h("button", { type: "button", onclick: go }, "검색")));
    // categories -> compare
    const cats = [...new Set(KEYS.map((k) => k.cat))];
    box.append(h("div", { class: "chips" }, cats.map((c) => h("button", { class: "chip", type: "button", onclick: () => { st.key = KEYS.find((k) => k.cat === c).i; nav("compare"); } }, c))));
    // popular procedures: cheapest anywhere (or nearby)
    const sec = h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, st.loc ? "내 주변 최저가" : "대표 시술 최저가"), h("span", { class: "sp" }),
      h("span", { class: "sub" }, st.loc ? "10km 안" : "전 지점")));
    const grid = h("div", { class: "grid", style: "margin-top:12px" });
    for (const k of KEYS) {
      let rk = ranking(k.i, "price");
      if (st.loc) rk = rk.filter((x) => x.d != null && x.d <= 10);
      if (!rk.length) continue;
      const top = rk[0], r = ROWS[top.i];
      grid.append(h("button", { class: "pc", type: "button", onclick: () => { st.key = k.i; nav("compare"); } },
        h("span", { class: "c" }, k.cat), h("span", { class: "l" }, k.label), h("span", { class: "p num" }, won(top.p)),
        h("span", { class: "row", style: "gap:4px;min-height:18px" }, kindBadge(r)),
        h("span", { class: "w" }, `${bname(top.b)}${top.d != null ? " · " + km(top.d) : ""}`)));
      if (grid.children.length >= 8) break;
    }
    sec.append(grid, h("button", { class: "more-link", type: "button", onclick: () => nav("compare") }, "시술 36개 전체 비교 →"));
    box.append(sec);
    // price drops this week
    const drops = (D.changes || []).filter(([k, b, a, c]) => c < a && brandOn(b)).sort((x, y) => (y[2] - y[3]) / y[2] - (x[2] - x[3]) / x[2]).slice(0, 6);
    if (drops.length) {
      box.append(h("div", { class: "card" }, h("h2", {}, "이번 주 내린 가격"), h("div", { class: "sub" }, `${D.meta.prev} → ${D.meta.updated}`),
        h("ul", { class: "list", style: "margin-top:6px" }, drops.map(([k, b, a, c]) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b}`) },
          h("span", { class: "t" }, KEYS[k].label), h("span", { class: "p num cheap", style: "color:var(--good)" }, won(c)),
          h("span", { class: "m" }, bdot(b), bname(b), h("s", {}, won(a)), `-${Math.round((a - c) / a * 100)}%`)))))));
    }
    box.append(h("div", { class: "note" }, "가격은 각 병원 홈페이지에 올라온 값을 매주 월요일 자동으로 모은 거예요. 부가세 별도인 곳이 많고, 체험가·한정가는 1인 1회예요. 방문 전에 병원에서 꼭 확인하세요."));
    return box;
  };

  views.compare = () => {
    const box = h("div", { class: "view" });
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
    const controls = h("div", { class: "row", style: "margin-top:12px" },
      h("button", { class: "chip", type: "button", "aria-pressed": st.sort === "price" ? "true" : "false", onclick: () => { st.sort = "price"; render(); } }, "가격순"),
      h("button", { class: "chip", type: "button", "aria-pressed": st.sort === "near" ? "true" : "false", onclick: () => { if (!st.loc) locate("keep"); st.sort = "near"; render(); } }, "가까운순"),
      h("span", { class: "sp" }),
      switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }));
    card.append(controls, brandChips());
    if (rk.length) {
      const top = st.sort === "price" ? rk[0] : [...rk].sort((x, y) => x.p - y.p)[0];
      const prices = rk.map((x) => x.p).sort((a, b) => a - b);
      card.append(h("div", { class: "hero", style: "margin-top:14px" }, h("span", { class: "hl" }, `가장 싼 곳 · ${rk.length}개 지점 중`),
        h("span", { class: "hb" }, bname(top.b)), h("span", { class: "hp num" }, won(top.p)),
        h("span", { class: "hl", style: "color:var(--muted);font-weight:600" }, `중간값 ${won(prices[prices.length >> 1])} · 가장 비싼 곳 ${won(prices[prices.length - 1])}`)));
      card.append(h("div", { class: "row", style: "margin-top:12px" }, addBtn(k.i),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { st.mapKey = k.i; nav("map"); } }, "지도에서 보기")));
    }
    box.append(card);
    const list = h("ul", { class: "list" });
    rk.slice(0, 300).forEach((x, n) => {
      const r = ROWS[x.i];
      list.append(h("li", {}, h("button", { class: "rank" + (n < 3 && st.sort === "price" ? " top" : ""), type: "button", onclick: () => nav(`branch/${x.b}`) },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))),
        h("span", { class: "p num" }, won(x.p)),
        h("span", { class: "m" }, S[r[2]], r[4] ? h("s", {}, won(r[4])) : null, kindBadge(r), x.d != null ? h("b", {}, km(x.d)) : null))));
    });
    box.append(h("div", { class: "card flush" }, rk.length ? list : h("div", { class: "empty" }, "조건에 맞는 지점이 없어요. 브랜드나 특가 설정을 바꿔 보세요.")));
    box.append(h("div", { class: "note" }, "같은 시술로 묶는 기준: 용량·샷 수·회차·원산지가 같은 1회 가격. 다른 시술과 묶인 패키지, 추가 옵션, 구독권은 빠져요. 이름이 조금 달라도 같은 시술이면 묶었어요."));
    return box;
  };

  function switchEl(label, on, set) {
    const inp = h("input", { type: "checkbox", checked: on, onchange: (e) => set(e.target.checked) });
    return h("label", { class: "switch" }, inp, h("span", { class: "tr", "aria-hidden": "true" }), label);
  }
  function brandChips() {
    return h("div", { class: "chips", style: "margin-top:10px" }, D.meta.brands.map((b, i) => h("button", {
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
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView(st.loc ? [st.loc.lat, st.loc.lng] : [36.4, 127.8], st.loc ? 13 : 7);
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
    const box = h("div", { class: "view" });
    box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, "‹ 뒤로"));
    const d = dist(b);
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, bdot(b), h("span", { class: "sub" }, brandOf(b)[0])),
      h("h2", { style: "margin-top:2px" }, `${brandOf(b)[0]} ${x.name}`),
      h("dl", { class: "kv", style: "margin-top:10px" }, h("dt", {}, "주소"), h("dd", {}, x.addr || "확인 못 함"),
        d != null ? [h("dt", {}, "거리"), h("dd", {}, `내 위치에서 ${km(d)}`)] : null),
      h("div", { class: "row", style: "margin-top:12px" },
        x.lat != null ? h("button", { class: "btn sm soft", type: "button", onclick: () => { nav("map"); setTimeout(() => map && map.setView([x.lat, x.lng], 16), 50); } }, "지도") : null,
        x.addr ? h("a", { class: "btn sm gray", href: `https://map.kakao.com/?q=${encodeURIComponent(x.addr)}`, target: "_blank", rel: "noopener" }, "길찾기") : null,
        h("a", { class: "btn sm gray", href: x.site, target: "_blank", rel: "noopener" }, "병원 홈페이지"))));
    const rows = byB[b].filter((i) => st.special || !isSpecial(ROWS[i]));
    const cats = D.meta.cats.map((c, ci) => [c, rows.filter((i) => ROWS[i][1] === ci).length]).filter(([, n]) => n);
    if (st.bcat >= 0 && !cats.some(([c]) => D.meta.cats.indexOf(c) === st.bcat)) st.bcat = -1;
    const q = h("input", { type: "search", placeholder: "이 지점에서 시술 찾기", "aria-label": "이 지점에서 시술 찾기" });
    const list = h("ul", { class: "list" });
    const paint = () => {
      const t = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const shown = rows.filter((i) => (st.bcat < 0 || ROWS[i][1] === st.bcat) && t.every((w) => S[ROWS[i][2]].toLowerCase().includes(w)))
        .sort((a, c) => ROWS[a][1] - ROWS[c][1] || ROWS[a][3] - ROWS[c][3]);
      list.replaceChildren(...shown.slice(0, 400).map((i) => { const r = ROWS[i];
        return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
          h("span", { class: "m" }, D.meta.cats[r[1]], r[4] ? h("s", {}, won(r[4])) : null, kindBadge(r)))); }));
      if (!shown.length) list.replaceChildren(h("div", { class: "empty" }, "찾는 시술이 없어요"));
      else if (shown.length > 400) list.append(h("div", { class: "empty" }, `${shown.length}개 중 400개만 보여요. 검색으로 좁혀 보세요.`));
    };
    q.addEventListener("input", paint);
    box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, `가격표 ${rows.length}개`), h("span", { class: "sp" }),
      switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); })),
      h("div", { class: "search", style: "margin-top:10px;box-shadow:none;background:var(--fill)" }, q),
      h("div", { class: "chips", style: "margin-top:10px" }, h("button", { class: "chip", type: "button", "aria-pressed": st.bcat < 0 ? "true" : "false", onclick: () => { st.bcat = -1; render(); } }, "전체"),
        cats.map(([c, n]) => h("button", { class: "chip", type: "button", "aria-pressed": D.meta.cats.indexOf(c) === st.bcat ? "true" : "false",
          onclick: () => { st.bcat = D.meta.cats.indexOf(c); render(); } }, `${c} ${n}`)))));
    box.append(h("div", { class: "card flush" }, list));
    paint();
    return box;
  };

  // ---------------- search over every price
  views.search = (arg) => {
    const qs = decodeURIComponent(arg || "");
    const box = h("div", { class: "view" });
    const q = h("input", { type: "search", value: qs, "aria-label": "시술 검색", enterkeyhint: "search" });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter" && q.value.trim()) nav(`search/${encodeURIComponent(q.value.trim())}`, true); });
    box.append(h("div", { class: "search" }, h("span", { html: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>' }), q));
    const words = qs.toLowerCase().replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    const compact = (s) => s.toLowerCase().replace(/\s+/g, "");
    // matching comparison keys first
    const keys = KEYS.filter((k) => words.every((w) => compact(k.label + k.cat).includes(compact(w))));
    if (keys.length) box.append(h("div", { class: "card" }, h("h3", {}, "브랜드 비교 가능한 시술"),
      h("ul", { class: "list", style: "margin-top:4px" }, keys.map((k) => { const top = ranking(k.i, "price")[0];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { st.key = k.i; nav("compare"); } }, h("span", { class: "t" }, k.label),
          h("span", { class: "p num" }, top ? won(top.p) + "~" : "-"), h("span", { class: "m" }, k.cat, top ? `최저 ${bname(top.b)}` : ""))); }))));
    // every row whose name has all words
    const hits = [];
    for (let i = 0; i < ROWS.length; i++) {
      const r = ROWS[i];
      if (!brandOn(r[0]) || (!st.special && isSpecial(r))) continue;
      const n = compact(S[r[2]]);
      if (words.every((w) => n.includes(compact(w)))) hits.push(i);
    }
    hits.sort((a, b) => (st.sort === "near" && st.loc ? (dist(ROWS[a][0]) ?? 1e9) - (dist(ROWS[b][0]) ?? 1e9) : 0) || ROWS[a][3] - ROWS[b][3]);
    box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, `가격 ${hits.length.toLocaleString()}개`),
      h("div", { class: "sub" }, "이름에 검색어가 들어간 모든 가격, 싼 순")),
      hits.length ? h("ul", { class: "list" }, hits.slice(0, 200).map((i) => { const r = ROWS[i];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${r[0]}`) }, h("span", { class: "t" }, S[r[2]]),
          h("span", { class: "p num" }, won(r[3])), h("span", { class: "m" }, bdot(r[0]), bname(r[0]), r[4] ? h("s", {}, won(r[4])) : null, kindBadge(r),
            dist(r[0]) != null ? h("b", {}, km(dist(r[0]))) : null))); })) : h("div", { class: "empty" }, "검색 결과가 없어요. 짧게 써 보세요(예: 슈링크)")));
    if (hits.length > 200) box.append(h("div", { class: "sub", style: "text-align:center" }, "싼 순으로 200개까지 보여요. 검색어를 더 넣어 좁혀 보세요."));
    setTimeout(() => q.focus(), 0);
    return box;
  };

  // ---------------- cart
  views.cart = () => {
    const box = h("div", { class: "view" });
    const items = st.cart.filter((c) => KI[c.k] != null);
    const head = h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, "장바구니"), h("span", { class: "sp" }),
      items.length ? h("button", { class: "btn sm gray", type: "button", onclick: () => { st.cart = []; store.set("cart", []); paintCartN(); render(); } }, "비우기") : null));
    if (!items.length) {
      head.append(h("div", { class: "empty" }, "받고 싶은 시술을 담으면, 한 곳에서 모두 받을 때 어느 지점이 가장 싼지 알려 드려요."),
        h("button", { class: "btn", type: "button", style: "width:100%", onclick: () => nav("compare") }, "시술 고르러 가기"));
      box.append(head);
      return box;
    }
    head.append(h("ul", { class: "list", style: "margin-top:6px" }, items.map((c) => { const k = KEYS[KI[c.k]];
      const setQ = (d) => { c.q = Math.max(1, Math.min(9, c.q + d)); store.set("cart", st.cart); render(); };
      return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, k.label),
        h("span", { class: "qty" }, h("button", { type: "button", "aria-label": "하나 빼기", onclick: () => setQ(-1) }, "−"), h("b", { class: "num" }, c.q),
          h("button", { type: "button", "aria-label": "하나 더", onclick: () => setQ(1) }, "+")),
        h("span", { class: "m" }, k.cat, h("button", { class: "addbtn", type: "button", style: "padding:2px 8px", onclick: () => { toggleCart(k.i); render(); } }, "빼기")))); })),
      h("div", { class: "row", style: "margin-top:10px" }, switchEl("특가 포함(첫 1회)", st.special, (v) => { st.special = v; store.set("special", v); render(); })), brandChips());
    box.append(head);
    const { full, part } = cartTotals();
    const res = h("div", { class: "card flush" });
    if (!full.length) res.append(h("div", { class: "empty" }, `담은 시술을 한 지점에서 모두 하는 곳이 없어요${part ? ` (일부만 하는 곳 ${part}곳)` : ""}. 시술을 줄여 보세요.`));
    else {
      const near = st.loc ? [...full].filter((x) => x.d != null).sort((a, b) => a.d - b.d)[0] : null;
      res.append(h("div", { style: "padding:12px 12px 0" }, h("h3", {}, `모두 받을 수 있는 곳 ${full.length}곳`), h("div", { class: "sub" }, "합계가 싼 순 · 특가는 첫 1회만, 2회째부터는 그 지점 일반가")));
      if (near) res.append(h("div", { class: "hero", style: "margin:10px 12px 0" }, h("span", { class: "hl" }, "가장 가까운 곳"), h("span", { class: "hb" }, `${bname(near.b)} · ${km(near.d)}`), h("span", { class: "hp num" }, won(near.total))));
      res.append(h("ul", { class: "list" }, full.slice(0, 30).map((x, n) => h("li", {}, h("button", { class: "rank" + (n < 3 ? " top" : ""), type: "button", onclick: () => openQuote(x) },
        h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))), h("span", { class: "p num" }, won(x.total)),
        h("span", { class: "m" }, n ? `1위보다 +${won(x.total - full[0].total)}` : "가장 싸요", x.d != null ? h("b", {}, km(x.d)) : null))))));
    }
    box.append(res);
    return box;
  };
  function openQuote(x) {
    const items = st.cart.filter((c) => KI[c.k] != null);
    const lines = items.map((c, j) => ({ k: KEYS[KI[c.k]], q: c.q, l: x.lines[j] }));
    const text = [`[${bname(x.b)}] 예상 견적 (${D.meta.updated} 기준)`, ...lines.map((l) => `- ${l.k.label} ×${l.q}: ${won(l.l.total)} (${S[ROWS[l.l.rows[0]][2]]})`),
      `합계 ${won(x.total)} · 부가세 별도일 수 있음`].join("\n");
    const dlg = h("div", { class: "card", style: "position:fixed;left:12px;right:12px;bottom:calc(var(--nav-h) + 16px);z-index:70;max-width:560px;margin:0 auto;box-shadow:var(--shadow);max-height:70vh;overflow:auto" },
      h("div", { class: "row" }, h("h3", {}, bname(x.b)), h("span", { class: "sp" }), h("button", { class: "btn sm gray", type: "button", onclick: () => dlg.remove() }, "닫기")),
      h("ul", { class: "list" }, lines.map((l) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, `${l.k.label} ×${l.q}`), h("span", { class: "p num" }, won(l.l.total)),
        h("span", { class: "m" }, S[ROWS[l.l.rows[0]][2]], kindBadge(ROWS[l.l.rows[0]])))))),
      h("div", { class: "row", style: "margin-top:8px" }, h("b", {}, "합계"), h("span", { class: "sp" }), h("b", { class: "num", style: "font-size:20px" }, won(x.total))),
      h("div", { class: "row", style: "margin-top:10px" },
        h("button", { class: "btn sm", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(text); toast("견적을 복사했어요"); } catch (e) { toast("복사하지 못했어요"); } } }, "견적 복사"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { dlg.remove(); nav(`branch/${x.b}`); } }, "지점 가격표")));
    document.body.append(dlg);
  }

  // ---------------- more
  views.more = () => {
    const box = h("div", { class: "view" });
    const counts = D.meta.brands.map((_, i) => [BR.filter((b) => b.brand === i).length, D.rows.filter((r) => BR[r[0]].brand === i).length]);
    box.append(h("div", { class: "card" }, h("h2", {}, "데이터 안내"),
      h("dl", { class: "kv", style: "margin-top:10px" }, h("dt", {}, "기준일"), h("dd", {}, `${D.meta.updated} (매주 월요일 자동 갱신)`),
        h("dt", {}, "가격 수"), h("dd", {}, `${D.meta.rows.toLocaleString()}개 · ${BR.length}개 지점`)),
      h("ul", { class: "list", style: "margin-top:8px" }, D.meta.brands.map((b, i) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "dot bdot", style: `background:${b[1]}` }), b[0]),
        h("span", { class: "sub" }, `${counts[i][0]}곳 · ${counts[i][1].toLocaleString()}개`), h("span", { class: "m" }, b[2]))))),
      h("div", { class: "note", style: "margin-top:10px" }, "• 체험가·한정가는 보통 1인 1회예요. '특가 포함'을 끄면 일반가만 비교해요.", h("br"),
        "• '평일 낮', '일요일' 같은 표시는 그 시간에만 되는 가격이에요.", h("br"), "• 부가세(10%) 별도인 병원이 많아요.", h("br"),
        "• 병원 사이트 표기 오류(정가가 판매가보다 낮거나 10배 넘는 값)는 정가를 지웠고, 안내 문구·서류 발급비는 뺐어요.")));
    // branch list by brand
    const regions = [...new Set(BR.map((b) => b.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    const regSel = h("select", { class: "pick", "aria-label": "지역", onchange: (e) => { st.region = e.target.value; store.set("region", st.region); render(); } },
      h("option", { value: "" }, "전국"), regions.map((r) => h("option", { value: r, selected: r === st.region }, r)));
    box.append(h("div", { class: "card" }, h("h2", {}, "지역"), h("div", { class: "sub" }, "고르면 비교·장바구니·검색이 이 지역 지점만 보여 줘요"), h("div", { style: "margin-top:10px" }, regSel)));
    const shown = BR.filter((b) => !st.region || b.region === st.region);
    box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, `지점 ${shown.length}곳`)),
      h("ul", { class: "list" }, shown.sort((a, b) => a.brand - b.brand || a.name.localeCompare(b.name, "ko")).map((b) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b.i}`) },
        h("span", { class: "t row" }, bdot(b.i), bname(b.i)), h("span", { class: "sub" }, dist(b.i) != null ? km(dist(b.i)) : b.region), h("span", { class: "m" }, b.addr)))))));
    const theme = store.get("theme", "auto");
    box.append(h("div", { class: "card" }, h("h2", {}, "설정"),
      h("div", { class: "row", style: "margin-top:10px" }, ["auto", "light", "dark"].map((t) => h("button", { class: "chip", type: "button", "aria-pressed": theme === t ? "true" : "false",
        onclick: () => { store.set("theme", t); applyTheme(); render(); } }, { auto: "기기 설정", light: "밝게", dark: "어둡게" }[t]))),
      h("div", { class: "row", style: "margin-top:12px" }, h("button", { class: "btn sm gray", type: "button", onclick: () => window.lockApp && window.lockApp() }, "지금 잠그기"),
        h("button", { class: "btn sm gray", type: "button", onclick: () => { store.set("brands", null); store.set("special", true); location.reload(); } }, "설정 초기화")),
      h("div", { class: "sub", style: "margin-top:12px" }, "지도 © OpenStreetMap 기여자. 가격 출처는 각 병원 홈페이지예요.")));
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
  function render() {
    if (!D) return;
    const [name, ...rest] = (location.hash.replace(/^#/, "") || "home").split("/");
    const view = views[name] ? name : "home";
    current = view;
    const tab = { branch: null, search: "home" }[view] ?? view;
    document.querySelectorAll("#tabs button").forEach((b) => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    $("#main").replaceChildren(views[view](rest.join("/")));
  }
  window.addEventListener("popstate", render);
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => nav(b.dataset.tab)));
  $("#locbtn").addEventListener("click", () => locate());

  applyTheme();
  st.region = store.get("region", "");
  paintCartN();
  loadData().then(render).catch((e) => { $("#main").replaceChildren(h("div", { class: "card empty" }, "데이터를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.")); console.error(e); });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
