import { z } from "zod";

import {
  assetsSchema,
  mintSchema,
  operationSummarySchema,
  paymentSchema,
  userSchema,
} from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import {
  accountStatusSchema,
  emptyObjectSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";

const healthOutput = z
  .object({
    status: z.literal("ok"),
    service: z.literal("pokepets"),
    time: timestampSchema,
  })
  .strict();
const authOutput = z
  .object({
    access_token: z.string().min(32),
    user_id: uuidSchema,
    account_status: accountStatusSchema,
    expires_at: timestampSchema,
    start_param: z.string().nullable(),
  })
  .strict();
const bootstrapOutput = z
  .object({
    user: userSchema,
    assets: assetsSchema,
    entitlements: z
      .object({
        free_normal_box: z.number().int().min(0),
        free_rare_box: z.number().int().min(0),
      })
      .strict(),
    catalog_version: z.literal("v1"),
    blocking_operations: z.array(operationSummarySchema),
    pending_payments: z.array(paymentSchema),
    pending_mints: z.array(mintSchema),
    server_time: timestampSchema,
  })
  .strict();

export const identityRoutes = [
  defineRoute({
    id: "health.get",
    method: "GET",
    path: "/api/health",
    gateway: "app",
    auth: false,
    idempotent: false,
    input: emptyObjectSchema,
    output: healthOutput,
    errors: ["INTERNAL_ERROR"],
  }),
  defineRoute({
    id: "identity.authenticate",
    method: "POST",
    path: "/api/auth/telegram",
    gateway: "app",
    auth: false,
    idempotent: false,
    input: z.object({ init_data: z.string().min(1).max(16_384) }).strict(),
    output: authOutput,
    errors: [
      "TELEGRAM_INIT_DATA_INVALID",
      "TELEGRAM_INIT_DATA_EXPIRED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ],
  }),
  defineRoute({
    id: "identity.bootstrap",
    method: "GET",
    path: "/api/me/bootstrap",
    gateway: "app",
    auth: true,
    idempotent: false,
    input: emptyObjectSchema,
    output: bootstrapOutput,
    errors: [
      "SESSION_REQUIRED",
      "SESSION_EXPIRED",
      "SESSION_REPLACED",
      "ACCOUNT_RESTRICTED",
      "INTERNAL_ERROR",
    ],
  }),
] as const;
