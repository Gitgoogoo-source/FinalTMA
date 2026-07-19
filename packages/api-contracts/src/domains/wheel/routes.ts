import { z } from "zod";

import { assetsSchema } from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import { emptyObjectSchema } from "../../common/schemas.ts";

const wheelRewardSchema = z
  .object({
    order: z.number().int().positive(),
    kind: z.enum(["fgems", "kcoin", "free_normal_box", "free_rare_box"]),
    amount: z.number().int().positive(),
    replaced_kind: z.enum(["free_normal_box", "free_rare_box"]).nullable(),
  })
  .strict();

export const wheelRoutes = [
  defineRoute({
    id: "wheel.get",
    method: "GET",
    path: "/api/wheel",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z
      .object({
        spin_count: z.number().int().min(0).max(20),
        remaining: z.number().int().min(0).max(20),
        daily_limit: z.literal(20),
        single_cost: z.literal(20),
        ten_cost: z.literal(180),
        milestone_10_claimed: z.boolean(),
        milestone_20_claimed: z.boolean(),
      })
      .strict(),
    errors: ["SESSION_REQUIRED", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "wheel.spin",
    method: "POST",
    path: "/api/wheel/spins",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets"],
    input: z.object({ count: z.union([z.literal(1), z.literal(10)]) }).strict(),
    output: z
      .object({
        count: z.union([z.literal(1), z.literal(10)]),
        cost_kcoin: z.union([z.literal(20), z.literal(180)]),
        rewards: z.array(wheelRewardSchema).min(1).max(10),
        milestone_fgems: z.number().int().min(0).max(50),
        spin_count: z.number().int().min(1).max(20),
        assets: assetsSchema,
      })
      .strict(),
    errors: [
      "WHEEL_COUNT_INVALID",
      "WHEEL_DAILY_LIMIT",
      "INSUFFICIENT_BALANCE",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
