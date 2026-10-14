// 죠미 심화 질문의 안전장치 — 앱(시연, 규칙 기반)과 서버(AI 답 검사)가 같은 규칙을 써요. docs/JOMI_AI_GUARDRAILS.md
//  screen(): 진단·용량·처방·임신·응급 질문은 크레딧 없이 정해진 안내로 답해요(모델 호출 없음).
//  facts():  답에 쓸 수 있는 유일한 재료 — 모은 가격(묶음별 지점 수·최저·중간값·최고), 데이터 날짜, 기록 주 수.
//  check():  답 속 금액은 모두 facts의 숫자여야 하고, 용량 권장·진단·효과 보장 표현은 안 돼요.
// window.JomiQA in the app (needs window.Search); require()d by tests and server/.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./search.js"));
  else root.JomiQA = factory(root.Search);
})(typeof self !== "undefined" ? self : this, function (Search) {
  "use strict";
  const RULES = [
    { code: "URGENT", rx: /숨\s*이?\s*(차|막|쉬기\s*힘)|호흡.?곤란|의식|실신|심하게\s*(붓|부어)|고열|피가\s*안\s*멈|시야|실명|괴사|아나필락시스/, msg: "지금 증상이 심하면 바로 시술한 병원이나 가까운 응급실(119)에 연락하세요. 죠미는 증상을 판단할 수 없어요." },
    { code: "DIAGNOSIS", rx: /진단|무슨\s*병|병인가|질환인가|이거\s*(뭐|무슨)\s*(피부|증상)|제\s*피부\s*상태|피부\s*타입\s*판단|사진\s*보고\s*판단/, msg: "피부 상태 판단(진단)은 의료진만 할 수 있어요. 죠미는 가격과 시술 이름만 알려 드려요." },
    { code: "DOSING", rx: /몇\s*(유닛|단위|U|cc|씨씨|샷|줄)\s*(맞|넣|해야|가\s*적당|이\s*적당|이\s*좋|가\s*좋)|용량\s*(얼마|몇|추천|권장)|적정\s*용량|얼마나\s*(맞|넣)아야/i, msg: "필요한 용량·샷 수는 얼굴과 상태를 본 의료진이 정해요. 죠미는 같은 용량끼리의 가격만 비교해 드려요." },
    { code: "PRESCRIPTION", rx: /처방|약\s*(이름|추천)|복용|먹는\s*약|연고\s*추천|항생제|스테로이드|이소트레티노인|로아큐탄/, msg: "약과 처방은 의사·약사에게 물어보세요." },
    { code: "PREGNANCY", rx: /임신|수유|임산부/, msg: "임신·수유 중 시술 가능 여부는 꼭 의료진과 상담하세요." },
  ];
  function screen(q) {
    const t = String(q || "").slice(0, 500);
    for (const r of RULES) if (r.rx.test(t)) return { blocked: true, code: r.code, answer: r.msg };
    if (t.trim().length < 2) return { blocked: true, code: "EMPTY", answer: "질문을 적어 주세요." };
    return { blocked: false };
  }

  // the comparison groups a question is about (label words that appear in the question), at most 3
  function facts(q, ctx) {
    const nq = Search.norm(q);
    const scored = [];
    for (const k of ctx.keys) {
      const hit = k.words.filter((w) => w.length >= 2 && nq.includes(w)).length;
      if (hit) scored.push({ k, s: hit / k.words.length + hit * 0.1 });
    }
    scored.sort((a, b) => b.s - a.s);
    const out = [];
    for (const { k } of scored.slice(0, 3)) {
      const ps = ctx.prices(k.id, "").map((x) => x.p).sort((a, b) => a - b);
      if (!ps.length) continue;
      const weeks = ((ctx.trend.k || {})[k.id] || []).filter(Boolean).length;
      out.push({ id: k.id, label: k.label, n: ps.length, min: ps[0], median: ps[ps.length >> 1], max: ps[ps.length - 1], weeks });
    }
    return { updated: ctx.updated, groups: out };
  }
  const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;
  function deterministicAnswer(f) {
    if (!f.groups.length) return "질문에 나온 시술 이름으로 모은 가격 묶음을 찾지 못했어요. 시술 이름(예: 리쥬란힐러 2cc)을 넣어 다시 물어봐 주세요.";
    return f.groups.map((g) => `${g.label}: 지점 ${g.n}곳, 가장 낮은 ${won(g.min)} · 중간값 ${won(g.median)} · 가장 높은 ${won(g.max)}` +
      (g.weeks >= 2 ? ` (가격 기록 ${g.weeks}주)` : "")).join("\n") + `\n(${f.updated} 기준 병원 표시가. 조건·부가세는 병원마다 달라요.)`;
  }
  // every won amount, also '12만 9천원', '9만원', '9천원', '12만 9,000원' (5.1 audit: compound amounts slipped past the check)
  const NUMS = (t) => [...String(t).matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(만)?\s*(?:(\d{1,3}(?:,\d{3})*|\d+)\s*(천)?)?\s*(천)?\s*원/g)].map((m) => {
    const a = +m[1].replace(/,/g, ""), b = m[3] ? +m[3].replace(/,/g, "") : 0;
    if (m[2]) return Math.round(a * 10000 + (m[4] ? b * 1000 : b));
    if (m[5]) return Math.round(a * 1000);
    return Math.round(a);
  });
  const BANNED = /(진단|처방)(해|합니다|드려)|(\d+\s*(U|유닛|cc|샷)\s*(을|를)?\s*(맞|권장|추천|넣))|효과(가)?\s*(보장|확실)|부작용(이)?\s*(없|전혀)/i;
  function check(answer, f) {
    const allowed = new Set(f.groups.flatMap((g) => [g.min, g.median, g.max]));
    const bad = NUMS(answer).filter((n) => !allowed.has(n));
    if (bad.length) return { ok: false, reason: `근거에 없는 금액 ${bad.slice(0, 3).join(", ")}` };
    if (BANNED.test(answer)) return { ok: false, reason: "의료 판단·용량·효과 보장 표현" };
    if (String(answer).length > 1200) return { ok: false, reason: "너무 긴 답" };
    return { ok: true };
  }

  return { screen, facts, deterministicAnswer, check };
});
