// The Web Push pieces left after the credits were removed (6.0, development brief A3): only known push services, a VAPID
// header a push service can verify, quiet hours across midnight, and rules that speak only from collected numbers.
// Run: cd server && node --test test/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { checkSubscription, vapidHeader, sendPush, quiet, evaluate } from "../src/push.mjs";

const KEYS = { p256dh: "B".repeat(87), auth: "a".repeat(22) };

test("subscription: only https endpoints of known push services, with well-formed keys", () => {
  const ok = checkSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: KEYS });
  assert.equal(ok.endpoint, "https://fcm.googleapis.com/fcm/send/abc");
  for (const e of ["https://web.push.apple.com/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"])
    assert.ok(checkSubscription({ endpoint: e, keys: KEYS }), e);
  // anything else would let a caller make the server send requests where it likes (request forgery)
  for (const e of ["http://fcm.googleapis.com/x", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com.evil.example/x", "https://169.254.169.254/latest", "not a url"])
    assert.throws(() => checkSubscription({ endpoint: e, keys: KEYS }), /BAD_SUBSCRIPTION|알/, e);
  assert.throws(() => checkSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "short", auth: KEYS.auth } }));
  assert.throws(() => checkSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: KEYS.p256dh, auth: "bad key!" } }));
  assert.throws(() => checkSubscription(null));
});

test("VAPID: an ES256 token for the push service's origin that verifies with the public key", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
  const now = Date.parse("2026-10-20T00:00:00Z");
  const h = await vapidHeader("https://fcm.googleapis.com/fcm/send/abc", { publicKey, privateJwk: JSON.stringify(privateJwk), subject: "mailto:ops@example.invalid" }, now);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m, h);
  assert.equal(m[4], publicKey);
  const body = JSON.parse(Buffer.from(m[2], "base64url").toString());
  assert.equal(body.aud, "https://fcm.googleapis.com");      // origin only, never the full endpoint
  assert.equal(body.exp, now / 1000 + 12 * 3600);
  assert.equal(body.sub, "mailto:ops@example.invalid");
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, Buffer.from(m[3], "base64url"), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.equal(valid, true);
});

test("send: an empty push (no content), gone subscriptions reported as gone", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const vapid = { publicKey: "k", privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey), subject: "mailto:a@b.invalid" };
  const seen = [];
  const f = (status) => async (url, opts) => { seen.push(opts); return new Response(null, { status }); };
  assert.deepEqual(await sendPush("https://fcm.googleapis.com/x", vapid, { fetch: f(201) }), { ok: true, gone: false, status: 201 });
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].headers["content-length"], "0");
  assert.equal(seen[0].body, undefined);
  assert.deepEqual(await sendPush("https://fcm.googleapis.com/x", vapid, { fetch: f(410) }), { ok: false, gone: true, status: 410 });
});

test("quiet hours: a window across midnight (21→8) holds 21:00-07:59 and sends from 08:00", () => {
  assert.equal(quiet(21, 21, 8), true);
  assert.equal(quiet(3, 21, 8), true);
  assert.equal(quiet(7, 21, 8), true);
  assert.equal(quiet(8, 21, 8), false);
  assert.equal(quiet(20, 21, 8), false);
  assert.equal(quiet(13, 12, 14), true);
  assert.equal(quiet(14, 12, 14), false);
  assert.equal(quiet(3, null, null), false);
  assert.equal(quiet(3, 5, 5), false);
});

test("rules: a notice only from collected numbers, and not twice for the same state", () => {
  const ctx = { updated: "2026-10-19", label: () => "리쥬란힐러 2cc", prices: (k, reg) => (reg === "부산" ? [] : [{ p: 190000 }, { p: 210000 }, { p: 250000 }]) };
  const t = evaluate({ kind: "target", key_id: "X24", target_krw: 200000 }, ctx);
  assert.match(t.notice.text, /목표가 200,000원 이하/);
  assert.match(t.notice.text, /2026-10-19 수집 기준/);       // always says when the prices were collected
  assert.equal(evaluate({ kind: "target", key_id: "X24", target_krw: 200000, baseline: t.baseline }, ctx).notice, null);
  assert.equal(evaluate({ kind: "target", key_id: "X24", target_krw: 100000 }, ctx).notice, null);
  assert.equal(evaluate({ kind: "watch", key_id: "X24", region: "부산" }, ctx), null);   // no prices there → nothing said
  const w = evaluate({ kind: "watch", key_id: "X24", baseline: { median: 250000, min: 190000, n: 3 } }, ctx);
  assert.match(w.notice.text, /중간값 250,000 → 210,000원/);
  assert.equal(evaluate({ kind: "watch", key_id: "X24", baseline: { median: 212000, min: 190000, n: 3 } }, ctx).notice, null);   // under 5%: quiet
  assert.match(evaluate({ kind: "newmatch", key_id: "X24", baseline: { n: 2 } }, ctx).notice.text, /2 → 3곳/);
});
