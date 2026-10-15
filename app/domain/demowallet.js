// 6.0: no credits — the server ledger it mirrored (supabase/monetization.sql) was removed in chat A's A3. Kept only until A6
// takes the credit card off the ops screen (app/screens/ops.js); then it goes with app.js's loader (OPS_ECON_JS).
// 시연 지갑 (DEMO mode only — docs/MONETIZATION_ARCHITECTURE.md §DEMO, removed). No money moves and nothing here is a paid credit:
// it lets the store and premium screens be tried on one phone before the server exists. It follows the same rules as the
// server ledger (supabase/monetization.sql) so the screens behave the same later: an append-only list of entries, orders
// with a price snapshot, promo credits spent first, reserve → capture on a usable result / release otherwise, one job per
// idempotency key, a 0-credit job inside an entitlement window, ad-free days extended from the later of now and the current end.
// In SANDBOX / PRODUCTION the app never uses this: balances come from the server only.
// window.DemoWallet in the app; require()d by tests. Pure functions over a plain state object (the caller saves it).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DemoWallet = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // mirrors supabase/commerce_seed.sql (version 1, DEMO channel) — tests/commerce.test.js checks they agree
  const PRODUCTS = [
    // catalog version 2 (round 2): no ad-free bonus — the app shows no ads (supabase/commerce_seed.sql)
    { code: "MINI", version: 2, price_krw: 990, vat_included: true, credits: 5, adfree_days: 0 },
    { code: "STANDARD", version: 2, price_krw: 1990, vat_included: true, credits: 12, adfree_days: 0 },
    { code: "PLUS", version: 2, price_krw: 3900, vat_included: true, credits: 26, adfree_days: 0 },
  ];
  // sold: the three tools on sale (round-2 BIZ01, docs/PRODUCT_DECISIONS.md); the others stay defined for old reports but
  // cannot be reserved — the same rule as the server's premium_features.active
  const FEATURES = {
    EVENT_IMAGE_DECODER: { credits: 1, days: 0, title: "AI 이벤트 사진 읽기" }, EVENT_URL_DECODER: { credits: 1, days: 0, title: "공개 이벤트 주소·글 읽기", sold: true },
    MULTI_EVENT_COMPARE: { credits: 2, days: 0, title: "이벤트 여러 개 비교", sold: true }, QUOTATION_DECODER: { credits: 1, days: 0, title: "견적·패키지 읽기", sold: true },
    JOMI_QA_SESSION: { credits: 1, days: 0, title: "죠미 심화 질문(한 세션 5문답)" }, PRODUCT_DEEP_COMPARE: { credits: 1, days: 0, title: "제품 심층 비교 보고서" },
    PRICE_HISTORY_REPORT: { credits: 1, days: 0, title: "가격 이력 보고서" }, REGIONAL_PRICE_REPORT: { credits: 1, days: 0, title: "지역 가격 보고서" },
    ADVANCED_CART_PLANNER: { credits: 2, days: 30, title: "고급 장바구니 계획(30일 다시 계산)" }, PRICE_WATCH_7D: { credits: 1, days: 7, title: "가격 지켜보기 7일" },
    PRICE_WATCH_30D: { credits: 3, days: 30, title: "가격 지켜보기 30일" }, CONSOLIDATED_REPORT: { credits: 2, days: 0, title: "종합 보고서" },
  };
  const DAY = 86400000;
  const empty = () => ({ v: 1, demo: true, tx: [], orders: {}, jobs: {}, reports: [], ent: [], adfree_until: null, seq: 0 });
  const load = (raw) => (raw && raw.v === 1 && raw.demo === true && Array.isArray(raw.tx) ? raw : empty());
  const id = (s, p) => `${p}${(++s.seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const post = (s, e, now) => { if (s.tx.some((x) => x.key === e.key)) return false; s.tx.push({ ...e, at: new Date(now).toISOString() }); return true; };

  function balance(s) {
    const sum = (bucket, f) => s.tx.filter((x) => x.bucket === bucket).reduce((a, x) => a + x[f], 0);
    const paid = sum("PAID", "eb"), promo = sum("PROMO", "eb"), pr = sum("PAID", "er"), qr = sum("PROMO", "er");
    return { paid, promo, paid_reserved: pr, promo_reserved: qr, available: paid - pr + promo - qr };
  }
  const adFree = (s, now) => (s.adfree_until && Date.parse(s.adfree_until) > now ? s.adfree_until : null);

  // a demo purchase: the order keeps the price it was made at; the same key never grants twice
  function buy(s, code, key, now = Date.now()) {
    const p = PRODUCTS.find((x) => x.code === code);
    if (!p) throw new Error("PRODUCT_NOT_FOR_SALE");
    if (s.orders[key]) return { order: s.orders[key], already: true };
    const o = { id: id(s, "o"), code, version: p.version, amount_krw: p.price_krw, vat_included: p.vat_included, credits: p.credits, adfree_days: p.adfree_days, channel: "DEMO", status: "FULFILLED", at: new Date(now).toISOString() };
    s.orders[key] = o;
    post(s, { key: `grant:${o.id}`, type: "PURCHASE_GRANTED", bucket: "PAID", amount: p.credits, eb: p.credits, er: 0, ref: o.id, note: `${code} 시연 구매` }, now);
    if (p.adfree_days) s.adfree_until = new Date(Math.max(now, s.adfree_until ? Date.parse(s.adfree_until) : 0) + p.adfree_days * DAY).toISOString();
    return { order: o, already: false };
  }
  function grantPromo(s, n, reason, key, now = Date.now()) {
    if (!(n > 0 && n <= 100) || !reason) throw new Error("BAD_REQUEST");
    return post(s, { key: `promo:${key}`, type: "PROMOTIONAL_GRANTED", bucket: "PROMO", amount: n, eb: n, er: 0, note: reason }, now);
  }
  const sameScope = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
  function reserve(s, feature, key, scope = {}, now = Date.now(), o = {}) {
    const f = FEATURES[feature];
    if (!f || (!f.sold && !o.anyFeature)) throw new Error("FEATURE_NOT_AVAILABLE");   // anyFeature: mechanism tests only
    if (s.jobs[key]) return { job: s.jobs[key], repeat: true };
    const covered = s.ent.some((e) => e.feature === feature && Date.parse(e.ends_at) > now && sameScope(e.scope, scope));
    const need = covered ? 0 : f.credits, b = balance(s);
    const promo = Math.min(need, b.promo - b.promo_reserved), paid = need - promo;
    if (paid > b.paid - b.paid_reserved) { const e = new Error("INSUFFICIENT_CREDITS"); e.need = need; e.available = b.available; throw e; }
    const j = { id: id(s, "j"), feature, credits: need, promo, paid, status: "RESERVED", scope, at: new Date(now).toISOString(), expires: new Date(now + 600000).toISOString() };
    s.jobs[key] = j;
    if (promo) post(s, { key: `reserve:${j.id}:PROMO`, type: "CREDIT_RESERVED", bucket: "PROMO", amount: promo, eb: 0, er: promo, ref: j.id, note: f.title }, now);
    if (paid) post(s, { key: `reserve:${j.id}:PAID`, type: "CREDIT_RESERVED", bucket: "PAID", amount: paid, eb: 0, er: paid, ref: j.id, note: f.title }, now);
    return { job: j, repeat: false, covered };
  }
  const jobById = (s, jid) => Object.values(s.jobs).find((j) => j.id === jid);
  function capture(s, jid, report, now = Date.now()) {
    const j = jobById(s, jid);
    if (!j) throw new Error("JOB_NOT_FOUND");
    if (j.status === "SUCCEEDED") return { already: true, report_id: j.report_id };
    if (j.status === "RELEASED") throw new Error("JOB_RELEASED");
    if (!report || !report.title) throw new Error("NO_DELIVERABLE");
    if (j.promo) post(s, { key: `capture:${j.id}:PROMO`, type: "CREDIT_CAPTURED", bucket: "PROMO", amount: j.promo, eb: -j.promo, er: -j.promo, ref: j.id, note: FEATURES[j.feature].title }, now);
    if (j.paid) post(s, { key: `capture:${j.id}:PAID`, type: "CREDIT_CAPTURED", bucket: "PAID", amount: j.paid, eb: -j.paid, er: -j.paid, ref: j.id, note: FEATURES[j.feature].title }, now);
    const r = { id: id(s, "r"), job_id: j.id, feature: j.feature, credits: j.credits, kind: report.kind, title: report.title, payload: report.payload, share_summary: report.share_summary || null, at: new Date(now).toISOString() };
    s.reports.unshift(r);
    if (s.reports.length > 60) s.reports.length = 60;                // a phone keeps the latest 60 demo reports
    const days = FEATURES[j.feature].days;
    if (days && j.credits > 0) s.ent.push({ feature: j.feature, scope: j.scope, job_id: j.id, ends_at: new Date(now + days * DAY).toISOString() });
    j.status = "SUCCEEDED"; j.report_id = r.id;
    return { already: false, report_id: r.id };
  }
  function release(s, jid, reason, now = Date.now()) {
    const j = jobById(s, jid);
    if (!j || j.status !== "RESERVED") return { changed: false };
    if (j.promo) post(s, { key: `release:${j.id}:PROMO`, type: "CREDIT_RELEASED", bucket: "PROMO", amount: j.promo, eb: 0, er: -j.promo, ref: j.id, note: reason }, now);
    if (j.paid) post(s, { key: `release:${j.id}:PAID`, type: "CREDIT_RELEASED", bucket: "PAID", amount: j.paid, eb: 0, er: -j.paid, ref: j.id, note: reason }, now);
    j.status = "RELEASED"; j.reason = reason;
    return { changed: true };
  }
  // a reserved job older than its deadline (the app was closed mid-run) goes back
  function expire(s, now = Date.now()) { let n = 0; for (const j of Object.values(s.jobs)) if (j.status === "RESERVED" && Date.parse(j.expires) < now) { release(s, j.id, "TIMEOUT", now); n++; } return n; }
  const entitlement = (s, feature, now = Date.now()) => s.ent.filter((e) => (Array.isArray(feature) ? feature.includes(e.feature) : e.feature === feature) && Date.parse(e.ends_at) > now)
    .sort((a, b) => b.ends_at.localeCompare(a.ends_at))[0] || null;
  function updateReport(s, rid, payload) { const r = s.reports.find((x) => x.id === rid); if (!r) throw new Error("REPORT_NOT_FOUND"); r.payload = payload; return r; }
  function deleteReport(s, rid) { const i = s.reports.findIndex((x) => x.id === rid); if (i < 0) return false; s.reports.splice(i, 1); return true; }
  // the projection equals the entries (the same check as commerce_verify_wallet)
  function verify(s) {
    const b = balance(s), open = Object.values(s.jobs).filter((j) => j.status === "RESERVED");
    return b.paid >= 0 && b.promo >= 0 && b.paid_reserved === open.reduce((a, j) => a + j.paid, 0) && b.promo_reserved === open.reduce((a, j) => a + j.promo, 0);
  }
  return { PRODUCTS, FEATURES, empty, load, balance, adFree, buy, grantPromo, reserve, capture, release, expire, entitlement, updateReport, deleteReport, verify };
});
