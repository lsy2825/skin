// domain/push.js — 푸시 알림 (6.0 지시서 약속 1, B6): hidden unless both settings are valid, rules from the phone's alerts
// (≤20, the contract's four kinds only), the three requests, and the subscription as the Worker reads it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const P = require("../app/domain/push.js");

// a real-shaped VAPID public key: 0x04 + 64 bytes, base64url without padding (87 characters)
const KEY = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url");
const ON = { alertsApi: "https://alerts.example.test", pushPublicKey: KEY };

test("hidden unless alertsApi (https) and a 65-byte public key are both set; the shipped config is off", () => {
  assert.equal(KEY.length, 87);
  assert.equal(P.enabled(ON), true);
  for (const cfg of [undefined, {}, { alertsApi: ON.alertsApi }, { pushPublicKey: KEY }, { ...ON, alertsApi: "http://alerts.example.test" },
    { ...ON, alertsApi: "https://a.example.test/?x=1" }, { ...ON, alertsApi: "https://u:p@a.example.test" }, { ...ON, pushPublicKey: "short" },
    { ...ON, pushPublicKey: Buffer.alloc(65, 7).toString("base64url") }, { ...ON, pushPublicKey: KEY + "!!" }])
    assert.equal(P.enabled(cfg), false, JSON.stringify(cfg));
  const w = {}; new Function("window", fs.readFileSync(path.join(__dirname, "../app/config.js"), "utf8"))(w);
  assert.equal(P.enabled(w.APP_CONFIG), false, "ships off: buttons hidden until chat A sends the address and key");
  assert.equal(w.APP_CONFIG.alertsApi, ""); assert.equal(w.APP_CONFIG.pushPublicKey, "");
  // padded and standard-alphabet-free keys both read
  assert.equal(P.keyBytes(KEY + "=").length, 65);
  assert.equal(P.keyBytes(KEY)[0], 4);
});

test("the three requests: POST subscribe {subscription, rules}, PUT rules/{id}, DELETE subscribe/{id}", () => {
  const sub = { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", expirationTime: null, keys: { p256dh: "B".repeat(87) + "=", auth: "a".repeat(22) + "==" } }) };
  const post = P.subscribeReq({ ...ON, alertsApi: "https://alerts.example.test/" }, sub, [{ kind: "watch", key: "X24" }]);
  assert.equal(post.url, "https://alerts.example.test/v1/push/subscribe"); assert.equal(post.method, "POST");
  assert.deepEqual(JSON.parse(post.body), { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", expirationTime: null, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }, rules: [{ kind: "watch", key: "X24" }] });
  const put = P.rulesReq(ON, "id_12345678", []);
  assert.deepEqual([put.url, put.method, put.body], ["https://alerts.example.test/v1/push/rules/id_12345678", "PUT", '{"rules":[]}']);
  const del = P.unsubscribeReq(ON, "id_12345678");
  assert.deepEqual([del.url, del.method, del.body], ["https://alerts.example.test/v1/push/subscribe/id_12345678", "DELETE", undefined]);
  // an id that is not the Worker's shape never reaches a URL path
  for (const bad of ["", "short", "../../x/yyyyyy", "a b c d e f g h", null]) { assert.equal(P.rulesReq(ON, bad, []), null); assert.equal(P.unsubscribeReq(ON, bad), null); }
  assert.equal(P.idOf({ id: "id_12345678" }), "id_12345678"); assert.equal(P.idOf({ id: "../x" }), null); assert.equal(P.idOf(null), null);
  // not a usable subscription: nothing to send
  assert.equal(P.subscribeReq(ON, { endpoint: "http://x.test", keys: { p256dh: "a", auth: "b" } }, []), null);
  assert.equal(P.subscribeReq(ON, { endpoint: "https://x.test", keys: { p256dh: "a+b", auth: "b" } }, []), null);
  assert.equal(P.subscribeReq({}, sub, []), null);
});

test("rules from the phone's alerts: the contract's four kinds, region '전국' left out, 시·도 and 수도권 as stored", () => {
  const alerts = [
    { type: "watch", k: "X24", reg: "수도권", target: 200000, on: { drop: true, target: true, lowbranch: true, newmatch: true, lowended: true, recheck: true } },
    { type: "watch", k: "X12", reg: "전국", on: { drop: false, lowbranch: false, lowended: false, recheck: false, target: true, newmatch: false } },
    { type: "target", k: "X01", reg: "부산", target: 50000 },
    { type: "newlow", k: "X02", reg: "" },
    { type: "newmatch", k: "X03", reg: "서울" },
    { type: "newmatch", k: "X04", reg: "전국" },
    { type: "watch", k: "T9GONE1", reg: "서울" },
    { type: "cartdrop", cart: "견적 1", target: 300000 },
    { type: "target", row: { n: "리쥬란 2cc", br: "a|b" }, target: 100000 },
    { type: "expiring", row: { n: "보톡스 50U", br: "c|d" } },
    { type: "expiring", row: { n: "없는 상품", br: "e|f" } },
  ];
  const r = P.rulesOf(alerts, (k) => k !== "T9GONE1");
  assert.deepEqual(r.rules, [
    { kind: "watch", key: "X24", region: "수도권" }, { kind: "target", key: "X24", max: 200000, region: "수도권" }, { kind: "newmatch", key: "X24", region: "수도권" },
    // X12: every change kind off, its 목표가 has no amount → nothing
    { kind: "target", key: "X01", max: 50000, region: "부산" },
    { kind: "watch", key: "X02" },
    { kind: "newmatch", key: "X03", region: "서울" },
    { kind: "newmatch", key: "X04" },
    // T9GONE1: the comparison is gone (no successor) — not sent; the branch products' alerts — not sent (#85 ①)
  ]);
  assert.equal(r.local, 5, "견적 합계, 지점 상품 목표가, 지점 상품 이벤트 종료 3일 전 둘, 없어진 비교 — 앱을 열 때만");
  assert.equal(r.cut, 0);
  for (const x of r.rules) { assert.ok(P.KINDS.includes(x.kind)); assert.deepEqual(Object.keys(x).filter((k) => !["kind", "key", "max", "region"].includes(k)), []); }
});

test("at most 20 rules: duplicates go, a target keeps the highest amount, the rest are cut and counted", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ type: "newmatch", k: `X${String(i).padStart(2, "0")}`, reg: "서울" }));
  const r = P.rulesOf([{ type: "target", k: "X99", target: 10000 }, { type: "target", k: "X99", target: 30000 }, { type: "newmatch", k: "X00", reg: "서울" }, ...many]);
  assert.equal(r.rules.length, P.MAX_RULES);
  assert.deepEqual(r.rules[0], { kind: "target", key: "X99", max: 30000 });
  assert.equal(r.rules.filter((x) => x.key === "X00").length, 1);
  assert.equal(r.cut, 31 - 20);
  // junk in storage never becomes a rule
  assert.deepEqual(P.rulesOf([null, 1, { type: "watch", k: "x<script>" }, { type: "target", k: "X01", target: -5 }, { type: "target", k: "X01", target: "1e12" }]).rules, []);
  assert.deepEqual(P.rulesOf(undefined).rules, []);
});

test("the rules' fingerprint changes with the rules and only then; the kept state is checked", () => {
  const a = [{ kind: "watch", key: "X24" }], b = [{ kind: "watch", key: "X24", region: "서울" }];
  assert.equal(P.hash(a), P.hash(JSON.parse(JSON.stringify(a))));
  assert.notEqual(P.hash(a), P.hash(b));
  assert.notEqual(P.hash([]), P.hash(a));
  // same length, different content: a changed key, region or amount is sent again
  assert.notEqual(P.hash([{ kind: "watch", key: "X24" }]), P.hash([{ kind: "watch", key: "X25" }]));
  assert.notEqual(P.hash([{ kind: "target", key: "X24", max: 100000 }]), P.hash([{ kind: "target", key: "X24", max: 200000 }]));
  assert.notEqual(P.hash([{ kind: "watch", key: "X24", region: "서울" }]), P.hash([{ kind: "watch", key: "X24", region: "부산" }]));
  assert.deepEqual(P.cleanState({ id: "id_12345678", ep: "https://x", h: "1:a", extra: 1 }), { id: "id_12345678", ep: "https://x", h: "1:a" });
  for (const bad of [null, {}, { id: "x", ep: "https://x", h: "1" }, { id: "id_12345678", ep: 3, h: "1" }]) assert.equal(P.cleanState(bad), null);
});

test("특가 포함을 끄고 만든 알림(sp === false)은 서버 규칙으로 보내지 않고 이 기기에서만(A 부탁 ①, 2026-10-16)", () => {
  const known = () => true;
  const mine = [
    { type: "watch", k: "X24", reg: "서울", sp: false, on: {} },
    { type: "target", k: "X25", target: 100000, sp: false },
    { type: "newlow", k: "X26", sp: false },
    { type: "watch", k: "X27", reg: "부산", sp: true, on: {} },
    { type: "target", k: "X28", target: 90000 },           // made before the setting existed: sp missing → sent as before
    { type: "newmatch", k: "X29", sp: false },
    { type: "expiring", row: { n: "상품", br: "지점" }, sp: false },   // a branch product's own event end: no 특가 question
  ];
  const { rules, local } = P.rulesOf(mine, known);
  assert.equal(local, 5);
  assert.deepEqual([...new Set(rules.map((r) => r.key))].sort(), ["X27", "X28"]);
  assert.ok(!rules.some((r) => ["X24", "X25", "X26", "X29"].includes(r.key)));
});

test("지점 상품 '이벤트 종료 3일 전'은 서버 규칙을 만들지 않고 이 기기에서만 셈(A #85 ①: Worker의 expiring은 (key, 지역)의 최저가 뜻)", () => {
  const row = { n: "보톡스 50U", br: "c|d" };
  assert.deepEqual(P.rulesOf([{ type: "expiring", row }], () => true), { rules: [], cut: 0, local: 1 });
  // next to alerts that are sent: those stay as they were, the product's end is counted once, nothing becomes expiring
  const r = P.rulesOf([{ type: "watch", k: "X24", reg: "서울", on: {} }, { type: "expiring", row }, { type: "expiring", row: { n: "다른 상품", br: "e|f" }, sp: true },
    { type: "target", row, target: 50000 }], () => true);
  assert.equal(r.local, 3);
  assert.deepEqual(r.rules.map((x) => x.key), ["X24", "X24"]);
  assert.ok(!r.rules.some((x) => x.kind === "expiring"));
});

test("공개키가 바뀐 구독 찾기(A #85 ②): 브라우저가 보여 주는 applicationServerKey 바이트가 설정의 공개키와 다를 때만", () => {
  const want = P.keyBytes(KEY);
  const subWith = (k) => ({ endpoint: "https://fcm.googleapis.com/fcm/send/x", options: { userVisibleOnly: true, applicationServerKey: k } });
  // the same 65 bytes, as the browser gives them (an ArrayBuffer) or as a typed array — also one inside a bigger buffer
  const ab = want.buffer.slice(want.byteOffset, want.byteOffset + want.byteLength);
  assert.equal(P.otherKey(subWith(ab), ON), false);
  assert.equal(P.otherKey(subWith(Uint8Array.from(want)), ON), false);
  const big = new Uint8Array(80); big.set(want, 7);
  assert.equal(P.otherKey(subWith(new Uint8Array(big.buffer, 7, 65)), ON), false);
  assert.equal(P.otherKey(subWith(Buffer.from(KEY, "base64url")), ON), false);
  // another key: one byte off, or another length
  const other = Uint8Array.from(want); other[64] ^= 1;
  assert.equal(P.otherKey(subWith(other.buffer), ON), true);
  assert.equal(P.otherKey(subWith(Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 9)])), ON), true);
  assert.equal(P.otherKey(subWith(new Uint8Array(64).fill(7)), ON), true);
  assert.equal(P.otherKey(subWith(new ArrayBuffer(0)), ON), true);
  // a key the browser does not show (no options, null key, not bytes, a getter that throws): not 'other' — no new
  // subscription at every start for a browser that cannot tell
  const throws = { endpoint: "https://x.test", get options() { throw new Error("no"); } };
  [null, {}, { options: null }, subWith(null), subWith(undefined), subWith(KEY), subWith([4, 7, 7]), throws]
    .forEach((sub, i) => assert.equal(P.otherKey(sub, ON), false, `case ${i}`));
  // push not set up (no valid key in the settings): never 'other'
  assert.equal(P.otherKey(subWith(other.buffer), {}), false);
  assert.equal(P.otherKey(subWith(other.buffer), { ...ON, pushPublicKey: "short" }), false);
});

test("끄기의 DELETE가 실패한 id는 폰에 남겨 다음 시작에 다시 보냄(A 부탁 ③): 목록 정리·추가·끝난 답", () => {
  assert.deepEqual(P.cleanDel(null), []);
  assert.deepEqual(P.cleanDel(["sub_aaaaaaaa", "bad id", 7, "sub_aaaaaaaa", "sub_bbbbbbbb"]), ["sub_aaaaaaaa", "sub_bbbbbbbb"]);
  // the same id twice moves to the end; at most MAX_DEL, the oldest go
  assert.deepEqual(P.addDel(["sub_aaaaaaaa", "sub_bbbbbbbb"], "sub_aaaaaaaa"), ["sub_bbbbbbbb", "sub_aaaaaaaa"]);
  const many = ["sub_00000001", "sub_00000002", "sub_00000003", "sub_00000004", "sub_00000005"];
  assert.equal(P.MAX_DEL, 5);
  assert.deepEqual(P.addDel(many, "sub_00000006"), [...many.slice(1), "sub_00000006"]);
  assert.deepEqual(P.addDel(many, "not an id"), many);
  // done: 2xx, or a client error sending it again cannot change (404/410 gone, 400/403/422 never); tried again: no answer
  // (offline is a thrown fetch; 0 here), 408, 429 and 5xx
  for (const s of [200, 204, 400, 403, 404, 410, 422]) assert.equal(P.delDone(s), true, String(s));
  for (const s of [0, 408, 429, 500, 503]) assert.equal(P.delDone(s), false, String(s));
});
