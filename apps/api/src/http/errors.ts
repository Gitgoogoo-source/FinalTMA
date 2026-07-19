import {
  errorDefinition,
  isErrorCode,
  type ErrorCode,
} from "@pokepets/api-contracts/common";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
    readonly operationId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function normalizeError(
  error: unknown,
  allowedErrors: readonly ErrorCode[] = [],
): ApiError {
  if (error instanceof ApiError) {
    if (!isAllowed(error.code, allowedErrors))
      return fromDefinition("INTERNAL_ERROR");
    const normalized = fromDefinition(error.code);
    return new ApiError(
      normalized.status,
      normalized.code,
      normalized.message,
      normalized.retryable,
      error.details,
      error.operationId,
    );
  }
  if (error instanceof Error) {
    const typed = error as Error & { code?: unknown; statusCode?: unknown };
    if (typeof typed.code === "string") {
      const code = typed.code.startsWith("TON_PROOF_")
        ? "WALLET_PROOF_INVALID"
        : typed.code;
      if (isErrorCode(code) && isAllowed(code, allowedErrors))
        return fromDefinition(code);
    }
    const separator = error.message.indexOf(":");
    if (separator > 0) {
      const code = error.message.slice(0, separator);
      if (isErrorCode(code) && isAllowed(code, allowedErrors))
        return fromDefinition(code);
    }
  }
  return fromDefinition("INTERNAL_ERROR");
}

function isAllowed(
  code: ErrorCode,
  allowedErrors: readonly ErrorCode[],
): boolean {
  return allowedErrors.includes(code);
}

function fromDefinition(code: ErrorCode): ApiError {
  const definition = errorDefinition(code);
  return new ApiError(
    definition.status,
    code,
    definition.message,
    definition.retryable,
  );
}
