type AdminApiErrorLike = {
  code: string;
  message: string;
  status: number;
  requestId?: string | undefined;
};

type SentryLike = {
  captureException: (
    error: unknown,
    context?: {
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
    },
  ) => unknown;
};

const SENSITIVE_VALUE_RE =
  /(authorization=|cookie=|initData=|bot[_-]?token|service[_-]?role|private[_-]?key|secret=|password=|mnemonic=|jwt=|access[_-]?token=|refresh[_-]?token=)/i;
const ALLOWED_CONTEXT_KEYS = [
  "requestId",
  "userId",
  "adminId",
  "orderId",
  "sourceId",
] as const;

let initialized = false;

export function initializeAdminObservability(): void {
  if (initialized || typeof window === "undefined") {
    return;
  }

  initialized = true;

  window.addEventListener("error", (event) => {
    reportAdminUnknownError(event.error ?? event.message, {
      type: "admin_window_error",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportAdminUnknownError(event.reason, {
      type: "admin_unhandled_rejection",
    });
  });
}

export function reportAdminApiError(
  error: AdminApiErrorLike,
  context: Record<string, unknown> = {},
): void {
  const event = new Error(error.message);
  event.name = "AdminApiError";

  captureAdminException(event, "admin_api_error", {
    ...context,
    code: error.code,
    status: error.status,
    requestId: error.requestId ?? null,
  });
}

export function reportAdminRenderError(
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  captureAdminException(error, "admin_render_error", context);
}

export function reportAdminUnknownError(
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  captureAdminException(error, "admin_unknown_error", context);
}

function captureAdminException(
  error: unknown,
  type: string,
  context: Record<string, unknown>,
): void {
  const safeContext = sanitizeContext(context);
  const sentry = getSentry();

  if (sentry) {
    sentry.captureException(normalizeThrowable(error), {
      tags: {
        area: "admin",
        type,
      },
      extra: safeContext,
    });
    return;
  }

  if (sendToConfiguredSentry(type, normalizeThrowable(error), safeContext)) {
    return;
  }

  if ((import.meta.env as Record<string, unknown>).DEV === true) {
    console.warn("[admin-observability]", type, safeContext);
  }
}

function getSentry(): SentryLike | null {
  const candidate = (globalThis as { Sentry?: unknown }).Sentry;

  if (
    candidate &&
    typeof candidate === "object" &&
    "captureException" in candidate &&
    typeof candidate.captureException === "function"
  ) {
    return candidate as SentryLike;
  }

  return null;
}

function sendToConfiguredSentry(
  type: string,
  error: Error,
  context: Record<string, unknown>,
): boolean {
  const dsn = readEnvValue("VITE_SENTRY_DSN");
  const endpoint = dsn ? buildSentryStoreEndpoint(dsn) : null;

  if (!endpoint) {
    return false;
  }

  const event = {
    event_id: createEventId(),
    timestamp: new Date().toISOString(),
    platform: "javascript",
    logger: "tma-game-admin",
    level: "error",
    environment:
      readEnvValue("VITE_SENTRY_ENVIRONMENT") ??
      String((import.meta.env as Record<string, unknown>).MODE ?? "unknown"),
    message: `${type}: ${error.name}`,
    exception: {
      values: [
        {
          type: error.name,
          value: sanitizeString(error.message),
        },
      ],
    },
    tags: {
      area: "admin",
      type,
    },
    extra: context,
  };

  void fetch(endpoint.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": [
        "Sentry sentry_version=7",
        `sentry_key=${endpoint.publicKey}`,
        "sentry_client=tma-game-admin/1.0.0",
      ].join(", "),
    },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => undefined);

  return true;
}

function buildSentryStoreEndpoint(
  dsn: string,
): { url: string; publicKey: string } | null {
  try {
    const parsed = new URL(dsn);
    const projectId = parsed.pathname.split("/").filter(Boolean).at(-1);
    const publicKey = parsed.username;

    if (!projectId || !publicKey) {
      return null;
    }

    return {
      url: `${parsed.origin}/api/${projectId}/store/`,
      publicKey,
    };
  } catch {
    return null;
  }
}

function readEnvValue(name: string): string | null {
  const value = (import.meta.env as Record<string, unknown>)[name];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createEventId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;

  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID().replace(/-/g, "");
  }

  return Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32);
}

function normalizeThrowable(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === "string" ? error : "Unknown admin error");
}

function sanitizeContext(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    ALLOWED_CONTEXT_KEYS.flatMap((contextKey) => {
      const raw = value[contextKey];
      const sanitized = sanitizeAllowedContextValue(raw);

      return sanitized === undefined ? [] : [[contextKey, sanitized]];
    }),
  );
}

function sanitizeString(value: string): string {
  if (SENSITIVE_VALUE_RE.test(value)) {
    return "[redacted]";
  }

  return value;
}

function sanitizeAllowedContextValue(
  value: unknown,
): string | number | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const sanitized = sanitizeString(value).trim();
    return sanitized ? sanitized : undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
