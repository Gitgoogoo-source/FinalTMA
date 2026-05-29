import type { SupabaseAdminClient } from "../db/supabaseAdmin.js";
import {
  LEGACY_OPS_FEATURE_FLAGS,
  OPS_FEATURE_FLAGS,
  readFeatureFlagEnv,
  readOpsFeatureFlag,
} from "../ops/featureFlags.js";
import { BackendOperationGuardError } from "../payments/paymentGuards.js";

export interface WalletSyncGuardOptions {
  env?: NodeJS.ProcessEnv | undefined;
  client?: SupabaseAdminClient | undefined;
}

export async function assertWalletSyncEnabled(
  options: WalletSyncGuardOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const walletDecision = await readOpsFeatureFlag({
    key: OPS_FEATURE_FLAGS.WALLET,
    fallbackKeys: [LEGACY_OPS_FEATURE_FLAGS.WALLET_TON_CONNECT],
    envName: "FEATURE_WALLET_ENABLED",
    defaultEnabled: true,
    client: options.client,
    env,
  });
  const syncDecision = await readOpsFeatureFlag({
    key: OPS_FEATURE_FLAGS.WALLET_SYNC,
    envName: "FEATURE_WALLET_SYNC_ENABLED",
    defaultEnabled: true,
    client: options.client,
    env,
  });
  const serverSwitchEnabled =
    readFeatureFlagEnv("WALLET_SYNC_ENABLED", env) ?? true;

  if (
    !walletDecision.enabled ||
    !syncDecision.enabled ||
    !serverSwitchEnabled
  ) {
    throw new BackendOperationGuardError(
      503,
      "FEATURE_WALLET_SYNC_DISABLED",
      "钱包 NFT 同步暂未开放。",
      {
        details: {
          walletFlagKey: walletDecision.key,
          walletFlagSource: walletDecision.source,
          syncFlagKey: syncDecision.key,
          syncFlagSource: syncDecision.source,
          walletSyncEnabled: serverSwitchEnabled,
        },
      },
    );
  }
}
