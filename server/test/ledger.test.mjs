// Credit ledger on a real PostgreSQL (docs/CREDIT_LEDGER_SPEC.md, docs/PAYMENT_SANDBOX_QA.md §wallet): orders with price
// snapshots, exactly-once fulfilment, reservations under concurrency, capture / release / timeout, promo vs paid, refunds
// and chargebacks without negative balances, ad-free stacking, RLS (users read their own rows and write nothing).
import test from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./db.mjs";

const D = await freshDb("ledger");
test.after(() => D.drop());
const key = (s) => `${s}-${Math.random().toString(36).slice(2, 12)}`;
const buy = async (u, code = "STANDARD") => {
  const o = await D.call("commerce_create_order", { user_id: u, product_code: code, channel: "DEMO", idempotency_key: key("ord") });
  const r = await D.call("commerce_fulfill_payment", { order_id: o.id, provider: "DEMO", provider_payment_id: key("pay"), amount: o.amount_krw, currency: "KRW", status: "DONE" });
  return { o, r };
};
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
const verify = async (u) => (await D.call("commerce_verify_wallet", { user_id: u })).ok;

test("order snapshot: price and credits come from the catalog, not the client; same key → same order; other product → refused", async () => {
  const u = await D.newUser(), k = key("ord");
  const o = await D.call("commerce_create_order", { user_id: u, product_code: "MINI", channel: "DEMO", idempotency_key: k, amount: 1, paid_credits: 999 });
  assert.equal(o.amount_krw, 990); assert.equal(o.paid_credits, 5); assert.equal(o.adfree_days, 7); assert.equal(o.vat_included, true);
  const again = await D.call("commerce_create_order", { user_id: u, product_code: "MINI", channel: "DEMO", idempotency_key: k });
  assert.equal(again.id, o.id);
  assert.match(await err(D.call("commerce_create_order", { user_id: u, product_code: "PLUS", channel: "DEMO", idempotency_key: k })), /IDEMPOTENCY_CONFLICT/);
  assert.match(await err(D.call("commerce_create_order", { user_id: u, product_code: "MINI", channel: "WEB_PG", idempotency_key: key("o") })), /PRODUCT_NOT_FOR_SALE/);  // not approved
  // a catalog change later does not touch the order
  await D.pool.query("insert into public.credit_products (code, version, channel, price_krw, vat_included, paid_credits, adfree_days, active) values ('MINI', 2, 'DEMO', 1290, true, 5, 7, false)");
  await D.pool.query("update public.credit_products set active = false where code = 'MINI' and version = 1 and channel = 'DEMO'");
  await D.pool.query("update public.credit_products set active = true where code = 'MINI' and version = 2 and channel = 'DEMO'");
  const r = await D.call("commerce_fulfill_payment", { order_id: o.id, provider: "DEMO", provider_payment_id: key("pay"), amount: 990, currency: "KRW", status: "DONE" });
  assert.equal(r.wallet.paid, 5);
  await D.pool.query("update public.credit_products set active = false where code = 'MINI' and version = 2 and channel = 'DEMO'");
  await D.pool.query("update public.credit_products set active = true where code = 'MINI' and version = 1 and channel = 'DEMO'");
});

test("fulfilment exactly once: duplicate callback, wrong amount, wrong currency, not done, second payment, wrong channel", async () => {
  const u = await D.newUser();
  const o = await D.call("commerce_create_order", { user_id: u, product_code: "STANDARD", channel: "DEMO", idempotency_key: key("ord") });
  const base = { order_id: o.id, provider: "DEMO", provider_payment_id: "pk_1_" + o.id, amount: 1990, currency: "KRW", status: "DONE" };
  assert.match(await err(D.call("commerce_fulfill_payment", { ...base, amount: 100 })), /AMOUNT_MISMATCH/);
  assert.match(await err(D.call("commerce_fulfill_payment", { ...base, currency: "USD" })), /CURRENCY_MISMATCH/);
  assert.match(await err(D.call("commerce_fulfill_payment", { ...base, status: "WAITING_FOR_DEPOSIT" })), /PAYMENT_NOT_DONE/);
  assert.match(await err(D.call("commerce_fulfill_payment", { ...base, provider: "TOSS" })), /CHANNEL_MISMATCH/);
  const [a, b] = await Promise.all([D.call("commerce_fulfill_payment", base), D.call("commerce_fulfill_payment", base)]);   // racing callbacks
  assert.equal([a.already, b.already].filter(Boolean).length, 1);
  assert.equal((await D.call("commerce_wallet", { user_id: u })).paid, 12);
  assert.match(await err(D.call("commerce_fulfill_payment", { ...base, provider_payment_id: "other" })), /ORDER_ALREADY_PAID/);
  const n = await D.pool.query("select count(*)::int n from public.credit_transactions where user_id = $1 and type = 'PURCHASE_GRANTED'", [u]);
  assert.equal(n.rows[0].n, 1);
  assert.ok(await verify(u));
});

test("late confirmation: a payment for an expired / abandoned order is still credited once", async () => {
  const u = await D.newUser();
  const o = await D.call("commerce_create_order", { user_id: u, product_code: "MINI", channel: "DEMO", idempotency_key: key("ord") });
  await D.call("commerce_close_order", { order_id: o.id, status: "EXPIRED", reason: "no confirmation in 30 min" });
  const r = await D.call("commerce_fulfill_payment", { order_id: o.id, provider: "DEMO", provider_payment_id: "late_" + o.id, amount: 990, currency: "KRW", status: "DONE" });
  assert.equal(r.order.status, "FULFILLED"); assert.equal(r.wallet.paid, 5);
  assert.equal((await D.call("commerce_close_order", { order_id: o.id, status: "FAILED" })).changed, false);   // a paid order is never closed
});

test("reserve → capture → report + entitlement; repeat request = same job, no second charge", async () => {
  const u = await D.newUser(); await buy(u, "STANDARD");
  const req = { user_id: u, feature_code: "ADVANCED_CART_PLANNER", idempotency_key: key("job"), scope: { cart: "c1" } };
  const r1 = await D.call("commerce_reserve", req);
  assert.equal(r1.job.credits, 2); assert.equal(r1.wallet.available, 10);
  const r2 = await D.call("commerce_reserve", req);
  assert.equal(r2.repeat, true); assert.equal(r2.job.id, r1.job.id);
  assert.match(await err(D.call("commerce_capture", { job_id: r1.job.id })), /NO_DELIVERABLE/);
  const c = await D.call("commerce_capture", { job_id: r1.job.id, report: { title: "계획", payload: { x: 1 } } });
  assert.equal(c.wallet.paid, 10); assert.ok(c.report_id); assert.ok(c.entitlement_id);
  assert.equal((await D.call("commerce_capture", { job_id: r1.job.id, report: { title: "계획" } })).already, true);
  // recalculation in the 30-day window: 0 credits for the same scope, full price for another cart
  const re = await D.call("commerce_reserve", { ...req, idempotency_key: key("job") });
  assert.equal(re.job.credits, 0); assert.equal(re.covered_by_entitlement, true);
  const other = await D.call("commerce_reserve", { ...req, idempotency_key: key("job"), scope: { cart: "c2" } });
  assert.equal(other.job.credits, 2);
  assert.ok(await verify(u));
});

test("release on failure and timeout; capture after release refused; repeated release harmless", async () => {
  const u = await D.newUser(); await buy(u, "MINI");
  const r = await D.call("commerce_reserve", { user_id: u, feature_code: "EVENT_IMAGE_DECODER", idempotency_key: key("job") });
  assert.equal(r.wallet.available, 4);
  assert.equal((await D.call("commerce_release", { job_id: r.job.id, reason: "VALIDATION_FAILED" })).changed, true);
  assert.equal((await D.call("commerce_release", { job_id: r.job.id, reason: "again" })).changed, false);
  assert.equal((await D.call("commerce_wallet", { user_id: u })).available, 5);
  assert.match(await err(D.call("commerce_capture", { job_id: r.job.id, report: { title: "x" } })), /JOB_RELEASED/);
  const t = await D.call("commerce_reserve", { user_id: u, feature_code: "EVENT_IMAGE_DECODER", idempotency_key: key("job"), timeout_seconds: 1 });
  await D.call("commerce_start_job", { job_id: t.job.id });
  await new Promise((ok) => setTimeout(ok, 1200));
  assert.ok((await D.call("commerce_expire_jobs", {})).released >= 1);
  const w = await D.call("commerce_wallet", { user_id: u });
  assert.equal(w.available, 5); assert.equal(w.paid_reserved, 0);
  assert.ok(await verify(u));
});

test("concurrency: 20 parallel spends on 5 credits → exactly 5 succeed, never below zero", async () => {
  const u = await D.newUser(); await buy(u, "MINI");
  const rs = await Promise.allSettled(Array.from({ length: 20 }, () => D.call("commerce_reserve", { user_id: u, feature_code: "EVENT_URL_DECODER", idempotency_key: key("job") })));
  const ok = rs.filter((x) => x.status === "fulfilled"), bad = rs.filter((x) => x.status === "rejected");
  assert.equal(ok.length, 5);
  assert.ok(bad.every((x) => /INSUFFICIENT_CREDITS/.test(x.reason.message)));
  await Promise.all(ok.map((x) => D.call("commerce_capture", { job_id: x.value.job.id, report: { title: "r" } })));
  const w = await D.call("commerce_wallet", { user_id: u });
  assert.equal(w.paid, 0); assert.equal(w.paid_reserved, 0);
  assert.ok(await verify(u));
});

test("promo credits are a separate bucket and spent first; admin adjustment needs a reason and cannot go negative", async () => {
  const u = await D.newUser(); await buy(u, "MINI");
  await D.call("commerce_grant_promo", { user_id: u, amount: 2, idempotency_key: key("p"), reason: "가입 환영", actor: "admin:test" });
  const r = await D.call("commerce_reserve", { user_id: u, feature_code: "MULTI_EVENT_COMPARE", idempotency_key: key("job") });   // 2C
  const res = await D.pool.query("select paid, promo from public.credit_reservations where job_id = $1", [r.job.id]);
  assert.deepEqual(res.rows[0], { paid: 0, promo: 2 });
  assert.match(await err(D.call("commerce_admin_adjust", { user_id: u, bucket: "PAID", delta: -1, actor: "admin:test", idempotency_key: key("a") })), /BAD_REQUEST/);
  assert.match(await err(D.call("commerce_admin_adjust", { user_id: u, bucket: "PAID", delta: -6, reason: "x", actor: "admin:test", idempotency_key: key("a") })), /WOULD_GO_NEGATIVE/);
  assert.match(await err(D.call("commerce_grant_promo", { user_id: u, amount: 1000, idempotency_key: key("p"), reason: "x", actor: "a" })), /BAD_REQUEST/);
  assert.ok(await verify(u));
});

test("refunds: full refund of an unspent pack; spent credits are never pushed below zero; chargeback recorded as unrecovered", async () => {
  const u = await D.newUser(); const { o } = await buy(u, "PLUS");   // 26 credits, 45 ad-free days
  const pid = (await D.pool.query("select provider_payment_id from public.payments where order_id = $1", [o.id])).rows[0].provider_payment_id;
  // spend 20 → a refund we start ourselves is refused (manual review), a chargeback is recorded with 14 unrecovered
  const jobs = [];
  for (let i = 0; i < 10; i++) jobs.push(await D.call("commerce_reserve", { user_id: u, feature_code: "MULTI_EVENT_COMPARE", idempotency_key: key("job") }));
  for (const j of jobs) await D.call("commerce_capture", { job_id: j.job.id, report: { title: "r" } });
  const pv = await D.call("commerce_preview_refund", { provider: "DEMO", provider_payment_id: pid });
  assert.equal(pv.automatic, false); assert.equal(pv.unspent, 6);
  assert.match(await err(D.call("commerce_refund", { provider: "DEMO", provider_payment_id: pid, provider_refund_id: "rf1", amount: 3900, kind: "REFUND", actor: "t" })), /CREDITS_ALREADY_SPENT/);
  const cb = await D.call("commerce_refund", { provider: "DEMO", provider_payment_id: pid, provider_refund_id: "cb1", amount: 3900, kind: "CHARGEBACK", actor: "t" });
  assert.equal(cb.refund.credits_reversed, 6); assert.equal(cb.refund.credits_unrecovered, 20);
  assert.equal(cb.wallet.paid, 0);
  assert.equal(cb.wallet.ad_free_until, null);                                   // the pack's 45 days are gone
  assert.equal((await D.call("commerce_refund", { provider: "DEMO", provider_payment_id: pid, provider_refund_id: "cb1", amount: 3900, kind: "CHARGEBACK", actor: "t" })).already, true);
  // reports already made stay readable
  const reps = await D.asUser(u, "select count(*)::int n from public.premium_reports");
  assert.equal(reps[0].n, 10);
  // an unspent pack: full refund takes all 12 back
  const u2 = await D.newUser(); const b2 = await buy(u2, "STANDARD");
  const pid2 = (await D.pool.query("select provider_payment_id from public.payments where order_id = $1", [b2.o.id])).rows[0].provider_payment_id;
  const half = await D.call("commerce_refund", { provider: "DEMO", provider_payment_id: pid2, provider_refund_id: "p1", amount: 995, actor: "t" });
  assert.equal(half.refund.credits_reversed, 6); assert.equal(half.wallet.paid, 6);
  const rest = await D.call("commerce_refund", { provider: "DEMO", provider_payment_id: pid2, provider_refund_id: "p2", amount: 995, actor: "t" });
  assert.equal(rest.refund.credits_reversed, 6); assert.equal(rest.wallet.paid, 0);
  assert.match(await err(D.call("commerce_refund", { provider: "DEMO", provider_payment_id: pid2, provider_refund_id: "p3", amount: 1, actor: "t" })), /REFUND_AMOUNT_INVALID/);
  assert.ok(await verify(u)); assert.ok(await verify(u2));
});

test("ad-free: buying again extends from the later of now and the current end", async () => {
  const u = await D.newUser();
  await buy(u, "MINI");                                       // 7 days
  const w1 = await D.call("commerce_wallet", { user_id: u });
  await buy(u, "STANDARD");                                   // + 21 days on top
  const w2 = await D.call("commerce_wallet", { user_id: u });
  const days = (new Date(w2.ad_free_until) - new Date(w1.ad_free_until)) / 864e5;
  assert.ok(Math.abs(days - 21) < 0.01, String(days));
  // expired ad-free never touches credits
  await D.pool.query("update public.ad_free_entitlements set ends_at = now() - interval '1 day' where user_id = $1", [u]);
  const w3 = await D.call("commerce_wallet", { user_id: u });
  assert.equal(w3.ad_free_until, null); assert.equal(w3.paid, 17);
});

test("ledger is append-only and users can only read their own rows (no writes, no functions)", async () => {
  const u = await D.newUser(), v = await D.newUser(); await buy(u); await buy(v);
  assert.match(await err(D.pool.query("update public.credit_transactions set amount = 999")), /append-only/);
  assert.match(await err(D.pool.query("delete from public.credit_transactions")), /append-only/);
  const mine = await D.asUser(u, "select user_id from public.credit_transactions");
  assert.ok(mine.length > 0 && mine.every((r) => r.user_id === u));
  assert.equal((await D.asUser(u, "select * from public.credit_wallets where user_id = $1", [v])).length, 0);
  assert.match(await err(D.asUser(u, "update public.credit_wallets set paid_balance = 9999 where user_id = $1", [u])), /permission denied/);
  assert.match(await err(D.asUser(u, "insert into public.credit_transactions (user_id, type, bucket, amount, effect_balance, effect_reserved, source, idempotency_key, actor) values ($1, 'PURCHASE_GRANTED', 'PAID', 99, 99, 0, 'x', 'x', 'x')", [u])), /permission denied/);
  assert.match(await err(D.asUser(u, "select public.commerce_grant_promo('{}'::jsonb)")), /permission denied/);
  assert.match(await err(D.asUser(u, "select public.commerce_fulfill_payment('{}'::jsonb)")), /permission denied/);
  const pay = await D.asUser(u, "select o.user_id from public.payments p join public.orders o on o.id = p.order_id");
  assert.ok(pay.every((r) => r.user_id === u));
  const cat = await D.asUser(u, "select code, channel from public.credit_products");
  assert.ok(cat.every((r) => r.channel === "DEMO"));                               // unapproved live prices are not even listed
});
