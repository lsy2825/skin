// Round-2 review regressions on a real PostgreSQL (review package 2026-10-14): accounts, storage, idempotency under
// concurrency, report keeping period, refunds and reconciliation, request deadlines, AI budget, store adapters.
// Every test states the correct behaviour; the reproduction script showed the defect.
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./db.mjs";

const D = await freshDb("round2");
test.after(() => D.drop());
await D.pool.query("update public.premium_features set active = true where version = 1");   // mechanism tests use every feature
const key = (s = "k") => `${s}-${Math.random().toString(36).slice(2, 14)}`;
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
const asUser = (uid, fn, p) => D.asUser(uid, `select public.${fn}($1::jsonb) as r`, [JSON.stringify(p)]).then((r) => r[0].r);
const asUserNoArg = (uid, fn) => D.asUser(uid, `select public.${fn}() as r`).then((r) => r[0].r);

test("D1/R16: the same idempotency key sent 20× at once → one job, one charge, no error other than 'in progress'", async () => {
  const u = await D.newUser();
  await D.call("commerce_grant_promo", { user_id: u, amount: 5, reason: "t", actor: "t", idempotency_key: key("p") });
  const k = key("same");
  const rs = await Promise.allSettled(Array.from({ length: 20 }, () => D.call("commerce_reserve", { user_id: u, feature_code: "EVENT_URL_DECODER", idempotency_key: k, input_hash: "h", timeout_seconds: 60 })));
  assert.equal(rs.filter((r) => r.status === "rejected").length, 0, rs.filter((r) => r.status === "rejected").map((r) => r.reason.message).join("; "));
  assert.equal(rs.filter((r) => !r.value.repeat).length, 1, "exactly one first reservation");
  assert.equal(new Set(rs.map((r) => r.value.job.id)).size, 1);
  assert.equal((await D.call("commerce_wallet", { user_id: u })).available, 4);
  assert.ok((await D.call("commerce_verify_wallet", { user_id: u })).ok);
});

test("D1/R16: the same order key sent 10× at once → one order, every caller gets it", async () => {
  const u = await D.newUser(), k = key("ord");
  const rs = await Promise.allSettled(Array.from({ length: 10 }, () => D.call("commerce_create_order", { user_id: u, product_code: "MINI", channel: "DEMO", idempotency_key: k })));
  assert.equal(rs.filter((r) => r.status === "rejected").length, 0, rs.filter((r) => r.status === "rejected").map((r) => r.reason.message).join("; "));
  assert.equal(new Set(rs.map((r) => r.value.id)).size, 1);
  assert.equal((await D.pool.query("select count(*)::int n from public.orders where user_id = $1", [u])).rows[0].n, 1);
  // a different product with the same key is still refused
  assert.match(await err(D.call("commerce_create_order", { user_id: u, product_code: "PLUS", channel: "DEMO", idempotency_key: k })), /IDEMPOTENCY_CONFLICT/);
});

async function paidReport(u, feature = "EVENT_URL_DECODER") {
  await D.call("commerce_grant_promo", { user_id: u, amount: 2, reason: "t", actor: "t", idempotency_key: key("p") });
  const r = await D.call("commerce_reserve", { user_id: u, feature_code: feature, idempotency_key: key("j"), input_hash: "h", timeout_seconds: 60 });
  const c = await D.call("commerce_capture", { job_id: r.job.id, report: { kind: "EVENT", title: "보고서", payload: { items: [1] }, share_summary: { items: [] } } });
  return c.report_id || c.job.report_id;
}

test("R07: retain_until — past it a report cannot be read, listed, shared or opened by link, and the purge removes its content", async () => {
  const u = await D.newUser(), id = await paidReport(u);
  const sh = await D.call("commerce_share_report", { report_id: id, user_id: u });
  assert.ok(sh.token);
  await D.pool.query("update public.premium_reports set retain_until = now() - interval '1 minute' where id = $1", [id]);
  assert.equal(await D.call("commerce_report", { report_id: id, user_id: u }), null);
  assert.equal((await D.call("commerce_reports", { user_id: u })).length, 0);
  assert.equal(await D.call("commerce_shared", { token: sh.token }), null);
  assert.equal((await D.call("commerce_share_report", { report_id: id, user_id: u })).token, null);
  const p = await D.call("commerce_purge_expired_reports", {});
  assert.ok(p.purged >= 1);
  const row = (await D.pool.query("select payload, share_token, deleted_at from public.premium_reports where id = $1", [id])).rows[0];
  assert.equal(row.payload, null); assert.equal(row.share_token, null); assert.ok(row.deleted_at);
});

test("R16: report edits carry a version — an edit based on an older copy is refused, not merged over the newer one", async () => {
  const u = await D.newUser(), id = await paidReport(u);
  const a = await D.call("commerce_update_report", { report_id: id, user_id: u, payload: { items: [1], corrections: 1 }, expected_version: 0 });
  assert.equal(a.payload.version, 1);
  assert.match(await err(D.call("commerce_update_report", { report_id: id, user_id: u, payload: { items: [2], corrections: 1 }, expected_version: 0 })), /VERSION_CONFLICT/);
  // two edits at once from the same version: exactly one wins
  const rs = await Promise.allSettled([1, 2].map((n) => D.call("commerce_update_report", { report_id: id, user_id: u, payload: { items: [n], corrections: 2 }, expected_version: 1 })));
  assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
});

test("R07: account closing — no purchases: deleted outright; with purchases: personal data gone, ledger kept, no error", async () => {
  // never bought anything
  const a = await D.newUser();
  await D.pool.query("insert into public.profiles (id, nick) values ($1, '에이')", [a]);
  await D.pool.query("insert into public.records (id, user_id, done_on, procedure, brand, branch) values (gen_random_uuid(), $1, '2026-10-01', '슈링크', '블리비', '강남')", [a]);
  const ra = await asUserNoArg(a, "delete_me");
  assert.equal(ra.mode, "DELETED");
  assert.equal((await D.pool.query("select count(*)::int n from auth.users where id = $1", [a])).rows[0].n, 0);
  // bought, used, refunded, shared — before: auth.users delete failed on the ledger's 'on delete restrict'
  const b = await D.newUser();
  await D.pool.query("insert into public.profiles (id, nick) values ($1, '비')", [b]);
  await D.pool.query("insert into public.carts (id, user_id, name) values (gen_random_uuid(), $1, '장바구니')", [b]);
  const o = await D.call("commerce_create_order", { user_id: b, product_code: "STANDARD", channel: "DEMO", idempotency_key: key("o") });
  await D.call("commerce_fulfill_payment", { order_id: o.id, provider: "DEMO", provider_payment_id: key("pay"), amount: o.amount_krw, currency: "KRW", status: "DONE" });
  const id = await paidReport(b);
  const sh = await D.call("commerce_share_report", { report_id: id, user_id: b });
  const rb = await asUserNoArg(b, "delete_me");
  assert.equal(rb.mode, "CLOSED");
  for (const [t, col] of [["profiles", "id"], ["carts", "user_id"], ["records", "user_id"]])
    assert.equal((await D.pool.query(`select count(*)::int n from public.${t} where ${col} = $1`, [b])).rows[0].n, 0, t);
  assert.equal(await D.call("commerce_shared", { token: sh.token }), null, "share link revoked");
  assert.equal((await D.pool.query("select count(*)::int n from public.premium_reports where user_id = $1 and payload is not null", [b])).rows[0].n, 0);
  assert.ok((await D.pool.query("select count(*)::int n from public.credit_transactions where user_id = $1", [b])).rows[0].n > 0, "ledger kept");
  assert.equal((await D.pool.query("select count(*)::int n from public.closed_accounts where user_id = $1", [b])).rows[0].n, 1);
  // closing twice is harmless
  assert.equal((await D.call("commerce_close_account", { user_id: b })).mode, "CLOSED");
  // nobody signed in cannot call it (no JWT subject)
  const c = await D.pool.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    assert.match(await err(c.query("select public.delete_me()")), /UNAUTHENTICATED/);
  } finally { await c.query("rollback"); c.release(); }
});

test("R16: save_cart — one transaction, version-checked, never takes over another user's cart id", async () => {
  const u = await D.newUser(), v = await D.newUser(), cid = crypto.randomUUID();
  const items = [{ t: "k", k: "X01", q: 2 }, { t: "r", n: "슈링크 300샷", br: "블리비|강남", q: 1, ov: {} }];
  const s1 = await asUser(u, "save_cart", { id: cid, name: "내 장바구니", items, expected_version: null });
  assert.equal(s1.version, 1);
  const s2 = await asUser(u, "save_cart", { id: cid, name: "내 장바구니", items: items.slice(0, 1), expected_version: 1 });
  assert.equal(s2.version, 2);
  assert.equal((await D.pool.query("select count(*)::int n from public.cart_items where cart_id = $1", [cid])).rows[0].n, 1);
  // a stale device (still on version 1) cannot overwrite version 2
  assert.match(await err(asUser(u, "save_cart", { id: cid, name: "x", items, expected_version: 1 })), /VERSION_CONFLICT/);
  assert.equal((await D.pool.query("select count(*)::int n from public.cart_items where cart_id = $1", [cid])).rows[0].n, 1, "nothing half-written");
  // a bad item aborts the whole save: items stay as they were (before: items deleted, insert failed → empty cart)
  assert.ok(await err(asUser(u, "save_cart", { id: cid, name: "x", items: [{ t: "z" }], expected_version: 2 })));
  assert.equal((await D.pool.query("select count(*)::int n from public.cart_items where cart_id = $1", [cid])).rows[0].n, 1);
  // another user using the same id gets 'not found', and the cart stays u's
  assert.match(await err(asUser(v, "save_cart", { id: cid, name: "탈취", items: [], expected_version: null })), /NOT_FOUND/);
  assert.equal((await D.pool.query("select user_id from public.carts where id = $1", [cid])).rows[0].user_id, u);
});

// ---------------------------------------------------------------- stage 3: payments, deadlines, AI budget, limits
import { createApp, dataLoader } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { signHs256 } from "../src/auth.mjs";
import { tossAdapter } from "../src/payments/toss.mjs";
import { paymentFlows } from "../src/payments/flow.mjs";
import { fetchT, readJson, dbRateStore, rateLimiter } from "../src/http.mjs";
import { fetchPublicText } from "../src/safe.mjs";
import { openaiVision } from "../src/ai/openai.mjs";

const rpc = (fn, p) => D.call(fn, p);
await D.pool.query("update public.credit_products set approved_by = 'test-sandbox', active = true where channel = 'WEB_PG' and version = 2");
function toss() {
  const pays = new Map();
  const send = (st, b) => new Response(JSON.stringify(b), { status: st, headers: { "content-type": "application/json" } });
  const fetch = async (url, o = {}) => {
    const u = new URL(url), body = o.body ? JSON.parse(o.body) : null; let m;
    if (u.pathname === "/v1/payments/confirm") { const p = pays.get(body.paymentKey); p.status = "DONE"; return send(200, p); }
    if ((m = /^\/v1\/payments\/orders\/(.+)$/.exec(u.pathname))) { const p = [...pays.values()].find((x) => x.orderId === decodeURIComponent(m[1])); return p ? send(200, p) : send(404, { code: "NOT_FOUND_PAYMENT" }); }
    if ((m = /^\/v1\/payments\/([^/]+)$/.exec(u.pathname))) { const p = pays.get(decodeURIComponent(m[1])); return p ? send(200, p) : send(404, {}); }
    return send(404, {});
  };
  const open = (orderId, amount, extra = {}) => { const k = `pk_${Math.random().toString(36).slice(2)}`; pays.set(k, { paymentKey: k, orderId, totalAmount: amount, balanceAmount: amount, currency: "KRW", status: "READY", method: "카드", cancels: [], ...extra }); return k; };
  return { fetch, open, pays, adapter: tossAdapter({ secretKey: "test_sk_fake", fetch }) };
}

test("R06: a PARTIAL cancel that arrives before we granted anything keeps the paid remainder (grant, then proportional refund)", async () => {
  const T = toss(), flows = paymentFlows({ rpc, toss: T.adapter }), u = await D.newUser();
  const o = await D.call("commerce_create_order", { user_id: u, product_code: "PLUS", channel: "WEB_PG", idempotency_key: key("o") });
  const pk = T.open(o.id, o.amount_krw, { status: "PARTIAL_CANCELED", balanceAmount: o.amount_krw - 1950,
    cancels: [{ transactionKey: `tx_${key()}`, cancelAmount: 1950, cancelStatus: "DONE", canceledAt: new Date().toISOString() }] });
  const r = await flows.applyTossState(T.adapter.normalize(T.pays.get(pk)), "webhook");
  assert.match(r, /REFUNDS_RECORDED_1/);
  const w = await D.call("commerce_wallet", { user_id: u });
  assert.equal(w.paid, 13, "26 credits for 3,900원, half refunded → 13 kept (before: order closed, remainder lost)");
  assert.equal((await D.call("commerce_get_order", { order_id: o.id })).status, "PARTIAL_REFUNDED");
  assert.ok((await D.call("commerce_verify_wallet", { user_id: u })).ok);
  // a FULL cancel before the grant still just closes the order (no money stays with us)
  const o2 = await D.call("commerce_create_order", { user_id: u, product_code: "MINI", channel: "WEB_PG", idempotency_key: key("o") });
  const pk2 = T.open(o2.id, o2.amount_krw, { status: "CANCELED", balanceAmount: 0, cancels: [{ transactionKey: `tx_${key()}`, cancelAmount: o2.amount_krw, cancelStatus: "DONE" }] });
  assert.equal(await flows.applyTossState(T.adapter.normalize(T.pays.get(pk2)), "webhook"), "CLOSED_CANCELED");
});

test("R06: a refund made at Toss after the grant, with its webhook lost, is found by the reconciliation sweep", async () => {
  const T = toss(), flows = paymentFlows({ rpc, toss: T.adapter }), u = await D.newUser();
  const o = await D.call("commerce_create_order", { user_id: u, product_code: "STANDARD", channel: "WEB_PG", idempotency_key: key("o") });
  const pk = T.open(o.id, o.amount_krw); T.pays.get(pk).status = "DONE";
  await flows.applyTossState(T.adapter.normalize(T.pays.get(pk)), "confirm");
  assert.equal((await D.call("commerce_wallet", { user_id: u })).paid, 12);
  // refunded at Toss (admin console) — no webhook reaches us
  Object.assign(T.pays.get(pk), { status: "CANCELED", balanceAmount: 0, cancels: [{ transactionKey: `tx_${key()}`, cancelAmount: o.amount_krw, cancelStatus: "DONE" }] });
  await D.pool.query("update public.payments set last_checked_at = null where provider_payment_id = $1", [pk]);
  const sweep = await flows.reconcile({ recheckLimit: 500 });
  assert.ok(sweep.rechecked >= 1);
  assert.equal((await D.call("commerce_wallet", { user_id: u })).paid, 0, "the refund was applied by the sweep");
  // a second sweep does not refund twice
  await D.pool.query("update public.payments set last_checked_at = null where provider_payment_id = $1", [pk]);
  await flows.reconcile({ recheckLimit: 500 });
  assert.equal((await D.pool.query("select count(*)::int n from public.payment_refunds r join public.payments p on p.id = r.payment_id where p.provider_payment_id = $1", [pk])).rows[0].n, 1);
});

test("R16: the refund preview promises what the refund then takes (same cumulative rounding)", async () => {
  const u = await D.newUser();
  const o = await D.call("commerce_create_order", { user_id: u, product_code: "STANDARD", channel: "DEMO", idempotency_key: key("o") });
  const pid = key("pay");
  await D.call("commerce_fulfill_payment", { order_id: o.id, provider: "DEMO", provider_payment_id: pid, amount: 1990, currency: "KRW", status: "DONE" });
  for (const amt of [333, 333, 333]) {
    const pv = await D.call("commerce_preview_refund", { provider: "DEMO", provider_payment_id: pid, amount: amt });
    const rf = await D.call("commerce_refund", { provider: "DEMO", provider_payment_id: pid, provider_refund_id: key("r"), amount: amt, kind: "REFUND", provider_done: true, reason: "t" });
    assert.equal(pv.credits_target, rf.refund.credits_target, `amount ${amt}`);
  }
});

test("R10: one deadline covers headers AND body; a stalled body or page is cut off; request bodies are byte-limited", async () => {
  let signal;
  const slowBody = async (_u, o) => { signal = o.signal; return { ok: true, status: 200, json: () => new Promise((r) => setTimeout(() => r({ ok: true }), 200)) }; };
  const t0 = Date.now(), res = await fetchT(slowBody, "https://x.invalid", {}, 30);
  await assert.rejects(res.json(), (e) => e.code === "UPSTREAM_TIMEOUT");
  assert.ok(Date.now() - t0 < 150, `took ${Date.now() - t0}ms`); assert.equal(signal.aborted, true);
  // a streamed body that sends one chunk and stalls
  const stall = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); } }), { status: 200 });
  const r2 = await fetchT(stall, "https://x.invalid", {}, 40);
  await assert.rejects(r2.json(), (e) => e.code === "UPSTREAM_TIMEOUT");
  // too large
  const big = async () => new Response("x".repeat(5000), { status: 200 });
  await assert.rejects((await fetchT(big, "https://x.invalid", {}, 1000, 1000)).text(), (e) => e.code === "UPSTREAM_TOO_LARGE");
  // public page: a body that never ends is stopped at the deadline (before: waited for the next chunk forever)
  const late = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("<p>a")); } }), { headers: { "content-type": "text/html" } });
  const t1 = Date.now();
  await assert.rejects(fetchPublicText("https://example.com/x", { fetch: late, resolve: async () => true, timeoutMs: 20 }), (e) => e.code === "FETCH_FAILED");
  assert.ok(Date.now() - t1 < 200);
  // incoming body without Content-Length larger than the limit
  const req = new Request("https://api.test/x", { method: "POST", body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("x".repeat(70000))); c.close(); } }), duplex: "half" });
  await assert.rejects(readJson(req, 64 * 1024), (e) => e.status === 413);
});

test("R11: Workers DNS (lookup 'Not implemented') falls back to DNS-over-HTTPS; private answers refused; no answer → explicit refusal", async () => {
  const { resolvesPublic } = await import("../src/safe.mjs");
  const notImpl = { promises: { lookup: async () => { throw new Error("[unenv] dns.lookup is not implemented yet!"); } } };
  const doh = (ip) => async (url) => new Response(JSON.stringify({ Answer: url.includes("type=A&") || url.endsWith("type=A") ? [{ type: 1, data: ip }] : [] }), { status: 200 });
  assert.equal(await resolvesPublic("example.com", { dns: notImpl, fetch: doh("93.184.216.34") }), true);
  assert.equal(await resolvesPublic("evil.example", { dns: notImpl, fetch: doh("10.0.0.5") }), false);
  await assert.rejects(resolvesPublic("x.example", { dns: notImpl, fetch: async () => new Response("", { status: 500 }) }), (e) => e.code === "DNS_CHECK_UNAVAILABLE");
  // Node: a real lookup failure is still 'address not found'
  const nxd = { promises: { lookup: async () => { const e = new Error("getaddrinfo ENOTFOUND"); e.code = "ENOTFOUND"; throw e; } } };
  await assert.rejects(resolvesPublic("nope.invalid", { dns: nxd }), (e) => e.code === "PAGE_UNREADABLE");
});

test("R08: AI spend is reserved before each call — a job never passes its budget, parallel calls never pass the day's", async () => {
  await D.pool.query(`insert into public.model_cost_config (provider, model, effective_date, input_cost_per_million, cached_input_cost_per_million, output_cost_per_million,
    image_cost_calculation_method, currency, exchange_rate_used, pricing_source, last_verified_at) values
    ('OPENAI', 'budget-test', '2026-01-01', 1.0, 0.1, 1.0, 'usage.input_tokens', 'USD', 1000, 'test fixture (not a real price)', now()) on conflict do nothing`);
  // worst case per call = (20000 + 20000 tokens) × 1 USD/M × 1000 = 40원; the job budget is 60원 → the fallback (another 40원) is refused
  let calls = 0;
  const v = openaiVision({ apiKey: "mock", model: "budget-test", strongModel: "budget-test", maxInputTokens: 20000, maxOutputTokens: 20000, maxKrwPerJob: 60, maxServiceKrwPerDay: 1e9,
    fetch: async () => { calls++; return new Response(JSON.stringify({ error: { code: "server_error" }, usage: { input_tokens: 20000, output_tokens: 20000 } }), { status: 500 }); } }, rpc);
  const u = await D.newUser();
  const out = await v.extract("data:image/png;base64,AAAA", { jobId: null, userId: u, year: 2026 });
  assert.equal(calls, 1, "the second call was refused before it ran (before: both ran, 80원 on a 60원 budget)");
  assert.ok(out.cost_krw <= 60, String(out.cost_krw));
  assert.equal(out.calls.find((c) => c.skipped).skipped, "JOB_LIMIT");
  // service-wide: 10 parallel reservations of 40원 under a 100원 day → at most 2 succeed
  const rs = await Promise.all(Array.from({ length: 10 }, () => D.call("commerce_ai_reserve", { provider: "OPENAI", model: "budget-test", max_input_tokens: 20000, max_output_tokens: 20000,
    max_day_krw: 100 })));
  assert.equal((await D.call("commerce_ai_reserve", { provider: "OPENAI", model: "budget-test", max_day_krw: "NaN" })).ok, false, "a NaN cap refuses");
  const sumToday = (await D.pool.query("select coalesce(sum(coalesce(settled_krw, est_krw)),0)::numeric s from public.ai_budget_holds where created_at >= date_trunc('day', now())")).rows[0].s;
  assert.ok(rs.filter((r) => r.ok).length <= 2, JSON.stringify(rs.map((r) => r.reason || "ok")));
  assert.ok(+sumToday <= 100 + 40, String(sumToday));
  // an unpriced model is refused, never assumed to cost 0
  assert.equal((await D.call("commerce_ai_reserve", { provider: "OPENAI", model: "no-price", max_day_krw: 1e9 })).reason, "NOT_PRICED");
});

test("D3: the data host failing after the cache aged out keeps the last good copy instead of failing every paid job", async () => {
  const fs = await import("node:fs"); const path = await import("node:path");
  const body = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../app/data.json"), "utf8");
  let up = true;
  const load = dataLoader({ url: "https://data.test/data.json", ttlMs: 1, fetch: async () => up ? new Response(body, { status: 200 }) : new Response("", { status: 503 }) });
  const a = await load();
  up = false; await new Promise((r) => setTimeout(r, 5));
  const b = await load();
  assert.equal(b, a, "stale copy served");
});

test("D4/M7: the database-backed limit is shared by every server instance (two apps, one count)", async () => {
  const store = dbRateStore(rpc), l1 = rateLimiter(store, 5, 60000), l2 = rateLimiter(store, 5, 60000), k = key("rl");
  let ok = 0, limited = 0;
  for (let i = 0; i < 8; i++) { try { await (i % 2 ? l1 : l2)(k); ok++; } catch (e) { if (e.code === "RATE_LIMITED") limited++; else throw e; } }
  assert.equal(ok, 5); assert.equal(limited, 3);
  // the in-memory fallback forgets old keys instead of growing forever
  const m = new Map(), lm = rateLimiter(m, 5, 1);
  for (let i = 0; i < 10050; i++) m.set(`old:${i}`, [Date.now() - 1000]);
  await lm("fresh");
  assert.ok(m.size < 100, String(m.size));
});

test("R15: empty / safety / not-found follow-ups take no slot; a retried turn key returns the same answer; a failed answer gives the slot back", async () => {
  const PriceCtx = (await import("../../app/domain/pricectx.js")).default;
  const fs = await import("node:fs"); const path = await import("node:path");
  const CTX = PriceCtx.fromData(JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../app/data.json"), "utf8")), "2026-10-14");
  const { jobRunner } = await import("../src/jobs.mjs");
  const u = await D.newUser();
  await D.call("commerce_grant_promo", { user_id: u, amount: 1, reason: "t", actor: "t", idempotency_key: key("p") });
  const run = jobRunner({ rpc, ctx: CTX, ai: null });
  const j = await run.run({ id: u }, "JOMI_QA_SESSION", { question: "리쥬란힐러 2cc 가격 알려줘" }, key("jomi"));
  const used = async () => (await D.call("commerce_report", { report_id: j.report_id, user_id: u })).payload.turns_used || 1;
  const before = await used();
  for (const q of ["", "   ", "보톡스 몇 유닛 맞아야 해요?", "안녕하세요 반가워요", "리쥬란힐러 7cc는요?"]) {
    const r = await run.ask({ id: u }, j.report_id, q, key("t"));
    assert.equal(r.free, true, q);
  }
  assert.equal(await used(), before, "no slot taken by free answers");
  const tk = key("turn");
  const a1 = await run.ask({ id: u }, j.report_id, "국산 사각턱 보톡스 50U는요?", tk);
  const a2 = await run.ask({ id: u }, j.report_id, "국산 사각턱 보톡스 50U는요?", tk);   // the response was lost; the app retries
  assert.equal(a2.repeat, true); assert.equal(a2.turn.answer, a1.turn.answer);
  assert.equal(await used(), before + 1, "a retry is not a second turn");
  // the answer fails after the slot was taken → the slot comes back
  const broken = jobRunner({ rpc: async (fn, p) => { if (fn === "commerce_jomi_turn" && p.action === "append") throw new Error("db down"); return rpc(fn, p); }, ctx: CTX, ai: null });
  await assert.rejects(broken.ask({ id: u }, j.report_id, "리쥬란 힐러 1cc는요?", key("turn")));
  assert.equal(await used(), before + 1, "released after the failure");
  // follow-up: '그럼 4cc는?' alone names no treatment (free, not found); with the previous question it is a turn on 4cc
  const lone = await run.ask({ id: u }, j.report_id, "그럼 4cc는?", key("t"));
  assert.equal(lone.free, true);
  const fu = await run.ask({ id: u }, j.report_id, "그럼 4cc는?", key("t"), "리쥬란힐러 2cc 가격 알려줘");
  assert.ok(!fu.free, JSON.stringify(fu.turn));
  assert.equal(fu.turn.q, "그럼 4cc는?");
  assert.match(fu.turn.asked, /리쥬란힐러.*4cc/);
  assert.doesNotMatch(fu.turn.asked, /2cc/);
});
