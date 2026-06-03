import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin.js";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

export type JsonObject = {
  [key: string]: JsonValue;
};

export type RpcArgs = Record<string, JsonValue | undefined>;

export type TransactionMode = "read" | "write";

export interface RetryOptions {
  /**
   * Total attempts, including the first attempt.
   *
   * Example:
   * maxAttempts = 3 means:
   * attempt 1 -> retry -> attempt 2 -> retry -> attempt 3.
   */
  maxAttempts: number;

  /**
   * Initial retry delay.
   */
  minDelayMs: number;

  /**
   * Maximum retry delay.
   */
  maxDelayMs: number;

  /**
   * Exponential backoff factor.
   */
  factor: number;

  /**
   * Random jitter ratio.
   *
   * 0.2 means the delay will be randomly adjusted by ±20%.
   */
  jitter: number;
}

export interface RpcAuditContext {
  /**
   * Current app user id.
   */
  userId?: string | undefined;

  /**
   * Telegram user id, if useful for audit.
   */
  telegramUserId?: string | number | undefined;

  /**
   * Idempotency key for this operation.
   */
  idempotencyKey?: string | undefined;

  /**
   * Trace id for logs and database audit.
   */
  traceId?: string | undefined;

  /**
   * Source of request.
   *
   * Example:
   * tma, telegram_webhook, ops, cron
   */
  source?: string | undefined;

  /**
   * Optional IP hash. Never store raw IP unless you have a clear reason.
   */
  ipHash?: string | undefined;

  /**
   * Optional user-agent hash.
   */
  userAgentHash?: string | undefined;
}

export interface RpcTransactionOptions<TArgs extends RpcArgs = RpcArgs> {
  /**
   * Postgres schema that owns the RPC.
   *
   * Example:
   * "gacha", "market", "inventory", "tasks", "album", "wallet", "ops".
   *
   * If omitted, Supabase uses the default exposed schema.
   */
  schema?: string | undefined;

  /**
   * RPC function name.
   *
   * Example:
   * "gacha_process_paid_order"
   */
  functionName: string;

  /**
   * RPC arguments.
   *
   * Keep args JSON-safe. Do not pass raw Request, Response, Buffer, class instances.
   */
  args?: TArgs | undefined;

  /**
   * Whether the RPC is read or write.
   *
   * Default is "write" because most game operations are transactional writes.
   */
  mode?: TransactionMode | undefined;

  /**
   * Timeout for the Supabase RPC request.
   */
  timeoutMs?: number | undefined;

  /**
   * Retry config.
   *
   * Default:
   * - read: 2 attempts
   * - write: 1 attempt
   *
   * For write operations, only enable retry when the RPC is idempotent.
   */
  retry?: false | Partial<RetryOptions> | undefined;

  /**
   * Optional trace id. If omitted, a random UUID will be created.
   */
  traceId?: string | undefined;

  /**
   * Human-readable label for logs.
   */
  label?: string | undefined;

  /**
   * If true, null RPC data will throw.
   */
  throwOnNullData?: boolean | undefined;

  /**
   * Optional callback when a retry happens.
   */
  onRetry?: ((event: RpcRetryEvent) => void | Promise<void>) | undefined;
}

export interface RpcRetryEvent {
  traceId: string;
  schema?: string | undefined;
  functionName: string;
  mode: TransactionMode;
  attempt: number;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  error: DbTransactionError;
}

export interface RpcTransactionMeta {
  traceId: string;
  schema?: string | undefined;
  functionName: string;
  mode: TransactionMode;
  attempts: number;
  durationMs: number;
}

export interface RpcTransactionResult<TData> {
  data: TData;
  meta: RpcTransactionMeta;
}

export interface NormalizedDbErrorInput {
  code?: string | undefined;
  message?: string | undefined;
  details?: string | JsonValue | undefined;
  hint?: string | undefined;
  status?: number | undefined;
  statusText?: string | undefined;
}

export class DbTransactionError extends Error {
  override readonly name = "DbTransactionError";
  readonly code: string | undefined;
  readonly details: string | JsonValue | undefined;
  readonly hint: string | undefined;
  readonly status: number | undefined;
  readonly statusText: string | undefined;
  readonly traceId: string | undefined;
  readonly schema: string | undefined;
  readonly functionName: string | undefined;
  readonly mode: TransactionMode | undefined;
  readonly attempt: number | undefined;
  override readonly cause: unknown;

  constructor(
    message: string,
    options: {
      code?: string | undefined;
      details?: string | JsonValue | undefined;
      hint?: string | undefined;
      status?: number | undefined;
      statusText?: string | undefined;
      traceId?: string | undefined;
      schema?: string | undefined;
      functionName?: string | undefined;
      mode?: TransactionMode | undefined;
      attempt?: number | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message);

    Object.setPrototypeOf(this, new.target.prototype);

    this.code = options.code;
    this.details = options.details;
    this.hint = options.hint;
    this.status = options.status;
    this.statusText = options.statusText;
    this.traceId = options.traceId;
    this.schema = options.schema;
    this.functionName = options.functionName;
    this.mode = options.mode;
    this.attempt = options.attempt;
    this.cause = options.cause;
  }

  toJSON(): JsonObject {
    return removeUndefined({
      name: this.name,
      message: this.message,
      code: this.code,
      details: toJsonSafe(this.details),
      hint: this.hint,
      status: this.status,
      statusText: this.statusText,
      traceId: this.traceId,
      schema: this.schema,
      functionName: this.functionName,
      mode: this.mode,
      attempt: this.attempt,
    });
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_READ_RETRY: RetryOptions = {
  maxAttempts: 2,
  minDelayMs: 120,
  maxDelayMs: 1_200,
  factor: 2,
  jitter: 0.2,
};

const DEFAULT_WRITE_RETRY: RetryOptions = {
  maxAttempts: 1,
  minDelayMs: 120,
  maxDelayMs: 1_200,
  factor: 2,
  jitter: 0.2,
};

/**
 * Postgres / infrastructure errors that may be safe to retry.
 *
 * Important:
 * Do not blindly retry write transactions unless the operation is idempotent.
 */
const RETRYABLE_DB_CODES = new Set<string>([
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "53300", // too_many_connections
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);

const NON_RETRYABLE_DB_CODES = new Set<string>([
  "23502", // not_null_violation
  "23503", // foreign_key_violation
  "23505", // unique_violation
  "23514", // check_violation
  "22P02", // invalid_text_representation
  "P0001", // raise_exception, often business-rule error from RPC
]);

export function createTraceId(): string {
  return randomUUID();
}

/**
 * Build a JSON-safe audit context that can be passed to RPC arguments.
 *
 * Example:
 * await runRpcTransaction({
 *   schema: "market",
 *   functionName: "market_buy_listing",
 *   args: {
 *     p_listing_id: listingId,
 *     p_context: makeRpcAuditContext({ userId, traceId, idempotencyKey }),
 *   },
 * });
 */
export function makeRpcAuditContext(context: RpcAuditContext): JsonObject {
  return removeUndefined({
    user_id: context.userId,
    telegram_user_id:
      typeof context.telegramUserId === "number"
        ? String(context.telegramUserId)
        : context.telegramUserId,
    idempotency_key: context.idempotencyKey,
    trace_id: context.traceId,
    source: context.source,
    ip_hash: context.ipHash,
    user_agent_hash: context.userAgentHash,
  });
}

/**
 * Main helper for Supabase RPC calls that represent a database transaction.
 *
 * Supabase JS cannot wrap multiple arbitrary API calls in one database transaction.
 * Therefore, every critical write operation should be implemented as one Postgres RPC.
 *
 * Correct pattern:
 * API route -> runRpcTransaction() -> Postgres RPC -> single SQL transaction.
 */
export async function runRpcTransaction<
  TData = JsonValue,
  TArgs extends RpcArgs = RpcArgs,
>(options: RpcTransactionOptions<TArgs>): Promise<TData> {
  const result = await runRpcTransactionWithMeta<TData, TArgs>(options);
  return result.data;
}

/**
 * Same as runRpcTransaction(), but also returns trace id, attempts, and duration.
 */
export async function runRpcTransactionWithMeta<
  TData = JsonValue,
  TArgs extends RpcArgs = RpcArgs,
>(options: RpcTransactionOptions<TArgs>): Promise<RpcTransactionResult<TData>> {
  const functionName = normalizeFunctionName(options.functionName);
  const schema = normalizeOptionalString(options.schema);
  const mode: TransactionMode = options.mode ?? "write";
  const traceId = options.traceId ?? createTraceId();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retry = resolveRetryOptions(mode, options.retry);
  const startedAt = Date.now();

  let lastError: DbTransactionError | undefined;

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    try {
      const response = await callRpcOnce<TData, TArgs>({
        schema,
        functionName,
        args: options.args,
        timeoutMs,
        traceId,
        mode,
        attempt,
      });

      if (response.error) {
        throw normalizeDbError(response.error, {
          traceId,
          schema,
          functionName,
          mode,
          attempt,
          status: response.status,
          statusText: response.statusText,
        });
      }

      if (options.throwOnNullData && response.data === null) {
        throw new DbTransactionError("RPC returned null data.", {
          code: "RPC_NULL_DATA",
          traceId,
          schema,
          functionName,
          mode,
          attempt,
        });
      }

      return {
        data: response.data as TData,
        meta: {
          traceId,
          schema,
          functionName,
          mode,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      const dbError = normalizeDbError(error, {
        traceId,
        schema,
        functionName,
        mode,
        attempt,
      });

      lastError = dbError;

      const isLastAttempt = attempt >= retry.maxAttempts;
      const canRetry = isRetryableDbError(dbError);

      if (isLastAttempt || !canRetry) {
        throw dbError;
      }

      const delayMs = computeRetryDelayMs(attempt, retry);

      if (options.onRetry) {
        await options.onRetry({
          traceId,
          schema,
          functionName,
          mode,
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts: retry.maxAttempts,
          delayMs,
          error: dbError,
        });
      }

      await sleep(delayMs);
    }
  }

  throw (
    lastError ??
    new DbTransactionError("RPC transaction failed.", {
      code: "RPC_TRANSACTION_FAILED",
      traceId,
      schema,
      functionName,
      mode,
    })
  );
}

export async function runReadRpc<
  TData = JsonValue,
  TArgs extends RpcArgs = RpcArgs,
>(options: Omit<RpcTransactionOptions<TArgs>, "mode">): Promise<TData> {
  return runRpcTransaction<TData, TArgs>({
    ...options,
    mode: "read",
  });
}

export async function runWriteRpc<
  TData = JsonValue,
  TArgs extends RpcArgs = RpcArgs,
>(options: Omit<RpcTransactionOptions<TArgs>, "mode">): Promise<TData> {
  return runRpcTransaction<TData, TArgs>({
    ...options,
    mode: "write",
  });
}

export function normalizeDbError(
  error: unknown,
  context: {
    traceId?: string | undefined;
    schema?: string | undefined;
    functionName?: string | undefined;
    mode?: TransactionMode | undefined;
    attempt?: number | undefined;
    status?: number | undefined;
    statusText?: string | undefined;
  } = {},
): DbTransactionError {
  if (error instanceof DbTransactionError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new DbTransactionError("Database RPC request was aborted.", {
      code: "RPC_ABORTED",
      traceId: context.traceId,
      schema: context.schema,
      functionName: context.functionName,
      mode: context.mode,
      attempt: context.attempt,
      cause: error,
    });
  }

  if (error instanceof Error) {
    const maybe = error as Error & Partial<NormalizedDbErrorInput>;

    return new DbTransactionError(maybe.message || "Database RPC failed.", {
      code: maybe.code,
      details: maybe.details,
      hint: maybe.hint,
      status: maybe.status ?? context.status,
      statusText: maybe.statusText ?? context.statusText,
      traceId: context.traceId,
      schema: context.schema,
      functionName: context.functionName,
      mode: context.mode,
      attempt: context.attempt,
      cause: error,
    });
  }

  if (isRecord(error)) {
    const message =
      typeof error.message === "string"
        ? error.message
        : "Database RPC failed.";

    return new DbTransactionError(message, {
      code: typeof error.code === "string" ? error.code : undefined,
      details:
        typeof error.details === "string" || isJsonValue(error.details)
          ? error.details
          : undefined,
      hint: typeof error.hint === "string" ? error.hint : undefined,
      status: typeof error.status === "number" ? error.status : context.status,
      statusText:
        typeof error.statusText === "string"
          ? error.statusText
          : context.statusText,
      traceId: context.traceId,
      schema: context.schema,
      functionName: context.functionName,
      mode: context.mode,
      attempt: context.attempt,
      cause: error,
    });
  }

  return new DbTransactionError("Unknown database RPC error.", {
    code: "UNKNOWN_DB_ERROR",
    traceId: context.traceId,
    schema: context.schema,
    functionName: context.functionName,
    mode: context.mode,
    attempt: context.attempt,
    cause: error,
  });
}

export function isRetryableDbError(error: DbTransactionError): boolean {
  if (error.code && NON_RETRYABLE_DB_CODES.has(error.code)) {
    return false;
  }

  if (error.code && RETRYABLE_DB_CODES.has(error.code)) {
    return true;
  }

  if (error.code?.startsWith("08")) {
    return true;
  }

  if (
    error.status === 408 ||
    error.status === 429 ||
    error.status === 500 ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504
  ) {
    return true;
  }

  return false;
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface RpcResponse<TData> {
  data: TData | null;
  error: unknown | null;
  status?: number;
  statusText?: string;
}

type RpcQuery<TData> = PromiseLike<RpcResponse<TData>> & {
  abortSignal?: (signal: AbortSignal) => RpcQuery<TData>;
};

type RpcInvoker = {
  rpc: <TData>(functionName: string, args: RpcArgs) => RpcQuery<TData>;
  schema: (schema: string) => RpcInvoker;
};

async function callRpcOnce<TData, TArgs extends RpcArgs>(input: {
  schema?: string | undefined;
  functionName: string;
  args?: TArgs | undefined;
  timeoutMs: number;
  traceId: string;
  mode: TransactionMode;
  attempt: number;
}): Promise<RpcResponse<TData>> {
  const baseClient = supabaseAdmin as unknown as RpcInvoker;
  const client = input.schema ? baseClient.schema(input.schema) : baseClient;

  let query = client.rpc<TData>(input.functionName, input.args ?? {});

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : undefined;

  if (controller && typeof query.abortSignal === "function") {
    query = query.abortSignal(controller.signal);
  }

  if (!input.timeoutMs || input.timeoutMs <= 0) {
    return (await query) as RpcResponse<TData>;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<RpcResponse<TData>>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();

      reject(
        new DbTransactionError("Database RPC request timed out.", {
          code: "RPC_TIMEOUT",
          traceId: input.traceId,
          schema: input.schema,
          functionName: input.functionName,
          mode: input.mode,
          attempt: input.attempt,
        }),
      );
    }, input.timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve(query as Promise<RpcResponse<TData>>),
      timeoutPromise,
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function resolveRetryOptions(
  mode: TransactionMode,
  retry: RpcTransactionOptions["retry"],
): RetryOptions {
  if (retry === false) {
    return {
      ...DEFAULT_WRITE_RETRY,
      maxAttempts: 1,
    };
  }

  const base = mode === "read" ? DEFAULT_READ_RETRY : DEFAULT_WRITE_RETRY;

  if (!retry) {
    return base;
  }

  return {
    maxAttempts: clampInteger(retry.maxAttempts ?? base.maxAttempts, 1, 10),
    minDelayMs: clampInteger(retry.minDelayMs ?? base.minDelayMs, 0, 60_000),
    maxDelayMs: clampInteger(retry.maxDelayMs ?? base.maxDelayMs, 0, 120_000),
    factor: clampNumber(retry.factor ?? base.factor, 1, 10),
    jitter: clampNumber(retry.jitter ?? base.jitter, 0, 1),
  };
}

function computeRetryDelayMs(
  failedAttempt: number,
  retry: RetryOptions,
): number {
  const exponential =
    retry.minDelayMs * Math.pow(retry.factor, Math.max(0, failedAttempt - 1));

  const capped = Math.min(exponential, retry.maxDelayMs);
  const spread = capped * retry.jitter;
  const min = Math.max(0, capped - spread);
  const max = capped + spread;

  return Math.round(min + Math.random() * (max - min));
}

function normalizeFunctionName(functionName: string): string {
  const trimmed = functionName.trim();

  if (!trimmed) {
    throw new DbTransactionError("RPC function name is required.", {
      code: "RPC_FUNCTION_REQUIRED",
    });
  }

  return trimmed;
}

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function removeUndefined(input: Record<string, unknown>): JsonObject {
  const output: JsonObject = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }

    const safe = toJsonSafe(value);

    if (safe !== undefined) {
      output[key] = safe;
    }
  }

  return output;
}

function toJsonSafe(value: unknown): JsonValue | undefined {
  if (value === undefined || typeof value === "function") {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafe(item) ?? null);
  }

  if (isRecord(value)) {
    const output: JsonObject = {};

    for (const [key, item] of Object.entries(value)) {
      const safe = toJsonSafe(item);

      if (safe !== undefined) {
        output[key] = safe;
      }
    }

    return output;
  }

  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}
