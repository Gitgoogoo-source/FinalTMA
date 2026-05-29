import type { SupabaseAdminClient } from "../db/supabaseAdmin.js";
import {
  LEGACY_OPS_FEATURE_FLAGS,
  OPS_FEATURE_FLAGS,
  readOpsFeatureFlag,
} from "../ops/featureFlags.js";
import { BackendOperationGuardError } from "../payments/paymentGuards.js";

export interface MarketGuardOptions {
  env?: NodeJS.ProcessEnv | undefined;
  client?: SupabaseAdminClient | undefined;
}

export async function assertMarketWriteAllowed(
  options: MarketGuardOptions = {},
): Promise<void> {
  const decision = await readOpsFeatureFlag({
    key: OPS_FEATURE_FLAGS.MARKET,
    fallbackKeys: [LEGACY_OPS_FEATURE_FLAGS.MARKET],
    envName: "FEATURE_MARKET_ENABLED",
    defaultEnabled: true,
    client: options.client,
    env: options.env,
  });

  if (!decision.enabled) {
    throw new BackendOperationGuardError(
      503,
      "FEATURE_MARKET_DISABLED",
      "市场暂时暂停。",
      {
        expose: true,
        details: {
          flagKey: decision.key,
          source: decision.source,
        },
      },
    );
  }
}
