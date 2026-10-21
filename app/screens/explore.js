// 탐색 (#explore) — split from app.js (docs/APP_JS_SPLIT_PLAN.md 3-7): every way to look at prices and treatments (the tiles,
// 카테고리로 바로 비교, 가격 착한 지점 TOP 5, the price trend card). Registers itself in App.screens like the other screen files; app.js
// installs every screen right before it starts, handing over the helpers it still owns (findGo, withSuggest, secHead, moreGo,
// trendCard, shortKeys, famsIn, CAT_START … — 홈, the search page and 시술 비교 use them too). Data that is replaced when new data
// arrives is read through App.state(), never copied: D, BR, FAM when the screen is drawn, KEYS, KI when a category chip is pressed.
(function () {
  "use strict";
  const App = (window.App = window.App || {});
  (App.screens = App.screens || []).push(() => {
    const { h, icon, km, searchBox, views, FLAGS, bdot, bname, nav, md, CMP_CATS, regionName, regionCount, dist, branchRanks, divBar, lvClass,
      lvText, CAT_START, SHORT_MAX, catIcon, famsIn, findGo, moreGo, secHead, shortKeys, trendCard, withSuggest } = App;
    // ---------------- 탐색: every way to look at prices and treatments
    views.explore = () => {
      const { D, BR, FAM } = App.state();   // read now: replaced when new data arrives
      const box = h("div", { class: "view" });
      const q = h("input", { type: "search", placeholder: "시술 이름 (예: 슈링크 300샷, 리쥬란)", "aria-label": "시술 검색", enterkeyhint: "search" });
      q.addEventListener("keydown", (e) => { if (e.key === "Enter" && q.value.trim()) findGo(q.value); });
      box.append(h("div", { style: "padding:0" }, h("h2", { class: "display" }, "탐색"), h("p", { class: "sub", style: "margin:var(--sp-2) 0 0" }, `${regionName()} ${regionCount()}곳 · 가격 ${D.meta.rows.toLocaleString()}개 · ${md(D.meta.updated)} 수집`)),
        searchBox(withSuggest(q, (v) => findGo(v))));
      const tile = (ic, t, sub, go, cls) => h("button", { type: "button", class: cls || null, onclick: go }, h("span", { class: "hi" }, icon(ic)), h("span", {}, h("b", {}, t), h("small", {}, sub)));
      const top1 = branchRanks()[0];
      box.append(h("div", { class: "hub" },
        tile("chart-column", "시술별 가격 비교", "같은 용량·횟수끼리 가격 범위", () => nav("compare"), "feat"),
        tile("scale", "빠른 비교", shortKeys().length ? `비교함 ${shortKeys().length}/${SHORT_MAX}곳` : "지점 2~4곳 나란히", () => nav("quick")),
        FLAGS.concernSearch ? tile("message-circle", "죠미와 대화", "이름·가격·고민을 말로", () => nav("concern")) : null,
        tile("book-open", "시술 사전", "헷갈리는 시술의 차이", () => nav("guide")),
        tile("map", "지도", "가까운 지점과 가격", () => nav("map")),
        FLAGS.branchRanking ? tile("trophy", "지점 순위", top1 ? `1위 ${BR[top1.b].name}` : "같은 상품 기준", () => nav("rank")) : null,
        tile("scale", "지점 비교", "두 지점 나란히", () => nav("versus")),
        tile("table", "전체 가격표", "조건으로 모든 가격 찾기", () => nav("table")),
        tile("circle-help", "쉬운 용어", "체험가·샷·U가 뭔지", () => nav("terms")),
        tile("trending-down", "가격 변동", D.meta.prev ? "지난 수집 대비" : "다음 수집부터", () => nav("change")),
        tile("info", "데이터 상태·앱 설치", "언제·어디서 모았나·비교 기준", () => nav("data"))));
      box.append(secHead("카테고리로 바로 비교"), h("div", { class: "chips wrapc" }, CMP_CATS.filter((c) => FAM.some((f) => f.cat === c)).map((c) =>
        h("button", { class: "chip", type: "button", onclick: () => { const { KEYS, KI } = App.state(); nav(`compare?k=${KEYS[KI[CAT_START[c]] ?? famsIn(c)[0].main].id}`); } }, catIcon(c, "sm"), c))));
      const tops = FLAGS.branchRanking ? branchRanks().slice(0, 5) : [];
      if (tops.length) box.append(secHead("가격 착한 지점 TOP 5", regionName()), h("div", { class: "card flush" },
        h("ul", { class: "list" }, tops.map((x, n) => h("li", {}, h("button", { class: "rank top", type: "button", onclick: () => nav(`branch/${x.b}`) },
          h("span", { class: "n num" }, n + 1), h("span", { class: "b" }, bdot(x.b), h("span", {}, bname(x.b))), h("span", { class: `p ${lvClass(x.lv)}` }, lvText(x.lv)),
          h("span", { class: "m" }, divBar(x.lv), h("span", {}, `제일 싼 시술 ${D.bstat[x.b][3]}개`), dist(x.b) != null ? h("b", {}, km(dist(x.b))) : null))))),
        moreGo("지점 순위 전체", "rank")));
      box.append(trendCard() || "");
      return box;
    };
  });
})();
