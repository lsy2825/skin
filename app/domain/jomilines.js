// 죠미 대사 엔진 (round-2 review F / UX05). The lines are DATA (records below); the choice is a small rule engine:
//   intent → records whose conditions hold → the highest priority → a variant not used recently (cooldown).
// Kept apart on purpose: what Jomi may say (docs/JOMI_COPYWRITING.md: friendly 반말, short, never a diagnosis, a dose or a
// pick of a clinic) and how one line is chosen. Safety / disclaimer lines are `fixed`: they never vary, so their meaning
// cannot drift. Prices are never written into a line — numbers come from the data at the place that shows them.
// Counts are reported separately (stats()): intents, records, variants — a template's possible combinations are not
// 'unique answers'. Pure functions; window.JomiLines in the app, require()d by tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JomiLines = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // conditions: visits ('first' | 'return' | 'regular' = 5+), hour [from, to) local, offline
  const R = (id, intent, variants, o = {}) => ({ id, intent, variants, priority: o.priority || 0, cooldown: o.cooldown ?? 3, when: o.when || {}, tone: o.tone || "friendly", fixed: !!o.fixed });
  const RECORDS = [
    // home greeting
    R("home.first", "home", ["안녕! 난 죠미야. 같은 용량끼리 가격을 비교해 줄게.", "처음 왔구나! 시술 이름을 적으면 같은 조건끼리 가격을 모아 줄게."], { when: { visits: "first" }, priority: 3 }),
    R("home.morning", "home", ["좋은 아침! 오늘은 어떤 시술 가격이 궁금해?", "아침부터 왔네! 궁금한 시술 이름을 적어 줘."], { when: { visits: "return", hour: [5, 11] }, priority: 2 }),
    R("home.night", "home", ["늦은 시간이네. 가격만 살짝 보고 푹 자!", "밤에도 왔구나. 오늘은 어떤 시술을 볼까?"], { when: { visits: "return", hour: [22, 29] }, priority: 2 }),
    R("home.regular", "home", ["또 왔네! 지난번에 본 시술 이어서 볼까?", "반가워! 관심 탭에 가격 바뀐 게 있는지 봐 줘.", "자주 와 줘서 고마워. 오늘은 뭐 비교할까?"], { when: { visits: "regular" }, priority: 1 }),
    R("home.back", "home", ["또 왔네! 오늘은 어떤 시술이 궁금해?", "다시 왔구나! 시술 이름을 적어 줘.", "어서 와! 같은 용량·횟수끼리 비교해 줄게.", "반가워! 장바구니에 담아 두면 병원별 합계도 볼 수 있어."], { when: { visits: "return" } }),
    // loading / slow / error / offline
    R("load", "loading", ["오늘의 가격을 살펴보는 중…", "가격표를 펼치는 중이야…", "병원별 가격을 정리하는 중…", "같은 조건끼리 묶는 중이야…"], { cooldown: 2 }),
    R("slow", "slow", ["평소보다 오래 걸리고 있어. 인터넷 연결을 확인해 줄래?", "조금 느리네. 연결이 약하면 잠시 뒤에 다시 해 볼까?"]),
    R("error", "error", ["잠깐 문제가 생겼어. 다시 시도해 볼까?", "어라, 가격을 못 불러왔어. 한 번만 다시 눌러 줘.", "앗, 잠깐 꼬였어. 다시 시도하면 될 거야."]),
    R("offline", "error", ["인터넷이 끊겼나 봐. 저장해 둔 가격으로 보여줄게.", "지금은 오프라인이야. 마지막으로 받은 가격을 보여줄게."], { when: { offline: true }, priority: 2 }),
    // empty states
    R("empty.search", "emptySearch", ["아직 찾지 못했어. 검색 조건을 바꿔볼까?", "그 이름으로는 못 찾았어. 줄임말(예: 리쥬란, 보톡스)로 적어 볼래?", "찾는 가격이 없네. 용량이나 횟수를 빼고 다시 찾아볼까?", "아직 모은 병원에 없는 시술일 수 있어. 비슷한 이름으로 찾아볼까?"]),
    R("empty.cart", "emptyCart", ["아직 담은 시술이 없네!", "장바구니가 비어 있어.", "아직 비어 있어! 관심 있는 시술을 담아 봐."]),
    R("empty.cartSub", "emptyCartSub", ["관심 있는 시술을 담으면 병원별 비용을 비교할 수 있어.", "시술을 담으면 한 곳에서 받을 때와 나눠 받을 때 합계를 보여줄게."]),
    // done
    R("done.saved", "saved", ["저장했어! 관심 탭에서 다시 볼 수 있어.", "관심에 넣어 뒀어. 가격이 바뀌면 앱을 열 때 알려줄게.", "기억해 둘게! 관심 탭에 있어."]),
    R("done.added", "added", ["담았어! 장바구니에서 병원별로 비교해 볼 수 있어.", "장바구니에 쏙! 병원별 합계를 볼 수 있어.", "담아 뒀어. 같은 병원에서 다 받을 때 얼마인지 볼까?"]),
    R("done.alert", "alertSet", ["좋아! 조건이 맞으면 알려줄게.", "알림을 걸어 뒀어. 가격은 주 1회 모아서 그때 확인해.", "알겠어! 새 가격이 들어오면 확인할게."]),
    R("tip.guide", "guideTip", ["스킨보톡스랑 주름보톡스는 뭐가 다를까? 이름이 비슷한 시술을 쉽게 정리했어.", "이름이 비슷해도 놓는 곳이 달라. 시술 사전에서 한눈에 봐 줘."]),
    // fixed lines: safety and scope — one wording, never varied
    R("scope.not", "doesNot", ["나는 의료진이 아니라서 진단이나 시술 추천은 하지 않아. 정보만 정리해 줄게."], { fixed: true, cooldown: 0 }),
    R("concern.ask", "concernAsk", ["어떤 점이 고민인지 편하게 적어줘. 관련된 일반 정보와 시술 설명, 확인할 위험과 한계를 찾아볼게."], { fixed: true, cooldown: 0 }),
    R("concern.found", "concernFound", ["적어 준 말과 관련된 정보를 찾아봤어. 결정은 꼭 의료진과 상담해서 해 줘."], { fixed: true, cooldown: 0 }),
  ];

  const visitsOf = (n) => (n <= 1 ? "first" : n >= 5 ? "regular" : "return");
  function holds(rec, ctx) {
    const w = rec.when;
    if (w.visits && w.visits !== visitsOf(ctx.visits || 1) && !(w.visits === "return" && visitsOf(ctx.visits || 1) === "regular")) return false;
    if (w.hour) { const h = ctx.hour ?? 12, hh = h < w.hour[0] ? h + 24 : h; if (!(hh >= w.hour[0] && hh < w.hour[1])) return false; }
    if (w.offline != null && !!ctx.offline !== w.offline) return false;
    return true;
  }
  // → { id, text, rec } | null. recent: ids 'recordId#variant' used lately (newest last), kept by the caller (≤ 20)
  function pick(intent, ctx = {}, recent = [], rnd = Math.random) {
    const cands = RECORDS.filter((r) => r.intent === intent && holds(r, ctx));
    if (!cands.length) return null;
    const top = Math.max(...cands.map((r) => r.priority)), recs = cands.filter((r) => r.priority === top);
    const all = recs.flatMap((r) => r.variants.map((t, i) => ({ id: `${r.id}#${i}`, text: t, rec: r })));
    const fresh = all.filter((v) => v.rec.fixed || !recent.slice(-Math.max(v.rec.cooldown, 0)).includes(v.id));
    if (fresh.length) return fresh[Math.floor(rnd() * fresh.length) % fresh.length];
    // every variant was used lately: the one used longest ago (never the one just shown)
    return all.slice().sort((a, b) => recent.lastIndexOf(a.id) - recent.lastIndexOf(b.id))[0];
  }
  function stats() {
    const intents = new Set(RECORDS.map((r) => r.intent));
    return { intents: intents.size, records: RECORDS.length, variants: RECORDS.reduce((s, r) => s + r.variants.length, 0), fixed: RECORDS.filter((r) => r.fixed).length };
  }
  // the copy rules every line must keep (tested): short, no won amounts, no dose / diagnosis / guarantee / clinic pick
  const BANNED = /\d[\d,]*\s*원|진단해|처방|용량을?\s*(추천|권장)|효과\s*(보장|확실)|부작용\s*없|여기(가|로)\s*(제일|가장)|최저가/;
  const check = () => RECORDS.flatMap((r) => r.variants.filter((t) => t.length > 90 || BANNED.test(t)).map((t) => `${r.id}: ${t}`));
  return { RECORDS, pick, stats, check, visitsOf };
});
