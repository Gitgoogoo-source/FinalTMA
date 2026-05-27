import type { SupabaseAdminClient } from "../db/supabaseAdmin.js";
import {
  LEGACY_OPS_FEATURE_FLAGS,
  OPS_FEATURE_FLAGS,
  readFeatureFlagEnv,
  readOpsFeatureFlag,
} from "../ops/featureFlags.js";
import { BackendOperationGuardError } from "../payments/paymentGuards.js";

export interface MintGuardOptions {
  env?: NodeJS.ProcessEnv | undefined;
  client?: SupabaseAdminClient | undefined;
}

export async function assertMintApiEnabled(
  options: MintGuardOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const featureDecision = await readOpsFeatureFlag({
    key: OPS_FEATURE_FLAGS.TON_MINT,
    fallbackKeys: [LEGACY_OPS_FEATURE_FLAGS.TON_MINT],
    envName: "FEATURE_TON_MINT_ENABLED",
    defaultEnabled: false,
    client: options.client,
    env,
  });
  const serverSwitchEnabled =
    readFeatureFlagEnv("TON_MINT_ENABLED", env) ?? false;

  if (!featureDecision.enabled || !serverSwitchEnabled) {
    throw new BackendOperationGuardError(
      503,
      "FEATURE_TON_MINT_DISABLED",
      "Mint 暂未开放。",
      {
        details: {
          flagKey: featureDecision.key,
          featureSource: featureDecision.source,
          tonMintEnabled: serverSwitchEnabled,
        },
      },
    );
  }
}

export async function assertMintWorkerEnabled(
  options: MintGuardOptions = {},
): Promise<void> {
  await assertMintApiEnabled(options);

  const env = options.env ?? process.env;
  const workerDecision = await readOpsFeatureFlag({
    key: OPS_FEATURE_FLAGS.MINT_WORKER,
    envName: "FEATURE_MINT_WORKER_ENABLED",
    defaultEnabled: false,
    client: options.client,
    env,
  });

  if (!workerDecision.enabled) {
    throw new BackendOperationGuardError(
      503,
      "FEATURE_MINT_WORKER_DISABLED",
      "Mint worker 暂未开放。",
      {
        details: {
          flagKey: workerDecision.key,
          source: workerDecision.source,
        },
      },
    );
  }

  if (!readMintWorkerSecret(env)) {
    throw new BackendOperationGuardError(
      503,
      "MINT_WORKER_CONFIG_INVALID",
      "Mint worker 配置不可用。",
      {
        expose: false,
        details: {
          missing: ["TON_MINTER_PRIVATE_KEY or TON_MINTER_MNEMONIC"],
        },
      },
    );
  }
}

export function readMintWorkerSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const privateKey = normalizeSecret(env.TON_MINTER_PRIVATE_KEY);
  const mnemonic = normalizeSecret(env.TON_MINTER_MNEMONIC);

  return privateKey ?? mnemonic;
}

function normalizeSecret(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
