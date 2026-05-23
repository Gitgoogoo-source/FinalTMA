/**
 * 全项目共享状态枚举。
 *
 * 注意：
 * 1. 这里是状态定义和展示文案。
 * 2. 状态流转是否允许，必须由后端 RPC / 数据库事务控制。
 */

export type StatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "disabled";

export interface StatusMeta<TCode extends string> {
  code: TCode;
  displayNameCn: string;
  displayNameEn: string;
  tone: StatusTone;
  description: string;
}

/* -------------------------------------------------------------------------------------------------
 * 盲盒状态
 * -----------------------------------------------------------------------------------------------*/

export const BOX_STATUS = {
  NOT_STARTED: "NOT_STARTED",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  ENDED: "ENDED",
  SOLD_OUT: "SOLD_OUT",
} as const;

export type BoxStatus = (typeof BOX_STATUS)[keyof typeof BOX_STATUS];

export const BOX_STATUS_META = {
  [BOX_STATUS.NOT_STARTED]: {
    code: BOX_STATUS.NOT_STARTED,
    displayNameCn: "未开始",
    displayNameEn: "Not Started",
    tone: "disabled",
    description: "盲盒活动尚未开始，不允许开盒。",
  },
  [BOX_STATUS.ACTIVE]: {
    code: BOX_STATUS.ACTIVE,
    displayNameCn: "进行中",
    displayNameEn: "Active",
    tone: "success",
    description: "盲盒活动进行中，可以创建支付订单。",
  },
  [BOX_STATUS.PAUSED]: {
    code: BOX_STATUS.PAUSED,
    displayNameCn: "已暂停",
    displayNameEn: "Paused",
    tone: "warning",
    description: "运营或风控暂停盲盒，不允许开盒。",
  },
  [BOX_STATUS.ENDED]: {
    code: BOX_STATUS.ENDED,
    displayNameCn: "已结束",
    displayNameEn: "Ended",
    tone: "disabled",
    description: "盲盒活动已结束，不允许开盒。",
  },
  [BOX_STATUS.SOLD_OUT]: {
    code: BOX_STATUS.SOLD_OUT,
    displayNameCn: "已售罄",
    displayNameEn: "Sold Out",
    tone: "disabled",
    description: "盲盒库存已售罄，不允许开盒。",
  },
} as const satisfies Record<BoxStatus, StatusMeta<BoxStatus>>;

export const BOX_STATUS_CODES = Object.values(BOX_STATUS) as BoxStatus[];

/* -------------------------------------------------------------------------------------------------
 * 开盒订单状态
 * -----------------------------------------------------------------------------------------------*/

export const ORDER_STATUS = {
  CREATED: "CREATED",
  PENDING_PAYMENT: "PENDING_PAYMENT",
  PAID: "PAID",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_STATUS_META = {
  [ORDER_STATUS.CREATED]: {
    code: ORDER_STATUS.CREATED,
    displayNameCn: "已创建",
    displayNameEn: "Created",
    tone: "neutral",
    description: "订单已创建，尚未进入支付。",
  },
  [ORDER_STATUS.PENDING_PAYMENT]: {
    code: ORDER_STATUS.PENDING_PAYMENT,
    displayNameCn: "待支付",
    displayNameEn: "Pending Payment",
    tone: "warning",
    description: "订单等待 Telegram Stars 支付。",
  },
  [ORDER_STATUS.PAID]: {
    code: ORDER_STATUS.PAID,
    displayNameCn: "已支付",
    displayNameEn: "Paid",
    tone: "info",
    description: "支付成功，等待后端发放开盒结果。",
  },
  [ORDER_STATUS.PROCESSING]: {
    code: ORDER_STATUS.PROCESSING,
    displayNameCn: "处理中",
    displayNameEn: "Processing",
    tone: "info",
    description: "订单正在处理抽卡、库存、积分、保底等事务。",
  },
  [ORDER_STATUS.COMPLETED]: {
    code: ORDER_STATUS.COMPLETED,
    displayNameCn: "已完成",
    displayNameEn: "Completed",
    tone: "success",
    description: "订单已完成，奖励已经发放。",
  },
  [ORDER_STATUS.CANCELLED]: {
    code: ORDER_STATUS.CANCELLED,
    displayNameCn: "已取消",
    displayNameEn: "Cancelled",
    tone: "disabled",
    description: "订单被用户或系统取消。",
  },
  [ORDER_STATUS.EXPIRED]: {
    code: ORDER_STATUS.EXPIRED,
    displayNameCn: "已过期",
    displayNameEn: "Expired",
    tone: "disabled",
    description: "订单超过支付有效期。",
  },
  [ORDER_STATUS.FAILED]: {
    code: ORDER_STATUS.FAILED,
    displayNameCn: "失败",
    displayNameEn: "Failed",
    tone: "danger",
    description: "订单处理失败，需要重试或人工处理。",
  },
  [ORDER_STATUS.REFUNDED]: {
    code: ORDER_STATUS.REFUNDED,
    displayNameCn: "已退款",
    displayNameEn: "Refunded",
    tone: "warning",
    description: "订单已退款或进入退款处理结果。",
  },
} as const satisfies Record<OrderStatus, StatusMeta<OrderStatus>>;

export const ORDER_STATUS_CODES = Object.values(ORDER_STATUS) as OrderStatus[];

/* -------------------------------------------------------------------------------------------------
 * 支付状态
 * -----------------------------------------------------------------------------------------------*/

export const PAYMENT_STATUS = {
  CREATED: "CREATED",
  WAITING_PRE_CHECKOUT: "WAITING_PRE_CHECKOUT",
  PRE_CHECKOUT_APPROVED: "PRE_CHECKOUT_APPROVED",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  DISPUTED: "DISPUTED",
} as const;

export type PaymentStatus =
  (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_STATUS_META = {
  [PAYMENT_STATUS.CREATED]: {
    code: PAYMENT_STATUS.CREATED,
    displayNameCn: "已创建",
    displayNameEn: "Created",
    tone: "neutral",
    description: "支付记录已创建。",
  },
  [PAYMENT_STATUS.WAITING_PRE_CHECKOUT]: {
    code: PAYMENT_STATUS.WAITING_PRE_CHECKOUT,
    displayNameCn: "等待预校验",
    displayNameEn: "Waiting Pre Checkout",
    tone: "warning",
    description: "等待 Telegram pre_checkout_query。",
  },
  [PAYMENT_STATUS.PRE_CHECKOUT_APPROVED]: {
    code: PAYMENT_STATUS.PRE_CHECKOUT_APPROVED,
    displayNameCn: "预校验通过",
    displayNameEn: "Pre Checkout Approved",
    tone: "info",
    description: "支付预校验通过，等待 successful_payment。",
  },
  [PAYMENT_STATUS.SUCCEEDED]: {
    code: PAYMENT_STATUS.SUCCEEDED,
    displayNameCn: "支付成功",
    displayNameEn: "Succeeded",
    tone: "success",
    description: "Telegram Stars 支付成功。",
  },
  [PAYMENT_STATUS.FAILED]: {
    code: PAYMENT_STATUS.FAILED,
    displayNameCn: "支付失败",
    displayNameEn: "Failed",
    tone: "danger",
    description: "支付失败或支付回调校验失败。",
  },
  [PAYMENT_STATUS.REFUNDED]: {
    code: PAYMENT_STATUS.REFUNDED,
    displayNameCn: "已退款",
    displayNameEn: "Refunded",
    tone: "warning",
    description: "支付已经退款。",
  },
  [PAYMENT_STATUS.DISPUTED]: {
    code: PAYMENT_STATUS.DISPUTED,
    displayNameCn: "争议中",
    displayNameEn: "Disputed",
    tone: "warning",
    description: "支付存在争议，需要客服或后台处理。",
  },
} as const satisfies Record<PaymentStatus, StatusMeta<PaymentStatus>>;

export const PAYMENT_STATUS_CODES = Object.values(
  PAYMENT_STATUS,
) as PaymentStatus[];

/* -------------------------------------------------------------------------------------------------
 * 市场挂单状态
 * -----------------------------------------------------------------------------------------------*/

export const LISTING_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  PARTIALLY_SOLD: "PARTIALLY_SOLD",
  SOLD: "SOLD",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  PAUSED: "PAUSED",
} as const;

export type ListingStatus =
  (typeof LISTING_STATUS)[keyof typeof LISTING_STATUS];

export const LISTING_STATUS_META = {
  [LISTING_STATUS.DRAFT]: {
    code: LISTING_STATUS.DRAFT,
    displayNameCn: "草稿",
    displayNameEn: "Draft",
    tone: "neutral",
    description: "挂单尚未正式上架。",
  },
  [LISTING_STATUS.ACTIVE]: {
    code: LISTING_STATUS.ACTIVE,
    displayNameCn: "出售中",
    displayNameEn: "Active",
    tone: "success",
    description: "挂单正在市场出售。",
  },
  [LISTING_STATUS.PARTIALLY_SOLD]: {
    code: LISTING_STATUS.PARTIALLY_SOLD,
    displayNameCn: "部分成交",
    displayNameEn: "Partially Sold",
    tone: "info",
    description: "多数量挂单已经部分成交。",
  },
  [LISTING_STATUS.SOLD]: {
    code: LISTING_STATUS.SOLD,
    displayNameCn: "已售出",
    displayNameEn: "Sold",
    tone: "success",
    description: "挂单已经全部成交。",
  },
  [LISTING_STATUS.CANCELLED]: {
    code: LISTING_STATUS.CANCELLED,
    displayNameCn: "已下架",
    displayNameEn: "Cancelled",
    tone: "disabled",
    description: "卖家主动下架，库存已释放。",
  },
  [LISTING_STATUS.EXPIRED]: {
    code: LISTING_STATUS.EXPIRED,
    displayNameCn: "已过期",
    displayNameEn: "Expired",
    tone: "disabled",
    description: "挂单超过有效期，系统下架。",
  },
  [LISTING_STATUS.PAUSED]: {
    code: LISTING_STATUS.PAUSED,
    displayNameCn: "已暂停",
    displayNameEn: "Paused",
    tone: "warning",
    description: "运营或风控暂停挂单。",
  },
} as const satisfies Record<ListingStatus, StatusMeta<ListingStatus>>;

export const LISTING_STATUS_CODES = Object.values(
  LISTING_STATUS,
) as ListingStatus[];

/* -------------------------------------------------------------------------------------------------
 * 库存实例状态
 * -----------------------------------------------------------------------------------------------*/

export const INVENTORY_ITEM_STATUS = {
  AVAILABLE: "AVAILABLE",
  LOCKED: "LOCKED",
  LISTED: "LISTED",
  CONSUMED: "CONSUMED",
  DECOMPOSED: "DECOMPOSED",
  MINTING: "MINTING",
  MINTED: "MINTED",
  TRANSFERRED: "TRANSFERRED",
} as const;

export type InventoryItemStatus =
  (typeof INVENTORY_ITEM_STATUS)[keyof typeof INVENTORY_ITEM_STATUS];

export const INVENTORY_ITEM_STATUS_META = {
  [INVENTORY_ITEM_STATUS.AVAILABLE]: {
    code: INVENTORY_ITEM_STATUS.AVAILABLE,
    displayNameCn: "可用",
    displayNameEn: "Available",
    tone: "success",
    description: "藏品可用于升级、合成、分解、出售或 Mint。",
  },
  [INVENTORY_ITEM_STATUS.LOCKED]: {
    code: INVENTORY_ITEM_STATUS.LOCKED,
    displayNameCn: "已锁定",
    displayNameEn: "Locked",
    tone: "warning",
    description: "藏品被某个操作锁定，暂不可使用。",
  },
  [INVENTORY_ITEM_STATUS.LISTED]: {
    code: INVENTORY_ITEM_STATUS.LISTED,
    displayNameCn: "出售中",
    displayNameEn: "Listed",
    tone: "info",
    description: "藏品已挂售，不能同时升级、合成、分解或 Mint。",
  },
  [INVENTORY_ITEM_STATUS.CONSUMED]: {
    code: INVENTORY_ITEM_STATUS.CONSUMED,
    displayNameCn: "已消耗",
    displayNameEn: "Consumed",
    tone: "disabled",
    description: "藏品已在合成或其他操作中被消耗。",
  },
  [INVENTORY_ITEM_STATUS.DECOMPOSED]: {
    code: INVENTORY_ITEM_STATUS.DECOMPOSED,
    displayNameCn: "已分解",
    displayNameEn: "Decomposed",
    tone: "disabled",
    description: "藏品已分解为 Fgems。",
  },
  [INVENTORY_ITEM_STATUS.MINTING]: {
    code: INVENTORY_ITEM_STATUS.MINTING,
    displayNameCn: "Mint 中",
    displayNameEn: "Minting",
    tone: "info",
    description: "藏品正在链上 Mint 队列中。",
  },
  [INVENTORY_ITEM_STATUS.MINTED]: {
    code: INVENTORY_ITEM_STATUS.MINTED,
    displayNameCn: "已 Mint",
    displayNameEn: "Minted",
    tone: "success",
    description: "藏品已绑定链上 NFT。",
  },
  [INVENTORY_ITEM_STATUS.TRANSFERRED]: {
    code: INVENTORY_ITEM_STATUS.TRANSFERRED,
    displayNameCn: "已转移",
    displayNameEn: "Transferred",
    tone: "disabled",
    description: "藏品已转移给其他用户或链上地址。",
  },
} as const satisfies Record<
  InventoryItemStatus,
  StatusMeta<InventoryItemStatus>
>;

export const INVENTORY_ITEM_STATUS_CODES = Object.values(
  INVENTORY_ITEM_STATUS,
) as InventoryItemStatus[];

/* -------------------------------------------------------------------------------------------------
 * 任务状态
 * -----------------------------------------------------------------------------------------------*/

export const TASK_STATUS = {
  LOCKED: "LOCKED",
  TODO: "TODO",
  IN_PROGRESS: "IN_PROGRESS",
  CLAIMABLE: "CLAIMABLE",
  CLAIMED: "CLAIMED",
  EXPIRED: "EXPIRED",
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const TASK_STATUS_META = {
  [TASK_STATUS.LOCKED]: {
    code: TASK_STATUS.LOCKED,
    displayNameCn: "未解锁",
    displayNameEn: "Locked",
    tone: "disabled",
    description: "任务尚未解锁。",
  },
  [TASK_STATUS.TODO]: {
    code: TASK_STATUS.TODO,
    displayNameCn: "去完成",
    displayNameEn: "To Do",
    tone: "neutral",
    description: "任务可开始但尚未产生进度。",
  },
  [TASK_STATUS.IN_PROGRESS]: {
    code: TASK_STATUS.IN_PROGRESS,
    displayNameCn: "进行中",
    displayNameEn: "In Progress",
    tone: "info",
    description: "任务正在进行中。",
  },
  [TASK_STATUS.CLAIMABLE]: {
    code: TASK_STATUS.CLAIMABLE,
    displayNameCn: "可领取",
    displayNameEn: "Claimable",
    tone: "success",
    description: "任务已完成，可以领取奖励。",
  },
  [TASK_STATUS.CLAIMED]: {
    code: TASK_STATUS.CLAIMED,
    displayNameCn: "已完成",
    displayNameEn: "Claimed",
    tone: "success",
    description: "任务奖励已经领取。",
  },
  [TASK_STATUS.EXPIRED]: {
    code: TASK_STATUS.EXPIRED,
    displayNameCn: "已过期",
    displayNameEn: "Expired",
    tone: "disabled",
    description: "任务周期已结束，不可领取。",
  },
} as const satisfies Record<TaskStatus, StatusMeta<TaskStatus>>;

export const TASK_STATUS_CODES = Object.values(TASK_STATUS) as TaskStatus[];

/* -------------------------------------------------------------------------------------------------
 * 钱包状态
 * -----------------------------------------------------------------------------------------------*/

export const WALLET_STATUS = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTED: "CONNECTED",
  VERIFIED: "VERIFIED",
  REVOKED: "REVOKED",
} as const;

export type WalletStatus = (typeof WALLET_STATUS)[keyof typeof WALLET_STATUS];

export const WALLET_STATUS_META = {
  [WALLET_STATUS.DISCONNECTED]: {
    code: WALLET_STATUS.DISCONNECTED,
    displayNameCn: "未连接",
    displayNameEn: "Disconnected",
    tone: "disabled",
    description: "用户尚未连接 TON 钱包。",
  },
  [WALLET_STATUS.CONNECTED]: {
    code: WALLET_STATUS.CONNECTED,
    displayNameCn: "已连接",
    displayNameEn: "Connected",
    tone: "info",
    description: "钱包已连接，但可能尚未完成后端签名校验。",
  },
  [WALLET_STATUS.VERIFIED]: {
    code: WALLET_STATUS.VERIFIED,
    displayNameCn: "已验证",
    displayNameEn: "Verified",
    tone: "success",
    description: "钱包地址已通过后端验证。",
  },
  [WALLET_STATUS.REVOKED]: {
    code: WALLET_STATUS.REVOKED,
    displayNameCn: "已失效",
    displayNameEn: "Revoked",
    tone: "warning",
    description: "钱包连接已失效，需要重新连接。",
  },
} as const satisfies Record<WalletStatus, StatusMeta<WalletStatus>>;

export const WALLET_STATUS_CODES = Object.values(
  WALLET_STATUS,
) as WalletStatus[];

/* -------------------------------------------------------------------------------------------------
 * Mint 状态
 * -----------------------------------------------------------------------------------------------*/

export const MINT_STATUS = {
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  SUBMITTED: "SUBMITTED",
  CONFIRMED: "CONFIRMED",
  FAILED: "FAILED",
  RETRYING: "RETRYING",
  CANCELLED: "CANCELLED",
} as const;

export type MintStatus = (typeof MINT_STATUS)[keyof typeof MINT_STATUS];

export const MINT_STATUS_META = {
  [MINT_STATUS.QUEUED]: {
    code: MINT_STATUS.QUEUED,
    displayNameCn: "排队中",
    displayNameEn: "Queued",
    tone: "neutral",
    description: "Mint 请求已进入队列。",
  },
  [MINT_STATUS.PROCESSING]: {
    code: MINT_STATUS.PROCESSING,
    displayNameCn: "处理中",
    displayNameEn: "Processing",
    tone: "info",
    description: "Mint 请求正在处理。",
  },
  [MINT_STATUS.SUBMITTED]: {
    code: MINT_STATUS.SUBMITTED,
    displayNameCn: "已提交链上",
    displayNameEn: "Submitted",
    tone: "info",
    description: "Mint 交易已提交到 TON 链上。",
  },
  [MINT_STATUS.CONFIRMED]: {
    code: MINT_STATUS.CONFIRMED,
    displayNameCn: "已确认",
    displayNameEn: "Confirmed",
    tone: "success",
    description: "Mint 已链上确认。",
  },
  [MINT_STATUS.FAILED]: {
    code: MINT_STATUS.FAILED,
    displayNameCn: "失败",
    displayNameEn: "Failed",
    tone: "danger",
    description: "Mint 失败，可能需要重试或人工处理。",
  },
  [MINT_STATUS.RETRYING]: {
    code: MINT_STATUS.RETRYING,
    displayNameCn: "重试中",
    displayNameEn: "Retrying",
    tone: "warning",
    description: "Mint 失败后正在重试。",
  },
  [MINT_STATUS.CANCELLED]: {
    code: MINT_STATUS.CANCELLED,
    displayNameCn: "已取消",
    displayNameEn: "Cancelled",
    tone: "disabled",
    description: "Mint 请求已取消。",
  },
} as const satisfies Record<MintStatus, StatusMeta<MintStatus>>;

export const MINT_STATUS_CODES = Object.values(MINT_STATUS) as MintStatus[];

/* -------------------------------------------------------------------------------------------------
 * 链上交易状态
 * -----------------------------------------------------------------------------------------------*/

export const CHAIN_TX_STATUS = {
  CREATED: "CREATED",
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
} as const;

export type ChainTxStatus =
  (typeof CHAIN_TX_STATUS)[keyof typeof CHAIN_TX_STATUS];

export const CHAIN_TX_STATUS_META = {
  [CHAIN_TX_STATUS.CREATED]: {
    code: CHAIN_TX_STATUS.CREATED,
    displayNameCn: "已创建",
    displayNameEn: "Created",
    tone: "neutral",
    description: "链上交易记录已创建。",
  },
  [CHAIN_TX_STATUS.PENDING]: {
    code: CHAIN_TX_STATUS.PENDING,
    displayNameCn: "确认中",
    displayNameEn: "Pending",
    tone: "info",
    description: "链上交易等待确认。",
  },
  [CHAIN_TX_STATUS.CONFIRMED]: {
    code: CHAIN_TX_STATUS.CONFIRMED,
    displayNameCn: "已确认",
    displayNameEn: "Confirmed",
    tone: "success",
    description: "链上交易已确认。",
  },
  [CHAIN_TX_STATUS.FAILED]: {
    code: CHAIN_TX_STATUS.FAILED,
    displayNameCn: "失败",
    displayNameEn: "Failed",
    tone: "danger",
    description: "链上交易失败。",
  },
  [CHAIN_TX_STATUS.EXPIRED]: {
    code: CHAIN_TX_STATUS.EXPIRED,
    displayNameCn: "已过期",
    displayNameEn: "Expired",
    tone: "disabled",
    description: "链上交易超过有效期。",
  },
} as const satisfies Record<ChainTxStatus, StatusMeta<ChainTxStatus>>;

export const CHAIN_TX_STATUS_CODES = Object.values(
  CHAIN_TX_STATUS,
) as ChainTxStatus[];

/* -------------------------------------------------------------------------------------------------
 * 通用工具函数
 * -----------------------------------------------------------------------------------------------*/

export function isBoxStatus(value: unknown): value is BoxStatus {
  return (
    typeof value === "string" &&
    (BOX_STATUS_CODES as readonly string[]).includes(value)
  );
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUS_CODES as readonly string[]).includes(value)
  );
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return (
    typeof value === "string" &&
    (PAYMENT_STATUS_CODES as readonly string[]).includes(value)
  );
}

export function isListingStatus(value: unknown): value is ListingStatus {
  return (
    typeof value === "string" &&
    (LISTING_STATUS_CODES as readonly string[]).includes(value)
  );
}

export function isInventoryItemStatus(
  value: unknown,
): value is InventoryItemStatus {
  return (
    typeof value === "string" &&
    (INVENTORY_ITEM_STATUS_CODES as readonly string[]).includes(value)
  );
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    (TASK_STATUS_CODES as readonly string[]).includes(value)
  );
}

export function isWalletStatus(value: unknown): value is WalletStatus {
  return (
    typeof value === "string" &&
    (WALLET_STATUS_CODES as readonly string[]).includes(value)
  );
}

export function isMintStatus(value: unknown): value is MintStatus {
  return (
    typeof value === "string" &&
    (MINT_STATUS_CODES as readonly string[]).includes(value)
  );
}

export function isChainTxStatus(value: unknown): value is ChainTxStatus {
  return (
    typeof value === "string" &&
    (CHAIN_TX_STATUS_CODES as readonly string[]).includes(value)
  );
}

export function getBoxStatusMeta(status: BoxStatus): StatusMeta<BoxStatus> {
  return BOX_STATUS_META[status];
}

export function getOrderStatusMeta(
  status: OrderStatus,
): StatusMeta<OrderStatus> {
  return ORDER_STATUS_META[status];
}

export function getPaymentStatusMeta(
  status: PaymentStatus,
): StatusMeta<PaymentStatus> {
  return PAYMENT_STATUS_META[status];
}

export function getListingStatusMeta(
  status: ListingStatus,
): StatusMeta<ListingStatus> {
  return LISTING_STATUS_META[status];
}

export function getInventoryItemStatusMeta(
  status: InventoryItemStatus,
): StatusMeta<InventoryItemStatus> {
  return INVENTORY_ITEM_STATUS_META[status];
}

export function getTaskStatusMeta(status: TaskStatus): StatusMeta<TaskStatus> {
  return TASK_STATUS_META[status];
}

export function getWalletStatusMeta(
  status: WalletStatus,
): StatusMeta<WalletStatus> {
  return WALLET_STATUS_META[status];
}

export function getMintStatusMeta(status: MintStatus): StatusMeta<MintStatus> {
  return MINT_STATUS_META[status];
}

export function getChainTxStatusMeta(
  status: ChainTxStatus,
): StatusMeta<ChainTxStatus> {
  return CHAIN_TX_STATUS_META[status];
}
