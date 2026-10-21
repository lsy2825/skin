// 전체 가격표 (#table) and the price list with filters it shares with 검색 (#search/<q>) — split from app.js (docs/APP_JS_SPLIT_PLAN.md
// 3-8): priceTable and its filters (readFilters, rowPasses with the per-branch gate, the 가격 조건 sheet, 제품·장비 and 세부 구분 chips,
// '이렇게 찾았어요', 검색 팁, the zero-result tips, 필터 저장). Registers itself in App.screens like the other screen files; app.js
// installs every screen right before it starts, handing over the helpers it still owns (the search index searchIndex · suggestTerms ·
// withSuggest — 홈's box uses it too —, the place checks regOk · areaOk — price alerts and 죠미's answers use them —, the price-row
// helpers live · isSpecial · sessOf · prodOf …). screens/search.js draws its prices with App.priceTable and App.searchTips, set here.
// The filters live in the address: a change is added to the address as it is now (liveParams), not to the params the screen was
// drawn with. Data that is replaced when new data arrives (D, S, BR, ROWS, KEYS, KI, normBySid) is read through App.state() when a
// list is drawn — into T, which the per-row checks read while it is drawn — and again when something drawn earlier runs later
// (더 보기's rows, the 가격 조건 sheet), never copied.
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  (App.screens = App.screens || []).push(() => {
    const { h, fill, icon, won, km, store, toast, undoToast, searchBox, views, FLAGS, verified, bdot, bname, nav, render, moreList, kwBadge,
      md, vatNote, jomiSay, jomiEmpty, regionName, st, brandOn, dist, regionCmp, cmpNav, dupRows, infoBtn, isFirstVisit, isSpecial,
      kindBadge, listS, live, mLine, rowAddBtn, rowPos, sessOf, applyVat, sheet, withSuggest, jline,
      CAPITAL, areaOk, isBundle, prodOf, regOk, searchIndex, suggestTerms, uid, whenChip } = App;
    let T = null;   // the data of the list being drawn: priceTable reads App.state() into it; the per-row checks below read it
    App.priceTable = priceTable; App.searchTips = searchTips;   // for screens/search.js (read when the search page is drawn)
    // ---------------- price list with filters, shared by 전체 가격표 (#table) and search (#search/<q>); filter state lives in the URL
    // sorts for every price list: neutral ones first; discount-led sorts only with flags.discountEmphasis
    const SORTS = () => [["region", "지역·이름순"], ["recent", "최근 확인순"], ["near", "가까운순"], ["price", "낮은 가격순"], ["priceDesc", "높은 가격순"], ["unit", "단위당 가격"], ["name", "상품명순"],
      ...(FLAGS.discountEmphasis ? [["disc", "할인율 큰 순"], ["pos", "중간보다 싼 순"]] : [])];
    const SESS_L = { "1": "1회 가격", pkg: "2회 이상 묶음", pass: "이용권·무제한" }, COND_L = { plain: "일반가만", special: "특가만" };
    const amtOf = (i) => { const { S, ROWS } = T, u = Search.unitOf(S[ROWS[i][2]]); return u && !/\+/.test(S[ROWS[i][2]]) ? `${u.qty}${u.unit}` : ""; };
    // treatment attributes (origin · sex · area · grade) of a price, from the labels of its comparison keys (Search.attrsOf);
    // cached per key set — many prices share one
    const attrCache = new Map();
    const attrsOfRow = (i) => { const { ROWS, S, KI, KEYS } = T, ks = ROWS[i][7]; let a = attrCache.get(ks);
      if (!a) { a = Search.attrsOf(S[ks].split(" ").filter(Boolean).map((k) => KI[k] != null ? KEYS[KI[k]].label : "")); attrCache.set(ks, a); } return a; };
    // selected attributes: one per group (원산지 · 성별 · 부위 · 등급), all of them must hold
    const attOk = (i, atts, skipGroup = "") => { if (!atts.length) return true; const a = attrsOfRow(i); return atts.every((x) => Search.attrGroup(x) === skipGroup || a.includes(x)); };
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
      const { BR } = T, arr = new Uint8Array(BR.length);
      for (const b of BR) arr[b.i] = (brandOn(b.i) ? 1 : 0) | (regOk(b.i, f.reg) ? 2 : 0) | (areaOk(b.i, f.area) ? 4 : 0);
      const prev = GATE; GATE = { f, arr };
      try { return fn(); } finally { GATE = prev; }
    }
    function rowPasses(i, f, cq, skip = "") {
      const { ROWS, BR, normBySid } = T, r = ROWS[i], G = GATE && GATE.f === f ? GATE.arr[r[0]] : -1;
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
    const condActive = (f) => [f.cond ? COND_L[f.cond] : "", f.kind >= 0 ? T.D.meta.kinds[f.kind] : "", f.fv ? FV_L[f.fv] : "", f.bun ? BUN_L[f.bun] : "", f.sess ? SESS_L[f.sess] : "",
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
          opts("가격 종류", "kind", [[-1, "전체", null], ...App.state().D.meta.kinds.map((k, i) => [i, k, cnt.kind[i] || 0])]),
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
      // read now, after searchIndex() (it may build normBySid): replaced when new data arrives. T = this draw's data for the per-row checks
      T = App.state();
      const { D, S, BR, ROWS, normBySid } = T;
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
      // disc and ver also run later, for 더 보기's rows: they read the rows as they are then (App.rows())
      const disc = (i) => { const ROWS = App.rows(); return ROWS[i][4] ? (ROWS[i][4] - ROWS[i][3]) / ROWS[i][4] : 0; };
      const ver = (i) => verified(App.rows()[i][0]);
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
      const more = moreList(ul, hits, (i, n) => { const { ROWS, S, normBySid } = App.state(), r = ROWS[i], x = rowPos(i), u = Search.unitPrice(S[r[2]], r[3]);   // read now: 더 보기 draws rows later
        const head = byClinic && (n === 0 || ROWS[hits[n - 1]][0] !== r[0]);
        const clinic = (cls) => h("button", { class: cls, type: "button", onclick: () => nav(`branch/${r[0]}`) }, bdot(r[0]), bname(r[0]), cls === "linkbtn sgname" ? icon("chevron-right", "xs") : null);
        return h("li", { class: head ? "rk sgs" : "rk" },
          head ? h("div", { class: "sgh" }, clinic("linkbtn sgname"), dist(r[0]) != null ? h("b", { class: "sgkm" }, km(dist(r[0]))) : null) : null,
          h("div", { class: "item ra" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
          // the grey words, then the badges on their own line (mLine — 2026-10-20 디자인 통일 U14)
          mLine([byClinic ? null : clinic("linkbtn"), listS(r),
            u ? h("span", { class: "unitp" }, `${u.unit === "샷" ? "100샷" : u.unit === "U" ? "10U" : "1" + u.unit}당 ${won(u.price)}`) : null,
            x && FLAGS.lowestHighlight ? h("span", { class: x.vsMed < -0.005 ? "down" : x.vsMed > 0.005 ? "up" : "" }, `${x.n}곳 중 ${x.rank}위`) : null,
            f.sort === "recent" ? h("span", {}, `확인 ${md(ver(i))}`) : null, !byClinic && dist(r[0]) != null ? h("b", {}, km(dist(r[0]))) : null],
            [r[4] && FLAGS.discountEmphasis ? h("span", { class: "k k4" }, `${Math.round(disc(i) * 100)}%↓`) : null,   // information, not a condition (butter)
            kindBadge(r, { warn: cq ? cq.unstated(normBySid.get(r[2])).map((t) => kwBadge(t, { title: "상품명에 적혀 있지 않아요. 1회로 단정하지 않아요" })) : [] })]), rowAddBtn(i)),
          infoBtn(i, `${bname(r[0])} ${S[r[2]]}`)); },
        { first: f.n, name: "가격", onMore: (n) => { const np = liveParams(route, params); if (n === N0) np.delete("n"); else np.set("n", n); const s = np.toString(); history.replaceState(null, "", `#${route}${s ? "?" + s : ""}`); } });
      box.append(h("div", { class: "card flush results" }, resHead, ul, more));
      return box;
    }
    // zero results: offer the nearest searches that do return something
    function noResults(f, cq, go, route = "") {
      const { ROWS } = T;   // the list being drawn (priceTable)
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
  });
})();
