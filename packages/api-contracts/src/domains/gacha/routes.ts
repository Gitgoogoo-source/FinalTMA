import { z } from "zod";

import { assetsSchema, operationSummarySchema } from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import {
  boxTierSchema,
  emptyObjectSchema,
  raritySchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";
import { boxSchema, gachaPoolSchema } from "./models.ts";

const pitySchema = z
  .object({
    tier: boxTierSchema,
    progress: z.number().int().min(0),
    limit: z.number().int().positive(),
    target_rarity: raritySchema,
  })
  .strict();
const resultItemSchema = z
  .object({
    order: z.number().int().positive(),
    template_id: z.string(),
    name: z.string(),
    rarity: raritySchema,
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    quantity: z.literal(1),
    image_thumbnail_path: z.string().startsWith("/assets/catalog/v1/thumb/"),
    image_detail_path: z.string().startsWith("/assets/catalog/v1/detail/"),
    new_album: z.boolean(),
    pity_triggered: z.boolean(),
  })
  .strict();
const gachaOpenOutputSchema = z
  .object({
    tier: boxTierSchema,
    draw_count: z.union([z.literal(1), z.literal(10)]),
    paid_kcoin: z.number().int().min(0),
    entitlement_used: z.enum(["free_normal_box", "free_rare_box"]).nullable(),
    results: z.array(resultItemSchema).min(1).max(10),
    pity: pitySchema,
    assets: assetsSchema,
  })
  .strict()
  .superRefine(({ draw_count, results }, context) => {
    if (results.length !== draw_count)
      context.addIssue({
        code: "custom",
        message: "Result count must equal draw_count",
        path: ["results"],
      });
    if (
      [...results]
        .sort((left, right) => left.order - right.order)
        .some((item, index) => item.order !== index + 1)
    )
      context.addIssue({
        code: "custom",
        message: "Result order must be unique and contiguous",
        path: ["results"],
      });
  });

export const gachaRoutes = [
  defineRoute({
    id: "gacha.bootstrap",
    method: "GET",
    path: "/api/gacha/bootstrap",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z
      .object({
        boxes: z.array(boxSchema).length(3),
        pity: z.array(pitySchema).length(3),
        entitlements: z
          .object({
            free_normal_box: z.number().int().min(0),
            free_rare_box: z.number().int().min(0),
          })
          .strict(),
        rules_complete: z.boolean(),
      })
      .strict(),
    errors: ["SESSION_REQUIRED", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "gacha.recovery",
    method: "GET",
    path: "/api/gacha/recovery",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z.object({ operations: z.array(operationSummarySchema) }).strict(),
    errors: ["SESSION_REQUIRED", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "gacha.acknowledge_result",
    method: "POST",
    path: "/api/gacha/results/:operation_id/acknowledge",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: z.object({ operation_id: uuidSchema }).strict(),
    output: z
      .object({
        operation_id: uuidSchema,
        acknowledged_at: timestampSchema,
      })
      .strict(),
    errors: [
      "OPERATION_NOT_FOUND",
      "OPERATION_NOT_ACKNOWLEDGEABLE",
      "ACCOUNT_RESTRICTED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "gacha.pool",
    method: "GET",
    path: "/api/gacha/pool",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: z.object({ tier: boxTierSchema }).strict(),
    output: gachaPoolSchema,
    errors: [
      "BOX_TIER_INVALID",
      "CATALOG_INVALID",
      "SESSION_REQUIRED",
      "ACCOUNT_RESTRICTED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "gacha.open",
    method: "POST",
    path: "/api/gacha/open",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets", "inventory"],
    input: z
      .object({
        tier: boxTierSchema,
        draw_count: z.union([z.literal(1), z.literal(10)]),
      })
      .strict(),
    output: gachaOpenOutputSchema,
    errors: [
      "BOX_TIER_INVALID",
      "DRAW_COUNT_INVALID",
      "CATALOG_INVALID",
      "INSUFFICIENT_BALANCE",
      "FREE_ENTITLEMENT_UNAVAILABLE",
      "IDEMPOTENCY_KEY_REUSED",
      "ACCOUNT_RESTRICTED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
