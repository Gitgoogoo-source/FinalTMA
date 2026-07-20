import { z } from "zod";

import { assetsSchema, operationSummarySchema } from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import { emptyObjectSchema, identifierSchema } from "../../common/schemas.ts";
import {
  evolutionPreviewSchema,
  evolutionResultSchema,
  inventoryItemSchema,
} from "./models.ts";

export const inventoryRoutes = [
  defineRoute({
    id: "inventory.list",
    method: "GET",
    path: "/api/inventory",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z
      .object({
        items: z.array(inventoryItemSchema),
        template_count: z.number().int().min(0),
        total_quantity: z.number().int().min(0),
      })
      .strict(),
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
    errors: [
      "INVENTORY_ITEM_NOT_FOUND",
      "ACCOUNT_RESTRICTED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "inventory.evolution_preview",
    method: "GET",
    path: "/api/inventory/:template_id/evolution-preview",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: z.object({ template_id: identifierSchema }).strict(),
    output: evolutionPreviewSchema,
    errors: [
      "INVENTORY_ITEM_NOT_FOUND",
      "ACCOUNT_RESTRICTED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "inventory.evolution_recovery",
    method: "GET",
    path: "/api/inventory/evolution/recovery",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z.object({ operations: z.array(operationSummarySchema) }).strict(),
    errors: ["SESSION_REQUIRED", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "inventory.acknowledge_evolution_result",
    method: "POST",
    path: "/api/inventory/evolution/results/:operation_id/acknowledge",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: z.object({ operation_id: z.string().uuid() }).strict(),
    output: z
      .object({
        operation_id: z.string().uuid(),
        acknowledged_at: z.string().datetime({ offset: true }),
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
    id: "inventory.evolve",
    method: "POST",
    path: "/api/inventory/evolve",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets", "inventory"],
    input: z.object({ template_id: identifierSchema }).strict(),
    output: evolutionResultSchema,
    errors: [
      "EVOLUTION_NOT_AVAILABLE",
      "INSUFFICIENT_INVENTORY",
      "INSUFFICIENT_BALANCE",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "inventory.decompose",
    method: "POST",
    path: "/api/inventory/decompose",
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
        template_id: z.string(),
        quantity: z.number().int().positive(),
        fgems_earned: z.number().int().positive(),
        remaining: z.number().int().min(0),
        assets: assetsSchema,
      })
      .strict(),
    errors: [
      "INSUFFICIENT_INVENTORY",
      "INVENTORY_RESERVED",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
