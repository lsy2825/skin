// node --test cf/alerts/test/ — pure rules: what a phone may store, push host allow-list, ids, KST window, bundling.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as R from "../src/rules.js";
import { checkSubscription, keysMatch, publicKeyOf, quiet, watchMoved } from "../src/push.js";
import { kst, vapidKeys } from "./helpers.mjs";

test("subscribe rate-limit key: IPv4 as is, IPv6 by its /64, IPv4-mapped IPv6 = the IPv4", () => {
  assert.equal(R.clientKey("203.0.113.5"), "203.0.113.5");
  for (const a of ["2001:db8:1:2::1", "2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd", "2001:db8:1:2:ffff::9", "2001:DB8:1:2::abcd"]) assert.equal(R.clientKey(a), "2001:db8:1:2::/64", a);
  assert.equal(R.clientKey("2001:db8:1:3::1"), "2001:db8:1:3::/64");
  assert.equal(R.clientKey("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(R.clientKey("2001:db8::192.0.2.1"), "2001:db8:0:0::/64");
  assert.equal(R.clientKey("fe80::1%eth0"), "fe80:0:0:0::/64");
  for (const x of ["", null, undefined, 5]) assert.equal(R.clientKey(x), "no-ip");
  assert.equal(R.clientKey("1:2:3::4::5"), "1:2:3::4::5", "unparsable: used as is");
});

test("rules: up to 20, kinds/keys/max/region checked, unknown fields refused, normalized", () => {
  const ok = R.validateRules([
    { kind: "target", key: "X24", max: 150000, region: "서울" },
    { kind: "watch", key: "T0000ABC", max: 5 },             // max dropped for watch
    { kind: "newmatch", key: "X01", region: "전국" },        // 전국 = nationwide, not stored
    { kind: "expiring", key: "X24" },
    { kind: "target", key: "X24", region: "서울", max: 150000 },   // duplicate merged
    { kind: "watch", key: "X24", region: "수도권" },               // the app's 서울·경기·인천 group
  ]);
  // normalized and in one canonical order (sorted by their JSON text), whatever order the phone sent
  assert.deepEqual(ok.rules, [
    { kind: "expiring", key: "X24" },
    { kind: "newmatch", key: "X01" },
    { kind: "target", key: "X24", max: 150000, region: "서울" },
    { kind: "watch", key: "T0000ABC" },
    { kind: "watch", key: "X24", region: "수도권" },
  ]);
  const shuffled = R.validateRules([{ kind: "watch", key: "X24", region: "수도권" }, { kind: "expiring", key: "X24" }, { kind: "newmatch", key: "X01", region: "" },
    { kind: "watch", key: "T0000ABC" }, { kind: "target", region: "서울", max: 150000, key: "X24" }]);
  assert.equal(JSON.stringify(shuffled.rules), JSON.stringify(ok.rules), "another order and field order → the same stored text");
  assert.deepEqual(R.validateRules([]).rules, [], "valid for PUT; POST /v1/push/subscribe refuses it");
  assert.equal(R.regionMatch("수도권", "경기"), true);
  assert.equal(R.regionMatch("수도권", "부산"), false);
  assert.equal(R.regionMatch("", "부산"), true);
  assert.equal(R.regionMatch("부산", "부산"), true);
  assert.equal(R.regionMatch("서울", "경기"), false);
  const twenty = Array.from({ length: 20 }, (_, i) => ({ kind: "watch", key: `X${String(i + 1).padStart(2, "0")}` }));
  assert.equal(R.validateRules(twenty).rules.length, 20);
  const bad = [
    null, {}, "x", [...twenty, { kind: "watch", key: "X99" }],
    [{ kind: "ad", key: "X24" }], [{ kind: "watch", key: "x24" }], [{ kind: "watch", key: "X2" }], [{ kind: "watch", key: "T123" }],
    [{ kind: "watch", key: "X24<script>" }], [{ kind: "target", key: "X24" }], [{ kind: "target", key: "X24", max: 0 }],
    [{ kind: "target", key: "X24", max: 1.5 }], [{ kind: "target", key: "X24", max: "100" }], [{ kind: "target", key: "X24", max: 100_000_001 }],
    [{ kind: "watch", key: "X24", region: "Seoul" }], [{ kind: "watch", key: "X24", phone: "010" }], [{ kind: "watch", key: "X24", email: "a@b" }],
    [["watch", "X24"]], [{ kind: "watch", key: 24 }],
  ];
  for (const b of bad) assert.equal(R.validateRules(b).error, "BAD_RULES", JSON.stringify(b).slice(0, 80));
});

test("subscriptions: only known push services over https, no ports/userinfo/IP; keys only shape-checked", () => {
  const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };
  for (const e of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://web.push.apple.com/QH8", "https://wns2-par02p.notify.windows.com/w/?token=1"])
    assert.equal(checkSubscription({ endpoint: e, keys }).endpoint, e);
  for (const e of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x", "https://169.254.169.254/x",
    "https://fcm.googleapis.com:8443/x", "https://u:p@fcm.googleapis.com/x", "https://localhost/x", "https://yoonsiljang.lsy2825.workers.dev/x",
    "https://fcm.googleapis.com/" + "a".repeat(1100), "not a url", "", "https://fcm.googleapis.com/fcm/send/x#frag",
    "https://fcm.googleapis.com/fcm/send/x#", "https://wns2-par02p.notify.windows.com/w/?token=1#t",
    // one label in front of notify.windows.com / push.services.mozilla.com only (4th review: a deeper name never answers 2xx)
    "https://p1.x.notify.windows.com/w/?token=1", "https://a.b.push.services.mozilla.com/x", "https://.notify.windows.com/x"])
    assert.equal(checkSubscription({ endpoint: e, keys }).error, "BAD_SUBSCRIPTION", e.slice(0, 60));
  assert.equal(checkSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "short", auth: keys.auth } }).error, "BAD_SUBSCRIPTION");
  assert.equal(checkSubscription(null).error, "BAD_SUBSCRIPTION");
  // what is kept: the endpoint only (no keys)
  assert.deepEqual(Object.keys(checkSubscription({ endpoint: "https://fcm.googleapis.com/x", keys })), ["endpoint"]);
});

test("ids: 22 base64url chars, random", () => {
  const ids = new Set(Array.from({ length: 200 }, R.newId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, R.ID_RE);
  assert.equal(R.ID_RE.test("short"), false);
  assert.equal(R.ID_RE.test("a".repeat(21) + "/"), false);
});

test("quiet hours: 08:00–21:00 KST, a run needs 15 minutes before 21:00, UTC edges", () => {
  assert.equal(R.inWindow(kst("2026-10-19T07:59:00")), false);
  assert.equal(R.inWindow(kst("2026-10-19T08:00:00")), true);
  assert.equal(R.inWindow(Date.parse("2026-10-18T23:00:00Z")), true);       // 23:00 UTC = 08:00 KST next day
  assert.equal(R.inWindow(Date.parse("2026-10-18T22:59:00Z")), false);
  assert.equal(R.inWindow(kst("2026-10-19T20:40:00")), true);
  assert.equal(R.inWindow(kst("2026-10-19T20:44:00")), true);
  assert.equal(R.inWindow(kst("2026-10-19T20:46:00")), false);
  assert.equal(R.inWindow(kst("2026-10-19T21:00:00")), false);
  assert.equal(R.inWindow(kst("2026-10-19T03:00:00")), false);
  assert.equal(R.ttlUntil21(kst("2026-10-19T20:00:00")), 3600);
  assert.equal(R.ttlUntil21(kst("2026-10-19T08:00:00")), 13 * 3600);
  assert.equal(R.pushTtl(kst("2026-10-19T20:00:00")), 3600 - 60, "push TTL ends a minute before 21:00");
  assert.equal(R.pushTtl(kst("2026-10-19T20:59:30")), 0);
  assert.equal(R.pushTtl(kst("2026-10-19T21:30:00")), 0);
  assert.equal(R.kstDay(Date.parse("2026-10-18T15:00:00Z")), "2026-10-19");  // midnight KST
  assert.equal(R.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(R.addDays("2026-12-30", 3), "2027-01-02");
  // push.mjs quiet() kept as copied
  assert.equal(quiet(23, 22, 8), true);
  assert.equal(quiet(9, 22, 8), false);
  assert.equal(quiet(9, null, null), false);
});

test("bundling: weekly once per 7 KST days; expiring once per end date, once a day, rides along with weekly", () => {
  const today = "2026-10-19";
  assert.deepEqual(R.dueKinds({ pend_w: 1 }, today), { weekly: true, expiring: false });
  assert.equal(R.dueKinds({ pend_w: 1, last_w: "2026-10-13" }, today).weekly, false);   // 6 days
  assert.equal(R.dueKinds({ pend_w: 1, last_w: "2026-10-12" }, today).weekly, true);    // 7 days
  assert.equal(R.dueKinds({ pend_w: 0, last_w: null }, today).weekly, false);
  assert.equal(R.dueKinds({ pend_x: "2026-10-21" }, today).expiring, true);
  // an announced (pair, end date) never becomes pend_x again (sql.js MARK_EXPIRING leaves exp_sent's entries out), so a
  // pending end date is due whatever exp_sent holds
  assert.equal(R.dueKinds({ pend_x: "2026-10-21", exp_sent: '["X24||2026-10-25"]' }, today).expiring, true);
  assert.equal(R.dueKinds({ pend_x: "2026-10-21", last_x: today }, today).expiring, false);            // once a day
  assert.equal(R.dueKinds({ pend_x: "2026-10-18" }, today).expiring, false);                            // ended
  assert.deepEqual(R.dueKinds({ pend_w: 1, pend_x: "2026-10-21", last_x: today }, today), { weekly: true, expiring: true });
  assert.equal(R.outcome(201), "sent");
  assert.equal(R.outcome(410), "gone");
  assert.equal(R.outcome(404), "gone");
  assert.equal(R.outcome(429), "slow");
  assert.equal(R.outcome(403), "refused", "counted against that subscription, not a reason to stop everyone");
  assert.equal(R.outcome(401), "refused");
  assert.ok(R.REFUSED_DROP < R.RETRY_DROP && R.REFUSING_GRACE_DAYS >= 1 && R.CAPPED_DAYS >= 1);
  assert.equal(R.outcome(503), "retry");
  for (const c of [301, 302, 307, 308]) assert.equal(R.outcome(c), "retry", `${c}: redirects are not followed`);
  assert.equal(R.outcome(0), "retry");
});

test("watch rule (from push.mjs evaluate): ≥ 5% median move or a new low", () => {
  assert.equal(watchMoved({ m: 100, med: 200 }, { m: 100, med: 210 }), true);
  assert.equal(watchMoved({ m: 100, med: 200 }, { m: 100, med: 209 }), false);
  assert.equal(watchMoved({ m: 100, med: 200 }, { m: 99, med: 200 }), true);
  assert.equal(watchMoved({ m: null, med: null }, { m: 99, med: 200 }), false);
  assert.equal(watchMoved({ m: 100, med: 200 }, { m: null, med: null }), false);
});

test("digest entries: numbers only, every field checked; g = regroup day or ''", () => {
  const e = { k: "X24", r: "서울", m: 100, n: 3, med: 120 };
  assert.deepEqual(R.cleanEntry(e), { ...e, e: null, s: null, u: null, g: "" });
  assert.deepEqual(R.cleanEntry({ ...e, r: "수도권" }).r, "수도권");
  assert.deepEqual(R.cleanEntry({ k: "X24", r: "", m: null, n: 0, med: null }), { k: "X24", r: "", m: null, n: 0, med: null, e: null, s: null, u: null, g: "" });
  assert.deepEqual(R.cleanEntry({ ...e, e: 90, s: 110, u: "2026-10-21" }), { ...e, e: 90, s: 110, u: "2026-10-21", g: "" });
  assert.equal(R.cleanEntry({ ...e, g: "2026-10-14" }).g, "2026-10-14");
  assert.equal(R.cleanEntry({ ...e, g: "" }).g, "");
  for (const b of [{ ...e, k: "DROP" }, { ...e, r: "x" }, { ...e, n: -1 }, { ...e, upd: "2026-10-19" }, { ...e, w: 1 }, { ...e, e: 5 }, { ...e, m: "1" },
    { ...e, m: null }, { ...e, n: 0 }, { ...e, id: "abc" }, { ...e, endpoint: "https://fcm.googleapis.com/x" }, null,
    { ...e, g: "2026-13-45" }, { ...e, g: 20261014 }, { ...e, e: 90, s: 110, u: "2026-02-30" }])
    assert.equal(R.cleanEntry(b), null, JSON.stringify(b));
  // calendar dates only (DAY_RE alone lets '2026-13-45' through, and addDays would then throw)
  for (const d of ["2026-10-19", "2026-02-28", "2028-02-29"]) assert.equal(R.validDay(d), true, d);
  for (const d of ["2026-13-45", "2026-02-30", "2027-02-29", "2026-1-5", "20261019", "", null]) assert.equal(R.validDay(d), false, String(d));
  assert.equal(R.validRun("2026-10-14|2026-10-19"), true);
  assert.equal(R.validRun("2026-10-14|2026-13-45"), false);
  assert.equal(R.daysBetween("2026-10-20", "2026-10-19"), 1);
  assert.equal(R.daysBetween("2026-10-19", "2026-10-21"), -2);
});

test("VAPID keys: the private JWK must belong to the public key", async () => {
  const a = await vapidKeys(), b = await vapidKeys();
  assert.equal(a.pub.length, 87);
  assert.equal(keysMatch(a.pub, a.jwk), true);
  assert.equal(keysMatch(a.pub, b.jwk), false);
  assert.equal(keysMatch("", a.jwk), false);
  assert.equal(keysMatch(a.pub, "{not json"), false);
});

test("VAPID public key derived from the private JWK (0x04 ‖ x ‖ y, base64url) = the key the pair was made with", async () => {
  for (let i = 0; i < 5; i++) {
    const k = await vapidKeys();
    assert.equal(publicKeyOf(k.jwk), k.pub);
    assert.equal(publicKeyOf(JSON.parse(k.jwk)), k.pub, "an object works too");
    assert.equal(keysMatch(publicKeyOf(k.jwk), k.jwk), true);
  }
  const j = JSON.parse((await vapidKeys()).jwk);
  for (const bad of ["", "{not json", "null", "[]", JSON.stringify({ ...j, d: undefined }), JSON.stringify({ ...j, d: "" }),
    JSON.stringify({ ...j, kty: "RSA" }), JSON.stringify({ ...j, crv: "P-384" }), JSON.stringify({ ...j, x: j.x.slice(1) }),
    JSON.stringify({ ...j, y: 12345 }), JSON.stringify({ ...j, x: "!!" + j.x.slice(2) }), undefined, null])
    assert.equal(publicKeyOf(bad), "", String(bad).slice(0, 40));
});

const DATA = new URL("../../../app/data.json", import.meta.url);
test("REGIONS and KEY_RE cover everything in app/data.json", { skip: existsSync(DATA) ? false : "no app/data.json" }, () => {
  const d = JSON.parse(readFileSync(DATA, "utf8"));
  const regions = new Set(d.branches.map((b) => d.s[b[5]]).filter(Boolean));
  for (const r of regions) assert.ok(R.REGIONS.includes(r), `region ${r}`);
  for (const [k] of d.keys) assert.match(k, R.KEY_RE);
  const P = createRequire(import.meta.url)("../../../app/domain/pricectx.js");
  assert.equal(typeof P.fromData, "function");
});

test("hostTrouble: a 5xx, a redirect and a network error are the push service's; a 4xx is the row's", () => {
  for (const s of [0, 500, 502, 503, 504, 599, 301, 302, 307]) assert.equal(R.hostTrouble(s), true, String(s));
  for (const s of [400, 401, 403, 404, 410, 413, 429, 200, 201]) assert.equal(R.hostTrouble(s), false, String(s));
  assert.equal(R.outcome(503), "retry");
  assert.equal(R.outcome(400), "retry");
});

test("capacityOf: ok below 80% of MAX_SUBS, nearly_full from 80%, full at the cap", () => {
  assert.deepEqual([0, 79, 80, 99, 100, 101].map((n) => R.capacityOf(n, 100)), ["ok", "ok", "nearly_full", "nearly_full", "full", "full"]);
  assert.equal(R.capacityOf(undefined, 100), "ok");
  assert.equal(R.capacityOf("7", 8), "nearly_full");
});
