// 피부 고민으로 찾기 · 죠미와 대화 (#concern) — split from app.js (docs/APP_JS_SPLIT_PLAN.md 3-3). Registers itself in App.screens
// like screens/ops.js and screens/about.js; app.js installs every screen right before it starts, handing over the helpers it
// still owns (the ones other screens use too: chatCtx — 홈's box reads with it as well —, kbVisible, kbSheet, reviewBadge …).
// Data that is replaced when new data arrives (D, CONC, KB, FAM, KEYS) is read through App.state() when it is used (an answer
// drawn, a button pressed), never copied.
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  (App.screens = App.screens || []).push(() => {
    const { h, fill, icon, won, views, FLAGS, kbOf, nav, kbSheet, reviewBadge, evidenceBadge, DISCLAIM, kbVisible, chatCtx, jomiImg,
      regionName, st, J, track } = App;
    let pendingChat = "";   // a message from the home box for 죠미와 대화 (memory only); 홈 hands it over with App.chatPending
    App.chatPending = (t) => { pendingChat = t; };
    // ---------------- 피부 고민으로 찾기 (app/domain/concern.js + knowledge/concerns.json), on this phone only
    // The typed words live in memory (the chat thread) for this visit: never in the URL, localStorage, recent searches or any
    // request. Every medical sentence on the page comes from the knowledge files; the page itself adds headings only.
    // It never diagnoses, judges suitability, decides doses, ranks treatments or names a clinic.
    const concernOf = (id) => App.state().CONC.concerns.find((c) => c.id === id);
    const concernVisible = (c) => !!c && ((c.review || {}).status === "approved" || FLAGS.showDraftKnowledge);
    const kbById = (id) => { const e = App.state().KB.entries.find((x) => x.id === id); return kbVisible(e) ? e : null; };
    const famsOfEntry = (e) => App.state().FAM.filter((f) => kbOf(f) === e).sort((a, b) => b.n - a.n);
    const draftTag = (o) => { const r = o.review || {}; return r.status === "approved" ? h("span", { class: "k k1" }, `의료진 검수 ${r.reviewed_at}`) : null; };
    function concernCard(c, m) {
      const es = c.treatments.map(kbById).filter(Boolean);
      const sec = (n, t, ...kids) => h("section", { class: "csec" }, h("h4", {}, `${n}. ${t}`), ...kids);
      return h("div", { class: "card concern" },
        h("div", { class: "row" }, h("h3", { style: "margin:0" }, c.name), h("span", { class: "sp" }), draftTag(c)),
        m.hits && m.hits.length ? h("div", { class: "sub" }, `적은 말에서 찾은 낱말: ${m.hits.join(", ")}`) : null,
        sec(1, "고민에 대한 일반적인 설명", h("p", {}, c.general)),
        sec(2, "관련 시술과 시술 말고 할 수 있는 관리",
          h("div", { class: "flabel" }, "시술 말고 할 수 있는 관리"), h("ul", { class: "notes" }, c.non_procedural.map((x) => h("li", {}, x))),
          h("div", { class: "flabel", style: "margin-top:var(--sp-2)" }, "관련 시술"),
          h("div", { class: "sub" }, es.length ? es.map((e) => e.title).join(" · ") : "보여드릴 수 있는 시술 설명이 아직 없어요(검수 전)."),
          h("p", { class: "tiny" }, "순서는 분류표에 적힌 순서예요. 추천 순위나 효과 순위가 아니에요.")),
        es.length ? sec(3, "시술별 목적과 차이", h("div", { class: "ttable", role: "table", "aria-label": `${c.name} 관련 시술 비교` },
          h("div", { class: "tr th", role: "row" }, h("span", { role: "columnheader" }, "시술"), h("span", { role: "columnheader" }, "주로 받는 이유"), h("span", { role: "columnheader" }, "방식·비슷한 시술과 차이")),
          es.map((e) => h("div", { class: "tr", role: "row" }, h("span", { role: "cell" }, h("b", {}, e.title)), h("span", { role: "cell" }, e.purpose), h("span", { role: "cell" }, e.method || e.one_liner))))) : null,
        es.length ? sec(4, "확인해야 할 위험과 한계", es.map((e) => h("div", { class: "crisk" },
          h("div", { class: "row", style: "gap:var(--sp-1)" }, h("b", {}, e.title), h("span", { class: "sp" }), reviewBadge(e), evidenceBadge(e)),
          e.side_effects.length ? h("div", { class: "sub" }, "주요 부작용: " + e.side_effects.slice(0, 3).join(" / ")) : null,
          e.limitations.length ? h("div", { class: "sub" }, "한계: " + e.limitations.join(" / ")) : h("div", { class: "sub" }, "한계: 정리 안 됨"),
          e.cautions.length ? h("div", { class: "sub" }, "주의: " + e.cautions.slice(0, 2).join(" / ")) : null))) : null,
        es.length ? sec(5, "관련 시술 자세히 보기", h("div", { class: "chips wrapc" },
          es.map((e) => h("button", { class: "chip", type: "button", onclick: () => kbSheet(e, famsOfEntry(e)[0] || null) }, icon("info", "sm"), e.title)))) : null,
        es.length && FLAGS.concernPriceLink ? sec(6, "직접 골라서 가격 비교하기",
          h("div", { class: "chips wrapc" }, es.flatMap((e) => famsOfEntry(e).slice(0, 4).map((f) =>
            h("button", { class: "chip", type: "button", onclick: () => nav(`compare?k=${App.state().KEYS[f.main].id}`) }, `${f.name} 가격`, icon("chevron-right", "sm"))))),
          h("p", { class: "tiny" }, "가격 비교는 이 고민 정보와 따로 계산해요. 같은 조건(용량·회차)끼리 싼 순으로 보여주고, 광고·협찬으로 순서가 바뀌지 않으며 특정 병원을 추천하지 않아요. 예약·결제·개인정보 전달 기능은 없어요.")) : null,
        h("div", { class: "csrc" },
          h("div", { class: "tiny" }, "고민 설명 근거: ", c.sources.length ? c.sources.flatMap((x, i) => [i ? ", " : "", h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.publisher)]) : "근거 자료 미정리"),
          h("p", { class: "tiny" }, "설명은 미리 정리해 둔 문장만 보여줘요(앱이 새로 지어낸 의학 문장은 없어요). 지금은 모두 의료진 검수 전 초안이에요. " + DISCLAIM)));
    }
    // ---------------- 죠미와 대화 (domain/jomichat.js): treatment names, prices by spec · region · brand, two treatments, app help,
    // concerns and follow-ups ('그럼 4cc는?'). The thread lives in memory for this visit only (never the URL, storage or a request);
    // medical sentences come only from the knowledge files, prices only from the collected data. 2026-10-15: the old screen knew
    // concern words only (17.7% of the evaluation set understood) and kept the sent text in the box.
    const mascotImg = (size, expr = "curious") => jomiImg(expr, "face", size);
    let chatTurns = [], chatMemo = null;
    const whereText = (w) => [w.brand, w.region, w.area ? `${w.area} 근처` : ""].filter(Boolean).join(" · ") || regionName();
    function priceLine(p, w) {
      const { D } = App.state();   // read now: these are replaced when new data arrives
      if (!p || !p.n) return h("p", { class: "sub" }, `${whereText(w)}에서는 모은 가격이 없어요. 지역이나 브랜드를 바꿔 물어봐 줘.`);
      return h("div", { class: "cprice" },
        h("div", { class: "row", style: "gap:var(--sp-3);flex-wrap:wrap" }, h("span", {}, "최저 ", h("b", { class: "num" }, won(p.min))), h("span", {}, "중간 ", h("b", { class: "num" }, won(p.med))),
          h("span", { class: "sub" }, `최고 ${won(p.max)}`)),
        h("div", { class: "tiny" }, `${whereText(w)} · ${p.n}곳의 지점별 최저가 · ${st.vat === "incl" ? "부가세 포함 예상" : "병원 표시가"} · ${D.meta.updated} 모음. 병원에 꼭 확인하세요.`));
    }
    function famAnswer(r, f, key, p) {
      const e = kbOf(f.src), ks = f.keys.filter((k) => k.id !== key.id).slice(0, 6);
      const tq = (w) => { const np = new URLSearchParams({ q: f.name, sort: "price" }); if (w.region) np.set("reg", w.region); if (w.area) np.set("area", w.area); if (w.brand) np.set("brand", App.state().D.meta.brands.findIndex((b) => b[0] === w.brand)); return `table?${np}`; };
      return h("div", { class: "card cans" },
        h("div", { class: "row" }, h("h3", { style: "margin:0" }, key.label), h("span", { class: "sp" }), h("span", { class: "sub" }, `${f.n}곳에서 팔아요`)),
        r.spec && !r.specHonored ? h("p", { class: "tiny" }, `'${r.spec}' 묶음은 없어서 가장 많이 파는 규격으로 보여줘요.`) : null,
        priceLine(p, r.where),
        e ? h("p", { style: "margin:var(--sp-2) 0 0" }, `${e.one_liner} ${e.purpose}`) : null,
        e ? h("div", { class: "row", style: "gap:var(--sp-1);margin-top:var(--sp-2)" }, reviewBadge(e), h("button", { class: "linkbtn", type: "button", onclick: () => kbSheet(e, f.src) }, "부작용·주의사항 보기")) : null,
        h("div", { class: "row", style: "margin-top:var(--sp-2);flex-wrap:wrap" },
          h("button", { class: "btn sm", type: "button", onclick: () => nav(`compare?k=${key.id}`) }, icon("chart-column", "sm"), "지점별 가격 비교"),
          Object.keys(r.where).length ? h("button", { class: "btn sm soft", type: "button", onclick: () => nav(tq(r.where)) }, `${whereText(r.where)} 가격표`) : null),
        ks.length ? h("div", { style: "margin-top:var(--sp-2)" }, h("div", { class: "tiny" }, "다른 규격도 물어볼 수 있어요"),
          h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" }, ks.map((k) => h("button", { class: "chip", type: "button", onclick: () => chatSend(`${k.label} 얼마야`) }, k.label)))) : null);
    }
    function chatAnswer(r) {
      const { CONC } = App.state();   // read now: these are replaced when new data arrives
      const parts = [];
      let face = "happy";
      for (const x of r.safety) parts.push(h("div", { class: `card ${x.level === "emergency" ? "calert" : "cwarn"}`, role: "alert" }, h("h3", {}, icon("triangle-alert", "sm"), x.title), h("p", {}, x.message)));
      if (r.kind === "safety") return { face: "worried", parts };
      if (r.personal) parts.push(h("div", { class: "card note" }, h("b", {}, "개인 맞춤 판단은 하지 않아요"), h("p", { style: "margin:var(--sp-2) 0 0" }, (CONC.safety && CONC.safety.personal.message) || "나에게 맞는 시술·용량은 진찰한 의료진만 정해요.")));
      if (r.guess) parts.push(h("p", { class: "jomi-line" }, `혹시 '${r.fams[0].name}' 말하는 거야? (${r.guess.join(", ")})`));
      if (r.kind === "help" || r.kind === "chit") {
        parts.push(h("p", {}, r.say));
        if (r.go) parts.push(h("button", { class: "btn sm soft", type: "button", onclick: () => nav(r.go[0]) }, r.go[1], icon("chevron-right", "sm")));
        return { face: r.kind === "chit" ? "happy" : "explaining", parts };
      }
      if (r.kind === "compare2") {
        parts.push(h("p", { class: "jomi-line" }, "두 시술을 나란히 놓아 볼게. 어느 쪽이 맞는지는 의료진과 정해."));
        r.prices.forEach(({ key, price }, n) => parts.push(famAnswer({ ...r, spec: "", where: r.where }, r.fams[n], key, price)));
        return { face: "explaining", parts };
      }
      if (r.kind === "concern") {
        const cs = r.concerns.map((m) => [concernOf(m.id), m]).filter(([c]) => concernVisible(c));
        if (cs.length) parts.push(h("p", { class: "jomi-line" }, J.lines.concernFound || "적은 말과 관련된 고민 정보야."));
        for (const [c, m] of cs) parts.push(concernCard(c, m));
        if (r.fams.length) parts.push(h("div", { class: "chips wrapc" }, r.fams.map((f) => h("button", { class: "chip", type: "button", onclick: () => chatSend(`${f.name} 가격`) }, `${f.name} 가격`))));
        return { face: "thinking", parts };
      }
      if (r.kind === "treatment" || r.kind === "price") {
        const f = r.fams[0];
        if (r.followUp) parts.push(h("p", { class: "jomi-line" }, `앞에서 말한 ${f.name} 기준이야.`));
        parts.push(famAnswer(r, f, r.key, r.price));
        if (r.fams.length > 1) parts.push(h("div", {}, h("div", { class: "tiny" }, "이름이 비슷한 시술"), h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" },
          r.fams.slice(1).map((x) => h("button", { class: "chip", type: "button", onclick: () => chatSend(x.name) }, x.name)))));
        if (r.concerns.length) parts.push(h("div", { class: "row", style: "flex-wrap:wrap" }, h("span", { class: "tiny" }, "관련 고민:"),
          r.concerns.map((m) => concernOf(m.id)).filter(concernVisible).map((c) => h("button", { class: "linkbtn", type: "button", onclick: () => chatSend(c.name) }, c.name))));
        return { face: "happy", parts };
      }
      face = "empty";
      parts.push(h("p", {}, "음… 그 말은 아직 잘 모르겠어. 시술 이름이나 '리쥬란 2cc 얼마야', '강남 슈링크', '이마 주름'처럼 적어 줘."));
      if (r.suggestions.length) parts.push(h("div", {}, h("div", { class: "tiny" }, "이걸 찾았어?"), h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" },
        r.suggestions.map((n) => h("button", { class: "chip", type: "button", onclick: () => chatSend(n) }, n)))));
      return { face, parts };
    }
    let chatSend = () => {};
    views.concern = (arg, params) => {
      const { CONC } = App.state();   // read now: these are replaced when new data arrives
      const box = h("div", { class: "view" });
      box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
      if (!FLAGS.concernSearch) { box.append(h("div", { class: "card empty" }, "죠미와 대화는 지금 꺼져 있어요.")); return box; }
      if (!chatMemo) chatMemo = JomiChat.memory();
      const picked = params.get("c");   // a concern id from a chip or the search page — never the typed words
      const ta = h("textarea", { rows: "1", maxlength: String(JomiChat.MAX_LEN), placeholder: "예: 카프리 레이저 얼마야? · 이마 주름이 신경 쓰여요", "aria-label": "죠미에게 말하기", enterkeyhint: "send" });
      const grow = () => { ta.style.height = "auto"; ta.style.height = `${Math.min(132, ta.scrollHeight)}px`; };
      ta.addEventListener("input", grow);
      const thread = h("div", { class: "chat", "aria-live": "polite" });
      const visible = CONC.concerns.filter(concernVisible);
      const ex = ["카프리 레이저", "리쥬란 2cc 얼마야", "강남 슈링크 제일 싼 곳", "슈링크랑 울쎄라 차이", "부가세 포함이야?"];
      const intro = h("div", { class: "msg bot" }, mascotImg(32), h("div", { class: "bub" },
        h("p", {}, "안녕, 나는 죠미야! 시술 이름, 가격(용량·횟수·지역), 피부 고민, 앱 쓰는 법을 물어봐 줘."),
        h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" }, ex.map((t) => h("button", { class: "chip", type: "button", onclick: () => chatSend(t) }, t))),
        h("p", { class: "tiny" }, "진단이나 상담이 아니고 어떤 시술이 맞는지 정하거나 권하지 않아요. 생성형 AI가 아니라 규칙으로 알아듣고, 가격은 모은 가격, 의학 설명은 지식 파일의 문장만 보여줘요."),
        visible.length ? h("details", { class: "fold small", style: "margin-top:var(--sp-2)" }, h("summary", {}, "피부 고민 고르기"),
          h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" }, visible.map((c) => h("button", { class: "chip", type: "button", "aria-pressed": picked === c.id ? "true" : "false", onclick: () => chatSend(c.name) }, c.name)))) : null));
      const paint = () => {
        const kids = [intro];
        for (const t of chatTurns) {
          kids.push(h("div", { class: "msg user" }, h("div", { class: "bub" }, t.q)));
          const a = chatAnswer(t.r);
          kids.push(h("div", { class: "msg bot" }, mascotImg(32, a.face), h("div", { class: "cout answers" }, a.parts)));
        }
        fill(thread, kids);
      };
      chatSend = (text) => {
        const q = String(text || "").trim().slice(0, JomiChat.MAX_LEN);
        if (!q) return;
        const r = JomiChat.understand(q, chatCtx(), chatMemo);
        chatTurns.push({ q, r });
        if (chatTurns.length > 30) chatTurns = chatTurns.slice(-30);
        track("jomi_chat", { kind: r.kind });     // the kind only — never the words
        ta.value = ""; grow();                     // the sent words leave the box (they stay in the thread above)
        paint();
        const last = thread.lastElementChild;
        if (last) last.scrollIntoView({ block: "start", behavior: "smooth" });
      };
      const send = () => { const v = ta.value; chatSend(v); ta.focus({ preventScroll: true }); };
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
      box.append(h("div", { class: "cg-head", style: "padding:0" }, mascotImg(44), h("div", { style: "min-width:0" }, h("h2", {}, "죠미와 대화"),
        h("span", { class: "infotag" }, icon("info", "xs"), "시술·가격·고민 안내 · 진단·의료 상담 아님")),
        chatTurns.length ? h("button", { class: "linkbtn", type: "button", style: "margin-left:auto", onclick: () => { chatTurns = []; chatMemo = JomiChat.memory(); paint(); } }, "대화 지우기") : null));
      box.append(thread);
      box.append(h("div", { class: "composer" }, h("div", { class: "crow" }, ta, h("button", { class: "btn send", type: "button", onclick: send }, icon("send", "sm"), "보내기")),
        h("div", { class: "meta" }, icon("lock", "xs"), `이 화면에만 있어요 · 저장·전송하지 않아요 · ${JomiChat.MAX_LEN}자까지`)));
      paint();
      if (pendingChat) { const t = pendingChat; pendingChat = ""; setTimeout(() => chatSend(t), 0); }
      else if (picked && concernOf(picked)) setTimeout(() => chatSend(concernOf(picked).name), 0);
      setTimeout(grow, 0);
      return box;
    };
  });
})();
