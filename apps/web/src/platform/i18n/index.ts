import { useSyncExternalStore } from "react";

export type AppLanguage = "en" | "zh-CN";
export type EnglishCatalogState = "loading" | "ready" | "failed";

type LoadedEnglishCatalog =
  (typeof import("./catalog.ts"))["loadedEnglishCatalog"];

const DEFAULT_LANGUAGE: AppLanguage = "en";
const STORAGE_PREFIX = "pokepets.language.v1";

let currentLanguage: AppLanguage = DEFAULT_LANGUAGE;
let currentTelegramId: string | null = null;
let englishCatalogState: EnglishCatalogState = "loading";
let englishCatalog: LoadedEnglishCatalog | null = null;
let englishCatalogTask: Promise<void> | null = null;
const listeners = new Set<() => void>();
const localizedObjects = new WeakMap<object, object>();

export function initializeLanguageHint(
  telegramId: string | number | undefined,
): void {
  const normalized = normalizeTelegramId(telegramId);
  currentTelegramId = normalized;
  const stored = normalized ? readLanguageHint(normalized) : null;
  applyLanguage(isAppLanguage(stored) ? stored : DEFAULT_LANGUAGE, false);
}

export function synchronizeAccountLanguage(language: AppLanguage): void {
  applyLanguage(language, true);
}

export function setAppLanguage(language: AppLanguage): void {
  applyLanguage(language, true);
}

export function getAppLanguage(): AppLanguage {
  return currentLanguage;
}

export function useAppLanguage(): AppLanguage {
  return useSyncExternalStore(
    subscribe,
    getAppLanguage,
    () => DEFAULT_LANGUAGE,
  );
}

export function useEnglishCatalogState(): EnglishCatalogState {
  return useSyncExternalStore(
    subscribe,
    () => englishCatalogState,
    () => "loading",
  );
}

export function loadEnglishCatalog(): Promise<void> {
  if (englishCatalogState === "ready") return Promise.resolve();
  if (englishCatalogTask) return englishCatalogTask;
  englishCatalogState = "loading";
  emitChange();
  englishCatalogTask = import("./catalog.ts")
    .then(({ loadedEnglishCatalog }) => {
      englishCatalog = loadedEnglishCatalog;
      englishCatalogState = "ready";
      emitChange();
    })
    .catch((cause: unknown) => {
      englishCatalogTask = null;
      englishCatalogState = "failed";
      emitChange();
      throw cause;
    });
  return englishCatalogTask;
}

export function t(source: string): string {
  if (currentLanguage === "zh-CN") return source;
  return (
    englishCatalog?.copy[source] ??
    englishCatalog?.gameContent(source) ??
    englishFallback(source)
  );
}

export function contentName(id: string, source: string): string {
  if (currentLanguage === "zh-CN") return source;
  return (
    englishCatalog?.gameContentById(id) ??
    englishCatalog?.gameContent(source) ??
    englishFallback(source, "PokePet")
  );
}

export function apiErrorMessage(code: string, source: string): string {
  if (currentLanguage === "zh-CN") return source;
  return (
    englishCatalog?.errors[code] ??
    englishCatalog?.copy[source] ??
    "Something went wrong. Please try again."
  );
}

export function tr(english: string, simplifiedChinese: string): string {
  return currentLanguage === "en" ? english : simplifiedChinese;
}

export function tp(
  source: string,
  values: readonly (string | number | bigint | null | undefined)[],
): string {
  return t(source).replace(/\{\{(\d+)\}\}/g, (placeholder, index: string) => {
    const value = values[Number(index)];
    return value === null || value === undefined ? placeholder : String(value);
  });
}

export function localized<T>(value: T): T {
  if (typeof value === "string") return t(value) as T;
  if (value === null || typeof value !== "object") return value;
  const existing = localizedObjects.get(value);
  if (existing) return existing as T;
  const proxy = new Proxy(value, {
    get(target, property, receiver) {
      return localized(Reflect.get(target, property, receiver));
    },
  });
  localizedObjects.set(value, proxy);
  return proxy;
}

export function formatNumber(value: number | bigint): string {
  return new Intl.NumberFormat(currentLanguage).format(value);
}

export function formatDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(currentLanguage, options).format(
    value instanceof Date ? value : new Date(value),
  );
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "en" || value === "zh-CN";
}

function applyLanguage(language: AppLanguage, persist: boolean): void {
  if (persist && currentTelegramId)
    writeLanguageHint(currentTelegramId, language);
  document.documentElement.lang = language;
  document.documentElement.dataset.language = language;
  if (currentLanguage === language) return;
  currentLanguage = language;
  emitChange();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange(): void {
  for (const listener of listeners) listener();
}

function englishFallback(source: string, fallback = "Loading"): string {
  return /[\p{Script=Han}]/u.test(source) ? fallback : source;
}

function storageKey(telegramId: string): string {
  return `${STORAGE_PREFIX}.${telegramId}`;
}

function readLanguageHint(telegramId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(telegramId));
  } catch {
    return null;
  }
}

function writeLanguageHint(telegramId: string, language: AppLanguage): void {
  try {
    window.localStorage.setItem(storageKey(telegramId), language);
  } catch {
    // The account preference remains authoritative when WebView storage is unavailable.
  }
}

function normalizeTelegramId(
  value: string | number | undefined,
): string | null {
  const normalized = String(value ?? "");
  return /^\d+$/.test(normalized) ? normalized : null;
}
