// What is left of the 5.0 credit modules until chat A's A6 takes the credit card off the ops screen (app/screens/ops.js
// loads demowallet.js and economics.js): demo wallet rules, the demo catalog equals supabase/commerce_seed.sql, unit
// economics. The report builders (premium.js) and the paid Jomi Q&A guard (jomiqa.js) went with the credits (6.0, B7).
// Run: node --test tests/commerce.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const W = require("../app/domain/demowallet.js");
const E = require("../app/domain/economics.js");
const SEED = fs.readFileSync(path.join(__dirname, "../supabase/commerce_seed.sql"), "utf8");

test("demo catalog and feature prices are the seed's (one source of truth for the numbers)", () => {
  for (const p of W.PRODUCTS) {
    const m = new RegExp(`\\('${p.code}',\\s*${p.version}, 'DEMO',\\s*null, (\\d+),\\s*(true|false), (\\d+),\\s*(\\d+),`).exec(SEED);
    assert.ok(m, p.code);
    assert.deepEqual([+m[1], m[2] === "true", +m[3], +m[4]], [p.price_krw, p.vat_included, p.credits, p.adfree_days]);
  }
  for (const [code, f] of Object.entries(W.FEATURES)) {
    const m = new RegExp(`\\('${code}',\\s*1, (\\d+), (\\d+),`).exec(SEED);
    assert.ok(m, code); assert.deepEqual([+m[1], +m[2]], [f.credits, f.days]);
  }
  // the directive's credit prices
  assert.deepEqual(Object.fromEntries(Object.entries(W.FEATURES).map(([k, v]) => [k, v.credits])), { EVENT_IMAGE_DECODER: 1, EVENT_URL_DECODER: 1, MULTI_EVENT_COMPARE: 2,
    QUOTATION_DECODER: 1, JOMI_QA_SESSION: 1, PRODUCT_DEEP_COMPARE: 1, PRICE_HISTORY_REPORT: 1, REGIONAL_PRICE_REPORT: 1, ADVANCED_CART_PLANNER: 2, PRICE_WATCH_7D: 1, PRICE_WATCH_30D: 3, CONSOLIDATED_REPORT: 2 });
  // round 2: what is sold in the demo is what the seed leaves active (the update statement lists the unsold ones)
  const unsold = /update public\.premium_features set active = false[^;]*/.exec(SEED)[0];
  for (const [code, f] of Object.entries(W.FEATURES)) assert.equal(!!f.sold, !unsold.includes(`'${code}'`), code);
  // real channels stay inactive in the seed (owner approval first)
  assert.doesNotMatch(SEED, /'(WEB_PG|APPLE_IAP|GOOGLE_PLAY)',[^\n]*,\s*true,\s*'/);
});

test("demo wallet: purchase once per key, promo first, reserve/capture/release, entitlement window, ad-free stacking", () => {
  const s = W.empty(), t0 = Date.parse("2026-10-14T00:00:00Z");
  const a = W.buy(s, "MINI", "k1", t0), again = W.buy(s, "MINI", "k1", t0);
  assert.equal(again.already, true); assert.equal(W.balance(s).paid, 5);
  assert.throws(() => W.buy(s, "MEGA", "k2"), /PRODUCT_NOT_FOR_SALE/);
  W.buy(s, "STANDARD", "k3", t0 + 86400000);
  assert.equal(s.adfree_until, null, "catalog v2: no ad-free bonus (the app shows no ads)");
  // round 2: an unsold tool cannot be reserved in the demo either (the server refuses it through premium_features.active)
  assert.throws(() => W.reserve(s, "REGIONAL_PRICE_REPORT", "jx", {}, t0), /FEATURE_NOT_AVAILABLE/);
  const any = { anyFeature: true };            // the mechanisms below are exercised on every feature
  W.grantPromo(s, 2, "welcome", "p1", t0);
  const r1 = W.reserve(s, "REGIONAL_PRICE_REPORT", "j1", {}, t0, any);
  assert.equal(r1.job.promo, 1); assert.equal(r1.job.paid, 0);
  assert.equal(W.reserve(s, "REGIONAL_PRICE_REPORT", "j1", {}, t0, any).repeat, true);
  assert.equal(W.balance(s).available, 18);
  W.capture(s, r1.job.id, { title: "x", payload: {} }, t0);
  assert.equal(W.capture(s, r1.job.id, { title: "x" }, t0).already, true);
  const r2 = W.reserve(s, "MULTI_EVENT_COMPARE", "j2", {}, t0);
  W.release(s, r2.job.id, "NO_DELIVERABLE", t0);
  assert.throws(() => W.capture(s, r2.job.id, { title: "x" }, t0), /JOB_RELEASED/);
  assert.equal(W.balance(s).available, 18);
  const scope = { items: ["X01x1"], region: "" };
  const p1 = W.reserve(s, "ADVANCED_CART_PLANNER", "j3", scope, t0, any); W.capture(s, p1.job.id, { title: "plan" }, t0);
  const p2 = W.reserve(s, "ADVANCED_CART_PLANNER", "j4", scope, t0 + 29 * 86400000, any);
  assert.equal(p2.job.credits, 0); assert.equal(p2.covered, true);
  const p3 = W.reserve(s, "ADVANCED_CART_PLANNER", "j5", scope, t0 + 31 * 86400000, any);
  assert.equal(p3.job.credits, 2, "window over");
  const p4 = W.reserve(s, "ADVANCED_CART_PLANNER", "j6", { items: ["X24x1"], region: "" }, t0, any);
  assert.equal(p4.job.credits, 2, "another cart is another scope");
  assert.throws(() => W.capture(s, p4.job.id, { title: "" }, t0), /NO_DELIVERABLE/);
  // an abandoned reservation goes back after its deadline
  assert.ok(W.expire(s, t0 + 40 * 86400000) >= 2);
  assert.ok(W.verify(s));
  // not enough: nothing reserved
  const poor = W.empty();
  assert.throws(() => W.reserve(poor, "PRICE_WATCH_30D", "j", {}, t0, { anyFeature: true }), /INSUFFICIENT_CREDITS/);
  assert.equal(Object.keys(poor.jobs).length, 0);
  // a tampered or foreign saved object is not trusted
  assert.equal(W.load({ v: 1, tx: [{ bucket: "PAID", eb: 999, er: 0 }] }).tx.length, 0);
});

test("unit economics: VAT and fee come off the price; every feature keeps a positive margin under the assumptions", () => {
  const t = E.table(W.PRODUCTS, Object.fromEntries(Object.entries(W.FEATURES).map(([k, v]) => [k, v.credits])), "WEB_PG");
  const mini = t.packs.find((p) => p.code === "MINI");
  assert.equal(mini.vat, 90); assert.equal(mini.fee, Math.round(990 * E.ASSUMPTIONS.fees.WEB_PG.rate)); assert.equal(mini.net, 990 - 90 - mini.fee);
  assert.ok(t.features.every((f) => f.ok), JSON.stringify(t.features.filter((f) => !f.ok)));
  assert.match(t.packs[0].fee_note, /가정|확인/);
});
