import { z } from "zod";

import {
  assetsSchema,
  operationSummarySchema,
  userSchema,
} from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import {
  emptyObjectSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";
import { mintSchema } from "../mint/models.ts";
import { paymentSchema } from "../topup/models.ts";

const healthOutput = z
  .object({
    status: z.literal("ok"),
    service: z.literal("pokepets"),
    time: timestampSchema,
  })
  .strict();
const normalAuthOutput = z
  .object({
    account_status: z.literal("normal"),
    access_token: z.string().min(32),
    user_id: uuidSchema,
    expires_at: timestampSchema,
    entry_handoff_state: z.enum(["pending", "complete"]),
    entry_handoff_code: z
      .string()
      .regex(/^TMA[A-F0-9]{20}$/)
      .nullable(),
    entry_handoff_result: z
      .enum([
        "REFERRAL_BOUND",
        "REFERRAL_ALREADY_BOUND",
        "REFERRAL_ALREADY_RECHARGED",
        "REFERRAL_CANDIDATE_EXPIRED",
        "REFERRAL_CODE_INVALID",
        "REFERRAL_INELIGIBLE",
        "REFERRAL_INVITER_UNAVAILABLE",
        "REFERRAL_OLD_USER",
        "REFERRAL_SELF_BIND",
      ])
      .nullable(),
  })
  .strict();
const bannedAuthOutput = z
  .object({ account_status: z.literal("banned") })
  .strict();
const authOutput = z.discriminatedUnion("account_status", [
  normalAuthOutput,
  bannedAuthOutput,
]);
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
    idempotent: true,
    refreshScopes: ["session"],
    input: z.object({ init_data: z.string().min(1).max(16_384) }).strict(),
    output: authOutput,
    errors: [
      "TELEGRAM_INIT_DATA_INVALID",
      "TELEGRAM_INIT_DATA_EXPIRED",
      "TELEGRAM_INIT_DATA_TIME_INVALID",
      "TELEGRAM_START_PARAM_INVALID",
      "RATE_LIMITED",
      "IDEMPOTENCY_KEY_REUSED",
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
