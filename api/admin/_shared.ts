import { createHash } from "node:crypto";

import type { VercelRequest } from "@vercel/node";
import type { ApiContext } from "../_shared/handler.js";
import {
  ApiError,
  getHeaderValue,
  getIdempotencyKey,
} from "../_shared/handler.js";
import type { AdminContext } from "../_shared/requireAdmin.js";
import {
  runWriteRpc,
  type JsonObject,
  type JsonValue,
} from "../../packages/server/src/db/transactions.js";

export type JsonRecord = Record<string, unknown>;

export const DEFAULT_ADMIN_LIMIT = 20;
export const MAX_ADMIN_LIMIT = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return firstQueryValue(value[0]);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

export function parseAdminLimit(value: unknown): number {
  const raw = firstQueryValue(value);
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_ADMIN_LIMIT;

  if (!Number.isFinite(parsed)) {
    return DEFAULT_ADMIN_LIMIT;
  }

  return Math.min(Math.max(parsed, 1), MAX_ADMIN_LIMIT);
}

export function parseOffsetCursor(value: unknown): number {
  const raw = firstQueryValue(value);

  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function buildNextCursor(
  rowsLength: number,
  limit: number,
  offset: number,
): string | null {
  return rowsLength > limit ? String(offset + limit) : null;
}

export function normalizeUuid(value: unknown): string | undefined {
  const raw = firstQueryValue(value);
  return raw && UUID_RE.test(raw) ? raw : undefined;
}

export function normalizeRequiredUuid(value: unknown, field: string): string {
  const normalized =
    typeof value === "string" && UUID_RE.test(value) ? value : undefined;

  if (!normalized) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be a UUID`);
  }

  return normalized;
}

export function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

export function normalizeRequiredText(value: unknown, field: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} is required`);
  }

  return normalized;
}

export function normalizeBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  throw new ApiError(400, "VALIDATION_FAILED", `${field} must be boolean`);
}

export function normalizeStatus(value: unknown): string | undefined {
  const normalized = firstQueryValue(value)?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

export function normalizeDateStart(value: unknown): string | undefined {
  const raw = firstQueryValue(value);
  return raw ? `${raw}T00:00:00.000Z` : undefined;
}

export function normalizeDateEnd(value: unknown): string | undefined {
  const raw = firstQueryValue(value);
  return raw ? `${raw}T23:59:59.999Z` : undefined;
}

export function requireAdminConfirmation(
  req: VercelRequest,
  body: JsonRecord,
): void {
  const header = getHeaderValue(req.headers["x-admin-confirm"]);
  const confirmed =
    body.confirm === true ||
    body.dangerConfirmed === true ||
    header?.trim().toLowerCase() === "true";

  if (!confirmed) {
    throw new ApiError(
      400,
      "ADMIN_CONFIRMATION_REQUIRED",
      "High-risk admin operation requires confirmation",
    );
  }
}

export function requireAdminConfirmHeader(req: VercelRequest): void {
  const header = getHeaderValue(req.headers["x-admin-confirm"]);

  if (header?.trim().toLowerCase() !== "true") {
    throw new ApiError(
      400,
      "ADMIN_CONFIRMATION_REQUIRED",
      "High-risk admin operation requires X-Admin-Confirm: true",
    );
  }
}

export function readBodyIdempotencyKey(
  req: VercelRequest,
  body: JsonRecord,
): string {
  const fromHeader = getIdempotencyKey(req);
  const fromBody = normalizeOptionalText(body.idempotencyKey);
  const idempotencyKey = fromHeader ?? fromBody;

  if (!idempotencyKey) {
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency key is required",
    );
  }

  return idempotencyKey;
}

export function readHeaderIdempotencyKey(req: VercelRequest): string {
  const idempotencyKey = getIdempotencyKey(req);

  if (!idempotencyKey) {
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "X-Idempotency-Key header is required",
    );
  }

  return idempotencyKey;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asJsonRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function toJsonObject(value: JsonRecord): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function hashAuditValue(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return createHash("sha256").update(normalized).digest("hex");
}

export function buildAdminRpcContext(
  admin: AdminContext,
  ctx: ApiContext,
): JsonObject {
  return toJsonObject({
    request_id: ctx.requestId,
    admin_user_id: admin.adminId,
    session_id: admin.sessionId,
    ip_hash: hashAuditValue(ctx.ip),
    user_agent_hash: hashAuditValue(ctx.userAgent),
  });
}

export async function callAdminWriteRpc<TResult = JsonObject>(input: {
  functionName: string;
  args: Record<string, JsonValue | undefined>;
  requestId: string;
}): Promise<TResult> {
  const result = await runWriteRpc<TResult>({
    schema: "api",
    functionName: input.functionName,
    args: input.args,
    traceId: input.requestId,
    label: input.functionName,
  });

  assertAdminWriteAuditResult(result, input.functionName);

  return result;
}

export function mapAdminRpcError(
  error: unknown,
  fallbackCode: string,
): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const knownCode = extractKnownAdminErrorCode(message);

  if (knownCode) {
    const status =
      knownCode === "ADMIN_IDEMPOTENCY_CONFLICT"
        ? 409
        : knownCode.endsWith("_NOT_FOUND")
          ? 404
          : knownCode.includes("NOT_RETRYABLE")
            ? 409
            : 400;

    return new ApiError(status, knownCode, knownCode, {
      details: { message },
      expose: true,
      cause: error,
    });
  }

  return new ApiError(500, fallbackCode, "Admin operation failed", {
    details: { message },
    expose: false,
    cause: error,
  });
}

function assertAdminWriteAuditResult(
  value: unknown,
  functionName: string,
): void {
  if (
    !isRecord(value) ||
    typeof value.audit_log_id !== "string" ||
    value.audit_log_id.trim().length === 0
  ) {
    throw new ApiError(
      500,
      "ADMIN_AUDIT_LOG_REQUIRED",
      "Admin write RPC did not return audit_log_id.",
      {
        details: { functionName },
        expose: false,
      },
    );
  }
}

function extractKnownAdminErrorCode(message: string): string | null {
  const match = message.match(
    /(ADMIN_[A-Z0-9_]+|RISK_[A-Z0-9_]+|MINT_QUEUE_[A-Z0-9_]+|FEATURE_FLAG_[A-Z0-9_]+)/,
  );

  return match?.[1] ?? null;
}
