import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
type FeatureFlagRows = Record<string, boolean>;

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, ORIGINAL_ENV);
}

function prepareEnvImport(): void {
  restoreEnv();
  vi.resetModules();

  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_ENV: "test",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "s".repeat(32),
    TELEGRAM_BOT_TOKEN: "t".repeat(16),
    DRAW_RANDOM_SECRET: "d".repeat(32),
    ENABLE_CRON_API: "false",
  });
}

describe("server env validation", () => {
  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it("allows DEV_GACHA_PAYMENT_MODE in test environment", async () => {
    prepareEnvImport();

    const { serverEnvSchema } = await import("../../packages/server/src/env");
    const parsed = serverEnvSchema.safeParse({
      ...process.env,
      NODE_ENV: "test",
      APP_ENV: "test",
      DEV_GACHA_PAYMENT_MODE: "true",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects DEV_GACHA_PAYMENT_MODE in production-like environments", async () => {
    prepareEnvImport();

    const { serverEnvSchema } = await import("../../packages/server/src/env");
    const parsed = serverEnvSchema.safeParse({
      ...process.env,
      NODE_ENV: "production",
      APP_ENV: "production",
      VERCEL_ENV: "production",
      PUBLIC_APP_URL: "https://example.test",
      APP_SESSION_SECRET: "a".repeat(32),
      SESSION_COOKIE_SECURE: "true",
      TELEGRAM_WEBHOOK_URL: "https://example.test/api/telegram/webhook",
      TELEGRAM_WEBHOOK_SECRET: "w".repeat(16),
      ENABLE_CRON_API: "false",
      DEV_GACHA_PAYMENT_MODE: "true",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["DEV_GACHA_PAYMENT_MODE"],
            message: "DEV_GACHA_PAYMENT_MODE must be disabled in production.",
          }),
        ]),
      );
    }
  });

  it("rejects production-like payment env without a Telegram bot token", async () => {
    prepareEnvImport();

    const { serverEnvSchema } = await import("../../packages/server/src/env");
    const envWithoutBotToken: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      APP_ENV: "production",
      VERCEL_ENV: "production",
      PUBLIC_APP_URL: "https://example.test",
      APP_SESSION_SECRET: "a".repeat(32),
      SESSION_COOKIE_SECURE: "true",
      TELEGRAM_WEBHOOK_URL: "https://example.test/api/telegram/webhook",
      TELEGRAM_WEBHOOK_SECRET: "w".repeat(16),
      DEV_GACHA_PAYMENT_MODE: "false",
      ENABLE_CRON_API: "false",
    };
    delete envWithoutBotToken.TELEGRAM_BOT_TOKEN;

    const parsed = serverEnvSchema.safeParse(envWithoutBotToken);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["TELEGRAM_BOT_TOKEN"],
          }),
        ]),
      );
    }
  });

  it("validates Phase 5 server feature flags and operational settings", async () => {
    prepareEnvImport();

    const { serverEnvSchema } = await import("../../packages/server/src/env");
    const parsed = serverEnvSchema.safeParse({
      ...process.env,
      FEATURE_STARS_PAYMENT_ENABLED: "true",
      FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED: "true",
      TELEGRAM_WEBHOOK_SECRET: "w".repeat(16),
      STARS_OPEN_ORDER_EXPIRES_MINUTES: "15",
      PAYMENT_WEBHOOK_IDEMPOTENCY_TTL_SECONDS: "86400",
      TON_API_BASE_URL: "https://testnet.tonapi.io",
      TONCENTER_API_KEY: "c".repeat(16),
      TON_PROOF_TTL_SECONDS: "300",
      TON_PROOF_CHALLENGE_BYTES: "32",
      TON_MINT_BATCH_SIZE: "10",
      TON_MINT_RETRY_DELAY_SECONDS: "60",
      TON_MINT_CONFIRMATION_TIMEOUT_SECONDS: "300",
      NFT_METADATA_BASE_URL: "https://example.test/nft-metadata",
      NFT_COLLECTION_METADATA_URI:
        "https://example.test/nft-metadata/collection.json",
      NFT_ITEM_METADATA_BASE_URI: "https://example.test/nft-metadata/items",
      WALLET_SYNC_ENABLED: "true",
      FEATURE_WALLET_SYNC_ENABLED: "true",
      FEATURE_ADMIN_PAYMENT_OPS_ENABLED: "false",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.FEATURE_STARS_PAYMENT_ENABLED).toBe(true);
      expect(parsed.data.FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED).toBe(
        true,
      );
      expect(parsed.data.TON_PROOF_CHALLENGE_BYTES).toBe(32);
      expect(parsed.data.WALLET_SYNC_ENABLED).toBe(true);
    }
  });

  it("requires TON_MINT_ENABLED before enabling the mint worker flag", async () => {
    prepareEnvImport();

    const { serverEnvSchema } = await import("../../packages/server/src/env");
    const parsed = serverEnvSchema.safeParse({
      ...process.env,
      FEATURE_MINT_WORKER_ENABLED: "true",
      TON_MINT_ENABLED: "false",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["FEATURE_MINT_WORKER_ENABLED"],
            message:
              "FEATURE_MINT_WORKER_ENABLED requires TON_MINT_ENABLED=true on the server.",
          }),
        ]),
      );
    }
  });

  it("allows provider-based Mint configuration without a local minter key outside production", async () => {
    prepareEnvImport();

    const { serverEnvSchema } = await import("../../packages/server/src/env");
    const parsed = serverEnvSchema.safeParse({
      ...process.env,
      TON_MINT_ENABLED: "true",
      TON_COLLECTION_ADDRESS: `0:${"3".repeat(64)}`,
      TON_MINTER_PRIVATE_KEY: "",
      TON_MINTER_MNEMONIC: "",
      TON_MINTER_WALLET_ADDRESS: "",
      TON_MINT_PROVIDER_URL: "https://mint-provider.example.test/ton/mint",
      FEATURE_MINT_WORKER_ENABLED: "true",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects production payment operations when required server secrets are missing", async () => {
    prepareEnvImport();

    const { assertProductionPaymentEnv } =
      await import("../../packages/server/src/payments/paymentGuards");

    expect(() =>
      assertProductionPaymentEnv({
        NODE_ENV: "production",
        APP_ENV: "production",
        VERCEL_ENV: "production",
        DEV_GACHA_PAYMENT_MODE: "false",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "PAYMENT_SERVER_CONFIG_INVALID",
        statusCode: 503,
      }),
    );
  });

  it("rejects Stars payment creation when the server feature flag is false", async () => {
    prepareEnvImport();

    const { assertStarsPaymentCreateAllowed } =
      await import("../../packages/server/src/payments/paymentGuards");

    await expect(
      assertStarsPaymentCreateAllowed({
        env: {
          NODE_ENV: "test",
          APP_ENV: "test",
          FEATURE_STARS_PAYMENT_ENABLED: "false",
        },
      }),
    ).rejects.toMatchObject({
      code: "FEATURE_STARS_PAYMENT_DISABLED",
      statusCode: 503,
      message: "Stars 支付暂未开放。",
    });
  });

  it("uses the Phase 5 database key when guarding Stars payment creation", async () => {
    prepareEnvImport();

    const { assertStarsPaymentCreateAllowed } =
      await import("../../packages/server/src/payments/paymentGuards");
    const client = createFeatureFlagClient({
      FEATURE_STARS_PAYMENT_ENABLED: false,
      "gacha.open_box": true,
    });

    await expect(
      assertStarsPaymentCreateAllowed({
        env: {
          NODE_ENV: "test",
          APP_ENV: "test",
          FEATURE_STARS_PAYMENT_ENABLED: "true",
        },
        client,
      }),
    ).rejects.toMatchObject({
      code: "FEATURE_STARS_PAYMENT_DISABLED",
      details: {
        flagKey: "FEATURE_STARS_PAYMENT_ENABLED",
        source: "database",
      },
    });
  });

  it("falls back to the legacy Stars payment database key when the Phase 5 key is missing", async () => {
    prepareEnvImport();

    const { assertStarsPaymentCreateAllowed } =
      await import("../../packages/server/src/payments/paymentGuards");
    const client = createFeatureFlagClient({
      "gacha.open_box": false,
    });

    await expect(
      assertStarsPaymentCreateAllowed({
        env: {
          NODE_ENV: "test",
          APP_ENV: "test",
          FEATURE_STARS_PAYMENT_ENABLED: "true",
        },
        client,
      }),
    ).rejects.toMatchObject({
      code: "FEATURE_STARS_PAYMENT_DISABLED",
      details: {
        flagKey: "gacha.open_box",
        source: "database",
      },
    });
  });

  it("uses the Phase 5 database key when guarding webhook fulfillment", async () => {
    prepareEnvImport();

    const { assertPaymentWebhookFulfillmentAllowed } =
      await import("../../packages/server/src/payments/paymentGuards");
    const client = createFeatureFlagClient({
      FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED: false,
    });

    await expect(
      assertPaymentWebhookFulfillmentAllowed({
        env: {
          NODE_ENV: "test",
          APP_ENV: "test",
          FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED: "true",
        },
        client,
      }),
    ).rejects.toMatchObject({
      code: "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_DISABLED",
      details: {
        flagKey: "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
        source: "database",
      },
    });
  });

  it("rejects webhook fulfillment when the server feature flag is false", async () => {
    prepareEnvImport();

    const { assertPaymentWebhookFulfillmentAllowed } =
      await import("../../packages/server/src/payments/paymentGuards");

    await expect(
      assertPaymentWebhookFulfillmentAllowed({
        env: {
          NODE_ENV: "test",
          APP_ENV: "test",
          FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED: "false",
        },
      }),
    ).rejects.toMatchObject({
      code: "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_DISABLED",
      statusCode: 503,
      message: "支付发货暂时暂停。",
    });
  });

  it("rejects Mint API calls when the Mint feature flag is false", async () => {
    prepareEnvImport();

    const { assertMintApiEnabled } =
      await import("../../packages/server/src/ton/mintGuards");

    await expect(
      assertMintApiEnabled({
        env: {
          NODE_ENV: "test",
          APP_ENV: "test",
          FEATURE_TON_MINT_ENABLED: "false",
        },
      }),
    ).rejects.toMatchObject({
      code: "FEATURE_TON_MINT_DISABLED",
      statusCode: 503,
      message: "Mint 暂未开放。",
    });
  });

  it("uses the Phase 5 database key when guarding Mint API calls", async () => {
    prepareEnvImport();

    const { assertMintApiEnabled } =
      await import("../../packages/server/src/ton/mintGuards");
    const client = createFeatureFlagClient({
      FEATURE_TON_MINT_ENABLED: false,
      "onchain.mint": true,
    });

    await expect(
      assertMintApiEnabled({
        env: {
          NODE_ENV: "test",
          APP_ENV: "test",
          FEATURE_TON_MINT_ENABLED: "true",
          TON_MINT_ENABLED: "true",
        },
        client,
      }),
    ).rejects.toMatchObject({
      code: "FEATURE_TON_MINT_DISABLED",
      details: {
        flagKey: "FEATURE_TON_MINT_ENABLED",
        featureSource: "database",
      },
    });
  });

  it("falls back to the legacy Mint database key when the Phase 5 key is missing", async () => {
    prepareEnvImport();

    const { assertMintApiEnabled } =
      await import("../../packages/server/src/ton/mintGuards");
    const client = createFeatureFlagClient({
      "onchain.mint": false,
    });

    await expect(
      assertMintApiEnabled({
        env: {
          NODE_ENV: "test",
          APP_ENV: "test",
          FEATURE_TON_MINT_ENABLED: "true",
          TON_MINT_ENABLED: "true",
        },
        client,
      }),
    ).rejects.toMatchObject({
      code: "FEATURE_TON_MINT_DISABLED",
      details: {
        flagKey: "onchain.mint",
        featureSource: "database",
      },
    });
  });
});

function createFeatureFlagClient(rows: FeatureFlagRows) {
  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: (_column: string, key: string) => ({
            maybeSingle: async () => ({
              data:
                typeof rows[key] === "boolean"
                  ? {
                      enabled: rows[key],
                    }
                  : null,
              error: null,
            }),
          }),
        }),
      }),
    }),
  } as never;
}
