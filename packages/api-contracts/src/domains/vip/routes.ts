import { z } from "zod";

import { defineRoute } from "../../common/route.ts";
import { emptyObjectSchema } from "../../common/schemas.ts";
import { paymentSchema } from "../topup/models.ts";
import { vipStatusSchema } from "./models.ts";

export const vipRoutes = [
  defineRoute({
    id: "vip.get",
    method: "GET",
    path: "/api/vip",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: vipStatusSchema
      .extend({ pending_order: paymentSchema.nullable() })
      .strict(),
    errors: ["ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "vip.create_order",
    method: "POST",
    path: "/api/vip/orders",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["payments", "assets"],
    input: emptyObjectSchema,
    output: paymentSchema,
    errors: [
      "VIP_RENEWAL_LIMIT",
      "PAYMENT_ALREADY_PENDING",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "vip.claim_fgems",
    method: "POST",
    path: "/api/vip/claims/fgems",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["payments", "assets"],
    input: emptyObjectSchema,
    output: z
      .object({
        kind: z.literal("fgems"),
        amount: z.literal(100),
        claimed: z.literal(true),
      })
      .strict(),
    errors: [
      "VIP_BENEFIT_INVALID",
      "VIP_INACTIVE",
      "VIP_ALREADY_CLAIMED",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "vip.claim_free_box",
    method: "POST",
    path: "/api/vip/claims/free-box",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["payments", "assets"],
    input: emptyObjectSchema,
    output: z
      .object({
        kind: z.literal("free_rare_box"),
        amount: z.literal(1),
        claimed: z.literal(true),
      })
      .strict(),
    errors: [
      "VIP_BENEFIT_INVALID",
      "VIP_INACTIVE",
      "VIP_ALREADY_CLAIMED",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
