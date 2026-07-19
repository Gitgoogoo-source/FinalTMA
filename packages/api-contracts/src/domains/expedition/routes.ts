import { z } from "zod";

import {
  expeditionInputItemSchema,
  expeditionSchema,
  inventoryItemSchema,
} from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import {
  emptyObjectSchema,
  expeditionTierSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";

const ruleSchema = z
  .object({
    tier: expeditionTierSchema,
    duration_minutes: z.number().int().positive(),
    daily_limit: z.number().int().positive(),
    allowed_rarities: z.array(
      z.enum(["common", "rare", "epic", "legendary", "mythic"]),
    ),
  })
  .strict();

export const expeditionRoutes = [
  defineRoute({
    id: "expedition.list",
    method: "GET",
    path: "/api/expeditions",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z
      .object({
        rules: z.array(ruleSchema).length(3),
        active: z.array(expeditionSchema),
        used_today: z
          .object({
            normal: z.number().int().min(0),
            intermediate: z.number().int().min(0),
            advanced: z.number().int().min(0),
          })
          .strict(),
        server_time: timestampSchema,
      })
      .strict(),
    errors: ["SESSION_REQUIRED", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "expedition.eligible_items",
    method: "GET",
    path: "/api/expeditions/eligible-items",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: z.object({ tier: expeditionTierSchema }).strict(),
    output: z
      .object({
        items: z.array(
          inventoryItemSchema.extend({
            unit_reward_fgems: z.number().int().positive(),
          }),
        ),
      })
      .strict(),
    errors: ["EXPEDITION_TIER_INVALID", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "expedition.create",
    method: "POST",
    path: "/api/expeditions",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets", "inventory"],
    input: z
      .object({
        tier: expeditionTierSchema,
        items: z.array(expeditionInputItemSchema).min(1).max(3),
      })
      .strict(),
    output: z
      .object({
        expedition: expeditionSchema,
        items: z.array(expeditionInputItemSchema),
        total_units: z.literal(3),
      })
      .strict(),
    errors: [
      "EXPEDITION_LIMIT_REACHED",
      "EXPEDITION_ALREADY_ACTIVE",
      "EXPEDITION_ITEMS_INVALID",
      "INSUFFICIENT_INVENTORY",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "expedition.claim",
    method: "POST",
    path: "/api/expeditions/:expedition_id/claim",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets", "inventory"],
    input: z.object({ expedition_id: uuidSchema }).strict(),
    output: z
      .object({
        expedition_id: uuidSchema,
        reward_fgems: z.number().int().positive(),
        status: z.literal("claimed"),
        claimed_at: timestampSchema,
      })
      .strict(),
    errors: [
      "EXPEDITION_NOT_FOUND",
      "EXPEDITION_NOT_READY",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
