import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

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
});
