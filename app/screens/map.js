// 지도 (#map) — split from app.js (docs/APP_JS_SPLIT_PLAN.md 3-4). Registers itself in App.screens like screens/ops.js,
// screens/about.js and screens/concern.js; app.js installs every screen right before it starts, handing over the helpers it
// still owns (the ones other screens use too: the area names — areaSearch, useArea: the location sheet and search use them —,
// locate, savePlace/usePlace, brandChips, ranking, dist …). Data that is replaced when new data arrives (BR, KEYS) is read
// through App.state() when the map, its pins or its list are drawn, never copied. The Leaflet map itself lives here; app.js
// reads it with App.mapNow() (an area picked elsewhere moves it, so does the branch page's '지도' button).
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  (App.screens = App.screens || []).push(() => {
    const { $, h, icon, won, km, views, FLAGS, nav, render, moreList, bdot, bname, st, ranking, brandOn, brandOf, dist, regionCmp,
      locate, savePlace, usePlace, areaSearch, brandChips } = App;
    // ---------------- map
    let map, layer, meMarker;
    App.mapNow = () => map;   // for app.js: the map as it is now (undefined until the map screen first opens)
    views.map = () => {
      const { KEYS } = App.state();   // read now: replaced when new data arrives
      const box = h("div", { class: "view" });
      // the map opens on the treatment just compared (its prices on the pins) until the user picks something else
      if (st.mapKey == null && !st.mapKeyChosen && st.key != null && KEYS[st.key]) st.mapKey = st.key;
      const keySel = h("select", { class: "pick", "aria-label": "지도에 표시할 시술", onchange: (e) => { st.mapKeyChosen = true; st.mapKey = e.target.value === "" ? null : +e.target.value; st.mapSel = null; drawMap(); paintNear(); } },
        h("option", { value: "" }, "지점 위치만 보기"), KEYS.map((x) => h("option", { value: x.i, selected: x.i === st.mapKey }, `${x.cat} · ${x.label}`)));
      box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, "지도"), h("span", { class: "sp" }),
        h("button", { class: "btn sm gray", type: "button", onclick: () => locate(() => { if (map && st.loc) map.setView([st.loc.lat, st.loc.lng], 13); }) }, icon("locate-fixed", "sm"), "내 위치로")),
        h("div", { style: "margin-top:var(--sp-2)" }, areaSearch()),
        h("div", { class: "row", style: "margin-top:var(--sp-2)" }, ["집", "직장"].map((n) => h("button", { class: "btn sm gray", type: "button", onclick: () => { if (!map) return; const c = map.getCenter(); savePlace(n, c.lat, c.lng); usePlace(n); } }, icon(n === "집" ? "house" : "building-2", "sm"), `지도 가운데를 ${n}으로`))),
        h("div", { style: "margin-top:var(--sp-2)" }, keySel), brandChips()));
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
        loadLeaflet().then(() => { leafletFailed = false; if (App.state().current === "map") render(); }).catch(() => { if (App.state().current === "map") render(); });
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
      const pts = App.state().BR.filter((b) => b.lat != null && brandOn(b.i) && (!prices || prices.has(b.i)) && kmOk(b.i));
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
        prices ? h("div", { class: "fw-bold", style: "margin-top:var(--sp-2)" }, won(prices.get(b.i).p)) : null,
        dist(b.i) != null ? h("div", { class: "sub" }, `기준 위치에서 ${km(dist(b.i))}`) : null,
        b.geo ? h("div", { class: "sub" }, `지도 위치는 주소의 ${b.geo === 1 ? "도로" : "구·동"}까지만 찾은 근사치예요 — 방문 전 주소를 확인하세요`) : null,
        same > 1 ? h("div", { class: "sub" }, `${b.geo ? "같은 좌표" : "같은 건물"}에 ${same}곳 — 지도에 위아래로 나란히 놓았어요`) : null,
        h("button", { class: "btn sm", type: "button", style: "margin-top:var(--sp-2)", onclick: () => nav(`branch/${b.i}`) }, "이 지점 가격 보기"));
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
      const b = App.state().BR[i]; if (!map || b.lat == null) return;
      st.mapSel = i;
      map.setView([b.lat, b.lng], Math.max(map.getZoom(), 16));
      // by branch id, not position: some branches share coordinates
      setTimeout(() => { layer.eachLayer((m) => { if (m.bi === i && m.getPopup) m.openPopup(); }); markListSel(false); }, 350);
      document.getElementById("map").scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // distance limit for the map (pins and list), only once a place to measure from is set
    const kmOk = (b) => !st.mapKm || !st.loc || (dist(b) != null && dist(b) <= st.mapKm);
    const kmChips = () => !st.loc ? null : h("div", { class: "chips", role: "group", "aria-label": "거리", style: "margin-top:var(--sp-2)" },
      [[0, "거리 전체"], [1, "1km"], [3, "3km"], [5, "5km"], [10, "10km"]].map(([v, l]) => h("button", { class: "chip", type: "button", "aria-pressed": (st.mapKm || 0) === v ? "true" : "false",
        onclick: () => { st.mapKm = v; drawMap(); paintNear(); } }, l)));
    function paintNear() {
      const el = $("#near");
      if (!el || !map) return;
      const bounds = map.getBounds();
      let list = App.state().BR.filter((b) => b.lat != null && brandOn(b.i) && bounds.contains([b.lat, b.lng]) && kmOk(b.i));
      const price = st.mapKey != null ? new Map(ranking(st.mapKey, "price").map((x) => [x.b, x])) : null;
      if (price) list = list.filter((b) => price.has(b.i));
      list = list.map((b) => ({ b, d: dist(b.i), p: price ? price.get(b.i).p : null }))
        .sort((x, y) => st.loc ? (x.d - y.d) : price && FLAGS.lowestHighlight ? x.p - y.p : regionCmp(x.b.i, y.b.i));
      // the first 40 (the chosen marker's branch is always among them), then the shared '20곳 더 보기' — the rest used to be
      // left out with no word (hierarchy audit 11)
      const sel = list.findIndex((x) => x.b.i === st.mapSel);
      if (sel >= 40) list = [...list.slice(0, 40), list[sel], ...list.slice(40, sel), ...list.slice(sel + 1)];
      const ul = h("ul", { class: "list" });
      const mb = list.length ? moreList(ul, list, (x) => h("li", { class: "rk" + (x.b.i === st.mapSel ? " sel" : ""), "data-b": x.b.i },
        h("button", { class: "item", type: "button", onclick: () => nav(`branch/${x.b.i}`) },
          h("span", { class: "t row" }, bdot(x.b.i), bname(x.b.i)), h("span", { class: "p num" }, x.p != null ? won(x.p) : km(x.d)),
          h("span", { class: "m" }, x.b.addr, x.p != null && x.d != null ? h("b", {}, km(x.d)) : null)),
        h("button", { class: "infob", type: "button", "aria-label": `${bname(x.b.i)} 지도에서 보기`, onclick: () => focusBranch(x.b.i) }, icon("map-pin"))), { first: sel >= 40 ? 41 : 40, unit: "곳" }) : null;
      el.replaceChildren(h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, st.loc ? `가까운 지점${st.locName ? ` · ${st.locName} 기준` : ""}` : "지도에 보이는 지점"),
        h("div", { class: "sub" }, `${list.length}곳${st.mapKm && st.loc ? ` · ${st.mapKm}km 안` : ""} · 지도를 옮긴 뒤 '이 지역 재검색'을 누르면 목록이 바뀌어요${st.loc ? "" : " · 위치나 동네를 정하면 거리순·거리 제한"}`), kmChips()),
        list.length ? ul : h("div", { class: "empty" }, "이 지역에 표시할 지점이 없어요. 지도를 넓히거나 동네 이름으로 찾아보세요."), ...(mb ? [mb] : []));
    }
  });
})();
