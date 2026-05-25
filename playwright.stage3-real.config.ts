import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.STAGE3_REAL_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const supabaseUrl = requireLocalSupabaseUrl(
  process.env.STAGE3_REAL_E2E_SUPABASE_URL,
);
const supabaseAnonKey = requireEnv("STAGE3_REAL_E2E_SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = requireEnv(
  "STAGE3_REAL_E2E_SUPABASE_SERVICE_ROLE_KEY",
);
const botToken =
  process.env.STAGE3_REAL_E2E_BOT_TOKEN ??
  "123456789:stage3-real-e2e-bot-token";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /inventory-growth\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx tsx scripts/run-stage3-real-vercel-dev.ts",
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
      APP_SESSION_SECRET: "stage3-real-e2e-session-secret-000001",
      DRAW_RANDOM_SECRET: "stage3-real-e2e-draw-random-secret-0001",
      CRON_SECRET: "stage3-real-e2e-cron-secret-000001",
      TELEGRAM_BOT_TOKEN: botToken,
      TELEGRAM_BOT_USERNAME: "stage3_real_e2e_bot",
      TELEGRAM_MINI_APP_SHORT_NAME: "stage3_real_e2e",
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
      VITE_APP_ENV: "test",
      VITE_TMA_ENV: "test",
      VITE_PUBLIC_BASE_URL: baseURL,
      VITE_API_BASE_URL: "/api",
      VITE_TELEGRAM_BOT_USERNAME: "stage3_real_e2e_bot",
      VITE_TG_BOT_USERNAME: "stage3_real_e2e_bot",
      VITE_TELEGRAM_MINI_APP_SHORT_NAME: "stage3_real_e2e",
      VITE_ENABLE_MOCKS: "true",
      VITE_ENABLE_TON_CONNECT: "false",
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
    throw new Error(`${name} is required for Stage 3 real E2E tests.`);
  }

  return value;
}

function requireLocalSupabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error(
      "STAGE3_REAL_E2E_SUPABASE_URL is required for Stage 3 real E2E tests.",
    );
  }

  const url = new URL(value);

  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error(
      `Stage 3 real E2E tests refuse non-local Supabase URL: ${url.origin}`,
    );
  }

  return value;
}
