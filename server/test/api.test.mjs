// Commerce API end to end on a real PostgreSQL with mocked providers (docs/PAYMENT_SANDBOX_QA.md). Toss, OpenAI, Apple,
// Google and the push service are stand-ins that behave like their documented APIs; nothing here talks to a real provider,
// so these tests prove our side of each contract — not that a provider sandbox accepted a payment.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshDb } from "./db.mjs";
import { createApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { signHs256 } from "../src/auth.mjs";
import { tossAdapter, demoAdapter } from "../src/payments/toss.mjs";
import { openaiVision } from "../src/ai/openai.mjs";
import { appleAdapter, googleAdapter } from "../src/payments/store.mjs";
import { runWatch, vapidHeader } from "../src/push.mjs";
import PriceCtx from "../../app/domain/pricectx.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, "app/data.json"), "utf8"));
const CTX = PriceCtx.fromData(DATA, "2026-10-14");
const D = await freshDb("api");
test.after(() => D.drop());
const rpc = (fn, p) => D.call(fn, p);
const SECRET = `t-${crypto.randomUUID()}`;   // generated per run: no secret-looking literal in the repository
// sandbox approval exists only in this throwaway database (the seed keeps WEB_PG inactive)
await D.pool.query("update public.credit_products set approved_by = 'test-sandbox', active = true where channel = 'WEB_PG'");
await D.pool.query(`insert into public.model_cost_config (provider, model, effective_date, input_cost_per_million, cached_input_cost_per_million, output_cost_per_million,
  image_cost_calculation_method, currency, exchange_rate_used, pricing_source, last_verified_at) values
  ('OPENAI', 'test-vision', '2026-01-01', 1.0, 0.1, 4.0, 'usage.input_tokens', 'USD', 1400, 'test fixture (not a real price)', now())`);

// ---- Toss stand-in: payments the "widget" created, confirm checks the amount, cancels add to cancels[]
function fakeToss() {
  const pays = new Map(), calls = [];
  const send = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url, o = {}) => {
    const u = new URL(url), body = o.body ? JSON.parse(o.body) : null;
    calls.push({ method: o.method || "GET", path: u.pathname, body, idem: o.headers && o.headers["idempotency-key"] });
    if (!/^Basic /.test(o.headers.authorization)) return send(401, { code: "UNAUTHORIZED_KEY" });
    let m;
    if (u.pathname === "/v1/payments/confirm") {
      const p = pays.get(body.paymentKey);
      if (!p || p.orderId !== body.orderId) return send(404, { code: "NOT_FOUND_PAYMENT", message: "없는 결제" });
      if (p.totalAmount !== body.amount) return send(400, { code: "INVALID_REQUEST", message: "금액 불일치" });
      if (p.status === "DONE") return send(400, { code: "ALREADY_PROCESSED_PAYMENT", message: "이미 처리" });
      p.status = "DONE"; p.approvedAt = new Date().toISOString();
      return send(200, p);
    }
    if ((m = /^\/v1\/payments\/orders\/(.+)$/.exec(u.pathname))) { const p = [...pays.values()].find((x) => x.orderId === decodeURIComponent(m[1])); return p ? send(200, p) : send(404, { code: "NOT_FOUND_PAYMENT" }); }
    if ((m = /^\/v1\/payments\/([^/]+)\/cancel$/.exec(u.pathname))) {
      const p = pays.get(decodeURIComponent(m[1])); const amt = body.cancelAmount || p.balanceAmount;
      p.cancels.push({ transactionKey: `tx_${p.cancels.length + 1}_${p.paymentKey}`, cancelAmount: amt, canceledAt: new Date().toISOString(), cancelStatus: "DONE" });
      p.balanceAmount -= amt; p.status = p.balanceAmount ? "PARTIAL_CANCELED" : "CANCELED";
      return send(200, p);
    }
    if ((m = /^\/v1\/payments\/([^/]+)$/.exec(u.pathname))) { const p = pays.get(decodeURIComponent(m[1])); return p ? send(200, p) : send(404, { code: "NOT_FOUND_PAYMENT" }); }
    return send(404, { code: "NOT_FOUND" });
  };
  const open = (orderId, amount) => { const k = `pk_${Math.random().toString(36).slice(2)}`; pays.set(k, { paymentKey: k, orderId, totalAmount: amount, balanceAmount: amount, currency: "KRW", status: "READY", method: "카드", cancels: [] }); return k; };
  return { fetch, open, pays, calls };
}
// ---- OpenAI stand-in: a queue of responses
function fakeOpenAI(queue) {
  const seen = [];
  const fetch = async (url, o) => {
    const body = JSON.parse(o.body); seen.push(body);
    const next = queue.shift() || { status: 500 };
    if (next.status !== 200) return new Response(JSON.stringify({ error: { code: "server_error" } }), { status: next.status });
    return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(next.out) }] }],
      usage: { input_tokens: 1200, input_tokens_details: { cached_tokens: 200 }, output_tokens: 300 } }), { status: 200 });
  };
  return { fetch, seen };
}

const TOSS = fakeToss();
const baseEnv = { ENV: "SANDBOX", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_JWT_SECRET: SECRET, TOSS_SECRET_KEY: "test_sk_fake" };
function makeApp(over = {}, envOver = {}) {
  const env = { ...baseEnv, ...envOver };
  if (env.ENV === "SANDBOX") env.SUPABASE_URL = "http://db.invalid";
  const config = { ...loadConfig(env), supabase: { url: "", serviceKey: "x", jwtSecret: SECRET } };
  return createApp({ config, rpc, toss: tossAdapter({ secretKey: env.TOSS_SECRET_KEY || "test_sk_fake", fetch: TOSS.fetch }), demo: demoAdapter(), loadCtx: async () => CTX, ...over });
}
const tokenFor = (uid, extra = {}) => signHs256({ sub: uid, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600, ...extra }, SECRET);
async function req(app, method, p, { body, token, origin = "https://lsy2825.github.io" } = {}) {
  const headers = { "content-type": "application/json", origin };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await app.fetch(new Request(`https://api.test${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
}
const k = (s = "k") => `${s}-${Math.random().toString(36).slice(2, 14)}`;
async function buyWeb(app, tok, code = "STANDARD") {
  const o = (await req(app, "POST", "/v1/orders", { token: tok, body: { product_code: code, channel: "WEB_PG", idempotency_key: k("ord") } })).body;
  const pk = TOSS.open(o.order_id, o.amount);
  return { o, pk };
}

test("Toss: confirm grants once; repeated confirm and webhook do not grant again", async () => {
  const app = makeApp(), u = await D.newUser(), tok = await tokenFor(u);
  const { o, pk } = await buyWeb(app, tok);
  assert.equal(o.amount, 1990); assert.equal(o.credits, 12); assert.equal(o.vat_included, true);
  const c1 = await req(app, "POST", "/v1/checkout/toss/confirm", { token: tok, body: { paymentKey: pk, orderId: o.order_id, amount: 1990 } });
  assert.equal(c1.status, 200, JSON.stringify(c1.body)); assert.equal(c1.body.wallet.paid, 12); assert.equal(c1.body.already, false);
  const c2 = await req(app, "POST", "/v1/checkout/toss/confirm", { token: tok, body: { paymentKey: pk, orderId: o.order_id, amount: 1990 } });
  assert.equal(c2.status, 200); assert.equal(c2.body.already, true); assert.equal(c2.body.wallet.paid, 12);
  const w = await req(app, "POST", "/v1/webhooks/toss", { body: { eventType: "PAYMENT_STATUS_CHANGED", createdAt: "x", data: { paymentKey: pk, orderId: o.order_id, status: "DONE" } } });
  assert.equal(w.status, 200); assert.equal(w.body.result, "ALREADY_FULFILLED");
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.paid, 12);
  assert.ok(TOSS.calls.some((c) => c.path === "/v1/payments/confirm" && c.idem === `confirm-${pk}`), "Idempotency-Key sent");
  assert.ok((await D.call("commerce_verify_wallet", { user_id: u })).ok);
});

test("Toss: a modified amount is refused before Toss is called; another user's order looks like no order", async () => {
  const app = makeApp(), u = await D.newUser(), tok = await tokenFor(u), other = await tokenFor(await D.newUser());
  const { o, pk } = await buyWeb(app, tok);
  const before = TOSS.calls.length;
  const bad = await req(app, "POST", "/v1/checkout/toss/confirm", { token: tok, body: { paymentKey: pk, orderId: o.order_id, amount: 10 } });
  assert.equal(bad.status, 409); assert.equal(bad.body.error, "AMOUNT_MISMATCH");
  assert.equal(TOSS.calls.length, before, "Toss not called");
  const stolen = await req(app, "POST", "/v1/checkout/toss/confirm", { token: other, body: { paymentKey: pk, orderId: o.order_id, amount: 1990 } });
  assert.equal(stolen.status, 404);
  // the client cannot pick a price or credits: extra fields are ignored, an unknown product is refused
  const o2 = (await req(app, "POST", "/v1/orders", { token: tok, body: { product_code: "MINI", channel: "WEB_PG", idempotency_key: k(), amount: 1, credits: 999 } })).body;
  assert.equal(o2.amount, 990); assert.equal(o2.credits, 5);
  assert.equal((await req(app, "POST", "/v1/orders", { token: tok, body: { product_code: "MEGA", channel: "WEB_PG", idempotency_key: k() } })).status, 400);
  // paying the MINI order with a payment created for a different amount (a swapped product) → Toss refuses, nothing granted
  const pkSwap = TOSS.open(o2.order_id, 3900);
  const swap = await req(app, "POST", "/v1/checkout/toss/confirm", { token: tok, body: { paymentKey: pkSwap, orderId: o2.order_id, amount: 990 } });
  assert.equal(swap.status, 402);
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.paid, 0);
  assert.equal((await req(app, "POST", "/v1/orders", { body: { product_code: "MINI", channel: "WEB_PG", idempotency_key: k() } })).status, 401);
});

test("Toss: a spoofed webhook changes nothing; a missed redirect + missed webhook is fixed by reconciliation", async () => {
  const app = makeApp(), u = await D.newUser(), tok = await tokenFor(u);
  const { o, pk } = await buyWeb(app, tok);
  const spoof = await req(app, "POST", "/v1/webhooks/toss", { body: { eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: pk, orderId: o.order_id, status: "DONE" } } });
  assert.equal(spoof.status, 200); assert.equal(spoof.body.result, "NO_ACTION_READY");   // Toss says READY: the body's DONE is ignored
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.paid, 0);
  TOSS.pays.get(pk).status = "DONE";                               // paid at Toss, but our redirect and webhook were lost
  await D.pool.query("update public.orders set created_at = now() - interval '15 minutes' where id = $1", [o.order_id]);
  const rec = await app.flows.reconcile();
  assert.ok(rec.fixed >= 1, JSON.stringify(rec));
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.paid, 12);
  const again = await app.flows.reconcile();
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.paid, 12, "second run grants nothing");
  assert.ok(again.checked >= 0);
  const log = await D.pool.query("select count(*)::int n from public.payment_reconciliation_jobs"); assert.ok(log.rows[0].n >= 2);
  // an order nobody paid expires after an hour
  const { o: o3 } = await buyWeb(app, tok, "MINI");
  TOSS.pays.delete([...TOSS.pays.values()].find((p) => p.orderId === o3.order_id).paymentKey);
  await D.pool.query("update public.orders set created_at = now() - interval '2 hours' where id = $1", [o3.order_id]);
  await app.flows.reconcile();
  assert.equal((await D.pool.query("select status from public.orders where id = $1", [o3.order_id])).rows[0].status, "EXPIRED");
});

test("Toss: cancels arriving by webhook reverse credits (partial then full); a second payment for a paid order is cancelled", async () => {
  const app = makeApp(), u = await D.newUser(), tok = await tokenFor(u);
  const { o, pk } = await buyWeb(app, tok, "PLUS");
  await req(app, "POST", "/v1/checkout/toss/confirm", { token: tok, body: { paymentKey: pk, orderId: o.order_id, amount: 3900 } });
  const tossFetch = TOSS.fetch;
  await tossFetch(`https://api.tosspayments.com/v1/payments/${pk}/cancel`, { method: "POST", headers: { authorization: "Basic x" }, body: JSON.stringify({ cancelReason: "고객 요청", cancelAmount: 1950 }) });
  let w = await req(app, "POST", "/v1/webhooks/toss", { body: { eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: pk, status: "PARTIAL_CANCELED" } } });
  assert.equal(w.body.result, "REFUNDS_RECORDED_1");
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.paid, 13);
  w = await req(app, "POST", "/v1/webhooks/toss", { body: { eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: pk, status: "PARTIAL_CANCELED" } } });
  assert.equal(w.body.result, "REFUNDS_RECORDED_0", "duplicate delivery");
  await tossFetch(`https://api.tosspayments.com/v1/payments/${pk}/cancel`, { method: "POST", headers: { authorization: "Basic x" }, body: JSON.stringify({ cancelReason: "고객 요청" }) });
  await req(app, "POST", "/v1/webhooks/toss", { body: { eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey: pk, status: "CANCELED" } } });
  const wal = (await req(app, "GET", "/v1/wallet", { token: tok })).body;
  assert.equal(wal.paid, 0); assert.equal(wal.ad_free_until, null);
  // second payment on an already fulfilled order
  const b = await buyWeb(app, tok, "MINI");
  await req(app, "POST", "/v1/checkout/toss/confirm", { token: tok, body: { paymentKey: b.pk, orderId: b.o.order_id, amount: 990 } });
  const pk2 = TOSS.open(b.o.order_id, 990);
  const dup = await req(app, "POST", "/v1/checkout/toss/confirm", { token: tok, body: { paymentKey: pk2, orderId: b.o.order_id, amount: 990 } });
  assert.equal(dup.status, 409); assert.equal(dup.body.error, "ORDER_ALREADY_PAID");
  assert.equal(TOSS.pays.get(pk2).status, "CANCELED", "money of the duplicate returned");
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.paid, 5);
});

test("environments: DEMO payments off in PRODUCTION; live key refused in SANDBOX; PRODUCTION needs owner approval", async () => {
  assert.throws(() => loadConfig({ ENV: "SANDBOX", TOSS_SECRET_KEY: "live_sk_x", SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k" }), /TEST/);
  assert.throws(() => loadConfig({ ENV: "PRODUCTION", TOSS_SECRET_KEY: "live_sk_x", SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k" }), /LIVE_PAYMENTS_APPROVED/);
  const prodEnv = { ENV: "PRODUCTION", TOSS_SECRET_KEY: "live_sk_x", SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k", LIVE_PAYMENTS_APPROVED: "approved:2026-10-14:test" };
  assert.equal(loadConfig(prodEnv).demoPayments, false);
  const app = makeApp({}, prodEnv), u = await D.newUser(), tok = await tokenFor(u);
  const r = await req(app, "POST", "/v1/orders", { token: tok, body: { product_code: "MINI", channel: "DEMO", idempotency_key: k() } });
  assert.equal(r.status, 403);
  const cat = (await req(app, "GET", "/v1/catalog")).body;
  assert.ok(cat.products.every((p) => p.channel === "WEB_PG"));
  // DEMO in sandbox works through the same ledger
  const sb = makeApp(), t2 = await tokenFor(await D.newUser());
  const o = (await req(sb, "POST", "/v1/orders", { token: t2, body: { product_code: "MINI", channel: "DEMO", idempotency_key: k() } })).body;
  const c = await req(sb, "POST", "/v1/checkout/demo/confirm", { token: t2, body: { orderId: o.order_id } });
  assert.equal(c.body.wallet.paid, 5); assert.equal(c.body.demo, true);
});

test("jobs: data-backed report captured once; repeat key free; no data → refused before reserving; insufficient credits 402", async () => {
  const app = makeApp(), u = await D.newUser(), tok = await tokenFor(u);
  const poor = await req(app, "POST", "/v1/jobs", { token: tok, body: { feature: "REGIONAL_PRICE_REPORT", input: { key: "X01" }, idempotency_key: k("job") } });
  assert.equal(poor.status, 402); assert.equal(poor.body.error, "INSUFFICIENT_CREDITS");
  await D.call("commerce_grant_promo", { user_id: u, amount: 3, reason: "test", actor: "test", idempotency_key: k() });
  const key1 = k("job");
  const j = await req(app, "POST", "/v1/jobs", { token: tok, body: { feature: "REGIONAL_PRICE_REPORT", input: { key: "X01" }, idempotency_key: key1 } });
  assert.equal(j.status, 200, JSON.stringify(j.body)); assert.equal(j.body.credits, 1); assert.equal(j.body.wallet.promo, 2);
  const again = await req(app, "POST", "/v1/jobs", { token: tok, body: { feature: "REGIONAL_PRICE_REPORT", input: { key: "X01" }, idempotency_key: key1 } });
  assert.equal(again.body.repeat, true); assert.equal(again.body.report_id, j.body.report_id);
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.promo, 2);
  const swapped = await req(app, "POST", "/v1/jobs", { token: tok, body: { feature: "REGIONAL_PRICE_REPORT", input: { key: "X24" }, idempotency_key: key1 } });
  assert.equal(swapped.status, 409);
  const hist = await req(app, "POST", "/v1/jobs", { token: tok, body: { feature: "PRICE_HISTORY_REPORT", input: { key: "X01" }, idempotency_key: k("job") } });
  assert.equal(hist.status, 422); assert.equal(hist.body.error, "NOT_ENOUGH_DATA");
  assert.equal((await D.pool.query("select count(*)::int n from public.premium_jobs where user_id = $1", [u])).rows[0].n, 1, "nothing reserved for refused jobs");
  // reopening is free; share = summary only; delete removes the payload
  const rep = await req(app, "GET", `/v1/reports/${j.body.report_id}`, { token: tok });
  assert.equal(rep.body.kind, "REGIONAL"); assert.ok(rep.body.payload.rows.length);
  const other = await req(app, "GET", `/v1/reports/${j.body.report_id}`, { token: await tokenFor(await D.newUser()) });
  assert.equal(other.status, 404);
  const sh = await req(app, "POST", `/v1/reports/${j.body.report_id}/share`, { token: tok });
  assert.match(sh.body.token, /^[0-9a-f]{64}$/);
  const pub = await req(app, "GET", `/v1/shared/${sh.body.token}`);
  assert.equal(pub.status, 200); assert.ok(pub.body.summary.rows); assert.equal(pub.body.payload, undefined); assert.equal(pub.body.user_id, undefined);
  await req(app, "DELETE", `/v1/reports/${j.body.report_id}`, { token: tok });
  assert.equal((await req(app, "GET", `/v1/shared/${sh.body.token}`)).status, 404);
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.promo, 2);
  // planner: second run for the same cart within 30 days costs nothing
  await D.call("commerce_grant_promo", { user_id: u, amount: 2, reason: "test", actor: "test", idempotency_key: k() });
  const cart = { items: [{ k: "X01", q: 1 }, { k: "X24", q: 2 }], region: "서울" };
  const p1 = await req(app, "POST", "/v1/jobs", { token: tok, body: { feature: "ADVANCED_CART_PLANNER", input: cart, idempotency_key: k("job") } });
  const p2 = await req(app, "POST", "/v1/jobs", { token: tok, body: { feature: "ADVANCED_CART_PLANNER", input: cart, idempotency_key: k("job") } });
  assert.equal(p1.body.credits, 2); assert.equal(p2.body.credits, 0); assert.equal(p2.body.covered_by_entitlement, true);
  assert.ok((await D.call("commerce_verify_wallet", { user_id: u })).ok);
});

const goodExtraction = { document_type: "EVENT", clinic_name: null, branch_name: null, vat_status: "INCLUDED", unreadable: false, offers: [
  { raw_offer_name: "국산 사각턱 보톡스 50U", price_text_as_printed: "19,000원", advertised_price: 19000, list_price: null, sessions: null, eligibility_conditions: [], end_date_text: "10/31", package_components: [], uncertainties: [] },
  { raw_offer_name: "리쥬란힐러 2cc", price_text_as_printed: "199,000원", advertised_price: 99000, list_price: 300000, sessions: null, eligibility_conditions: ["첫 방문"], end_date_text: null, package_components: [], uncertainties: [] }] };
const PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0x20, 0, 0, 4, 0, 8, 2, 0, 0, 0]).toString("base64");

test("image decoder: usage and cost recorded; a price the printed text does not say is not used; failures release; bad files never reserve", async () => {
  const u = await D.newUser(), tok = await tokenFor(u);
  await D.call("commerce_grant_promo", { user_id: u, amount: 3, reason: "test", actor: "test", idempotency_key: k() });
  const ai = fakeOpenAI([{ status: 200, out: goodExtraction }]);
  const cfg = { apiKey: "sk-test", base: "https://openai.test", model: "test-vision", strongModel: "test-vision", fetch: ai.fetch };
  const app = makeApp({ vision: openaiVision(cfg, rpc) });
  const j = await req(app, "POST", "/v1/jobs", { token: tok, body: { feature: "EVENT_IMAGE_DECODER", input: { image: PNG }, idempotency_key: k("img") } });
  assert.equal(j.status, 200, JSON.stringify(j.body)); assert.equal(j.body.credits, 1);
  assert.equal(ai.seen[0].text.format.strict, true); assert.equal(ai.seen[0].store, false); assert.equal(ai.seen[0].model, "test-vision");
  const rep = (await req(app, "GET", `/v1/reports/${j.body.report_id}`, { token: tok })).body;
  const [a, b] = rep.payload.items;
  assert.equal(a.match.status, "EXACT_MATCH"); assert.ok(a.compare.median > 0);
  assert.equal(b.offer.advertised_price, 199000, "the printed text wins over the model's number");
  assert.ok(b.offer.uncertainties.some((x) => /달라요/.test(x)));
  assert.equal(rep.payload.image.stored, false);
  const use = (await D.pool.query("select cost_krw, ok, call_kind from public.ai_usage_records where user_id = $1", [u])).rows;
  assert.equal(use.length, 1); assert.equal(+use[0].cost_krw, +(((1000 * 1 + 200 * 0.1 + 300 * 4) / 1e6) * 1400).toFixed(4));
  // free correction: re-matched without AI or credits
  const cor = await req(app, "POST", `/v1/reports/${j.body.report_id}/corrections`, { token: tok, body: { edits: [{ index: 1, raw_offer_name: "리쥬란힐러 2cc", advertised_price: 189000 }] } });
  assert.equal(cor.status, 200); assert.equal(cor.body.items[1].match.status, "EXACT_MATCH"); assert.equal(cor.body.items[1].offer.advertised_price, 189000);
  // 5.1 audit: corrections edit read items only (no new offers = no free decoder), bounded
  assert.equal((await req(app, "POST", `/v1/reports/${j.body.report_id}/corrections`, { token: tok, body: { edits: [{ index: 9, raw_offer_name: "슈링크 300샷", advertised_price: 1 }] } })).status, 400);
  assert.equal((await req(app, "POST", `/v1/reports/${j.body.report_id}/corrections`, { token: tok, body: { offers: Array.from({ length: 40 }, () => ({ raw_offer_name: "국산 사각턱 보톡스 50U", advertised_price: 9000 })) } })).status, 400);
  let lim = 0;
  for (let i = 0; i < 12; i++) lim = (await req(app, "POST", `/v1/reports/${j.body.report_id}/corrections`, { token: tok, body: { edits: [{ index: 0, raw_offer_name: "국산 사각턱 보톡스 50U", advertised_price: 19000 + i }] } })).status;
  assert.equal(lim, 429, "corrections are bounded");
  assert.equal(ai.seen.length, 1); assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.promo, 2);
  // provider down twice → released, both calls logged, no charge
  const down = fakeOpenAI([{ status: 500 }, { status: 500 }]);
  const app2 = makeApp({ vision: openaiVision({ ...cfg, fetch: down.fetch }, rpc) });
  const f = await req(app2, "POST", "/v1/jobs", { token: tok, body: { feature: "EVENT_IMAGE_DECODER", input: { image: PNG }, idempotency_key: k("img") } });
  assert.equal(f.status, 502); assert.equal(f.body.detail.released, true);
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.promo, 2);
  assert.equal((await D.pool.query("select count(*)::int n from public.ai_usage_records where user_id = $1 and call_kind = 'FALLBACK'", [u])).rows[0].n, 1);
  // not a price document → released
  const np = fakeOpenAI([{ status: 200, out: { ...goodExtraction, document_type: "NOT_A_PRICE_DOCUMENT", offers: [] } }]);
  const app3 = makeApp({ vision: openaiVision({ ...cfg, fetch: np.fetch }, rpc) });
  const n = await req(app3, "POST", "/v1/jobs", { token: tok, body: { feature: "EVENT_IMAGE_DECODER", input: { image: PNG }, idempotency_key: k("img") } });
  assert.equal(n.status, 422); assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.promo, 2);
  // malicious / wrong files: refused before any reservation or model call
  const jobsBefore = (await D.pool.query("select count(*)::int n from public.premium_jobs where user_id = $1", [u])).rows[0].n;
  for (const image of ["data:image/svg+xml;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64"),
    "data:image/png;base64," + Buffer.from("<html>not a png</html>").toString("base64"), "data:image/png;base64,"]) {
    const r = await req(app, "POST", "/v1/jobs", { token: tok, body: { feature: "EVENT_IMAGE_DECODER", input: { image }, idempotency_key: k("img") } });
    assert.ok([400, 415].includes(r.status), `${r.status} ${JSON.stringify(r.body)}`);
  }
  assert.equal((await D.pool.query("select count(*)::int n from public.premium_jobs where user_id = $1", [u])).rows[0].n, jobsBefore);
});

test("URL decoder: private / non-https addresses refused for free; a blocked page releases the credit", async () => {
  const u = await D.newUser(), tok = await tokenFor(u);
  await D.call("commerce_grant_promo", { user_id: u, amount: 2, reason: "test", actor: "test", idempotency_key: k() });
  const pageFetch = async (url) => /blocked/.test(url) ? new Response("no", { status: 403 })
    : new Response("<html><script>evil()</script><p>국산 사각턱 보톡스 50U 19,000원</p><p>리쥬란힐러 2cc 199,000원</p></html>", { status: 200, headers: { "content-type": "text/html" } });
  const { jobRunner } = await import("../src/jobs.mjs");
  const { fetchPublicText } = await import("../src/safe.mjs");
  for (const bad of ["http://example.com/a", "https://127.0.0.1/", "https://localhost/x", "https://169.254.169.254/latest", "https://[::1]/", "https://metadata.google.internal/", "https://a.b:8443/"]) {
    await assert.rejects(fetchPublicText(bad, { fetch: pageFetch }), /BAD_URL|주소/);
  }
  const run = jobRunner({ rpc, ctx: CTX, fetchText: (url) => fetchPublicText(url, { fetch: pageFetch, resolve: async () => true }) });
  const ok = await run.run({ id: u }, "EVENT_URL_DECODER", { url: "https://clinic.example.com/event" }, k("url"));
  assert.equal(ok.status, "SUCCEEDED");
  await assert.rejects(run.run({ id: u }, "EVENT_URL_DECODER", { url: "https://clinic.example.com/blocked" }, k("url")), (e) => e.code === "PAGE_BLOCKED" && e.detail.released);
  assert.equal((await D.call("commerce_wallet", { user_id: u })).promo, 1);
});

test("Jomi: diagnosis / dosing screened for free; an answer with an invented price is replaced by the rule-based one", async () => {
  const u = await D.newUser(), tok = await tokenFor(u);
  await D.call("commerce_grant_promo", { user_id: u, amount: 1, reason: "test", actor: "test", idempotency_key: k() });
  const ai = fakeOpenAI([{ status: 200, out: { answer: "리쥬란힐러 2cc는 보통 77,000원이에요.", declined: false } }, { status: 200, out: { answer: "중간값은 149,000원이에요.", declined: false } }]);
  const app = makeApp({ ai: { apiKey: "sk", base: "https://openai.test", model: "test-vision" } });
  const { jobRunner } = await import("../src/jobs.mjs");
  const Jomi = await import("../src/ai/jomi.mjs");
  const s = await req(app, "POST", "/v1/jobs", { token: tok, body: { feature: "JOMI_QA_SESSION", input: { question: "보톡스 몇 유닛 맞아야 해요?" }, idempotency_key: k("jomi") } });
  assert.equal(s.body.status, "SCREENED"); assert.equal(s.body.credits, 0);
  assert.equal(Jomi.screen("이거 무슨 병인가요").code, "DIAGNOSIS"); assert.equal(Jomi.screen("숨이 차요").code, "URGENT");
  const fx = Jomi.facts("리쥬란힐러 2cc 가격 알려줘", CTX);
  assert.ok(fx.groups.length); assert.equal(Jomi.check("보통 77,000원이에요", fx).ok, false); assert.equal(Jomi.check(`중간값 ${fx.groups[0].median.toLocaleString()}원`, fx).ok, true);
  const a = await Jomi.answer("리쥬란힐러 2cc 가격 알려줘", CTX, { ai: { apiKey: "sk", base: "https://openai.test", model: "test-vision" }, rpc, userId: u, fetch: ai.fetch });
  assert.equal(a.kind, "GUARD_FALLBACK"); assert.match(a.answer, /중간값/);
  const run = jobRunner({ rpc, ctx: CTX, ai: null });
  const j = await run.run({ id: u }, "JOMI_QA_SESSION", { question: "리쥬란힐러 2cc 가격 알려줘" }, k("jomi"));
  assert.equal(j.status, "SUCCEEDED"); assert.equal(j.credits, 1);
  // 5.1 audit: parallel follow-ups cannot pass the 5-turn limit (slot taken atomically before answering)
  const par = await Promise.allSettled(Array.from({ length: 10 }, () => run.ask({ id: u }, j.report_id, "국산 사각턱 보톡스 50U는요?")));
  assert.equal(par.filter((x) => x.status === "fulfilled").length, 4);
  await assert.rejects(run.ask({ id: u }, j.report_id, "하나 더"), (e) => e.code === "SESSION_FULL");
  const stored = await D.call("commerce_report", { report_id: j.report_id, user_id: u });
  assert.equal(stored.payload.turns.length, 5);
  // a question with no treatment name is refused before reserving (never charged for 'not found')
  await assert.rejects(run.run({ id: u }, "JOMI_QA_SESSION", { question: "안녕하세요 반가워요" }, k("jomi")), (e) => e.code === "NO_TREATMENT_FOUND");
  assert.equal((await D.call("commerce_wallet", { user_id: u })).available, 0, "follow-up questions are free");
});

test("security edges: CORS allow-list, admin needs MFA, expired / forged tokens refused, errors carry no internals", async () => {
  const app = makeApp(), u = await D.newUser();
  const evil = await req(app, "GET", "/v1/catalog", { origin: "https://evil.example" });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  const good = await req(app, "GET", "/v1/catalog");
  assert.equal(good.headers.get("access-control-allow-origin"), "https://lsy2825.github.io");
  const noMfa = await tokenFor(u, { app_metadata: { roles: ["admin"] }, aal: "aal1" });
  assert.equal((await req(app, "GET", "/v1/admin/economics", { token: noMfa })).status, 403);
  const adm = await tokenFor(u, { app_metadata: { roles: ["admin"] }, aal: "aal2" });
  const eco = await req(app, "GET", "/v1/admin/economics", { token: adm });
  assert.equal(eco.status, 200); assert.ok(eco.body.ai.calls >= 1); assert.ok("unpriced_calls" in eco.body.ai);
  const expired = await signHs256({ sub: u, aud: "authenticated", exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
  assert.equal((await req(app, "GET", "/v1/wallet", { token: expired })).status, 401);
  const forged = await signHs256({ sub: u, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 }, "another-secret");
  assert.equal((await req(app, "GET", "/v1/wallet", { token: forged })).status, 401);
  const r = await req(app, "GET", "/v1/reports/not-a-uuid", { token: await tokenFor(u) });
  assert.equal(r.status, 404); assert.doesNotMatch(JSON.stringify(r.body), /syntax|uuid|SQL|stack/i);
});

test("price watch: needs an entitlement; one notice per change; quiet hours hold the push; push carries no content", async () => {
  const app = makeApp(), u = await D.newUser(), tok = await tokenFor(u);
  const no = await req(app, "POST", "/v1/watch/rules", { token: tok, body: { key_id: "X01", kind: "target", target_krw: 1000000 } });
  assert.equal(no.status, 402);
  await D.call("commerce_grant_promo", { user_id: u, amount: 1, reason: "test", actor: "test", idempotency_key: k() });
  const w = await req(app, "POST", "/v1/jobs", { token: tok, body: { feature: "PRICE_WATCH_7D", input: {}, idempotency_key: k("watch") } });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  const rule = await req(app, "POST", "/v1/watch/rules", { token: tok, body: { key_id: "X01", kind: "target", target_krw: 1000000, quiet_start: 0, quiet_end: 0 } });
  assert.equal(rule.status, 200, JSON.stringify(rule.body));
  assert.equal((await req(app, "POST", "/v1/push/subscribe", { token: tok, body: { endpoint: "https://evil.example/push", keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } } })).status, 400);
  const ep = "https://fcm.googleapis.com/fcm/send/abc123";
  assert.equal((await req(app, "POST", "/v1/push/subscribe", { token: tok, body: { endpoint: ep, keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } } })).status, 200);
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const vapid = { publicKey: Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url"), privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey), subject: "mailto:test@example.invalid" };
  const pushes = [];
  const pf = async (url, o) => { pushes.push({ url, o }); return new Response(null, { status: 201 }); };
  const r1 = await runWatch({ rpc, ctx: CTX, vapid, fetch: pf });
  assert.equal(r1.events, 1); assert.equal(r1.pushed, 1);
  assert.equal(pushes.length, 1); assert.equal(pushes[0].o.body, undefined); assert.match(pushes[0].o.headers.authorization, /^vapid t=.+, k=/);
  const r2 = await runWatch({ rpc, ctx: CTX, vapid, fetch: pf });
  assert.equal(r2.events, 0); assert.equal(pushes.length, 1, "same data → no second notice");
  const notes = await req(app, "GET", "/v1/notices", { token: tok });
  assert.equal(notes.body.length, 1); assert.match(notes.body[0].payload.text, /수집 기준/);
  assert.doesNotMatch(JSON.stringify(notes.body), /실시간/);
  // quiet hours: a notice made at night waits
  const { quiet } = await import("../src/push.mjs");
  assert.equal(quiet(23, 22, 8), true); assert.equal(quiet(9, 22, 8), false); assert.equal(quiet(12, 0, 0), false);
  const h = await vapidHeader(ep, vapid);
  const jwt = h.slice(8, h.indexOf(","));
  assert.equal(JSON.parse(Buffer.from(jwt.split(".")[1], "base64url")).aud, "https://fcm.googleapis.com");
});

test("Apple / Google adapters (contract only, generated certificates and a mocked Google API): grant once, wrong app refused", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apple-"));
  const sh = (args) => execFileSync("openssl", args, { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
  const ext = (name, body) => fs.writeFileSync(path.join(dir, name), body);
  ext("root.cnf", "[v]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n");
  ext("mid.cnf", "[v]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n1.2.840.113635.100.6.2.1=ASN1:NULL\n");
  ext("leaf.cnf", "[v]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n1.2.840.113635.100.6.11.1=ASN1:NULL\n");
  for (const n of ["root", "mid", "leaf"]) sh(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${n}.key`]);
  sh(["req", "-new", "-x509", "-key", "root.key", "-subj", "/CN=Test Root", "-days", "30", "-out", "root.pem", "-extensions", "v", "-config", path.join(dir, "root.cnf")]);
  for (const [n, ca] of [["mid", "root"], ["leaf", "mid"]]) {
    sh(["req", "-new", "-key", `${n}.key`, "-subj", `/CN=Test ${n}`, "-out", `${n}.csr`, "-config", path.join(dir, "root.cnf")]);
    sh(["x509", "-req", "-in", `${n}.csr`, "-CA", `${ca}.pem`, "-CAkey", `${ca}.key`, "-CAcreateserial", "-days", "30", "-out", `${n}.pem`, "-extfile", path.join(dir, `${n}.cnf`), "-extensions", "v"]);
  }
  const der = (n) => fs.readFileSync(path.join(dir, `${n}.pem`), "utf8").replace(/-----[^-]+-----|\s/g, "");
  const { createPrivateKey, sign } = await import("node:crypto");
  const jws = (payload) => {
    const h = Buffer.from(JSON.stringify({ alg: "ES256", x5c: [der("leaf"), der("mid"), der("root")] })).toString("base64url");
    const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const s = sign("sha256", Buffer.from(`${h}.${b}`), { key: createPrivateKey(fs.readFileSync(path.join(dir, "leaf.key"))), dsaEncoding: "ieee-p1363" });
    return `${h}.${b}.${s.toString("base64url")}`;
  };
  await D.pool.query("update public.credit_products set approved_by = 'test-sandbox', active = true where channel in ('APPLE_IAP', 'GOOGLE_PLAY')");
  const apple = appleAdapter({ bundleId: "kr.yoonsiljang.app", environment: "Sandbox", rootCertsB64: [der("root")] });
  const tx = { bundleId: "kr.yoonsiljang.app", environment: "Sandbox", type: "Consumable", transactionId: "2000000123", originalTransactionId: "2000000123", productId: "kr.yoonsiljang.credits.mini", purchaseDate: Date.now() };
  const app = makeApp({ apple }), u = await D.newUser(), tok = await tokenFor(u);
  const g1 = await req(app, "POST", "/v1/store/apple", { token: tok, body: { signedTransactionInfo: jws(tx) } });
  assert.equal(g1.status, 200, JSON.stringify(g1.body)); assert.equal(g1.body.wallet.paid, 5);
  const g2 = await req(app, "POST", "/v1/store/apple", { token: tok, body: { signedTransactionInfo: jws(tx) } });
  assert.equal(g2.body.already, true); assert.equal(g2.body.wallet.paid, 5);
  assert.equal((await req(app, "POST", "/v1/store/apple", { token: tok, body: { signedTransactionInfo: jws({ ...tx, transactionId: "9", bundleId: "other.app" }) } })).status, 400);
  const forged = jws(tx).split("."); forged[1] = Buffer.from(JSON.stringify({ ...tx, transactionId: "777", productId: "kr.yoonsiljang.credits.plus" })).toString("base64url");
  assert.equal((await req(app, "POST", "/v1/store/apple", { token: tok, body: { signedTransactionInfo: forged.join(".") } })).status, 400);
  // Google: mocked token + purchases.products.get / consume
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const gcalls = [], FAKE_OAUTH = crypto.randomUUID();
  const gfetch = async (url, o = {}) => {
    gcalls.push(url);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: FAKE_OAUTH }), { status: 200 });
    if (url.endsWith(":consume")) return new Response("{}", { status: 200 });
    if (/tokens\/tok-pending$/.test(url)) return new Response(JSON.stringify({ purchaseState: 2, orderId: "GPA.1" }), { status: 200 });
    return new Response(JSON.stringify({ purchaseState: 0, consumptionState: 0, orderId: "GPA.3333-4444", purchaseTimeMillis: String(Date.now()), purchaseType: 0 }), { status: 200 });
  };
  const google = googleAdapter({ packageName: "kr.yoonsiljang.app", serviceAccountJson: { client_email: "svc@test.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }, fetch: gfetch, allowTestPurchases: true });   // sandbox: license-tester purchases allowed
  const appG = makeApp({ google });
  const p1 = await req(appG, "POST", "/v1/store/google", { token: tok, body: { productId: "credits_plus", purchaseToken: "tok-1" } });
  assert.equal(p1.status, 200, JSON.stringify(p1.body)); assert.equal(p1.body.wallet.paid, 31);
  assert.ok(gcalls.some((x) => x.endsWith(":consume")));
  const p2 = await req(appG, "POST", "/v1/store/google", { token: tok, body: { productId: "credits_plus", purchaseToken: "tok-1" } });
  assert.equal(p2.body.already, true);
  assert.equal((await req(appG, "POST", "/v1/store/google", { token: tok, body: { productId: "credits_plus", purchaseToken: "tok-pending" } })).status, 409);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("5.1 audit regressions: reconciliation order, cumulative refunds, config, AI caps, takeover, JWT, SSRF, watch paging, Google test buys", async () => {
  // reconciliation: 101 old expired orders must not hide a fresh paid one
  const app = makeApp(), u = await D.newUser(), tok = await tokenFor(u);
  for (let i = 0; i < 101; i++) {
    const o = await D.call("commerce_create_order", { user_id: u, product_code: "MINI", channel: "WEB_PG", idempotency_key: k("old") });
    await D.pool.query("update public.orders set status = 'EXPIRED', created_at = now() - interval '1 day' where id = $1", [o.id]);
  }
  const { o, pk } = await buyWeb(app, tok);
  TOSS.pays.get(pk).status = "DONE";
  await D.pool.query("update public.orders set created_at = now() - interval '15 minutes' where id = $1", [o.order_id]);
  await app.flows.reconcile();
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.paid, 12, "fresh paid order found behind 101 expired ones");

  // refunds: 10 partial refunds of 99원 on a 5-credit pack take back exactly 5, never more, never negative
  const u2 = await D.newUser();
  const big = await D.call("commerce_create_order", { user_id: u2, product_code: "PLUS", channel: "DEMO", idempotency_key: k("o") });
  await D.call("commerce_fulfill_payment", { order_id: big.id, provider: "DEMO", provider_payment_id: k("p"), amount: 3900, currency: "KRW", status: "DONE" });
  const mini = await D.call("commerce_create_order", { user_id: u2, product_code: "MINI", channel: "DEMO", idempotency_key: k("o") });
  const pid = k("p");
  await D.call("commerce_fulfill_payment", { order_id: mini.id, provider: "DEMO", provider_payment_id: pid, amount: 990, currency: "KRW", status: "DONE" });
  for (let i = 0; i < 10; i++) await D.call("commerce_refund", { provider: "DEMO", provider_payment_id: pid, provider_refund_id: k("r"), amount: 99, kind: "REFUND", provider_done: true });
  assert.equal((await D.call("commerce_wallet", { user_id: u2 })).paid, 26);
  const neg = await D.pool.query("select count(*)::int n from public.payment_refunds where credits_target < 0 or credits_reversed < 0");
  assert.equal(neg.rows[0].n, 0);
  assert.ok((await D.call("commerce_verify_wallet", { user_id: u2 })).ok);

  // config: ENV is required; DEMO never with live payment settings
  assert.throws(() => loadConfig({ SUPABASE_URL: "u", SUPABASE_SERVICE_ROLE_KEY: "k", TOSS_SECRET_KEY: "live_sk_x" }), /ENV is required/);
  assert.throws(() => loadConfig({ ENV: "DEMO", TOSS_SECRET_KEY: "live_sk_x" }), /DEMO must not/);

  // AI caps: an unpriced model cannot be called; the per-user daily call cap stops further image jobs before reserving
  const u3 = await D.newUser(), t3 = await tokenFor(u3);
  await D.call("commerce_grant_promo", { user_id: u3, amount: 10, reason: "test", actor: "test", idempotency_key: k() });
  const unpriced = makeApp({ vision: openaiVision({ apiKey: "sk", base: "https://openai.test", model: "no-price-model", fetch: fakeOpenAI([]).fetch }, rpc) });
  const r1 = await req(unpriced, "POST", "/v1/jobs", { token: t3, body: { feature: "EVENT_IMAGE_DECODER", input: { image: PNG }, idempotency_key: k("img") } });
  assert.equal(r1.status, 503); assert.equal(r1.body.error, "AI_NOT_PRICED");
  const capped = makeApp({ vision: openaiVision({ apiKey: "sk", base: "https://openai.test", model: "test-vision", strongModel: "test-vision", fetch: fakeOpenAI([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }]).fetch }, rpc) }, { AI_MAX_USER_CALLS_PER_DAY: "2" });
  await req(capped, "POST", "/v1/jobs", { token: t3, body: { feature: "EVENT_IMAGE_DECODER", input: { image: PNG }, idempotency_key: k("img") } });
  const r2 = await req(capped, "POST", "/v1/jobs", { token: t3, body: { feature: "EVENT_IMAGE_DECODER", input: { image: PNG }, idempotency_key: k("img") } });
  assert.equal(r2.status, 429); assert.equal(r2.body.error, "AI_DAILY_LIMIT");
  assert.equal((await D.pool.query("select count(*)::int n from public.ai_usage_records where user_id = $1", [u3])).rows[0].n, 2, "failed calls count too");

  // push: an endpoint registered by one user cannot be taken over by another
  const ep = "https://fcm.googleapis.com/fcm/send/owned-" + k("e");
  const keys = { p256dh: "a".repeat(87), auth: "b".repeat(22) };
  await req(app, "POST", "/v1/push/subscribe", { token: tok, body: { endpoint: ep, keys } });
  await req(app, "POST", "/v1/push/subscribe", { token: t3, body: { endpoint: ep, keys } });
  assert.equal((await D.pool.query("select user_id from public.push_subscriptions where endpoint = $1", [ep])).rows[0].user_id, u);

  // JWT: no audience → 401; a malformed signature → 401 (not 500)
  const noAud = await signHs256({ sub: u, exp: Math.floor(Date.now() / 1000) + 600 }, SECRET);
  assert.equal((await req(app, "GET", "/v1/wallet", { token: noAud })).status, 401);
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok.split(".").slice(0, 2).join(".") + ".%%%" })).status, 401);

  // SSRF: wildcard-DNS hosts refused; private resolution refused; HTML → text stays linear on hostile input
  const { checkPublicUrl, fetchPublicText, htmlToText } = await import("../src/safe.mjs");
  assert.throws(() => checkPublicUrl("https://127.0.0.1.nip.io/x"), /IP/);
  await assert.rejects(fetchPublicText("https://looks-public.example.com/", { fetch: async () => new Response("x"), resolve: async () => false }), /공개/);
  const t0 = Date.now(); htmlToText("&lt;svg ".repeat(130000) + "<svg "); assert.ok(Date.now() - t0 < 2000);

  // watch paging: more than 500 rules come back in pages, not one unbounded list
  const u4 = await D.newUser();
  await D.call("commerce_grant_promo", { user_id: u4, amount: 1, reason: "test", actor: "test", idempotency_key: k() });
  const res = await D.call("commerce_reserve", { user_id: u4, feature_code: "PRICE_WATCH_7D", idempotency_key: k("w") });
  await D.call("commerce_capture", { job_id: res.job.id, report: { title: "w" } });
  const ent = (await D.pool.query("select id from public.premium_entitlements where job_id = $1", [res.job.id])).rows[0].id;
  await D.pool.query("insert into public.price_watch_rules (user_id, entitlement_id, key_id, kind) select $1, $2, 'X01', 'watch' from generate_series(1, 520)", [u4, ent]);
  const page = await D.call("commerce_watch_due", { after: 0 });
  assert.equal(page.length, 500);

  // Google: license-tester purchases never grant credits unless explicitly allowed (sandbox)
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const gf = async (url) => url.startsWith("https://oauth2") ? new Response(JSON.stringify({ access_token: crypto.randomUUID() }), { status: 200 })
    : new Response(JSON.stringify({ purchaseState: 0, consumptionState: 0, orderId: "GPA.T-" + k(), purchaseTimeMillis: String(Date.now()), purchaseType: 0 }), { status: 200 });
  const g = googleAdapter({ packageName: "kr.yoonsiljang.app", serviceAccountJson: { client_email: "svc@test.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }, fetch: gf });
  await assert.rejects(g.verifyPurchase({ productId: "credits_mini", purchaseToken: "t" }), (e) => e.code === "TEST_PURCHASE");
});

test("admin dashboard: MFA admin only; actuals vs estimates labelled; demo revenue kept out of the margin", async () => {
  const app = makeApp(), u = await D.newUser();
  assert.equal((await req(app, "GET", "/v1/admin/dashboard", { token: await tokenFor(u) })).status, 403);
  assert.equal((await req(app, "GET", "/v1/admin/dashboard", { token: await tokenFor(u, { app_metadata: { roles: ["admin"] }, aal: "aal1" }) })).status, 403);
  const r = await req(app, "GET", "/v1/admin/dashboard", { token: await tokenFor(u, { app_metadata: { roles: ["admin"] }, aal: "aal2" }) });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const b = r.body;
  for (const k of ["revenue_daily", "revenue_monthly", "orders_by_status_30d", "payments_by_status_30d", "refunds_daily", "credits_daily", "outstanding_credits", "ai_daily", "features_30d", "premium_users", "health", "channels_30d", "contribution_margin_30d", "data_freshness"])
    assert.ok(k in b, k);
  assert.equal(b.contribution_margin_30d.kind, "ESTIMATE");
  for (const c of b.channels_30d) { assert.equal(c.gross_krw.kind, "ACTUAL"); assert.equal(c.fee_krw.kind, "ESTIMATE"); }
  assert.ok(b.channels_30d.some((c) => c.channel === "WEB_PG"), "web payments made by earlier tests appear");
  assert.equal(b.data_freshness.updated, CTX.updated);
  assert.ok(b.health.db_size_bytes > 0 && b.health.last_reconcile);
  assert.ok(b.premium_users.active_30d >= 1);
});

test("network interruption, rate limits, account switching", async () => {
  // Toss does not answer the confirm in time: the user gets a retryable error, nothing is granted, the order stays open,
  // and the reconciliation sweep grants it once Toss shows it paid
  const hang = { ...TOSS, fetch: async (url, o) => (url.endsWith("/v1/payments/confirm") ? new Promise((res, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted")))) : TOSS.fetch(url, o)) };
  const app = makeApp({ toss: tossAdapter({ secretKey: "test_sk_fake", fetch: hang.fetch, timeoutMs: 50 }) }), u = await D.newUser(), tok = await tokenFor(u);
  const { o, pk } = await buyWeb(app, tok);
  const c = await req(app, "POST", "/v1/checkout/toss/confirm", { token: tok, body: { paymentKey: pk, orderId: o.order_id, amount: 1990 } });
  assert.equal(c.status, 504); assert.equal(c.body.error, "UPSTREAM_TIMEOUT");
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.paid, 0);
  TOSS.pays.get(pk).status = "DONE";
  await D.pool.query("update public.orders set created_at = now() - interval '15 minutes' where id = $1", [o.order_id]);
  await app.flows.reconcile();
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tok })).body.paid, 12);
  // rate limit: the 21st job request within a minute is refused before any work
  const rl = makeApp(), t2 = await tokenFor(await D.newUser());
  const codes = [];
  for (let i = 0; i < 21; i++) codes.push((await req(rl, "POST", "/v1/jobs", { token: t2, body: { feature: "NOPE", input: {}, idempotency_key: k("j") } })).status);
  assert.equal(codes.filter((x) => x === 400).length, 20); assert.equal(codes[20], 429);
  // account switching: B signs in on the same phone and sees B's wallet and reports only
  const ua = await D.newUser(), ub = await D.newUser(), ta = await tokenFor(ua), tb = await tokenFor(ub);
  await D.call("commerce_grant_promo", { user_id: ua, amount: 3, reason: "test", actor: "test", idempotency_key: k() });
  const ja = await req(app, "POST", "/v1/jobs", { token: ta, body: { feature: "REGIONAL_PRICE_REPORT", input: { key: "X01" }, idempotency_key: k("job") } });
  assert.equal((await req(app, "GET", "/v1/wallet", { token: tb })).body.available, 0);
  assert.equal((await req(app, "GET", "/v1/reports", { token: tb })).body.length, 0);
  assert.equal((await req(app, "GET", `/v1/reports/${ja.body.report_id}`, { token: tb })).status, 404);
  const sameKey = await req(app, "POST", "/v1/jobs", { token: tb, body: { feature: "REGIONAL_PRICE_REPORT", input: { key: "X01" }, idempotency_key: "job-same-key-x1" } });
  assert.equal(sameKey.status, 402, "another account's balance is never used");
});
