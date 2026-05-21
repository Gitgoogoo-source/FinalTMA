import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "pnpm --filter @tma-game/web exec vite --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_APP_ENV: "test",
      VITE_TMA_ENV: "test",
      VITE_API_BASE_URL: "/api",
      VITE_TELEGRAM_BOT_USERNAME: "test_bot",
      VITE_TG_BOT_USERNAME: "test_bot",
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
