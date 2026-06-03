import { callRpcRaw } from "../db/rpc.js";
import type { SupabaseAdminClient } from "../db/supabaseAdmin.js";

export const OPS_FEATURE_FLAGS = Object.freeze({
  STARS_PAYMENT: "FEATURE_STARS_PAYMENT_ENABLED",
  PAYMENT_WEBHOOK_FULFILLMENT: "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
  MARKET: "FEATURE_MARKET_ENABLED",
  WALLET: "FEATURE_WALLET_ENABLED",
  WALLET_PROOF: "FEATURE_WALLET_PROOF_ENABLED",
  WALLET_SYNC: "FEATURE_WALLET_SYNC_ENABLED",
  TON_MINT: "FEATURE_TON_MINT_ENABLED",
  MINT_WORKER: "FEATURE_MINT_WORKER_ENABLED",
} as const);

export const LEGACY_OPS_FEATURE_FLAGS = Object.freeze({
  STARS_PAYMENT: "gacha.open_box",
  MARKET: "market.enabled",
  WALLET_TON_CONNECT: "wallet.ton_connect",
  TON_MINT: "onchain.mint",
} as const);

export type OpsFeatureFlagKey =
  | (typeof OPS_FEATURE_FLAGS)[keyof typeof OPS_FEATURE_FLAGS]
  | (typeof LEGACY_OPS_FEATURE_FLAGS)[keyof typeof LEGACY_OPS_FEATURE_FLAGS]
  | (string & {});

export type FeatureFlagSource = "env" | "database" | "default";

export interface OpsFeatureFlagDecision {
  key: OpsFeatureFlagKey;
  enabled: boolean;
  source: FeatureFlagSource;
  envName?: string | undefined;
}

export interface ReadOpsFeatureFlagOptions {
  key: OpsFeatureFlagKey;
  fallbackKeys?: readonly OpsFeatureFlagKey[] | undefined;
  envName?: string | undefined;
  defaultEnabled?: boolean | undefined;
  client?: SupabaseAdminClient | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

type FeatureFlagRow = {
  enabled: boolean;
};

type FeatureFlagRpcPayload = {
  found?: unknown;
  key?: unknown;
  enabled?: unknown;
};

export class FeatureFlagReadError extends Error {
  readonly statusCode = 503;
  readonly code = "OPS_FEATURE_FLAG_READ_FAILED";
  readonly expose = true;
  readonly details: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(
    message: string,
    options: {
      key: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "FeatureFlagReadError";
    this.details = {
      flagKey: options.key,
    };
    this.cause = options.cause;
  }
}

export async function readOpsFeatureFlag(
  options: ReadOpsFeatureFlagOptions,
): Promise<OpsFeatureFlagDecision> {
  const envValue = options.envName
    ? readFeatureFlagEnv(options.envName, options.env)
    : undefined;

  if (envValue !== undefined) {
    return {
      key: options.key,
      enabled: envValue,
      source: "env",
      envName: options.envName,
    };
  }

  try {
    const row = await readFeatureFlagRow(options.key, options.client);

    if (row) {
      return {
        key: options.key,
        enabled: row.enabled,
        source: "database",
        envName: options.envName,
      };
    }

    for (const fallbackKey of options.fallbackKeys ?? []) {
      const fallbackRow = await readFeatureFlagRow(fallbackKey, options.client);

      if (fallbackRow) {
        return {
          key: fallbackKey,
          enabled: fallbackRow.enabled,
          source: "database",
          envName: options.envName,
        };
      }
    }
  } catch (error) {
    if (envValue !== undefined) {
      return {
        key: options.key,
        enabled: envValue,
        source: "env",
        envName: options.envName,
      };
    }

    throw new FeatureFlagReadError("功能开关暂时不可用，请稍后重试。", {
      key: options.key,
      cause: error,
    });
  }

  if (envValue !== undefined) {
    return {
      key: options.key,
      enabled: envValue,
      source: "env",
      envName: options.envName,
    };
  }

  return {
    key: options.key,
    enabled: options.defaultEnabled ?? false,
    source: "default",
    envName: options.envName,
  };
}

export function readFeatureFlagEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  const value = env[name];

  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

async function readFeatureFlagRow(
  key: string,
  client?: SupabaseAdminClient | undefined,
): Promise<FeatureFlagRow | null> {
  const options = {
    schema: "api" as never,
    context: {
      source: "ops.feature_flag_read",
      flagKey: key,
    },
    ...(client ? { client } : {}),
  };
  const payload = await callRpcRaw<FeatureFlagRpcPayload>(
    "ops_read_feature_flag",
    {
      p_key: key,
    },
    options,
  );

  if (payload.found !== true || typeof payload.enabled !== "boolean") {
    return null;
  }

  return {
    enabled: payload.enabled,
  };
}
