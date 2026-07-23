import { useEffect } from "react";

let listening = false;

export function telegram(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function initializeTelegram(): TelegramWebApp | null {
  const app = telegram();
  if (!app) return null;
  app.ready();
  app.expand();
  attemptTelegramMethod(() => app.disableVerticalSwipes?.());
  syncTelegramLayout();
  if (!listening) {
    listening = true;
    for (const event of [
      "themeChanged",
      "safeAreaChanged",
      "contentSafeAreaChanged",
      "viewportChanged",
      "fullscreenChanged",
      "fullscreenFailed",
    ])
      app.onEvent(event, syncTelegramLayout);
  }
  if (!app.isFullscreen) attemptTelegramMethod(() => app.requestFullscreen?.());
  return app;
}

function syncTelegramLayout(): void {
  const app = telegram();
  if (!app) return;
  document.documentElement.dataset.theme = app.colorScheme;
  document.documentElement.style.colorScheme = app.colorScheme;
  for (const [name, value] of Object.entries(app.themeParams))
    document.documentElement.style.setProperty(
      `--tg-${name.replaceAll("_", "-")}`,
      value,
    );
  const safe = app.safeAreaInset;
  const content = app.contentSafeAreaInset;
  if (safe) {
    document.documentElement.style.setProperty(
      "--tg-safe-area-inset-top",
      `${safe.top}px`,
    );
    document.documentElement.style.setProperty(
      "--tg-safe-area-inset-right",
      `${safe.right}px`,
    );
    document.documentElement.style.setProperty(
      "--tg-safe-area-inset-bottom",
      `${safe.bottom}px`,
    );
    document.documentElement.style.setProperty(
      "--tg-safe-area-inset-left",
      `${safe.left}px`,
    );
  }
  if (content) {
    document.documentElement.style.setProperty(
      "--tg-content-safe-area-inset-top",
      `${content.top}px`,
    );
    document.documentElement.style.setProperty(
      "--tg-content-safe-area-inset-right",
      `${content.right}px`,
    );
    document.documentElement.style.setProperty(
      "--tg-content-safe-area-inset-bottom",
      `${content.bottom}px`,
    );
    document.documentElement.style.setProperty(
      "--tg-content-safe-area-inset-left",
      `${content.left}px`,
    );
  }
  if (app.viewportStableHeight)
    document.documentElement.style.setProperty(
      "--tg-viewport-stable-height",
      `${app.viewportStableHeight}px`,
    );
  const background =
    app.themeParams.bg_color ??
    (app.colorScheme === "light" ? "#ffffff" : "#0b1020");
  attemptTelegramMethod(() => app.setHeaderColor(background));
  attemptTelegramMethod(() => app.setBackgroundColor(background));
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", background);
}

function attemptTelegramMethod(action: () => void): void {
  try {
    action();
  } catch {
    // Telegram exposes unsupported methods on older clients and throws when called.
  }
}

export function useTelegramBackButton(
  enabled: boolean,
  callback: () => void,
): void {
  useEffect(() => {
    const button = telegram()?.BackButton;
    if (!button || !enabled) return;
    button.show();
    button.onClick(callback);
    return () => {
      button.offClick(callback);
      button.hide();
    };
  }, [callback, enabled]);
}

export function haptic(
  type: "error" | "success" | "warning" = "success",
): void {
  telegram()?.HapticFeedback?.notificationOccurred(type);
}
