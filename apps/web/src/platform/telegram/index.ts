import { useEffect } from "react";

let listening = false;
const TELEGRAM_MOBILE_CONTROLS_HEIGHT = 44;
const APP_CANVAS_COLOR = "#fffdfa";

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

export function selectionHaptic(): void {
  const feedback = telegram()?.HapticFeedback;
  if (feedback?.selectionChanged)
    attemptTelegramMethod(() => feedback.selectionChanged?.());
}

export function sharePreparedMessage(
  messageId: string,
  callback?: (shared: boolean) => void,
): boolean {
  const app = telegram();
  if (!app?.shareMessage || !messageId) return false;
  try {
    app.shareMessage(messageId, callback);
    return true;
  } catch {
    return false;
  }
}

export type TelegramShareFailure =
  | "UNSUPPORTED"
  | "MESSAGE_EXPIRED"
  | "MESSAGE_SEND_FAILED"
  | "USER_DECLINED"
  | "UNKNOWN_ERROR";

export function supportsPreparedMessageSharing(): boolean {
  return typeof telegram()?.shareMessage === "function";
}

export function subscribeTelegramActivity(
  activated: () => void,
  deactivated: () => void,
): () => void {
  const app = telegram();
  if (!app) return () => undefined;
  app.onEvent("activated", activated);
  app.onEvent("deactivated", deactivated);
  return () => {
    app.offEvent("activated", activated);
    app.offEvent("deactivated", deactivated);
  };
}

export function subscribePreparedMessageShareEvents(
  sent: () => void,
  failed: (error: TelegramShareFailure) => void,
): () => void {
  const app = telegram();
  if (!app) return () => undefined;
  const onFailure = (payload: { error: TelegramShareFailure }) =>
    failed(payload.error);
  app.onEvent("shareMessageSent", sent);
  app.onEvent("shareMessageFailed", onFailure);
  return () => {
    app.offEvent("shareMessageSent", sent);
    app.offEvent("shareMessageFailed", onFailure);
  };
}
