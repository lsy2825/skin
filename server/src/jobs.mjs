// Premium job runner (docs/CREDIT_LEDGER_SPEC.md §Reservations). For every paid feature:
//   validate input → can the data support it? (refused for free) → reserve (idempotent per client key) → run →
//   usable deliverable? capture + store the report : release. Any exception or timeout releases; a crash is released by the
//   scheduled commerce_expire_jobs. The client never says what a job costs or whether it succeeded.
import Premium from "../../app/domain/premium.js";
import OfferParse from "../../app/domain/offerparse.js";
import { HttpError, fromDb } from "./http.mjs";
import { checkImage, fetchPublicText, sha256Hex } from "./safe.mjs";
import * as Jomi from "./ai/jomi.mjs";

const FEATURES = new Set(["EVENT_IMAGE_DECODER", "EVENT_URL_DECODER", "MULTI_EVENT_COMPARE", "QUOTATION_DECODER", "JOMI_QA_SESSION", "PRODUCT_DEEP_COMPARE",
  "PRICE_HISTORY_REPORT", "REGIONAL_PRICE_REPORT", "ADVANCED_CART_PLANNER", "PRICE_WATCH_7D", "PRICE_WATCH_30D", "CONSOLIDATED_REPORT"]);
const KEY = /^[A-Za-z0-9_:-]{8,80}$/;
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

// only the fields each feature uses, bounded; anything else in the request is ignored
export function cleanInput(feature, x, ctx) {
  const key = (v) => (typeof v === "string" && ctx.label(v) !== v ? v : null);
  const region = (v) => (typeof v === "string" && ctx.regions().includes(v) ? v : "");
  switch (feature) {
    case "EVENT_URL_DECODER": return x.url ? { url: str(x.url, 2000), region: region(x.region) } : { text: str(x.text, OfferParse.MAX_TEXT), region: region(x.region) };
    case "QUOTATION_DECODER": return { text: str(x.text, OfferParse.MAX_TEXT), region: region(x.region) };
    case "MULTI_EVENT_COMPARE": return { texts: (Array.isArray(x.texts) ? x.texts : []).slice(0, 4).map((t) => str(t, OfferParse.MAX_TEXT)).filter(Boolean), region: region(x.region) };
    case "EVENT_IMAGE_DECODER": return { image: str(x.image, 12_000_000), region: region(x.region) };
    case "JOMI_QA_SESSION": return { question: str(x.question, 500) };
    case "PRODUCT_DEEP_COMPARE": return { a: key(x.a), b: key(x.b), region: region(x.region) };
    case "PRICE_HISTORY_REPORT": case "REGIONAL_PRICE_REPORT": return { key: key(x.key) };
    case "ADVANCED_CART_PLANNER": return { items: (Array.isArray(x.items) ? x.items : []).slice(0, 12).map((i) => ({ k: key(i && i.k), q: Math.min(Math.max(1, +(i && i.q) || 1), 20) })).filter((i) => i.k),
      region: region(x.region), budget: Number.isInteger(x.budget) && x.budget > 0 && x.budget < 1e8 ? x.budget : null };
    case "PRICE_WATCH_7D": case "PRICE_WATCH_30D": return {};
    case "CONSOLIDATED_REPORT": return { items: cleanInput("ADVANCED_CART_PLANNER", x, ctx).items, keys: (Array.isArray(x.keys) ? x.keys : []).slice(0, 5).map(key).filter(Boolean) };
  }
  throw new HttpError(400, "FEATURE_NOT_AVAILABLE", "지금 쓸 수 없는 기능이에요");
}
// the scope an entitlement covers (planner: the same cart and region recomputed for 30 days is free)
const scopeOf = (feature, input) => feature === "ADVANCED_CART_PLANNER" ? { items: input.items.map((i) => `${i.k}x${i.q}`).sort(), region: input.region || "" } : {};

export function jobRunner({ rpc, ctx, vision, ai, fetchText = fetchPublicText, now = () => new Date() }) {
  async function deliver(feature, input, job, user) {
    const today = ctx.today, year = +today.slice(0, 4);
    switch (feature) {
      case "EVENT_IMAGE_DECODER": {
        if (!vision) throw new HttpError(503, "AI_NOT_CONFIGURED", "사진 읽기는 아직 준비 중이에요");
        const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.image);
        const r = await vision.extract(input.image, { jobId: job.id, userId: user.id, year });
        if (!r.ok) return { fail: `AI_${r.error}`, cost: r.cost_krw };
        if (r.result.not_price_document) return { fail: "NOT_A_PRICE_DOCUMENT", cost: r.cost_krw };
        const rep = Premium.build("EVENT_IMAGE_DECODER", { parsed: r.result, region: input.region, source: "IMAGE" }, ctx);
        rep.payload.ai = { calls: r.calls.map((c) => ({ kind: c.kind, ok: c.ok })), note: "사진에서 읽은 값은 확인이 필요해요. 고친 값으로 다시 맞춰도 크레딧이 들지 않아요." };
        rep.payload.image = { mime: m && m[1], stored: false };   // the original is not kept (docs/AI_VISION_PIPELINE.md §Privacy)
        return { rep, cost: r.cost_krw };
      }
      case "EVENT_URL_DECODER": {
        let text = input.text, source = "TEXT";
        if (input.url) { const pg = await fetchText(input.url); text = pg.text; source = "URL"; }
        const rep = Premium.build(feature, { text, region: input.region, source }, ctx);
        if (input.url) rep.payload.url = input.url;
        return { rep };
      }
      case "JOMI_QA_SESSION": {
        const a = await Jomi.answer(input.question, ctx, { ai, rpc, jobId: job.id, userId: user.id });
        return { rep: { kind: "JOMI_QA", title: `죠미 심화 질문 · ${input.question.slice(0, 24)}`, payload: { turns: [{ q: input.question, ...a, at: now().toISOString() }], max_turns: 5, data_updated: ctx.updated }, share_summary: null } };
      }
      case "PRICE_WATCH_7D": case "PRICE_WATCH_30D": {
        const days = feature === "PRICE_WATCH_7D" ? 7 : 30;
        return { rep: { kind: "PRICE_WATCH", title: `가격 지켜보기 ${days}일`, payload: { days, note: "가격은 주 1회 모아요. 알림은 새 데이터가 들어온 뒤에 보내요(실시간 아님).", data_updated: ctx.updated }, share_summary: null }, entitlementOnly: true };
      }
      default: return { rep: Premium.build(feature, input, ctx) };
    }
  }
  const usable = (feature, d) => d.rep && (d.entitlementOnly || feature === "JOMI_QA_SESSION" ? !!d.rep.title : Premium.usable(d.rep));

  return {
    // → { status: 'SUCCEEDED', report_id, credits, repeat?, wallet } | throws HttpError (credits released / never taken)
    async run(user, feature, raw, idempotencyKey) {
      if (!FEATURES.has(feature)) throw new HttpError(400, "FEATURE_NOT_AVAILABLE", "지금 쓸 수 없는 기능이에요");
      if (!KEY.test(idempotencyKey || "")) throw new HttpError(400, "BAD_REQUEST", "요청 키가 필요해요");
      const input = cleanInput(feature, raw || {}, ctx);
      // free checks first: nothing is reserved for a request that cannot produce a result
      if (feature === "EVENT_IMAGE_DECODER") {
        const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(input.image);
        if (!m) throw new HttpError(415, "BAD_IMAGE", "JPG·PNG·WebP 사진만 올릴 수 있어요");
        checkImage(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
      } else if (feature === "JOMI_QA_SESSION") {
        const s = Jomi.screen(input.question);
        if (s.blocked) return { status: "SCREENED", credits: 0, answer: s.answer, code: s.code };
      } else if (!(feature === "EVENT_URL_DECODER" && input.url) && !feature.startsWith("PRICE_WATCH")) {
        const a = Premium.available(feature, input, ctx);
        if (!a.ok) throw new HttpError(422, "NOT_ENOUGH_DATA", a.reason);
      }
      const hash = await sha256Hex(new TextEncoder().encode(feature + JSON.stringify(input)));
      let res;
      try { res = await rpc("commerce_reserve", { user_id: user.id, feature_code: feature, idempotency_key: idempotencyKey, input_hash: hash, scope: scopeOf(feature, input), timeout_seconds: 300 }); }
      catch (e) { throw fromDb(e); }
      const job = res.job;
      if (res.repeat) {
        if (job.input_hash !== hash) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "같은 요청 키로 다른 내용을 보낼 수 없어요");
        if (job.status === "SUCCEEDED") return { status: "SUCCEEDED", report_id: job.report_id, credits: job.credits, repeat: true };
        if (job.status === "RELEASED") throw new HttpError(409, "JOB_RELEASED", "이전 시도가 실패해 크레딧을 돌려드렸어요. 다시 시도해 주세요");
        throw new HttpError(409, "JOB_IN_PROGRESS", "같은 요청을 처리하고 있어요");
      }
      await rpc("commerce_start_job", { job_id: job.id });
      let d;
      try { d = await deliver(feature, input, job, user); }
      catch (e) {
        await rpc("commerce_release", { job_id: job.id, reason: String(e.code || e.message || "ERROR").slice(0, 100) });
        if (e instanceof HttpError) { e.detail = { released: true, credits: job.credits }; throw e; }
        throw new HttpError(502, "JOB_FAILED", "결과를 만들지 못해 크레딧을 돌려드렸어요");
      }
      if (d.fail || !usable(feature, d)) {
        const w = await rpc("commerce_release", { job_id: job.id, reason: d.fail || "NO_DELIVERABLE" });
        const msg = d.fail === "NOT_A_PRICE_DOCUMENT" ? "가격표나 이벤트 사진이 아니에요" : "읽을 수 있는 가격을 찾지 못했어요";
        const provider = d.fail && d.fail.startsWith("AI_");
        throw new HttpError(provider ? 502 : 422, d.fail || "NO_DELIVERABLE", provider ? "AI 분석이 실패했어요. 크레딧은 돌려드렸어요" : `${msg}. 크레딧은 돌려드렸어요`, { released: true, wallet: w.wallet });
      }
      let cap;
      try { cap = await rpc("commerce_capture", { job_id: job.id, report: { ...d.rep, retain_days: 365 } }); }
      catch (e) { throw fromDb(e); }   // JOB_RELEASED (timed out meanwhile): nothing was charged
      return { status: "SUCCEEDED", report_id: cap.report_id || cap.job.report_id, credits: job.credits, covered_by_entitlement: res.covered_by_entitlement, wallet: cap.wallet };
    },

    // free edits of a paid result: corrected offers re-matched (deterministic, no AI) / the next question of a Jomi session
    async correct(user, reportId, offers) {
      const rep = await rpc("commerce_report", { report_id: reportId, user_id: user.id });
      if (!rep || !rep.payload || !rep.payload.items) throw new HttpError(404, "REPORT_NOT_FOUND", "보고서를 찾지 못했어요");
      const list = (Array.isArray(offers) ? offers : []).slice(0, OfferParse.MAX_OFFERS).map((o) => ({
        ...OfferParse.parse(`${str(o.raw_offer_name, 200)} ${Number.isInteger(o.advertised_price) ? o.advertised_price : 0}원`, { year: +ctx.today.slice(0, 4) }).offers[0],
        user_corrected: true }));
      const items = list.filter(Boolean).map((o) => Premium.decodeOffer(o, ctx, rep.payload.region || ""));
      const payload = { ...rep.payload, items, corrected_at: now().toISOString() };
      const out = await rpc("commerce_update_report", { report_id: reportId, user_id: user.id, payload });
      return { report_id: out.id, items };
    },
    async ask(user, reportId, question) {
      const rep = await rpc("commerce_report", { report_id: reportId, user_id: user.id });
      if (!rep || rep.kind !== "JOMI_QA" || !rep.payload) throw new HttpError(404, "REPORT_NOT_FOUND", "대화를 찾지 못했어요");
      const turns = rep.payload.turns || [];
      if (turns.length >= (rep.payload.max_turns || 5)) throw new HttpError(409, "SESSION_FULL", "이 세션의 질문 5개를 다 썼어요");
      const a = await Jomi.answer(str(question, 500), ctx, { ai, rpc, jobId: rep.job_id, userId: user.id });
      turns.push({ q: str(question, 500), ...a, at: now().toISOString() });
      await rpc("commerce_update_report", { report_id: reportId, user_id: user.id, payload: { ...rep.payload, turns } });
      return { turn: turns[turns.length - 1], left: (rep.payload.max_turns || 5) - turns.length };
    },
  };
}
