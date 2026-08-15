import type { HandlerMap } from "../../http/handlers.ts";
import { getEnv } from "../../platform/env/index.ts";

export const paymentSupportHandlers = {
  "telegram.payment_support": async () => ({
    data: {
      command: "/paysupport",
      text: `Payment support: ${getEnv().PAYMENT_SUPPORT_URL}`,
    },
  }),
} satisfies HandlerMap;
