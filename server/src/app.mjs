// 윤실장 commerce API (docs/MONETIZATION_ARCHITECTURE.md). One handler for Cloudflare Workers (worker.mjs) and tests.
// Every balance change goes through a commerce_* database function; this layer authenticates, validates, talks to providers
// with server-held secrets, and never lets the client choose a price, an amount, a product's credits or a job's outcome.
import { HttpError, fromDb, fetchT, json, cors, readJson, router, rateLimiter } from "./http.mjs";
import { verifyJwt } from "./auth.mjs";
import { paymentFlows } from "./payments/flow.mjs";
import { jobRunner } from "./jobs.mjs";
import { checkSubscription, runWatch } from "./push.mjs";
import PriceCtx from "../../app/domain/pricectx.js";
import Economics from "../../app/domain/economics.js";

const kstToday = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);

// price data for reports: the published data.json, cached for an hour (the same file the app shows)
export function dataLoader({ url, fetch: f = fetch, ttlMs = 3600000 }) {
  let cache = { at: 0, ctx: null, p: null };
  return async function ctx() {
    if (cache.ctx && Date.now() - cache.at < ttlMs) return cache.ctx;
    if (!cache.p) cache.p = (async () => {
      const r = await fetchT(f, url, { headers: { accept: "application/json" } }, 20000);
      if (!r.ok) throw new HttpError(503, "DATA_UNAVAILABLE", "가격 데이터를 불러오지 못했어요");
      const c = PriceCtx.fromData(await r.json(), kstToday());
      cache = { at: Date.now(), ctx: c, p: null };
      return c;
    })().finally(() => { cache.p = null; });
    return cache.p;
  };
}

export function createApp({ config, rpc: rawRpc, toss = null, demo = null, vision = null, ai = null, apple = null, google = null, loadCtx, fetch: f = fetch, rateStore = new Map(), log = () => {} }) {
  // database errors with a known code become typed HTTP errors; anything else stays a 500 (logged, never shown)
  const rpc = async (fn, p) => {
    try { return await rawRpc(fn, p); }
    catch (e) { if (e instanceof HttpError) throw e; const m = fromDb(e); if (m.code === "INTERNAL") throw e; throw m; }
  };
  const flows = paymentFlows({ rpc, toss, demo: config.demoPayments ? demo : null, log });
  const channels = [...(toss ? ["WEB_PG"] : []), ...(config.demoPayments && demo ? ["DEMO"] : []), ...(apple ? ["APPLE_IAP"] : []), ...(google ? ["GOOGLE_PLAY"] : [])];
  const limit = { job: rateLimiter(rateStore, 20, 60000), pay: rateLimiter(rateStore, 30, 60000), hook: rateLimiter(rateStore, 300, 60000), any: rateLimiter(rateStore, 120, 60000) };
  const r = router();
  const auth = async (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "");
    if (!m) throw new HttpError(401, "UNAUTHENTICATED", "로그인이 필요해요");
    return verifyJwt(m[1], { secret: config.supabase.jwtSecret, jwksUrl: config.supabase.url ? `${config.supabase.url}/auth/v1/.well-known/jwks.json` : null,
      issuer: config.supabase.url ? `${config.supabase.url}/auth/v1` : null, fetch: f });
  };
  const admin = async (req) => { const u = await auth(req); if (!u.admin) throw new HttpError(403, "FORBIDDEN", "관리자(2단계 인증)만 할 수 있어요"); return u; };
  const runner = async () => jobRunner({ rpc, ctx: await loadCtx(), vision, ai, aiLimits: config.openai || {} });

  // ---- public
  r.get("/v1/health", async () => ({ ok: true, mode: config.mode, channels, ai: !!vision }));
  r.get("/v1/catalog", async () => ({ ...(await rpc("commerce_catalog", { channels })), mode: config.mode,
    notice: config.mode === "PRODUCTION" ? null : "시연·테스트 환경이에요. 실제 돈이 오가지 않아요." }));
  r.get("/v1/shared/:token", async (req, p) => {
    if (!/^[0-9a-f]{64}$/.test(p.token)) throw new HttpError(404, "NOT_FOUND", "공유 링크를 찾지 못했어요");
    const s = await rpc("commerce_shared", { token: p.token });
    if (!s) throw new HttpError(404, "NOT_FOUND", "공유 링크를 찾지 못했어요");
    return s;
  });
  r.post("/v1/webhooks/toss", async (req) => {
    limit.hook(`hook:${req.headers.get("cf-connecting-ip") || "ip"}`);
    const out = await flows.tossWebhook(await readJson(req, 32 * 1024));
    return json(out.status, { result: out.result || null });
  });
  r.post("/v1/webhooks/apple", async (req) => {
    if (!apple) throw new HttpError(404, "NOT_FOUND", "없는 주소예요");
    const body = await readJson(req, 64 * 1024);
    const n = apple.parseNotification(body.signedPayload);
    await rpc("commerce_record_event", { provider: "APPLE", event_key: n.uuid, type: n.type, verified: "SIGNATURE", payload: { type: n.type, uuid: n.uuid } });
    if (n.refund) await storeRevocation(n.refund, "apple-notification");
    return { ok: true };
  });
  async function storeRevocation(rv, actor) {
    const pay = await rpc("commerce_payment", { provider: rv.provider, provider_payment_id: rv.provider_payment_id });
    if (!pay || pay.amount_krw - pay.refunded_krw <= 0) return null;
    return rpc("commerce_refund", { ...rv, amount: pay.amount_krw - pay.refunded_krw, provider_done: true, reason: `${rv.provider} 환불`, actor });
  }

  // ---- signed-in user
  r.get("/v1/wallet", async (req) => { const u = await auth(req); return rpc("commerce_wallet", { user_id: u.id }); });
  r.post("/v1/orders", async (req) => { const u = await auth(req); limit.pay(`pay:${u.id}`); return flows.createOrder(u, await readJson(req)); });
  r.post("/v1/checkout/toss/confirm", async (req) => { const u = await auth(req); limit.pay(`pay:${u.id}`); return flows.confirmToss(u, await readJson(req)); });
  r.post("/v1/checkout/demo/confirm", async (req) => { const u = await auth(req); limit.pay(`pay:${u.id}`); return flows.confirmDemo(u, await readJson(req)); });
  r.post("/v1/store/apple", async (req) => {
    if (!apple) throw new HttpError(404, "NOT_FOUND", "없는 주소예요");
    const u = await auth(req); limit.pay(`pay:${u.id}`);
    const t = apple.verifyTransaction((await readJson(req)).signedTransactionInfo);
    return rpc("commerce_store_grant", { ...t, user_id: u.id });
  });
  r.post("/v1/store/google", async (req) => {
    if (!google) throw new HttpError(404, "NOT_FOUND", "없는 주소예요");
    const u = await auth(req); limit.pay(`pay:${u.id}`);
    const body = await readJson(req), t = await google.verifyPurchase(body);
    const out = await rpc("commerce_store_grant", { ...t, user_id: u.id });
    if (!t.consumed) await google.consume(body);              // after the grant; a failed consume is retried by the app
    return out;
  });
  r.post("/v1/jobs", async (req) => {
    const u = await auth(req); limit.job(`job:${u.id}`);
    const body = await readJson(req, 12 * 1024 * 1024);          // an image job carries the (re-encoded) photo
    return (await runner()).run(u, body.feature, body.input, body.idempotency_key);
  });
  r.get("/v1/reports", async (req) => { const u = await auth(req); return rpc("commerce_reports", { user_id: u.id }); });
  r.get("/v1/reports/:id", async (req, p) => {
    const u = await auth(req);
    const rep = await rpc("commerce_report", { report_id: p.id, user_id: u.id }).catch(() => null);   // reopening is free
    if (!rep) throw new HttpError(404, "REPORT_NOT_FOUND", "보고서를 찾지 못했어요");
    return rep;
  });
  r.post("/v1/reports/:id/share", async (req, p) => {
    const u = await auth(req);
    const out = await rpc("commerce_share_report", { report_id: p.id, user_id: u.id });
    if (!out.token) throw new HttpError(400, "NOT_SHAREABLE", "공유할 수 있는 요약이 없는 보고서예요");
    return out;
  });
  r.del("/v1/reports/:id", async (req, p) => { const u = await auth(req); return rpc("commerce_delete_report", { report_id: p.id, user_id: u.id }); });
  r.post("/v1/reports/:id/corrections", async (req, p) => { const u = await auth(req); limit.any(`any:${u.id}`); return (await runner()).correct(u, p.id, (await readJson(req)).edits); });
  r.post("/v1/reports/:id/ask", async (req, p) => { const u = await auth(req); limit.job(`job:${u.id}`); return (await runner()).ask(u, p.id, (await readJson(req)).question); });
  r.post("/v1/push/subscribe", async (req) => { const u = await auth(req); limit.any(`any:${u.id}`); return rpc("commerce_push_subscribe", { user_id: u.id, ...checkSubscription(await readJson(req)) }); });
  r.post("/v1/watch/rules", async (req) => {
    const u = await auth(req); limit.any(`any:${u.id}`);
    const b = await readJson(req), ctx = await loadCtx();
    if (typeof b.key_id !== "string" || ctx.label(b.key_id) === b.key_id) throw new HttpError(400, "BAD_REQUEST", "지켜볼 시술을 골라 주세요");
    if (!["watch", "target", "newlow", "newmatch"].includes(b.kind)) throw new HttpError(400, "BAD_REQUEST", "알림 종류가 올바르지 않아요");
    const hr = (v) => (Number.isInteger(v) && v >= 0 && v <= 23 ? v : null);
    return rpc("commerce_watch_rule", { user_id: u.id, key_id: b.key_id, kind: b.kind, target_krw: Number.isInteger(b.target_krw) && b.target_krw > 0 ? b.target_krw : null,
      region: ctx.regions().includes(b.region) ? b.region : "전국", quiet_start: hr(b.quiet_start ?? 22), quiet_end: hr(b.quiet_end ?? 8) });
  });
  r.get("/v1/notices", async (req) => { const u = await auth(req); return rpc("commerce_notices", { user_id: u.id }); });

  // ---- admin (role admin + aal2, audited in the database functions)
  r.post("/v1/admin/refund", async (req) => { const a = await admin(req); return flows.adminRefund(a, await readJson(req)); });
  r.post("/v1/admin/promo", async (req) => { const a = await admin(req); const b = await readJson(req); return rpc("commerce_grant_promo", { user_id: b.user_id, amount: b.amount, reason: b.reason, idempotency_key: b.idempotency_key, actor: `admin:${a.id}` }); });
  r.post("/v1/admin/adjust", async (req) => { const a = await admin(req); const b = await readJson(req); return rpc("commerce_admin_adjust", { user_id: b.user_id, bucket: b.bucket, delta: b.delta, reason: b.reason, idempotency_key: b.idempotency_key, actor: `admin:${a.id}` }); });
  r.get("/v1/admin/economics", async (req) => { await admin(req); const q = new URL(req.url).searchParams; return rpc("commerce_economics", { from: q.get("from"), to: q.get("to") }); });
  // admin dashboard (5.1): DB sums are ACTUAL; fees and contribution margin are ESTIMATE (assumed fee rates until the contract
  // rates are entered), always labelled; data freshness from the published price file
  r.get("/v1/admin/dashboard", async (req) => {
    await admin(req);
    const d = await rpc("commerce_admin_dashboard", {});
    const A = Economics.ASSUMPTIONS, vatOf = (g) => Math.round(g - g / (1 + A.vat_rate));
    const byCh = {};
    for (const x of d.revenue_daily) { const c = byCh[x.channel] || (byCh[x.channel] = { gross_krw: 0, orders: 0 }); c.gross_krw += +x.gross_krw; c.orders += +x.orders; }
    const aiCost = d.ai_daily.reduce((s, x) => s + +x.cost_krw, 0), refunds = d.refunds_daily.reduce((s, x) => s + +x.krw, 0);
    const channels = Object.entries(byCh).map(([ch, c]) => {
      const fee = Math.round(c.gross_krw * ((A.fees[ch] || A.fees.WEB_PG).rate));
      return { channel: ch, orders: c.orders, gross_krw: { value: c.gross_krw, kind: "ACTUAL" }, vat_krw: { value: vatOf(c.gross_krw), kind: "ACTUAL_RATE" },
        fee_krw: { value: fee, kind: "ESTIMATE", basis: (A.fees[ch] || A.fees.WEB_PG).label } };
    });
    const real = channels.filter((c) => c.channel !== "DEMO");
    const net = real.reduce((s, c) => s + c.gross_krw.value - c.vat_krw.value - c.fee_krw.value, 0);
    let fresh = null;
    try { const c = await loadCtx(); fresh = { updated: c.updated, days_old: Math.round((Date.parse(kstToday()) - Date.parse(c.updated)) / 86400000), kind: "ACTUAL" }; } catch (e) { fresh = { error: "DATA_UNAVAILABLE" }; }
    return { ...d, channels_30d: channels,
      contribution_margin_30d: { value: Math.round(net - refunds - aiCost - (+(d.service_costs_30d.ACTUAL || 0))), kind: "ESTIMATE",
        basis: "실결제 채널(DEMO 제외) 매출 − 부가세 − 수수료(가정) − 환불 − AI 비용(실측) − 서비스 비용(ACTUAL만)" },
      data_freshness: fresh, crawl_status: { source: "GitHub Actions(weekly.yml) — 앱 운영 화면에서 실행 기록을 직접 확인", kind: "EXTERNAL" } };
  });
  r.post("/v1/admin/reconcile", async (req) => { await admin(req); return flows.reconcile(); });

  async function handle(req) {
    const h = cors(req, config.origins);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url), m = r.match(req.method, url.pathname);
    try {
      if (!m) throw new HttpError(404, "NOT_FOUND", "없는 주소예요");
      const out = await m.fn(req, m.params);
      if (out instanceof Response) { for (const [k, v] of Object.entries(h)) out.headers.set(k, v); return out; }
      return json(200, out, h);
    } catch (e) {
      const err = e instanceof HttpError ? e : (log("unhandled", { path: url.pathname, message: String(e && e.message).slice(0, 200) }), new HttpError(500, "INTERNAL", "잠시 후 다시 시도해 주세요"));
      return json(err.status, { error: err.code, message: err.message, detail: err.code === "INTERNAL" ? null : err.detail ?? null }, h);
    }
  }
  // scheduled (Cron Trigger): reconcile payments, release stuck jobs, run price watch after a data update
  async function scheduled(kind = "all") {
    const out = {};
    if (kind === "all" || kind === "reconcile") out.reconcile = await flows.reconcile();
    if ((kind === "all" || kind === "reconcile") && google) {          // Google refunds (Voided Purchases API, last 3 days) → revocations
      let n = 0;
      for (const rv of await google.voided({ startTimeMillis: Date.now() - 3 * 86400000 }).catch(() => [])) { if (await storeRevocation(rv, "google-voided").catch(() => null)) n++; }
      out.google_voided = n;
    }
    if (kind === "all" || kind === "watch") out.watch = await runWatch({ rpc, ctx: await loadCtx(), vapid: config.push, fetch: f });
    return out;
  }
  return { fetch: handle, scheduled, flows };
}
