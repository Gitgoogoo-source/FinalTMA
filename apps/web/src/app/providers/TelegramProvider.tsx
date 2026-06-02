import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { setupTelegramViewport } from "@/app/bootstrap";
import { env } from "@/env";
import {
  getTelegramWebApp,
  type TelegramColorScheme,
  type TelegramInitDataUnsafe,
  type TelegramSafeAreaInset,
  type TelegramThemeParams,
  type TelegramWebApp,
  type TelegramWebAppChat,
  type TelegramWebAppUser,
} from "@/types/telegram";

type TelegramLaunchSource =
  | "direct"
  | "start_param"
  | "referral"
  | "group"
  | "unknown";

type TelegramSnapshot = {
  webApp: TelegramWebApp | null;
  isTelegram: boolean;
  initData: string | null;
  initDataUnsafe: TelegramInitDataUnsafe;
  startParam: string | null;
  platform: string | null;
  version: string | null;
  colorScheme: TelegramColorScheme;
  themeParams: TelegramThemeParams;
  isExpanded: boolean;
  isFullscreen: boolean;
  viewportHeight: number | null;
  viewportStableHeight: number | null;
  safeAreaInset: Required<TelegramSafeAreaInset>;
  contentSafeAreaInset: Required<TelegramSafeAreaInset>;
  launchSource: TelegramLaunchSource;
  error: string | null;
};

type TelegramContextValue = TelegramSnapshot & {
  isReady: boolean;
  refreshTelegramSnapshot: () => void;
};

type TelegramProviderProps = {
  children: ReactNode;
};

type ResolveInitDataOptions = {
  isProduction: boolean;
  allowMockInitData: boolean;
  locationSearch?: string | undefined;
};

const EMPTY_INSET: Required<TelegramSafeAreaInset> = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

const TelegramContext = createContext<TelegramContextValue | null>(null);

export function TelegramProvider({ children }: TelegramProviderProps) {
  const [snapshot, setSnapshot] = useState<TelegramSnapshot>(() =>
    createTelegramSnapshot(getTelegramWebApp(), {
      isProduction: env.IS_PROD,
      allowMockInitData: env.FEATURES.MOCKS,
      locationSearch: getLocationSearch(),
    }),
  );
  const [isReady, setIsReady] = useState(false);

  const refreshTelegramSnapshot = useCallback(() => {
    setSnapshot(
      createTelegramSnapshot(getTelegramWebApp(), {
        isProduction: env.IS_PROD,
        allowMockInitData: env.FEATURES.MOCKS,
        locationSearch: getLocationSearch(),
      }),
    );
  }, []);

  useEffect(() => {
    const webApp = getTelegramWebApp();

    setupTelegramViewport(webApp);
    setIsReady(true);
    refreshTelegramSnapshot();

    if (!webApp?.onEvent || !webApp.offEvent) {
      return undefined;
    }

    const handleTelegramChange = () => {
      refreshTelegramSnapshot();
    };
    const events = [
      "themeChanged",
      "viewportChanged",
      "safeAreaChanged",
      "contentSafeAreaChanged",
      "fullscreenChanged",
      "fullscreenFailed",
    ] as const;

    for (const eventName of events) {
      webApp.onEvent(eventName, handleTelegramChange);
    }

    return () => {
      for (const eventName of events) {
        webApp.offEvent?.(eventName, handleTelegramChange);
      }
    };
  }, [refreshTelegramSnapshot]);

  useEffect(() => {
    applyTelegramCssVariables(snapshot);
  }, [snapshot]);

  const value = useMemo<TelegramContextValue>(
    () => ({
      ...snapshot,
      isReady,
      refreshTelegramSnapshot,
    }),
    [isReady, refreshTelegramSnapshot, snapshot],
  );

  return (
    <TelegramContext.Provider value={value}>
      {children}
    </TelegramContext.Provider>
  );
}

export function useTelegram(): TelegramContextValue {
  const value = useContext(TelegramContext);

  if (!value) {
    throw new Error("useTelegram must be used inside TelegramProvider.");
  }

  return value;
}

export function createTelegramSnapshot(
  webApp: TelegramWebApp | null,
  options: ResolveInitDataOptions,
): TelegramSnapshot {
  const initDataResult = resolveTelegramInitData(webApp, options);
  const initDataUnsafe =
    webApp?.initDataUnsafe ?? parseUnsafeFromInitData(initDataResult.initData);
  const startParam = normalizeOptionalString(
    webApp?.initDataUnsafe?.start_param ??
      getInitDataParam(initDataResult.initData, "start_param"),
  );
  const chatType = normalizeOptionalString(
    webApp?.initDataUnsafe?.chat_type ??
      getInitDataParam(initDataResult.initData, "chat_type"),
  );

  return {
    webApp,
    isTelegram: Boolean(webApp),
    initData: initDataResult.initData,
    initDataUnsafe,
    startParam,
    platform: normalizeOptionalString(webApp?.platform),
    version: normalizeOptionalString(webApp?.version),
    colorScheme: webApp?.colorScheme === "dark" ? "dark" : "light",
    themeParams: webApp?.themeParams ?? {},
    isExpanded: Boolean(webApp?.isExpanded),
    isFullscreen: Boolean(webApp?.isFullscreen),
    viewportHeight: normalizePositiveNumber(webApp?.viewportHeight),
    viewportStableHeight: normalizePositiveNumber(webApp?.viewportStableHeight),
    safeAreaInset: normalizeInset(webApp?.safeAreaInset),
    contentSafeAreaInset: normalizeInset(webApp?.contentSafeAreaInset),
    launchSource: resolveLaunchSource(startParam, chatType),
    error: initDataResult.error,
  };
}

export function resolveTelegramInitData(
  webApp: TelegramWebApp | null,
  options: ResolveInitDataOptions,
): { initData: string | null; error: string | null } {
  const webAppInitData = normalizeOptionalString(webApp?.initData);

  if (webAppInitData) {
    return {
      initData: webAppInitData,
      error: null,
    };
  }

  const urlInitData = resolveLocalInitDataFromUrl(options);

  if (urlInitData) {
    return {
      initData: urlInitData,
      error: null,
    };
  }

  return {
    initData: null,
    error: options.isProduction
      ? "请从 Telegram Mini App 打开应用。"
      : "缺少 Telegram initData；本地调试请使用 Telegram WebView 或启用 mock 后传入 tgWebAppData。",
  };
}

export function resolveLaunchSource(
  startParam: string | null,
  chatType: string | null,
): TelegramLaunchSource {
  if (startParam?.startsWith("ref_") || startParam?.startsWith("invite_")) {
    return "referral";
  }

  if (startParam) {
    return "start_param";
  }

  if (
    chatType === "group" ||
    chatType === "supergroup" ||
    chatType === "channel"
  ) {
    return "group";
  }

  if (chatType === "private" || chatType === "sender") {
    return "direct";
  }

  return "unknown";
}

function resolveLocalInitDataFromUrl(
  options: ResolveInitDataOptions,
): string | null {
  if (
    options.isProduction ||
    !options.allowMockInitData ||
    !options.locationSearch
  ) {
    return null;
  }

  const params = new URLSearchParams(options.locationSearch);
  const candidates = [
    params.get("tgWebAppData"),
    params.get("mockInitData"),
    params.get("telegramInitData"),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeOptionalString(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function parseUnsafeFromInitData(
  initData: string | null,
): TelegramInitDataUnsafe {
  if (!initData) {
    return {};
  }

  const user = parseJsonInitDataParam(initData, "user");
  const receiver = parseJsonInitDataParam(initData, "receiver");
  const chat = parseJsonInitDataParam(initData, "chat");
  const result: TelegramInitDataUnsafe = {};

  assignOptional(result, "query_id", getInitDataParam(initData, "query_id"));
  assignOptional(
    result,
    "start_param",
    getInitDataParam(initData, "start_param"),
  );
  assignOptional(result, "chat_type", getInitDataParam(initData, "chat_type"));
  assignOptional(
    result,
    "chat_instance",
    getInitDataParam(initData, "chat_instance"),
  );
  assignOptional(result, "hash", getInitDataParam(initData, "hash"));
  assignOptional(result, "signature", getInitDataParam(initData, "signature"));

  const authDate = Number(getInitDataParam(initData, "auth_date"));
  if (Number.isInteger(authDate) && authDate >= 0) {
    result.auth_date = authDate;
  }

  const canSendAfter = Number(getInitDataParam(initData, "can_send_after"));
  if (Number.isInteger(canSendAfter) && canSendAfter >= 0) {
    result.can_send_after = canSendAfter;
  }

  if (isRecord(user)) {
    result.user = user as TelegramWebAppUser;
  }

  if (isRecord(receiver)) {
    result.receiver = receiver as TelegramWebAppUser;
  }

  if (isRecord(chat)) {
    result.chat = chat as TelegramWebAppChat;
  }

  return result;
}

function getInitDataParam(initData: string | null, key: string): string | null {
  if (!initData) {
    return null;
  }

  try {
    return new URLSearchParams(initData).get(key);
  } catch {
    return null;
  }
}

function parseJsonInitDataParam(initData: string, key: string): unknown {
  const value = getInitDataParam(initData, key);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function assignOptional(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const normalized = normalizeOptionalString(value);

  if (normalized) {
    target[key] = normalized;
  }
}

function normalizeInset(
  input: TelegramSafeAreaInset | undefined,
): Required<TelegramSafeAreaInset> {
  return {
    top: normalizeInsetValue(input?.top),
    right: normalizeInsetValue(input?.right),
    bottom: normalizeInsetValue(input?.bottom),
    left: normalizeInsetValue(input?.left),
  };
}

function normalizeInsetValue(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function normalizePositiveNumber(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value);
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getLocationSearch(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.location.search;
}

function applyTelegramCssVariables(snapshot: TelegramSnapshot): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const themeEntries = Object.entries(snapshot.themeParams);

  for (const [key, value] of themeEntries) {
    if (typeof value === "string" && value.trim()) {
      root.style.setProperty(`--tg-theme-${key.replaceAll("_", "-")}`, value);
    }
  }

  applyInsetVariables(root, "--tg-safe-area", snapshot.safeAreaInset);
  applyInsetVariables(root, "--tg-safe-area-inset", snapshot.safeAreaInset);
  applyInsetVariables(
    root,
    "--tg-content-safe-area",
    snapshot.contentSafeAreaInset,
  );
  applyInsetVariables(
    root,
    "--tg-content-safe-area-inset",
    snapshot.contentSafeAreaInset,
  );
  root.dataset.tgShell = isTelegramChromeShell(snapshot) ? "telegram" : "web";
  root.dataset.tgFullscreen = snapshot.isFullscreen ? "true" : "false";
  root.dataset.tgColorScheme = snapshot.colorScheme;
}

function isTelegramChromeShell(snapshot: TelegramSnapshot): boolean {
  const platform = snapshot.platform?.toLowerCase();

  return Boolean(
    snapshot.initData ||
      (platform && platform !== "unknown") ||
      hasInsetValue(snapshot.safeAreaInset) ||
      hasInsetValue(snapshot.contentSafeAreaInset),
  );
}

function applyInsetVariables(
  root: HTMLElement,
  prefix: string,
  inset: Required<TelegramSafeAreaInset>,
): void {
  const entries =
    Object.entries(inset).length > 0
      ? Object.entries(inset)
      : Object.entries(EMPTY_INSET);

  for (const [key, value] of entries) {
    root.style.setProperty(`${prefix}-${key}`, `${value}px`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasInsetValue(inset: Required<TelegramSafeAreaInset>): boolean {
  return Object.values(inset).some((value) => value > 0);
}
