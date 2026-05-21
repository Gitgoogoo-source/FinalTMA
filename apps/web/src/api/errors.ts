export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiErrorResponse = {
  ok: false;
  error: ApiErrorPayload;
  requestId?: string;
};

export type ApiSuccessResponse<T> = {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
  requestId?: string;
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(options: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
    requestId?: string | undefined;
  }) {
    super(options.message);

    this.name = "ApiClientError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}

export function isUnauthorizedApiError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.status === 401 ||
      error.code === "AUTH_SESSION_REQUIRED" ||
      error.code === "AUTH_SESSION_INVALID" ||
      error.code === "AUTH_SESSION_EXPIRED" ||
      error.code === "UNAUTHORIZED")
  );
}

export function shouldRetryApiError(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) {
    return true;
  }

  if (error.status === 401 || error.status === 403) {
    return false;
  }

  if (error.status >= 400 && error.status < 500) {
    return false;
  }

  return true;
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "请求失败，请稍后重试。";
}

export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ApiErrorResponse>;

  return (
    candidate.ok === false &&
    typeof candidate.error === "object" &&
    candidate.error !== null &&
    typeof candidate.error.code === "string" &&
    typeof candidate.error.message === "string"
  );
}

export function isApiSuccessResponse<T>(
  value: unknown,
): value is ApiSuccessResponse<T> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ApiSuccessResponse<T>>;
  return candidate.ok === true && "data" in candidate;
}
