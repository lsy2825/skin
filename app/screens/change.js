// 가격 변동 (#change) — split from app.js (docs/APP_JS_SPLIT_PLAN.md 3-7): everything that moved since the previous snapshot, with
// the per-branch bars and the list's search, chips and sort. Registers itself in App.screens like the other screen files; app.js
// installs every screen right before it starts, handing over changeItems (홈's 가격 변동 card counts the same moves). Data that is
// replaced when new data arrives (D, BR) is read through App.state() when the screen is drawn (typing in its box reads neither).
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  (App.screens = App.screens || []).push(() => {
    const { h, won, emptyBox, emptyLine, searchBox, backBtn, views, bdot, bname, nav, render, moreList, md, regionName, st, regionOk,
      changeItems } = App;
    // ---------------- 가격 변동: everything that moved since the previous snapshot
    views.change = () => {
      const { D, BR } = App.state();   // read now: replaced when new data arrives
      const box = h("div", { class: "view" });
      const all = changeItems();
      // chains first collected since the previous snapshot (meta.brandFirst, C3): their prices are not '새로 생겼어요' one by one —
      // say so, for the chains this list can show (switched on, a branch in the region). No brandFirst: no notice, as before.
      // An older cached intel.js next to this app.js (sw.js falls back to the cache per file) only drops the notice
      const shownChains = D.meta.brands.map((x, i) => (st.brands.includes(i) && BR.some((r) => r.brand === i && regionOk(r.i)) ? x[0] : "")).filter(Boolean);
      const nc = Intel.newChains ? Intel.newChainsNote(Intel.newChains(D.meta.brandFirst, (D.achg || {}).prev, shownChains, D.meta.updated)) : "";
      box.append(backBtn(), h("div", { class: "card" }, h("h2", {}, "가격 변동"),
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, D.meta.prev ? `${md(D.meta.prev)} → ${md(D.meta.updated)} 수집 · 일반가 · 병원 표시가 기준 · ${regionName()}` : "지난 수집과 비교해요. 다음 수집부터 보여요."),
        nc ? h("div", { class: "note", id: "newchains", style: "margin-top:var(--sp-2)" }, nc) : null,
        // which moves to list: the 홈 card's segmented pick (.seg, 'name count'), two to a row (2026-10-20 디자인 통일 U22 — they were
        // four boxed tiles here). None picked lists them all; the picked one pressed again goes back to all
        h("div", { class: "seg two", role: "group", "aria-label": "변동 종류" }, [["down", "내렸어요"], ["up", "올랐어요"], ["new", "새로 생겼어요"], ["gone", "없어졌어요"]].map(([v, l]) =>
          h("button", { type: "button", "aria-pressed": st.cdir === v ? "true" : "false", onclick: () => { st.cdir = st.cdir === v ? "all" : v; render(); } }, `${l} ${all.filter((x) => x.t === v).length}`))),
        st.cdir !== "all" ? h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "다시 누르면 전체를 봐요") : null));
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
  });
})();
