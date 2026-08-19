import type { HandlerMap } from "../../http/handlers.ts";
import {
  PAYMENT_SUPPORT_COMMAND,
  paymentSupportText,
} from "../../workflows/stars-payment/payment-support.ts";

export const paymentSupportHandlers = {
  "telegram.payment_support": async () => ({
    data: {
      command: PAYMENT_SUPPORT_COMMAND,
      text: paymentSupportText(),
    },
  }),
} satisfies HandlerMap;
