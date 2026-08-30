import { z } from "zod";

import {
  assetsSchema,
  recoverableOperationListSchema,
  userSchema,
} from "../../common/models.ts";
import { defineRoute } from "../../common/route.ts";
import {
  emptyObjectSchema,
  nonNegativeBigintStringSchema,
  timestampSchema,
  uuidSchema,
} from "../../common/schemas.ts";
import { mintSchema } from "../mint/models.ts";
import { battleParticipationSchema } from "../battle/bootstrap-models.ts";
import { paymentSchema } from "../topup/models.ts";

const healthOutput = z
  .object({
    status: z.literal("ok"),
    service: z.literal("evomypet"),
    time: timestampSchema,
  })
  .strict();
export const identitySummarySchema = z
  .object({
    user: userSchema,
    assets: assetsSchema,
  })
  .strict();
export const identityRecoverySchema = z
  .object({
    authority_cursor: nonNegativeBigintStringSchema,
    blocking_operations: recoverableOperationListSchema,
    payment_recovery_orders: z.array(paymentSchema),
    pending_mints: z.array(mintSchema),
    battle_participation: battleParticipationSchema.nullable(),
  })
  .strict();
export const identityInitialSchema = z
  .object({
    summary: identitySummarySchema,
    recovery: identityRecoverySchema,
  })
  .strict();
const normalAuthOutput = z
  .object({
    account_status: z.literal("normal"),
    access_token: z.string().min(32),
    user_id: uuidSchema,
    preferred_language: z.enum(["en", "zh-CN"]),
    expires_at: timestampSchema,
    entry_handoff_state: z.enum(["pending", "complete"]),
    entry_kind: z.enum(["direct", "referral", "battle"]),
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
    initial_state: identityInitialSchema.nullable(),
  })
  .strict();
const bannedAuthOutput = z
  .object({ account_status: z.literal("banned") })
  .strict();
const authOutput = z.discriminatedUnion("account_status", [
  normalAuthOutput,
  bannedAuthOutput,
]);
const healthRoute = defineRoute({
  id: "health.get",
  method: "GET",
  path: "/api/health",
  gateway: "app",
  auth: false,
  idempotent: false,
  input: emptyObjectSchema,
  output: healthOutput,
  errors: ["INTERNAL_ERROR"],
});
const authenticateRoute = defineRoute({
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
    "SESSION_REQUIRED",
    "SESSION_EXPIRED",
    "SESSION_REPLACED",
    "ACCOUNT_RESTRICTED",
    "ENTRY_HANDOFF_PENDING",
    "INTERNAL_ERROR",
  ],
});
const initialRoute = defineRoute({
  id: "identity.initial",
  method: "GET",
  path: "/api/me/initial",
  gateway: "app",
  auth: true,
  idempotent: false,
  input: emptyObjectSchema,
  output: identityInitialSchema,
  errors: [
    "SESSION_REQUIRED",
    "SESSION_EXPIRED",
    "SESSION_REPLACED",
    "ACCOUNT_RESTRICTED",
    "INTERNAL_ERROR",
  ],
});
const summaryRoute = defineRoute({
  id: "identity.summary",
  method: "GET",
  path: "/api/me/summary",
  gateway: "app",
  auth: true,
  idempotent: false,
  input: emptyObjectSchema,
  output: identitySummarySchema,
  errors: [
    "SESSION_REQUIRED",
    "SESSION_EXPIRED",
    "SESSION_REPLACED",
    "ACCOUNT_RESTRICTED",
    "INTERNAL_ERROR",
  ],
});
const updateLanguageRoute = defineRoute({
  id: "identity.language.update",
  method: "POST",
  path: "/api/me/language",
  gateway: "app",
  auth: true,
  idempotent: false,
  forbidIdempotencyKey: true,
  refreshScopes: ["all"],
  input: z.object({ preferred_language: z.enum(["en", "zh-CN"]) }).strict(),
  output: z.object({ preferred_language: z.enum(["en", "zh-CN"]) }).strict(),
  errors: [
    "SESSION_REQUIRED",
    "SESSION_EXPIRED",
    "SESSION_REPLACED",
    "ENTRY_HANDOFF_PENDING",
    "ACCOUNT_RESTRICTED",
    "REQUEST_INVALID",
    "INTERNAL_ERROR",
  ],
});

export const identityFirstScreenRoutes = [
  authenticateRoute,
  initialRoute,
  summaryRoute,
  updateLanguageRoute,
] as const;

export const identityRoutes = [
  healthRoute,
  ...identityFirstScreenRoutes,
] as const;
