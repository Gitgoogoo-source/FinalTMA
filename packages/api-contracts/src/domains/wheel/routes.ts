import { z } from "zod";

import { assetsSchema, operationSummarySchema } from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import {
  emptyObjectSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";

const wheelRewardSchema = z
  .object({
    order: z.number().int().positive(),
    kind: z.enum(["fgems", "kcoin", "free_normal_box", "free_rare_box"]),
    amount: z.number().int().positive(),
    replaced_kind: z.enum(["free_normal_box", "free_rare_box"]).nullable(),
  })
  .strict();

const wheelSpinOutputSchema = z
  .object({
    count: z.union([z.literal(1), z.literal(10)]),
    cost_kcoin: z.union([z.literal(20), z.literal(180)]),
    kcoin_returned: z.number().int().min(0),
    net_kcoin_change: z.number().int(),
    rewards: z.array(wheelRewardSchema).min(1).max(10),
    reward_summary: z
      .object({
        fgems: z.number().int().min(0),
        kcoin: z.number().int().min(0),
        free_normal_box: z.number().int().min(0),
        free_rare_box: z.number().int().min(0),
        replaced_free_normal_box: z.number().int().min(0),
        replaced_free_rare_box: z.number().int().min(0),
      })
      .strict(),
    milestone: z
      .object({
        awarded_fgems: z.union([z.literal(0), z.literal(25), z.literal(50)]),
        milestone_10_claimed: z.boolean(),
        milestone_20_claimed: z.boolean(),
      })
      .strict(),
    entitlements: z
      .object({
        free_normal_box: z.number().int().min(0),
        free_rare_box: z.number().int().min(0),
      })
      .strict(),
    spin_count: z.number().int().min(1).max(20),
    remaining: z.number().int().min(0).max(19),
    daily_limit: z.literal(20),
    assets: assetsSchema,
  })
  .strict()
  .superRefine(
    (
      {
        cost_kcoin,
        count,
        kcoin_returned,
        milestone,
        net_kcoin_change,
        remaining,
        reward_summary,
        rewards,
        spin_count,
      },
      context,
    ) => {
      if (rewards.length !== count)
        context.addIssue({
          code: "custom",
          message: "Reward count must equal spin count",
          path: ["rewards"],
        });
      if (
        [...rewards]
          .sort((left, right) => left.order - right.order)
          .some((reward, index) => reward.order !== index + 1)
      )
        context.addIssue({
          code: "custom",
          message: "Reward order must be unique and contiguous",
          path: ["rewards"],
        });
      if (net_kcoin_change !== kcoin_returned - cost_kcoin)
        context.addIssue({
          code: "custom",
          message: "Net K-coin change must equal returned rewards minus cost",
          path: ["net_kcoin_change"],
        });
      if (cost_kcoin !== (count === 10 ? 180 : 20))
        context.addIssue({
          code: "custom",
          message: "K-coin cost must match spin count",
          path: ["cost_kcoin"],
        });
      if (remaining !== 20 - spin_count)
        context.addIssue({
          code: "custom",
          message: "Remaining spins must match final spin count",
          path: ["remaining"],
        });
      if (
        milestone.milestone_10_claimed !== spin_count >= 10 ||
        milestone.milestone_20_claimed !== spin_count >= 20
      )
        context.addIssue({
          code: "custom",
          message: "Milestone state must match final spin count",
          path: ["milestone"],
        });
      const totals = rewards.reduce(
        (value, reward) => {
          value[reward.kind] += reward.amount;
          if (reward.replaced_kind)
            value[
              reward.replaced_kind === "free_normal_box"
                ? "replaced_free_normal_box"
                : "replaced_free_rare_box"
            ] += 1;
          return value;
        },
        {
          fgems: 0,
          kcoin: 0,
          free_normal_box: 0,
          free_rare_box: 0,
          replaced_free_normal_box: 0,
          replaced_free_rare_box: 0,
        },
      );
      if (
        Object.entries(totals).some(
          ([kind, amount]) =>
            reward_summary[kind as keyof typeof reward_summary] !== amount,
        ) ||
        kcoin_returned !== totals.kcoin
      )
        context.addIssue({
          code: "custom",
          message: "Reward summary must match ordered rewards",
          path: ["reward_summary"],
        });
    },
  );

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
    id: "wheel.recovery",
    method: "GET",
    path: "/api/wheel/recovery",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z.object({ operations: z.array(operationSummarySchema) }).strict(),
    errors: ["SESSION_REQUIRED", "ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "wheel.acknowledge_result",
    method: "POST",
    path: "/api/wheel/results/:operation_id/acknowledge",
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
    id: "wheel.spin",
    method: "POST",
    path: "/api/wheel/spins",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets"],
    input: z.object({ count: z.union([z.literal(1), z.literal(10)]) }).strict(),
    output: wheelSpinOutputSchema,
    errors: [
      "WHEEL_COUNT_INVALID",
      "WHEEL_DAILY_LIMIT",
      "INSUFFICIENT_BALANCE",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
