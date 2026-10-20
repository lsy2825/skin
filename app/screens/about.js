// 데이터 안내 (#about, #data) · 운영 원칙 (#principles) · 개인정보 처리방침 (#privacy) · 시술 사전 (#guide) · 쉬운 용어 (#terms)
// — read-only screens split from app.js (docs/APP_JS_SPLIT_PLAN.md 3-2). Registers itself in App.screens like screens/ops.js;
// app.js installs every screen right before it starts, handing over the helpers it still owns (the ones other screens use
// too: recheckQueue, kbSheet, privacyParts, termBtn …). Data that is replaced when new data arrives (D, BR, KEYS, FAM …) is
// read through App.state() when a screen or card is drawn, never copied.
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  (App.screens = App.screens || []).push(() => {
    const { h, fill, icon, won, toast, emptyLine, searchBox, backBtn, views, FLAGS, fresh, verified, recheckQueue, kbOf, nav, render, adminHost, syncState, liveBrands, moreList, kwBadge,
      md, mdhm, goLink, hereLink, vatNote, branchCountText, REVISIT_CART, isIOS, standalone, notifySupported, PUSH, pushState, privacyParts, jline, jomiSay, jprefs,
      CMP_CATS, famFind, kbSheet, reviewBadge, evidenceBadge, DISCLAIM, KB_STATE } = App;
    const { SYNC, cacheClear, cacheInfo, canCache } = App.Data;
    // ---------------- 알아두면 좋은 점: how prices are collected, compared and checked
    // ---------------- 데이터 상태 (docs/DATA_TRANSPARENCY_SPEC.md) · 앱 설치 · 이 기기 — on top of '알아두면 좋은 점' (#data, #about)
    let installEvt = null;   // Chrome/Edge/Android: the browser's own install prompt, kept until the user taps '이 기기에 설치하기'
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; if (App.state().current === "about") render(); });
    window.addEventListener("appinstalled", () => { installEvt = null; toast("홈 화면에 설치했어요"); });
    function dataStatusCard() {
      const { D, BR } = App.state();   // read now: these are replaced when new data arrives
      const ss = syncState(), m = SYNC.server || SYNC.local, A = D.meta.about || {};
      const ver = BR.filter((b) => !fresh(b.i).stale).length, stale = BR.length - ver;
      const ch = m && m.changes, cc = ch && ch.counts;
      const pri = recheckQueue();
      const row = (k, v) => h("div", { class: "fact" }, h("dt", {}, k), h("dd", {}, v));
      const local = SYNC.at ? new Date(SYNC.at) : null;
      return h("div", { class: "card", id: "data-status" }, h("div", { class: "row" }, h("h2", { class: "t-sec" }, "가격 데이터 상태"), h("span", { class: "sp" }), (ss.state === "READY" ? h("span", { class: "k ok", "data-state": ss.state }, Sync.label(ss, { ...SYNC, updated: D.meta.updated, stale }))
        : kwBadge(Sync.label(ss, { ...SYNC, updated: D.meta.updated, stale }), { "data-state": ss.state }))),
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, "병원 홈페이지에 공개된 가격을 매주 모은 자료예요. '실시간' 가격이 아니에요."),
        h("dl", { class: "facts", style: "margin-top:var(--sp-2)" },
          row("전체 등록 지점", `${BR.length}곳 (${D.meta.brands.filter((b, i) => BR.some((x) => x.brand === i)).map((b) => b[0]).join("·")})`),
          row("이번 수집에서 확인", `${ver}곳${stale ? ` · 못 읽어 지난 가격인 곳 ${stale}곳` : ""}`),
          row("다음 수집 때 먼저 볼 지점", pri.length ? `${pri.length}곳 (오래된 확인·끝나 가는 이벤트·급변 검토 등)` : "없음"),
          row("가격 수집일", md(D.meta.updated)),
          row("마지막 확인", local ? `${mdhm(local)}${SYNC.metaOk ? "" : " (그때 서버에 닿지 못함)"}` : "-"),
          row("마지막 파일 갱신에서 바뀐 가격", cc ? `가격 바뀜 ${cc.price}개 · 새로 생김 ${cc.added}개 · 빠짐 ${cc.removed}개` : "비교할 지난 파일이 없어요"),
          row("갱신 실패", `${stale}곳${SYNC.failed ? ` · 이 휴대폰의 마지막 내려받기 실패: ${SYNC.failed}` : ""}`),
          row("가격 출처", `${liveBrands().length}개 브랜드 공식 홈페이지의 공개 가격 페이지 (${liveBrands().map((b) => b.name).join("·")})`),
          row("가격 비교 기준", "같은 시술·용량(샷 수)·횟수·원산지끼리만 비교해요."),
          row("부가세 처리", "'부가세 별도' 가격에만 10%를 더해 '부가세 포함가'로 보여줘요. 표기를 못 찾은 가격은 그대로 둬요. 마이 → 가격 표시에서 바꿀 수 있어요."),
          row("이벤트 가격 처리", "체험가·한정가·첫 방문·요일·시간 조건 가격은 '특가'로 표시해요. 종료일이 지난 가격은 비교에서 빠지고, 지난 수집보다 90% 넘게 내리거나 10배 넘게 오른 가격은 확인 전까지 빠져요."),
          row("가격 오류 신고", "각 가격의 ⓘ(가격 정보) → '사이트 가격과 달라요' 또는 '이 가격 다시 확인하기'. GitHub로 보내면 운영자에게 접수돼요.")),
        h("div", { class: "sub", style: "margin:var(--sp-2) 0" }, "브랜드별 수집 상태"),
        h("ul", { class: "list" }, D.meta.brands.map((bb, bi) => { const brs = BR.filter((x) => x.brand === bi); if (!brs.length) return null;
          const ok = brs.filter((x) => !fresh(x.i).stale).length, ds = brs.map((x) => verified(x.i)).filter(Boolean).sort();
          return h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "bdot", style: `background:${bb[1]}` }), bb[0]),
            h("span", { class: "sub" }, `${ok}/${brs.length}곳 확인`), h("span", { class: "m" }, ds.length ? `가장 오래된 확인 ${md(ds[0])} · 가장 최근 ${md(ds[ds.length - 1])}` : "확인일 없음"))); })),
        ch && (ch.price.length || ch.added.length || ch.removed.length) ? h("details", { class: "fold small" }, h("summary", {}, "바뀐 가격 목록 보기"),
          // the first 40, then the shared '더 보기' (it used to stop at '40개까지 보여요')
          (() => { const ul = h("ul", { class: "plain chlist" }), all = [...ch.price.map((x) => `${x[0]} ${x[1]} · ${x[2]} : ${won(x[3])} → ${won(x[4])}`), ...ch.added.map((x) => `새로 생김 · ${x[0]} ${x[1]} · ${x[2]} ${won(x[3])}`),
            ...ch.removed.map((x) => `빠짐 · ${x[0]} ${x[1]} · ${x[2]} ${won(x[3])}`)];
            return [ul, moreList(ul, all, (t) => h("li", {}, t), { first: 40 })]; })(), h("p", { class: "tiny" }, "병원 표시가 기준이에요.")) : null,
        FLAGS.ops && adminHost() ? h("button", { class: "linkbtn", type: "button", style: "margin-top:var(--sp-2)", onclick: () => nav("ops") }, "운영 현황(수집 보고·검토 큐·재수집 순서)", icon("chevron-right", "xs")) : null);
    }

    function installCard() {
      const ios = isIOS(), sa = standalone();
      const kids = [h("h3", {}, icon("smartphone", "sm"), " 홈 화면에 앱으로 설치")];
      if (sa) kids.push(h("div", { class: "sub" }, "지금 설치한 앱으로 열려 있어요."));
      else if (installEvt) kids.push(h("div", { class: "sub" }, "이 브라우저에서 바로 설치할 수 있어요. 설치하면 앱처럼 전체 화면으로 열리고, 저장된 가격으로 오프라인에서도 볼 수 있어요."),
        h("button", { class: "btn", type: "button", style: "margin-top:var(--sp-2)", onclick: async () => { const e = installEvt; installEvt = null; try { await e.prompt(); await e.userChoice; } catch (er) { /* closed */ } render(); } }, icon("download", "sm"), "이 기기에 설치하기"));
      else if (ios) kids.push(h("ol", { class: "steps" }, h("li", {}, "Safari로 이 페이지를 열어요."), h("li", {}, "아래쪽 공유 버튼(네모에 위 화살표)을 눌러요."), h("li", {}, "'홈 화면에 추가' → '추가'."),
        h("li", {}, "홈 화면 아이콘으로 열면 휴대폰 알림도 켤 수 있어요(iOS 16.4 이상).")));
      else kids.push(h("div", { class: "sub" }, "이 브라우저가 지금 설치 버튼을 주지 않았어요(이미 설치했거나, 지원하지 않는 브라우저일 수 있어요)."),
        h("ol", { class: "steps" }, h("li", {}, "Android Chrome: 오른쪽 위 ⋮ 메뉴 → '앱 설치' 또는 '홈 화면에 추가'."), h("li", {}, "PC Chrome·Edge: 주소창 오른쪽의 설치 아이콘."), h("li", {}, "iPhone: Safari 공유 버튼 → '홈 화면에 추가'.")));
      return h("div", { class: "card", id: "install" }, ...kids);
    }
    function deviceCard() {
      const box = h("div", { class: "card", id: "device" }, h("h3", {}, icon("database", "sm"), " 이 휴대폰"));
      const dl = h("dl", { class: "facts" });
      box.append(dl, h("button", { class: "btn sm gray", type: "button", style: "margin-top:var(--sp-2)", onclick: async () => {
        App.Data.abort();                       // stop a running download first
        await cacheClear(); toast("저장된 가격을 지웠어요. 다시 받아요"); setTimeout(() => location.reload(), 400); } }, icon("refresh-cw", "sm"), "저장된 가격 지우고 다시 받기"),
        h("p", { class: "tiny" }, "관심·내 견적·설정은 그대로 두고 가격 파일만 지워요."));
      (async () => {
        const m = await cacheInfo(), keys = canCache() ? await caches.keys().catch(() => []) : [];
        let est = null; try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { est = null; }
        const row = (k, v) => h("div", { class: "fact" }, h("dt", {}, k), h("dd", {}, v));
        fill(dl, row("앱으로 실행", standalone() ? "예 (설치한 앱)" : "아니요 (브라우저)"),
          row("저장된 가격", m ? `${md(m.updated)} 수집 · 지점 ${m.branches}곳 · 가격 ${m.rows.toLocaleString()}개 · ${(m.bytes / 1e6).toFixed(1)}MB` : "저장된 사본 없음(다음에 열 때 다시 받아요)"),
          row("가격 파일 버전", SYNC.version || "-"),
          row("앱 버전", keys.find((k) => /^pc-v\d+$/.test(k)) || "오프라인 저장 안 함(이 브라우저)"),
          est && est.usage ? row("이 사이트 저장 공간", `${(est.usage / 1e6).toFixed(1)}MB 사용`) : null,
          row("휴대폰 알림", !notifySupported() ? "지원 안 함" : Notification.permission === "denied" ? "꺼짐(브라우저 설정)" : PUSH && pushState() ? "켜짐(앱이 닫혀 있어도)" : Notification.permission === "granted" ? "켜짐(앱을 열 때만)" : "아직 안 켬"));
      })();
      return box;
    }

    // 운영 원칙 (round-2 FINAL §4, docs/PRODUCT_DECISIONS.md): what the app promises and what it does not. The wording promises
    // no paid ranking and disclosed interests — not 'we never take any money from clinics' (the owner has not decided on B2B)
    views.principles = () => {
      const { D, BR } = App.state();   // read now: these are replaced when new data arrives
      const box = h("div", { class: "view" });
      const br = (D.meta.brands || []).map((b, i) => ({ name: b[0], n: BR.filter((x) => x.brand === i).length, how: b[2] })).filter((x) => x.n);
      box.append(backBtn(),
        h("h2", { class: "title" }, "운영 원칙과 수집 범위"),
        h("div", { class: "card" }, h("h3", {}, "약속하는 것"),
          h("ul", { class: "plain" },
            h("li", {}, "돈을 받고 비교 순서를 바꾸지 않아요. 기본 순서는 지역·이름 순이고, 가격순은 직접 고를 때만이에요."),
            h("li", {}, "같은 제품·용량·횟수끼리만 나란히 놓아요."),
            h("li", {}, "모든 가격에 병원 사이트 링크와 수집일을 붙여요. 조건(첫 방문·체험가·부가세)은 가격 옆에 적어요."),
            h("li", {}, "광고·예약·쿠폰·병원 제휴는 지금 없어요. 생기면 이 화면에 먼저 적고, 가격 비교와 섞지 않아요."))),
        h("div", { class: "card" }, h("h3", {}, "수집 범위"),
          h("p", { class: "sub" }, `${md(D.meta.updated)} 수집 · ${br.length}개 체인 ${BR.length}곳. 전국 모든 피부과가 아니에요 — 동네 의원 대부분은 아직 없어요.`),
          h("ul", { class: "plain" }, br.map((x) => h("li", {}, h("b", {}, `${x.name} ${x.n}곳`), h("span", { class: "sub" }, ` — ${x.how}`))))),
        h("div", { class: "card" }, h("h3", {}, "이해관계"),
          h("p", { class: "sub" }, "지금 이 앱은 병원·제약사·장비 회사에서 받는 돈이 없어요. 수익 방식이 정해지면 여기에 날짜와 함께 적어요.")),
        h("div", { class: "card" }, h("h3", {}, "정정·삭제 요청"),
          h("p", { class: "sub" }, "가격이 틀렸거나 병원 정보를 빼 달라는 요청은 가격 정보 화면의 '신고'로 받아요. 지금은 GitHub 공개 글로 접수돼요. 병원이 요청하면 확인 후 수집에서 빼요(지금까지 1곳 중지). 운영자 연락처는 정식 공개 전에 확정해요."),
          h("button", { class: "btn line block", type: "button", onclick: () => nav("about") }, "데이터 상태와 출처 자세히", icon("chevron-right", "sm"))));
      return box;
    };

    if (privacyParts().length) views.privacy = () => {
      const box = h("div", { class: "view" });
      box.append(backBtn(),
        h("h2", { class: "title" }, "개인정보 처리방침"),
        ...privacyParts().map((x) => h("section", { class: "card policy" }, h("h3", {}, x.title), x.paras.map((t) => h("p", {}, t)))));
      return box;
    };

    views.about = () => {
      const { D, BR, WHEN_COL } = App.state();   // read now: these are replaced when new data arrives
      const box = h("div", { class: "view" });
      const A = D.meta.about || {}, src = A.sources || {};
      box.append(backBtn());
      box.append(dataStatusCard(), installCard(), deviceCard());
      box.append(h("div", { class: "card" }, h("h2", {}, "알아두면 좋은 점"),
        h("div", { class: "note", style: "margin-top:var(--sp-2)" }, "이 앱은 병원 홈페이지에 공개된 가격을 모아 비교만 해요. 의료 상담·진단을 하지 않고 시술 효과나 안전을 보장하지 않아요. 예약·결제·광고·수수료가 없고, 어떤 병원과도 금전 관계가 없어요."),
        h("h3", { style: "margin-top:var(--sp-3)" }, "가격 종류"),
        h("dl", { class: "kv", style: "margin-top:var(--sp-2)" },
          h("dt", {}, h("span", { class: "k k1" }, "체험가")), h("dd", {}, "처음 한 번만 되는 가격(보통 1인 1회)"),
          h("dt", {}, h("span", { class: "k k2" }, "한정가")), h("dd", {}, "기간·수량·첫 방문·재방문(다시 오는 손님) 등 조건이 붙은 가격"),
          h("dt", {}, h("span", { class: "k kt" }, "재방문만")), h("dd", {}, `그 병원에 다시 오는 손님만 받는 가격. ${REVISIT_CART}(첫 1회만)`),
          h("dt", {}, h("span", { class: "k kt" }, Pricing.condLabel("평일 낮"))), h("dd", {}, "평일 낮·화수목·평일 해피아워처럼 평일 중 정해진 요일·시간에만 되는 가격"),
          h("dt", {}, h("span", { class: "k kt" }, Pricing.condLabel("시간대"))), h("dd", {}, "점심·해피아워처럼 정해진 시간에만 되는 가격. 요일은 병원에 확인하세요"),
          // only a file with the site's days (C #71) can show this badge: the visit sheet's words split the same way (WHEN_COL)
          WHEN_COL ? [h("dt", {}, h("span", { class: "k kt" }, `${Pricing.whenBadge(32, 0)} 등`)), h("dd", {}, "사이트에 적힌 요일에만 되는 가격")] : null,
          h("dt", {}, h("span", { class: "k k4" }, "고시가")), h("dd", {}, "리엔장 비급여 진료비 고시표(정가). 행사 가격이 아니에요"),
          h("dt", {}, h("span", { class: "k k4" }, "~10/17까지")), h("dd", {}, "병원이 적은 이벤트 종료일. 지나면 비교에서 빠지고, 다음 날 아침 다시 모아요"),
          h("dt", {}, kwBadge("급변·확인 중")), h("dd", {}, "지난 수집보다 90% 넘게 내리거나 10배 넘게 오른 가격. 확인 전까지 비교에서 빠져요")),
        h("h3", { style: "margin-top:var(--sp-3)" }, "어떻게 비교하나요"),
        h("ul", { class: "plain" },
          h("li", {}, "같은 용량·샷 수·횟수·원산지끼리만 비교해요. 그 밖은 이름이 똑같은 옵션을 3곳 이상이 팔 때만 묶고, 비슷하지만 다른 상품은 묶지 않아요."),
          h("li", {}, "목록은 처음에 지역·지점 이름순이에요(기준 위치를 정하면 가까운순). 낮은·높은 가격순은 직접 고를 수 있고, 광고·제휴로 순서가 바뀌지 않아요. 특정 병원을 '최저가'로 앞세우지 않고 가격 범위와 중간 가격으로 요약해요."),
          h("li", {}, "가격과 함께 부작용·주의사항, 시술 조건을 보여줘요. 장비·약제의 정품 여부는 앱이 확인하지 않고, 의료진 정보는 모으지 않아요 — 병원에 확인하세요."),
          FLAGS.branchRanking ? h("li", {}, "지점 순위의 '몇 % 싸요'는 같은 옵션을 파는 지점들의 중간 가격 대비 평균(기하평균)이에요.") : null,
          h("li", {}, "할인율은 병원이 직접 적은 정가가 있을 때만 보여요."),
          h("li", {}, "가격 동향·변동은 매주 실제로 모은 기록만 써요. 빈 주를 채우지 않아요.")),
        h("h3", { style: "margin-top:var(--sp-3)" }, "부가세"),
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, vatNote()),
        h("ul", { class: "list" }, Object.entries(A.vat || {}).map(([b, v]) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, b), h("span", { class: "sub" }, v.default === "excl" ? "별도" : v.default === "incl" ? "포함" : "-"),
          h("span", { class: "m" }, `“${v.evidence}” (확인 ${md(v.checked)})`, v.url ? h("a", { class: "linkbtn src", href: v.url, target: "_blank", rel: "noopener noreferrer" }, "원문") : null))))),
        h("h3", { style: "margin-top:var(--sp-3)" }, "어디서 어떻게 모으나요"),
        h("div", { class: "sub", style: "margin-top:var(--sp-2)" }, `각 병원 사이트의 공개 페이지만 읽어요. 로그인·차단 우회는 하지 않고, 수집 전에 robots.txt를 확인해요${src.checked_at ? ` (마지막 확인 ${md(src.checked_at)})` : ""}.`),
        h("ul", { class: "list" }, D.meta.brands.map((b, i) => { const s = (src.brands || {})[b[0]]; if (!BR.some((x) => x.brand === i)) return null;
          return h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "dot bdot", style: `background:${b[1]}` }), b[0]),
            h("span", { class: "sub" }, s ? (s.allowed ? "수집 허용" : "수집 막힘") : "-"),
            h("span", { class: "m" }, b[2], s && s.rate ? ` · ${s.rate}` : ""))); })),
        h("h3", { style: "margin-top:var(--sp-3)" }, "자동으로 정리한 것"),
        h("ul", { class: "list" }, Object.entries(A.issues || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, k), h("span", { class: "sub num" }, `${n}개`))))),
        h("div", { class: "sub", style: "margin-top:var(--sp-3)" }, `${md(D.meta.updated)} 수집 · 가격 ${D.meta.rows.toLocaleString()}개 · ${branchCountText()}. 지도 © OpenStreetMap 기여자.`)));
      return box;
    };

    // a family's name on a list that mixes compare categories: a shared name (에어녹스 in 윤곽·필러·리프팅·기타) says which one
    const famTitle = (f) => (App.state().kbFind.shared(f) && f.cat ? `${f.name} (${f.cat})` : f.name);
    views.guide = (arg, params) => {
      const { FAM, KEYS, byKB, kbFind } = App.state();   // read now: these are replaced when new data arrives
      const box = h("div", { class: "view" });
      const c = params.get("c") || "";
      box.append(backBtn());
      const q = h("input", { type: "search", placeholder: "시술 이름으로 찾기 (예: 보톡스)", "aria-label": "시술 사전에서 찾기", value: params.get("q") || "" });
      const list = h("div", {});
      box.append(h("div", { class: "card" }, h("h2", {}, "시술 사전"),
        jprefs().freq === "often" ? jomiSay("explaining", jline("guideTip") || "이름이 비슷한 시술을 쉽게 정리했어요.") : null,
        h("div", { class: "sub" }, "이름이 비슷해서 헷갈리는 시술을 정리했어요."),
        h("div", { class: "chips", style: "margin-top:var(--sp-2)" }, ["", ...CMP_CATS].map((x) => h("button", { class: "chip", type: "button", "aria-pressed": x === c ? "true" : "false",
          onclick: () => nav(x ? `guide?c=${encodeURIComponent(x)}` : "guide", true) }, x || "전체"))),
        searchBox(q, { inset: true, style: "margin-top:var(--sp-2)" }), list));
      const entry = (f, members) => { const e = kbOf(f);
        return h("div", { class: "gitem" },
          h("div", { class: "row", style: "flex-wrap:nowrap" }, h("b", { style: "flex:1;min-width:0" }, members ? `${e ? e.title : f.name} · ${members.length}가지` : c ? f.name : famTitle(f)),
            h("span", { class: "sub", style: "flex:none" }, `${members ? new Set(members.flatMap((m) => m.vs.flatMap((v) => [...byKB[v.k].keys()]))).size : f.n}곳`),
            members ? null : h("button", { class: "btn sm gray", type: "button", style: "flex:none", onclick: () => nav(`compare?k=${KEYS[f.main].id}`) }, "가격 비교")),
          e ? h("p", {}, `${e.one_liner} ${e.purpose}`) : null, e && e.method ? h("p", { class: "sub" }, e.method) : null,
          e ? h("div", { class: "row", style: "gap:var(--sp-1);margin-top:var(--sp-2)" }, reviewBadge(e), evidenceBadge(e), hereLink("info", "부작용·주의사항·근거 보기", () => kbSheet(e, members ? null : f))) : null,
          members ? h("div", { class: "chips wrapc", style: "margin-top:var(--sp-2)" }, members.map((m) => h("button", { class: "chip", type: "button", onclick: () => nav(`compare?k=${KEYS[m.main].id}`) }, c ? m.name : famTitle(m)))) : null);
      };
      const paint = () => {
        let fams = q.value.trim() ? famFind(q.value) : FAM.slice().sort((a, b) => CMP_CATS.indexOf(a.cat) - CMP_CATS.indexOf(b.cat) || b.n - a.n);
        if (c) fams = fams.filter((f) => f.cat === c);
        // many families that share one note (제모: one per body area) → one entry with the areas as chips
        const byFid = new Map();
        for (const f of fams) if (!kbFind.viaName(f) && kbFind.viaFid(f)) byFid.set(f.fid, [...(byFid.get(f.fid) || []), f]);
        const done = new Set(), out = [];
        for (const f of fams) {
          const grp = byFid.get(f.fid);
          if (grp && grp.length > 6) { if (!done.has(f.fid)) { done.add(f.fid); out.push(entry(f, grp)); } continue; }
          out.push(entry(f));
        }
        fill(list, out.length ? out : emptyLine("맞는 시술이 없어요."), h("p", { class: "tiny", style: "margin-top:var(--sp-3)" }, DISCLAIM + " 설명이 없는 시술은 병원이 상품 이름에 적은 설명만 보여줘요. " + KB_STATE()));
      };
      let tm = 0;
      q.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(paint, 150); });
      paint();
      return box;
    };

    views.terms = () => {
      const box = h("div", { class: "view" });
      box.append(backBtn());
      const q = h("input", { type: "search", placeholder: "용어 찾기 (예: 체험가, 샷, U)", "aria-label": "용어 찾기" });
      const list = h("div", {});
      const long = jprefs().detail === "long";
      const paint = () => { const w = q.value.trim();
        const shown = (window.TERMS || []).filter((x) => !w || x.t.includes(w) || (x.aka || []).some((a) => a.includes(w)) || x.short.includes(w));
        fill(list, [["price", "가격·조건"], ["unit", "단위"], ["term", "시술 용어"]].map(([kd, l]) => { const xs = shown.filter((x) => x.kind === kd); return xs.length ? h("div", { class: "card flush" },
          h("div", { style: "padding:var(--sp-3) 14px 0" }, h("h3", {}, l), h("div", { class: "tiny" }, kd === "price" ? "윤실장의 설명이에요(의학 정보 아님)." : "일반적인 뜻이에요 · 의료진 검수 전")),
          h("ul", { class: "list" }, xs.map((x) => h("li", {}, h("div", { class: "item termi" }, h("span", { class: "t" }, x.t), h("span", { class: "m", style: "color:var(--ink-2)" }, x.short),
            long ? h("span", { class: "m" }, x.long) : h("details", { class: "fold small", style: "grid-column:1/-1" }, h("summary", {}, "자세히"), h("p", { class: "sub", style: "margin:0 0 var(--sp-2)" }, x.long))))))) : null; }),
          shown.length ? null : h("div", { class: "card" }, emptyLine("찾는 용어가 없어요. 시술 이름은 시술 사전에서 찾아보세요.")));
      };
      q.addEventListener("input", paint);
      // the head of every screen outside the tabs (2026-10-20 디자인 통일 U16): 뒤로 · the title 22 first in the card · 죠미 under it
      // (시술 사전's order) · one line 13 saying what the screen is — 죠미 sat over the title here
      box.append(h("div", { class: "card" }, h("h2", {}, "쉬운 용어"),
        jomiSay("explaining", "가격표에 자주 나오는 말을 쉽게 풀었어. 시술이 나한테 맞는지는 꼭 의료진과 이야기해 줘."),
        h("div", { class: "sub" }, "가격·조건, 단위, 시술 용어를 쉬운 말로 적었어요."), searchBox(q, { inset: true, style: "margin-top:var(--sp-2)" }),
        goLink("시술 이름은 시술 사전에서", "guide", { style: "margin-top:var(--sp-2)" })));
      box.append(list);
      paint();
      return box;
    };
  });
})();
