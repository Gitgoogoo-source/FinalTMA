import { ApiError } from "../_shared/handler.js";
import { RpcError } from "../../packages/server/src/db/rpc.js";

export type JsonRecord = Record<string, unknown>;

export function assertRecordPayload(
  payload: unknown,
  code: string,
  message: string,
): JsonRecord {
  if (!isRecord(payload)) {
    throw new ApiError(500, code, message, {
      expose: false,
      details: { payloadType: typeof payload },
    });
  }

  return payload;
}

export function invalidInventoryResult(
  code: string,
  message: string,
  details?: unknown,
): ApiError {
  return new ApiError(500, code, message, {
    details,
    expose: false,
  });
}

export function mapUnexpectedInventoryError(
  error: unknown,
  code: string,
  message: string,
): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal(message, { cause: getErrorMessage(error) });
  }

  return new ApiError(500, code, message, {
    cause: error,
    expose: false,
  });
}

export function getRpcErrorText(error: RpcError): string {
  return [error.message, error.details, error.hint, error.code]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

export function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }

  return null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(readString).filter((item): item is string => item !== null);
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
