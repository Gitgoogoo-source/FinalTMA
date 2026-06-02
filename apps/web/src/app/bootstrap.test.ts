import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TelegramGlobal, TelegramWebApp } from "@/types/telegram";

const globalWithTelegram = globalThis as TelegramGlobal;

describe("bootstrapTelegramApp", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete globalWithTelegram.Telegram;
    document.documentElement.removeAttribute("data-tg-shell");
    document.documentElement.removeAttribute("data-tg-fullscreen");
    document.documentElement.removeAttribute("data-tg-color-scheme");
    document.documentElement.removeAttribute("style");
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
    expect(webApp.disableVerticalSwipes).toHaveBeenCalledOnce();
    expect(webApp.requestFullscreen).toHaveBeenCalledOnce();
    expect(webApp.setHeaderColor).toHaveBeenCalledWith("#fffdfa");
    expect(webApp.setBackgroundColor).toHaveBeenCalledWith("#fffdfa");
    expect(webApp.setBottomBarColor).toHaveBeenCalledWith("#fffdfa");
  });

  it("disables Telegram vertical swipes on Bot API 7.7+ clients", async () => {
    const { bootstrapTelegramApp } = await import("./bootstrap");
    const webApp = installTelegramWebApp({
      version: "7.7",
      disableVerticalSwipes: vi.fn(),
    });

    bootstrapTelegramApp();

    expect(webApp.disableVerticalSwipes).toHaveBeenCalledOnce();
  });

  it("keeps old Telegram clients on their default vertical swipe behavior", async () => {
    const { bootstrapTelegramApp } = await import("./bootstrap");
    const webApp = installTelegramWebApp({
      version: "7.6",
      disableVerticalSwipes: vi.fn(),
    });

    bootstrapTelegramApp();

    expect(webApp.disableVerticalSwipes).not.toHaveBeenCalled();
  });

  it("marks the Telegram shell and safe area before the React provider renders", async () => {
    const { bootstrapTelegramApp } = await import("./bootstrap");

    installTelegramWebApp({
      colorScheme: "dark",
      contentSafeAreaInset: {
        top: 64,
        right: 10,
        bottom: 18,
        left: 8,
      },
      safeAreaInset: {
        top: 22,
        right: 4,
        bottom: 12,
        left: 4,
      },
    });

    bootstrapTelegramApp();

    const root = document.documentElement;

    expect(root.dataset.tgShell).toBe("telegram");
    expect(root.dataset.tgFullscreen).toBe("false");
    expect(root.dataset.tgColorScheme).toBe("dark");
    expect(root.style.getPropertyValue("--tg-safe-area-inset-top")).toBe("22px");
    expect(
      root.style.getPropertyValue("--tg-content-safe-area-inset-top"),
    ).toBe("64px");
    expect(
      root.style.getPropertyValue("--tg-content-safe-area-inset-right"),
    ).toBe("10px");
  });

  it("marks fullscreen Telegram shells so content can avoid overlay controls", async () => {
    const { bootstrapTelegramApp } = await import("./bootstrap");

    installTelegramWebApp({
      isFullscreen: true,
      contentSafeAreaInset: {
        top: 78,
        right: 0,
        bottom: 0,
        left: 0,
      },
    });

    bootstrapTelegramApp();

    const root = document.documentElement;

    expect(root.dataset.tgShell).toBe("telegram");
    expect(root.dataset.tgFullscreen).toBe("true");
    expect(
      root.style.getPropertyValue("--tg-content-safe-area-inset-top"),
    ).toBe("78px");
  });

  it("does not enable Telegram chrome fallback for ordinary web loads", async () => {
    const { bootstrapTelegramApp } = await import("./bootstrap");

    installTelegramWebApp({
      initData: "",
      platform: "unknown",
      safeAreaInset: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
      contentSafeAreaInset: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    });

    bootstrapTelegramApp();

    expect(document.documentElement.dataset.tgShell).toBe("web");
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
  disableVerticalSwipes: ReturnType<typeof vi.fn>;
  setBackgroundColor: ReturnType<typeof vi.fn>;
  setBottomBarColor: ReturnType<typeof vi.fn>;
  setHeaderColor: ReturnType<typeof vi.fn>;
} {
  const webApp = {
    colorScheme: "light",
    disableVerticalSwipes: vi.fn(),
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
    disableVerticalSwipes: ReturnType<typeof vi.fn>;
    setBackgroundColor: ReturnType<typeof vi.fn>;
    setBottomBarColor: ReturnType<typeof vi.fn>;
    setHeaderColor: ReturnType<typeof vi.fn>;
  };

  globalWithTelegram.Telegram = {
    WebApp: webApp,
  };

  return webApp;
}
