import { z } from "zod";

import { assetsSchema } from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import {
  emptyObjectSchema,
  identifierSchema,
  raritySchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";
import { inventoryItemSchema } from "../inventory/models.ts";
import { vipStatusSchema } from "../vip/models.ts";

const marketTemplateSchema = z
  .object({
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    stage: z.number().int().min(1).max(3).optional(),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    unit_price: z.number().int().positive(),
    available_quantity: z.number().int().min(0),
  })
  .strict();
const createdListingSchema = z
  .object({
    listing_id: uuidSchema,
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
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
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    listed_quantity: z.number().int().positive(),
    sold_quantity: z.number().int().min(0),
    unit_price: z.number().int().positive(),
    estimated_gross: z.number().int().positive(),
    estimated_fee: z.number().int().min(0),
    estimated_net: z.number().int().positive(),
    estimated_vip_rebate: z.number().int().min(0),
    status: z.enum(["active", "partially_sold"]),
    first_listed_at: timestampSchema,
  })
  .strict();
const tradeDetailSchema = z
  .object({
    quantity: z.number().int().positive(),
    unit_price: z.number().int().positive(),
    gross: z.number().int().positive(),
    fee: z.number().int().min(0),
  })
  .strict();

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
        templates: z.array(marketTemplateSchema).length(210),
        sellable_items: z.array(
          inventoryItemSchema.extend({
            unit_price: z.number().int().positive(),
          }),
        ),
        vip: vipStatusSchema,
        max_active_templates: z.literal(10),
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
    input: emptyObjectSchema,
    output: z
      .object({ listings: z.array(managedTemplateSchema).max(10) })
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
        quantity: z.number().int().positive(),
      })
      .strict(),
    output: z
      .object({
        trade_id: uuidSchema,
        template_id: z.string(),
        quantity: z.number().int().positive(),
        unit_price: z.number().int().positive(),
        total_price: z.number().int().positive(),
        details: z.array(tradeDetailSchema).min(1),
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
