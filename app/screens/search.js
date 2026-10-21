// 검색 (#search/<q>) — split from app.js (docs/APP_JS_SPLIT_PLAN.md 3-8): the search page (natural language → filters, 고민으로 보기,
// 주요 종류 한눈에 비교, 용량·종류별 가격 비교, the kinds, '검색어가 가리키는 것' typedResults) over the price list of screens/table.js
// (App.priceTable, App.searchTips — read when the page is drawn). Registers itself in App.screens like the other screen files; app.js
// installs every screen right before it starts, handing over the helpers it still owns (the search index searchIndex · nlCtx ·
// rememberQuery · withSuggest · findGo — 홈's box uses them too —, the product index prodNames · prodBranches — a new price file
// resets it —, areaFind · useArea, keyPrice, famFind …). Data that is replaced when new data arrives (D, BR, CONC, KEYS, byKB, famOf,
// famsByName) is read through App.state() when the page is drawn, and again when something drawn earlier runs later (a kind's
// button), never copied.
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  (App.screens = App.screens || []).push(() => {
    const { h, icon, searchBox, cardHead, views, FLAGS, bdot, bname, kbOf, nav, moreList, famFind, kbSheet, KB_STATE, goLink, regionName,
      st, track, brandOf, findGo, withSuggest, searchIndex,
      MAIN_TYPES, areaFind, keyPrice, nlCtx, prodBranches, prodNames, rememberQuery, useArea } = App;
    // ---------------- search over every price
    function typedResults(qs, fams, keys) {
      const { BR, CONC } = App.state();   // read now: replaced when new data arrives
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
        h("p", { class: "tiny", style: "margin:var(--sp-2) 0 0" }, "제품·장비는 상품명에 적힌 것만 찾아요."));
    }
    views.search = (arg, params) => {
      const { D, CONC, KEYS, byKB, famOf, famsByName } = App.state();   // read now: replaced when new data arrives
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
      box.append(searchBox(withSuggest(q, run)), App.searchTips((v) => nav(`search/${encodeURIComponent(v)}?nl=0`)));
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
      const keys = KEYS.filter((k) => tokens.length && qc.test(Search.norm(`${k.label} ${k.full !== k.label ? k.full : ""} ${k.cat} ${famOf[k.i] ? famOf[k.i].f.name : ""}`)))
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
            kp.p, h("span", { class: "m" }, kp.m ? h("span", { class: "num" }, kp.m) : null, h("span", {}, k.cat)))); }, { first: 3, name: "용량·종류별 가격 비교" });
        const basisT = `${regionName()} · ${FLAGS.lowestHighlight ? "최저가" : "중간 가격"}`, basis = h("span", { class: "sub" }, basisT);
        return specFirst ? h("div", { class: "card keys" }, cardHead("용량·종류별 가격 비교", { count: `${keys.length}개`, desc: basisT }), ul, more)
          : h("details", { class: "card fold sfold keys" }, h("summary", {}, `용량·종류별 가격 비교 ${keys.length}개`), h("div", { class: "fambody" }, h("div", { class: "row" }, basis), ul, more)); })();
      // the kinds: the first 5, then the shared '더 보기' ('부위' is in each kind's ⓘ, with the rest of its description)
      const famsCard = !fams.length ? null : (() => { const ul = h("ul", { class: "list", style: "margin-top:var(--sp-2)" });
        const more = moreList(ul, fams, (f) => { const e = kbOf(f), kp = keyPrice(f.main, numsMemo);
          return h("li", { class: "rk" }, h("button", { class: "item", type: "button", onclick: () => nav(`compare?k=${App.state().KEYS[f.main].id}`) }, h("span", { class: "t" }, f.name),
            kp.p, h("span", { class: "m" }, e ? e.purpose : `${f.cat} · ${kp.n ? `${kp.n}곳` : `${regionName()} 가격 없음`}`)),
            e ? h("button", { class: "infob", type: "button", "aria-label": `${f.name} 설명 보기`, onclick: () => kbSheet(e, f) }, icon("info")) : null); }, { first: 5, unit: "가지", name: `‘${qs}’ 종류` });
        const basisT = `${regionName()} · ${FLAGS.lowestHighlight ? "최저가" : "중간 가격"}`, basis = h("span", { class: "sub" }, basisT);
        const body = [ul, more,   // each line says its own purpose
          h("button", { class: "linkbtn", type: "button", style: "margin-top:var(--sp-2)", onclick: () => nav(`guide?q=${encodeURIComponent(qs)}`) }, fams.length > 12 ? `시술 사전에서 ${fams.length}가지 모두 보기` : "시술 사전에서 자세히 보기", icon("chevron-right", "xs"))];
        return !specFirst ? h("div", { class: "card fams" }, cardHead(`‘${qs}’ 종류`, { count: `${fams.length}가지`, desc: basisT }), body)
          : h("details", { class: "card fold sfold fams" }, h("summary", {}, `‘${qs}’ 비슷한 종류 ${fams.length}가지`), h("div", { class: "fambody" }, h("div", { class: "row" }, basis), body)); })();
      for (const c of specFirst ? [keysCard, famsCard] : [famsCard, keysCard]) if (c) box.append(c);
      // typed results (docs/SEARCH_ENGINE_QA.md): what else the words name — a product / device, a clinic, a place, a concern —
      // each with where it leads; the counts are real (branches selling, branches in the place). Words that name a clinic or a
      // place keep it above the price lines (that is what was asked); otherwise it and the side-by-side kinds follow the price
      // lines, so the first price line is within the first two screens (hierarchy audit 5 · 16)
      const tc = typedResults(params.get("orig") || qs, fams, keys), tcFirst = !!(tc && tc.dataset.place);
      if (tcFirst) box.append(tc);
      const orig = params.get("orig");
      box.append(App.priceTable(`search/${encodeURIComponent(qs)}`, params, { q: qs, n: 20, foldFacets: true, mixHint: keys.length ? "같은 용량끼리는 위 '용량·종류별 가격 비교'에서 봐요." : "",
        head: [h("h3", {}, qs ? "이름에 검색어가 들어간 모든 가격" : "조건에 맞는 모든 가격"),
        orig ? h("div", { class: "note", style: "margin-top:var(--sp-2)" }, `‘${orig}’를 검색어 ‘${qs || "(없음)"}’와 아래 필터로 나눠 찾았어요. `,
          h("button", { class: "linkbtn", type: "button", onclick: () => nav(`search/${encodeURIComponent(orig)}?nl=0`, true) }, "문장 그대로 찾기")) : null] }));
      if (tc && !tcFirst) box.append(tc);
      if (mainCard) box.append(mainCard);
      if (!params.toString()) setTimeout(() => q.focus(), 0);
      return box;
    };
  });
})();
