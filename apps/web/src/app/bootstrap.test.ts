import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TelegramGlobal, TelegramWebApp } from "@/types/telegram";

const globalWithTelegram = globalThis as TelegramGlobal;

describe("bootstrapTelegramApp", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete globalWithTelegram.Telegram;
    vi.resetModules();
  });

  it("requests fullscreen on Telegram clients that support Bot API 8.0 fullscreen mode", async () => {
    const { bootstrapTelegramApp } = await import("./bootstrap");
    const webApp = installTelegramWebApp({
      version: "8.0",
      isVersionAtLeast: vi.fn(() => true),
      requestFullscreen: vi.fn(),
    });

    bootstrapTelegramApp();

    expect(webApp.ready).toHaveBeenCalledOnce();
    expect(webApp.expand).toHaveBeenCalledOnce();
    expect(webApp.requestFullscreen).toHaveBeenCalledOnce();
    expect(webApp.setHeaderColor).toHaveBeenCalledWith("#fffdfa");
    expect(webApp.setBackgroundColor).toHaveBeenCalledWith("#fffdfa");
    expect(webApp.setBottomBarColor).toHaveBeenCalledWith("#fffdfa");
  });

  it("falls back to expand when fullscreen is unavailable", async () => {
    const { bootstrapTelegramApp } = await import("./bootstrap");
    const webApp = installTelegramWebApp({
      version: "7.9",
      isVersionAtLeast: vi.fn(() => false),
      requestFullscreen: vi.fn(),
    });

    bootstrapTelegramApp();

    expect(webApp.ready).toHaveBeenCalledOnce();
    expect(webApp.expand).toHaveBeenCalledOnce();
    expect(webApp.requestFullscreen).not.toHaveBeenCalled();
  });

  it("does not request fullscreen more than once during repeated React initialization", async () => {
    const { bootstrapTelegramApp } = await import("./bootstrap");
    const webApp = installTelegramWebApp({
      version: "8.1",
      requestFullscreen: vi.fn(),
    });

    bootstrapTelegramApp();
    bootstrapTelegramApp();

    expect(webApp.expand).toHaveBeenCalledTimes(2);
    expect(webApp.requestFullscreen).toHaveBeenCalledOnce();
  });
});

function installTelegramWebApp(
  overrides: Partial<TelegramWebApp>,
): TelegramWebApp & {
  expand: ReturnType<typeof vi.fn>;
  ready: ReturnType<typeof vi.fn>;
  setBackgroundColor: ReturnType<typeof vi.fn>;
  setBottomBarColor: ReturnType<typeof vi.fn>;
  setHeaderColor: ReturnType<typeof vi.fn>;
} {
  const webApp = {
    colorScheme: "light",
    expand: vi.fn(),
    ready: vi.fn(),
    setBackgroundColor: vi.fn(),
    setBottomBarColor: vi.fn(),
    setHeaderColor: vi.fn(),
    themeParams: {},
    ...overrides,
  } as TelegramWebApp & {
    expand: ReturnType<typeof vi.fn>;
    ready: ReturnType<typeof vi.fn>;
    setBackgroundColor: ReturnType<typeof vi.fn>;
    setBottomBarColor: ReturnType<typeof vi.fn>;
    setHeaderColor: ReturnType<typeof vi.fn>;
  };

  globalWithTelegram.Telegram = {
    WebApp: webApp,
  };

  return webApp;
}
