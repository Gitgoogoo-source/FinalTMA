import { z } from "zod";

import { assetsSchema, inventoryItemSchema } from "../common/models.ts";
import { defineRoute } from "../common/route.ts";
import { emptyObjectSchema, identifierSchema, raritySchema } from "../common/schemas.ts";

export const inventoryRoutes = [
  defineRoute({
    id: "inventory.list",
    method: "GET",
    path: "/api/inventory",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z.object({ items: z.array(inventoryItemSchema), template_count: z.number().int().min(0), total_quantity: z.number().int().min(0) }).strict(),
    errors: ["SESSION_REQUIRED", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "inventory.detail",
    method: "GET",
    path: "/api/inventory/:template_id",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: z.object({ template_id: identifierSchema }).strict(),
    output: inventoryItemSchema,
    errors: ["INVENTORY_ITEM_NOT_FOUND", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "inventory.evolve",
    method: "POST",
    path: "/api/inventory/evolve",
    gateway: "app",
    auth: true,
    idempotent: true,
    input: z.object({ template_id: identifierSchema }).strict(),
    output: z
      .object({
        success: z.boolean(),
        source_template_id: z.string(),
        target_template_id: z.string(),
        target_name: z.string(),
        target_rarity: raritySchema,
        fgems_spent: z.number().int().positive(),
        failure_count: z.number().int().min(0),
        new_album: z.boolean(),
        assets: assetsSchema,
      })
      .strict(),
    errors: ["EVOLUTION_NOT_AVAILABLE", "INSUFFICIENT_INVENTORY", "INSUFFICIENT_BALANCE", "IDEMPOTENCY_KEY_REUSED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "inventory.decompose",
    method: "POST",
    path: "/api/inventory/decompose",
    gateway: "app",
    auth: true,
    idempotent: true,
    input: z.object({ template_id: identifierSchema, quantity: z.number().int().positive() }).strict(),
    output: z
      .object({ template_id: z.string(), quantity: z.number().int().positive(), fgems_earned: z.number().int().positive(), remaining: z.number().int().min(0), assets: assetsSchema })
      .strict(),
    errors: ["INSUFFICIENT_INVENTORY", "INVENTORY_RESERVED", "IDEMPOTENCY_KEY_REUSED", "INTERNAL_ERROR"],
  }),
] as const;
