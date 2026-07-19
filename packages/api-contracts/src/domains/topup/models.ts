import { z } from "zod";

import {
  boxTierSchema,
  nonNegativeIntegerSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";

export const paymentIntentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("gacha"),
      tier: boxTierSchema,
      draw_count: z.union([z.literal(1), z.literal(10)]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("market"),
      template_id: z.string().min(1),
      quantity: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("wheel"),
      count: z.union([z.literal(1), z.literal(10)]),
    })
    .strict(),
]);

export const paymentSchema = z
  .object({
    id: uuidSchema,
    kind: z.enum(["kcoin_topup", "vip"]),
    status: z.enum([
      "pending",
      "paid",
      "delivered",
      "expired",
      "refunded",
      "rejected",
    ]),
    stars_amount: z.number().int().positive(),
    kcoin_amount: nonNegativeIntegerSchema,
    invoice_url: z.string().url().nullable(),
    expires_at: timestampSchema,
    paid_at: timestampSchema.nullable(),
    delivered_at: timestampSchema.nullable(),
    intent: paymentIntentSchema.nullable(),
  })
  .strict();
