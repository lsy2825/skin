// 내정보 (#me) — split from app.js (docs/APP_JS_SPLIT_PLAN.md 3-6): the screen (profile, records, visited branches, menu, 내 설정,
// 데이터 안내, 지점 전체 목록, 계정) and the profile sheets only it opens (nickSheet, profileSheet, saveMe). Registers itself in
// App.screens like the other screen files; app.js installs every screen right before it starts, handing over the helpers it still
// owns (the visit records and the account sync — recordSheet, sortRecs, brLabel, auth, onAccount: 지점 상세·내 견적·sign-in use
// them too — and the settings' helpers: applyTheme, applyVat, applyMotion, regionSelect, metricsOff …). Data that is replaced when
// new data arrives (D, BR, BK, WHEN_COL) is read through App.state() when the screen is drawn, never copied.
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  (App.screens = App.screens || []).push(() => {
    const { h, fill, icon, won, km, store, toast, undoToast, emptyBox, PERSONAL, views, bdot, bname, nav, render, adminHost, md, vatNote,
      branchCountText, privacyParts, jprefs, hereLink, regionName, st, dist, regionOk, recordSheet, statRow, switchEl,
      anOn, applyMotion, applyTheme, applyVat, auth, brLabel, eventsSheet, HIST_KEYS, histOn, keptFold, metrics, metricsOff, onAccount,
      privacyLink, regionCount, regionSelect, setMetricsOffMem, sheet, sortRecs, vatBrandsNote } = App;
    // ---------------- 내정보
    const GENDERS = ["여성", "남성", "선택 안 함"];
    const AGES = ["10대", "20대 초반", "20대 후반", "30대 초반", "30대 후반", "40대", "50대", "60대 이상"];
    const PROVIDER_L = { kakao: "카카오", google: "Google", apple: "Apple" };
    function saveMe() {
      store.set("me", st.me);
      const A = auth();
      if (A && A.user) A.saveProfile(st.me, A.user.id).catch(() => toast("계정에 저장하지 못했어요(이 휴대폰에는 저장됨)"));
    }
    function nickSheet() {
      sheet("닉네임 바꾸기", (close) => {
        const inp = h("input", { class: "field", value: st.me.nick || "", maxlength: "20", placeholder: "예: 피부요정", "aria-label": "새 닉네임", autocomplete: "nickname" });
        const err = h("div", { class: "ferr", role: "alert", hidden: true }, "닉네임을 1~20자로 적어 주세요");
        const count = h("span", { class: "sub" }, `${(st.me.nick || "").length}/20`);
        inp.addEventListener("input", () => { count.textContent = `${inp.value.length}/20`; err.hidden = true; inp.setAttribute("aria-invalid", "false"); });
        const ok = () => { const v = inp.value.trim(); if (!v) { err.hidden = false; inp.setAttribute("aria-invalid", "true"); inp.focus(); return; }
          const before = st.me.nick; st.me = { ...st.me, nick: v.slice(0, 20) }; saveMe(); close(); render();
          undoToast(`닉네임을 '${st.me.nick}'(으)로 바꿨어요`, () => { st.me = { ...st.me, nick: before || "" }; saveMe(); render(); }); };
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } });   // preventDefault: the same Enter must not also press the button focus returns to
        return h("div", {}, h("label", { class: "flabel" }, h("span", { class: "row" }, "새 닉네임", h("span", { class: "sp" }), count), inp), err,
          h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "이 휴대폰에만 저장돼요(로그인을 켜면 계정에도 저장)."),
          h("button", { class: "btn", type: "button", style: "width:100%;margin-top:var(--sp-3)", onclick: ok }, "저장"));
      });
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
          h("button", { class: "btn", type: "button", style: "width:100%;margin-top:var(--sp-3)", onclick: () => { st.me = { nick: nick.value.trim().slice(0, 20), gender: s.gender || "", age: s.age || "" }; saveMe(); close(); render(); toast("저장했어요"); } }, "저장"));
        paint();
        return box;
      });
    }

    views.me = () => {
      const { D, BR, BK, WHEN_COL } = App.state();   // read now: replaced when new data arrives
      const box = h("div", { class: "view" });
      const me = st.me, A = auth();
      sortRecs();
      const spent = st.recs.reduce((s, x) => s + (x.p || 0), 0);
      const visits = new Map();
      for (const r of st.recs) { const v = visits.get(r.br) || { n: 0, last: "", sum: 0 }; v.n++; v.sum += r.p || 0; if ((r.date || "") > v.last) v.last = r.date; visits.set(r.br, v); }
      // profile
      box.append(h("div", { class: "card" },
        h("div", { class: "row", style: "flex-wrap:nowrap;gap:var(--sp-3)" }, h("div", { class: "avatar", "aria-hidden": "true" }, me.nick ? me.nick.slice(0, 1) : icon("user")),
          h("div", { style: "min-width:0" }, h("h2", {}, me.nick || "닉네임을 정해 주세요"),
            h("div", { class: "sub" }, [me.gender, me.age].filter((x) => x && x !== "선택 안 함").join(" · ") || "성별·나이 미입력")),
        ),
        h("div", { class: "row", style: "margin-top:var(--sp-2)" },
          h("button", { class: "btn sm gray", type: "button", onclick: nickSheet }, "닉네임 바꾸기"), h("button", { class: "btn sm gray", type: "button", onclick: profileSheet }, "성별·나이 입력")),
        statRow([["받은 시술", st.recs.length], ["쓴 돈(원)", spent >= 10000 ? `${Math.round(spent / 1000) / 10}만` : spent.toLocaleString()], ["다닌 지점", visits.size]]),
        A ? (A.user
          ? h("div", { class: "row", style: "margin-top:var(--sp-3)" }, h("span", { class: "sub" }, `${PROVIDER_L[A.providerName(A.user)] || "소셜"} 계정으로 로그인됨 · 기록이 계정에 저장돼요`), h("span", { class: "sp" }),
            h("button", { class: "btn sm gray", type: "button", onclick: async () => { await A.signOut(); render(); } }, "로그아웃"))
          : h("div", { style: "margin-top:var(--sp-3)" }, h("div", { class: "sub", style: "margin-bottom:var(--sp-2)" }, "로그인하면 휴대폰을 바꿔도 기록이 남아요"),
            h("div", { class: "row" }, A.providers.map((pv) => h("button", { class: `btn sm login-${pv}`, type: "button", onclick: () => A.signIn(pv).catch(() => toast("로그인하지 못했어요")) },
              `${PROVIDER_L[pv]}로 시작하기`)))))
          // demo: login is not connected — say so, list what is prepared, offer no button that pretends to work
          : h("div", { class: "acctprep" }, h("div", { class: "row" }, icon("lock", "sm"), h("b", {}, "계정 연결은 정식 출시 때 열려요")),
            h("p", { class: "sub" }, "지금은 시연 단계라 로그인·회원가입·약관 동의가 없어요. 기록·내 견적·관심은 이 휴대폰에만 저장돼요."))));
      // records
      box.append(h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "최근 받은 시술"), h("span", { class: "sp" }),
        h("button", { class: "btn sm gray", type: "button", onclick: () => recordSheet(null) }, icon("plus", "sm"), "기록하기")),
        st.recs.length ? h("ul", { class: "list" }, st.recs.slice(0, st.allRecs ? 500 : 8).map((r) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => recordSheet(r) },
          h("span", { class: "t" }, r.n), h("span", { class: "p num" }, r.p ? won(r.p) : "-"),
          h("span", { class: "m" }, h("span", {}, r.date), h("span", {}, brLabel(r.br) || "지점 미입력"), r.memo ? h("span", {}, r.memo) : null)))))
          : emptyBox("receipt", "아직 기록이 없어요", "받은 시술을 기록하면 언제·어디서·얼마에 받았는지 한눈에 볼 수 있어요. 내 견적에서 '받았어요'를 눌러도 기록돼요."),
        st.recs.length > 8 ? h("button", { class: "morelist", type: "button", onclick: () => { st.allRecs = !st.allRecs; render(); } }, st.allRecs ? "접기" : `전체 ${st.recs.length}개 보기`) : null));
      // visited branches
      if (visits.size) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, "방문한 지점")),
        h("ul", { class: "list" }, [...visits.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last)).map(([br, v]) => { const b = BK.get(br);
          return h("li", {}, h("button", { class: "item", type: "button", onclick: () => { if (b != null) nav(`branch/${b}`); } },
            h("span", { class: "t row" }, b != null ? bdot(b) : null, brLabel(br) || "지점 미입력"), h("span", { class: "p num" }, `${v.n}회`),
            h("span", { class: "m" }, h("span", {}, `마지막 ${v.last}`), v.sum ? h("span", {}, `합계 ${won(v.sum)}`) : null, b == null ? h("span", {}, "앱 목록에 없는 곳") : null))); }))));
      // more pages ('개인정보 처리방침' only while 익명 집계 or 푸시 is set up — #privacy)
      box.append(h("div", { class: "card flush menu" }, h("ul", { class: "list" }, [["saved", "heart", "관심·가격 알림", "관심 시술·지점, 알림, 최근 본 것"], ["guide", "book-open", "시술 사전", "헷갈리는 시술 종류와 차이를 쉽게"], ["table", "table", "전체 가격표", "모든 지점·모든 가격을 조건으로 찾기"], ["change", "trending-down", "가격 변동", "지난번보다 오르내린 가격"], ["data", "database", "데이터 상태·앱 설치", "언제·어디서 모았나, 비교 기준, 설치"], ["privacy", "lock", "개인정보 처리방침", privacyParts().map((x) => x.title).join(" · ")], ["ops", "shield", "운영 현황", "수집 상태·신선도·검토 큐·출처 정책"]].filter(([v]) => (v !== "ops" || adminHost()) && (v !== "privacy" || privacyParts().length)).map(([v, ic, l, s]) =>
        h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(v) }, h("span", { class: "t" }, h("span", { class: "mi" }, icon(ic, "sm")), h("span", {}, h("span", { style: "display:block" }, l), h("span", { class: "sub fw-reg", style: "display:block" }, s))), icon("chevron-right", "sm")))))));
      // ---- 내 설정 (what this phone shows) — separate from the data information below
      const theme = store.get("theme", "auto");
      const radios = (label, opts, curV, set) => h("div", { class: "seg setseg", role: "radiogroup", "aria-label": label }, opts.map(([v, l]) =>
        h("button", { type: "button", role: "radio", "aria-checked": curV === v ? "true" : "false", onclick: () => set(v) }, l)));
      // one line per setting — '이름 · 지금: 값' — that opens to its controls (hierarchy audit 49, L15); a row stays open after a
      // change redraws the screen (keptFold), so the new value shows where it was picked
      const setRow = (id, name, now, ...body) => keptFold(`set:${id}`, "setrow", h("summary", { class: "flabel" }, h("span", {}, name), h("b", { class: "now" }, now)), h("div", { class: "setbody" }, ...body));
      box.append(h("div", { class: "card settings" }, h("h2", { class: "t-sec" }, "내 설정"), h("div", { class: "sub" }, "이 휴대폰에서 보이는 방식을 바꿔요."),
        setRow("vat", "가격 표시", st.vat === "incl" ? "지금: 부가세 포함가" : "지금: 병원 표시가",
          radios("가격 표시", [["incl", "부가세 포함가"], ["listed", "병원 표시가"]], st.vat, (v) => { st.vat = v; store.set("vat", v); applyVat(); render(); toast(v === "incl" ? "부가세 포함가로 보여요" : "병원이 적은 가격 그대로 보여요"); }),
          h("div", { class: "sub" }, st.vat === "incl" ? `병원이 '부가세 별도'라고 적은 가격에 10%를 더해 보여줘요. ${vatBrandsNote()}` : "병원 사이트에 적힌 숫자 그대로예요. 실제 결제는 부가세 10%가 더해질 수 있어요.")),
        setRow("theme", "화면 테마", `지금: ${{ auto: "기기 설정 따름", light: "밝게", dark: "어둡게" }[theme]}`,
          radios("화면 테마", [["auto", "기기 설정"], ["light", "밝게"], ["dark", "어둡게"]], theme, (t) => { store.set("theme", t); applyTheme(); render(); })),
        setRow("region", "지역", `지금: ${regionName()} ${regionCount()}곳`,
          regionSelect(), h("div", { class: "sub" }, "고르면 비교·내 견적·검색에 이 지역 지점만 보여요.")),
        (() => { const P = jprefs(), set = (k, v) => { store.set("jomiPrefs", { ...P, [k]: v }); applyMotion(); render(); };
          return setRow("jomi", "죠미 설정", `지금: 안내 ${{ often: "자주", some: "가끔", off: "끄기" }[P.freq]} · 움직임 ${{ auto: "기기 설정", on: "켜기", off: "끄기" }[P.motion]} · 설명 ${{ short: "간략", long: "상세" }[P.detail]}`,
            h("div", { class: "sub", style: "margin:var(--sp-2) 0" }, "안내 빈도 — '가끔'은 홈 인사·사전 한마디를 줄이고, '끄기'는 죠미 얼굴 없이 글로만 알려줘요."),
            radios("죠미 안내 빈도", [["often", "자주"], ["some", "가끔"], ["off", "끄기"]], P.freq, (v) => set("freq", v)),
            h("div", { class: "sub", style: "margin:var(--sp-2) 0" }, "움직임 — '기기 설정'은 휴대폰의 '동작 줄이기'를 따라요."),
            radios("움직임", [["auto", "기기 설정"], ["on", "켜기"], ["off", "끄기"]], P.motion, (v) => set("motion", v)),
            h("div", { class: "sub", style: "margin:var(--sp-2) 0" }, "용어 설명"),
            radios("설명 길이", [["short", "간략"], ["long", "상세"]], P.detail, (v) => set("detail", v))); })(),
        setRow("hist", "보기 기록", histOn() ? "지금: 남김" : "지금: 남기지 않음",
          switchEl("최근 본 것·최근 검색·이어서 보기 기록 남기기", histOn(), (v) => { store.set("histOff", !v); render(); toast(v ? "다시 기록해요" : "이제 기록하지 않아요(이미 있는 기록은 그대로)"); }),
          switchEl("사용 통계 남기기 (이 휴대폰에만 · 시연)", anOn(), (v) => { store.set("analytics", v ? "on" : "off"); render(); toast(v ? "이 휴대폰에만 사용 통계를 남겨요(서버로 보내지 않아요)" : "사용 통계를 남기지 않아요(이미 있는 기록은 '보기'에서 지울 수 있어요)"); }),
          hereLink("list", "사용 통계 보기·지우기", () => eventsSheet()),
          h("div", { class: "row", style: "margin-top:var(--sp-2)" }, h("button", { class: "btn sm gray", type: "button", onclick: () => {
            const before = Object.fromEntries(HIST_KEYS.map((k) => [k, store.get(k, null)]));
            for (const k of HIST_KEYS) { try { localStorage.removeItem("pc:" + k); } catch (e) { /* storage unavailable */ } }
            try { localStorage.removeItem("pc:lastTable"); } catch (e) { /* an older version's key */ }
            render(); undoToast("보기 기록을 지웠어요", () => { for (const [k, v] of Object.entries(before)) if (v != null) store.set(k, v); render(); }); } }, "기록 지우기")),
          h("div", { class: "sub" }, "이 휴대폰에만 있어요(서버로 보내지 않아요). 내 견적·관심·알림은 지우지 않아요.")),
        // 단계별 익명 집계(B5, user decision 2026-10-15: a switch, on by default). Its own row: unlike the one above it does go to
        // a server. Shown only when it is set up (config.js). Off = nothing new stored or sent from this phone; the day's one
        // record stays, so switching back on the same day does not count the phone twice.
        metrics.available ? setRow("metrics", "익명 이용 집계", metricsOff() ? "지금: 보내지 않음" : "지금: 보냄",
          // the switch's name, the 'off' toast and the line under it: §4 '집계 칸' (docs/legal/PRIVACY_POLICY_DRAFT.md, chat C, 2026-10-16)
          switchEl("익명 이용 집계 보내기 (단계 이름만 · 단계마다 하루 한 번)", !metricsOff(), (v) => {
            store.set("metricsOff", !v);
            const kept = store.get("metricsOff", null) === !v;   // false: storage blocked or full — memory only
            setMetricsOffMem(!v);
            render(); toast(v ? "익명 이용 집계를 보내요" : kept ? "이제 이 브라우저에서는 집계를 보내지 않아요" : "이 화면을 닫기 전까지 집계를 보내지 않아요(설정을 저장하지 못했어요)"); }),
          h("div", { class: "sub" }, "앱을 쓴 단계 이름만, 단계마다 하루 한 번 서버로 보내요(기기·위치·검색어는 보내지 않아요). 끄면 이 브라우저에서는 보내지 않아요(앱 데이터를 지우면 다시 켜져요)."),
          privacyLink()) : null,
        h("div", { class: "row", style: "margin-top:var(--sp-3)" }, h("button", { class: "btn sm gray", type: "button", onclick: () => window.lockApp && window.lockApp() }, "지금 잠그기"),
          h("button", { class: "btn sm gray", type: "button", onclick: () => { store.set("brands", null); store.set("special", true); location.reload(); } }, "설정 초기화"))));
      // ---- 데이터 안내 (information, not settings)
      const counts = D.meta.brands.map((_, i) => [BR.filter((b) => b.brand === i).length, D.rows.filter((r) => BR[r[0]].brand === i).length]);
      box.append(h("div", { class: "card info" }, h("h2", { class: "t-sec" }, "데이터 안내"),
        h("dl", { class: "kv", style: "margin-top:var(--sp-2)" }, h("dt", {}, "수집일"), h("dd", {}, `${md(D.meta.updated)} (매주 월요일 자동 갱신)`),
          h("dt", {}, "지점"), h("dd", {}, branchCountText()), h("dt", {}, "가격 수"), h("dd", {}, `${D.meta.rows.toLocaleString()}개 (전국)`)),
        h("ul", { class: "list", style: "margin-top:var(--sp-2)" }, D.meta.brands.map((b, i) => !counts[i][0] ? null : h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "dot bdot", style: `background:${b[1]}` }), b[0]),
          h("span", { class: "sub" }, `${counts[i][0]}곳 · ${counts[i][1].toLocaleString()}개`), h("span", { class: "m" }, b[2]))))),
        // how to read the prices: the same sentences, one per line — the first two in view, the rest under '자세히' (hierarchy audit 49)
        (() => { const pts = ["체험가·한정가는 보통 1인 1회예요. 일반가와 특가는 따로 보여줘요.",
          `'${Pricing.condLabel("평일 낮")}'(평일 낮·화수목·평일 해피아워 등), '${Pricing.condLabel("시간대")}'(점심·해피아워 등), '일요일'${WHEN_COL ? `·'${Pricing.whenBadge(32, 0)}'` : ""} 같은 표시는 그 요일·시간에만 되는 가격이에요.`, vatNote(),
          "종료일이 지난 이벤트, 지난 수집보다 90% 넘게 내리거나 10배 넘게 오른 가격(확인 중)은 비교에서 빠져요. 가격마다 ⓘ(가격 정보)로 조건과 병원 페이지를 볼 수 있어요.",
          "병원 사이트 표기 오류(정가가 판매가보다 낮거나 10배 넘는 값)는 정가를 지웠고, 안내 문구·서류 발급비는 뺐어요."];
          return h("div", { class: "note datanote", style: "margin-top:var(--sp-2)" }, h("ul", { class: "dots" }, pts.slice(0, 2).map((x) => h("li", {}, x))),
            keptFold("meData", "minifold", h("summary", {}, `자세히 · ${pts.length - 2}개 더`), h("ul", { class: "dots" }, pts.slice(2).map((x) => h("li", {}, x))))); })(),
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "지도 © OpenStreetMap 기여자. 가격 출처는 각 병원 홈페이지예요.")));
      const shown = BR.filter((b) => regionOk(b.i));
      box.append(h("details", { class: "card flush fold" }, h("summary", {}, `지점 전체 목록 · ${regionName()} ${shown.length}곳`),
        h("ul", { class: "list" }, shown.sort((a, b) => a.brand - b.brand || a.name.localeCompare(b.name, "ko")).map((b) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`branch/${b.i}`) },
          h("span", { class: "t row" }, bdot(b.i), bname(b.i)), h("span", { class: "sub" }, dist(b.i) != null ? km(dist(b.i)) : b.region), h("span", { class: "m" }, b.addr)))))));
      if (A && A.user) box.append(h("div", { class: "card" }, h("h3", {}, "계정"),
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "탈퇴하면 계정의 프로필·기록·내 견적·관심·알림이 바로 지워져요. 이 휴대폰에 남은 이 계정의 기록도 함께 지워요."),
        h("button", { class: "btn sm gray", type: "button", style: "margin-top:var(--sp-2)", onclick: async () => {
          if (!confirm("정말 탈퇴할까요? 계정의 개인 정보가 모두 지워지고 되돌릴 수 없어요.")) return;
          const uid = A.user.id;
          try {
            const r = await A.deleteAccount();
            for (const k of PERSONAL) { try { localStorage.removeItem(`pc:u:${uid}:${k}`); } catch (e) { /* ignore */ } }
            toast(r && r.mode === "CLOSED" ? "탈퇴했어요. 거래 기록만 보관 기간 동안 남아요" : "탈퇴했어요"); onAccount(null); render();
          } catch (e) { toast("탈퇴하지 못했어요"); } } }, "회원 탈퇴")));
      return box;
    };
  });
})();
