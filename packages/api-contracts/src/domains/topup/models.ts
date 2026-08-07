import { z } from "zod";

import {
  boxTierSchema,
  nonNegativeIntegerSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";
import { battleTeamSelectionSchema } from "../battle/models.ts";

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
  z
    .object({
      kind: z.literal("battle_create"),
      tier: z.enum(["tier-20", "tier-100", "tier-500"]),
      template_ids: battleTeamSelectionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("battle_accept"),
      room_id: uuidSchema,
      template_ids: battleTeamSelectionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("battle_matchmaking"),
      tier: z.enum(["tier-20", "tier-100", "tier-500"]),
      template_ids: battleTeamSelectionSchema,
    })
    .strict(),
]);

export const paymentSchema = z
  .object({
    id: uuidSchema,
    kind: z.enum(["kcoin_topup", "vip"]),
    status: z.enum([
      "pending",
      "processing",
      "paid",
      "delivered",
      "failed",
      "cancelled",
      "expired",
      "refunded",
      "rejected",
      "payment_identity_conflict",
    ]),
    stars_amount: z.number().int().positive(),
    kcoin_amount: nonNegativeIntegerSchema,
    invoice_url: z.string().url().nullable(),
    expires_at: timestampSchema,
    checkout_started_at: timestampSchema.nullable(),
    paid_at: timestampSchema.nullable(),
    delivered_at: timestampSchema.nullable(),
    failed_at: timestampSchema.nullable(),
    cancelled_at: timestampSchema.nullable(),
    intent: paymentIntentSchema.nullable(),
  })
  .strict();
