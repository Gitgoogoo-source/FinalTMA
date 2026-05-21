import { z } from "zod";

/**
 * apps/web/src/env.ts
 *
 * 前端环境变量入口。
 *
 * 核心原则：
 * 1. 前端只能读取 VITE_ 开头的公开变量。
 * 2. 任何 Bot Token、Service Role Key、私钥、Webhook Secret 都不能出现在前端。
 * 3. 此文件只负责前端运行时配置，不负责业务计算。
 * 4. 前端环境变量可被用户在浏览器中看到，因此必须全部视为公开信息。
 */

declare global {
  interface ImportMetaEnv {
    readonly VITE_APP_NAME?: string;
    readonly VITE_APP_VERSION?: string;
    readonly VITE_APP_ENV?: string;

    readonly VITE_PUBLIC_BASE_URL?: string;
    readonly VITE_API_BASE_URL?: string;

    readonly VITE_TELEGRAM_BOT_USERNAME?: string;
    readonly VITE_TELEGRAM_MINI_APP_SHORT_NAME?: string;

    readonly VITE_TONCONNECT_MANIFEST_URL?: string;

    readonly VITE_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_ANON_KEY?: string;

    readonly VITE_SENTRY_DSN?: string;

    readonly VITE_ENABLE_MOCKS?: string;
    readonly VITE_ENABLE_TON_CONNECT?: string;
    readonly VITE_ENABLE_DEBUG_PANEL?: string;
    readonly VITE_ENABLE_SUPABASE_DIRECT_READS?: string;

    readonly VITE_REQUEST_TIMEOUT_MS?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

const APP_ENV_VALUES = [
  "local",
  "development",
  "preview",
  "production",
  "test",
] as const;

type AppEnv = (typeof APP_ENV_VALUES)[number];

const PUBLIC_BUILT_IN_ENV_KEYS = new Set([
  "MODE",
  "BASE_URL",
  "DEV",
  "PROD",
  "SSR",
]);

/**
 * 这些 key 绝不能通过 VITE_ 暴露到浏览器。
 *
 * 注意：
 * - VITE_SUPABASE_ANON_KEY 是公开 anon key，可以存在。
 * - SUPABASE_SERVICE_ROLE_KEY 绝不能存在于前端。
 */
const SAFE_PUBLIC_VITE_KEYS = new Set([
  "VITE_APP_NAME",
  "VITE_APP_VERSION",
  "VITE_APP_ENV",
  "VITE_PUBLIC_BASE_URL",
  "VITE_API_BASE_URL",
  "VITE_TELEGRAM_BOT_USERNAME",
  "VITE_TELEGRAM_MINI_APP_SHORT_NAME",
  "VITE_TONCONNECT_MANIFEST_URL",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_SENTRY_DSN",
  "VITE_ENABLE_MOCKS",
  "VITE_ENABLE_TON_CONNECT",
  "VITE_ENABLE_DEBUG_PANEL",
  "VITE_ENABLE_SUPABASE_DIRECT_READS",
  "VITE_REQUEST_TIMEOUT_MS",
]);

const SENSITIVE_KEY_PATTERN =
  /(SECRET|PRIVATE|SERVICE_ROLE|BOT_TOKEN|BOT_API|PASSWORD|MNEMONIC|WEBHOOK|SIGNING|JWT|ACCESS_TOKEN|REFRESH_TOKEN|MINTER|SERVICE_KEY|API_SECRET)/i;

function isEmptyEnvValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  return value;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
}

function getBrowserOrigin(): string | undefined {
  if (typeof globalThis === "undefined") {
    return undefined;
  }

  if (!("location" in globalThis)) {
    return undefined;
  }

  const location = globalThis.location as Location | undefined;
  return location?.origin;
}

function maskValue(value: string | undefined, visibleChars = 4): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.length <= visibleChars * 2) {
    return "***";
  }

  return `${value.slice(0, visibleChars)}***${value.slice(-visibleChars)}`;
}

function assertNoExposedSecrets(rawEnv: ImportMetaEnv): void {
  const exposedKeys = Object.keys(rawEnv);

  const illegalKeys = exposedKeys.filter((key) => {
    if (PUBLIC_BUILT_IN_ENV_KEYS.has(key)) {
      return false;
    }

    if (!key.startsWith("VITE_")) {
      return false;
    }

    if (!SAFE_PUBLIC_VITE_KEYS.has(key)) {
      return SENSITIVE_KEY_PATTERN.test(key);
    }

    return SENSITIVE_KEY_PATTERN.test(key) && key !== "VITE_SUPABASE_ANON_KEY";
  });

  if (illegalKeys.length > 0) {
    throw new Error(
      [
        "Detected sensitive environment variables exposed to the browser.",
        "Remove these variables from VITE_ env and move them to packages/server/src/env.ts:",
        ...illegalKeys.map((key) => `- ${key}`),
      ].join("\n"),
    );
  }
}

const stringFromEnv = (defaultValue: string) =>
  z.preprocess((value) => {
    if (isEmptyEnvValue(value)) {
      return defaultValue;
    }

    return value;
  }, z.string().trim().min(1));

const optionalStringFromEnv = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
);

const optionalUrlFromEnv = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().url().optional(),
);

const optionalUrlOrPathFromEnv = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .refine(
      (value) => value.startsWith("/") || isValidUrl(value),
      "Must be an absolute URL or a relative path starting with /",
    )
    .optional(),
);

const booleanFromEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (isEmptyEnvValue(value)) {
      return defaultValue;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();

      if (["true", "1", "yes", "y", "on"].includes(normalized)) {
        return true;
      }

      if (["false", "0", "no", "n", "off"].includes(normalized)) {
        return false;
      }
    }

    return value;
  }, z.boolean());

const numberFromEnv = (defaultValue: number, options?: { min?: number; max?: number }) =>
  z.preprocess((value) => {
    if (isEmptyEnvValue(value)) {
      return defaultValue;
    }

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return value;
  }, z.number().int().min(options?.min ?? 0).max(options?.max ?? Number.MAX_SAFE_INTEGER));

const appEnvFromEnv = z.preprocess((value) => {
  if (isEmptyEnvValue(value)) {
    return "development";
  }

  return value;
}, z.enum(APP_ENV_VALUES));

export const webEnvSchema = z
  .object({
    MODE: z.string().trim().min(1).default("development"),
    BASE_URL: z.string().trim().min(1).default("/"),
    DEV: z.boolean().default(false),
    PROD: z.boolean().default(false),
    SSR: z.boolean().default(false),

    VITE_APP_NAME: stringFromEnv("TMA Game"),
    VITE_APP_VERSION: stringFromEnv("0.1.0"),
    VITE_APP_ENV: appEnvFromEnv,

    VITE_PUBLIC_BASE_URL: optionalUrlFromEnv,
    VITE_API_BASE_URL: optionalUrlOrPathFromEnv,

    VITE_TELEGRAM_BOT_USERNAME: optionalStringFromEnv,
    VITE_TELEGRAM_MINI_APP_SHORT_NAME: optionalStringFromEnv,

    VITE_TONCONNECT_MANIFEST_URL: optionalUrlFromEnv,

    VITE_SUPABASE_URL: optionalUrlFromEnv,
    VITE_SUPABASE_ANON_KEY: optionalStringFromEnv,

    VITE_SENTRY_DSN: optionalUrlFromEnv,

    VITE_ENABLE_MOCKS: booleanFromEnv(false),
    VITE_ENABLE_TON_CONNECT: booleanFromEnv(true),
    VITE_ENABLE_DEBUG_PANEL: booleanFromEnv(false),
    VITE_ENABLE_SUPABASE_DIRECT_READS: booleanFromEnv(false),

    VITE_REQUEST_TIMEOUT_MS: numberFromEnv(15_000, {
      min: 1_000,
      max: 120_000,
    }),
  })
  .superRefine((env, ctx) => {
    if (env.PROD && env.VITE_ENABLE_MOCKS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["VITE_ENABLE_MOCKS"],
        message: "Mock mode must be disabled in production builds.",
      });
    }

    if (env.PROD && env.VITE_ENABLE_DEBUG_PANEL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["VITE_ENABLE_DEBUG_PANEL"],
        message: "Debug panel must be disabled in production builds.",
      });
    }

    if (env.VITE_ENABLE_SUPABASE_DIRECT_READS) {
      if (!env.VITE_SUPABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["VITE_SUPABASE_URL"],
          message: "Required when VITE_ENABLE_SUPABASE_DIRECT_READS is enabled.",
        });
      }

      if (!env.VITE_SUPABASE_ANON_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["VITE_SUPABASE_ANON_KEY"],
          message: "Required when VITE_ENABLE_SUPABASE_DIRECT_READS is enabled.",
        });
      }
    }
  });

assertNoExposedSecrets(import.meta.env);

const parsedEnv = webEnvSchema.safeParse(import.meta.env);

if (!parsedEnv.success) {
  throw new Error(
    [
      "Invalid frontend environment variables.",
      "Check apps/web/src/env.ts and your Vite environment variables.",
      formatZodIssues(parsedEnv.error),
    ].join("\n"),
  );
}

const raw = parsedEnv.data;

const fallbackPublicBaseUrl = getBrowserOrigin() ?? "http://localhost:5173";

const publicBaseUrl = trimTrailingSlash(
  raw.VITE_PUBLIC_BASE_URL ?? fallbackPublicBaseUrl,
);

const apiBaseUrl = raw.VITE_API_BASE_URL
  ? raw.VITE_API_BASE_URL.startsWith("/")
    ? raw.VITE_API_BASE_URL
    : trimTrailingSlash(raw.VITE_API_BASE_URL)
  : "/api";

const tonConnectManifestUrl =
  raw.VITE_TONCONNECT_MANIFEST_URL ??
  `${publicBaseUrl}/tonconnect-manifest.json`;

export const env = Object.freeze({
  APP_NAME: raw.VITE_APP_NAME,
  APP_VERSION: raw.VITE_APP_VERSION,
  APP_ENV: raw.VITE_APP_ENV as AppEnv,

  MODE: raw.MODE,
  BASE_URL: raw.BASE_URL,

  IS_DEV: raw.DEV,
  IS_PROD: raw.PROD,
  IS_SSR: raw.SSR,
  IS_LOCAL: raw.VITE_APP_ENV === "local",
  IS_PREVIEW: raw.VITE_APP_ENV === "preview",
  IS_TEST: raw.VITE_APP_ENV === "test",

  PUBLIC_BASE_URL: publicBaseUrl,
  API_BASE_URL: apiBaseUrl,

  TELEGRAM_BOT_USERNAME: raw.VITE_TELEGRAM_BOT_USERNAME,
  TELEGRAM_MINI_APP_SHORT_NAME: raw.VITE_TELEGRAM_MINI_APP_SHORT_NAME,

  TONCONNECT_MANIFEST_URL: tonConnectManifestUrl,

  SUPABASE_URL: raw.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: raw.VITE_SUPABASE_ANON_KEY,

  SENTRY_DSN: raw.VITE_SENTRY_DSN,

  REQUEST_TIMEOUT_MS: raw.VITE_REQUEST_TIMEOUT_MS,

  FEATURES: Object.freeze({
    MOCKS: raw.VITE_ENABLE_MOCKS,
    TON_CONNECT: raw.VITE_ENABLE_TON_CONNECT,
    DEBUG_PANEL: raw.VITE_ENABLE_DEBUG_PANEL,
    SUPABASE_DIRECT_READS: raw.VITE_ENABLE_SUPABASE_DIRECT_READS,
  }),
});

export type WebEnv = typeof env;

export function isFeatureEnabled(feature: keyof WebEnv["FEATURES"]): boolean {
  return env.FEATURES[feature];
}

/**
 * 只用于调试展示。
 * 不要把完整 env 直接 console.log。
 */
export function getPublicEnvSnapshot(): Record<string, unknown> {
  return {
    APP_NAME: env.APP_NAME,
    APP_VERSION: env.APP_VERSION,
    APP_ENV: env.APP_ENV,
    MODE: env.MODE,
    BASE_URL: env.BASE_URL,
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
    API_BASE_URL: env.API_BASE_URL,
    TELEGRAM_BOT_USERNAME: env.TELEGRAM_BOT_USERNAME,
    TELEGRAM_MINI_APP_SHORT_NAME: env.TELEGRAM_MINI_APP_SHORT_NAME,
    TONCONNECT_MANIFEST_URL: env.TONCONNECT_MANIFEST_URL,
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_ANON_KEY: maskValue(env.SUPABASE_ANON_KEY),
    SENTRY_DSN: maskValue(env.SENTRY_DSN),
    REQUEST_TIMEOUT_MS: env.REQUEST_TIMEOUT_MS,
    FEATURES: env.FEATURES,
  };
}
