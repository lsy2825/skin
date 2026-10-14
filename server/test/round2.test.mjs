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
