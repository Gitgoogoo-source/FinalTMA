import { z } from "zod";

/**
 * packages/server/src/env.ts
 *
 * 后端环境变量入口。
 *
 * 核心原则：
 * 1. 所有密钥只允许存在于服务端。
 * 2. SUPABASE_SERVICE_ROLE_KEY、TELEGRAM_BOT_TOKEN、SESSION_SECRET、TON 私钥等绝不能暴露到前端。
 * 3. Vercel Functions、Cron、Telegram Webhook、TON Mint、Supabase RPC 都从这里读取配置。
 * 4. 此文件在 import 时会校验环境变量，缺失关键配置时直接失败。
 */

const APP_ENV_VALUES = [
  "local",
  "development",
  "staging",
  "preview",
  "production",
  "test",
] as const;

const NODE_ENV_VALUES = ["development", "test", "production"] as const;
const VERCEL_ENV_VALUES = ["development", "preview", "production"] as const;
const TON_NETWORK_VALUES = ["testnet", "mainnet"] as const;
const LOG_LEVEL_VALUES = ["debug", "info", "warn", "error"] as const;
const COOKIE_SAMESITE_VALUES = ["lax", "strict", "none"] as const;

type AppEnv = (typeof APP_ENV_VALUES)[number];
type NodeEnv = (typeof NODE_ENV_VALUES)[number];
type VercelEnv = (typeof VERCEL_ENV_VALUES)[number];
type TonNetwork = (typeof TON_NETWORK_VALUES)[number];
type LogLevel = (typeof LOG_LEVEL_VALUES)[number];
type CookieSameSite = (typeof COOKIE_SAMESITE_VALUES)[number];

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

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveVercelUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimTrailingSlash(trimmed);
  }

  return `https://${trimmed}`;
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
}

function maskSecret(
  value: string | undefined,
  visibleChars = 4,
): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.length <= visibleChars * 2) {
    return "***";
  }

  return `${value.slice(0, visibleChars)}***${value.slice(-visibleChars)}`;
}

function createLocalOnlySecret(name: string): string {
  return `local-dev-${name.toLowerCase()}-do-not-use-in-production-${name.length}`;
}

const stringFromEnv = (defaultValue: string) =>
  z.preprocess((value) => {
    if (isEmptyEnvValue(value)) {
      return defaultValue;
    }

    return value;
  }, z.string().trim().min(1));

const requiredStringFromEnv = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1),
);

const optionalStringFromEnv = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional(),
);

const requiredSecretFromEnv = (minLength = 16) =>
  z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .trim()
      .min(minLength, `Must contain at least ${minLength} characters.`),
  );

const optionalSecretFromEnv = (minLength = 16) =>
  z.preprocess(
    emptyStringToUndefined,
    z
      .string()
      .trim()
      .min(minLength, `Must contain at least ${minLength} characters.`)
      .optional(),
  );

const requiredUrlFromEnv = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().url(),
);

const optionalUrlFromEnv = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().url().optional(),
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

const optionalBooleanFromEnv = z.preprocess((value) => {
  if (isEmptyEnvValue(value)) {
    return undefined;
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
}, z.boolean().optional());

const numberFromEnv = (
  defaultValue: number,
  options?: {
    min?: number;
    max?: number;
  },
) =>
  z.preprocess(
    (value) => {
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
    },
    z
      .number()
      .int()
      .min(options?.min ?? 0)
      .max(options?.max ?? Number.MAX_SAFE_INTEGER),
  );

const enumFromEnv = <T extends readonly [string, ...string[]]>(
  values: T,
  defaultValue: T[number],
) =>
  z.preprocess((value) => {
    if (isEmptyEnvValue(value)) {
      return defaultValue;
    }

    return value;
  }, z.enum(values));

const optionalEnumFromEnv = <T extends readonly [string, ...string[]]>(
  values: T,
) => z.preprocess(emptyStringToUndefined, z.enum(values).optional());

const csvListFromEnv = z.preprocess(
  (value) => {
    if (isEmptyEnvValue(value)) {
      return [];
    }

    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === "string") {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return value;
  },
  z.array(z.string().trim().min(1)),
);

const corsOriginsFromEnv = csvListFromEnv.superRefine((origins, ctx) => {
  for (const origin of origins) {
    if (origin === "*") {
      continue;
    }

    if (!isValidUrl(origin)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid CORS origin: ${origin}`,
      });
    }
  }
});

function isProductionLikeInput(input: {
  APP_ENV: AppEnv;
  NODE_ENV: NodeEnv;
  VERCEL_ENV?: VercelEnv | undefined;
}): boolean {
  return (
    input.APP_ENV === "production" ||
    input.NODE_ENV === "production" ||
    input.VERCEL_ENV === "production"
  );
}

export const serverEnvSchema = z
  .object({
    NODE_ENV: enumFromEnv(NODE_ENV_VALUES, "development"),
    APP_ENV: enumFromEnv(APP_ENV_VALUES, "development"),

    VERCEL_ENV: optionalEnumFromEnv(VERCEL_ENV_VALUES),
    VERCEL_URL: optionalStringFromEnv,
    VERCEL_BRANCH_URL: optionalStringFromEnv,
    VERCEL_GIT_COMMIT_SHA: optionalStringFromEnv,

    APP_NAME: stringFromEnv("TMA Game"),
    APP_VERSION: stringFromEnv("0.1.0"),

    PUBLIC_APP_URL: optionalUrlFromEnv,
    API_BASE_URL: optionalUrlFromEnv,
    CORS_ALLOWED_ORIGINS: corsOriginsFromEnv,

    SESSION_COOKIE_NAME: stringFromEnv("tma_game_session"),
    SESSION_COOKIE_DOMAIN: optionalStringFromEnv,
    SESSION_COOKIE_SECURE: optionalBooleanFromEnv,
    SESSION_COOKIE_SAMESITE: enumFromEnv(COOKIE_SAMESITE_VALUES, "lax"),
    APP_SESSION_SECRET: optionalSecretFromEnv(32),
    SESSION_SECRET: optionalSecretFromEnv(32),
    SESSION_TTL_SECONDS: numberFromEnv(60 * 60 * 24 * 7, {
      min: 60,
      max: 60 * 60 * 24 * 30,
    }),
    SESSION_REFRESH_THRESHOLD_SECONDS: numberFromEnv(60 * 60 * 24, {
      min: 60,
      max: 60 * 60 * 24 * 30,
    }),

    ADMIN_SESSION_SECRET: optionalSecretFromEnv(32),
    ADMIN_EMAIL_ALLOWLIST: csvListFromEnv,

    SUPABASE_URL: requiredUrlFromEnv,
    SUPABASE_ANON_KEY: optionalStringFromEnv,
    SUPABASE_SECRET_KEY: optionalSecretFromEnv(32),
    SUPABASE_SERVICE_ROLE_KEY: optionalSecretFromEnv(32),
    SUPABASE_JWT_SECRET: optionalSecretFromEnv(32),

    TELEGRAM_BOT_TOKEN: requiredSecretFromEnv(16),
    TELEGRAM_BOT_USERNAME: optionalStringFromEnv,
    TELEGRAM_MINI_APP_SHORT_NAME: optionalStringFromEnv,
    TELEGRAM_WEBHOOK_SECRET: optionalSecretFromEnv(16),
    TELEGRAM_WEBHOOK_SECRET_TOKEN: optionalSecretFromEnv(16),
    TELEGRAM_STARS_CURRENCY: z.preprocess((value) => {
      if (isEmptyEnvValue(value)) {
        return "XTR";
      }

      return value;
    }, z.literal("XTR")),
    TELEGRAM_STARS_PROVIDER_TOKEN: z.preprocess((value) => {
      if (value === undefined || value === null) {
        return "";
      }

      return value;
    }, z.string()),

    TON_NETWORK: enumFromEnv(TON_NETWORK_VALUES, "testnet"),
    TONCONNECT_MANIFEST_URL: optionalUrlFromEnv,
    TON_API_BASE_URL: optionalUrlFromEnv,
    TON_API_KEY: optionalSecretFromEnv(8),
    TON_COLLECTION_ADDRESS: optionalStringFromEnv,
    TON_MINT_ENABLED: booleanFromEnv(false),
    TON_MINTER_WALLET_ADDRESS: optionalStringFromEnv,
    TON_MINTER_PRIVATE_KEY: optionalSecretFromEnv(16),
    TON_MINTER_MNEMONIC: optionalSecretFromEnv(16),
    TON_MINT_MAX_RETRIES: numberFromEnv(5, {
      min: 0,
      max: 20,
    }),

    CRON_SECRET: optionalSecretFromEnv(16),
    IDEMPOTENCY_TTL_SECONDS: numberFromEnv(60 * 60 * 24, {
      min: 60,
      max: 60 * 60 * 24 * 30,
    }),

    RATE_LIMIT_ENABLED: booleanFromEnv(true),
    RATE_LIMIT_WINDOW_SECONDS: numberFromEnv(60, {
      min: 1,
      max: 60 * 60,
    }),
    RATE_LIMIT_MAX_REQUESTS: numberFromEnv(120, {
      min: 1,
      max: 100_000,
    }),

    MAX_REQUEST_BODY_BYTES: numberFromEnv(1024 * 1024, {
      min: 1024,
      max: 1024 * 1024 * 10,
    }),

    LOG_LEVEL: enumFromEnv(LOG_LEVEL_VALUES, "info"),
    SENTRY_DSN: optionalUrlFromEnv,

    ENABLE_MOCK_PAYMENTS: booleanFromEnv(false),
    DEV_GACHA_PAYMENT_MODE: booleanFromEnv(true),
    DRAW_RANDOM_SECRET: requiredSecretFromEnv(32),
    ENABLE_MOCK_TON: booleanFromEnv(false),
    ENABLE_ADMIN_API: booleanFromEnv(true),
    ENABLE_CRON_API: booleanFromEnv(true),
  })
  .superRefine((input, ctx) => {
    const isProductionLike = isProductionLikeInput(input);

    const resolvedPublicAppUrl =
      input.PUBLIC_APP_URL ?? resolveVercelUrl(input.VERCEL_URL);

    if (isProductionLike && !resolvedPublicAppUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PUBLIC_APP_URL"],
        message:
          "PUBLIC_APP_URL is required in production unless VERCEL_URL is available.",
      });
    }

    if (
      isProductionLike &&
      resolvedPublicAppUrl &&
      !isHttpsUrl(resolvedPublicAppUrl)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PUBLIC_APP_URL"],
        message: "PUBLIC_APP_URL must use HTTPS in production.",
      });
    }

    if (!input.SUPABASE_SECRET_KEY && !input.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SUPABASE_SERVICE_ROLE_KEY"],
        message:
          "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required on the server.",
      });
    }

    if (
      isProductionLike &&
      !input.APP_SESSION_SECRET &&
      !input.SESSION_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["APP_SESSION_SECRET"],
        message:
          "APP_SESSION_SECRET is required in production. SESSION_SECRET is accepted as a legacy alias.",
      });
    }

    if (isProductionLike && input.SESSION_COOKIE_SECURE === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SESSION_COOKIE_SECURE"],
        message: "SESSION_COOKIE_SECURE must not be false in production.",
      });
    }

    if (
      isProductionLike &&
      !input.TELEGRAM_WEBHOOK_SECRET &&
      !input.TELEGRAM_WEBHOOK_SECRET_TOKEN
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TELEGRAM_WEBHOOK_SECRET"],
        message:
          "TELEGRAM_WEBHOOK_SECRET is required in production to verify Telegram webhook requests.",
      });
    }

    if (
      input.ENABLE_CRON_API &&
      isProductionLike &&
      !input.CRON_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CRON_SECRET"],
        message: "CRON_SECRET is required when cron API is enabled in production.",
      });
    }

    if (isProductionLike && input.CORS_ALLOWED_ORIGINS.includes("*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ALLOWED_ORIGINS"],
        message: "Wildcard CORS origin is not allowed in production.",
      });
    }

    if (isProductionLike && input.ENABLE_MOCK_PAYMENTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ENABLE_MOCK_PAYMENTS"],
        message: "Mock payments must be disabled in production.",
      });
    }

    if (isProductionLike && input.DEV_GACHA_PAYMENT_MODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEV_GACHA_PAYMENT_MODE"],
        message: "DEV_GACHA_PAYMENT_MODE must be disabled in production.",
      });
    }

    if (isProductionLike && input.ENABLE_MOCK_TON) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ENABLE_MOCK_TON"],
        message: "Mock TON mode must be disabled in production.",
      });
    }

    if (input.TON_MINT_ENABLED) {
      if (!input.TON_COLLECTION_ADDRESS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TON_COLLECTION_ADDRESS"],
          message: "Required when TON_MINT_ENABLED is true.",
        });
      }

      if (!input.TON_MINTER_WALLET_ADDRESS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TON_MINTER_WALLET_ADDRESS"],
          message: "Required when TON_MINT_ENABLED is true.",
        });
      }

      if (!input.TON_MINTER_PRIVATE_KEY && !input.TON_MINTER_MNEMONIC) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TON_MINTER_PRIVATE_KEY"],
          message:
            "Either TON_MINTER_PRIVATE_KEY or TON_MINTER_MNEMONIC is required when TON_MINT_ENABLED is true.",
        });
      }
    }
  });

const parsedEnv = serverEnvSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(
    [
      "Invalid server environment variables.",
      "Check packages/server/src/env.ts and your Vercel / local environment variables.",
      formatZodIssues(parsedEnv.error),
    ].join("\n"),
  );
}

const raw = parsedEnv.data;

const isProductionLike = isProductionLikeInput(raw);

const publicAppUrl =
  raw.PUBLIC_APP_URL ??
  resolveVercelUrl(raw.VERCEL_URL) ??
  "http://localhost:5173";

const normalizedPublicAppUrl = trimTrailingSlash(publicAppUrl);

const apiBaseUrl = raw.API_BASE_URL ?? `${normalizedPublicAppUrl}/api`;

const corsAllowedOrigins =
  raw.CORS_ALLOWED_ORIGINS.length > 0
    ? raw.CORS_ALLOWED_ORIGINS
    : [
        normalizedPublicAppUrl,
        "http://localhost:5173",
        "http://localhost:4173",
      ];

const sessionSecret =
  raw.APP_SESSION_SECRET ??
  raw.SESSION_SECRET ??
  createLocalOnlySecret("SESSION_SECRET");

const adminSessionSecret = raw.ADMIN_SESSION_SECRET ?? sessionSecret;

const supabaseServerKey =
  raw.SUPABASE_SECRET_KEY ?? raw.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServerKey) {
  throw new Error("Missing Supabase server key after environment validation.");
}

const telegramWebhookSecret =
  raw.TELEGRAM_WEBHOOK_SECRET ?? raw.TELEGRAM_WEBHOOK_SECRET_TOKEN;

const sessionCookieSecure = raw.SESSION_COOKIE_SECURE ?? isProductionLike;

const tonConnectManifestUrl =
  raw.TONCONNECT_MANIFEST_URL ??
  `${normalizedPublicAppUrl}/tonconnect-manifest.json`;

export const env = Object.freeze({
  APP: Object.freeze({
    NAME: raw.APP_NAME,
    VERSION: raw.APP_VERSION,
    ENV: raw.APP_ENV as AppEnv,
    NODE_ENV: raw.NODE_ENV as NodeEnv,
    VERCEL_ENV: raw.VERCEL_ENV as VercelEnv | undefined,
    VERCEL_URL: raw.VERCEL_URL,
    VERCEL_BRANCH_URL: raw.VERCEL_BRANCH_URL,
    VERCEL_GIT_COMMIT_SHA: raw.VERCEL_GIT_COMMIT_SHA,

    IS_LOCAL: raw.APP_ENV === "local",
    IS_DEVELOPMENT:
      raw.APP_ENV === "development" || raw.NODE_ENV === "development",
    IS_PREVIEW:
      raw.APP_ENV === "preview" ||
      raw.APP_ENV === "staging" ||
      raw.VERCEL_ENV === "preview",
    IS_STAGING: raw.APP_ENV === "staging",
    IS_PRODUCTION: isProductionLike,
    IS_TEST: raw.APP_ENV === "test" || raw.NODE_ENV === "test",
  }),

  URLS: Object.freeze({
    PUBLIC_APP_URL: normalizedPublicAppUrl,
    API_BASE_URL: trimTrailingSlash(apiBaseUrl),
    CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
  }),

  SESSION: Object.freeze({
    COOKIE_NAME: raw.SESSION_COOKIE_NAME,
    COOKIE_DOMAIN: raw.SESSION_COOKIE_DOMAIN,
    COOKIE_SECURE: sessionCookieSecure,
    COOKIE_SAMESITE: raw.SESSION_COOKIE_SAMESITE as CookieSameSite,
    SECRET: sessionSecret,
    TTL_SECONDS: raw.SESSION_TTL_SECONDS,
    REFRESH_THRESHOLD_SECONDS: raw.SESSION_REFRESH_THRESHOLD_SECONDS,
  }),

  SUPABASE: Object.freeze({
    URL: raw.SUPABASE_URL,
    ANON_KEY: raw.SUPABASE_ANON_KEY,
    SERVER_KEY: supabaseServerKey,
    SERVER_KEY_SOURCE: raw.SUPABASE_SECRET_KEY
      ? "SUPABASE_SECRET_KEY"
      : "SUPABASE_SERVICE_ROLE_KEY",
    SERVICE_ROLE_KEY: supabaseServerKey,
    JWT_SECRET: raw.SUPABASE_JWT_SECRET,
  }),

  TELEGRAM: Object.freeze({
    BOT_TOKEN: raw.TELEGRAM_BOT_TOKEN,
    BOT_USERNAME: raw.TELEGRAM_BOT_USERNAME,
    MINI_APP_SHORT_NAME: raw.TELEGRAM_MINI_APP_SHORT_NAME,
    WEBHOOK_SECRET: telegramWebhookSecret,
    STARS_CURRENCY: raw.TELEGRAM_STARS_CURRENCY,
    STARS_PROVIDER_TOKEN: raw.TELEGRAM_STARS_PROVIDER_TOKEN,
  }),

  GACHA: Object.freeze({
    DRAW_RANDOM_SECRET: raw.DRAW_RANDOM_SECRET,
    DEV_PAYMENT_MODE: raw.DEV_GACHA_PAYMENT_MODE,
  }),

  TON: Object.freeze({
    NETWORK: raw.TON_NETWORK as TonNetwork,
    TONCONNECT_MANIFEST_URL: tonConnectManifestUrl,
    API_BASE_URL: raw.TON_API_BASE_URL,
    API_KEY: raw.TON_API_KEY,
    COLLECTION_ADDRESS: raw.TON_COLLECTION_ADDRESS,
    MINT_ENABLED: raw.TON_MINT_ENABLED,
    MINTER_WALLET_ADDRESS: raw.TON_MINTER_WALLET_ADDRESS,
    MINTER_PRIVATE_KEY: raw.TON_MINTER_PRIVATE_KEY,
    MINTER_MNEMONIC: raw.TON_MINTER_MNEMONIC,
    MINT_MAX_RETRIES: raw.TON_MINT_MAX_RETRIES,
  }),

  ADMIN: Object.freeze({
    ENABLED: raw.ENABLE_ADMIN_API,
    SESSION_SECRET: adminSessionSecret,
    EMAIL_ALLOWLIST: raw.ADMIN_EMAIL_ALLOWLIST,
  }),

  CRON: Object.freeze({
    ENABLED: raw.ENABLE_CRON_API,
    SECRET: raw.CRON_SECRET,
  }),

  SECURITY: Object.freeze({
    IDEMPOTENCY_TTL_SECONDS: raw.IDEMPOTENCY_TTL_SECONDS,
    RATE_LIMIT_ENABLED: raw.RATE_LIMIT_ENABLED,
    RATE_LIMIT_WINDOW_SECONDS: raw.RATE_LIMIT_WINDOW_SECONDS,
    RATE_LIMIT_MAX_REQUESTS: raw.RATE_LIMIT_MAX_REQUESTS,
    MAX_REQUEST_BODY_BYTES: raw.MAX_REQUEST_BODY_BYTES,
  }),

  LOGGING: Object.freeze({
    LEVEL: raw.LOG_LEVEL as LogLevel,
    SENTRY_DSN: raw.SENTRY_DSN,
  }),

  FEATURES: Object.freeze({
    MOCK_PAYMENTS: raw.ENABLE_MOCK_PAYMENTS,
    DEV_GACHA_PAYMENT_MODE: raw.DEV_GACHA_PAYMENT_MODE,
    MOCK_TON: raw.ENABLE_MOCK_TON,
    ADMIN_API: raw.ENABLE_ADMIN_API,
    CRON_API: raw.ENABLE_CRON_API,
  }),
});

export type ServerEnv = typeof env;

export function assertServerEnv(): ServerEnv {
  return env;
}

export function isProduction(): boolean {
  return env.APP.IS_PRODUCTION;
}

export function isPreview(): boolean {
  return env.APP.IS_PREVIEW;
}

export function isTest(): boolean {
  return env.APP.IS_TEST;
}

export function isFeatureEnabled(
  feature: keyof ServerEnv["FEATURES"],
): boolean {
  return env.FEATURES[feature];
}

/**
 * 安全日志快照。
 *
 * 不要直接 console.log(env)，因为 env 中包含：
 * - SUPABASE_SERVICE_ROLE_KEY
 * - TELEGRAM_BOT_TOKEN
 * - SESSION_SECRET
 * - TON 私钥 / 助记词
 */
export function getSafeEnvSnapshot(): Record<string, unknown> {
  return {
    APP: env.APP,
    URLS: env.URLS,

    SESSION: {
      COOKIE_NAME: env.SESSION.COOKIE_NAME,
      COOKIE_DOMAIN: env.SESSION.COOKIE_DOMAIN,
      COOKIE_SECURE: env.SESSION.COOKIE_SECURE,
      COOKIE_SAMESITE: env.SESSION.COOKIE_SAMESITE,
      TTL_SECONDS: env.SESSION.TTL_SECONDS,
      REFRESH_THRESHOLD_SECONDS: env.SESSION.REFRESH_THRESHOLD_SECONDS,
      HAS_SECRET: Boolean(env.SESSION.SECRET),
      SECRET: maskSecret(env.SESSION.SECRET),
    },

    SUPABASE: {
      URL: env.SUPABASE.URL,
      HAS_ANON_KEY: Boolean(env.SUPABASE.ANON_KEY),
      HAS_SERVER_KEY: Boolean(env.SUPABASE.SERVER_KEY),
      SERVER_KEY_SOURCE: env.SUPABASE.SERVER_KEY_SOURCE,
      HAS_JWT_SECRET: Boolean(env.SUPABASE.JWT_SECRET),
      ANON_KEY: maskSecret(env.SUPABASE.ANON_KEY),
      SERVER_KEY: maskSecret(env.SUPABASE.SERVER_KEY),
    },

    TELEGRAM: {
      BOT_USERNAME: env.TELEGRAM.BOT_USERNAME,
      MINI_APP_SHORT_NAME: env.TELEGRAM.MINI_APP_SHORT_NAME,
      STARS_CURRENCY: env.TELEGRAM.STARS_CURRENCY,
      HAS_BOT_TOKEN: Boolean(env.TELEGRAM.BOT_TOKEN),
      HAS_WEBHOOK_SECRET: Boolean(env.TELEGRAM.WEBHOOK_SECRET),
      HAS_STARS_PROVIDER_TOKEN: Boolean(env.TELEGRAM.STARS_PROVIDER_TOKEN),
      BOT_TOKEN: maskSecret(env.TELEGRAM.BOT_TOKEN),
      WEBHOOK_SECRET: maskSecret(env.TELEGRAM.WEBHOOK_SECRET),
    },

    GACHA: {
      DEV_PAYMENT_MODE: env.GACHA.DEV_PAYMENT_MODE,
      HAS_DRAW_RANDOM_SECRET: Boolean(env.GACHA.DRAW_RANDOM_SECRET),
      DRAW_RANDOM_SECRET: maskSecret(env.GACHA.DRAW_RANDOM_SECRET),
    },

    TON: {
      NETWORK: env.TON.NETWORK,
      TONCONNECT_MANIFEST_URL: env.TON.TONCONNECT_MANIFEST_URL,
      API_BASE_URL: env.TON.API_BASE_URL,
      COLLECTION_ADDRESS: env.TON.COLLECTION_ADDRESS,
      MINT_ENABLED: env.TON.MINT_ENABLED,
      MINTER_WALLET_ADDRESS: env.TON.MINTER_WALLET_ADDRESS,
      MINT_MAX_RETRIES: env.TON.MINT_MAX_RETRIES,
      HAS_API_KEY: Boolean(env.TON.API_KEY),
      HAS_MINTER_PRIVATE_KEY: Boolean(env.TON.MINTER_PRIVATE_KEY),
      HAS_MINTER_MNEMONIC: Boolean(env.TON.MINTER_MNEMONIC),
      API_KEY: maskSecret(env.TON.API_KEY),
    },

    ADMIN: {
      ENABLED: env.ADMIN.ENABLED,
      EMAIL_ALLOWLIST_COUNT: env.ADMIN.EMAIL_ALLOWLIST.length,
      HAS_SESSION_SECRET: Boolean(env.ADMIN.SESSION_SECRET),
    },

    CRON: {
      ENABLED: env.CRON.ENABLED,
      HAS_SECRET: Boolean(env.CRON.SECRET),
    },

    SECURITY: env.SECURITY,
    LOGGING: {
      LEVEL: env.LOGGING.LEVEL,
      HAS_SENTRY_DSN: Boolean(env.LOGGING.SENTRY_DSN),
      SENTRY_DSN: maskSecret(env.LOGGING.SENTRY_DSN),
    },
    FEATURES: env.FEATURES,
  };
}
