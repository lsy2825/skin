// 푸시 알림 (6.0 지시서 약속 1, 채팅 B6): the phone's side of the alerts Worker (chat A, cf/alerts). Hidden unless app/config.js
// has both alertsApi (https) and pushPublicKey (the VAPID public key). What goes out:
//   POST {alertsApi}/v1/push/subscribe {subscription, rules} → {id}   (only after the user taps '받기' and allows notifications)
//   PUT  {alertsApi}/v1/push/rules/{id} {rules}                        (when the phone's alerts change)
//   DELETE {alertsApi}/v1/push/subscribe/{id}                          ('끄기')
// rules: at most 20 of {kind: target|watch|newmatch|expiring, key, max?, region?}, made from the phone's own alerts. The id
// stays on the phone. The push itself is empty; sw.js shows one fixed sentence. Pure functions, no DOM: window.Push in
// the app, require()d by tests/push.test.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Push = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KINDS = ["target", "watch", "newmatch", "expiring"];
  const MAX_RULES = 20;
  const KEY = /^[A-Z][A-Z0-9]{1,11}$/;   // a comparison key id (X24, T1A2B3C), same check as a shared quote's items
  const ID = /^[A-Za-z0-9_-]{8,128}$/;   // the Worker's subscription id: goes into a URL path, so nothing else is accepted
  const B64URL = /^[A-Za-z0-9_-]+$/;

  // {alertsApi} without a trailing slash, or null when it is not a plain https URL (no query, fragment or login)
  function base(cfg) {
    if (!cfg || typeof cfg.alertsApi !== "string" || !cfg.alertsApi) return null;
    let u;
    try { u = new URL(cfg.alertsApi); } catch (e) { return null; }
    if (u.protocol !== "https:" || u.search || u.hash || u.username || u.password) return null;
    return u.origin + u.pathname.replace(/\/+$/, "");
  }
  // the VAPID public key as the bytes PushManager.subscribe wants: base64url of an uncompressed P-256 point (65 bytes,
  // starting 0x04); null for anything else
  function keyBytes(s) {
    if (typeof s !== "string" || !B64URL.test(s.replace(/=+$/, ""))) return null;
    const b = s.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
    let bin;
    try { bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4)); } catch (e) { return null; }
    if (bin.length !== 65 || bin.charCodeAt(0) !== 4) return null;
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  // both settings present and valid: only then is anything about push shown or sent
  const enabled = (cfg) => !!(base(cfg) && keyBytes(cfg && cfg.pushPublicKey));

  // the browser's subscription as the Worker reads it: {endpoint (https), expirationTime, keys {p256dh, auth}} with the
  // keys as unpadded base64url (some servers refuse '='); null when it is not a usable subscription
  function subJSON(sub) {
    let j = sub;
    try { if (sub && typeof sub.toJSON === "function") j = sub.toJSON(); } catch (e) { return null; }
    if (!j || typeof j.endpoint !== "string" || !j.keys) return null;
    let u;
    try { u = new URL(j.endpoint); } catch (e) { return null; }
    if (u.protocol !== "https:") return null;
    const p = String(j.keys.p256dh || "").replace(/=+$/, ""), a = String(j.keys.auth || "").replace(/=+$/, "");
    if (!B64URL.test(p) || !B64URL.test(a)) return null;
    return { endpoint: j.endpoint, expirationTime: Number.isFinite(j.expirationTime) ? j.expirationTime : null, keys: { p256dh: p, auth: a } };
  }

  // a region the rules can carry: '전국' (or none) means no region; anything else as the app stores it ('수도권' or a 시·도)
  const regionOf = (r) => (typeof r === "string" && r && r !== "전국" ? r.slice(0, 20) : undefined);
  const rule = (kind, key, region, max) => {
    const r = { kind, key };
    if (max != null) r.max = max;
    if (region) r.region = region;
    return r;
  };
  const won = (v) => (Number.isFinite(+v) && +v > 0 && +v <= 1e8 ? Math.round(+v) : null);
  // the phone's alerts → contract rules. What maps:
  //   시술 지켜보기 → watch (+ target when its 목표가 is on, + newmatch when '새 비교 가능 지점' is on)
  //   시술 목표가 → target(max) · 시술 새 최저가 → watch (the nearest kind: a new low is a price change) · 시술 파는 지점 → newmatch
  // What stays on the phone only (no matching kind): 내 견적 합계(cartdrop), a branch product's alerts (목표가 and '이벤트 종료
  // 3일 전'), and any alert made with 특가 포함 off (a.sp === false) — the Worker always counts special prices, so it would
  // ring on prices this alert leaves out (chat A's request 2026-10-16). The Worker's expiring is about a comparison key in a
  // region (its lowest price ends and nothing as low is left), not one branch's product: sent for a product it would ring
  // wrongly or not at all (chat A's request, #85 ①) — until the contract has a branch field.
  // known(key) says the comparison still exists (an alert on a key that is gone and has no successor never rings in the app
  // either — it is not sent, and counts as local). Duplicates go; a target keeps the highest max per key and region; more
  // than 20 are cut from the end (the newest alerts are last).
  function rulesOf(alerts, known) {
    const out = [], seen = new Map();
    let local = 0;
    const add = (r) => {
      if (!KEY.test(r.key) || !KINDS.includes(r.kind)) return;
      const id = `${r.kind}|${r.key}|${r.region || ""}`;
      const at = seen.get(id);
      if (at != null) { if (r.kind === "target" && r.max > out[at].max) out[at].max = r.max; return; }
      seen.set(id, out.length); out.push(r);
    };
    for (const a of Array.isArray(alerts) ? alerts : []) {
      if (!a || typeof a !== "object") continue;
      if (a.k && typeof known === "function" && !known(a.k)) local++;
      else if (a.k && a.sp === false) local++;
      else if (a.k) {
        const reg = regionOf(a.reg), on = a.on || {};
        if (a.type === "watch") {
          if (["drop", "lowbranch", "lowended", "recheck"].some((t) => on[t] !== false)) add(rule("watch", a.k, reg));
          if (on.target !== false && won(a.target)) add(rule("target", a.k, reg, won(a.target)));
          if (on.newmatch !== false) add(rule("newmatch", a.k, reg));
        } else if (a.type === "target") { if (won(a.target)) add(rule("target", a.k, reg, won(a.target))); else local++; }
        else if (a.type === "newlow") add(rule("watch", a.k, reg));
        else if (a.type === "newmatch") add(rule("newmatch", a.k, reg));
        else local++;
      } else local++;   // a branch product (a.row: 목표가, 이벤트 종료 3일 전) or 내 견적 합계
    }
    return { rules: out.slice(0, MAX_RULES), cut: Math.max(0, out.length - MAX_RULES), local };
  }
  // a short fingerprint of the rules last sent (so an unchanged list is not sent again)
  function hash(rules) {
    const s = JSON.stringify(rules || []);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return `${s.length}:${h.toString(36)}`;
  }

  // the three requests (fetch init without headers the app adds: JSON content type, no credentials)
  function subscribeReq(cfg, sub, rules) {
    const b = base(cfg), s = subJSON(sub);
    return b && s ? { url: `${b}/v1/push/subscribe`, method: "POST", body: JSON.stringify({ subscription: s, rules: rules || [] }) } : null;
  }
  const rulesReq = (cfg, id, rules) => (base(cfg) && ID.test(id || "") ? { url: `${base(cfg)}/v1/push/rules/${id}`, method: "PUT", body: JSON.stringify({ rules: rules || [] }) } : null);
  const unsubscribeReq = (cfg, id) => (base(cfg) && ID.test(id || "") ? { url: `${base(cfg)}/v1/push/subscribe/${id}`, method: "DELETE" } : null);
  // {id} from the subscribe answer, or null
  const idOf = (json) => (json && typeof json.id === "string" && ID.test(json.id) ? json.id : null);

  // ids whose DELETE did not reach the Worker ('끄기' offline, a 5xx): kept on the phone and sent again at the next start, so a
  // subscription switched off here does not stay on the server (chat A's request 2026-10-16). At most MAX_DEL, newest last.
  const MAX_DEL = 5;
  const cleanDel = (list) => [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === "string" && ID.test(x)))].slice(-MAX_DEL);
  const addDel = (list, id) => (ID.test(id || "") ? cleanDel([...cleanDel(list).filter((x) => x !== id), id]) : cleanDel(list));
  // a DELETE answer that ends the retries: done (2xx), or a client error sending it again cannot change (4xx: 404/410 the
  // Worker no longer knows it, 400/403 … it never will) — only 408/429 and 5xx (and no answer) are tried again
  const delDone = (status) => (status >= 200 && status < 300) || (status >= 400 && status < 500 && status !== 408 && status !== 429);

  // the bytes of an ArrayBuffer or a typed array (a subscription's options.applicationServerKey), or null
  function bytesOf(x) {
    if (!x || typeof x !== "object") return null;
    if (Object.prototype.toString.call(x) === "[object ArrayBuffer]") return new Uint8Array(x);
    return ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : null;
  }
  // the browser's subscription was made with a public key other than cfg.pushPublicKey (the VAPID keys were replaced: the
  // Worker's pushes to it are refused, chat A's request #85 ②). Only a key the browser shows counts — a browser that does
  // not show one (no options.applicationServerKey) says false, so an unreadable key never makes a new subscription at each start.
  function otherKey(sub, cfg) {
    const want = keyBytes(cfg && cfg.pushPublicKey);
    let have = null;
    try { have = bytesOf(sub && sub.options && sub.options.applicationServerKey); } catch (e) { return false; }
    if (!want || !have) return false;
    return have.length !== want.length || have.some((v, i) => v !== want[i]);
  }

  // what the phone keeps: { id, ep: the subscription's endpoint, h: hash of the rules last sent }, or null
  const cleanState = (s) => (s && typeof s === "object" && ID.test(s.id || "") && typeof s.ep === "string" && typeof s.h === "string" ? { id: s.id, ep: s.ep, h: s.h } : null);

  return { KINDS, MAX_RULES, MAX_DEL, base, keyBytes, enabled, subJSON, rulesOf, hash, subscribeReq, rulesReq, unsubscribeReq, idOf, cleanDel, addDel, delDone, otherKey, cleanState };
});
