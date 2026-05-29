import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PHASE5_REAL_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = requireLocalSupabaseUrl(
  process.env.PHASE5_REAL_E2E_SUPABASE_URL,
);
const supabaseAnonKey = requireEnv("PHASE5_REAL_E2E_SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = requireEnv(
  "PHASE5_REAL_E2E_SUPABASE_SERVICE_ROLE_KEY",
);
const botToken =
  process.env.PHASE5_REAL_E2E_BOT_TOKEN ??
  "123456789:phase5-real-e2e-bot-token";

const collectionAddress =
  process.env.PHASE5_REAL_E2E_TON_COLLECTION_ADDRESS ??
  "0:1111111111111111111111111111111111111111111111111111111111111111";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /phase5-real\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx tsx scripts/run-phase5-real-vercel-dev.ts",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ENV: "test",
      NODE_ENV: "test",
      PUBLIC_APP_URL: baseURL,
      API_BASE_URL: `${baseURL}/api`,
      CORS_ALLOWED_ORIGINS: baseURL,
      SESSION_COOKIE_SECURE: "false",
      SESSION_COOKIE_SAMESITE: "lax",
      APP_SESSION_SECRET: "phase5-real-e2e-session-secret-000001",
      DRAW_RANDOM_SECRET: "phase5-real-e2e-draw-random-secret-0001",
      CRON_SECRET: "phase5-real-e2e-cron-secret-000001",
      TELEGRAM_BOT_TOKEN: botToken,
      TELEGRAM_BOT_USERNAME: "phase5_real_e2e_bot",
      TELEGRAM_MINI_APP_SHORT_NAME: "phase5_real_e2e",
      TELEGRAM_WEBHOOK_SECRET: "phase5-real-e2e-webhook-secret-0001",
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
      DEV_GACHA_PAYMENT_MODE: "true",
      FEATURE_STARS_PAYMENT_ENABLED: "true",
      FEATURE_TON_MINT_ENABLED: "true",
      FEATURE_WALLET_PROOF_ENABLED: "true",
      FEATURE_WALLET_SYNC_ENABLED: "true",
      TON_NETWORK: "mainnet",
      TON_PROOF_DOMAIN: "127.0.0.1",
      TON_COLLECTION_ADDRESS: collectionAddress,
      TON_MINT_ENABLED: "true",
      TON_MINT_PROVIDER_URL: "https://ton-mint-provider.example.test",
      VITE_APP_ENV: "test",
      VITE_TMA_ENV: "test",
      VITE_PUBLIC_BASE_URL: baseURL,
      VITE_API_BASE_URL: "/api",
      VITE_TELEGRAM_BOT_USERNAME: "phase5_real_e2e_bot",
      VITE_TG_BOT_USERNAME: "phase5_real_e2e_bot",
      VITE_TELEGRAM_MINI_APP_SHORT_NAME: "phase5_real_e2e",
      VITE_TONCONNECT_MANIFEST_URL: `${baseURL}/tonconnect-manifest.json`,
      VITE_ENABLE_MOCKS: "true",
      VITE_ENABLE_TON_CONNECT: "true",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for Phase 5 real E2E tests.`);
  }

  return value;
}

function requireLocalSupabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(
      "PHASE5_REAL_E2E_SUPABASE_URL is required for Phase 5 real E2E tests.",
    );
  }

  const url = new URL(value);

  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(
      `Phase 5 real E2E tests refuse non-local Supabase URL: ${url.origin}`,
    );
  }

  return value;
}
