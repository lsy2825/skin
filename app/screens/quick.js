// 빠른 비교 (#quick) · 저장한 비교 (#snap) — split from app.js (docs/APP_JS_SPLIT_PLAN.md 3-7): 비교함's 2~4 branches side by side on
// one treatment with what only that screen uses (pickBranchSheet, the 지점별 제공 시술 table coverageCard, the 비교 보고서 reportText ·
// reportView), and a saved comparison next to today's prices. Registers itself in App.screens like the other screen files; app.js
// installs every screen right before it starts, handing over the helpers it still owns (the shortlist shortList · SHORT_MAX, stamp,
// snapOfKey · saveSnap, checklistSheet, priceSheet, eligChips, cartLinesAt … — other screens use them too). Data that is replaced
// when new data arrives (D, BR, BK, KEYS, KI, ROWS, byKB, famOf) is read through App.state() when a screen is drawn, and again when
// something drawn earlier runs later (picking a branch, another treatment, 방문 전 체크리스트, 비교 보고서 and its 보관), never copied.
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  (App.screens = App.screens || []).push(() => {
    const { h, icon, won, store, toast, undoToast, copyText, emptyBox, cardHead, backBtn, views, fresh, verified, bdot, bname, nav, render,
      md, mdhm, vatNote, jomiEmpty, st, regionOk, bestAt, bkey, brSelect, cartLinesAt, cur, itemLabel, srcLink, switchEl, sheet,
      SHORT_MAX, addBtn, checklistSheet, eligChips, eligOf, favs, incTxt, newId, okL, priceSheet, saveSnap, shortList, snapOfKey, specOfKey,
      stamp } = App;
    // ---- 빠른 비교 (#quick): the 비교함 branches side by side on one treatment (the shortlist itself stays in app.js)
    function pickBranchSheet(title, except, done) {
      sheet(title, (close) => { let v = App.state().BR.find((x) => !except.includes(x.i) && regionOk(x.i))?.i ?? 0;
        return h("div", {}, brSelect(v, (x) => { v = x; }, "지점"), h("button", { class: "btn", type: "button", style: "width:100%;margin-top:var(--sp-3)", onclick: () => { if (except.includes(v)) { toast("이미 비교함에 있는 지점이에요"); return; } close(); done(v); } }, "고르기")); });
    }
    views.quick = (arg, params) => {
      const { BR, BK, KEYS, KI, ROWS, byKB, famOf } = App.state();   // read now: replaced when new data arrives
      const box = h("div", { class: "view" });
      box.append(backBtn());
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
      const go = (x) => { st.qk = x; history.replaceState(null, "", `#quick?k=${encodeURIComponent(App.state().KEYS[x].id)}`); render(); };
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
        h("div", { class: "row qact" }, h("button", { class: "btn sm gray", type: "button", onclick: () => { const { KEYS } = App.state(); checklistSheet({ id: `k:${KEYS[k].id}`, title: KEYS[k].label, k }); } }, icon("list-checks", "sm"), "방문 전 체크리스트"),
          h("button", { class: "btn sm gray", type: "button", onclick: () => saveSnap(snapOfKey(k, bs)) }, icon("bookmark", "sm"), "이 비교 저장"),
          h("button", { class: "btn sm gray", type: "button", onclick: () => reportView(k, bs) }, icon("file-text", "sm"), "비교 보고서"), addBtn(k))));
      box.append(coverageCard(bs));
      box.append(h("p", { class: "foot" }, `${vatNote()} 정품 여부·의료진·부작용은 병원에 확인하세요.`));
      return box;
    };

    // ---- 지점별 제공 시술 표 (coverage): the cart's items × the shortlist; '없음' and '확인 안 됨' are never counted as offered
    function coverageCard(bs) {
      const { BR } = App.state();
      const its = cur().items;
      if (!its.length || bs.length < 1) return h("div", { class: "card sub" }, "내 견적에 시술을 담으면, 고른 지점마다 어떤 시술을 하는지 한 표로 보여줘요.");
      const lines = bs.map((b) => cartLinesAt(b, its));
      const cell = (j, n) => { const l = lines[n][j], b = bs[n];
        return l ? h("td", { class: "num", title: l.incomplete ? incTxt(l) : null }, l.incomplete ? `1회 ${won(l.total)}만` : won(l.total)) : fresh(b).stale ? h("td", { class: "cov-q" }, "확인 안 됨") : h("td", { class: "cov-x" }, "없음"); };
      const tot = bs.map((b, n) => { const got = lines[n].filter(okL); return { b, sum: got.reduce((s, l) => s + l.total, 0), miss: its.length - got.length }; });
      return h("section", { class: "card flush", "aria-label": "지점별 제공 시술" },
        cardHead("지점별 제공 시술", { count: `${its.length}개`, desc: `'${cur().name}'의 시술 · 내 견적과 같은 계산(수량·첫 방문가 1개)` }),
        h("div", { class: "covwrap", tabindex: "0", role: "region", "aria-label": "지점별 제공 시술 표(옆으로 넘겨 보기)" }, h("table", { class: "cov" },
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "시술"), bs.map((b) => h("th", { scope: "col" }, BR[b].name)))),
          h("tbody", {}, its.map((it, j) => h("tr", {}, h("th", { scope: "row" }, `${itemLabel(it)} ×${it.q || 1}`), bs.map((_, n) => cell(j, n))))),
          h("tfoot", {}, h("tr", {}, h("th", { scope: "row" }, "있는 시술 합계"), tot.map((x) => h("td", { class: "num" }, won(x.sum), x.miss ? h("small", {}, ` · ${x.miss}개 없음`) : null)))))),
        h("p", { class: "tiny", style: "padding:var(--sp-2) 14px var(--sp-3)" }, "'없음' = 이번 주 그 지점 가격표에 같은 시술이 없어요. '확인 안 됨' = 그 지점 수집이 이번 주 실패했어요. 둘 다 0원으로 치지 않고 합계에서 뺐어요."));
    }

    // ---- 비교 보고서: chosen treatments (cart) or one treatment × the chosen branches, with conditions and the time it was made
    function reportText(k, bs) {
      const { D, KEYS, ROWS } = App.state();   // read now: the report is made when 비교 보고서 is pressed
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
          h("button", { class: "btn sm gray", type: "button", onclick: () => { const { D, KEYS } = App.state(); saveSnap({ id: newId(), at: rep.at, data: D.meta.updated, kind: "report", title: `보고서 · ${cur().items.length ? cur().name : KEYS[k].label}`, text: rep.text }); close(); } }, icon("bookmark", "sm"), "보관")),
        h("p", { class: "tiny", style: "margin-top:var(--sp-2)" }, "이 휴대폰에서 만든 글이에요. 서버로 보내지 않아요.")));
    }

    // ---- 저장한 비교 (#snap): a comparison saved by snapOfKey · saveSnap (app.js) next to today's prices
    views.snap = (arg) => {
      const { D, BK, KI, ROWS } = App.state();   // read now: replaced when new data arrives
      const box = h("div", { class: "view" });
      box.append(backBtn());
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
  });
})();
