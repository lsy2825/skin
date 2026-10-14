// 단위 경제성 계산 (docs/PRICING_AND_UNIT_ECONOMICS.md). Every input is an ASSUMPTION until a contract / invoice exists:
// payment fees, store commission and AI cost per job are written next to the number as 가정 and replaced by measured values
// (orders, payment_refunds, ai_usage_records, service_cost_records → commerce_economics) once the server runs.
// Used by the ops screen card, tools/unit_economics.js and tests. Pure functions.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Economics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const ASSUMPTIONS = {
    vat_rate: 0.10,                       // 부가가치세 10% (가격은 부가세 포함으로 표시)
    fees: {                               // 결제 수수료 — 가정, 계약 전 확인 필요
      WEB_PG: { rate: 0.033, fixed: 0, label: "웹 결제(PG) 3.3% 가정 — 토스페이먼츠 계약 요율 확인 필요" },
      APPLE_IAP: { rate: 0.30, fixed: 0, label: "Apple 30% 가정(소규모 사업자 프로그램 15% 가능 — 가입 여부 확인 필요)" },
      GOOGLE_PLAY: { rate: 0.15, fixed: 0, label: "Google Play 15% 가정(연 100만 달러 이하 구간 — 정책 확인 필요)" },
      DEMO: { rate: 0, fixed: 0, label: "시연: 돈 없음" },
    },
    // 기능 1회당 외부 비용(원) — 가정. AI 기능만 모델 호출이 있고, 나머지는 모은 가격으로 계산(서버 비용만)
    cost_per_job: { EVENT_IMAGE_DECODER: 25, JOMI_QA_SESSION: 10, EVENT_URL_DECODER: 1, MULTI_EVENT_COMPARE: 1, QUOTATION_DECODER: 1, PRODUCT_DEEP_COMPARE: 1,
      PRICE_HISTORY_REPORT: 1, REGIONAL_PRICE_REPORT: 1, ADVANCED_CART_PLANNER: 2, PRICE_WATCH_7D: 2, PRICE_WATCH_30D: 6, CONSOLIDATED_REPORT: 2 },
  };
  // one pack on one channel: what is left of the price after VAT and the payment fee
  function pack(p, channel, a = ASSUMPTIONS) {
    const vat = p.vat_included ? Math.round(p.price_krw - p.price_krw / (1 + a.vat_rate)) : 0;
    const f = a.fees[channel] || a.fees.WEB_PG;
    const fee = Math.round(p.price_krw * f.rate + f.fixed);       // fees are charged on the VAT-inclusive amount
    const net = p.price_krw - vat - fee;
    return { code: p.code, channel, price_krw: p.price_krw, vat, fee, net, credits: p.credits, net_per_credit: Math.round((net / p.credits) * 10) / 10, fee_note: f.label };
  }
  // a feature's margin at a given net value per credit (the worst pack decides: the cheapest credit a buyer can get)
  function features(featureCredits, netPerCredit, a = ASSUMPTIONS) {
    return Object.entries(featureCredits).map(([code, credits]) => {
      const revenue = Math.round(credits * netPerCredit), cost = a.cost_per_job[code] ?? 0;
      return { code, credits, revenue, cost, margin: revenue - cost, margin_rate: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null, ok: revenue - cost > 0 };
    });
  }
  function table(products, featureCredits, channel = "WEB_PG", a = ASSUMPTIONS) {
    const packs = products.map((p) => pack(p, channel, a));
    const worst = Math.min(...packs.map((x) => x.net_per_credit));
    return { channel, packs, worst_net_per_credit: worst, features: features(featureCredits, worst, a), assumptions: a };
  }
  return { ASSUMPTIONS, pack, features, table };
});
