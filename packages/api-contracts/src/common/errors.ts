export type RefreshScope =
  | "none"
  | "session"
  | "assets"
  | "inventory"
  | "payments"
  | "mint"
  | "all";
export type RecoveryAction =
  | "none"
  | "reauthenticate"
  | "refresh"
  | "query_operation";

export type ErrorDefinition = {
  status: number;
  message: string;
  retryable: boolean;
  refreshScope: RefreshScope;
  recoveryAction: RecoveryAction;
};

function error(
  status: number,
  message: string,
  retryable = false,
  refreshScope: RefreshScope = "none",
  recoveryAction: RecoveryAction = "none",
): ErrorDefinition {
  return { status, message, retryable, refreshScope, recoveryAction };
}

export const errorRegistry = {
  ACCOUNT_RESTRICTED: error(
    403,
    "账户当前不可执行此操作",
    false,
    "session",
    "refresh",
  ),
  ALBUM_CHAIN_INCOMPLETE: error(409, "尚未集齐该进化链"),
  ALBUM_REWARD_ALREADY_CLAIMED: error(409, "该图鉴奖励已经领取"),
  API_ROUTE_NOT_FOUND: error(404, "接口不存在"),
  BOX_TIER_INVALID: error(400, "盲盒档次无效"),
  CATALOG_INVALID: error(500, "目录数据无效", true, "all", "refresh"),
  CATALOG_UNAVAILABLE: error(503, "图鉴数据暂时不可用", true, "all", "refresh"),
  CHECKIN_ALREADY_CLAIMED: error(409, "今日签到奖励已经领取"),
  CONTENT_TYPE_INVALID: error(415, "请求体必须使用 application/json"),
  CRON_UNAUTHORIZED: error(401, "后台任务认证失败"),
  DATABASE_RPC_FAILED: error(
    500,
    "数据库操作失败",
    true,
    "all",
    "query_operation",
  ),
  DRAW_COUNT_INVALID: error(400, "开盒次数无效"),
  EVOLUTION_NOT_AVAILABLE: error(409, "当前藏品不能进化"),
  EXPEDITION_ALREADY_ACTIVE: error(
    409,
    "所选藏品已在远征中",
    false,
    "inventory",
    "refresh",
  ),
  EXPEDITION_ITEMS_INVALID: error(400, "远征藏品组合无效"),
  EXPEDITION_LIMIT_REACHED: error(409, "同时进行的远征数量已达上限"),
  EXPEDITION_NOT_FOUND: error(404, "远征记录不存在"),
  EXPEDITION_NOT_READY: error(409, "远征尚未完成"),
  EXPEDITION_TIER_INVALID: error(400, "远征等级无效"),
  FREE_ENTITLEMENT_UNAVAILABLE: error(
    409,
    "免费盲盒权益不可用",
    false,
    "assets",
    "refresh",
  ),
  IDEMPOTENCY_KEY_INVALID: error(400, "幂等键必须是 UUID"),
  IDEMPOTENCY_KEY_REQUIRED: error(400, "缺少幂等键"),
  IDEMPOTENCY_KEY_REUSED: error(
    409,
    "幂等键已用于不同请求",
    false,
    "all",
    "query_operation",
  ),
  INSUFFICIENT_BALANCE: error(409, "余额不足", false, "assets", "refresh"),
  INSUFFICIENT_INVENTORY: error(
    409,
    "可用藏品数量不足",
    false,
    "inventory",
    "refresh",
  ),
  INTERNAL_ERROR: error(500, "服务暂时不可用", true, "all", "query_operation"),
  INVENTORY_ITEM_NOT_FOUND: error(404, "藏品不存在"),
  INVENTORY_RESERVED: error(
    409,
    "藏品已被其他业务占用",
    false,
    "inventory",
    "refresh",
  ),
  JOB_NOT_FOUND: error(404, "后台任务不存在"),
  LISTING_NOT_CANCELLABLE: error(
    409,
    "挂单当前不能取消",
    false,
    "inventory",
    "refresh",
  ),
  LISTING_NOT_FOUND: error(404, "挂单不存在"),
  MARKET_ACTIVE_TEMPLATE_LIMIT: error(
    409,
    "活跃挂单种类已达上限",
    false,
    "inventory",
    "refresh",
  ),
  MARKET_STOCK_INSUFFICIENT: error(
    409,
    "市场可成交数量不足",
    false,
    "inventory",
    "refresh",
  ),
  METHOD_NOT_ALLOWED: error(405, "请求方法不受支持"),
  MINT_ALREADY_ACTIVE: error(
    409,
    "该藏品已有进行中的 Mint",
    false,
    "mint",
    "refresh",
  ),
  MINT_IN_PROGRESS: error(
    409,
    "存在进行中的 Mint，暂时不能断开钱包",
    false,
    "mint",
    "refresh",
  ),
  MINT_RESULT_INCOMPLETE: error(
    500,
    "Mint 成功资料不完整",
    true,
    "mint",
    "refresh",
  ),
  MINT_NOT_CANCELLABLE: error(
    409,
    "Mint 当前不能取消",
    false,
    "mint",
    "refresh",
  ),
  MINT_NOT_FOUND: error(404, "Mint 记录不存在"),
  MINT_NOT_SUBMITTABLE: error(
    409,
    "Mint 当前不能提交",
    false,
    "mint",
    "refresh",
  ),
  NFT_METADATA_NOT_FOUND: error(404, "NFT 元数据不存在"),
  OPERATION_FAILED: error(409, "原操作已确认失败", false, "all", "refresh"),
  OPERATION_NOT_FOUND: error(404, "操作记录不存在"),
  OPERATION_RESULT_INVALID: error(
    500,
    "操作结果格式无效",
    true,
    "all",
    "refresh",
  ),
  PAYMENT_ALREADY_PENDING: error(
    409,
    "已有待处理支付订单",
    false,
    "payments",
    "refresh",
  ),
  PAYMENT_EXPIRED: error(409, "支付订单已经过期", false, "payments", "refresh"),
  PAYMENT_MISMATCH: error(
    409,
    "支付信息与订单不一致",
    false,
    "payments",
    "refresh",
  ),
  PAYMENT_NOT_DELIVERABLE: error(
    409,
    "支付订单当前不能交付",
    true,
    "payments",
    "refresh",
  ),
  PAYMENT_NOT_FOUND: error(404, "支付订单不存在"),
  RATE_LIMITED: error(429, "操作过于频繁，请稍后重试", true),
  REFERRAL_ALREADY_BOUND: error(409, "邀请关系已经绑定"),
  REFERRAL_INVALID: error(400, "邀请码无效"),
  REFERRAL_SELF_BIND: error(409, "不能绑定自己的邀请码"),
  REQUEST_BODY_NOT_ALLOWED: error(400, "GET 请求不能携带请求体"),
  REQUEST_INVALID: error(400, "请求参数无效"),
  REQUEST_TOO_LARGE: error(413, "请求体过大"),
  RESPONSE_INVALID: error(502, "服务响应格式无效", true, "all", "refresh"),
  SESSION_EXPIRED: error(401, "会话已过期", true, "session", "reauthenticate"),
  SESSION_REPLACED: error(
    401,
    "会话已被替换",
    false,
    "session",
    "reauthenticate",
  ),
  SESSION_REQUIRED: error(
    401,
    "请从 Telegram 重新进入应用",
    false,
    "session",
    "reauthenticate",
  ),
  SHARE_EVENT_INVALID: error(400, "分享事件无效"),
  TASK_ALREADY_CLAIMED: error(409, "任务奖励已经领取"),
  TASK_NOT_COMPLETE: error(409, "任务尚未完成"),
  TASK_NOT_FOUND: error(404, "任务不存在"),
  TELEGRAM_API_FAILED: error(
    502,
    "Telegram 服务暂时不可用",
    true,
    "payments",
    "refresh",
  ),
  TELEGRAM_INIT_DATA_EXPIRED: error(
    401,
    "Telegram 登录信息已过期",
    false,
    "session",
    "reauthenticate",
  ),
  TELEGRAM_INIT_DATA_INVALID: error(
    401,
    "Telegram 登录信息无效",
    false,
    "session",
    "reauthenticate",
  ),
  TELEGRAM_REENTRY_REQUIRED: error(
    401,
    "请从 Telegram Mini App 重新打开应用",
    false,
    "session",
    "reauthenticate",
  ),
  TELEGRAM_UPDATE_INVALID: error(400, "Telegram 回调格式无效"),
  TEMPLATE_NOT_FOUND: error(404, "藏品模板不存在"),
  TOPUP_AMOUNT_INVALID: error(400, "充值金额无效"),
  TOPUP_NOT_REQUIRED: error(
    409,
    "当前余额不需要补差充值",
    false,
    "assets",
    "refresh",
  ),
  TRANSACTION_ALREADY_USED: error(
    409,
    "链上交易已被使用",
    false,
    "mint",
    "refresh",
  ),
  VIP_ALREADY_CLAIMED: error(
    409,
    "本周期 VIP 权益已经领取",
    false,
    "assets",
    "refresh",
  ),
  VIP_BENEFIT_INVALID: error(400, "VIP 权益类型无效"),
  VIP_INACTIVE: error(409, "VIP 当前未生效", false, "session", "refresh"),
  VIP_RENEWAL_LIMIT: error(
    409,
    "VIP 续费期限已达上限",
    false,
    "payments",
    "refresh",
  ),
  WALLET_ADDRESS_IN_USE: error(409, "该钱包地址已绑定其他账户"),
  WALLET_CHALLENGE_INVALID: error(409, "钱包验证挑战无效，请重新连接"),
  WALLET_NOT_CONNECTED: error(409, "钱包尚未连接"),
  WALLET_NOT_VERIFIED: error(409, "钱包尚未完成验证"),
  WALLET_PROOF_INVALID: error(401, "钱包签名验证失败，请重新连接"),
  WEBHOOK_UNAUTHORIZED: error(401, "Webhook 认证失败"),
  WHEEL_COUNT_INVALID: error(400, "转盘次数无效"),
  WHEEL_DAILY_LIMIT: error(
    409,
    "今日转盘次数已达上限",
    false,
    "assets",
    "refresh",
  ),
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof errorRegistry;
export const errorCodes = Object.keys(errorRegistry) as [
  ErrorCode,
  ...ErrorCode[],
];

export function errorDefinition(code: ErrorCode): ErrorDefinition {
  return errorRegistry[code];
}

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(errorRegistry, value);
}
