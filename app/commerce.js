// 크레딧·프리미엄 화면 (docs/MONETIZATION_ARCHITECTURE.md). app.js calls Commerce.install(api) before the first render.
// DEMO (지금): 시연 지갑(DemoWallet, 이 기기에만, 실제 돈 아님)으로 충전·사용·보고서를 끝까지 해 볼 수 있어요.
// SANDBOX / PRODUCTION: balances, orders, payments and jobs live on the server (server/); the browser never decides a price,
// a balance or whether a job succeeded. That path needs APP_CONFIG.commerce.apiBase and a signed-in account.
// The free core (search, compare, cart, watchlist, map, 죠미) never depends on anything here.
(function () {
  "use strict";
  const CFG = (window.APP_CONFIG && window.APP_CONFIG.commerce) || { mode: "DEMO", apiBase: "" };
  const MODE = CFG.apiBase ? CFG.mode || "SANDBOX" : "DEMO";
  const TOOLS = [
    ["읽기", [
      ["EVENT_URL_DECODER", "file-text", "이벤트 글 읽기", "이벤트 글을 붙여 넣으면 가격을 읽고, 같은 시술 묶음의 다른 지점 가격과 비교해요"],
      ["QUOTATION_DECODER", "receipt", "견적·패키지 읽기", "받은 견적·패키지 글을 항목별로 나눠 같은 묶음 가격과 비교해요(원문은 보고서에만)"],
      ["MULTI_EVENT_COMPARE", "layers", "이벤트 여러 개 비교", "이벤트 글 2~4개에서 같은 시술을 찾아 나란히 보여줘요"],
      ["EVENT_IMAGE_DECODER", "scan-search", "AI 이벤트 사진 읽기", "사진 속 가격을 AI가 옮겨 적어요(서버 연결 후)"]]],
    ["보고서", [
      ["PRODUCT_DEEP_COMPARE", "scale", "제품 심층 비교", "두 시술의 전국·지역·브랜드별 가격을 한 장으로"],
      ["REGIONAL_PRICE_REPORT", "map", "지역 가격 보고서", "한 시술의 지역별 지점 수·최저·중간값·최고"],
      ["PRICE_HISTORY_REPORT", "chart-line", "가격 이력 보고서", "모은 주별 가격 기록(4주 이상 모인 시술만)"],
      ["CONSOLIDATED_REPORT", "file-text", "종합 보고서", "장바구니 계획 + 시술별 지역·이력을 한 번에"]]],
    ["계획·지켜보기", [
      ["ADVANCED_CART_PLANNER", "list-checks", "고급 장바구니 계획", "지금 장바구니로 한 곳·나눠서·최대 2곳 계획과 예산 확인. 30일 동안 같은 장바구니는 다시 계산해도 무료"],
      ["PRICE_WATCH_7D", "bell-ring", "가격 지켜보기 7일", "주 1회 새 가격이 들어오면 목표가·새 최저가를 알려줘요(실시간 아님)"],
      ["PRICE_WATCH_30D", "bell-ring", "가격 지켜보기 30일", "위와 같고 30일 동안"]]],
    ["죠미", [["JOMI_QA_SESSION", "message-circle", "죠미 심화 질문", "모은 가격만으로 답하는 질문 세션(5문답). 진단·용량 질문은 무료로 의료진 상담을 안내해요"]]],
  ];
  const TYPE_L = { PURCHASE_GRANTED: "충전", PROMOTIONAL_GRANTED: "보너스", CREDIT_RESERVED: "사용 예약", CREDIT_CAPTURED: "사용", CREDIT_RELEASED: "돌려받음",
    PURCHASE_REFUNDED: "환불", PAYMENT_REVERSED: "결제 취소", ADMIN_ADJUSTMENT: "조정" };
  const STATUS_L = { EXACT_MATCH: ["같은 묶음", "ok"], PARTIAL_MATCH: ["비슷한 묶음(확인 필요)", "warn"], AMBIGUOUS: ["후보 여러 개", "warn"], NO_MATCH: ["못 찾음", "x"] };

  function install(A) {
    const { h, icon, sheet, toast, nav, render, store, won, views } = A;
    const W = window.DemoWallet, P = window.Premium;
    // one demo wallet per signed-in account on this phone (5.1: switching accounts never shows another account's demo credits)
    const wkey = () => (window.Auth && window.Auth.user && window.Auth.user.id ? `demoWallet:${window.Auth.user.id}` : "demoWallet");
    const state = () => { const s = W.load(store.get(wkey(), null)); if (W.expire(s)) save(s); return s; };
    const save = (s) => store.set(wkey(), s);
    const newKey = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const demoBadge = () => h("span", { class: "k k4", title: "실제 돈이 오가지 않는 시연이에요" }, "시연");
    const credits = (n) => `${n}크레딧`;
    // ---------------- admin dashboard (5.1): server only — authorization is checked by the API (admin role + 2-step login);
    // this page only shows what the API returns, with ACTUAL / ESTIMATE kept apart
    views.admin = () => {
      const box = h("div", { class: "view" }), body = h("div", { "data-testid": "admin" });
      box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"),
        h("div", { class: "card" }, h("h2", {}, "관리자 대시보드"), h("div", { class: "sub" }, "매출·결제·환불·크레딧·AI 비용·작업·서버 상태. 실측(ACTUAL)과 추정(ESTIMATE)을 따로 표시해요."), body));
      if (!CFG.apiBase) { body.append(h("p", { class: "note", style: "margin-top:10px" }, "서버(server/)에 연결되지 않은 시연 앱이에요. 서버를 배포하고 관리자 계정(2단계 인증)으로 로그인하면 여기에 실제 숫자가 보여요. 시연 지갑 숫자를 실적처럼 보여주지 않아요.")); return box; }
      body.append(h("p", { class: "sub" }, "불러오는 중…"));
      (async () => {
        try {
          const tok = window.Auth && window.Auth.accessToken ? await window.Auth.accessToken() : null;
          if (!tok) throw new Error("관리자 계정으로 로그인해 주세요");
          const r = await fetch(`${CFG.apiBase}/v1/admin/dashboard`, { headers: { authorization: `Bearer ${tok}` } });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.message || `오류 ${r.status}`);
          body.replaceChildren(...adminBody(j));
        } catch (e) { body.replaceChildren(h("p", { class: "ferr", role: "alert" }, String(e.message || e))); }
      })();
      return box;
    };
    const kindTag = (k) => h("span", { class: `k ${k === "ESTIMATE" ? "k2" : "k1"}`, title: k === "ESTIMATE" ? "가정에 기반한 추정" : "DB 기록의 합계" }, k === "ESTIMATE" ? "추정" : "실측");
    const tbl = (head, rows) => h("table", { class: "tbl", style: "margin-top:6px" }, h("thead", {}, h("tr", {}, head.map((x) => h("th", {}, x)))), h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", { class: typeof c === "number" ? "num" : "" }, typeof c === "number" ? c.toLocaleString("ko-KR") : c ?? "-"))))));
    function adminBody(d) {
      const sec = (t, ...kids) => h("section", { style: "margin-top:14px" }, h("h3", {}, t), ...kids);
      const hl = d.health || {}, pu = d.premium_users || {}, cm = d.contribution_margin_30d || {};
      return [
        sec("최근 30일 채널별", tbl(["채널", "주문", "결제액(실측)", "부가세", "수수료(추정)"], (d.channels_30d || []).map((c) => [c.channel, c.orders, c.gross_krw.value, c.vat_krw.value, c.fee_krw.value]))),
        h("div", { class: "row", style: "gap:6px;margin-top:8px" }, h("b", {}, `공헌이익(30일) ${won(cm.value || 0)}`), kindTag(cm.kind), h("span", { class: "tiny" }, cm.basis || "")),
        sec("일별 매출", tbl(["날짜", "채널", "주문", "결제액"], (d.revenue_daily || []).slice(0, 14).map((x) => [x.day, x.channel, +x.orders, +x.gross_krw]))),
        sec("월별 매출", tbl(["월", "채널", "주문", "결제액"], (d.revenue_monthly || []).map((x) => [x.month, x.channel, +x.orders, +x.gross_krw]))),
        sec("주문·결제 상태(30일)", h("div", { class: "sub" }, `주문 ${JSON.stringify(d.orders_by_status_30d || {})} · 결제 ${JSON.stringify(d.payments_by_status_30d || {})}`)),
        sec("환불(30일)", tbl(["날짜", "종류", "건", "금액", "회수 크레딧", "회수 못 함"], (d.refunds_daily || []).map((x) => [x.day, x.kind, +x.n, +x.krw, +x.credits_reversed, +x.credits_unrecovered]))),
        sec("크레딧", tbl(["날짜", "구매 지급", "보너스", "사용", "반환", "환불 회수"], (d.credits_daily || []).slice(0, 14).map((x) => [x.day, +x.issued_paid || 0, +x.issued_promo || 0, +x.consumed || 0, +x.released || 0, +x.reversed || 0])),
          h("div", { class: "sub" }, `남은 크레딧(부채): 구매 ${(d.outstanding_credits || {}).paid} · 보너스 ${(d.outstanding_credits || {}).promo} · 예약 ${(d.outstanding_credits || {}).reserved}`)),
        sec("AI 사용·비용", tbl(["날짜", "호출", "실패", "대체", "가격표 없음", "비용(원)"], (d.ai_daily || []).slice(0, 14).map((x) => [x.day, +x.calls, +x.failed, +x.fallback, +x.unpriced, +x.cost_krw]))),
        sec("기능별(30일)", tbl(["기능", "작업", "성공", "반환", "차감 크레딧", "AI 비용"], (d.features_30d || []).map((x) => [x.feature_code, +x.jobs, +x.succeeded, +x.released, +x.credits_captured, +x.ai_cost_krw]))),
        sec("프리미엄 사용자", h("div", { class: "sub" }, `7일 ${pu.active_7d} · 30일 ${pu.active_30d} · 이용권 ${pu.open_entitlements} · 광고 없는 기간 ${pu.ad_free_active}`)),
        sec("서버·DB 상태", h("div", { class: "sub" }, `DB ${Math.round((hl.db_size_bytes || 0) / 1e6)}MB · 진행 중 작업 ${hl.jobs_open} · 기한 지난 작업 ${hl.jobs_overdue} · 15분 넘은 미처리 웹훅 ${hl.webhooks_unprocessed_15m} · 1시간 넘은 열린 주문 ${hl.orders_open_over_1h} · 마지막 대사 ${hl.last_reconcile ? `${String(hl.last_reconcile.at).slice(0, 16)} (확인 ${hl.last_reconcile.checked}, 수정 ${hl.last_reconcile.fixed})` : "없음"}`)),
        sec("데이터 신선도·수집", h("div", { class: "sub" }, d.data_freshness && d.data_freshness.updated ? `가격 데이터 ${d.data_freshness.updated} (${d.data_freshness.days_old}일 전)` : "가격 데이터를 읽지 못했어요"),
          h("div", { class: "tiny" }, "수집 실행 기록은 운영 현황 화면(GitHub Actions)에서 봐요.")),
      ];
    }
    // 5.1 audit: outside DEMO the browser must never fall back to the on-device wallet. Until the server screens exist
    // (orders → Toss checkout → server confirm; balances and jobs from the API), these pages only say so.
    if (MODE !== "DEMO") {
      const closed = () => { const box = h("div", { class: "view" });
        box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"),
          h("div", { class: "card", "data-testid": "commerce-closed" }, h("h2", {}, "크레딧·프리미엄"),
            h("p", { class: "sub" }, "서버 연결 화면을 준비하고 있어요. 그 전에는 결제·크레딧 사용을 열지 않아요."),
            h("p", { class: "tiny" }, "가격 찾기·비교·장바구니·관심·지도·죠미 기본 기능은 그대로 무료예요.")));
        return box; };
      views.wallet = closed; views.premium = closed; views.report = closed;
      return { MODE };
    }

    // ---------------- wallet + store
    views.wallet = () => {
      const box = h("div", { class: "view" }), s = state(), b = W.balance(s), af = W.adFree(s, Date.now());
      box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
      box.append(h("div", { class: "card", "data-testid": "wallet" },
        h("div", { class: "row" }, h("h2", {}, "크레딧"), demoBadge(), h("span", { class: "sp" }), h("b", { class: "num big", "data-testid": "wallet-available" }, credits(b.available))),
        h("div", { class: "sub", style: "margin-top:4px" }, MODE === "DEMO" ? "시연 지갑이에요. 실제 돈이 나가지 않고, 이 휴대폰에만 저장돼요." : ""),
        h("dl", { class: "kv", style: "margin-top:10px" },
          h("dt", {}, "구매 크레딧"), h("dd", {}, `${b.paid - b.paid_reserved}${b.paid_reserved ? ` (+사용 중 ${b.paid_reserved})` : ""} · 유효기간 없음`),
          h("dt", {}, "보너스 크레딧"), h("dd", {}, `${b.promo - b.promo_reserved} · 먼저 써요`),
          af ? h("dt", {}, "광고 없는 기간(예전 묶음)") : null, af ? h("dd", {}, `${af.slice(0, 10)}까지`) : null),
        h("div", { class: "note", style: "margin-top:10px" }, "• 자동 충전·정기 결제가 없어요. 필요할 때만 한 번씩 사요.", h("br"),
          "• 가격 찾기·비교·장바구니·관심·지도·죠미 기본 기능은 계속 무료예요.", h("br"),
          "• 크레딧으로 쓰는 도구는 3가지예요(이벤트 글 읽기·여러 이벤트 비교·견적 읽기). 나머지는 무료 화면으로 옮겼어요.", h("br"),
          "• 한 번 연 보고서는 다시 열어도 크레딧이 들지 않아요. 결과를 못 만들면 차감하지 않아요.")));
      box.append(h("div", { class: "card flush" }, h("div", { class: "row", style: "padding:14px 14px 4px" }, h("h3", {}, "충전"), h("span", { class: "sp" }), h("span", { class: "sub" }, "부가세 포함 · 시험 가격")),
        h("ul", { class: "list" }, W.PRODUCTS.map((p) => h("li", {}, h("button", { class: "item", type: "button", "data-testid": `pack-${p.code}`, onclick: () => buySheet(p) },
          h("span", { class: "t" }, `${p.code} · ${credits(p.credits)}`), h("span", { class: "p num" }, won(p.price_krw)),
          h("span", { class: "m" }, h("span", {}, `크레딧당 약 ${won(Math.round(p.price_krw / p.credits))}`), h("span", {}, "부가세 포함"))))))));
      const tx = [...s.tx].reverse().slice(0, 30);
      box.append(h("div", { class: "card flush" }, h("div", { style: "padding:14px 14px 4px" }, h("h3", {}, "이용 내역")),
        tx.length ? h("ul", { class: "list" }, tx.map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, `${TYPE_L[x.type] || x.type}${x.bucket === "PROMO" ? " (보너스)" : ""}`),
          h("span", { class: "p num" }, `${x.eb > 0 ? "+" : x.eb < 0 ? "−" : ""}${x.amount}`), h("span", { class: "m" }, h("span", {}, x.at.slice(0, 16).replace("T", " ")), x.note ? h("span", {}, x.note) : null)))))
          : h("div", { class: "empty" }, "아직 내역이 없어요")));
      box.append(h("div", { class: "card" }, h("h3", {}, "환불·이용 안내 (초안 — 법률 검토 전)"),
        h("ul", { class: "plain", style: "margin-top:8px" }, h("li", {}, "쓰지 않은 구매 크레딧은 결제 후 7일 안에 전액 환불을 요청할 수 있어요(초안)."),
          h("li", {}, "일부를 쓴 뒤에는 남은 구매 크레딧만큼 비례 환불을 검토해요(초안)."), h("li", {}, "보너스 크레딧은 환불 대상이 아니에요."),
          h("li", {}, "결제 취소·환불이 되면 그 묶음의 크레딧이 함께 빠져요. 이미 받은 보고서는 남아요.")),
        h("div", { class: "row", style: "margin-top:12px;gap:8px" }, h("button", { class: "btn sm", type: "button", onclick: () => nav("premium") }, icon("sparkles", "sm"), "프리미엄 도구"),
          h("button", { class: "btn sm gray", type: "button", onclick: () => { if (!confirm("시연 지갑을 처음 상태로 되돌릴까요? 시연 크레딧과 시연 보고서가 지워져요.")) return; save(W.empty()); render(); toast("시연 지갑을 비웠어요"); } }, "시연 지갑 비우기"))));
      return box;
    };
    function buySheet(p) {
      const key = newKey("ord");                         // one key per sheet: a double tap is the same order
      sheet(`${p.code} 충전`, (close) => h("div", {},
        h("dl", { class: "kv" }, h("dt", {}, "가격"), h("dd", { class: "num" }, `${won(p.price_krw)} (부가세 포함)`), h("dt", {}, "크레딧"), h("dd", {}, `${credits(p.credits)} · 유효기간 없음`),
          h("dt", {}, "쓸 수 있는 곳"), h("dd", {}, "이벤트 글 읽기 1 · 여러 이벤트 비교 2 · 견적 읽기 1")),
        h("div", { class: "note", style: "margin-top:10px" }, MODE === "DEMO" ? "시연 결제예요. 실제 돈이 나가지 않고 카드 정보도 묻지 않아요." : "결제는 토스페이먼츠 결제창에서 해요. 크레딧은 서버가 결제를 확인한 뒤에 들어와요."),
        h("button", { class: "btn block", type: "button", style: "margin-top:14px", "data-testid": "buy-confirm", onclick: () => {
          const s = state(), r = W.buy(s, p.code, key); save(s); close(); render();
          toast(r.already ? "이미 충전된 주문이에요" : `시연 충전 완료: ${credits(p.credits)}`); } }, MODE === "DEMO" ? `${won(p.price_krw)} 시연 결제` : `${won(p.price_krw)} 결제하기`)));
    }

    // ---------------- premium tools
    views.premium = () => {
      const box = h("div", { class: "view" }), s = state(), b = W.balance(s);
      box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
      box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, "프리미엄 도구"), demoBadge(), h("span", { class: "sp" }),
        h("button", { class: "btn sm gray", type: "button", onclick: () => nav("wallet") }, icon("wallet", "sm"), credits(b.available))),
        h("div", { class: "sub", style: "margin-top:4px" }, "쓰기 전에 크레딧을 보여주고, 결과를 못 만들면 차감하지 않아요. 가격은 모두 병원 사이트에서 모은 숫자예요(AI가 가격을 만들지 않아요).")));
      // round-2 BIZ01: only what the free screens do not already give is sold; everything else says where it went
      const sold = TOOLS.flatMap(([, t]) => t).filter(([code]) => W.FEATURES[code].sold);
      box.append(h("div", { class: "card flush menu" }, h("div", { style: "padding:14px 14px 4px" }, h("h3", {}, "크레딧으로 쓰는 도구")),
        h("ul", { class: "list" }, sold.map(([code, ic, title, desc]) => { const f = W.FEATURES[code];
          return h("li", {}, h("button", { class: "item", type: "button", "data-testid": `tool-${code}`, onclick: () => toolSheet(code, title) },
            h("span", { class: "t" }, h("span", { class: "mi" }, icon(ic, "sm")), h("span", {}, h("span", { style: "display:block" }, title), h("span", { class: "sub", style: "display:block;font-weight:500" }, desc))),
            h("span", { class: "k k4" }, `${f.credits}C`))); }))));
      const MOVED = { PRODUCT_DEEP_COMPARE: ["무료로 옮김", "versus"], REGIONAL_PRICE_REPORT: ["무료로 옮김", "compare"], ADVANCED_CART_PLANNER: ["무료로 옮김", "cart"],
        CONSOLIDATED_REPORT: ["판매 안 함", null], PRICE_HISTORY_REPORT: ["자료가 쌓이면", "change"], PRICE_WATCH_7D: ["서버 알림 준비 중", "saved"], PRICE_WATCH_30D: ["서버 알림 준비 중", "saved"],
        EVENT_IMAGE_DECODER: ["AI 연결 전", null], JOMI_QA_SESSION: ["판매 보류", "concern"] };
      const rest = TOOLS.flatMap(([, t]) => t).filter(([code]) => !W.FEATURES[code].sold);
      box.append(h("details", { class: "card flush fold" }, h("summary", { style: "padding:14px" }, `팔지 않는 도구 ${rest.length}가지 — 무료 화면으로 옮겼거나 준비 중`),
        h("ul", { class: "list" }, rest.map(([code, ic, title]) => { const [why, to] = MOVED[code] || ["판매 안 함", null];
          return h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, h("span", { class: "mi" }, icon(ic, "sm")), h("span", {}, title)), h("span", { class: "k kx" }, why),
            to ? h("button", { class: "linkbtn", type: "button", onclick: () => nav(to) }, "무료 화면 열기") : null)); }))));
      box.append(reportsCard(s));
      return box;
    };
    function reportsCard(s) {
      return h("div", { class: "card flush" }, h("div", { style: "padding:14px 14px 4px" }, h("h3", {}, "내 보고서"), h("div", { class: "sub" }, "다시 열어도 무료예요")),
        s.reports.length ? h("ul", { class: "list" }, s.reports.map((r) => h("li", {}, h("button", { class: "item", type: "button", onclick: () => nav(`report/${r.id}`) },
          h("span", { class: "t" }, r.title), h("span", { class: "sub" }, r.credits ? credits(r.credits) : "무료(이용권)"), h("span", { class: "m" }, h("span", {}, r.at.slice(0, 10)))))))
          : h("div", { class: "empty" }, "아직 보고서가 없어요"));
    }
    // a treatment picker: type, pick from the comparison groups that have prices
    function keyPicker(label, get, set) {
      const ctx = A.ctx(), wrap = h("div", { class: "kpick" });
      const inp = h("input", { class: "field", type: "search", placeholder: "시술 이름 (예: 리쥬란힐러 2cc)", "aria-label": label });
      const list = h("div", { class: "chips wrapc", style: "margin-top:6px" });
      const chosen = h("div", { class: "sub", style: "margin-top:4px" });
      const paint = () => {
        chosen.textContent = get() ? `고름: ${ctx.label(get())}` : "아직 고르지 않았어요";
        const q = window.Search.norm(inp.value || "");
        const hits = q.length < 2 ? [] : ctx.keys.filter((k) => window.Search.norm(k.label).includes(q)).slice(0, 8);
        list.replaceChildren(...hits.map((k) => h("button", { class: "chip", type: "button", "aria-pressed": get() === k.id ? "true" : "false", onclick: () => { set(k.id); paint(); } }, k.label)));
      };
      inp.addEventListener("input", paint);
      paint();
      return h("div", { style: "margin-top:10px" }, h("div", { class: "flabel" }, h("span", {}, label)), inp, list, chosen, wrap);
    }
    const area = (ph, rows = 6) => h("textarea", { class: "field", rows: String(rows), maxlength: String(window.OfferParse.MAX_TEXT), placeholder: ph, style: "width:100%" });

    function toolSheet(code, title) {
      const f = W.FEATURES[code];
      if (code === "EVENT_IMAGE_DECODER" && MODE === "DEMO") {
        sheet(title, () => h("div", {}, h("p", {}, "사진 읽기는 AI 모델을 서버에서 불러야 해서, 서버와 AI 키를 연결한 뒤에 열려요. 시연에서 가짜 결과를 보여주지 않아요."),
          h("p", { class: "sub" }, "그 전에는 '이벤트 글 읽기'에 이벤트 글을 붙여 넣어 같은 비교를 해 볼 수 있어요."),
          h("ul", { class: "plain" }, h("li", {}, "올린 사진은 분석에만 쓰고 원본은 저장하지 않아요(서버 설계)."), h("li", {}, "사진 속 글자의 지시는 따르지 않고, 가격은 사진에 적힌 글자만 옮겨요."),
            h("li", {}, "얼굴·개인정보가 있는 사진은 올리지 말아 주세요."))));
        return;
      }
      const inp = { region: "" };
      sheet(title, (close) => {
        const box = h("div", {});
        const err = h("div", { class: "ferr", role: "alert", hidden: true });
        let fields;
        if (code === "EVENT_URL_DECODER") { const t = area("이벤트 글을 붙여 넣어 주세요.\n예) 리쥬란힐러 2cc 정가 300,000원 → 199,000원 (VAT 포함)"); fields = [t]; inp.read = () => ({ text: t.value }); }
        else if (code === "QUOTATION_DECODER") { const t = area("받은 견적·패키지 글을 붙여 넣어 주세요.\n예) 슈링크 300샷 + 아이슈링크 100샷 99,000원"); fields = [t, h("div", { class: "tiny" }, "견적 원문은 이 보고서에만 남고 공유 요약·가격 데이터에는 넣지 않아요.")]; inp.read = () => ({ text: t.value }); }
        else if (code === "MULTI_EVENT_COMPARE") { const ts = [1, 2, 3, 4].map((i) => area(`이벤트 ${i}${i > 2 ? " (선택)" : ""}`, 4)); fields = ts; inp.read = () => ({ texts: ts.map((t) => t.value).filter((v) => v.trim()) }); }
        else if (code === "PRODUCT_DEEP_COMPARE") { const v = {}; fields = [keyPicker("시술 A", () => v.a, (x) => { v.a = x; }), keyPicker("시술 B", () => v.b, (x) => { v.b = x; })]; inp.read = () => ({ a: v.a, b: v.b }); }
        else if (code === "REGIONAL_PRICE_REPORT" || code === "PRICE_HISTORY_REPORT") { const v = {}; fields = [keyPicker("시술", () => v.key, (x) => { v.key = x; })]; inp.read = () => ({ key: v.key }); }
        else if (code === "ADVANCED_CART_PLANNER" || code === "CONSOLIDATED_REPORT") {
          const items = A.cartItems(), budget = h("input", { class: "pick", type: "number", inputmode: "numeric", min: "0", step: "10000", placeholder: "예산(선택)", "aria-label": "예산(원)" });
          fields = [h("div", { class: "sub" }, items.length ? `지금 장바구니: ${items.map((i) => `${A.ctx().label(i.k)}${i.q > 1 ? ` ×${i.q}` : ""}`).join(", ")}` : "장바구니가 비어 있어요. 먼저 시술을 담아 주세요."),
            code === "ADVANCED_CART_PLANNER" ? h("div", { class: "row", style: "margin-top:8px;gap:8px" }, budget, h("span", { class: "sub" }, "원")) : null,
            h("div", { class: "sub", style: "margin-top:6px" }, `지역: ${A.regionLabel()}`)];
          inp.read = () => ({ items, region: A.region(), budget: +budget.value > 0 ? Math.round(+budget.value) : null, keys: items.map((i) => i.k) });
        } else if (code === "JOMI_QA_SESSION") { const t = h("input", { class: "field", maxlength: "200", placeholder: "예) 리쥬란힐러 2cc 가격대가 어때요?", "aria-label": "질문" }); fields = [t, h("div", { class: "tiny" }, "규칙 기반 답(시연): 모은 가격 숫자만으로 답해요. 진단·용량·약 질문에는 의료진 상담을 안내해요(무료).")]; inp.read = () => ({ question: t.value }); }
        else { fields = [h("p", { class: "sub" }, "이용권을 사면 '관심·가격 알림'의 알림 조건이 이 기간 동안 매주 새 데이터로 확인돼요. 가격은 주 1회 모아서 실시간 알림이 아니에요.")]; inp.read = () => ({}); }
        const b = W.balance(state());
        box.append(...fields, err,
          h("div", { class: "note", style: "margin-top:12px" }, `이 기능은 ${credits(f.credits)}${f.days && !code.startsWith("PRICE_WATCH") ? ` (같은 장바구니는 ${f.days}일 동안 다시 계산 무료)` : ""}. 지금 쓸 수 있는 크레딧 ${b.available}. 결과를 못 만들면 차감하지 않아요.`),
          h("button", { class: "btn block", type: "button", style: "margin-top:12px", "data-testid": "run-tool", onclick: () => {
            const res = run(code, inp.read());
            if (res.error) { err.textContent = res.error; err.hidden = false; if (res.buy) err.append(" ", h("button", { class: "linkbtn", type: "button", onclick: () => { close(); nav("wallet"); } }, "충전하기"));
              if (res.preview) { const items = (res.preview.payload.items || (res.preview.payload.events || []).flatMap((e) => e.items || [])); err.after(h("div", { class: "card", "data-testid": "free-preview" }, h("h3", {}, "읽은 내용 (무료 미리보기)"),
                items.length ? itemsView(res.preview, items, false) : h("div", { class: "sub" }, "가격이 적힌 줄을 읽었지만 같은 묶음을 찾지 못했어요."))); }
              return; }
            close();
            if (res.screened) { A.jomiNotice(res.screened); return; }
            nav(`report/${res.report_id}`); toast(res.credits ? `${credits(res.credits)}을 썼어요` : "이용권으로 무료 계산했어요"); } }, `${credits(f.credits)} 쓰기`));
        return box;
      });
    }
    const scopeOf = (code, input) => code === "ADVANCED_CART_PLANNER" ? { items: input.items.map((i) => `${i.k}x${i.q}`).sort(), region: input.region || "" } : {};
    // DEMO run: free checks → reserve → build → usable ? capture : release (the same order as server/src/jobs.mjs)
    function run(code, input) {
      const ctx = A.ctx();
      if (code === "JOMI_QA_SESSION") { const sc = window.JomiQA.screen(input.question); if (sc.blocked) return { screened: sc.answer }; }
      else if (!code.startsWith("PRICE_WATCH")) { const a = P.available(code, input, ctx); if (!a.ok) return { error: a.reason }; }
      const s = state(); let rj;
      try { rj = W.reserve(s, code, newKey("job"), scopeOf(code, input)); }
      catch (e) { return e.message === "INSUFFICIENT_CREDITS" ? { error: `크레딧이 부족해요(필요 ${e.need}, 있음 ${e.available}).`, buy: true } : { error: "지금 쓸 수 없는 기능이에요" }; }
      let rep = null, preview = null;
      try {
        if (code === "JOMI_QA_SESSION") {
          const fx = window.JomiQA.facts(input.question, ctx);
          rep = { kind: "JOMI_QA", title: `죠미 심화 질문 · ${input.question.slice(0, 24)}`, payload: { turns: [{ q: input.question, kind: "RULES", answer: window.JomiQA.deterministicAnswer(fx), facts: fx }], max_turns: 5, data_updated: ctx.updated } };
          if (!fx.groups.length) rep = null;                            // nothing to answer from: not charged
        } else if (code.startsWith("PRICE_WATCH")) {
          const days = W.FEATURES[code].days;
          rep = { kind: "PRICE_WATCH", title: `가격 지켜보기 ${days}일`, payload: { days, note: "가격은 주 1회 모아요. 새 데이터가 들어온 뒤 알림 조건을 확인해요(실시간 아님).", data_updated: ctx.updated } };
        } else {
          rep = P.build(code, input, ctx);
          if (!P.usable(rep)) { preview = rep; rep = null; }
        }
      } catch (e) { rep = null; }
      if (!rep) { W.release(s, rj.job.id, "NO_DELIVERABLE"); save(s); if (preview) return { preview, error: "비교할 수 있는 같은 묶음을 찾지 못해 크레딧을 쓰지 않았어요. 읽은 내용만 아래에 무료로 보여 드려요(저장 안 함)." }; return { error: code === "JOMI_QA_SESSION" ? "질문에서 시술 이름을 찾지 못했어요. 크레딧은 돌려드렸어요." : "결과를 만들지 못해 크레딧을 돌려드렸어요." }; }
      const c = W.capture(s, rj.job.id, rep); save(s);
      return { report_id: c.report_id, credits: rj.job.credits };
    }

    // ---------------- one report (reopening is free)
    const chip = (st) => { const [l, c] = STATUS_L[st] || [st, "x"]; return h("span", { class: `k ${c === "ok" ? "k1" : c === "warn" ? "k2" : "kx"}` }, l); };
    const statsLine = (x) => x && x.n ? `지점 ${x.n}곳 · 최저 ${won(x.min)} · 중간값 ${won(x.median)} · 최고 ${won(x.max)}` : "가격 없음";
    function itemsView(r, items, editable) {
      return h("ul", { class: "list" }, items.map((d, i) => h("li", {}, h("div", { class: "item" },
        h("span", { class: "t" }, d.offer.raw_offer_name), h("span", { class: "p num" }, d.offer.advertised_price ? won(d.offer.advertised_price) : "가격 확인 필요"),
        h("span", { class: "m" }, chip(d.match.status), d.match.label ? h("span", {}, `→ ${d.match.label}`) : null,
          d.compare ? h("span", {}, d.compare.verdict === "FEW" ? d.compare.note : `${d.verdict_text || ""} · ${statsLine(d.compare)}`) : null,
          d.compare && d.compare.note && d.compare.verdict !== "FEW" ? h("span", { class: "tiny" }, d.compare.note) : null,
          (d.offer.uncertainties || []).length ? h("span", { class: "tiny" }, `확인 필요: ${d.offer.uncertainties.join(" · ")}`) : null,
          (d.match.assumptions || []).length ? h("span", { class: "tiny" }, d.match.assumptions.join(" · ")) : null,
          d.parts ? h("span", { class: "tiny" }, `구성: ${d.parts.map((p) => `${p.name}(${STATUS_L[p.status] ? STATUS_L[p.status][0] : p.status}${p.median ? ` · 중간값 ${won(p.median)}` : ""})`).join(" + ")}${d.parts_sum ? ` = ${won(d.parts_sum)} (${d.parts_note})` : ` — ${d.parts_note}`}`) : null),
        h("span", { class: "row", style: "gap:6px;margin-top:6px" },
          d.match.status === "EXACT_MATCH" ? h("button", { class: "btn sm gray", type: "button", onclick: () => A.addKey(d.match.key) }, icon("plus", "sm"), "담기") : null,
          editable ? h("button", { class: "btn sm gray", type: "button", onclick: () => correctSheet(r, i) }, icon("pencil", "sm"), "고치기") : null)))));
    }
    // free correction: the user fixes a name / price, the matcher runs again (no AI, no credit)
    function correctSheet(r, i) {
      const d = r.payload.items[i];
      sheet("읽은 값 고치기", (close) => {
        const name = h("input", { class: "field", value: d.offer.raw_offer_name, maxlength: "200", "aria-label": "시술 이름" });
        const price = h("input", { class: "field", type: "number", inputmode: "numeric", value: d.offer.advertised_price || "", "aria-label": "가격(원)" });
        return h("div", {}, h("div", { class: "flabel" }, "시술 이름"), name, h("div", { class: "flabel", style: "margin-top:8px" }, "가격(원)"), price,
          h("div", { class: "tiny", style: "margin-top:6px" }, "고친 값으로 다시 맞춰요. 크레딧이 들지 않아요."),
          h("button", { class: "btn block", type: "button", style: "margin-top:12px", onclick: () => {
            const o = window.OfferParse.parse(`${name.value} ${Math.round(+price.value) || 0}원`, { year: +A.ctx().today.slice(0, 4) }).offers[0];
            if (!o) { toast("이름과 가격을 확인해 주세요"); return; }
            const s = state(), rep = s.reports.find((x) => x.id === r.id), items = [...rep.payload.items];
            items[i] = { ...P.decodeOffer({ ...o, user_corrected: true }, A.ctx(), ""), verdict_text: null };
            if (items[i].compare) items[i].verdict_text = { LOWER: "같은 묶음 중간값보다 낮아요", HIGHER: "같은 묶음 중간값보다 높아요", SIMILAR: "같은 묶음 중간값과 비슷해요", FEW: "비교할 지점이 적어요" }[items[i].compare.verdict];
            W.updateReport(s, r.id, { ...rep.payload, items, corrected_at: new Date().toISOString() }); save(s); close(); render(); toast("다시 맞췄어요(무료)"); } }, "다시 맞추기"));
      });
    }
    function body(r) {
      const p = r.payload || {};
      switch (r.kind) {
        case "EVENT": case "QUOTATION": return [p.warnings && p.warnings.length ? h("div", { class: "note" }, p.warnings.join(" · ")) : null,
          h("div", { class: "sub" }, `부가세: ${{ INCLUDED: "포함", EXCLUDED: "별도", UNKNOWN: "적혀 있지 않음" }[p.vat] || "-"} · 정확히 같은 묶음 ${p.exact}개`), itemsView(r, p.items || [], true),
          p.privacy ? h("div", { class: "tiny" }, p.privacy) : null];
        case "MULTI_EVENT": return [h("div", { class: "sub" }, `이벤트 ${p.events.length}개에서 같은 시술 ${p.groups.length}가지`),
          p.groups.length ? h("ul", { class: "list" }, p.groups.map((g) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, g.label),
            h("span", { class: "m" }, ...g.offers.map((o) => h("span", {}, `이벤트 ${o.event}: ${won(o.price)}${o.conditions.length ? ` (${o.conditions.join("·")})` : ""}`)), h("span", {}, `같은 묶음 ${statsLine(g.market)}`))))))
            : h("div", { class: "empty" }, "이벤트끼리 정확히 같은 시술이 없어요. 아래에서 이벤트별로 보세요."),
          ...p.events.map((e, i) => h("details", { class: "fold" }, h("summary", {}, `이벤트 ${i + 1} · 가격 ${e.items.length}개`), itemsView(r, e.items, false)))];
        case "PRODUCT_COMPARE": return [p.a, p.b].map((x) => h("div", { class: "card inner" }, h("h3", {}, x.label), h("div", { class: "sub" }, `전국: ${statsLine(x.all)}`),
          x.region ? h("div", { class: "sub" }, `지역: ${statsLine(x.region)}`) : null,
          x.brands ? h("ul", { class: "plain" }, x.brands.map((bb) => h("li", {}, `${bb.brand}: ${bb.n}곳 · 최저 ${won(bb.min)} · 중간값 ${won(bb.median)}`))) : null)).concat(h("div", { class: "tiny" }, p.note));
        case "REGIONAL": return [h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, ["지역", "지점", "최저", "중간값", "최고"].map((x) => h("th", {}, x)))),
          h("tbody", {}, p.rows.map((x) => h("tr", {}, h("td", {}, x.region), h("td", { class: "num" }, x.n), h("td", { class: "num" }, won(x.min)), h("td", { class: "num" }, won(x.median)), h("td", { class: "num" }, won(x.max)))))),
          h("div", { class: "tiny" }, `지점 ${p.min_branches}곳 미만 지역은 숫자가 흔들릴 수 있어요.`)];
        case "HISTORY": return [h("ul", { class: "plain" }, p.points.map((x) => h("li", {}, `${x.date}: 중간값 ${won(x.median)} · 최저 ${won(x.min)} · ${x.n}곳`))), h("div", { class: "tiny" }, p.note)];
        case "CART_PLAN": return [h("div", { class: "sub" }, `지역 ${p.region}${p.budget ? ` · 예산 ${won(p.budget)}` : ""}`),
          h("ul", { class: "list" }, p.plans.map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, `${x.id}. ${x.title}`),
            h("span", { class: "p num" }, x.total == null ? "계산 불가" : typeof x.total === "object" ? `${won(x.total.min)}~` : won(x.total)),
            h("span", { class: "m" }, x.visits ? h("span", {}, `방문 ${x.visits}곳`) : null, x.clinics ? h("span", {}, `가능한 지점 ${x.clinics}곳`) : null,
              x.within_budget == null ? null : h("span", {}, x.within_budget ? "예산 안" : "예산 넘음")))))),
          h("ul", { class: "plain tiny" }, p.notes.map((n) => h("li", {}, n))),
          h("div", { class: "tiny" }, "같은 장바구니·지역은 30일 동안 다시 계산해도 크레딧이 들지 않아요.")];
        case "CONSOLIDATED": return p.parts.map((x) => h("div", { class: "card inner" }, h("h3", {}, x.title), ...[].concat(body(x))));
        case "JOMI_QA": return [h("ul", { class: "plain" }, p.turns.map((t) => h("li", {}, h("b", {}, `Q. ${t.q}`), h("div", { style: "white-space:pre-line" }, t.answer),
          h("div", { class: "tiny" }, t.kind === "RULES" ? "규칙 기반 답(모은 가격 숫자만)" : t.kind === "SCREENED" ? "의료 판단 질문 — 의료진 상담 안내(무료)" : t.note || "")))),
          p.turns.length < p.max_turns ? askBox(r) : h("div", { class: "sub" }, "이 세션의 질문 5개를 다 썼어요.")];
        case "PRICE_WATCH": { const e = W.entitlement(state(), ["PRICE_WATCH_7D", "PRICE_WATCH_30D"]);
          return [h("p", {}, e ? `${e.ends_at.slice(0, 10)}까지 지켜봐요.` : "기간이 끝났어요."), h("div", { class: "tiny" }, p.note),
            h("button", { class: "btn sm gray", type: "button", onclick: () => nav("saved") }, icon("bell", "sm"), "알림 조건 관리")]; }
      }
      return [h("pre", {}, JSON.stringify(p).slice(0, 2000))];
    }
    function askBox(r) {
      const t = h("input", { class: "field", maxlength: "200", placeholder: "다음 질문 (무료)", "aria-label": "다음 질문" });
      return h("div", { class: "row", style: "gap:6px;margin-top:8px;flex-wrap:nowrap" }, t, h("button", { class: "btn sm", type: "button", onclick: () => {
        const q = t.value.trim(); if (!q) return;
        const s = state(), rep = s.reports.find((x) => x.id === r.id), sc = window.JomiQA.screen(q);
        const turn = sc.blocked ? { q, kind: "SCREENED", answer: sc.answer } : (() => { const last = (rep.payload.turns || []).filter((x) => x.kind === "RULES").pop() || {}, prev = last.asked || last.q; const asked = window.JomiQA.followUp(prev, q, A.ctx()); const fx = window.JomiQA.facts(asked, A.ctx()); return { q, asked, kind: "RULES", answer: window.JomiQA.deterministicAnswer(fx), facts: fx }; })();
        W.updateReport(s, r.id, { ...rep.payload, turns: [...rep.payload.turns, turn] }); save(s); render(); } }, "묻기"));
    }
    function shareText(r) {
      const m = r.share_summary;
      if (!m) return null;
      const lines = [`[윤실장] ${r.title}`, `${(r.payload && r.payload.data_updated) || ""} 기준 · 병원 사이트에서 모은 가격`];
      if (m.items) for (const x of m.items) lines.push(`- ${x.label || "못 찾은 항목"}${x.advertised ? ` ${won(x.advertised)}` : ""}${x.median ? ` (같은 묶음 중간값 ${won(x.median)}, ${x.n}곳)` : ""}`);
      if (m.rows) for (const x of m.rows) lines.push(`- ${x.region}: 중간값 ${won(x.median)} (${x.n}곳)`);
      if (m.groups) for (const g of m.groups) lines.push(`- ${g.label}: ${g.offers.map((o) => `이벤트${o.event} ${won(o.price)}`).join(", ")}`);
      if (m.a) lines.push(`- ${m.a.label}: 중간값 ${won(m.a.median)} / ${m.b.label}: 중간값 ${won(m.b.median)}`);
      if (m.plans) for (const p of m.plans) lines.push(`- 계획 ${p.id}: ${p.total == null ? "계산 불가" : typeof p.total === "object" ? `${won(p.total.min)}~` : won(p.total)}`);
      if (m.points) lines.push(`- ${m.points.map(([d, v]) => `${d} ${won(v)}`).join(" → ")}`);
      lines.push("※ 개인 메모·견적 원문·사진은 넣지 않았어요");
      return lines.join("\n");
    }
    views.report = (id) => {
      const box = h("div", { class: "view" }), s = state(), r = s.reports.find((x) => x.id === id);
      box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
      if (!r) { box.append(h("div", { class: "card empty" }, "보고서를 찾지 못했어요(시연 보고서는 이 휴대폰에만 있어요).")); return box; }
      const txt = shareText(r);
      box.append(h("div", { class: "card", "data-testid": "report" }, h("div", { class: "row" }, h("h2", {}, r.title), demoBadge()),
        h("div", { class: "sub", style: "margin-top:4px" }, `${r.at.slice(0, 16).replace("T", " ")} · ${r.credits ? credits(r.credits) : "이용권(무료)"} · 다시 열어도 무료`),
        h("div", { style: "margin-top:10px" }, ...[].concat(body(r))),
        h("div", { class: "row", style: "margin-top:14px;gap:8px" },
          txt ? h("button", { class: "btn sm gray", type: "button", onclick: () => A.copyText(txt, "공유용 요약을 복사했어요(개인 정보 없음)") }, icon("copy", "sm"), "요약 복사") : null,
          h("button", { class: "btn sm gray", type: "button", onclick: () => { if (!confirm("이 보고서를 지울까요? 쓴 크레딧은 돌아오지 않아요.")) return; const s2 = state(); W.deleteReport(s2, r.id); save(s2); nav("premium", true); toast("보고서를 지웠어요"); } }, "지우기")),
        h("div", { class: "tiny", style: "margin-top:8px" }, `가격은 ${(r.payload && r.payload.data_updated) || ""} 기준 병원 표시가예요. 예약 전에 병원에 꼭 확인하세요. 병원 순위나 추천이 아니에요.`)));
      return box;
    };
    return { MODE };
  }
  window.Commerce = { install, MODE };
})();
