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
    brands: store.get("brands", null),             // null = all
    carts: loadCarts(),                            // [{name, items: [{t:"k", k: key id, q, ov} | {t:"r", n: row name, br, p, q, ov}]}]
    ci: 0,                                         // current cart
    cartTab: "one", open: new Set(), showPart: false, maxKm: 0,
    me: store.get("me", { nick: "", gender: "", age: "" }), recs: store.get("recs", []), allRecs: false, tcat: null,
    loc: null, locName: "",
    sort: "price", cat: 0, key: null, mapKey: null, bcat: -1, region: "",
  };
  let D, S, BR, KEYS, ROWS, KI, byKB, byB, nameIdx, FAM, famOf, BK, SI, byName;
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
    byKB = KEYS.map(() => new Map());
    byB = BR.map(() => []);
    ROWS.forEach((r, i) => {
      byB[r[0]].push(i);
      const ks = S[r[7]];
      if (ks) for (const id of ks.split(" ")) { const m = byKB[KI[id]]; if (!m.has(r[0])) m.set(r[0], []); m.get(r[0]).push(i); }
    });
    nameIdx = null;
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
    return special ? out : out.filter((i) => !isSpecial(ROWS[i]));
  }
  // every row of branch b the user may pick instead (other doses, packages, special prices)
  function altRows(it, b) {
    const base = itemRows(it, b, true);
    let rx = null;
    if (it.t === "k" && famOf[KI[it.k]]) rx = famOf[KI[it.k]].f.rx;
    if (it.t === "r") { const w = it.n.replace(/^\[[^\]]*\]\s*/, "").split(/[\s(·]/).find((x) => x.length >= 2); if (w) rx = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")); }
    const more = rx ? byB[b].filter((i) => rx.test(S[ROWS[i][2]])) : [];
    return [...new Set([...base, ...more])].sort((a, c) => ROWS[a][3] - ROWS[c][3]).slice(0, 80);
  }
  const cheapest = (list) => list.reduce((best, i) => best < 0 || ROWS[i][3] < ROWS[best][3] || (ROWS[i][3] === ROWS[best][3] && isSpecial(ROWS[best]) && !isSpecial(ROWS[i])) ? i : best, -1);
  // price of q sessions of an item at branch b
  function lineAt(it, b) {
    const q = it.q || 1;
    const ovName = it.ov && it.ov[bkey(b)];
    if (ovName != null && SI.has(ovName)) {
      const i = (byName.get(SI.get(ovName)) || []).find((x) => ROWS[x][0] === b);
      if (i != null) {
        const ss = sessOf(i), units = ss >= 99 ? 1 : Math.ceil(q / ss);
        return { total: ROWS[i][3] * units, rows: [i], units, ov: true };
      }
    }
    const first = cheapest(itemRows(it, b));
    if (first < 0) return null;
    if (q <= 1) return { total: ROWS[first][3], rows: [first], units: 1 };
    const reg = cheapest(itemRows(it, b, false));
    const rest = reg >= 0 ? reg : first;
    return { total: ROWS[first][3] + ROWS[rest][3] * (q - 1), rows: first === rest ? [first] : [first, rest], units: q };
  }
  const branchOk = (b) => brandOn(b) && (!st.region || BR[b].region === st.region) && (!st.maxKm || !st.loc || (dist(b) != null && dist(b) <= st.maxKm));
  function cartTotals(items) {
    const full = [], part = [];
    if (!items.length) return { full, part };
    for (const b of BR.map((x) => x.i)) {
      if (!branchOk(b)) continue;
      const lines = items.map((it) => lineAt(it, b));
      const n = lines.filter(Boolean).length;
      const total = lines.reduce((s, l) => s + (l ? l.total : 0), 0);
      if (n === items.length) full.push({ b, total, lines, d: dist(b) });
      else if (n) part.push({ b, total, lines, d: dist(b), n });
    }
    full.sort((x, y) => x.total - y.total);
    part.sort((x, y) => y.n - x.n || x.total - y.total);
    return { full, part };
  }
  // each item at its own cheapest branch
  function mixTotals(items) {
    const picks = items.map((it) => {
      let best = null;
      for (const b of BR.map((x) => x.i)) {
        if (!branchOk(b)) continue;
        const l = lineAt(it, b);
        if (l && (!best || l.total < best.l.total)) best = { b, l };
      }
      return best;
    });
    return { picks, total: picks.reduce((s, p) => s + (p ? p.l.total : 0), 0), places: new Set(picks.filter(Boolean).map((p) => p.b)).size, missing: picks.filter((p) => !p).length };
  }
  // share: the cart travels in the link (#import/<base64url json>)
  const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
  async function shareCart(c) {
    const url = `${location.origin}${location.pathname}#import/${enc({ name: c.name, items: c.items })}`;
    const text = `[${c.name}] ${c.items.map((it) => `${itemLabel(it)} ×${it.q || 1}`).join(", ")}`;
    try {
      if (navigator.share) await navigator.share({ title: "피부과 장바구니", text, url });
      else { await navigator.clipboard.writeText(`${text}\n${url}`); toast("공유 링크를 복사했어요"); }
    } catch (e) { if (e && e.name !== "AbortError") toast("공유하지 못했어요"); }
  }
  function quoteText(x, items) {
    return [`[${bname(x.b)}] 예상 견적 (${D.meta.updated} 기준)`,
      ...items.map((it, j) => { const l = x.lines[j]; return l ? `- ${itemLabel(it)} ×${it.q || 1}: ${won(l.total)} (${S[ROWS[l.rows[0]][2]]})` : `- ${itemLabel(it)}: 이 지점에 없음`; }),
      `합계 ${won(x.total)} · 부가세 별도일 수 있음 · 방문 전 병원 확인`].join("\n");
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
      h("div", { class: "sub" }, "일반가 중간값(전 지점) · 정가 대비는 각 병원이 적은 정가에서 할인된 정도"),
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
      h("div", { class: "sub" }, `${k.label} · 일반가 기준, 전 브랜드 지점`),
      lineChart(tr.dates, [{ name: "중간값", color: "var(--s1)", values: v.map((x) => x && x[0]) }, { name: "최저가", color: "var(--s2)", values: v.map((x) => x && x[1]) }], `${k.label} 주별 가격`));
    if (tr.disc[k.id] != null) card.append(h("div", { class: "note", style: "margin-top:8px" }, `이번 주 병원들이 적은 정가보다 중간값 ${tr.disc[k.id]}% 싸게 팔고 있어요.`));
    if (tr.dates.length < 2) card.append(h("div", { class: "sub", style: "margin-top:6px" }, "매주 월요일 갱신 때마다 점이 하나씩 늘어 선이 돼요."));
    return card;
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
    box.append(trendCard() || "");
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
    const fam = famOf[k.i];
    if (fam && fam.f.vs.length > 1) card.append(h("div", { class: "opts", style: "margin-top:10px" }, fam.f.vs.map((v) => { const tp = ranking(v.k, "price")[0];
      return h("button", { class: "opt", type: "button", "aria-pressed": v.k === k.i ? "true" : "false", onclick: () => { st.key = v.k; render(); } },
        h("b", {}, `${fam.f.name} ${v.label}`), h("span", { class: "num" }, tp ? `최저 ${won(tp.p)}` : "가격 없음")); })));
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
    box.append(h("div", { class: "note" }, "같은 시술로 묶는 기준: 용량·샷 수·회차·원산지가 같은 1회 가격. 다른 시술과 묶인 패키지, 추가 옵션, 구독권은 빠져요. 이름이 조금 달라도 같은 시술이면 묶었어요."));
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
        h("a", { class: "btn sm gray", href: x.site, target: "_blank", rel: "noopener" }, "병원 홈페이지"),
        h("button", { class: "btn sm soft", type: "button", onclick: () => recordSheet(null, { br: bkey(b) }) }, "방문 기록"))));
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
          h("span", { class: "m" }, D.meta.cats[r[1]], r[4] ? h("s", {}, won(r[4])) : null, kindBadge(r), sessOf(i) > 1 ? h("span", {}, sessOf(i) >= 99 ? "이용권" : `${sessOf(i)}회`) : null,
            h("span", { class: "sp" }), rowAddBtn(i)))); }));
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
        return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, S[r[2]]),
          h("span", { class: "p num" }, won(r[3])), h("span", { class: "m" }, h("button", { class: "linkbtn", type: "button", onclick: () => nav(`branch/${r[0]}`) }, bdot(r[0]), bname(r[0])),
            r[4] ? h("s", {}, won(r[4])) : null, kindBadge(r), dist(r[0]) != null ? h("b", {}, km(dist(r[0]))) : null, h("span", { class: "sp" }), rowAddBtn(i)))); })) : h("div", { class: "empty" }, "검색 결과가 없어요. 짧게 써 보세요(예: 슈링크)")));
    if (hits.length > 200) box.append(h("div", { class: "sub", style: "text-align:center" }, "싼 순으로 200개까지 보여요. 검색어를 더 넣어 좁혀 보세요."));
    setTimeout(() => q.focus(), 0);
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
            h("span", { class: "sp" }),
            h("button", { class: "addbtn", type: "button", style: "padding:2px 9px", onclick: () => { c.items = c.items.filter((x) => x !== it); saveCarts(); render(); } }, "빼기"))));
      })),
      lost ? h("div", { class: "note", style: "margin-top:8px" }, `${lost}개는 이번 주 가격표에서 찾지 못해 계산에서 빠졌어요.`) : null,
      h("div", { class: "row", style: "margin-top:12px" }, switchEl("특가 포함(첫 1회)", st.special, (v) => { st.special = v; store.set("special", v); render(); }),
        h("span", { class: "sp" }),
        st.loc ? h("select", { class: "mini", "aria-label": "거리", onchange: (e) => { st.maxKm = +e.target.value; render(); } },
          [[0, "거리 제한 없음"], [3, "3km 안"], [5, "5km 안"], [10, "10km 안"], [20, "20km 안"], [50, "50km 안"]].map(([v, l]) => h("option", { value: v, selected: v === st.maxKm }, l)))
          : h("button", { class: "btn sm soft", type: "button", onclick: () => locate("keep") }, "내 위치로 거리 보기")),
      brandChips(), st.region ? h("div", { class: "sub", style: "margin-top:8px" }, `지역: ${st.region} (더보기에서 바꿈)`) : null));
    if (!items.length) return box;
    const tabs = [["one", "한 곳에서 다 받기"], ["mix", "여러 곳 섞기"], ["sum", "브랜드·지역별"]];
    box.append(h("div", { class: "seg", role: "tablist" }, tabs.map(([v, l]) => h("button", { type: "button", role: "tab", "aria-selected": st.cartTab === v ? "true" : "false", onclick: () => { st.cartTab = v; render(); } }, l))));
    const { full, part } = cartTotals(items);
    if (st.cartTab === "one") box.append(oneView(items, full, part));
    else if (st.cartTab === "mix") box.append(mixView(items, full));
    else box.append(sumView(full));
    box.append(h("div", { class: "note" }, "• 특가(체험가·한정가)는 첫 1회만, 2회째부터는 그 지점 일반가로 계산해요.", h("br"),
      "• 지점 이름을 누르면 시술별 견적이 펼쳐지고, 옵션을 그 지점의 다른 상품(용량·회차 패키지 등)으로 바꿀 수 있어요. 3회·5회 패키지를 고르면 횟수에 맞춰 묶음 수로 계산해요.", h("br"),
      "• 부가세 별도인 병원이 많아요. 방문 전에 병원에 꼭 확인하세요."));
    return box;
  };
  // one branch's quote, expandable, with a per-line option picker
  function quoteRow(x, items, n, best) {
    const open = st.open.has(x.b);
    const li = h("li", { class: "qrow" + (open ? " open" : "") });
    const headBtn = h("button", { class: "rank" + (n < 3 && best ? " top" : ""), type: "button", "aria-expanded": open ? "true" : "false",
      onclick: () => { if (st.open.has(x.b)) st.open.delete(x.b); else st.open.add(x.b); render(); } },
      h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))), h("span", { class: "p num" }, won(x.total)),
      h("span", { class: "m" }, x.n != null ? h("span", { style: "color:var(--pricey)" }, `${items.length}개 중 ${x.n}개 가능`) : best ? (n ? `1위보다 +${won(x.total - best)}` : "가장 싸요") : null,
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
          l.ov ? h("span", { class: "k k4" }, "직접 고름") : null, detail ? h("span", {}, detail) : null),
        alts.length > 1 || l.ov ? h("div", { style: "margin-top:6px" }, sel) : null));
    });
    body.append(h("div", { class: "row", style: "margin-top:10px" }, h("b", {}, "합계"), h("span", { class: "sp" }), h("b", { class: "num", style: "font-size:20px" }, won(x.total))),
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
  function mixView(items, full) {
    const m = mixTotals(items);
    const res = h("div", { class: "card" });
    res.append(h("h3", {}, "시술마다 가장 싼 지점에서 받으면"),
      h("div", { class: "hero", style: "margin-top:10px" }, h("span", { class: "hl" }, `${m.places}곳 방문${m.missing ? ` · ${m.missing}개는 가능한 지점 없음` : ""}`),
        h("span", { class: "hb" }, "합계"), h("span", { class: "hp num" }, won(m.total))),
      full.length ? h("div", { class: "sub", style: "margin-top:8px" }, m.total < full[0].total
        ? `한 곳에서 다 받는 최저(${bname(full[0].b)} ${won(full[0].total)})보다 ${won(full[0].total - m.total)} 싸요. 대신 ${m.places}곳을 다녀야 해요.`
        : `한 곳(${bname(full[0].b)})에서 다 받아도 같은 값이에요.`) : null,
      h("ul", { class: "list", style: "margin-top:6px" }, items.map((it, j) => { const p = m.picks[j];
        if (!p) return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, `${itemLabel(it)} ×${it.q || 1}`), h("span", { class: "p", style: "color:var(--pricey)" }, "없음")));
        const r = ROWS[p.l.rows[0]];
        return h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${p.b}`) }, h("span", { class: "t" }, `${itemLabel(it)} ×${it.q || 1}`), h("span", { class: "p num" }, won(p.l.total)),
          h("span", { class: "m" }, bdot(p.b), bname(p.b), h("span", {}, S[r[2]]), kindBadge(r), p.l.ov ? h("span", { class: "k k4" }, "직접 고름") : null, dist(p.b) != null ? h("b", {}, km(dist(p.b))) : null)));
      })));
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
    box.append(h("div", { class: "card" }, h("h2", {}, `공유받은 장바구니: ${c.name || "장바구니"}`),
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
    // data guide, region, branch list, settings (former 더보기)
    const counts = D.meta.brands.map((_, i) => [BR.filter((b) => b.brand === i).length, D.rows.filter((r) => BR[r[0]].brand === i).length]);
    box.append(h("div", { class: "card" }, h("h2", {}, "데이터 안내"),
      h("dl", { class: "kv", style: "margin-top:10px" }, h("dt", {}, "기준일"), h("dd", {}, `${D.meta.updated} (매주 월요일 자동 갱신)`),
        h("dt", {}, "가격 수"), h("dd", {}, `${D.meta.rows.toLocaleString()}개 · ${BR.length}개 지점`)),
      h("ul", { class: "list", style: "margin-top:8px" }, D.meta.brands.map((b, i) => !counts[i][0] ? null : h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "dot bdot", style: `background:${b[1]}` }), b[0]),
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
    box.append(h("details", { class: "card flush fold" }, h("summary", {}, `지점 전체 목록 ${shown.length}곳`),
      h("ul", { class: "list" }, shown.sort((a, b) => a.brand - b.brand || a.name.localeCompare(b.name, "ko")).map((b) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b.i}`) },
        h("span", { class: "t row" }, bdot(b.i), bname(b.i)), h("span", { class: "sub" }, dist(b.i) != null ? km(dist(b.i)) : b.region), h("span", { class: "m" }, b.addr)))))));
    const theme = store.get("theme", "auto");
    box.append(h("div", { class: "card" }, h("h2", {}, "설정"),
      h("div", { class: "row", style: "margin-top:10px" }, ["auto", "light", "dark"].map((t) => h("button", { class: "chip", type: "button", "aria-pressed": theme === t ? "true" : "false",
        onclick: () => { store.set("theme", t); applyTheme(); render(); } }, { auto: "기기 설정", light: "밝게", dark: "어둡게" }[t]))),
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
  function render() {
    if (!D) return;
    const [name, ...rest] = (location.hash.replace(/^#/, "") || "home").split("/");
    const view = views[name] ? name : name === "more" ? "me" : "home";
    current = view;
    const tab = { branch: null, search: "home", import: "cart", more: "me" }[view] ?? view;
    document.querySelectorAll("#tabs button").forEach((b) => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    $("#main").replaceChildren(views[view](rest.join("/")));
  }
  window.addEventListener("popstate", render);
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => nav(b.dataset.tab)));
  $("#locbtn").addEventListener("click", () => locate());

  applyTheme();
  st.region = store.get("region", "");
  paintCartN();
  if (window.Auth && window.Auth.enabled) window.Auth.onChange((u) => { if (u && D) syncFromAccount(); else if (D) render(); });
  loadData().then(() => { render(); if (window.Auth && window.Auth.user) syncFromAccount(); }).catch((e) => { $("#main").replaceChildren(h("div", { class: "card empty" }, "데이터를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.")); console.error(e); });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
