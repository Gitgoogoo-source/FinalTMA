import { requireSession, type HandlerMap } from "../../http/handlers.ts";
import { rpc } from "../../platform/db/index.ts";
import { createStarsOrder } from "../../workflows/stars-payment/create-order.ts";

export const topupHandlers = {
  "topup.bootstrap": async (context) => ({
    data: await rpc("topup_bootstrap", {
      p_session_id: requireSession(context).session_id,
    }),
  }),
  "topup.order": async (context) => ({
    data: await rpc("topup_order", {
      p_session_id: requireSession(context).session_id,
      p_order_id: context.input.order_id,
    }),
  }),
  "topup.create_order": async (context) =>
    createStarsOrder(context, "topup_create_order", {
      p_mode: context.input.mode,
      p_amount: context.input.amount ?? null,
      p_intent: context.input.intent ?? null,
    }),
} satisfies HandlerMap;
