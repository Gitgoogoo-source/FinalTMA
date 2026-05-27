import type { SupabaseAdminClient } from "../db/supabaseAdmin.js";
import {
  LEGACY_OPS_FEATURE_FLAGS,
  OPS_FEATURE_FLAGS,
  readFeatureFlagEnv,
  readOpsFeatureFlag,
} from "../ops/featureFlags.js";

export class BackendOperationGuardError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;
  readonly details?: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: {
      expose?: boolean | undefined;
      details?: Record<string, unknown> | undefined;
    } = {},
  ) {
    super(message);
    this.name = "BackendOperationGuardError";
    this.statusCode = statusCode;
    this.code = code;
    this.expose = options.expose ?? statusCode < 500;
    this.details = options.details;
  }
}

export interface PaymentGuardOptions {
  env?: NodeJS.ProcessEnv | undefined;
  client?: SupabaseAdminClient | undefined;
}

export async function assertStarsPaymentCreateAllowed(
  options: PaymentGuardOptions = {},
): Promise<void> {
  assertProductionPaymentEnv(options.env);

  const decision = await readOpsFeatureFlag({
    key: OPS_FEATURE_FLAGS.STARS_PAYMENT,
    fallbackKeys: [LEGACY_OPS_FEATURE_FLAGS.STARS_PAYMENT],
    envName: "FEATURE_STARS_PAYMENT_ENABLED",
    defaultEnabled: true,
    client: options.client,
    env: options.env,
  });

  if (!decision.enabled) {
    throw new BackendOperationGuardError(
      503,
      "FEATURE_STARS_PAYMENT_DISABLED",
      "Stars 支付暂未开放。",
      {
        details: {
          flagKey: decision.key,
          source: decision.source,
        },
      },
    );
  }
}

export function assertProductionPaymentEnv(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProductionLikeEnv(env)) {
    return;
  }

  if (readFeatureFlagEnv("DEV_GACHA_PAYMENT_MODE", env) === true) {
    throw new BackendOperationGuardError(
      503,
      "DEV_GACHA_PAYMENT_MODE_FORBIDDEN",
      "支付服务暂不可用。",
      {
        expose: false,
        details: {
          reason: "DEV_GACHA_PAYMENT_MODE must be disabled in production.",
        },
      },
    );
  }

  const missing = getMissingProductionPaymentEnv(env);

  if (missing.length > 0) {
    throw new BackendOperationGuardError(
      503,
      "PAYMENT_SERVER_CONFIG_INVALID",
      "支付服务暂不可用。",
      {
        expose: false,
        details: {
          missing,
        },
      },
    );
  }
}

export async function isPaymentWebhookFulfillmentEnabled(
  options: PaymentGuardOptions = {},
): Promise<boolean> {
  const decision = await readOpsFeatureFlag({
    key: OPS_FEATURE_FLAGS.PAYMENT_WEBHOOK_FULFILLMENT,
    envName: "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
    defaultEnabled: false,
    client: options.client,
    env: options.env,
  });

  return decision.enabled;
}

export async function assertPaymentWebhookFulfillmentAllowed(
  options: PaymentGuardOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  assertProductionPaymentEnv(env);

  const decision = await readOpsFeatureFlag({
    key: OPS_FEATURE_FLAGS.PAYMENT_WEBHOOK_FULFILLMENT,
    envName: "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
    defaultEnabled: false,
    client: options.client,
    env,
  });

  if (!decision.enabled) {
    throw new BackendOperationGuardError(
      503,
      "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_DISABLED",
      "支付发货暂时暂停。",
      {
        details: {
          flagKey: decision.key,
          source: decision.source,
        },
      },
    );
  }
}

export function getMissingProductionPaymentEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const missing: string[] = [];

  if (!hasEnvValue(env.TELEGRAM_BOT_TOKEN)) {
    missing.push("TELEGRAM_BOT_TOKEN");
  }

  if (
    !hasEnvValue(env.TELEGRAM_WEBHOOK_SECRET) &&
    !hasEnvValue(env.TELEGRAM_WEBHOOK_SECRET_TOKEN)
  ) {
    missing.push("TELEGRAM_WEBHOOK_SECRET");
  }

  if (
    !hasEnvValue(env.SUPABASE_SECRET_KEY) &&
    !hasEnvValue(env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    missing.push("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  }

  if (
    !hasEnvValue(env.APP_SESSION_SECRET) &&
    !hasEnvValue(env.SESSION_SECRET)
  ) {
    missing.push("APP_SESSION_SECRET");
  }

  return missing;
}

export function isProductionLikeEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.APP_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production"
  );
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
