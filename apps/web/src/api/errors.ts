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

const API_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  AUTH_INIT_DATA_INVALID: "Telegram 登录校验失败，请重新进入应用。",
  AUTH_SESSION_EXPIRED: "登录状态已过期，请重新进入应用。",
  USER_BLOCKED: "当前账号已被限制使用。",
  BOX_NOT_FOUND: "盲盒不存在。",
  BOX_NOT_ACTIVE: "当前盲盒不可开启。",
  BOX_STOCK_NOT_ENOUGH: "盲盒库存不足。",
  DRAW_COUNT_INVALID: "开盒次数只能是 1 或 10。",
  ORDER_ALREADY_PROCESSED: "订单已处理。",
  ORDER_NOT_FOUND: "订单不存在或不属于当前用户。",
  DROP_POOL_EMPTY: "当前奖励池为空，暂时无法开盒。",
  BALANCE_LEDGER_FAILED: "资产流水写入失败，请稍后重试。",
  INVENTORY_CREATE_FAILED: "库存写入失败，请稍后查看结果。",
  IDEMPOTENCY_CONFLICT: "请求已被其他操作占用，请刷新后重试。",
  IDEMPOTENCY_KEY_REQUIRED: "请求缺少幂等键，请重试。",
  ITEM_ALREADY_LOCKED: "藏品已被锁定。",
  ITEM_NOT_FOUND: "部分藏品不存在。",
  ITEM_NOT_SELLABLE: "部分藏品不可出售。",
  MARKET_PRICE_INVALID: "挂单价格无效。",

  TELEGRAM_INIT_DATA_INVALID: "Telegram 登录校验失败，请重新进入应用。",
  SESSION_EXPIRED: "登录状态已过期，请重新进入应用。",
  UNAUTHORIZED: "登录状态已过期，请重新进入应用。",
};

const UNAUTHORIZED_ERROR_CODES = new Set([
  "AUTH_SESSION_REQUIRED",
  "AUTH_SESSION_INVALID",
  "AUTH_SESSION_EXPIRED",
  "AUTH_INIT_DATA_INVALID",
  "SESSION_EXPIRED",
  "TELEGRAM_INIT_DATA_INVALID",
  "UNAUTHORIZED",
]);

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
    (error.status === 401 || UNAUTHORIZED_ERROR_CODES.has(error.code))
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
    return API_ERROR_MESSAGES[error.code] ?? error.message;
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
