// Toss Payments (WEB_PG) adapter — docs/WEB_CHECKOUT_INTEGRATION.md. Official API (docs.tosspayments.com, read 2026-10-14):
//   POST /v1/payments/confirm {paymentKey, orderId, amount}       Basic auth = base64(secretKey + ':'), Idempotency-Key header
//   GET  /v1/payments/{paymentKey} · GET /v1/payments/orders/{orderId}
//   POST /v1/payments/{paymentKey}/cancel {cancelReason, cancelAmount?}
// Webhook PAYMENT_STATUS_CHANGED carries no signature → the server re-reads the payment with its secret key before acting.
import { fetchT } from "../http.mjs";
const MASK = (p) => p && {
  paymentKey: p.paymentKey, orderId: p.orderId, status: p.status, method: p.method, totalAmount: p.totalAmount, balanceAmount: p.balanceAmount,
  currency: p.currency, approvedAt: p.approvedAt, requestedAt: p.requestedAt, version: p.version,
  card: p.card ? { issuerCode: p.card.issuerCode, number: p.card.number, cardType: p.card.cardType } : null,   // number is already masked by Toss
  easyPay: p.easyPay ? { provider: p.easyPay.provider } : null,
  cancels: (p.cancels || []).map((c) => ({ transactionKey: c.transactionKey, cancelAmount: c.cancelAmount, canceledAt: c.canceledAt, cancelStatus: c.cancelStatus })),
};

export function tossAdapter({ secretKey, base = "https://api.tosspayments.com", fetch: f = fetch }) {
  if (!secretKey) throw new Error("TOSS_SECRET_KEY is not set");
  const auth = "Basic " + btoa(secretKey + ":");
  async function call(method, path, body, idem) {
    const headers = { authorization: auth, "content-type": "application/json" };
    if (idem) headers["idempotency-key"] = idem;
    const r = await fetchT(f, base + path, { method, headers, body: body ? JSON.stringify(body) : undefined }, 10000);
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body: j };
  }
  // one shape for the rest of the server
  const normalize = (p) => ({
    provider: "TOSS", provider_payment_id: p.paymentKey, order_id: p.orderId, amount: p.totalAmount, currency: p.currency,
    status: p.status, method: p.method, approved_at: p.approvedAt, raw: MASK(p), cancels: MASK(p).cancels,
  });
  return {
    name: "TOSS",
    normalize,
    async confirm({ paymentKey, orderId, amount }) {
      const r = await call("POST", "/v1/payments/confirm", { paymentKey, orderId, amount }, `confirm-${paymentKey}`.slice(0, 300));   // per payment attempt: a failed earlier attempt is not replayed
      if (r.ok) return { ok: true, payment: normalize(r.body) };
      // a retried confirm that Toss already processed: read the payment instead of failing the user
      if (r.body && r.body.code === "ALREADY_PROCESSED_PAYMENT") {
        const g = await call("GET", `/v1/payments/${encodeURIComponent(paymentKey)}`);
        if (g.ok) return { ok: true, payment: normalize(g.body) };
      }
      return { ok: false, status: r.status, code: (r.body && r.body.code) || "TOSS_ERROR", message: (r.body && r.body.message) || "결제 승인 실패" };
    },
    async get(paymentKey) { const r = await call("GET", `/v1/payments/${encodeURIComponent(paymentKey)}`); return r.ok ? normalize(r.body) : null; },
    async getByOrder(orderId) {
      const r = await call("GET", `/v1/payments/orders/${encodeURIComponent(orderId)}`);
      if (r.status === 404) return { notFound: true };
      return r.ok ? normalize(r.body) : { error: (r.body && r.body.code) || r.status };
    },
    async cancel(paymentKey, { reason, amount, idempotencyKey }) {
      const r = await call("POST", `/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, amount ? { cancelReason: reason, cancelAmount: amount } : { cancelReason: reason }, idempotencyKey);
      return r.ok ? { ok: true, payment: normalize(r.body) } : { ok: false, code: (r.body && r.body.code) || "TOSS_ERROR", message: r.body && r.body.message };
    },
  };
}

// DEMO adapter — no money moves. Allowed only when the environment is DEMO or SANDBOX (config.demoPayments).
export function demoAdapter() {
  return {
    name: "DEMO",
    async confirm({ orderId, amount }) {
      return { ok: true, payment: { provider: "DEMO", provider_payment_id: `demo_${orderId}`, order_id: orderId, amount, currency: "KRW", status: "DONE", method: "DEMO", approved_at: new Date().toISOString(), raw: { demo: true }, cancels: [] } };
    },
  };
}
