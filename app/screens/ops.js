// 운영 현황 화면 (#ops, data only on the admin host — 6.0 security item 3) — split from app.js (docs/APP_JS_SPLIT_PLAN.md 3-1).
// Registers itself in App.screens; app.js installs every screen right before it starts, handing over the helpers it still owns.
// The public host and the admin host serve the same files (cf/admin/wrangler.jsonc points at app/), so the screen decides by
// hostname: anywhere else it shows one sentence and fetches nothing. The admin host itself sits behind Cloudflare Access
// (cf/admin/src/handler.js, docs/SECURITY_ARCHITECTURE.md §7-1); the PIN screen is only a screen lock, not the protection.
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  (App.screens = App.screens || []).push(() => {
    const { h, fill, icon, won, store, views, FLAGS, fresh, verified, recheckQueue, bdot, bname, kbOf } = App;
    const Classify = window.Classify;
    // localhost / 127.0.0.1 count as admin so local dev (python -m http.server) and the e2e tests see the full screen; a
    // public hostname never equals these, and a page served from a real site cannot pretend to be them.
    const ADMIN_HOSTS = ["yoonsiljang-admin.lsy2825.workers.dev", "localhost", "127.0.0.1"];
    const onAdminHost = () => ADMIN_HOSTS.includes(location.hostname);
    App.onAdminHost = onAdminHost;   // for app.js: a menu entry to #ops makes sense only where the screen has content
    // ---------------- 운영 현황 (ingestion status, freshness, review queue, source policy)
    // 수집 실행 상태 (docs/ADMIN_OPERATIONS_SPEC.md §3), asked only when the button is pressed, no token ever in the app:
    // first the Cloudflare factory's /status (cf/factory, docs/CLOUDFLARE_MIGRATION.md), then — while the move is under way, or
    // if that answers nothing — GitHub's public API for weekly.yml (60 requests an hour per IP; answers only while the repo is public — it is, owner's decision 2026-10-16)
    const FACTORY_STATUS = "https://yoonsiljang-factory.lsy2825.workers.dev/status";
    const RUN_API = "https://api.github.com/repos/lsy2825/skin/actions/workflows/weekly.yml/runs?per_page=5";
    const runState = (r) => r.status === "in_progress" ? "RUNNING" : r.status !== "completed" ? "QUEUED" : r.conclusion === "success" ? "SUCCESS" : "FAILED";
    const RUN_EVT = { schedule: "예약", push: "코드 반영", workflow_dispatch: "수동", manual: "수동" };
    const CF_STATE = { running: "RUNNING", ok: "SUCCESS", skipped: "SKIPPED", failed: "FAILED", stopped: "FAILED" };
    const runRow = (state, when, why, link) => h("li", { class: "runst" }, h("span", { class: `k ${state === "SUCCESS" ? "ok" : state === "FAILED" ? "kx" : ""}` }, state),
      h("span", {}, `${String(when || "").replace("T", " ").slice(0, 16)} UTC · ${RUN_EVT[why] || why || ""}`), link || "");
    async function factoryRuns() {   // → list of rows, or null when the Cloudflare factory is not answering (not set up yet)
      try {
        const res = await fetch(FACTORY_STATUS, { cache: "no-store" });
        if (!res.ok) return null;
        const S = await res.json();
        const all = [S.current, ...(Array.isArray(S.runs) ? S.runs : [])].filter((r) => r && typeof r === "object").slice(0, 5);
        return all.map((r) => runRow(CF_STATE[r.state] || "FAILED", r.startedAt, r.why, r.step && r.state !== "ok" && r.state !== "running" ? h("span", { class: "tiny" }, String(r.step)) : null));
      } catch (e) { return null; }
    }
    function runStatusCard() {
      const out = h("div", { "aria-live": "polite" }, h("div", { class: "sub" }, "버튼을 누르면 가격 공장(Cloudflare, 없으면 GitHub)에서 최근 실행 5개를 한 번 읽어 와요."));
      const btn = h("button", { class: "btn sm gray", type: "button", onclick: async () => {
        btn.disabled = true; fill(out, h("div", { class: "sub" }, "확인하는 중…"));
        const cf = await factoryRuns();
        if (cf) {
          fill(out, h("div", { class: "tiny" }, "Cloudflare 가격 공장"), cf.length ? h("ul", { class: "plain runs" }, cf) : h("div", { class: "sub" }, "실행 기록이 없어요."));
          btn.disabled = false; return;
        }
        try {
          const res = await fetch(RUN_API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
          if (res.status === 403 || res.status === 429) {
            const reset = +res.headers.get("x-ratelimit-reset"); const at = reset ? new Date(reset * 1000).toISOString().slice(11, 16) : "";
            fill(out, h("div", { class: "runst" }, h("span", { class: "k kx" }, "RATE_LIMITED"), h("span", { class: "sub" }, `GitHub 요청 한도(시간당 60번)를 다 썼어요.${at ? ` ${at}(UTC) 이후 다시 확인할 수 있어요.` : ""}`)));
          } else if (!res.ok) fill(out, h("div", { class: "sub" }, `확인하지 못했어요(HTTP ${res.status}). 상태를 짐작해서 보여주지 않아요.`));
          else {
            const runs = ((await res.json()).workflow_runs || []).slice(0, 5);
            fill(out, h("div", { class: "tiny" }, "GitHub Actions"), runs.length ? h("ul", { class: "plain runs" }, runs.map((r) => runRow(runState(r), r.run_started_at || r.created_at, r.event,
                h("a", { href: /^https:\/\/github\.com\//.test(r.html_url || "") ? r.html_url : "https://github.com/lsy2825/skin/actions", target: "_blank", rel: "noopener noreferrer" }, "자세히", icon("external-link", "xs")))))
              : h("div", { class: "sub" }, "실행 기록이 없어요."));
          }
        } catch (e) { fill(out, h("div", { class: "sub" }, "연결이 안 돼 확인하지 못했어요. 상태를 짐작해서 보여주지 않아요.")); }
        btn.disabled = false;
      } }, icon("refresh-cw", "sm"), "최근 수집 실행 확인");
      return h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "수집 실행 상태"), h("span", { class: "sp" }), btn),
        h("p", { class: "tiny", style: "margin:4px 0 8px" }, "QUEUED·RUNNING·SUCCESS·SKIPPED(오늘은 수집할 날이 아님)·FAILED·RATE_LIMITED는 가격 공장이 알려준 그대로예요. 앱에서 수집을 시작하는 버튼은 없어요(관리 비밀키가 필요해요)."), out);
    }
    // 분류 검토 센터 (docs/ADMIN_OPERATIONS_SPEC.md §4): app/review.json from tools/review_queue.js — read-only; decisions are
    // made in the repository files named in each item, and show up after the next build
    function reviewCenterCard() {
      const body = h("div", {}, h("div", { class: "sub" }, "불러오는 중…"));
      fetch("review.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((R) => {
        const total = Object.values(R.classes || {}).reduce((a, b) => a + b, 0) || 1;
        const tabs = [["R", "가격 확인"], ["C", "제품·장비 섞임"], ["J", "이름만 비슷"]];
        let cur = "R";
        const list = h("div", {});
        const paint = () => fill(list, (R.items[cur] || []).length ? h("ul", { class: "plain rvq" }, R.items[cur].map(([id, key, label, where, name, price, why]) =>
          h("li", {}, h("div", { class: "row", style: "gap:6px" }, h("span", { class: "k" }, id), h("b", {}, label || key), h("span", { class: "sp" }), h("span", { class: "tiny" }, where)),
            h("div", { class: "sub" }, `${name}${price ? ` · ${won(price)}` : ""}`), h("div", { class: "tiny" }, why)))) : h("div", { class: "empty" }, "대기 항목이 없어요."));
        fill(body,
          h("div", { class: "row", style: "gap:4px;flex-wrap:wrap" }, Object.entries(R.classes || {}).sort().map(([c, n]) => h("span", { class: "k", title: (Classify.CLASSES[c] || {}).label }, `${c} ${n.toLocaleString()} (${(n / total * 100).toFixed(1)}%)`))),
          h("p", { class: "tiny" }, `비교 묶음 안 가격 줄의 판정 분포 · ${R.updated} 빌드`),
          h("div", { class: "seg", role: "tablist", style: "margin-top:8px" }, tabs.map(([c, l]) => h("button", { type: "button", role: "tab", "aria-selected": c === cur ? "true" : "false",
            onclick: (e) => { cur = c; e.currentTarget.parentNode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b === e.currentTarget ? "true" : "false")); paint(); } }, `${l} ${(R.queue || {})[c] || 0}`))),
          list,
          h("p", { class: "tiny" }, "앱에서는 아무것도 바꾸지 않아요. 처리는 저장소에서: 가격 확인 → data2/review_ok.csv, 묶음 규칙 → build2/taxonomy.py·xkeys.py. 다음 빌드부터 반영돼요. 전체 목록: docs/CLASSIFICATION_REVIEW_QUEUE.csv"));
        paint();
      }).catch(() => fill(body, h("div", { class: "sub" }, "검토 목록(review.json)을 불러오지 못했어요. 빌드가 아직 만들지 않았을 수 있어요.")));
      return h("div", { class: "card" }, h("h3", {}, "분류 검토 센터"), body);
    }
    views.ops = () => {
      const box = h("div", { class: "view" });
      box.append(h("button", { class: "back", type: "button", onclick: () => history.back() }, icon("arrow-left", "sm"), "뒤로"));
      // not the admin host: one sentence, no data, no cards, no fetch (the data itself is public anyway; this keeps the
      // operations view out of the public app)
      if (!onAdminHost()) { box.append(h("div", { class: "card empty", "data-testid": "ops-admin-only" }, "운영 현황은 관리자 주소에서만 볼 수 있어요.")); return box; }
      if (!FLAGS.ops) { box.append(h("div", { class: "card empty" }, "운영 현황이 꺼져 있어요(config.js flags.ops).")); return box; }
      const { D, BR, byB, ROWS, KB, FAM } = App.state();   // read now: these are replaced when new data arrives
      const A = D.meta.about || {}, REPO = "https://github.com/lsy2825/skin";
      // collection report of the last run
      const lines = (A.report || "").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).replace(/\*\*/g, ""));
      box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h2", {}, "운영 현황"), h("span", { class: "sp" }), h("a", { class: "btn sm gray", href: `${REPO}/actions`, target: "_blank", rel: "noopener" }, "실행 기록")),
        h("div", { class: "sub", style: "margin-top:4px" }, `마지막 빌드 ${D.meta.updated} · 매일 06:00 판단(월요일·이벤트 종료 다음 날 수집)`),
        h("ul", { class: "plain" }, lines.map((l) => h("li", { class: /유지|실패|막|검토/.test(l) ? "up" : "" }, l)))));
      // freshness per brand
      const per = D.meta.brands.map((b, bi) => {
        const brs = BR.filter((x) => x.brand === bi);
        if (!brs.length) return null;
        const rows = brs.reduce((s, x) => s + byB[x.i].length, 0);
        const stale = brs.filter((x) => fresh(x.i).stale).length;
        const latest = brs.map((x) => verified(x.i)).sort().pop();
        const expired = brs.reduce((s, x) => s + byB[x.i].filter((i) => ROWS[i][15] === 1).length, 0);
        const pending = brs.reduce((s, x) => s + byB[x.i].filter((i) => ROWS[i][15] === 2).length, 0);
        return { b, brs, rows, stale, latest, expired, pending };
      }).filter(Boolean);
      box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, "데이터 신선도")),
        h("ul", { class: "list" }, per.map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, h("span", { class: "dot bdot", style: `background:${x.b[1]}` }), x.b[0]),
          h("span", { class: "sub" }, `확인 ${x.latest}`),
          h("span", { class: "m" }, h("span", {}, `지점 ${x.brs.length}곳 · 가격 ${x.rows.toLocaleString()}개`), h("span", { class: x.stale ? "up" : "down" }, x.stale ? `STALE ${x.stale}곳` : "모두 VERIFIED"),
            x.expired ? h("span", { class: "up" }, `EXPIRED ${x.expired.toLocaleString()}개`) : null, x.pending ? h("span", { class: "up" }, `PENDING_REVIEW ${x.pending}개`) : null)))))));
      box.append(runStatusCard(), reviewCenterCard());
      // next-collection order (recheckQueue): what a re-collection server would read first
      const q = recheckQueue();
      box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, `재수집 순서 ${q.length}곳`),
        h("div", { class: "sub" }, "오래된 확인·수집 실패·7일 안에 끝나는 이벤트·급변 검토·원본 대조 불일치·지난 수집 이후 변동으로 점수를 매겨요. 지금 수집기는 매주 모든 지점을 읽고, 이 순서는 재수집 서버가 생기면 쓸 기준이에요.")),
        q.length ? h("ul", { class: "list" }, q.slice(0, 10).map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t row" }, bdot(x.b), bname(x.b)), h("span", { class: "sub num" }, `${x.sc}점`), h("span", { class: "m" }, x.why.join(" · ")))))) : h("div", { class: "empty" }, "먼저 볼 지점이 없어요")));
      // review queue
      const rv = A.review || [];
      box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, `검토 큐 ${rv.filter((x) => x.status === "검토 대기").length}개`),
        h("div", { class: "sub" }, "지난 수집보다 90% 넘게 내리거나 10배 넘게 오른 가격. 확인 전까지 비교에서 빠져요."),
        h("div", { class: "sub", style: "margin-top:4px" }, "승인: data2/review_ok.csv 에 brand,branch,name,price 한 줄을 추가 → 다음 빌드부터 반영(변경은 git 기록으로 남아요). ",
          h("a", { class: "linkbtn src", href: `${REPO}/blob/main/data2/review.csv`, target: "_blank", rel: "noopener" }, "review.csv"))),
        rv.length ? h("ul", { class: "list" }, rv.map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, x.name), h("span", { class: "p num" }, `${(+x.price).toLocaleString()}원`),
          h("span", { class: "m" }, h("span", {}, `${x.brand} ${x.branch}`), h("s", {}, `${(+x.before).toLocaleString()}원`), h("span", { class: "up" }, x.change), h("span", { class: x.status === "승인됨" ? "k k1" : "k kx" }, x.status),
            x.url ? h("a", { class: "linkbtn src", href: x.url, target: "_blank", rel: "noopener noreferrer" }, "출처") : null)))))
          : h("div", { class: "empty" }, D.meta.prev ? "검토할 가격이 없어요" : "지난 수집 기록이 생긴 뒤(다음 갱신)부터 확인해요")));
      // source policy
      const src = (A.sources || {}).brands || {};
      box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, "출처 정책 (Source Policy Registry)"), h("div", { class: "sub" }, `robots.txt 확인 ${((A.sources || {}).checked_at || "-").slice(0, 10)}`)),
        h("ul", { class: "list" }, Object.entries(src).map(([b, s]) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, b), h("span", { class: s.allowed ? "down" : "up" }, s.allowed ? "허용" : "막힘"),
          h("span", { class: "m" }, h("span", {}, s.method), s.crawl_delay ? h("span", {}, `crawl-delay ${s.crawl_delay}초`) : null,
            h("span", { class: s.terms_reviewed ? "" : "up" }, s.terms_reviewed ? `약관 검토 ${s.terms_reviewed}` : "약관 검토 필요")))))),
        h("div", { class: "sub", style: "padding:8px 12px 12px" }, "약관 검토일은 사람이 사이트 이용약관을 읽은 뒤 scrape/sources.py REGISTRY에 적어요.")));
      const reps = store.get("reports", []);
      // treatment knowledge base review state (knowledge/treatments.json)
      const kst = {}; for (const e of KB.entries) kst[e.review.status] = (kst[e.review.status] || 0) + 1;
      box.append(h("div", { class: "card" }, h("div", { class: "row" }, h("h3", {}, "시술 설명 검수 현황"), h("span", { class: "sp" }),
        h("a", { class: "btn sm gray", href: `${REPO}/blob/main/knowledge/README.md`, target: "_blank", rel: "noopener" }, "검수 방법")),
        h("div", { class: "sub" }, `항목 ${KB.entries.length}개 · ${Object.entries(kst).map(([k, v]) => `${(KB.statuses || {})[k] || k} ${v}`).join(" · ")} · 근거 출처 있음 ${KB.entries.filter((e) => e.sources.length).length} · 근거 자료 미정리 ${KB.entries.filter((e) => !e.sources.length).length}`),
        h("div", { class: "sub", style: "margin-top:4px" }, `설명이 없는 제품군 ${FAM.filter((f) => !kbOf(f)).length}개 (설명 칸이 안 보여요)`)));
      if (reps.length) box.append(h("div", { class: "card flush" }, h("div", { style: "padding:12px 12px 0" }, h("h3", {}, `이 기기에서 보낸 가격 신고 ${reps.length}개`)),
        h("ul", { class: "list" }, reps.slice(0, 10).map((x) => h("li", {}, h("div", { class: "item" }, h("span", { class: "t" }, x.n), h("span", { class: "sub" }, x.at), h("span", { class: "m" }, `${x.br.replace("|", " ")} · ${x.why}`)))))));
      box.append(h("div", { class: "card" }, h("h3", {}, "기능 플래그"), h("div", { class: "sub", style: "margin-top:4px" }, "법률 검토가 필요한 기능은 꺼 둬요(app/config.js flags)."),
        h("div", { class: "chips wrapc", style: "margin-top:8px" }, Object.entries({ ops: "운영 현황", ads: "광고", booking: "예약 연결", emailAlerts: "메일 알림", publicIndex: "검색 노출", lowestHighlight: "최저가 지점 강조", branchRanking: "지점 순위", discountEmphasis: "할인 강조" }).map(([k, l]) =>
          h("span", { class: "chip", style: "cursor:default" }, `${l}: ${FLAGS[k] ? "켬" : "끔"}`))),
        h("div", { class: "sub", style: "margin-top:8px" }, `로그인: ${window.Auth && window.Auth.enabled ? "켬" : "끔(키 없음)"}`)));
      // 6.0: no credit economics card and no link to the server admin dashboard here — the credit model is being removed
      // (chat B's PR deletes commerce.js and the #admin screen), so nothing on this screen names credits any more.
      return box;
    };
  });
})();
