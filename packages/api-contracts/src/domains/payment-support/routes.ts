import { z } from "zod";

import { defineRoute } from "../../common/route.ts";
import { emptyObjectSchema } from "../../common/schemas.ts";

export const paymentSupportRoutes = [
  defineRoute({
    id: "telegram.payment_support",
    method: "GET",
    path: "/api/telegram/payment-support",
    gateway: "app",
    auth: false,
    idempotent: false,
    input: emptyObjectSchema,
    output: z
      .object({ command: z.literal("/paysupport"), text: z.string().min(1) })
      .strict(),
    errors: ["INTERNAL_ERROR"],
  }),
] as const;
