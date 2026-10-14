// Payment flows on the server (docs/WEB_CHECKOUT_INTEGRATION.md). The browser only starts the provider's checkout with an
// order the server created; credits are granted only after the server itself confirmed / re-read the payment with the secret
// key, and only through commerce_fulfill_payment (exactly once per order). Webhook bodies are never trusted: they only tell the
// server which payment to re-read.
import { HttpError, fromDb } from "../http.mjs";

export function paymentFlows({ rpc, toss, demo, log = () => {} }) {
  async function fulfill(order, pay, actor) {
    if (pay.order_id !== order.id) throw new HttpError(409, "ORDER_MISMATCH", "결제와 주문이 맞지 않아요");
    try { return await rpc("commerce_fulfill_payment", { ...pay, order_id: order.id, actor }); }
    catch (e) {
      const err = fromDb(e);
      // a second, different payment for an already-paid order: give that money back automatically
      if (err.code === "ORDER_ALREADY_PAID" && toss && pay.provider === "TOSS") {
        const c = await toss.cancel(pay.provider_payment_id, { reason: "같은 주문의 중복 결제 자동 취소", idempotencyKey: `dup-${pay.provider_payment_id}`.slice(0, 300) });
        log("duplicate_payment_canceled", { order: order.id, ok: c.ok });
      }
      throw err;
    }
  }

  return {
    async createOrder(user, { product_code, channel, idempotency_key }) {
      if (!["MINI", "STANDARD", "PLUS"].includes(product_code)) throw new HttpError(400, "PRODUCT_NOT_FOR_SALE", "판매 중인 상품이 아니에요");
      if (!["WEB_PG", "DEMO"].includes(channel)) throw new HttpError(400, "CHANNEL_NOT_SUPPORTED", "앱 안 결제는 스토어 결제로 진행해요");
      if (channel === "DEMO" && !demo) throw new HttpError(403, "DEMO_DISABLED", "운영 환경에서는 시연 결제를 쓸 수 없어요");
      try {
        const o = await rpc("commerce_create_order", { user_id: user.id, product_code, channel, idempotency_key });
        // what the checkout widget needs — amount and name come from the order snapshot, never from the client
        return { order_id: o.id, amount: o.amount_krw, currency: o.currency, order_name: o.order_name, credits: o.paid_credits, adfree_days: o.adfree_days,
          vat_included: o.vat_included, status: o.status, channel: o.channel };
      } catch (e) { throw fromDb(e); }
    },

    // the success redirect: { paymentKey, orderId, amount } from the browser, all re-checked here
    async confirmToss(user, { paymentKey, orderId, amount }) {
      if (!toss) throw new HttpError(503, "PAYMENTS_NOT_CONFIGURED", "결제가 아직 준비되지 않았어요");
      if (typeof paymentKey !== "string" || paymentKey.length > 200 || typeof orderId !== "string") throw new HttpError(400, "BAD_REQUEST", "요청 형식이 올바르지 않아요");
      const order = await rpc("commerce_get_order", { order_id: orderId, user_id: user.id }).catch(() => null);
      if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "주문을 찾지 못했어요");             // someone else's order looks the same as none
      if (order.channel !== "WEB_PG") throw new HttpError(409, "CHANNEL_MISMATCH", "결제 수단이 주문과 달라요");
      if (Number(amount) !== order.amount_krw) throw new HttpError(409, "AMOUNT_MISMATCH", "결제 금액이 주문과 달라요");   // checked before Toss is called
      const r = await toss.confirm({ paymentKey, orderId: order.id, amount: order.amount_krw });
      if (!r.ok) throw new HttpError(402, `TOSS_${r.code}`.slice(0, 60), r.message || "결제 승인에 실패했어요");
      const out = await fulfill(order, r.payment, "confirm");
      return { order_id: order.id, already: out.already, wallet: out.wallet };
    },

    // DEMO / SANDBOX only: completes a DEMO-channel order without money (still through the same ledger function)
    async confirmDemo(user, { orderId }) {
      if (!demo) throw new HttpError(403, "DEMO_DISABLED", "운영 환경에서는 시연 결제를 쓸 수 없어요");
      const order = await rpc("commerce_get_order", { order_id: orderId, user_id: user.id }).catch(() => null);
      if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "주문을 찾지 못했어요");
      if (order.channel !== "DEMO") throw new HttpError(409, "CHANNEL_MISMATCH", "결제 수단이 주문과 달라요");
      const r = await demo.confirm({ orderId: order.id, amount: order.amount_krw });
      const out = await fulfill(order, r.payment, "demo");
      return { order_id: order.id, already: out.already, wallet: out.wallet, demo: true };
    },

    // Toss webhook. 200 = handled (or nothing to do); 5xx = try again later (Toss retries up to 7 times)
    async tossWebhook(body) {
      if (!toss) return { status: 503 };
      const data = (body && body.data) || {};
      const type = String((body && body.eventType) || "UNKNOWN").slice(0, 60);
      const paymentKey = typeof data.paymentKey === "string" ? data.paymentKey.slice(0, 200) : null;
      const ev = await rpc("commerce_record_event", { provider: "TOSS", type, verified: paymentKey ? "API_LOOKUP" : "NONE",
        event_key: `${type}:${paymentKey || ""}:${data.status || ""}:${data.lastTransactionKey || data.transactionKey || body.createdAt || ""}`.slice(0, 300),
        payload: { eventType: type, createdAt: body && body.createdAt, paymentKey, orderId: data.orderId, status: data.status } });
      if (!paymentKey) { if (ev.id) await rpc("commerce_event_done", { id: ev.id, result: "IGNORED_NO_PAYMENT_KEY" }); return { status: 200, result: "ignored" }; }
      const pay = await toss.get(paymentKey);                      // the authoritative state, read with our secret key
      if (!pay) return { status: 502, result: "lookup_failed" };    // transient: let Toss retry
      const result = await this.applyTossState(pay, "webhook");
      if (ev.id) await rpc("commerce_event_done", { id: ev.id, result });
      return { status: 200, result };
    },

    // one re-read Toss payment → the matching ledger action (used by the webhook and the reconciliation job). Idempotent.
    async applyTossState(pay, actor) {
      const order = await rpc("commerce_get_order", { order_id: pay.order_id }).catch(() => null);
      if (!order || order.channel !== "WEB_PG") return "UNKNOWN_ORDER";
      if (pay.status === "DONE") { const r = await fulfill(order, pay, actor); return r.already ? "ALREADY_FULFILLED" : "FULFILLED"; }
      if (pay.status === "CANCELED" || pay.status === "PARTIAL_CANCELED") {
        const known = await rpc("commerce_payment", { provider: "TOSS", provider_payment_id: pay.provider_payment_id });
        if (!known) { await rpc("commerce_close_order", { order_id: order.id, status: "CANCELED", reason: "결제 취소" }); return "CLOSED_CANCELED"; }
        let n = 0;
        for (const c of pay.cancels || []) {
          if (c.cancelStatus && c.cancelStatus !== "DONE") continue;
          const r = await rpc("commerce_refund", { provider: "TOSS", provider_payment_id: pay.provider_payment_id, provider_refund_id: c.transactionKey,
            amount: c.cancelAmount, kind: "REFUND", provider_done: true, reason: "토스 결제 취소", actor });
          if (!r.already) n++;
        }
        return `REFUNDS_RECORDED_${n}`;
      }
      if (["ABORTED", "EXPIRED"].includes(pay.status)) { await rpc("commerce_close_order", { order_id: order.id, status: pay.status === "EXPIRED" ? "EXPIRED" : "FAILED", reason: pay.status }); return `CLOSED_${pay.status}`; }
      return `NO_ACTION_${pay.status}`;                            // READY / IN_PROGRESS / WAITING_FOR_DEPOSIT
    },

    // scheduled: orders still open after 10 minutes are asked about (missed redirect, missed webhook)
    async reconcile({ minutes = 10, expireAfterMinutes = 60, now = Date.now() } = {}) {
      const started = new Date(now).toISOString();
      const open = toss ? await rpc("commerce_open_orders", { channel: "WEB_PG", minutes }) : [];
      let fixed = 0; const mismatches = [];
      for (const o of open) {
        const p = await toss.getByOrder(o.id);
        if (p.notFound) {
          if (o.status === "CREATED" && now - Date.parse(o.created_at) > expireAfterMinutes * 60000) { await rpc("commerce_close_order", { order_id: o.id, status: "EXPIRED", reason: "결제창에서 결제하지 않음" }); fixed++; }
          continue;
        }
        if (p.error) { mismatches.push({ order: o.id, error: String(p.error) }); continue; }
        try { const r = await this.applyTossState(p, "reconcile"); if (/FULFILLED$|CLOSED|REFUNDS_RECORDED_[1-9]/.test(r) && r !== "ALREADY_FULFILLED") fixed++; }
        catch (e) { mismatches.push({ order: o.id, error: e.code || e.message }); }
      }
      const exp = await rpc("commerce_expire_jobs", {});
      await rpc("commerce_reconcile_log", { started_at: started, checked: open.length, fixed, mismatches });
      return { checked: open.length, fixed, mismatches, jobs_released: exp.released };
    },

    // admin refund (MFA admin only, checked by the caller): Toss first, the ledger from Toss's answer
    async adminRefund(admin, { provider_payment_id, amount, reason, force_spent = false }) {
      if (!toss) throw new HttpError(503, "PAYMENTS_NOT_CONFIGURED", "결제가 아직 준비되지 않았어요");
      if (!reason || String(reason).length < 4) throw new HttpError(400, "BAD_REQUEST", "환불 사유를 적어 주세요");
      const pv = await rpc("commerce_preview_refund", { provider: "TOSS", provider_payment_id, amount }).catch((e) => { throw fromDb(e); });
      if (!pv.automatic && !force_spent) throw new HttpError(409, "CREDITS_ALREADY_SPENT", "이미 쓴 크레딧이 있어요. 정책 확인 후 force_spent로 진행하세요", pv);
      const c = await toss.cancel(provider_payment_id, { reason: String(reason).slice(0, 200), amount: amount || undefined, idempotencyKey: `refund-${provider_payment_id}-${amount || "all"}-${pv.refundable_krw}` });
      if (!c.ok) throw new HttpError(502, `TOSS_${c.code}`.slice(0, 60), c.message || "토스 취소 실패");
      const res = await this.applyTossState(c.payment, `admin:${admin.id}`);
      return { result: res, preview: pv };
    },
  };
}
