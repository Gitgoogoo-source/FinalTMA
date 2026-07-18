import { rpc } from "../../platform/db/index.ts";
import { createInvoiceLink } from "../../platform/telegram/bot.ts";
import { operationResult, type OperationEnvelope } from "../operations/mapper.ts";
import { requireOperationId, requireSession, type HandlerMap, type HandlerResult } from "../types.ts";

type Payment = { id: string; invoice_url: string | null; stars_amount: number; kind: "kcoin_topup" | "vip" };
type InvoiceDetails = { id: string; invoice_payload: string; stars_amount: number; kind: "kcoin_topup" | "vip" };

export const topupHandlers = {
  "topup.bootstrap": async (context) => ({ data: await rpc("topup_bootstrap", { p_session_id: requireSession(context).session_id }) }),
  "topup.order": async (context) => ({ data: await rpc("topup_order", { p_session_id: requireSession(context).session_id, p_order_id: context.input.order_id }) }),
  "topup.create_order": async (context) => createOrder(context, "topup_create_order", {
    p_mode: context.input.mode,
    p_amount: context.input.amount ?? null,
    p_intent: context.input.intent ?? null,
  }),
} satisfies HandlerMap;

export async function createOrder(
  context: Parameters<NonNullable<HandlerMap["topup.create_order"]>>[0],
  procedure: "topup_create_order" | "vip_create_order",
  extra: Record<string, unknown> = {},
): Promise<HandlerResult> {
  const operation = await rpc<OperationEnvelope>(procedure, {
    p_session_id: requireSession(context).session_id,
    p_operation_id: requireOperationId(context),
    ...extra,
  });
  const mapped = operationResult(operation);
  const payment = mapped.data as Payment;
  if (payment.invoice_url) return mapped;
  const details = await rpc<InvoiceDetails>("payment_invoice_details", { p_order_id: payment.id });
  const invoiceUrl = await createInvoiceLink({
    title: details.kind === "vip" ? "PokePets VIP 月卡" : `充值 ${details.stars_amount} K-coin`,
    description: details.kind === "vip" ? "30 个 UTC 自然日的 PokePets VIP 权益" : `${details.stars_amount} Telegram Stars 兑换 ${details.stars_amount} K-coin`,
    payload: details.invoice_payload,
    stars: details.stars_amount,
  });
  return { ...mapped, data: await rpc("payment_set_invoice_url", { p_order_id: payment.id, p_invoice_url: invoiceUrl }) };
}
