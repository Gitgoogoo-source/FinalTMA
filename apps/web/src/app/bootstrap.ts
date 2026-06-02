import { getTelegramWebApp, type TelegramWebApp } from "@/types/telegram";

const FULLSCREEN_MIN_VERSION = "8.0";
const DEFAULT_TMA_CHROME_COLOR = "#fffdfa";

let fullscreenRequestAttempted = false;

export function bootstrapTelegramApp(): void {
  const telegramWebApp = getTelegramWebApp();

  setupTelegramViewport(telegramWebApp);
}

export function setupTelegramViewport(webApp: TelegramWebApp | null): void {
  if (!webApp) {
    return;
  }

  syncTelegramChromeColor(webApp);
  webApp.ready?.();
  webApp.expand?.();
  requestTelegramFullscreen(webApp);
}

export function requestTelegramFullscreen(webApp: TelegramWebApp): void {
  if (
    fullscreenRequestAttempted ||
    webApp.isFullscreen ||
    !supportsTelegramFullscreen(webApp)
  ) {
    return;
  }

  fullscreenRequestAttempted = true;

  try {
    webApp.requestFullscreen?.();
  } catch {
    // Older Telegram shells can expose partial APIs; expand() above is the fallback.
  }
}

function syncTelegramChromeColor(webApp: TelegramWebApp): void {
  const chromeColor = resolveTelegramChromeColor(webApp);

  webApp.setHeaderColor?.(chromeColor);
  webApp.setBackgroundColor?.(chromeColor);
  webApp.setBottomBarColor?.(chromeColor);
}

function resolveTelegramChromeColor(webApp: TelegramWebApp): string {
  const candidates = [
    webApp.themeParams?.bg_color,
    webApp.themeParams?.secondary_bg_color,
    webApp.themeParams?.header_bg_color,
    webApp.themeParams?.bottom_bar_bg_color,
  ];

  return candidates.find(isHexColor) ?? DEFAULT_TMA_CHROME_COLOR;
}

function supportsTelegramFullscreen(webApp: TelegramWebApp): boolean {
  if (typeof webApp.requestFullscreen !== "function") {
    return false;
  }

  if (typeof webApp.isVersionAtLeast === "function") {
    return webApp.isVersionAtLeast(FULLSCREEN_MIN_VERSION);
  }

  return isTelegramVersionAtLeast(webApp.version, FULLSCREEN_MIN_VERSION);
}

function isTelegramVersionAtLeast(
  version: string | undefined,
  minimum: string,
): boolean {
  if (!version) {
    return false;
  }

  const currentParts = parseVersionParts(version);
  const minimumParts = parseVersionParts(minimum);
  const maxLength = Math.max(currentParts.length, minimumParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const current = currentParts[index] ?? 0;
    const required = minimumParts[index] ?? 0;

    if (current > required) {
      return true;
    }

    if (current < required) {
      return false;
    }
  }

  return true;
}

function parseVersionParts(version: string): number[] {
  return version.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);

    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function isHexColor(value: string | undefined): value is string {
  return /^#[\da-f]{6}$/i.test(value ?? "");
}
