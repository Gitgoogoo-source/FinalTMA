import { z } from "zod";

import { assetsSchema } from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import {
  emptyObjectSchema,
  identifierSchema,
  petThumbnailUrlSchema,
  raritySchema,
  timestampSchema,
  utcDateSchema,
  uuidSchema,
} from "../../common/schemas.ts";
import { inventoryItemSchema } from "../inventory/models.ts";
import { vipStatusSchema } from "../vip/models.ts";
import {
  MARKET_PURCHASE_MAX_QUANTITY,
  marketPurchaseQuantitySchema,
} from "./policy.ts";

const marketTemplateSchema = z
  .object({
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    stage: z.number().int().min(1).max(3).optional(),
    image_thumbnail_url: petThumbnailUrlSchema,
    unit_price: z.number().int().positive(),
    available_quantity: z.number().int().min(0),
    own_listed_quantity: z.number().int().min(0),
  })
  .strict();
const createdListingSchema = z
  .object({
    listing_id: uuidSchema,
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    image_thumbnail_url: petThumbnailUrlSchema,
    quantity: z.number().int().positive(),
    unit_price: z.number().int().positive(),
    created_at: timestampSchema,
  })
  .strict();
const managedTemplateSchema = z
  .object({
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    stage: z.number().int().min(1).max(3),
    image_thumbnail_url: petThumbnailUrlSchema,
    listed_quantity: z.number().int().positive(),
    unit_price: z.number().int().positive(),
  })
  .strict();
const saleSequenceSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);
const soldEventSchema = z
  .object({
    sale_sequence: saleSequenceSchema,
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    stage: z.number().int().min(1).max(3),
    image_thumbnail_url: petThumbnailUrlSchema,
    quantity: z.number().int().positive(),
    unit_price: z.number().int().positive(),
    sold_at: timestampSchema,
  })
  .strict();
const tradeDetailSchema = z
  .object({
    quantity: marketPurchaseQuantitySchema,
    unit_price: z.number().int().positive(),
    gross: z.number().int().positive(),
    fee: z.number().int().min(0),
  })
  .strict();
const listingQuotaSchema = z
  .object({
    business_date: utcDateSchema,
    daily_used: z.number().int().min(0).max(200),
    daily_limit: z.literal(200),
    daily_remaining: z.number().int().min(0).max(200),
    lifetime_used: z.number().int().min(0).max(20_000),
    lifetime_limit: z.literal(20_000),
    lifetime_remaining: z.number().int().min(0).max(20_000),
  })
  .strict()
  .refine((quota) => quota.daily_used + quota.daily_remaining === 200)
  .refine((quota) => quota.lifetime_used + quota.lifetime_remaining === 20_000);

export const marketRoutes = [
  defineRoute({
    id: "market.bootstrap",
    method: "GET",
    path: "/api/market/bootstrap",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z
      .object({
        templates: z.array(marketTemplateSchema).max(210),
        sellable_items: z.array(
          inventoryItemSchema.extend({
            unit_price: z.number().int().positive(),
          }),
        ),
        vip: vipStatusSchema,
        listing_quota: listingQuotaSchema,
        max_active_templates: z.literal(30),
        fee_bps: z.literal(500),
        vip_rebate_bps: z.literal(2000),
      })
      .strict(),
    errors: ["SESSION_REQUIRED", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "market.template",
    method: "GET",
    path: "/api/market/templates/:template_id",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: z.object({ template_id: identifierSchema }).strict(),
    output: marketTemplateSchema,
    errors: ["TEMPLATE_NOT_FOUND", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "market.my_listings",
    method: "GET",
    path: "/api/market/listings/mine",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: z
      .object({ after_sale_sequence: saleSequenceSchema.optional() })
      .strict(),
    output: z
      .object({
        listings: z.array(managedTemplateSchema).max(30),
        sold_events: z.array(soldEventSchema).max(100),
        sale_cursor: saleSequenceSchema,
        has_more: z.boolean(),
      })
      .strict(),
    errors: ["ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "market.create_listing",
    method: "POST",
    path: "/api/market/listings",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets", "inventory"],
    input: z
      .object({
        template_id: identifierSchema,
        quantity: z.number().int().positive(),
      })
      .strict(),
    output: createdListingSchema,
    errors: [
      "MARKET_ACTIVE_TEMPLATE_LIMIT",
      "MARKET_DAILY_LISTING_LIMIT",
      "MARKET_LIFETIME_LISTING_LIMIT",
      "INSUFFICIENT_INVENTORY",
      "TEMPLATE_NOT_FOUND",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "market.cancel_template_listings",
    method: "POST",
    path: "/api/market/templates/:template_id/cancel",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets", "inventory"],
    input: z.object({ template_id: identifierSchema }).strict(),
    output: z
      .object({
        template_id: identifierSchema,
        status: z.literal("cancelled"),
        released_quantity: z.number().int().min(0),
      })
      .strict(),
    errors: ["TEMPLATE_NOT_FOUND", "IDEMPOTENCY_KEY_REUSED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "market.purchase",
    method: "POST",
    path: "/api/market/purchases",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets", "inventory"],
    input: z
      .object({
        template_id: identifierSchema,
        quantity: marketPurchaseQuantitySchema,
      })
      .strict(),
    output: z
      .object({
        trade_id: uuidSchema,
        template_id: z.string(),
        quantity: marketPurchaseQuantitySchema,
        unit_price: z.number().int().positive(),
        total_price: z.number().int().positive(),
        details: z
          .array(tradeDetailSchema)
          .min(1)
          .max(MARKET_PURCHASE_MAX_QUANTITY),
        assets: assetsSchema,
      })
      .strict(),
    errors: [
      "MARKET_STOCK_INSUFFICIENT",
      "INSUFFICIENT_BALANCE",
      "TEMPLATE_NOT_FOUND",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
