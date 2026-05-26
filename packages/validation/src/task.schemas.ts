import { z } from "zod";

/**
 * tasks 模块说明：
 * - 面向用户端任务中心、签到、邀请、任务领取、分享事件。
 * - 只负责请求 / 响应参数校验，不负责业务判断。
 * - 任务完成、奖励发放、邀请关系、分红、签到连续天数，必须由后端 RPC / 数据库事务判断。
 */

/* -------------------------------------------------------------------------- */
/* 基础通用 schema                                                             */
/* -------------------------------------------------------------------------- */

export const UUIDSchema = z.string().uuid();

export const IdempotencyKeySchema = z
  .string()
  .trim()
  .min(8, "idempotencyKey 最少 8 位")
  .max(128, "idempotencyKey 最多 128 位")
  .regex(
    /^[a-zA-Z0-9:_-]+$/,
    "idempotencyKey 只能包含字母、数字、冒号、下划线和短横线",
  );

export const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "必须是 YYYY-MM-DD 格式");

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const PeriodKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .refine(isSupportedPeriodKey, "periodKey 格式不正确");

function isSupportedPeriodKey(value: string): boolean {
  return (
    value === "once" ||
    /^\d{4}-\d{2}-\d{2}$/.test(value) ||
    /^\d{4}-W\d{2}$/.test(value) ||
    /^\d{4}-\d{2}$/.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ) ||
    /^(daily:\d{4}-\d{2}-\d{2}|weekly:\d{4}-W\d{2}|monthly:\d{4}-\d{2}|campaign:[a-zA-Z0-9_-]{1,64})$/.test(
      value,
    )
  );
}

export const CursorSchema = z.string().trim().min(1).max(256);

export const PageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20);

export const PaginationQuerySchema = z.object({
  cursor: CursorSchema.optional(),
  limit: PageSizeSchema.optional(),
});

export const BooleanQuerySchema = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  return value;
}, z.boolean());

function csvArray<T extends z.ZodTypeAny>(itemSchema: T, max = 50) {
  return z.preprocess((value) => {
    if (typeof value === "string") {
      if (!value.trim()) return [];
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return value;
  }, z.array(itemSchema).max(max));
}

/* -------------------------------------------------------------------------- */
/* 任务枚举                                                                     */
/* -------------------------------------------------------------------------- */

export const CurrencyCodeSchema = z.enum(["KCOIN", "FGEMS", "STAR_DISPLAY"]);

export const RaritySchema = z.enum([
  "COMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "MYTHIC",
]);

export const TaskCategorySchema = z.enum([
  "DAILY",
  "SOCIAL",
  "TRADE",
  "GACHA",
  "ALBUM",
  "WALLET",
  "ONCHAIN",
  "GAME",
  "EVENT",
  "SYSTEM",
]);

export const TaskActionSchema = z.enum([
  "DAILY_CHECK_IN",
  "INVITE_FRIEND",
  "INVITEE_FIRST_OPEN_BOX",
  "OPEN_BOX",
  "OPEN_BOX_TIMES",
  "OPEN_BOX_TEN_TIMES",
  "BUY_MARKET_ITEM",
  "SELL_MARKET_ITEM",
  "CREATE_LISTING",
  "CANCEL_LISTING",
  "UPGRADE_ITEM",
  "EVOLVE_ITEM",
  "DECOMPOSE_ITEM",
  "COLLECT_ITEM",
  "COLLECT_RARITY_ITEM",
  "COMPLETE_ALBUM_MILESTONE",
  "CONNECT_WALLET",
  "SYNC_WALLET_NFT",
  "MINT_NFT",
  "JOIN_COMMUNITY",
  "SHARE_INVITE_LINK",
  "PLAY_GAME",
  "CUSTOM_EVENT",
]);

export const TaskStatusSchema = z.enum([
  "LOCKED",
  "NOT_STARTED",
  "IN_PROGRESS",
  "CLAIMABLE",
  "CLAIMED",
  "EXPIRED",
  "DISABLED",
]);

export const TaskPeriodTypeSchema = z.enum([
  "NONE",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "CAMPAIGN",
]);

export const ReferralStatusSchema = z.enum([
  "PENDING",
  "VALID",
  "REWARDED",
  "INVALID",
  "CANCELED",
]);

export const ReferralRecordStatusSchema = z.enum([
  "pending",
  "qualified",
  "rewarded",
  "cancelled",
]);

export const ReferralRecordStatusInputSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "valid") return "qualified";
  if (normalized === "canceled") return "cancelled";
  return normalized;
}, ReferralRecordStatusSchema);

export const CommissionStatusSchema = z.enum([
  "pending",
  "granted",
  "reversed",
]);

export const CommissionStatusInputSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().toLowerCase();
}, CommissionStatusSchema);

export const ShareSceneSchema = z.enum([
  "TASK_PAGE",
  "INVITE_CARD",
  "BOX_PAGE",
  "MARKET_PAGE",
  "ALBUM_PAGE",
  "COLLECTION_DETAIL",
  "SYSTEM",
]);

export const TelegramChatTypeSchema = z.enum([
  "USER",
  "GROUP",
  "SUPERGROUP",
  "CHANNEL",
  "UNKNOWN",
]);

/* -------------------------------------------------------------------------- */
/* 奖励 schema                                                                  */
/* -------------------------------------------------------------------------- */

export const PositiveAmountSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(2_000_000_000);

export const RewardBaseSchema = z.object({
  rewardId: UUIDSchema.optional(),
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  iconUrl: z.string().url().optional(),
});

export const CurrencyRewardSchema = RewardBaseSchema.extend({
  type: z.literal("CURRENCY"),
  currency: CurrencyCodeSchema,
  amount: PositiveAmountSchema,
});

export const CollectibleRewardSchema = RewardBaseSchema.extend({
  type: z.literal("COLLECTIBLE"),
  templateId: UUIDSchema,
  quantity: z.coerce.number().int().min(1).max(100).default(1),
  rarity: RaritySchema.optional(),
});

export const BoxTicketRewardSchema = RewardBaseSchema.extend({
  type: z.literal("BOX_TICKET"),
  boxId: UUIDSchema,
  quantity: z.coerce.number().int().min(1).max(100).default(1),
});

export const DecorationRewardSchema = RewardBaseSchema.extend({
  type: z.literal("DECORATION"),
  decorationId: UUIDSchema,
  quantity: z.coerce.number().int().min(1).max(100).default(1),
});

export const ItemRewardSchema = RewardBaseSchema.extend({
  type: z.literal("ITEM"),
  itemId: UUIDSchema,
  itemCode: z.string().trim().min(2).max(80).optional(),
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
});

export const TaskRewardSchema = z.discriminatedUnion("type", [
  CurrencyRewardSchema,
  CollectibleRewardSchema,
  BoxTicketRewardSchema,
  DecorationRewardSchema,
  ItemRewardSchema,
]);

export const TaskRewardsSchema = z.array(TaskRewardSchema).max(20);

/* -------------------------------------------------------------------------- */
/* 任务展示 / 查询 schema                                                       */
/* -------------------------------------------------------------------------- */

export const TaskProgressSchema = z.object({
  current: z.coerce.number().int().min(0),
  target: z.coerce.number().int().positive(),
  percent: z.coerce.number().min(0).max(100).optional(),
});

export const TaskDisplaySchema = z.object({
  taskId: UUIDSchema,
  code: z.string().trim().min(2).max(80),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  category: TaskCategorySchema,
  action: TaskActionSchema,
  status: TaskStatusSchema,
  periodType: TaskPeriodTypeSchema,
  periodKey: PeriodKeySchema.optional(),
  progress: TaskProgressSchema,
  rewards: TaskRewardsSchema,
  sortOrder: z.coerce.number().int().default(0),
  startsAt: IsoDateTimeSchema.optional(),
  endsAt: IsoDateTimeSchema.optional(),
  claimedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
  actionText: z.string().trim().min(1).max(40).optional(),
  actionRoute: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const TaskListQuerySchema = PaginationQuerySchema.extend({
  categories: csvArray(TaskCategorySchema).optional(),
  statuses: csvArray(TaskStatusSchema).optional(),
  periodType: TaskPeriodTypeSchema.optional(),
  periodKey: PeriodKeySchema.optional(),
  includeClaimed: BooleanQuerySchema.optional(),
  includeExpired: BooleanQuerySchema.optional(),
});

export const TaskListResponseSchema = z.object({
  items: z.array(TaskDisplaySchema),
  nextCursor: CursorSchema.nullable().optional(),
  serverTime: IsoDateTimeSchema,
});

/* -------------------------------------------------------------------------- */
/* 任务领取 schema                                                              */
/* -------------------------------------------------------------------------- */

export const ClaimTaskBodySchema = z.object({
  taskId: UUIDSchema,
  periodKey: PeriodKeySchema.optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export const ClaimTaskResponseSchema = z.object({
  taskId: UUIDSchema,
  status: TaskStatusSchema,
  rewards: TaskRewardsSchema,
  claimedAt: IsoDateTimeSchema,
  balances: z
    .object({
      kcoin: z.coerce.number().int().min(0).optional(),
      fgems: z.coerce.number().int().min(0).optional(),
    })
    .optional(),
});

/* -------------------------------------------------------------------------- */
/* 7 日签到 schema                                                              */
/* -------------------------------------------------------------------------- */

export const CheckInBodySchema = z.object({
  campaignId: UUIDSchema.optional(),
  localDate: DateOnlySchema.optional(),
  timezoneOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export const CheckInStatusQuerySchema = z.object({
  campaignId: UUIDSchema.optional(),
});

export const CheckInDaySchema = z.object({
  dayIndex: z.coerce.number().int().min(1).max(31),
  status: z.enum(["LOCKED", "AVAILABLE", "CLAIMED", "MISSED"]),
  rewards: TaskRewardsSchema,
  claimedAt: IsoDateTimeSchema.optional(),
});

export const CheckInStatusResponseSchema = z.object({
  campaignId: UUIDSchema,
  currentStreak: z.coerce.number().int().min(0).max(365),
  todayCheckedIn: z.boolean(),
  days: z.array(CheckInDaySchema).max(31),
  serverDate: DateOnlySchema,
});

export const CheckInResponseSchema = z.object({
  campaignId: UUIDSchema,
  dayIndex: z.coerce.number().int().min(1).max(31),
  currentStreak: z.coerce.number().int().min(1).max(365),
  rewards: TaskRewardsSchema,
  checkedInAt: IsoDateTimeSchema,
});

/* -------------------------------------------------------------------------- */
/* 邀请 / 分红 schema                                                           */
/* -------------------------------------------------------------------------- */

export const ReferralCodeSchema = z
  .string()
  .trim()
  .min(4)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const ReferralLinkQuerySchema = z.object({
  campaignId: UUIDSchema.optional(),
  scene: ShareSceneSchema.optional(),
  source: z.string().trim().min(1).max(64).optional(),
});

export const ReferralLinkResponseSchema = z.object({
  referralCode: ReferralCodeSchema,
  startPayload: z.string().trim().min(1).max(128),
  inviteUrl: z.string().url(),
  shareText: z.string().trim().min(1).max(500),
  expiresAt: IsoDateTimeSchema.optional(),
});

export const BindReferralBodySchema = z.object({
  inviteCode: ReferralCodeSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export const BindReferralResponseSchema = z.object({
  bound: z.boolean(),
  status: z.string().trim().min(1).max(40),
  reason: z.string().trim().min(1).max(80).optional(),
  referralId: UUIDSchema.optional(),
  inviteCode: ReferralCodeSchema.optional(),
  createdAt: IsoDateTimeSchema.optional(),
  idempotent: z.boolean().optional(),
});

export const InviteStatsQuerySchema = z.object({
  campaignId: UUIDSchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
});

export const InviteStatsResponseSchema = z.object({
  invitedCount: z.coerce.number().int().min(0),
  validInviteCount: z.coerce.number().int().min(0),
  firstOpenCount: z.coerce.number().int().min(0),
  totalRewardKcoin: z.coerce.number().int().min(0),
  commissionKcoin: z.coerce.number().int().min(0),
  pendingCommissionKcoin: z.coerce.number().int().min(0).optional(),
  commissionRate: z.coerce.number().min(0).max(1),
});

export const ReferralItemSchema = z.object({
  referralId: UUIDSchema,
  inviteeDisplayName: z.string().trim().max(120).optional(),
  status: ReferralRecordStatusSchema,
  createdAt: IsoDateTimeSchema,
  firstOpenAt: IsoDateTimeSchema.optional(),
  rewardedAt: IsoDateTimeSchema.optional(),
  rewardKcoin: z.coerce.number().int().min(0).optional(),
});

export const ReferralListQuerySchema = PaginationQuerySchema.extend({
  status: ReferralRecordStatusInputSchema.optional(),
  campaignId: UUIDSchema.optional(),
});

export const ReferralListResponseSchema = z.object({
  items: z.array(ReferralItemSchema),
  nextCursor: CursorSchema.nullable().optional(),
});

export const CommissionHistoryQuerySchema = PaginationQuerySchema.extend({
  status: CommissionStatusInputSchema.optional(),
});

export const RewardHistorySourceSchema = z.enum([
  "task_claim",
  "daily_check_in",
  "referral_first_open",
  "referral_commission_claim",
]);

export const RewardHistorySourceInputSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().toLowerCase();
}, RewardHistorySourceSchema);

export const RewardHistoryQuerySchema = PaginationQuerySchema.extend({
  source: RewardHistorySourceInputSchema.optional(),
});

export const ClaimCommissionBodySchema = z.object({
  commissionIds: z.array(UUIDSchema).min(1).max(100).optional(),
  idempotencyKey: IdempotencyKeySchema,
});

/* -------------------------------------------------------------------------- */
/* 分享事件 schema                                                              */
/* -------------------------------------------------------------------------- */

export const ShareEventBodySchema = z.object({
  scene: ShareSceneSchema,
  referralCode: ReferralCodeSchema.optional(),
  campaignId: UUIDSchema.optional(),
  targetChatType: TelegramChatTypeSchema.optional(),
  targetChatIdHash: z.string().trim().min(8).max(128).optional(),
  messageId: z.coerce.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: IdempotencyKeySchema.optional(),
});

export const ShareEventResponseSchema = z.object({
  accepted: z.boolean(),
  eventId: UUIDSchema.optional(),
});

/* -------------------------------------------------------------------------- */
/* 任务进度事件 schema：后端内部或 webhook 触发用                                */
/* -------------------------------------------------------------------------- */

export const TaskProgressEventSourceSchema = z.enum([
  "GACHA",
  "MARKET",
  "INVENTORY",
  "ALBUM",
  "WALLET",
  "ONCHAIN",
  "TELEGRAM",
  "ADMIN",
  "SYSTEM",
]);

export const TaskProgressEventBodySchema = z.object({
  userId: UUIDSchema,
  source: TaskProgressEventSourceSchema,
  action: TaskActionSchema,
  amount: z.coerce.number().int().positive().default(1),
  sourceId: UUIDSchema.optional(),
  periodKey: PeriodKeySchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: IdempotencyKeySchema,
});

/* -------------------------------------------------------------------------- */
/* 导出类型                                                                     */
/* -------------------------------------------------------------------------- */

export type UUID = z.infer<typeof UUIDSchema>;
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
export type Rarity = z.infer<typeof RaritySchema>;

export type TaskCategory = z.infer<typeof TaskCategorySchema>;
export type TaskAction = z.infer<typeof TaskActionSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskPeriodType = z.infer<typeof TaskPeriodTypeSchema>;

export type TaskReward = z.infer<typeof TaskRewardSchema>;
export type TaskDisplay = z.infer<typeof TaskDisplaySchema>;

export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

export type ClaimTaskBody = z.infer<typeof ClaimTaskBodySchema>;
export type ClaimTaskResponse = z.infer<typeof ClaimTaskResponseSchema>;

export type CheckInBody = z.infer<typeof CheckInBodySchema>;
export type CheckInStatusQuery = z.infer<typeof CheckInStatusQuerySchema>;
export type CheckInStatusResponse = z.infer<typeof CheckInStatusResponseSchema>;
export type CheckInResponse = z.infer<typeof CheckInResponseSchema>;

export type ReferralLinkQuery = z.infer<typeof ReferralLinkQuerySchema>;
export type ReferralLinkResponse = z.infer<typeof ReferralLinkResponseSchema>;
export type BindReferralBody = z.infer<typeof BindReferralBodySchema>;
export type BindReferralResponse = z.infer<typeof BindReferralResponseSchema>;
export type InviteStatsQuery = z.infer<typeof InviteStatsQuerySchema>;
export type InviteStatsResponse = z.infer<typeof InviteStatsResponseSchema>;
export type ReferralListQuery = z.infer<typeof ReferralListQuerySchema>;
export type ReferralListResponse = z.infer<typeof ReferralListResponseSchema>;
export type CommissionStatus = z.infer<typeof CommissionStatusSchema>;
export type CommissionHistoryQuery = z.infer<
  typeof CommissionHistoryQuerySchema
>;
export type RewardHistorySource = z.infer<typeof RewardHistorySourceSchema>;
export type RewardHistoryQuery = z.infer<typeof RewardHistoryQuerySchema>;
export type ClaimCommissionBody = z.infer<typeof ClaimCommissionBodySchema>;

export type ShareEventBody = z.infer<typeof ShareEventBodySchema>;
export type ShareEventResponse = z.infer<typeof ShareEventResponseSchema>;

export type TaskProgressEventBody = z.infer<typeof TaskProgressEventBodySchema>;
