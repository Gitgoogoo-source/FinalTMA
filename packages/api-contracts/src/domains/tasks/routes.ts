import { z } from "zod";

import { defineRoute } from "../../common/route.ts";
import { emptyObjectSchema } from "../../common/schemas.ts";

export const taskCodeSchema = z.enum([
  "gacha_1",
  "gacha_10",
  "gacha_ten",
  "wheel_spin",
  "copy_referral",
  "telegram_invite",
  "market_buy",
  "market_list",
  "market_sold",
  "evolution_success",
  "evolution_attempt",
  "decompose",
  "expedition_normal",
  "expedition_intermediate",
  "expedition_advanced",
  "album_unlock",
  "album_chain",
  "wallet_verified",
  "mint_success",
]);
export const taskCategorySchema = z.enum([
  "gacha",
  "daily",
  "social",
  "market",
  "inventory",
  "expedition",
  "album",
  "wallet",
  "mint",
]);
export const taskStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "claimable",
  "claimed",
]);
export const taskCompletionActionSchema = z.enum([
  "gacha_single",
  "gacha_ten",
  "wheel",
  "referral_copy",
  "referral_telegram",
  "market_buy",
  "market_sell",
  "market_manage",
  "inventory_evolution",
  "inventory_decomposition",
  "expedition_normal",
  "expedition_intermediate",
  "expedition_advanced",
  "album",
  "wallet",
  "inventory_mint",
]);

const taskSchema = z
  .object({
    code: taskCodeSchema,
    order: z.number().int().min(1).max(19),
    category: taskCategorySchema,
    title: z.string().min(1),
    description: z.string().min(1),
    completion_action: taskCompletionActionSchema,
    target: z.number().int().positive(),
    progress: z.number().int().min(0),
    reward_fgems: z.number().int().positive(),
    status: taskStatusSchema,
  })
  .strict();
const checkinSchema = z
  .object({
    next_day: z.number().int().min(1).max(7),
    claimed_today: z.boolean(),
    cycle_progress: z.number().int().min(0).max(7),
  })
  .strict();

export const taskRoutes = [
  defineRoute({
    id: "tasks.get",
    method: "GET",
    path: "/api/tasks",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: z
      .object({
        tasks: z
          .array(taskSchema)
          .length(19)
          .superRefine((tasks, context) => {
            const codes = new Set(tasks.map((task) => task.code));
            if (codes.size !== 19)
              context.addIssue({
                code: "custom",
                message: "Task response must contain every fixed code once",
              });
            tasks.forEach((task, index) => {
              if (task.order !== index + 1)
                context.addIssue({
                  code: "custom",
                  message: "Tasks must follow the fixed order",
                  path: [index, "order"],
                });
              if (task.progress > task.target)
                context.addIssue({
                  code: "custom",
                  message: "Task progress cannot exceed target",
                  path: [index, "progress"],
                });
              const expectedStatus =
                task.progress === 0
                  ? "not_started"
                  : task.progress < task.target
                    ? "in_progress"
                    : "claimable";
              if (task.status !== "claimed" && task.status !== expectedStatus)
                context.addIssue({
                  code: "custom",
                  message: "Task status must match progress",
                  path: [index, "status"],
                });
              if (task.status === "claimed" && task.progress !== task.target)
                context.addIssue({
                  code: "custom",
                  message: "Claimed task progress must equal target",
                  path: [index, "progress"],
                });
            });
          }),
        checkin: checkinSchema,
      })
      .strict(),
    errors: ["ACCOUNT_RESTRICTED", "INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "tasks.check_in",
    method: "POST",
    path: "/api/tasks/check-in",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets"],
    input: emptyObjectSchema,
    output: z
      .object({
        day: z.number().int().min(1).max(7),
        reward_kind: z.enum(["fgems", "free_rare_box"]),
        reward_amount: z.number().int().positive(),
        claimed: z.literal(true),
      })
      .strict(),
    errors: [
      "CHECKIN_ALREADY_CLAIMED",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "tasks.claim",
    method: "POST",
    path: "/api/tasks/:task_code/claim",
    gateway: "app",
    auth: true,
    idempotent: true,
    refreshScopes: ["assets"],
    input: z.object({ task_code: taskCodeSchema }).strict(),
    output: z
      .object({
        task_code: taskCodeSchema,
        reward_fgems: z.number().int().positive(),
        claimed: z.literal(true),
      })
      .strict(),
    errors: [
      "TASK_NOT_FOUND",
      "TASK_NOT_COMPLETE",
      "TASK_ALREADY_CLAIMED",
      "IDEMPOTENCY_KEY_REUSED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
