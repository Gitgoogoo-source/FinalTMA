import { z } from "zod";

import { defineRoute } from "../../common/route.ts";
import { emptyObjectSchema, identifierSchema } from "../../common/schemas.ts";

const taskSchema = z
  .object({
    code: z.string(),
    order: z.number().int().positive(),
    category: z.string(),
    name: z.string(),
    target: z.number().int().positive(),
    progress: z.number().int().min(0),
    reward_fgems: z.number().int().positive(),
    claimed: z.boolean(),
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
      .object({ tasks: z.array(taskSchema).length(19), checkin: checkinSchema })
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
    input: z.object({ task_code: identifierSchema }).strict(),
    output: z
      .object({
        task_code: z.string(),
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
