import type { HandlerMap } from "../../http/handlers.ts";
import { rpc } from "../../platform/db/index.ts";
import { answerPreCheckout } from "../../platform/telegram/bot.ts";
import { applyTelegramRefund } from "../refund-risk/apply-refund.ts";

export const telegramWebhookHandlers = {
  "telegram.webhook": async (context) => {
    const update = context.input;
    const updateId = String(update.update_id);
    const checkout = update.pre_checkout_query as
      | Record<string, unknown>
      | undefined;
    if (checkout) {
      const validation = await rpc<{ valid: boolean }>("payment_validate", {
        p_invoice_payload: checkout.invoice_payload,
        p_stars: checkout.total_amount,
      });
      await answerPreCheckout(
        String(checkout.id),
        validation.valid,
        validation.valid ? undefined : "订单已失效，请重新发起支付",
      );
      return { data: { ok: true } };
    }
    const message = update.message as Record<string, unknown> | undefined;
    const payment = message?.successful_payment as
      | Record<string, unknown>
      | undefined;
    if (payment)
      await rpc("payment_apply_success", {
        p_update_id: updateId,
        p_invoice_payload: payment.invoice_payload,
        p_telegram_charge_id: payment.telegram_payment_charge_id,
        p_provider_charge_id: payment.provider_payment_charge_id ?? null,
        p_stars: payment.total_amount,
        p_payload: update,
      });
    const refund = message?.refunded_payment as
      | Record<string, unknown>
      | undefined;
    if (refund) await applyTelegramRefund(updateId, refund, update);
    return { data: { ok: true } };
  },
} satisfies HandlerMap;
