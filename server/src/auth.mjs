// Supabase access token check on the server (the browser's word is never taken for who the user is). HS256 with the project's
// JWT secret, or ES256 / RS256 against the project's JWKS. Expiry, audience 'authenticated' and issuer are checked.
import { HttpError, fetchT } from "./http.mjs";

const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const dec = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));
let jwksCache = { at: 0, keys: [] };

export async function verifyJwt(token, { secret, jwksUrl, issuer, fetch: f = fetch, now = Date.now() }) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new HttpError(401, "UNAUTHENTICATED", "로그인이 필요해요");
  let head, claims;
  try { head = dec(parts[0]); claims = dec(parts[1]); } catch (e) { throw new HttpError(401, "UNAUTHENTICATED", "로그인 정보가 올바르지 않아요"); }
  let data, sig;
  try { data = new TextEncoder().encode(parts[0] + "." + parts[1]); sig = b64u(parts[2]); } catch (e) { throw new HttpError(401, "UNAUTHENTICATED", "로그인 정보가 올바르지 않아요"); }
  let ok = false;
  try {
  if (head.alg === "HS256" && secret) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("HMAC", key, sig, data);
  } else if ((head.alg === "ES256" || head.alg === "RS256") && jwksUrl) {
    // refresh every 10 min, or at most once a minute when a token names a key we have not seen (key rotation)
    const stale = now - jwksCache.at > 600000 || (!jwksCache.keys.some((k) => k.kid === head.kid) && now - jwksCache.at > 60000);
    if (stale) { const r = await fetchT(f, jwksUrl, {}, 5000); if (r.ok) jwksCache = { at: now, keys: (await r.json()).keys || [] }; }
    const jwk = jwksCache.keys.find((k) => k.kid === head.kid);
    if (jwk) {
      const alg = head.alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
      const key = await crypto.subtle.importKey("jwk", jwk, alg, false, ["verify"]);
      ok = await crypto.subtle.verify(alg, key, sig, data);
    }
  }
  } catch (e) { if (e instanceof HttpError && e.code === "UPSTREAM_TIMEOUT") throw e; ok = false; }   // a malformed signature is a 401, not a 500
  if (!ok) throw new HttpError(401, "UNAUTHENTICATED", "로그인 정보가 올바르지 않아요");
  if (!claims.exp || claims.exp * 1000 < now) throw new HttpError(401, "SESSION_EXPIRED", "로그인이 만료됐어요. 다시 로그인해 주세요");
  if (claims.aud !== "authenticated" && !(Array.isArray(claims.aud) && claims.aud.includes("authenticated"))) throw new HttpError(401, "UNAUTHENTICATED", "로그인 정보가 올바르지 않아요");
  if (issuer && claims.iss !== issuer) throw new HttpError(401, "UNAUTHENTICATED", "로그인 정보가 올바르지 않아요");
  if (!/^[0-9a-f-]{36}$/.test(claims.sub || "")) throw new HttpError(401, "UNAUTHENTICATED", "로그인 정보가 올바르지 않아요");
  return { id: claims.sub, admin: (claims.app_metadata && Array.isArray(claims.app_metadata.roles) && claims.app_metadata.roles.includes("admin")) && claims.aal === "aal2", claims };
}

// test helper: an HS256 token (never used by the API itself)
export async function signHs256(claims, secret) {
  const enc = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const body = enc({ alg: "HS256", typ: "JWT" }) + "." + enc(claims);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return body + "." + btoa(String.fromCharCode(...sig)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
