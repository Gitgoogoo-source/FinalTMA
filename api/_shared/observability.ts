import { randomUUID } from "node:crypto";

import { getSupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin.js";

type ObservabilityLevel = "error" | "warning" | "info";

export type ObservabilityContext = Readonly<{
  requestId?: string | undefined;
  userId?: string | undefined;
  adminId?: string | undefined;
  orderId?: string | undefined;
  sourceId?: string | undefined;
}>;

export type OperationalAppEventInput = Readonly<{
  eventName: string;
  eventSource: string;
  requestId?: string | undefined;
  userId?: string | undefined;
  adminId?: string | undefined;
  orderId?: string | undefined;
  sourceId?: string | undefined;
}>;

type ObservabilityEvent = Readonly<{
  eventName: string;
  level: ObservabilityLevel;
  environment: string;
  timestamp: string;
  error: NormalizedObservedError;
  context: ObservabilityContext;
}>;

type NormalizedObservedError = Readonly<{
  name: string;
  message: string;
  code?: string | undefined;
  statusCode?: number | undefined;
}>;

type ProviderConfig =
  | Readonly<{
      provider: "axiom";
      token: string;
      dataset: string;
    }>
  | Readonly<{
      provider: "logtail";
      token: string;
    }>
  | Readonly<{
      provider: "sentry";
      dsn: string;
    }>;

const DEFAULT_AXIOM_DATASET = "tma-game";
const REQUEST_TIMEOUT_MS = 1500;
const SENSITIVE_TEXT_PATTERN =
  /(authorization|bearer|cookie|set-cookie|token|secret|service[_-]?role|api[_-]?key|private[_-]?key|mnemonic|seed|init[_-]?data|signature|webhook[_-]?secret|bot[_-]?token)/gi;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /(authorization|cookie|set-cookie|token|secret|service[_-]?role|api[_-]?key|private[_-]?key|mnemonic|seed|init[_-]?data|signature|webhook[_-]?secret|bot[_-]?token)\s*[:=]\s*[^,\s]+/gi;
const BEARER_VALUE_PATTERN = /bearer\s+[A-Za-z0-9._~+/=-]+/gi;

export async function reportApiError(
  error: unknown,
  context: ObservabilityContext,
): Promise<void> {
  const statusCode = readStatusCode(error);

  if (typeof statusCode === "number" && statusCode < 500) {
    return;
  }

  await reportError("api.5xx", error, context);
}

export async function reportPaymentWebhookError(
  error: unknown,
  context: ObservabilityContext,
): Promise<void> {
  await reportError("payment.webhook.error", error, context);
}

export async function reportMintWorkerError(
  error: unknown,
  context: ObservabilityContext,
): Promise<void> {
  await reportError("mint.worker.error", error, context);
}

export function recordApiOperationalEvent(
  input: OperationalAppEventInput,
): void {
  void insertApiOperationalEvent(input);
}

export function recordSupabaseQueryError(
  error: unknown,
  context: ObservabilityContext,
): void {
  void error;
  void insertApiOperationalEvent({
    eventName: "supabase.query_error",
    eventSource: "supabase.query",
    ...context,
  });

  if (process.env.LOG_SUPABASE_QUERY_ERRORS === "1") {
    console.warn(
      "[observability:supabase-query-error]",
      sanitizeContext(context),
    );
  }
}

export function resolveObservabilityEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = readEnv(env, "SENTRY_ENVIRONMENT");

  if (explicit) {
    return explicit;
  }

  const vercelEnv = readEnv(env, "VERCEL_ENV")?.toLowerCase();

  if (vercelEnv === "production") {
    return "production";
  }

  if (vercelEnv === "preview") {
    return "staging";
  }

  return readEnv(env, "APP_ENV") ?? readEnv(env, "NODE_ENV") ?? "development";
}

async function reportError(
  eventName: string,
  error: unknown,
  context: ObservabilityContext,
): Promise<void> {
  const providers = getProviderConfigs(process.env);

  if (providers.length === 0) {
    return;
  }

  const event: ObservabilityEvent = {
    eventName,
    level: "error",
    environment: resolveObservabilityEnvironment(),
    timestamp: new Date().toISOString(),
    error: normalizeObservedError(error),
    context: sanitizeContext(context),
  };

  const results = await Promise.allSettled(
    providers.map((provider) => sendToProvider(provider, event)),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[observability:provider-failed]", {
        providerError: sanitizeText(getErrorMessage(result.reason)),
      });
    }
  }
}

async function insertApiOperationalEvent(
  input: OperationalAppEventInput,
): Promise<void> {
  try {
    const db = getSupabaseAdminClient();
    const payload = sanitizeContext(input);

    const { error } = await db.schema("ops").from("app_events").insert({
      user_id: null,
      event_name: input.eventName,
      event_source: input.eventSource,
      payload,
    });

    if (error) {
      throw error;
    }
  } catch (error) {
    void error;
    console.warn("[observability:app-event-failed]", sanitizeContext(input));
  }
}

function getProviderConfigs(env: NodeJS.ProcessEnv): ProviderConfig[] {
  const providers: ProviderConfig[] = [];
  const axiomToken = readEnv(env, "AXIOM_TOKEN");
  const logtailToken = readEnv(env, "LOGTAIL_SOURCE_TOKEN");
  const sentryDsn = readEnv(env, "SENTRY_DSN");

  if (axiomToken) {
    providers.push({
      provider: "axiom",
      token: axiomToken,
      dataset: readEnv(env, "AXIOM_DATASET") ?? DEFAULT_AXIOM_DATASET,
    });
  }

  if (logtailToken) {
    providers.push({
      provider: "logtail",
      token: logtailToken,
    });
  }

  if (sentryDsn) {
    providers.push({
      provider: "sentry",
      dsn: sentryDsn,
    });
  }

  return providers;
}

async function sendToProvider(
  provider: ProviderConfig,
  event: ObservabilityEvent,
): Promise<void> {
  if (provider.provider === "axiom") {
    await postJson(
      `https://api.axiom.co/v1/datasets/${encodeURIComponent(
        provider.dataset,
      )}/ingest`,
      [toProviderPayload(event)],
      {
        Authorization: `Bearer ${provider.token}`,
      },
    );
    return;
  }

  if (provider.provider === "logtail") {
    await postJson("https://in.logtail.com", toProviderPayload(event), {
      Authorization: `Bearer ${provider.token}`,
    });
    return;
  }

  await sendToSentry(provider.dsn, event);
}

async function sendToSentry(
  dsn: string,
  event: ObservabilityEvent,
): Promise<void> {
  const endpoint = buildSentryStoreEndpoint(dsn);

  if (!endpoint) {
    return;
  }

  await postJson(
    endpoint.url,
    {
      event_id: randomUUID().replace(/-/g, ""),
      timestamp: event.timestamp,
      platform: "node",
      logger: "tma-game-api",
      level: event.level,
      environment: event.environment,
      message: `${event.eventName}: ${event.error.code ?? event.error.name}`,
      exception: {
        values: [
          {
            type: event.error.name,
            value: event.error.message,
          },
        ],
      },
      extra: event.context,
      tags: {
        event_name: event.eventName,
      },
    },
    {
      "X-Sentry-Auth": [
        "Sentry sentry_version=7",
        `sentry_key=${endpoint.publicKey}`,
        "sentry_client=tma-game-api/1.0.0",
      ].join(", "),
    },
  );
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

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`provider responded ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function toProviderPayload(event: ObservabilityEvent): Record<string, unknown> {
  return {
    eventName: event.eventName,
    level: event.level,
    environment: event.environment,
    timestamp: event.timestamp,
    error: event.error,
    context: event.context,
  };
}

function normalizeObservedError(error: unknown): NormalizedObservedError {
  const record = isRecord(error) ? error : {};
  const fallbackName = error instanceof Error ? error.name : "Error";

  return removeUndefined({
    name: sanitizeText(readString(record.name) ?? fallbackName) ?? "Error",
    message: sanitizeText(getErrorMessage(error)) ?? "Unknown error",
    code: sanitizeText(readString(record.code)),
    statusCode: readStatusCode(error),
  });
}

function sanitizeContext(context: ObservabilityContext): ObservabilityContext {
  return removeUndefined({
    requestId: sanitizeText(context.requestId),
    userId: sanitizeText(context.userId),
    adminId: sanitizeText(context.adminId),
    orderId: sanitizeText(context.orderId),
    sourceId: sanitizeText(context.sourceId),
  });
}

function readStatusCode(error: unknown): number | undefined {
  if (!isRecord(error) || typeof error.statusCode !== "number") {
    return undefined;
  }

  return Number.isFinite(error.statusCode) ? error.statusCode : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (isRecord(error)) {
    const message = readString(error.message);

    if (message) {
      return message;
    }
  }

  return "Unknown error";
}

function sanitizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  return normalized
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1=[redacted]")
    .replace(BEARER_VALUE_PATTERN, "Bearer [redacted]")
    .replace(SENSITIVE_TEXT_PATTERN, "[redacted]");
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();

  return value ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
