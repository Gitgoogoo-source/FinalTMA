import { z } from "zod";

import { errorCodes } from "./errors.ts";
import {
  accountStatusSchema,
  boxTierSchema,
  chainTypeSchema,
  expeditionTierSchema,
  nonNegativeIntegerSchema,
  operationStatusSchema,
  raritySchema,
  timestampSchema,
  utcDateSchema,
  uuidSchema,
} from "./schemas.ts";

export const balanceSchema = z
  .object({
    currency: z.enum(["KCOIN", "FGEMS"]),
    available: nonNegativeIntegerSchema,
    locked: nonNegativeIntegerSchema,
  })
  .strict();

export const assetsSchema = z
  .object({ kcoin: balanceSchema, fgems: balanceSchema })
  .strict();

export const userSchema = z
  .object({
    id: uuidSchema,
    telegram_id: z.string().regex(/^\d+$/),
    username: z.string().nullable(),
    first_name: z.string(),
    status: accountStatusSchema,
    referral_code: z.string(),
  })
  .strict();

export const operationSummarySchema = z
  .object({
    operation_id: uuidSchema,
    use_case: z.string(),
    status: operationStatusSchema,
    result: z.json().nullable(),
    error_code: z.enum(errorCodes).nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strict();

export const catalogChainSchema = z
  .object({
    id: z.string(),
    global_order: z.number().int().positive(),
    chain_type: chainTypeSchema,
    theme: z.string(),
    continuity: z.string(),
    catalog_version: z.literal("v1"),
  })
  .strict();

export const catalogTemplateSchema = z
  .object({
    id: z.string(),
    chain_id: z.string(),
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    rarity: raritySchema,
    name: z.string(),
    sort_order: z.number().int().positive(),
    combat_power: z.number().int().positive(),
    market_price: z.number().int().positive(),
    decompose_fgems: z.number().int().positive(),
    expedition_fgems: z.number().int().positive(),
    image_path: z.string().startsWith("/assets/"),
    draw_weight: z.number().int().positive(),
    catalog_version: z.literal("v1"),
  })
  .strict();

export const boxSchema = z
  .object({
    tier: boxTierSchema,
    display_name: z.string(),
    image_path: z.string().startsWith("/assets/"),
    single_price: z.number().int().positive(),
    ten_price: z.number().int().positive(),
    pity_limit: z.number().int().positive(),
    pity_rarity: raritySchema,
    rarity_weights: z
      .object({
        common: nonNegativeIntegerSchema,
        rare: nonNegativeIntegerSchema,
        epic: nonNegativeIntegerSchema,
        legendary: nonNegativeIntegerSchema,
        mythic: nonNegativeIntegerSchema,
      })
      .strict(),
  })
  .strict();

export const inventoryItemSchema = z
  .object({
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    chain_id: z.string(),
    chain_type: chainTypeSchema,
    image_path: z.string(),
    combat_power: z.number().int().positive(),
    expedition_fgems: z.number().int().positive(),
    total: nonNegativeIntegerSchema,
    available: nonNegativeIntegerSchema,
    listed: nonNegativeIntegerSchema,
    trading: nonNegativeIntegerSchema,
    expedition: nonNegativeIntegerSchema,
    minting: nonNegativeIntegerSchema,
  })
  .strict()
  .refine(
    (item) =>
      item.total ===
      item.available +
        item.listed +
        item.trading +
        item.minting +
        item.expedition,
    { message: "Inventory quantities must add up to total", path: ["total"] },
  );

export const expeditionInputItemSchema = z
  .object({
    template_id: z.string().min(1),
    quantity: z.number().int().positive(),
  })
  .strict();

export const expeditionSchema = z
  .object({
    id: uuidSchema,
    tier: expeditionTierSchema,
    status: z.enum(["running", "claimable", "claimed"]),
    reward_fgems: z.number().int().positive(),
    started_at: timestampSchema,
    completes_at: timestampSchema,
    claimed_at: timestampSchema.nullable(),
  })
  .strict();

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

export const mintSchema = z
  .object({
    id: uuidSchema,
    template_id: z.string(),
    status: z.enum([
      "reserved",
      "submitted",
      "unknown",
      "succeeded",
      "failed",
      "cancelled",
    ]),
    nft_number: z.number().int().nonnegative(),
    transaction_hash: z.string().nullable(),
    permit_expires_at: timestampSchema,
    submitted_at: timestampSchema.nullable(),
    completed_at: timestampSchema.nullable(),
  })
  .strict();

export const vipStatusSchema = z
  .object({
    active: z.boolean(),
    starts_on: utcDateSchema.nullable(),
    ends_on: utcDateSchema.nullable(),
    renewals_used: nonNegativeIntegerSchema,
    can_purchase: z.boolean(),
    can_renew: z.boolean(),
    fgems_claimed_today: z.boolean(),
    free_box_claimed_today: z.boolean(),
  })
  .strict();
