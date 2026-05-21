import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import {
  DbTransactionError,
  type JsonObject,
  type JsonValue,
  type RpcArgs,
  type RpcTransactionOptions,
  normalizeDbError,
  runRpcTransaction,
} from "./transactions";

export type IdempotencyStatus = "started" | "completed" | "failed";

export type IdempotencyReservationKind =
  | "locked"
  | "cached"
  | "in_progress"
  | "failed"
  | "mismatch";

export type IdempotencyErrorCode =
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_SCOPE_REQUIRED"
  | "IDEMPOTENCY_KEY_TOO_LONG"
  | "IDEMPOTENCY_SCOPE_TOO_LONG"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_SCOPE_INVALID"
  | "IDEMPOTENCY_REQUEST_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "IDEMPOTENCY_PREVIOUSLY_FAILED"
  | "IDEMPOTENCY_LOCK_LOST"
  | "IDEMPOTENCY_RECORD_NOT_FOUND";

export interface IdempotencyRecord {
  key: string;
  user_id: string | null;
  scope: string;
  request_hash: string | null;
  response: JsonValue | null;
  status: IdempotencyStatus;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReserveIdempotencyInput {
  scope: string;
  key: string;
  userId?: string | null | undefined;
  requestPayload?: unknown | undefined;
  requestHash?: string | undefined;
  lockMs?: number | undefined;
  ttlMs?: number | undefined;
  retryOnFailure?: boolean | undefined;
  traceId?: string | undefined;
  metadata?: JsonObject | undefined;
}

export interface LockedReservation {
  kind: "locked";
  scope: string;
  key: string;
  requestHash: string;
  lockToken: string;
  record: IdempotencyRecord;
}

export interface CachedReservation<TData = JsonValue> {
  kind: "cached";
  scope: string;
  key: string;
  requestHash: string;
  data: TData;
  record: IdempotencyRecord;
}

export interface InProgressReservation {
  kind: "in_progress";
  scope: string;
  key: string;
  requestHash: string;
  retryAfterMs: number;
  record: IdempotencyRecord;
}

export interface FailedReservation {
  kind: "failed";
  scope: string;
  key: string;
  requestHash: string;
  record: IdempotencyRecord;
}

export interface MismatchReservation {
  kind: "mismatch";
  scope: string;
  key: string;
  incomingRequestHash: string;
  storedRequestHash: string;
  record: IdempotencyRecord;
}

export type IdempotencyReservation<TData = JsonValue> =
  | LockedReservation
  | CachedReservation<TData>
  | InProgressReservation
  | FailedReservation
  | MismatchReservation;

export interface CompleteIdempotencyInput<TData extends JsonValue = JsonValue> {
  scope: string;
  key: string;
  requestHash: string;
  lockToken: string;
  response: TData;
  traceId?: string | undefined;
}

export interface FailIdempotencyInput {
  scope: string;
  key: string;
  requestHash: string;
  lockToken: string;
  error: unknown;
  traceId?: string | undefined;
}

export interface WithIdempotencyInput<TData extends JsonValue = JsonValue> {
  scope: string;
  key: string;
  userId?: string | null | undefined;
  requestPayload?: unknown | undefined;
  requestHash?: string | undefined;
  lockMs?: number | undefined;
  ttlMs?: number | undefined;
  retryOnFailure?: boolean | undefined;
  traceId?: string | undefined;
  metadata?: JsonObject | undefined;
  handler: (context: IdempotencyExecutionContext) => Promise<TData>;
}

export interface IdempotencyExecutionContext {
  scope: string;
  key: string;
  requestHash: string;
  lockToken: string;
  traceId?: string | undefined;
  record: IdempotencyRecord;
}

export interface IdempotentExecutionResult<
  TData extends JsonValue = JsonValue,
> {
  data: TData;
  replayed: boolean;
  scope: string;
  key: string;
  requestHash: string;
  record: IdempotencyRecord;
}

export interface RunIdempotentRpcTransactionInput<
  TData extends JsonValue = JsonValue,
  TArgs extends RpcArgs = RpcArgs,
> {
  idempotency: Omit<WithIdempotencyInput<TData>, "handler">;
  transaction: RpcTransactionOptions<TArgs>;
}

export class IdempotencyError extends Error {
  override readonly name = "IdempotencyError";
  readonly code: IdempotencyErrorCode;
  readonly status: number;
  readonly details: JsonObject | undefined;
  override readonly cause: unknown;

  constructor(
    message: string,
    options: {
      code: IdempotencyErrorCode;
      status?: number;
      details?: JsonObject | undefined;
      cause?: unknown;
    },
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.code = options.code;
    this.status = options.status ?? 409;
    this.details = options.details;
    this.cause = options.cause;
  }

  toJSON(): JsonObject {
    return removeUndefined({
      name: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      details: this.details,
    });
  }
}

const IDEMPOTENCY_SCHEMA = "ops";
const IDEMPOTENCY_TABLE = "idempotency_keys";

const DEFAULT_LOCK_MS = 2 * 60 * 1000;
const MAX_KEY_LENGTH = 180;
const MAX_SCOPE_LENGTH = 120;

const SAFE_KEY_PATTERN = /^[a-zA-Z0-9:_./-]+$/;
const SAFE_SCOPE_PATTERN = /^[a-zA-Z0-9:_./-]+$/;

export async function withIdempotency<TData extends JsonValue = JsonValue>(
  input: WithIdempotencyInput<TData>,
): Promise<IdempotentExecutionResult<TData>> {
  const reservation = await reserveIdempotencyKey<TData>({
    scope: input.scope,
    key: input.key,
    userId: input.userId,
    requestPayload: input.requestPayload,
    requestHash: input.requestHash,
    lockMs: input.lockMs,
    ttlMs: input.ttlMs,
    retryOnFailure: input.retryOnFailure,
    traceId: input.traceId,
    metadata: input.metadata,
  });

  if (reservation.kind === "cached") {
    return {
      data: reservation.data,
      replayed: true,
      scope: reservation.scope,
      key: reservation.key,
      requestHash: reservation.requestHash,
      record: reservation.record,
    };
  }

  if (reservation.kind === "mismatch") {
    throw new IdempotencyError(
      "The same idempotency key was used with a different request payload.",
      {
        code: "IDEMPOTENCY_REQUEST_MISMATCH",
        status: 409,
        details: {
          scope: reservation.scope,
          key: reservation.key,
          incoming_request_hash: reservation.incomingRequestHash,
          stored_request_hash: reservation.storedRequestHash,
        },
      },
    );
  }

  if (reservation.kind === "in_progress") {
    throw new IdempotencyError(
      "An operation with the same idempotency key is still processing.",
      {
        code: "IDEMPOTENCY_IN_PROGRESS",
        status: 409,
        details: {
          scope: reservation.scope,
          key: reservation.key,
          retry_after_ms: reservation.retryAfterMs,
        },
      },
    );
  }

  if (reservation.kind === "failed") {
    throw new IdempotencyError(
      "An operation with the same idempotency key previously failed.",
      {
        code: "IDEMPOTENCY_PREVIOUSLY_FAILED",
        status: 409,
        details: {
          scope: reservation.scope,
          key: reservation.key,
          response: reservation.record.response,
        },
      },
    );
  }

  try {
    const data = await input.handler({
      scope: reservation.scope,
      key: reservation.key,
      requestHash: reservation.requestHash,
      lockToken: reservation.lockToken,
      traceId: input.traceId,
      record: reservation.record,
    });

    const completedRecord = await completeIdempotencyKey<TData>({
      scope: reservation.scope,
      key: reservation.key,
      requestHash: reservation.requestHash,
      lockToken: reservation.lockToken,
      response: data,
      traceId: input.traceId,
    });

    return {
      data,
      replayed: false,
      scope: reservation.scope,
      key: reservation.key,
      requestHash: reservation.requestHash,
      record: completedRecord,
    };
  } catch (error) {
    try {
      await failIdempotencyKey({
        scope: reservation.scope,
        key: reservation.key,
        requestHash: reservation.requestHash,
        lockToken: reservation.lockToken,
        error,
        traceId: input.traceId,
      });
    } catch (markFailedError) {
      if (error && typeof error === "object") {
        (error as Record<string, unknown>).idempotencyMarkFailedError =
          normalizeErrorForStorage(markFailedError);
      }
    }

    throw error;
  }
}

export async function runIdempotentRpcTransaction<
  TData extends JsonValue = JsonValue,
  TArgs extends RpcArgs = RpcArgs,
>(
  input: RunIdempotentRpcTransactionInput<TData, TArgs>,
): Promise<IdempotentExecutionResult<TData>> {
  return withIdempotency<TData>({
    ...input.idempotency,
    handler: async () => {
      return await runRpcTransaction<TData, TArgs>(input.transaction);
    },
  });
}

export async function reserveIdempotencyKey<TData = JsonValue>(
  input: ReserveIdempotencyInput,
): Promise<IdempotencyReservation<TData>> {
  const scope = normalizeScope(input.scope);
  const key = normalizeIdempotencyKey(input.key);
  const requestHash =
    input.requestHash ?? hashIdempotencyPayload(input.requestPayload ?? {});
  const lockMs = input.lockMs ?? DEFAULT_LOCK_MS;
  const now = new Date();
  const lockToken = addMs(now, lockMs).toISOString();

  const { data, error } = await idempotencyTable()
    .insert({
      key,
      user_id: input.userId ?? null,
      scope,
      request_hash: requestHash,
      response: null,
      status: "started" satisfies IdempotencyStatus,
      locked_until: lockToken,
      updated_at: now.toISOString(),
    })
    .select("*")
    .single();

  if (!error && data) {
    return {
      kind: "locked",
      scope,
      key,
      requestHash,
      lockToken,
      record: castRecord(data),
    };
  }

  if (!isUniqueViolation(error)) {
    throw normalizeDbError(error, {
      schema: IDEMPOTENCY_SCHEMA,
      functionName: "reserve_idempotency_key",
    });
  }

  const existing = await getIdempotencyRecord(scope, key);

  if (!existing) {
    throw new IdempotencyError("Idempotency record was not found.", {
      code: "IDEMPOTENCY_RECORD_NOT_FOUND",
      status: 500,
      details: {
        scope,
        key,
      },
    });
  }

  return resolveExistingReservation<TData>({
    record: existing,
    requestHash,
    lockMs,
    retryOnFailure: input.retryOnFailure ?? true,
  });
}

export async function completeIdempotencyKey<
  TData extends JsonValue = JsonValue,
>(input: CompleteIdempotencyInput<TData>): Promise<IdempotencyRecord> {
  const scope = normalizeScope(input.scope);
  const key = normalizeIdempotencyKey(input.key);
  const nowIso = new Date().toISOString();

  const { data, error } = await idempotencyTable()
    .update({
      status: "completed" satisfies IdempotencyStatus,
      response: toJsonValue(input.response),
      locked_until: null,
      updated_at: nowIso,
    })
    .eq("scope", scope)
    .eq("key", key)
    .eq("request_hash", input.requestHash)
    .eq("status", "started")
    .eq("locked_until", input.lockToken)
    .select("*")
    .maybeSingle();

  if (error) {
    throw normalizeDbError(error, {
      schema: IDEMPOTENCY_SCHEMA,
      functionName: "complete_idempotency_key",
    });
  }

  if (!data) {
    throw new IdempotencyError("Idempotency lock was lost before completion.", {
      code: "IDEMPOTENCY_LOCK_LOST",
      status: 409,
      details: {
        scope,
        key,
      },
    });
  }

  return castRecord(data);
}

export async function failIdempotencyKey(
  input: FailIdempotencyInput,
): Promise<IdempotencyRecord> {
  const scope = normalizeScope(input.scope);
  const key = normalizeIdempotencyKey(input.key);
  const nowIso = new Date().toISOString();

  const { data, error } = await idempotencyTable()
    .update({
      status: "failed" satisfies IdempotencyStatus,
      response: normalizeErrorForStorage(input.error),
      locked_until: null,
      updated_at: nowIso,
    })
    .eq("scope", scope)
    .eq("key", key)
    .eq("request_hash", input.requestHash)
    .eq("status", "started")
    .eq("locked_until", input.lockToken)
    .select("*")
    .maybeSingle();

  if (error) {
    throw normalizeDbError(error, {
      schema: IDEMPOTENCY_SCHEMA,
      functionName: "fail_idempotency_key",
    });
  }

  if (!data) {
    throw new IdempotencyError("Idempotency lock was lost before failure.", {
      code: "IDEMPOTENCY_LOCK_LOST",
      status: 409,
      details: {
        scope,
        key,
      },
    });
  }

  return castRecord(data);
}

export async function getIdempotencyRecord(
  scopeInput: string,
  keyInput: string,
): Promise<IdempotencyRecord | null> {
  const scope = normalizeScope(scopeInput);
  const key = normalizeIdempotencyKey(keyInput);

  const { data, error } = await idempotencyTable()
    .select("*")
    .eq("scope", scope)
    .eq("key", key)
    .maybeSingle();

  if (error) {
    throw normalizeDbError(error, {
      schema: IDEMPOTENCY_SCHEMA,
      functionName: "get_idempotency_record",
    });
  }

  return data ? castRecord(data) : null;
}

export function createIdempotencyKey(prefix?: string): string {
  if (!prefix) {
    return randomUUID();
  }

  const normalizedPrefix = normalizeScope(prefix);
  return `${normalizedPrefix}:${randomUUID()}`;
}

export function normalizeIdempotencyKey(keyInput: string): string {
  const key = keyInput?.trim();

  if (!key) {
    throw new IdempotencyError("Idempotency key is required.", {
      code: "IDEMPOTENCY_KEY_REQUIRED",
      status: 400,
    });
  }

  if (key.length > MAX_KEY_LENGTH) {
    throw new IdempotencyError("Idempotency key is too long.", {
      code: "IDEMPOTENCY_KEY_TOO_LONG",
      status: 400,
      details: {
        max_length: MAX_KEY_LENGTH,
      },
    });
  }

  if (!SAFE_KEY_PATTERN.test(key)) {
    throw new IdempotencyError("Idempotency key contains invalid characters.", {
      code: "IDEMPOTENCY_KEY_INVALID",
      status: 400,
      details: {
        allowed: "letters, numbers, colon, underscore, dot, slash, hyphen",
      },
    });
  }

  return key;
}

export function normalizeScope(scopeInput: string): string {
  const scope = scopeInput?.trim();

  if (!scope) {
    throw new IdempotencyError("Idempotency scope is required.", {
      code: "IDEMPOTENCY_SCOPE_REQUIRED",
      status: 400,
    });
  }

  if (scope.length > MAX_SCOPE_LENGTH) {
    throw new IdempotencyError("Idempotency scope is too long.", {
      code: "IDEMPOTENCY_SCOPE_TOO_LONG",
      status: 400,
      details: {
        max_length: MAX_SCOPE_LENGTH,
      },
    });
  }

  if (!SAFE_SCOPE_PATTERN.test(scope)) {
    throw new IdempotencyError(
      "Idempotency scope contains invalid characters.",
      {
        code: "IDEMPOTENCY_SCOPE_INVALID",
        status: 400,
        details: {
          allowed: "letters, numbers, colon, underscore, dot, slash, hyphen",
        },
      },
    );
  }

  return scope;
}

export function hashIdempotencyPayload(payload: unknown): string {
  const stablePayload = stableStringify(payload);
  return createHash("sha256").update(stablePayload).digest("hex");
}

export function getIdempotencyKeyFromHeaders(
  headers: Headers | Record<string, string | string[] | undefined | null>,
): string | null {
  const value =
    getHeader(headers, "Idempotency-Key") ??
    getHeader(headers, "X-Idempotency-Key");

  if (!value) {
    return null;
  }

  return normalizeIdempotencyKey(value);
}

async function resolveExistingReservation<TData>(input: {
  record: IdempotencyRecord;
  requestHash: string;
  lockMs: number;
  retryOnFailure: boolean;
}): Promise<IdempotencyReservation<TData>> {
  const { record, requestHash } = input;

  if (record.request_hash !== requestHash) {
    return {
      kind: "mismatch",
      scope: record.scope,
      key: record.key,
      incomingRequestHash: requestHash,
      storedRequestHash: record.request_hash ?? "",
      record,
    };
  }

  if (record.status === "completed") {
    return {
      kind: "cached",
      scope: record.scope,
      key: record.key,
      requestHash,
      data: record.response as TData,
      record,
    };
  }

  if (record.status === "started") {
    if (!isLockExpired(record)) {
      return {
        kind: "in_progress",
        scope: record.scope,
        key: record.key,
        requestHash,
        retryAfterMs: getRetryAfterMs(record),
        record,
      };
    }

    return takeOverRecord<TData>({
      record,
      requestHash,
      lockMs: input.lockMs,
    });
  }

  if (!input.retryOnFailure) {
    return {
      kind: "failed",
      scope: record.scope,
      key: record.key,
      requestHash,
      record,
    };
  }

  return takeOverRecord<TData>({
    record,
    requestHash,
    lockMs: input.lockMs,
  });
}

async function takeOverRecord<TData>(input: {
  record: IdempotencyRecord;
  requestHash: string;
  lockMs: number;
}): Promise<IdempotencyReservation<TData>> {
  const now = new Date();
  const lockToken = addMs(now, input.lockMs).toISOString();

  let query = idempotencyTable()
    .update({
      status: "started" satisfies IdempotencyStatus,
      locked_until: lockToken,
      updated_at: now.toISOString(),
    })
    .eq("scope", input.record.scope)
    .eq("key", input.record.key)
    .eq("request_hash", input.requestHash)
    .eq("status", input.record.status);

  if (input.record.locked_until) {
    query = query.eq("locked_until", input.record.locked_until);
  } else {
    query = query.is("locked_until", null);
  }

  const { data, error } = await query.select("*").maybeSingle();

  if (error) {
    throw normalizeDbError(error, {
      schema: IDEMPOTENCY_SCHEMA,
      functionName: "take_over_idempotency_record",
    });
  }

  if (!data) {
    const latest = await getIdempotencyRecord(
      input.record.scope,
      input.record.key,
    );

    if (!latest) {
      throw new IdempotencyError("Idempotency record was not found.", {
        code: "IDEMPOTENCY_RECORD_NOT_FOUND",
        status: 500,
        details: {
          scope: input.record.scope,
          key: input.record.key,
        },
      });
    }

    if (
      latest.status === "completed" &&
      latest.request_hash === input.requestHash
    ) {
      return {
        kind: "cached",
        scope: latest.scope,
        key: latest.key,
        requestHash: input.requestHash,
        data: latest.response as TData,
        record: latest,
      };
    }

    return {
      kind: "in_progress",
      scope: latest.scope,
      key: latest.key,
      requestHash: input.requestHash,
      retryAfterMs: getRetryAfterMs(latest),
      record: latest,
    };
  }

  const record = castRecord(data);

  return {
    kind: "locked",
    scope: record.scope,
    key: record.key,
    requestHash: input.requestHash,
    lockToken,
    record,
  };
}

function idempotencyTable() {
  return supabaseAdmin.schema(IDEMPOTENCY_SCHEMA).from(IDEMPOTENCY_TABLE);
}

function castRecord(data: unknown): IdempotencyRecord {
  return data as IdempotencyRecord;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;

  if (record.code === "23505") {
    return true;
  }

  if (
    typeof record.message === "string" &&
    record.message.toLowerCase().includes("duplicate key")
  ) {
    return true;
  }

  return false;
}

function isLockExpired(record: IdempotencyRecord): boolean {
  if (!record.locked_until) {
    return true;
  }

  return Date.parse(record.locked_until) <= Date.now();
}

function getRetryAfterMs(record: IdempotencyRecord): number {
  if (!record.locked_until) {
    return 0;
  }

  return Math.max(0, Date.parse(record.locked_until) - Date.now());
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + Math.max(0, ms));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value));
}

function toStableJsonValue(
  value: unknown,
  seen = new WeakSet<object>(),
): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item, seen));
  }

  if (value instanceof Error) {
    return removeUndefined({
      name: value.name,
      message: value.message,
    });
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new IdempotencyError("Circular payload cannot be hashed.", {
        code: "IDEMPOTENCY_KEY_INVALID",
        status: 400,
      });
    }

    seen.add(value);

    const output: JsonObject = {};
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );

    for (const [key, item] of entries) {
      if (
        item === undefined ||
        typeof item === "function" ||
        typeof item === "symbol"
      ) {
        continue;
      }

      output[key] = toStableJsonValue(item, seen);
    }

    seen.delete(value);

    return output;
  }

  return String(value);
}

function toJsonValue(value: unknown): JsonValue {
  return toStableJsonValue(value);
}

function normalizeErrorForStorage(error: unknown): JsonObject {
  if (error instanceof IdempotencyError) {
    return error.toJSON();
  }

  if (error instanceof DbTransactionError) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return removeUndefined({
      name: error.name,
      message: error.message,
    });
  }

  try {
    return {
      message: "Unknown error",
      value: toJsonValue(error),
    };
  } catch {
    return {
      message: "Unknown non-serializable error",
    };
  }
}

function removeUndefined(input: Record<string, unknown>): JsonObject {
  const output: JsonObject = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }

    output[key] = toJsonValue(value);
  }

  return output;
}

function getHeader(
  headers: Headers | Record<string, string | string[] | undefined | null>,
  name: string,
): string | null {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }

  const target = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) {
      continue;
    }

    if (Array.isArray(value)) {
      return value[0] ?? null;
    }

    return value ?? null;
  }

  return null;
}
