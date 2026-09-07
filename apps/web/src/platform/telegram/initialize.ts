import { telegram } from "./index.ts";

let listening = false;
const TELEGRAM_MOBILE_CONTROLS_HEIGHT = 44;
const APP_CANVAS_COLOR = "#fffdfa";

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
  const needsMobileControlsInset =
    app.platform === "ios" || app.platform === "android";
  const safeTop = safe?.top ?? 0;
  const reportedTop = Math.max(safeTop, content?.top ?? 0);
  document.documentElement.style.setProperty(
    "--tg-controls-inset-top",
    `${needsMobileControlsInset ? Math.max(0, safeTop + TELEGRAM_MOBILE_CONTROLS_HEIGHT - reportedTop) : 0}px`,
  );
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
  attemptTelegramMethod(() => app.setHeaderColor(APP_CANVAS_COLOR));
  attemptTelegramMethod(() => app.setBackgroundColor(APP_CANVAS_COLOR));
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", APP_CANVAS_COLOR);
}

function attemptTelegramMethod(action: () => void): void {
  try {
    action();
  } catch {
    // Telegram exposes unsupported methods on older clients and throws when called.
  }
}
