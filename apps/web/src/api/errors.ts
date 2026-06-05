export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiErrorResponse = {
  ok: false;
  success: false;
  error: ApiErrorPayload;
  requestId?: string;
};

export type ApiSuccessResponse<T> = {
  ok: true;
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  requestId?: string;
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

const API_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  AUTH_INIT_DATA_INVALID: "Telegram 登录校验失败，请重新进入应用。",
  AUTH_INIT_DATA_EXPIRED: "Telegram 登录凭证已过期，请重新进入应用。",
  AUTH_INIT_DATA_FROM_FUTURE: "Telegram 登录凭证时间无效，请重新进入应用。",
  AUTH_SESSION_EXPIRED: "登录状态已过期，请重新进入应用。",
  USER_BLOCKED: "当前账号已被限制使用。",
  BOX_NOT_FOUND: "盲盒不存在。",
  BOX_NOT_ACTIVE: "当前盲盒不可开启。",
  BOX_STOCK_NOT_ENOUGH: "当前盲盒暂时不可开启，请刷新后重试。",
  DRAW_COUNT_INVALID: "开盒次数只能是 1 或 10。",
  ORDER_ALREADY_PROCESSED: "订单已处理。",
  ORDER_NOT_FOUND: "订单不存在或不属于当前用户。",
  DROP_POOL_EMPTY: "当前奖励池为空，暂时无法开盒。",
  BALANCE_LEDGER_FAILED: "资产流水写入失败，请稍后重试。",
  INVENTORY_CREATE_FAILED: "库存写入失败，请稍后查看结果。",
  IDEMPOTENCY_CONFLICT: "请求已被其他操作占用，请刷新后重试。",
  IDEMPOTENCY_KEY_REQUIRED: "请求缺少幂等键，请重试。",
  ITEM_ALREADY_LOCKED: "当前藏品已被锁定。",
  ITEM_NOT_FOUND: "部分藏品不存在。",
  ITEM_NOT_SELLABLE: "部分藏品不可出售。",
  MARKET_PRICE_INVALID: "挂单价格无效。",
  LISTING_NOT_FOUND: "挂单不存在或已下架。",
  LISTING_NOT_BUYABLE: "挂单当前不可购买，请刷新后重试。",
  LISTING_NOT_ACTIVE: "当前挂单状态不可操作。",
  CANNOT_BUY_OWN_LISTING: "不能购买自己的挂单。",
  KCOIN_NOT_ENOUGH: "余额不足。",
  INSUFFICIENT_BALANCE: "K-coin 余额不足，请先充值。",
  LISTING_PRICE_CHANGED: "价格已变化，请刷新后重试。",
  LISTING_SOLD_OUT: "该商品已售罄。",

  ITEM_NOT_OWNER: "不能操作不属于你的藏品。",
  ITEM_NOT_AVAILABLE: "藏品当前不可操作。",
  ITEM_NOT_UPGRADEABLE: "该藏品不可升级。",
  ITEM_MAX_LEVEL: "藏品已达到最高等级。",
  UPGRADE_RULE_NOT_FOUND: "升级配置缺失，请稍后重试。",
  INSUFFICIENT_FGEMS: "FGEMS 余额不足。",
  EVOLVE_ITEM_COUNT_INVALID: "进化必须选择 3 个藏品。",
  EVOLVE_DUPLICATE_ITEM_IDS: "进化材料不能重复。",
  ITEM_NOT_EVOLVABLE: "部分藏品当前不可进化。",
  EVOLVE_REQUIRES_SAME_TEMPLATE_AND_FORM: "进化需要 3 个同一源藏品。",
  EVOLVE_RULE_NOT_FOUND: "进化配置缺失，请稍后重试。",
  INSUFFICIENT_KCOIN: "KCOIN 余额不足。",
  DECOMPOSE_ITEM_COUNT_INVALID: "分解数量必须在 1 到 100 之间。",
  DECOMPOSE_DUPLICATE_ITEM_IDS: "分解藏品不能重复。",
  ITEM_NOT_DECOMPOSABLE: "该藏品不可分解。",
  DECOMPOSE_REQUIRES_DUPLICATE: "只能分解重复藏品。",
  DECOMPOSE_RULE_NOT_FOUND: "分解配置缺失，请稍后重试。",
  MILESTONE_NOT_FOUND: "图鉴里程碑不存在。",
  MILESTONE_NOT_REACHED: "图鉴里程碑尚未达成。",
  MILESTONE_ALREADY_CLAIMED: "图鉴奖励已领取。",
  MILESTONE_VERSION_MISMATCH: "图鉴奖励配置已变更，请刷新后重试。",
  REWARD_CONFIG_INVALID: "图鉴奖励配置异常，请稍后重试。",
  LEADERBOARD_NOT_FOUND: "排行榜生成中，请稍后再试。",
  LEADERBOARD_REFRESH_FORBIDDEN: "没有权限刷新排行榜。",
  LEADERBOARD_REFRESH_FAILED: "排行榜刷新失败，请稍后重试。",
  TASK_NOT_FOUND: "任务不存在。",
  TASK_NOT_COMPLETED: "任务尚未完成。",
  TASK_ALREADY_CLAIMED: "该任务奖励已领取。",
  TASK_OVERVIEW_RPC_FAILED: "获取任务概览失败，请稍后重试。",
  TASK_CLAIM_RPC_FAILED: "领取任务奖励失败，请稍后重试。",
  TASK_CHECK_IN_RPC_FAILED: "签到失败，请稍后重试。",
  SIGNIN_DATE_INVALID: "签到日期无效。",
  SIGNIN_CAMPAIGN_NOT_FOUND: "签到活动不存在。",
  REFERRAL_INVITE_CODE_MISSING: "当前用户邀请码缺失。",
  REFERRAL_SHARE_EVENT_RPC_FAILED: "记录分享事件失败，请稍后重试。",
  REFERRAL_COMMISSION_NOT_CLAIMABLE: "分红不存在或不可领取。",
  REFERRAL_CLAIM_COMMISSION_RPC_FAILED: "领取分红失败，请稍后重试。",

  TELEGRAM_INIT_DATA_INVALID: "Telegram 登录校验失败，请重新进入应用。",
  SESSION_EXPIRED: "登录状态已过期，请重新进入应用。",
  UNAUTHORIZED: "登录状态已过期，请重新进入应用。",
  API_REQUEST_TIMEOUT: "请求超时，请检查网络后重试。",
  API_NETWORK_ERROR: "网络请求失败，请检查网络后重试。",
};

const UNAUTHORIZED_ERROR_CODES = new Set([
  "AUTH_SESSION_REQUIRED",
  "AUTH_SESSION_INVALID",
  "AUTH_SESSION_EXPIRED",
  "AUTH_INIT_DATA_INVALID",
  "AUTH_INIT_DATA_EXPIRED",
  "AUTH_INIT_DATA_FROM_FUTURE",
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
    candidate.success === false &&
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
  return (
    candidate.ok === true && candidate.success === true && "data" in candidate
  );
}
