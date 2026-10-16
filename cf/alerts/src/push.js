// Web Push without content (copied from server/src/push.mjs — the pure parts only, no credits, no Buffer, so it runs in
// a Worker and in node). The push carries no payload: the phone's service worker shows one fixed line and opens #saved,
// so nothing needs encrypting and p256dh/auth are checked for shape and then thrown away.
import { b64u, unb64u } from "./rules.js";

// push services a subscription may point at (the endpoint is user-supplied: anything else would be a request forgery
// target). Strict on purpose (fail closed); add a host only after a real subscription shows it.
export const PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com)$/;

// → { endpoint } or { error: 'BAD_SUBSCRIPTION' }
export function checkSubscription(s) {
  const bad = { error: "BAD_SUBSCRIPTION" };
  if (!s || typeof s !== "object" || typeof s.endpoint !== "string" || s.endpoint.length > 1024) return bad;
  // no #fragment (never part of a push service URL; it would make one phone look like two). Query strings stay: WNS uses ?token=
  if (s.endpoint.includes("#")) return bad;
  let u;
  try { u = new URL(s.endpoint); } catch { return bad; }
  if (u.protocol !== "https:" || u.port || u.username || u.password || u.hash || !PUSH_HOSTS.test(u.hostname)) return bad;
  const k = s.keys || {};
  if (!/^[A-Za-z0-9_-]{40,120}$/.test(k.p256dh || "") || !/^[A-Za-z0-9_-]{16,40}$/.test(k.auth || "")) return bad;
  return { endpoint: u.href };
}

const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));

// VAPID (RFC 8292): ES256 JWT for one push service origin. exp 12 h; the Worker caches it per origin in D1, because
// Apple asks not to mint a new token more than once an hour. sub is the app's https address (no e-mail).
export async function vapidJwt(aud, privateJwk, subject, nowMs = Date.now()) {
  const jwk = typeof privateJwk === "string" ? JSON.parse(privateJwk) : privateJwk;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const exp = Math.floor(nowMs / 1000) + 12 * 3600;
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp, sub: subject })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return { jwt: `${unsigned}.${b64u(new Uint8Array(sig))}`, exp };
}

// does the private JWK belong to the public key (65-byte uncompressed point, base64url)? A mismatch would make every
// push fail with 401/403, so the Worker checks this before sending anything.
export function keysMatch(publicKey, privateJwk) {
  try {
    const jwk = typeof privateJwk === "string" ? JSON.parse(privateJwk) : privateJwk;
    const p = unb64u(publicKey || ""), x = unb64u(jwk.x || ""), y = unb64u(jwk.y || "");
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || p.length !== 65 || p[0] !== 4 || x.length !== 32 || y.length !== 32) return false;
    for (let i = 0; i < 32; i++) if (p[1 + i] !== x[i] || p[33 + i] !== y[i]) return false;
    return true;
  } catch { return false; }
}

// the VAPID public key of a private JWK: the uncompressed point 0x04 ‖ x ‖ y (65 bytes), base64url — the same 87
// characters vapid-keygen.mjs prints and app/config.js pushPublicKey holds. "" when it is not an EC P-256 private JWK.
// So the Worker needs only the secret VAPID_PRIVATE_JWK: the public key is part of it (and is public information).
export function publicKeyOf(privateJwk) {
  try {
    const jwk = typeof privateJwk === "string" ? JSON.parse(privateJwk) : privateJwk;
    if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string" || !jwk.d
      || typeof jwk.x !== "string" || typeof jwk.y !== "string") return "";
    const x = unb64u(jwk.x), y = unb64u(jwk.y);
    if (x.length !== 32 || y.length !== 32) return "";
    const p = new Uint8Array(65);
    p[0] = 4;
    p.set(x, 1);
    p.set(y, 33);
    return b64u(p);
  } catch { return ""; }
}

// The key pushes go out with, checked BEFORE a send run claims any row, and by GET /health ("sending", "key"):
//   VAPID_PRIVATE_JWK missing                      → { key: "", why: "missing" }
//   not an EC P-256 private JWK                    → { key: "", why: "bad_jwk" }
//   VAPID_PUBLIC_KEY set and not the JWK's key     → { key: "", why: "mismatch" }  (empty = the JWK's own key is used)
//   the JWK cannot sign, or its signature does not verify with its own x,y (a d that is not the pair's — some runtimes
//   import such a JWK without complaint) → { key: "", why: "sign" }
//   else                                           → { key }  (canonical base64url, 87 characters)
// One ES256 signature and one verify: cheap enough for every run, and a broken secret is found before any row is locked.
export async function vapidKey(env, nowMs = Date.now()) {
  const priv = env.VAPID_PRIVATE_JWK || "";
  if (!priv) return { key: "", why: "missing" };
  const key = publicKeyOf(priv);
  if (!key) return { key: "", why: "bad_jwk" };
  if (env.VAPID_PUBLIC_KEY && !keysMatch(env.VAPID_PUBLIC_KEY, priv)) return { key: "", why: "mismatch" };
  try {
    const t = await vapidJwt("https://vapid-check.invalid", priv, env.VAPID_SUBJECT || env.ALLOWED_ORIGIN || "", nowMs);
    const [h, p, s] = t.jwt.split(".");
    const pub = await crypto.subtle.importKey("raw", unb64u(key), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(s), new TextEncoder().encode(`${h}.${p}`)))) return { key: "", why: "sign" };
  } catch { return { key: "", why: "sign" }; }
  return { key };
}

// the request for one push: POST, no body, VAPID auth, TTL until 21:00 KST (rules.js pushTtl, per push), one topic so a
// newer push replaces an undelivered older one. Redirects are never followed (a 3xx counts as a failed try): the push
// service is the only host a subscription may reach.
export function pushRequest(endpoint, jwt, publicKey, ttl) {
  return {
    url: endpoint,
    init: {
      method: "POST",
      headers: { authorization: `vapid t=${jwt}, k=${publicKey}`, ttl: String(ttl), urgency: "normal", topic: "weekly" },
      body: new Uint8Array(0),
      redirect: "manual",
    },
  };
}

// KST hour inside [start, end) (wraps midnight: 22→8) — kept from push.mjs for a later per-user quiet window
export const quiet = (hour, s, e) => (s == null || e == null || s === e ? false : s < e ? hour >= s && hour < e : hour >= s || hour < e);

// the 'watch' rule from push.mjs evaluate(): the median moved ≥ 5% or a new lowest price appeared
export function watchMoved(base, now) {
  if (!base || !base.med || now.med == null) return false;
  return Math.abs(now.med - base.med) / base.med >= 0.05 || (base.m != null && now.m != null && now.m < base.m);
}
