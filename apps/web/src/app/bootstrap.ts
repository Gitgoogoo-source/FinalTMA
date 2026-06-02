import {
  getTelegramWebApp,
  getTelegramWebView,
  type TelegramWebApp,
} from "@/types/telegram";

const VERTICAL_SWIPES_MIN_VERSION = "7.7";
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

  syncTelegramSafeArea(webApp);
  syncTelegramChromeColor(webApp);
  requestTelegramSafeAreas();
  webApp.ready?.();
  webApp.expand?.();
  disableTelegramVerticalSwipes(webApp);
  requestTelegramFullscreen(webApp);
}

export function requestTelegramSafeAreas(): void {
  const webView = getTelegramWebView();

  try {
    webView?.postEvent?.("web_app_request_safe_area");
    webView?.postEvent?.("web_app_request_content_safe_area");
  } catch {
    // Some injected test shells expose only WebApp; the layout still has CSS fallbacks.
  }
}

export function disableTelegramVerticalSwipes(webApp: TelegramWebApp): void {
  if (!supportsTelegramVerticalSwipes(webApp)) {
    return;
  }

  try {
    webApp.disableVerticalSwipes?.();
  } catch {
    // Older Telegram shells can expose partial APIs; leaving swipes enabled is the fallback.
  }
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

function supportsTelegramVerticalSwipes(webApp: TelegramWebApp): boolean {
  if (typeof webApp.disableVerticalSwipes !== "function") {
    return false;
  }

  if (typeof webApp.isVersionAtLeast === "function") {
    return webApp.isVersionAtLeast(VERTICAL_SWIPES_MIN_VERSION);
  }

  return isTelegramVersionAtLeast(webApp.version, VERTICAL_SWIPES_MIN_VERSION);
}

function syncTelegramChromeColor(webApp: TelegramWebApp): void {
  const chromeColor = resolveTelegramChromeColor(webApp);

  webApp.setHeaderColor?.(chromeColor);
  webApp.setBackgroundColor?.(chromeColor);
  webApp.setBottomBarColor?.(chromeColor);
}

function syncTelegramSafeArea(webApp: TelegramWebApp): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;

  applyInsetVariables(root, "--tg-safe-area", webApp.safeAreaInset);
  applyInsetVariables(root, "--tg-safe-area-inset", webApp.safeAreaInset);
  applyInsetVariables(
    root,
    "--tg-content-safe-area",
    webApp.contentSafeAreaInset,
  );
  applyInsetVariables(
    root,
    "--tg-content-safe-area-inset",
    webApp.contentSafeAreaInset,
  );
  root.dataset.tgShell = isTelegramChromeShell(webApp) ? "telegram" : "web";
  root.dataset.tgFullscreen = webApp.isFullscreen ? "true" : "false";
  root.dataset.tgColorScheme = webApp.colorScheme === "dark" ? "dark" : "light";
  root.dataset.tgPlatform = normalizeDatasetValue(webApp.platform) ?? "unknown";
  root.dataset.tgMobileShell = isTelegramMobileShell(webApp) ? "true" : "false";
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

function isTelegramChromeShell(webApp: TelegramWebApp): boolean {
  const platform = webApp.platform?.toLowerCase();

  return Boolean(
    normalizeOptionalString(webApp.initData) ||
    (platform && platform !== "unknown") ||
    hasInsetValue(webApp.safeAreaInset) ||
    hasInsetValue(webApp.contentSafeAreaInset),
  );
}

function isTelegramMobileShell(webApp: TelegramWebApp): boolean {
  const platform = webApp.platform?.toLowerCase();

  return (
    isTelegramChromeShell(webApp) &&
    Boolean(platform?.includes("ios") || platform?.includes("android"))
  );
}

function normalizeDatasetValue(value: string | undefined): string | null {
  const normalized = normalizeOptionalString(value)?.toLowerCase();

  return normalized?.replace(/[^a-z0-9_-]/g, "_") ?? null;
}

function applyInsetVariables(
  root: HTMLElement,
  prefix: string,
  inset: TelegramWebApp["safeAreaInset"],
): void {
  root.style.setProperty(
    `${prefix}-top`,
    `${normalizeInsetValue(inset?.top)}px`,
  );
  root.style.setProperty(
    `${prefix}-right`,
    `${normalizeInsetValue(inset?.right)}px`,
  );
  root.style.setProperty(
    `${prefix}-bottom`,
    `${normalizeInsetValue(inset?.bottom)}px`,
  );
  root.style.setProperty(
    `${prefix}-left`,
    `${normalizeInsetValue(inset?.left)}px`,
  );
}

function normalizeInsetValue(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function hasInsetValue(inset: TelegramWebApp["safeAreaInset"]): boolean {
  return Boolean(
    inset &&
    Object.values(inset).some(
      (value) =>
        typeof value === "number" && Number.isFinite(value) && value > 0,
    ),
  );
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
