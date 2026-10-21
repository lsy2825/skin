// 지점 상세 (#branch) · 지점 순위 (#rank) · 지점 비교 (#versus) — split from app.js (docs/APP_JS_SPLIT_PLAN.md 3-5). Registers itself
// in App.screens like screens/ops.js, about.js, concern.js and map.js; app.js installs every screen right before it starts, handing
// over the helpers it still owns (the ones other screens use too: kindBadge, rowAddBtn, infoBtn, shortBtn, outLink, switchEl,
// visitSwitch, statRow, cmpNav, brSelect, branchRanks, cartLinesAt …). Data that is replaced when new data arrives (D, BR, byB, ROWS,
// S, GR, KEYS) is read through App.state() when a screen is drawn, and again when something drawn earlier runs later (a price line
// drawn by '더 보기' or by typing in the price list's box, a 분야 chip, '같은 브랜드 다음 지점', '비교 결과 복사'), never copied.
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  (App.screens = App.screens || []).push(() => {
    const { $, h, fill, icon, won, km, store, copyText, emptyBox, emptyLine, searchBox, cardHead, backBtn, views, FLAGS, fresh, bdot, bname, nav,
      render, moreList, md, jomiEmpty, st, brandOf, dist, brandChips,
      addonOf, bestAt, bkey, brSelect, branchRanks, cartLinesAt, cmpNav, cur, divBar, dupRows, endDate, favBtn, gstat, infoBtn, isFirstVisit,
      isRevisitRow, isSpecial, itemLabel, kindBadge, listS, live, lvClass, lvText, mLine, md2, outLink, pctTxt, recordSheet, regionOk, remember,
      rowAddBtn, rowPos, sessOf, shareLink, shortBtn, srcLink, statRow, switchEl, visitSwitch, visitedAt } = App;
    // ---------------- branch detail
    views.branch = (arg) => {
      const { D, BR, byB, ROWS, GR } = App.state();   // read now: replaced when new data arrives
      const b = /^\d+$/.test(String(arg)) ? +arg : -1, x = BR[b];
      // an old or mistyped link says so instead of silently showing the home screen (round-2 D6)
      if (!x) return h("div", { class: "view" }, backBtn(),
        jomiEmpty("empty", "이 지점을 찾지 못했어요. 수집에서 빠졌거나 링크가 잘못됐을 수 있어요."),
        h("button", { class: "btn line block", type: "button", onclick: () => nav("map") }, "지점 목록 보기", icon("chevron-right", "sm")));
      remember("b", bkey(b));
      const box = h("div", { class: "view" });
      box.append(backBtn());
      const d = dist(b);
      // ♡ and ‹ n/m › on the brand line, so the name has the card's whole width (검토 2026-10-20: beside the name, with the 40px
      // .tbtn-i, the name had 74px at 320 and 133 of 수도권's 289 names took 3 lines or more)
      box.append(h("div", { class: "card" }, (() => { const sib = BR.filter((y) => y.brand === x.brand && (regionOk(y.i) || y.i === b)).sort((p, q) => p.name.localeCompare(q.name, "ko")); const n = sib.findIndex((y) => y.i === b);
          const go = (d) => { const y = sib[(n + d + sib.length) % sib.length]; if (y) nav(`branch/${y.i}`, true); };
          return h("div", { class: "row brline" }, bdot(b), h("span", { class: "sub" }, brandOf(b)[0]), favBtn("b", bkey(b), bname(b)),
            sib.length > 1 && n >= 0 ? h("span", { class: "sibs" }, h("button", { class: "tbtn-i", type: "button", "aria-label": "같은 브랜드 이전 지점", onclick: () => go(-1) }, icon("chevron-left")), h("span", { class: "sub" }, `${n + 1}/${sib.length}`),
              h("button", { class: "tbtn-i", type: "button", "aria-label": "같은 브랜드 다음 지점", onclick: () => go(1) }, icon("chevron-right"))) : null); })(),
        h("h2", {}, `${brandOf(b)[0]} ${x.name}`),
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
          statRow([["일반가 기준", lvText(bs[0]), rk(0), lvClass(bs[0])], ["특가 포함", lvText(bs[1]), rk(1), lvClass(bs[1])],
            ["제일 싼 시술", `${bs[3]}개`, `혼자 최저 ${bs[4]}개`], ["옵션 수", `${byB[b].length}개`, `체험가·한정가 등 ${nSpecial}개`]], "two"),
          Object.keys(bs[5] || {}).length ? h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" }, Object.entries(bs[5]).map(([c, v]) => h("span", { class: "chip", style: "cursor:default" }, `${D.meta.cats[+c]} `, h("b", { class: lvClass(v) }, lvText(v))))) : null,
          h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "같은 옵션을 파는 지점들의 중간 가격과 비교했어요")));
        if (cheapHere.length) box.append(h("details", { class: "card flush fold" }, h("summary", {}, `이 지점이 제일 싼 시술 ${cheapHere.length}개`),
          (() => { const ul = h("ul", { class: "list" });   // the first 200, then the shared '더 보기'
            return [ul, moreList(ul, cheapHere, (x) => { const { ROWS, S } = App.state(), r = ROWS[x.i];
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
      const row = (i, withCat) => { const { D, ROWS, S } = App.state(), r = ROWS[i];
        return h("li", { class: "rk" }, h("div", { class: r[15] ? "item" : "item ra" }, h("span", { class: "t" }, S[r[2]]), h("span", { class: "p num" }, won(r[3])),
          mLine([withCat ? D.meta.cats[r[1]] : null, listS(r), sessOf(i) > 1 ? h("span", {}, sessOf(i) >= 99 ? "이용권" : `${sessOf(i)}회`) : null,
            (() => { const x = FLAGS.lowestHighlight && !r[15] ? rowPos(i) : null;
              return x ? h("span", { class: x.vsMed < -0.005 ? "down" : x.vsMed > 0.005 ? "up" : "" }, `${x.n}곳 중 ${x.rank}위 · ${pctTxt(x.vsMed)}`) : null; })()],
            [r[4] && FLAGS.discountEmphasis ? h("span", { class: "k k4" }, `${Math.round((r[4] - r[3]) / r[4] * 100)}%↓`) : null, kindBadge(r, { sameDate: sameEnd ? sameEnd.date : "" })]),
          r[15] ? null : rowAddBtn(i)), infoBtn(i, S[r[2]])); };
      // 851 prices were 400 lines in one go — 60.6 screens, and with '전체' the first three 분야 filled all 400 so 피부·레이저 and
      // three more never showed; the rest was one line of text (hierarchy audit 6 · L2 · BR-1). Now:
      //  · '전체' in 카테고리순 with nothing typed: each 분야 under its own heading with its first 5 lines and '보톡스·필러 151개
      //    모두 보기' (the 분야 chip above, as if tapped) — every 분야 is on the first screens
      //  · a 분야 chosen, words typed or another order: the first 30 lines and the shared '20개 더 보기 (N개 남음)'. Typing draws
      //    the list again from 30 (paint), the words stay in the box; the 더 보기 adds lines in place
      const paint = () => {
        const { D, ROWS, S } = App.state();   // read now (typing draws the list again)
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
      box.append(h("div", { class: "card", id: "bprices" }, cardHead("가격표", { count: `${rows.length}개`, end: switchEl("특가 포함", st.special, (v) => { st.special = v; store.set("special", v); render(); }) }),
        sameEnd ? h("p", { class: "tiny bdate" }, h("span", { class: "k k4" }, `~${md2(sameEnd.date)}까지`),
          sameEnd.n === sameEnd.total ? " 모든 가격"
            : ` ${sameEnd.n.toLocaleString()}개 가격이 이날까지예요. 다른 날짜는 줄마다 적어요.`) : null,
        searchBox(q, { inset: true, style: "margin-top:var(--sp-2)" }),
        h("div", { class: "chips bcats", style: "margin-top:var(--sp-2)" }, h("button", { class: "chip", type: "button", "data-c": -1, "aria-pressed": st.bcat < 0 ? "true" : "false", onclick: (e) => setCat(-1, e) }, "전체"),
          cats.map(([c, n]) => h("button", { class: "chip", type: "button", "data-c": D.meta.cats.indexOf(c), "aria-pressed": D.meta.cats.indexOf(c) === st.bcat ? "true" : "false",
            onclick: (e) => setCat(App.state().D.meta.cats.indexOf(c), e) }, `${c} ${n}`))),
        h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, [["cat", "카테고리순"], ["price", "낮은 가격순"], ["priceDesc", "높은 가격순"], ...(FLAGS.discountEmphasis ? [["med", "중간보다 싼 순"], ["disc", "할인율 큰 순"]] : [])].map(([v, l]) =>
          h("button", { class: "chip", type: "button", "aria-pressed": st.bsort === v ? "true" : "false", onclick: () => { st.bsort = v; render(); } }, l)))));
      box.append(h("div", { class: "card flush" }, list, moreSlot));
      paint();
      // 위계 점검 38: deep in the list, a small header keeps which branch and which 분야 (heads() shows it once the list is under
      // the app bar). Its chips are the table's 분야 (st.bcat): a tap redraws the list in place (paint — the typed words stay),
      // marks the table's own chips the same and goes back up to the table's controls
      { const card = list.closest(".card"), tbl = q.closest(".card"), own = tbl && tbl.querySelector(".chips");
        const ciOf = (n) => (n === 0 ? -1 : App.state().D.meta.cats.indexOf(cats[n - 1][0]));
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
      const { D, BR } = App.state();
      const chip = (ci, label) => h("button", { class: "chip", type: "button", "aria-pressed": st.bcat === ci ? "true" : "false", onclick: () => pick(ci) }, label);
      return h("div", { class: "bhead", role: "group", "aria-label": `${bname(b)} 가격표 분야` },
        h("b", { class: "bn" }, h("span", { class: "bb" }, brandOf(b)[0]), " ", h("span", { class: "bs" }, BR[b].name)),
        h("div", { class: "chips" }, chip(-1, "전체"), cats.map(([c, n]) => chip(D.meta.cats.indexOf(c), `${c} ${n}`))));
    }

    // ---------------- 지점 순위: branch price level (geometric mean of price / median over shared options)
    views.rank = () => {
      const { D } = App.state();   // read now: replaced when new data arrives
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
    // Korean subject particle for a name: 강남점이 / 서면이 … (final consonant → 이, else 가)
    const iga = (w) => { const c = String(w).charCodeAt(String(w).length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? "이" : "가"; };
    // 'OO점이 23,100원 저렴' between two branches (no sentence when equal)
    const cheaperTxt = (a, b, pa, pb) => { if (pa === pb) return "같은 가격"; const { BR } = App.state(), w = pa < pb ? a : b, nm = BR[a].name === BR[b].name ? bname(w) : BR[w].name; /* 블리비 안산점 vs 쁨 안산점: full names */ return `${nm}${iga(nm)} ${won(Math.abs(pa - pb))} 저렴`; };
    // two thin bars on one scale (the dearer price = full width); equal prices get no emphasis
    const pairBars = (pa, pb) => { const m = Math.max(pa, pb) || 1;
      return h("span", { class: "pbars", "aria-hidden": "true" }, h("i", { class: "a" + (pa < pb ? " lo" : ""), style: `width:${Math.max(4, pa / m * 100)}%` }), h("i", { class: "b" + (pb < pa ? " lo" : ""), style: `width:${Math.max(4, pb / m * 100)}%` })); };
    views.versus = (arg) => {
      const { D, BR, ROWS, GR, KEYS } = App.state();   // read now: replaced when new data arrives
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
          h("button", { class: "tbtn-i swap", type: "button", "aria-label": "A와 B 바꾸기", onclick: () => { [st.vsA, st.vsB] = [st.vsB, st.vsA]; render(); } }, icon("arrow-down-up")),
          h("label", { class: "flabel" }, h("span", { class: "row" }, h("span", { class: "key", style: "background:var(--s2)" }), "B 지점"), brSelect(B, (v) => { st.vsB = v; render(); }, "B 지점"))),
        h("div", { class: "row", style: "margin-top:var(--sp-2)" },
          ["A", "B"].map((w) => h("button", { class: "btn sm gray", type: "button", onclick: () => { const cur0 = w === "A" ? st.vsA : st.vsB, other = w === "A" ? st.vsB : st.vsA;
            const { BR } = App.state(), sib = BR.filter((y) => y.brand === BR[cur0].brand && regionOk(y.i) && y.i !== other).sort((p, q) => p.name.localeCompare(q.name, "ko"));
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
        box.append(h("div", { class: "card" }, cardHead(`'${cur().name}' 시술로 비교`, { count: `${its.length}개` }),
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
        statRow([["A가 더 쌈", win], ["같음", tie], ["B가 더 쌈", lose]]),
        h("button", { class: "btn sm gray", type: "button", style: "margin-top:var(--sp-2)", onclick: () => copyText([`[지점 비교] A ${bname(A)} vs B ${bname(B)} (${App.state().D.meta.updated} 기준)`,
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
            x.a !== x.b ? h("span", { class: "vwin" }, cheaperTxt(A, B, x.a, x.b)) : null, h("span", {}, App.state().D.meta.cats[x.cat])))), { first: 300 });
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
  });
})();
