// Native store purchases (docs/APPLE_IAP_INTEGRATION.md, GOOGLE_PLAY_BILLING_INTEGRATION.md). Status: adapter + verification
// contract, tested with generated certificates / mocked Google API only. There is no native app yet, so nothing here has been
// tested against Apple or Google — do not mark it verified until a sandbox purchase from a real build passes.
//
// Apple (StoreKit 2): the app sends `signedTransactionInfo` (JWS, ES256, x5c chain). The server checks the chain up to the
// configured Apple root, the signature, bundle id, environment, product type (Consumable) and revocation, then grants once per
// transactionId. Refunds arrive as App Store Server Notifications V2 (signedPayload, same JWS checks) → REVOCATION.
// Google Play: the app sends { productId, purchaseToken }. The server reads purchases.products.get with a service account,
// requires purchaseState 0, grants once per orderId, then consumes the purchase. Refunds: Voided Purchases API → REVOCATION.
import { X509Certificate, createPublicKey, verify as cverify, createSign } from "node:crypto";
import { HttpError } from "../http.mjs";

const b64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const OID_LEAF = "1.2.840.113635.100.6.11.1", OID_INTERMEDIATE = "1.2.840.113635.100.6.2.1";

// JWS with an x5c chain [leaf, intermediate, root] → payload, or throws
export function verifyAppleJws(jws, { rootCertsB64 = [], now = Date.now(), checkOids = true } = {}) {
  const parts = String(jws || "").split(".");
  if (parts.length !== 3) throw new HttpError(400, "BAD_STORE_RECEIPT", "구매 정보 형식이 올바르지 않아요");
  const head = JSON.parse(b64u(parts[0]).toString("utf8"));
  if (head.alg !== "ES256" || !Array.isArray(head.x5c) || head.x5c.length < 3) throw new HttpError(400, "BAD_STORE_RECEIPT", "구매 정보 서명 형식이 올바르지 않아요");
  const chain = head.x5c.map((c) => new X509Certificate(Buffer.from(c, "base64")));
  const roots = rootCertsB64.map((c) => new X509Certificate(Buffer.from(c, "base64")));
  if (!roots.length) throw new HttpError(503, "STORE_NOT_CONFIGURED", "스토어 검증 설정이 없어요");
  const [leaf, mid, root] = chain;
  if (!roots.some((r) => r.fingerprint256 === root.fingerprint256)) throw new HttpError(400, "BAD_STORE_RECEIPT", "Apple 인증서가 아니에요");
  for (const [c, issuer] of [[leaf, mid], [mid, root]]) {
    if (!c.verify(issuer.publicKey) || !c.checkIssued(issuer)) throw new HttpError(400, "BAD_STORE_RECEIPT", "인증서 체인이 올바르지 않아요");
    if (Date.parse(c.validFrom) > now || Date.parse(c.validTo) < now) throw new HttpError(400, "BAD_STORE_RECEIPT", "인증서 기간이 지났어요");
  }
  if (checkOids && (!hasExt(leaf, OID_LEAF) || !hasExt(mid, OID_INTERMEDIATE))) throw new HttpError(400, "BAD_STORE_RECEIPT", "Apple 구매 서명 인증서가 아니에요");
  const ok = cverify("sha256", Buffer.from(parts[0] + "." + parts[1]), { key: createPublicKey(leaf.publicKey.export({ type: "spki", format: "pem" })), dsaEncoding: "ieee-p1363" }, b64u(parts[2]));
  if (!ok) throw new HttpError(400, "BAD_STORE_RECEIPT", "구매 정보 서명이 맞지 않아요");
  return JSON.parse(b64u(parts[1]).toString("utf8"));
}
// the extension OIDs Apple puts on its signing certificates (DER-encoded OID bytes searched in the raw certificate)
function hasExt(cert, oid) {
  const [a, b, ...rest] = oid.split(".").map(Number), enc = [40 * a + b];
  for (const n of rest) { const t = []; let v = n; do { t.unshift(v & 0x7f); v >>= 7; } while (v); for (let i = 0; i < t.length - 1; i++) t[i] |= 0x80; enc.push(...t); }
  return cert.raw.includes(Buffer.from([0x06, enc.length, ...enc]));
}

export function appleAdapter({ bundleId, environment = "Sandbox", rootCertsB64, now }) {
  return {
    // → the store_grant input (the caller passes it to commerce_store_grant with the user id)
    verifyTransaction(signedTransactionInfo) {
      const t = verifyAppleJws(signedTransactionInfo, { rootCertsB64, now: now ? now() : Date.now() });
      if (t.bundleId !== bundleId) throw new HttpError(400, "BAD_STORE_RECEIPT", "다른 앱의 구매예요");
      if (t.environment !== environment) throw new HttpError(400, "BAD_STORE_RECEIPT", `${environment} 환경의 구매가 아니에요`);
      if (t.type !== "Consumable") throw new HttpError(400, "BAD_STORE_RECEIPT", "크레딧(소모성) 상품이 아니에요");
      if (t.revocationDate) throw new HttpError(409, "PURCHASE_REVOKED", "환불·취소된 구매예요");
      return { provider: "APPLE", transaction_id: String(t.transactionId), store_product_id: t.productId, purchased_at: new Date(t.purchaseDate).toISOString(),
        raw: { transactionId: t.transactionId, originalTransactionId: t.originalTransactionId, productId: t.productId, environment: t.environment, storefront: t.storefront } };
    },
    // App Store Server Notification V2 → a refund to record, or null
    parseNotification(signedPayload) {
      const n = verifyAppleJws(signedPayload, { rootCertsB64, now: now ? now() : Date.now() });
      if (!n.data || n.data.bundleId !== bundleId) throw new HttpError(400, "BAD_STORE_RECEIPT", "다른 앱의 알림이에요");
      if (!["REFUND", "REVOKE"].includes(n.notificationType)) return { type: n.notificationType, uuid: n.notificationUUID, refund: null };
      const t = verifyAppleJws(n.data.signedTransactionInfo, { rootCertsB64, now: now ? now() : Date.now() });
      return { type: n.notificationType, uuid: n.notificationUUID, refund: { provider: "APPLE", provider_payment_id: String(t.transactionId), provider_refund_id: `apple-${n.notificationUUID}`, kind: "REVOCATION" } };
    },
  };
}

// Google: service-account JWT → OAuth token → androidpublisher v3
export function googleAdapter({ packageName, serviceAccountJson, fetch: f = fetch, now = () => Date.now() }) {
  const sa = typeof serviceAccountJson === "string" ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  let tok = { at: 0, value: null };
  async function token() {
    if (tok.value && now() - tok.at < 50 * 60000) return tok.value;
    const iat = Math.floor(now() / 1000), enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const body = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 });
    const sig = createSign("RSA-SHA256").update(body).sign(sa.private_key).toString("base64url");
    const r = await f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${body}.${sig}` });
    const j = await r.json();
    if (!r.ok || !j.access_token) throw new HttpError(502, "STORE_AUTH_FAILED", "Google 인증에 실패했어요");
    tok = { at: now(), value: j.access_token };
    return tok.value;
  }
  const api = (p) => `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${p}`;
  return {
    async verifyPurchase({ productId, purchaseToken }) {
      if (!/^[a-z0-9_.]{1,100}$/.test(productId || "") || typeof purchaseToken !== "string" || purchaseToken.length > 2000) throw new HttpError(400, "BAD_STORE_RECEIPT", "구매 정보 형식이 올바르지 않아요");
      const r = await f(api(`${productId}/tokens/${encodeURIComponent(purchaseToken)}`), { headers: { authorization: `Bearer ${await token()}` } });
      if (r.status === 404 || r.status === 410) throw new HttpError(400, "BAD_STORE_RECEIPT", "Google에 없는 구매예요");
      if (!r.ok) throw new HttpError(502, "STORE_LOOKUP_FAILED", "Google 구매 확인에 실패했어요");
      const p = await r.json();
      if (p.purchaseState !== 0) throw new HttpError(409, "PURCHASE_NOT_COMPLETED", p.purchaseState === 2 ? "결제 대기 중인 구매예요" : "취소된 구매예요");
      if (!p.orderId) throw new HttpError(400, "BAD_STORE_RECEIPT", "주문 번호가 없는 구매예요");
      return { provider: "GOOGLE", transaction_id: p.orderId, store_product_id: productId, purchased_at: new Date(+p.purchaseTimeMillis).toISOString(),
        raw: { orderId: p.orderId, purchaseState: p.purchaseState, consumptionState: p.consumptionState, acknowledgementState: p.acknowledgementState, purchaseType: p.purchaseType ?? null },
        test: p.purchaseType === 0, consumed: p.consumptionState === 1 };
    },
    // after the grant: consume so the user can buy the pack again (a failed consume is retried; the grant is already idempotent)
    async consume({ productId, purchaseToken }) {
      const r = await f(api(`${productId}/tokens/${encodeURIComponent(purchaseToken)}:consume`), { method: "POST", headers: { authorization: `Bearer ${await token()}` } });
      return { ok: r.ok };
    },
    async voided({ startTimeMillis }) {
      const r = await f(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/voidedpurchases?startTime=${startTimeMillis}`, { headers: { authorization: `Bearer ${await token()}` } });
      if (!r.ok) throw new HttpError(502, "STORE_LOOKUP_FAILED", "Google 환불 목록을 읽지 못했어요");
      const j = await r.json();
      return (j.voidedPurchases || []).map((v) => ({ provider: "GOOGLE", provider_payment_id: v.orderId, provider_refund_id: `google-${v.orderId}-${v.voidedTimeMillis}`, kind: "REVOCATION" }));
    },
  };
}
