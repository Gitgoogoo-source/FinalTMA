export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
    readonly operationId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) {
    const typed = error as Error & { code?: unknown; statusCode?: unknown };
    if (
      typeof typed.code === "string" &&
      /^[A-Z][A-Z0-9_]+$/.test(typed.code)
    ) {
      const status =
        typeof typed.statusCode === "number"
          ? typed.statusCode
          : typed.code.startsWith("TON_PROOF_")
            ? 401
            : 409;
      return new ApiError(
        status,
        typed.code,
        typed.code.startsWith("TON_PROOF_")
          ? "TON 钱包验证失败，请重新连接"
          : typed.message,
      );
    }
    const separator = error.message.indexOf(":");
    if (
      separator > 0 &&
      /^[A-Z][A-Z0-9_]+$/.test(error.message.slice(0, separator))
    ) {
      const code = error.message.slice(0, separator);
      return new ApiError(
        statusFor(code),
        code,
        error.message.slice(separator + 1),
        false,
      );
    }
  }
  return new ApiError(500, "INTERNAL_ERROR", "服务暂时不可用", true);
}

function statusFor(code: string): number {
  if (code === "RATE_LIMITED") return 429;
  if (code.startsWith("SESSION_") || code.startsWith("TELEGRAM_")) return 401;
  if (code === "ACCOUNT_RESTRICTED") return 403;
  if (code === "API_ROUTE_NOT_FOUND" || code.endsWith("_NOT_FOUND")) return 404;
  if (code === "METHOD_NOT_ALLOWED") return 405;
  return 409;
}
