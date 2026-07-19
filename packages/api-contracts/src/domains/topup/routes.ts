import { z } from "zod";

import { defineRoute } from "../../common/route.ts";
import { emptyObjectSchema, uuidSchema } from "../../common/schemas.ts";
import { paymentIntentSchema, paymentSchema } from "./models.ts";

const fixedTopupSchema = z
  .object({
    mode: z.literal("fixed"),
    amount: z.union([
      z.literal(50),
      z.literal(500),
      z.literal(1000),
      z.literal(5000),
      z.literal(10000),
    ]),
    intent: paymentIntentSchema.optional(),
  })
  .strict();
const exactGapSchema = z
  .object({
    mode: z.literal("exact_gap"),
    intent: paymentIntentSchema,
  })
  .strict();

export const topupRoutes = [
  defineRoute({
    id: "topup.bootstrap",
    method: "GET",
    path: "/api/topups/bootstrap",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z
      .object({
        products: z
          .array(
            z.union([
              z.literal(50),
              z.literal(500),
              z.literal(1000),
              z.literal(5000),
              z.literal(10000),
            ]),
          )
          .length(5),
        orders: z.array(paymentSchema),
      })
      .strict(),
    errors: ["ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "topup.create_order",
    method: "POST",
    path: "/api/topups/orders",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["payments", "assets"],
    input: z.discriminatedUnion("mode", [fixedTopupSchema, exactGapSchema]),
    output: paymentSchema,
    errors: [
      "TOPUP_AMOUNT_INVALID",
      "TOPUP_NOT_REQUIRED",
      "PAYMENT_ALREADY_PENDING",
      "PAYMENT_EXPIRED",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "topup.order",
    method: "GET",
    path: "/api/topups/orders/:order_id",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: z.object({ order_id: uuidSchema }).strict(),
    output: paymentSchema,
    errors: ["PAYMENT_NOT_FOUND", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
] as const;
