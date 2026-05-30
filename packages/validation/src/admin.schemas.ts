import { z } from "zod";

/**
 * admin 模块说明：
 * - 面向后台管理系统。
 * - 覆盖用户、盲盒、概率池、藏品、市场、任务、图鉴、支付、NFT、Banner、风控、审计。
 * - 后台 schema 只负责参数校验；真实权限、事务、审计、概率发布必须由后端和数据库处理。
 */

/* -------------------------------------------------------------------------- */
/* 基础通用 schema                                                             */
/* -------------------------------------------------------------------------- */

export const UUIDSchema = z.string().uuid();

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const DateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "必须是 YYYY-MM-DD 格式");

export const IdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9:_-]+$/);

export const CodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(
    /^[a-z][a-z0-9_.:-]*$/,
    "code 必须以小写字母开头，只能包含小写字母、数字、下划线、点、冒号、短横线",
  );

export const SlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

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

export const SortOrderSchema = z.enum(["ASC", "DESC"]);

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

export const AdminReasonSchema = z
  .string()
  .trim()
  .min(3, "必须填写操作原因")
  .max(500, "操作原因最多 500 字");

export const MoneyAmountSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(2_000_000_000);

export const PositiveMoneyAmountSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(2_000_000_000);

export const PercentageSchema = z.coerce.number().min(0).max(1);

export const WeightSchema = z.coerce.number().positive().max(1_000_000_000);

export const UrlSchema = z.string().url().max(1000);

export const JsonObjectSchema = z.record(z.string(), z.unknown());

/* -------------------------------------------------------------------------- */
/* 通用枚举                                                                     */
/* -------------------------------------------------------------------------- */

export const CurrencyCodeSchema = z.enum(["KCOIN", "FGEMS", "STAR_DISPLAY"]);

export const RaritySchema = z.enum([
  "COMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "MYTHIC",
]);

export const ItemTypeSchema = z.enum([
  "CHARACTER",
  "PET",
  "EGG",
  "DECORATION",
  "PROP",
  "BADGE",
  "SKIN",
]);

export const UserStatusSchema = z.enum([
  "ACTIVE",
  "FROZEN",
  "BANNED",
  "DELETED",
]);

export const BoxStatusSchema = z.enum([
  "DRAFT",
  "NOT_STARTED",
  "ACTIVE",
  "PAUSED",
  "SOLD_OUT",
  "ENDED",
  "ARCHIVED",
]);

export const DropPoolStatusSchema = z.enum([
  "DRAFT",
  "VALIDATING",
  "SCHEDULED",
  "ACTIVE",
  "ARCHIVED",
  "DISABLED",
]);

export const ListingStatusSchema = z.enum([
  "ACTIVE",
  "SOLD",
  "PARTIALLY_SOLD",
  "CANCELED",
  "EXPIRED",
  "FROZEN",
]);

export const PaymentStatusSchema = z.enum([
  "CREATED",
  "INVOICE_SENT",
  "PRE_CHECKOUT",
  "PAID",
  "FULFILLED",
  "FAILED",
  "REFUNDED",
  "DISPUTED",
  "CANCELED",
]);

export const MintQueueStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "WAITING_CHAIN_CONFIRMATION",
  "MINTED",
  "FAILED",
  "RETRYING",
  "CANCELED",
]);

export const AdminRoleSchema = z.enum([
  "OWNER",
  "ADMIN",
  "OPS",
  "FINANCE",
  "SUPPORT",
  "MARKET_MANAGER",
  "CONTENT_MANAGER",
  "RISK_MANAGER",
  "READONLY",
]);

export const AdminStatusSchema = z.enum(["ACTIVE", "DISABLED", "LOCKED"]);

export const FeatureFlagValueTypeSchema = z.enum([
  "BOOLEAN",
  "STRING",
  "NUMBER",
  "JSON",
]);

export const BannerPlacementSchema = z.enum([
  "TRADE_BUY_TOP",
  "TASK_TOP",
  "BOX_TOP",
  "ALBUM_TOP",
  "COLLECTION_TOP",
  "HOME_POPUP",
]);

export const BannerTargetTypeSchema = z.enum([
  "NONE",
  "URL",
  "BOX",
  "MARKET_LISTING",
  "COLLECTIBLE",
  "TASK",
  "ALBUM",
  "WALLET",
  "INTERNAL_ROUTE",
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

export const TaskPeriodTypeSchema = z.enum([
  "NONE",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "CAMPAIGN",
]);

export const RiskEventStatusSchema = z.enum([
  "OPEN",
  "REVIEWING",
  "RESOLVED",
  "IGNORED",
]);

export const RiskSeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

/* -------------------------------------------------------------------------- */
/* 奖励 schema                                                                  */
/* -------------------------------------------------------------------------- */

export const RewardBaseSchema = z.object({
  rewardId: UUIDSchema.optional(),
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional(),
  iconUrl: UrlSchema.optional(),
});

export const CurrencyRewardSchema = RewardBaseSchema.extend({
  type: z.literal("CURRENCY"),
  currency: CurrencyCodeSchema,
  amount: PositiveMoneyAmountSchema,
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

export const ItemRewardSchema = RewardBaseSchema.extend({
  type: z.literal("ITEM"),
  itemId: UUIDSchema,
  itemCode: CodeSchema.optional(),
  quantity: z.coerce.number().int().min(1).max(1000).default(1),
});

export const DecorationRewardSchema = RewardBaseSchema.extend({
  type: z.literal("DECORATION"),
  decorationId: UUIDSchema,
  quantity: z.coerce.number().int().min(1).max(100).default(1),
});

export const AdminRewardSchema = z.discriminatedUnion("type", [
  CurrencyRewardSchema,
  CollectibleRewardSchema,
  BoxTicketRewardSchema,
  ItemRewardSchema,
  DecorationRewardSchema,
]);

export const AdminRewardsSchema = z.array(AdminRewardSchema).max(30);

/* -------------------------------------------------------------------------- */
/* Admin 登录 / 管理员                                                          */
/* -------------------------------------------------------------------------- */

export const AdminLoginBodySchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  otpCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional(),
});

export const AdminCreateBodySchema = z.object({
  email: z.string().trim().email().max(200),
  displayName: z.string().trim().min(1).max(80),
  roles: z.array(AdminRoleSchema).min(1).max(10),
  status: AdminStatusSchema.default("ACTIVE"),
  reason: AdminReasonSchema,
});

export const AdminUpdateBodySchema = z.object({
  adminUserId: UUIDSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
  roles: z.array(AdminRoleSchema).min(1).max(10).optional(),
  status: AdminStatusSchema.optional(),
  reason: AdminReasonSchema,
});

export const AdminListQuerySchema = PaginationQuerySchema.extend({
  email: z.string().trim().max(200).optional(),
  role: AdminRoleSchema.optional(),
  status: AdminStatusSchema.optional(),
});

/* -------------------------------------------------------------------------- */
/* 用户管理                                                                     */
/* -------------------------------------------------------------------------- */

export const AdminUserSortBySchema = z.enum([
  "CREATED_AT",
  "LAST_ACTIVE_AT",
  "KCOIN",
  "FGEMS",
  "OPEN_BOX_COUNT",
  "MARKET_VOLUME",
]);

export const AdminListUsersQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  telegramUserId: z.coerce.number().int().positive().optional(),
  status: UserStatusSchema.optional(),
  walletAddress: z.string().trim().min(10).max(128).optional(),
  hasWallet: BooleanQuerySchema.optional(),
  riskOnly: BooleanQuerySchema.optional(),
  sortBy: AdminUserSortBySchema.default("CREATED_AT").optional(),
  sortOrder: SortOrderSchema.default("DESC").optional(),
});

export const AdminUpdateUserStatusBodySchema = z.object({
  userId: UUIDSchema,
  status: UserStatusSchema,
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

export const AdminSetUserFlagBodySchema = z.object({
  userId: UUIDSchema,
  flagCode: CodeSchema,
  enabled: z.boolean(),
  expiresAt: IsoDateTimeSchema.optional(),
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

export const AdminAdjustUserBalanceBodySchema = z.object({
  userId: UUIDSchema,
  currency: CurrencyCodeSchema,
  direction: z.enum(["CREDIT", "DEBIT"]),
  amount: PositiveMoneyAmountSchema,
  sourceType: z.enum([
    "ADMIN_GRANT",
    "ADMIN_DEDUCT",
    "COMPENSATION",
    "PENALTY",
    "CORRECTION",
  ]),
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

/* -------------------------------------------------------------------------- */
/* 藏品 / Catalog 管理                                                          */
/* -------------------------------------------------------------------------- */

export const AdminCollectibleMediaSchema = z.object({
  imageUrl: UrlSchema,
  thumbnailUrl: UrlSchema.optional(),
  avatarUrl: UrlSchema.optional(),
  animationUrl: UrlSchema.optional(),
  metadataUrl: UrlSchema.optional(),
});

export const AdminCollectibleFormSchema = z.object({
  formIndex: z.coerce.number().int().min(1).max(3),
  formCode: CodeSchema,
  formName: z.string().trim().min(1).max(80),
  basePower: z.coerce.number().int().min(0).max(1_000_000),
  media: AdminCollectibleMediaSchema,
});

export const AdminCreateCollectibleBodySchema = z.object({
  code: CodeSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  seriesId: UUIDSchema,
  factionId: UUIDSchema.optional(),
  rarity: RaritySchema,
  itemType: ItemTypeSchema,
  rolePosition: z.string().trim().min(1).max(80).optional(),
  isTradable: z.boolean().default(true),
  isMintable: z.boolean().default(true),
  isDecomposable: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
  forms: z.array(AdminCollectibleFormSchema).min(1).max(3),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  metadata: JsonObjectSchema.optional(),
  reason: AdminReasonSchema,
});

export const AdminUpdateCollectibleBodySchema =
  AdminCreateCollectibleBodySchema.partial().extend({
    templateId: UUIDSchema,
    reason: AdminReasonSchema,
  });

export const AdminListCollectiblesQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  seriesId: UUIDSchema.optional(),
  rarity: RaritySchema.optional(),
  itemType: ItemTypeSchema.optional(),
  isTradable: BooleanQuerySchema.optional(),
  isMintable: BooleanQuerySchema.optional(),
});

/* -------------------------------------------------------------------------- */
/* 盲盒管理                                                                     */
/* -------------------------------------------------------------------------- */

export const AdminBoxPriceRuleSchema = z.object({
  singlePriceStars: z.coerce.number().int().positive().max(1_000_000),
  tenDrawDiscountRate: z.coerce.number().min(0.1).max(1).default(0.9),
  returnKcoinPerPaidOrder: z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .default(100),
});

export const AdminCreateBoxBodySchema = z.object({
  code: CodeSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  status: BoxStatusSchema.default("DRAFT"),
  tier: z.enum(["NORMAL", "RARE", "LEGENDARY"]),
  imageUrl: UrlSchema,
  smallImageUrl: UrlSchema.optional(),
  priceRule: AdminBoxPriceRuleSchema,
  totalInventory: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  startsAt: IsoDateTimeSchema.optional(),
  endsAt: IsoDateTimeSchema.optional(),
  sortOrder: z.coerce.number().int().default(0),
  metadata: JsonObjectSchema.optional(),
  reason: AdminReasonSchema,
});

export const AdminUpdateBoxBodySchema =
  AdminCreateBoxBodySchema.partial().extend({
    boxId: UUIDSchema,
    reason: AdminReasonSchema,
  });

export const AdminListBoxesQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  status: BoxStatusSchema.optional(),
  tier: z.enum(["NORMAL", "RARE", "LEGENDARY"]).optional(),
});

/* -------------------------------------------------------------------------- */
/* 奖励池 / 概率 / 保底管理                                                     */
/* -------------------------------------------------------------------------- */

export const AdminDropPoolItemSchema = z.object({
  templateId: UUIDSchema,
  formIndex: z.coerce.number().int().min(1).max(3).default(1),
  rarity: RaritySchema,
  weight: WeightSchema,
  stockLimit: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  isPityEligible: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  metadata: JsonObjectSchema.optional(),
});

export const AdminPityRuleSchema = z.object({
  enabled: z.boolean().default(true),
  threshold: z.coerce.number().int().min(1).max(10_000),
  targetRarities: z.array(RaritySchema).min(1).max(5),
  resetOnHitTarget: z.boolean().default(true),
});

export const AdminCreateDropPoolVersionBodySchema = z.object({
  boxId: UUIDSchema,
  versionName: z.string().trim().min(1).max(100),
  status: DropPoolStatusSchema.default("DRAFT"),
  items: z.array(AdminDropPoolItemSchema).min(1).max(500),
  pityRules: z.array(AdminPityRuleSchema).max(10).optional(),
  startsAt: IsoDateTimeSchema.optional(),
  reason: AdminReasonSchema,
});

export const AdminUpdateDropPoolVersionBodySchema = z.object({
  dropPoolVersionId: UUIDSchema,
  versionName: z.string().trim().min(1).max(100).optional(),
  items: z.array(AdminDropPoolItemSchema).min(1).max(500).optional(),
  pityRules: z.array(AdminPityRuleSchema).max(10).optional(),
  reason: AdminReasonSchema,
});

export const AdminPublishDropPoolVersionBodySchema = z.object({
  dropPoolVersionId: UUIDSchema,
  startsAt: IsoDateTimeSchema.optional(),
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

export const AdminListDropPoolsQuerySchema = PaginationQuerySchema.extend({
  boxId: UUIDSchema.optional(),
  status: DropPoolStatusSchema.optional(),
});

/* -------------------------------------------------------------------------- */
/* 市场管理                                                                     */
/* -------------------------------------------------------------------------- */

export const AdminMarketFeeRuleBodySchema = z.object({
  feeRate: PercentageSchema,
  minFeeKcoin: MoneyAmountSchema.default(0),
  maxFeeKcoin: MoneyAmountSchema.optional(),
  startsAt: IsoDateTimeSchema.optional(),
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

export const AdminPriceHealthRuleBodySchema = z.object({
  templateId: UUIDSchema.optional(),
  rarity: RaritySchema.optional(),
  minRatioToRecentAvg: z.coerce.number().min(0).max(10).default(0.5),
  maxRatioToRecentAvg: z.coerce.number().min(0).max(10).default(2),
  reason: AdminReasonSchema,
});

export const AdminListMarketListingsQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  status: ListingStatusSchema.optional(),
  sellerUserId: UUIDSchema.optional(),
  templateId: UUIDSchema.optional(),
  rarity: RaritySchema.optional(),
  minPrice: MoneyAmountSchema.optional(),
  maxPrice: MoneyAmountSchema.optional(),
  sortBy: z
    .enum(["CREATED_AT", "PRICE", "UPDATED_AT"])
    .default("CREATED_AT")
    .optional(),
  sortOrder: SortOrderSchema.default("DESC").optional(),
});

export const AdminFreezeListingBodySchema = z.object({
  listingId: UUIDSchema,
  freeze: z.boolean(),
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

export const AdminCancelListingBodySchema = z.object({
  listingId: UUIDSchema,
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

/* -------------------------------------------------------------------------- */
/* 任务 / 签到 / 邀请管理                                                       */
/* -------------------------------------------------------------------------- */

export const AdminTaskDefinitionBodySchema = z.object({
  code: CodeSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  category: TaskCategorySchema,
  action: TaskActionSchema,
  periodType: TaskPeriodTypeSchema,
  targetValue: z.coerce.number().int().positive().max(1_000_000),
  rewards: AdminRewardsSchema,
  isEnabled: z.boolean().default(true),
  startsAt: IsoDateTimeSchema.optional(),
  endsAt: IsoDateTimeSchema.optional(),
  sortOrder: z.coerce.number().int().default(0),
  actionText: z.string().trim().min(1).max(40).optional(),
  actionRoute: z.string().trim().min(1).max(200).optional(),
  metadata: JsonObjectSchema.optional(),
  reason: AdminReasonSchema,
});

export const AdminCreateTaskDefinitionBodySchema =
  AdminTaskDefinitionBodySchema;

export const AdminUpdateTaskDefinitionBodySchema =
  AdminTaskDefinitionBodySchema.partial().extend({
    taskId: UUIDSchema,
    reason: AdminReasonSchema,
  });

export const AdminListTasksQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  category: TaskCategorySchema.optional(),
  action: TaskActionSchema.optional(),
  periodType: TaskPeriodTypeSchema.optional(),
  isEnabled: BooleanQuerySchema.optional(),
});

export const AdminSigninDayRewardSchema = z.object({
  dayIndex: z.coerce.number().int().min(1).max(31),
  rewards: AdminRewardsSchema,
});

export const AdminSigninCampaignBodySchema = z.object({
  code: CodeSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  days: z.array(AdminSigninDayRewardSchema).min(1).max(31),
  isEnabled: z.boolean().default(true),
  startsAt: IsoDateTimeSchema.optional(),
  endsAt: IsoDateTimeSchema.optional(),
  reason: AdminReasonSchema,
});

export const AdminUpdateSigninCampaignBodySchema =
  AdminSigninCampaignBodySchema.partial().extend({
    campaignId: UUIDSchema,
    reason: AdminReasonSchema,
  });

export const AdminReferralCampaignBodySchema = z.object({
  code: CodeSchema,
  title: z.string().trim().min(1).max(120),
  inviterFirstOpenRewardKcoin: MoneyAmountSchema.default(500),
  inviteeFirstOpenRewardKcoin: MoneyAmountSchema.default(500),
  commissionRate: PercentageSchema.default(0.1),
  isEnabled: z.boolean().default(true),
  startsAt: IsoDateTimeSchema.optional(),
  endsAt: IsoDateTimeSchema.optional(),
  reason: AdminReasonSchema,
});

/* -------------------------------------------------------------------------- */
/* 图鉴 / 排行榜管理                                                            */
/* -------------------------------------------------------------------------- */

export const AdminAlbumBookBodySchema = z.object({
  code: CodeSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  coverImageUrl: UrlSchema.optional(),
  filterType: z.enum(["ALL", "SERIES", "FACTION", "RARITY", "EVENT"]),
  seriesId: UUIDSchema.optional(),
  factionId: UUIDSchema.optional(),
  rarity: RaritySchema.optional(),
  templateIds: z.array(UUIDSchema).max(1000).optional(),
  isEnabled: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
  reason: AdminReasonSchema,
});

export const AdminUpdateAlbumBookBodySchema =
  AdminAlbumBookBodySchema.partial().extend({
    albumBookId: UUIDSchema,
    reason: AdminReasonSchema,
  });

export const AdminAlbumMilestoneBodySchema = z.object({
  albumBookId: UUIDSchema,
  requiredCount: z.coerce.number().int().positive().max(100_000),
  rewards: AdminRewardsSchema,
  isEnabled: z.boolean().default(true),
  reason: AdminReasonSchema,
});

export const AdminUpdateAlbumMilestoneBodySchema =
  AdminAlbumMilestoneBodySchema.partial().extend({
    milestoneId: UUIDSchema,
    reason: AdminReasonSchema,
  });

export const AdminLeaderboardRuleBodySchema = z.object({
  code: CodeSchema,
  title: z.string().trim().min(1).max(120),
  collectScore: z.coerce.number().int().min(0).max(10_000).default(10),
  rareScore: z.coerce.number().int().min(0).max(10_000).default(30),
  epicScore: z.coerce.number().int().min(0).max(10_000).default(80),
  legendaryScore: z.coerce.number().int().min(0).max(10_000).default(200),
  mintScore: z.coerce.number().int().min(0).max(10_000).default(50),
  isEnabled: z.boolean().default(true),
  reason: AdminReasonSchema,
});

/* -------------------------------------------------------------------------- */
/* Banner / 活动图管理                                                          */
/* -------------------------------------------------------------------------- */

export const AdminBannerBodySchema = z.object({
  code: CodeSchema,
  placement: BannerPlacementSchema,
  title: z.string().trim().min(1).max(120),
  imageUrl: UrlSchema,
  targetType: BannerTargetTypeSchema,
  targetValue: z.string().trim().max(1000).optional(),
  isEnabled: z.boolean().default(true),
  startsAt: IsoDateTimeSchema.optional(),
  endsAt: IsoDateTimeSchema.optional(),
  sortOrder: z.coerce.number().int().default(0),
  metadata: JsonObjectSchema.optional(),
  reason: AdminReasonSchema,
});

export const AdminUpdateBannerBodySchema =
  AdminBannerBodySchema.partial().extend({
    bannerId: UUIDSchema,
    reason: AdminReasonSchema,
  });

export const AdminListBannersQuerySchema = PaginationQuerySchema.extend({
  placement: BannerPlacementSchema.optional(),
  isEnabled: BooleanQuerySchema.optional(),
});

/* -------------------------------------------------------------------------- */
/* 支付 / Stars 管理                                                            */
/* -------------------------------------------------------------------------- */

export const AdminListPaymentsQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  userId: UUIDSchema.optional(),
  status: PaymentStatusSchema.optional(),
  telegramPaymentChargeId: z.string().trim().min(1).max(200).optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  minStars: MoneyAmountSchema.optional(),
  maxStars: MoneyAmountSchema.optional(),
});

export const AdminRefundStarsPaymentBodySchema = z
  .object({
    paymentId: UUIDSchema.optional(),
    telegramPaymentChargeId: z.string().trim().min(1).max(200).optional(),
    userId: UUIDSchema,
    amountStars: PositiveMoneyAmountSchema.optional(),
    reason: AdminReasonSchema,
    idempotencyKey: IdempotencyKeySchema,
  })
  .refine(
    (value) => Boolean(value.paymentId || value.telegramPaymentChargeId),
    "paymentId 或 telegramPaymentChargeId 至少提供一个",
  );

export const AdminResolvePaymentDisputeBodySchema = z.object({
  disputeId: UUIDSchema,
  resolution: z.enum(["REFUNDED", "REJECTED", "COMPENSATED", "NO_ACTION"]),
  compensationRewards: AdminRewardsSchema.optional(),
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

/* -------------------------------------------------------------------------- */
/* NFT / Mint 管理                                                              */
/* -------------------------------------------------------------------------- */

const RAW_TON_ADDRESS_RE = /^-?\d+:[a-fA-F0-9]{64}$/;
const USER_FRIENDLY_TON_ADDRESS_RE = /^(?:EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/;

export const TonAddressSchema = z
  .string()
  .trim()
  .min(10)
  .max(128)
  .refine(
    (value) =>
      RAW_TON_ADDRESS_RE.test(value) ||
      USER_FRIENDLY_TON_ADDRESS_RE.test(value),
    "TON 地址格式不正确",
  );

export const TonChainSchema = z.enum(["MAINNET", "TESTNET"]);

export const AdminNftCollectionBodySchema = z.object({
  code: CodeSchema,
  name: z.string().trim().min(1).max(120),
  chain: TonChainSchema,
  collectionAddress: TonAddressSchema,
  ownerAddress: TonAddressSchema.optional(),
  metadataUrl: UrlSchema,
  royaltyEnabled: z.boolean().default(false),
  royaltyRate: PercentageSchema.optional(),
  isEnabled: z.boolean().default(true),
  reason: AdminReasonSchema,
});

export const AdminUpdateNftCollectionBodySchema =
  AdminNftCollectionBodySchema.partial().extend({
    collectionId: UUIDSchema,
    reason: AdminReasonSchema,
  });

export const AdminListMintQueueQuerySchema = PaginationQuerySchema.extend({
  status: MintQueueStatusSchema.optional(),
  userId: UUIDSchema.optional(),
  itemInstanceId: UUIDSchema.optional(),
  collectionId: UUIDSchema.optional(),
  chain: TonChainSchema.optional(),
});

export const AdminRetryMintBodySchema = z.object({
  mintQueueId: UUIDSchema,
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("HIGH"),
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

export const AdminCancelMintBodySchema = z.object({
  mintQueueId: UUIDSchema,
  unlockItem: z.boolean().default(true),
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

/* -------------------------------------------------------------------------- */
/* 功能开关 / 系统配置                                                          */
/* -------------------------------------------------------------------------- */

export const AdminFeatureFlagBodySchema = z.object({
  key: CodeSchema,
  description: z.string().trim().max(300).optional(),
  valueType: FeatureFlagValueTypeSchema,
  value: z.union([z.boolean(), z.string(), z.number(), JsonObjectSchema]),
  isPublic: z.boolean().default(false),
  reason: AdminReasonSchema,
});

export const AdminSystemSettingBodySchema = z.object({
  key: CodeSchema,
  value: z.union([z.string(), z.number(), z.boolean(), JsonObjectSchema]),
  description: z.string().trim().max(300).optional(),
  reason: AdminReasonSchema,
});

/* -------------------------------------------------------------------------- */
/* 风控 / 审计                                                                  */
/* -------------------------------------------------------------------------- */

export const AdminListRiskEventsQuerySchema = PaginationQuerySchema.extend({
  userId: UUIDSchema.optional(),
  status: RiskEventStatusSchema.optional(),
  severity: RiskSeveritySchema.optional(),
  eventCode: CodeSchema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
});

export const AdminResolveRiskEventBodySchema = z.object({
  riskEventId: UUIDSchema,
  status: z.enum(["RESOLVED", "IGNORED"]),
  action: z.enum([
    "NO_ACTION",
    "WARN_USER",
    "FREEZE_USER",
    "BAN_USER",
    "LIMIT_MARKET",
    "LIMIT_GACHA",
  ]),
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

export const AdminAuditEntityTypeSchema = z.enum([
  "USER",
  "BALANCE",
  "BOX",
  "DROP_POOL",
  "COLLECTIBLE",
  "MARKET",
  "TASK",
  "ALBUM",
  "PAYMENT",
  "NFT",
  "BANNER",
  "FEATURE_FLAG",
  "SYSTEM_SETTING",
  "RISK",
  "ADMIN",
]);

export const AdminListAuditLogsQuerySchema = PaginationQuerySchema.extend({
  adminUserId: UUIDSchema.optional(),
  entityType: AdminAuditEntityTypeSchema.optional(),
  entityId: UUIDSchema.optional(),
  action: z.string().trim().min(1).max(80).optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
});

/* -------------------------------------------------------------------------- */
/* 批量操作                                                                     */
/* -------------------------------------------------------------------------- */

export const AdminBulkActionBodySchema = z.object({
  entityType: AdminAuditEntityTypeSchema,
  entityIds: z.array(UUIDSchema).min(1).max(200),
  action: z.string().trim().min(2).max(80),
  payload: JsonObjectSchema.optional(),
  reason: AdminReasonSchema,
  idempotencyKey: IdempotencyKeySchema,
});

/* -------------------------------------------------------------------------- */
/* 通用响应                                                                     */
/* -------------------------------------------------------------------------- */

export const AdminMutationResponseSchema = z.object({
  success: z.boolean(),
  entityId: UUIDSchema.optional(),
  auditLogId: UUIDSchema.optional(),
  message: z.string().trim().max(300).optional(),
});

export const AdminListResponseMetaSchema = z.object({
  nextCursor: CursorSchema.nullable().optional(),
  total: z.coerce.number().int().min(0).optional(),
  serverTime: IsoDateTimeSchema,
});

/* -------------------------------------------------------------------------- */
/* 导出类型                                                                     */
/* -------------------------------------------------------------------------- */

export type UUID = z.infer<typeof UUIDSchema>;

export type AdminRole = z.infer<typeof AdminRoleSchema>;
export type AdminStatus = z.infer<typeof AdminStatusSchema>;

export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
export type Rarity = z.infer<typeof RaritySchema>;
export type ItemType = z.infer<typeof ItemTypeSchema>;

export type UserStatus = z.infer<typeof UserStatusSchema>;
export type BoxStatus = z.infer<typeof BoxStatusSchema>;
export type DropPoolStatus = z.infer<typeof DropPoolStatusSchema>;
export type ListingStatus = z.infer<typeof ListingStatusSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type MintQueueStatus = z.infer<typeof MintQueueStatusSchema>;

export type AdminReward = z.infer<typeof AdminRewardSchema>;

export type AdminLoginBody = z.infer<typeof AdminLoginBodySchema>;
export type AdminCreateBody = z.infer<typeof AdminCreateBodySchema>;
export type AdminUpdateBody = z.infer<typeof AdminUpdateBodySchema>;
export type AdminListQuery = z.infer<typeof AdminListQuerySchema>;

export type AdminListUsersQuery = z.infer<typeof AdminListUsersQuerySchema>;
export type AdminUpdateUserStatusBody = z.infer<
  typeof AdminUpdateUserStatusBodySchema
>;
export type AdminSetUserFlagBody = z.infer<typeof AdminSetUserFlagBodySchema>;
export type AdminAdjustUserBalanceBody = z.infer<
  typeof AdminAdjustUserBalanceBodySchema
>;

export type AdminCreateCollectibleBody = z.infer<
  typeof AdminCreateCollectibleBodySchema
>;
export type AdminUpdateCollectibleBody = z.infer<
  typeof AdminUpdateCollectibleBodySchema
>;
export type AdminListCollectiblesQuery = z.infer<
  typeof AdminListCollectiblesQuerySchema
>;

export type AdminCreateBoxBody = z.infer<typeof AdminCreateBoxBodySchema>;
export type AdminUpdateBoxBody = z.infer<typeof AdminUpdateBoxBodySchema>;
export type AdminListBoxesQuery = z.infer<typeof AdminListBoxesQuerySchema>;

export type AdminCreateDropPoolVersionBody = z.infer<
  typeof AdminCreateDropPoolVersionBodySchema
>;
export type AdminUpdateDropPoolVersionBody = z.infer<
  typeof AdminUpdateDropPoolVersionBodySchema
>;
export type AdminPublishDropPoolVersionBody = z.infer<
  typeof AdminPublishDropPoolVersionBodySchema
>;
export type AdminListDropPoolsQuery = z.infer<
  typeof AdminListDropPoolsQuerySchema
>;

export type AdminMarketFeeRuleBody = z.infer<
  typeof AdminMarketFeeRuleBodySchema
>;
export type AdminPriceHealthRuleBody = z.infer<
  typeof AdminPriceHealthRuleBodySchema
>;
export type AdminListMarketListingsQuery = z.infer<
  typeof AdminListMarketListingsQuerySchema
>;
export type AdminFreezeListingBody = z.infer<
  typeof AdminFreezeListingBodySchema
>;
export type AdminCancelListingBody = z.infer<
  typeof AdminCancelListingBodySchema
>;

export type AdminCreateTaskDefinitionBody = z.infer<
  typeof AdminCreateTaskDefinitionBodySchema
>;
export type AdminUpdateTaskDefinitionBody = z.infer<
  typeof AdminUpdateTaskDefinitionBodySchema
>;
export type AdminListTasksQuery = z.infer<typeof AdminListTasksQuerySchema>;
export type AdminSigninCampaignBody = z.infer<
  typeof AdminSigninCampaignBodySchema
>;
export type AdminUpdateSigninCampaignBody = z.infer<
  typeof AdminUpdateSigninCampaignBodySchema
>;
export type AdminReferralCampaignBody = z.infer<
  typeof AdminReferralCampaignBodySchema
>;

export type AdminAlbumBookBody = z.infer<typeof AdminAlbumBookBodySchema>;
export type AdminUpdateAlbumBookBody = z.infer<
  typeof AdminUpdateAlbumBookBodySchema
>;
export type AdminAlbumMilestoneBody = z.infer<
  typeof AdminAlbumMilestoneBodySchema
>;
export type AdminUpdateAlbumMilestoneBody = z.infer<
  typeof AdminUpdateAlbumMilestoneBodySchema
>;
export type AdminLeaderboardRuleBody = z.infer<
  typeof AdminLeaderboardRuleBodySchema
>;

export type AdminBannerBody = z.infer<typeof AdminBannerBodySchema>;
export type AdminUpdateBannerBody = z.infer<typeof AdminUpdateBannerBodySchema>;
export type AdminListBannersQuery = z.infer<typeof AdminListBannersQuerySchema>;

export type AdminListPaymentsQuery = z.infer<
  typeof AdminListPaymentsQuerySchema
>;
export type AdminRefundStarsPaymentBody = z.infer<
  typeof AdminRefundStarsPaymentBodySchema
>;
export type AdminResolvePaymentDisputeBody = z.infer<
  typeof AdminResolvePaymentDisputeBodySchema
>;

export type AdminNftCollectionBody = z.infer<
  typeof AdminNftCollectionBodySchema
>;
export type AdminUpdateNftCollectionBody = z.infer<
  typeof AdminUpdateNftCollectionBodySchema
>;
export type AdminListMintQueueQuery = z.infer<
  typeof AdminListMintQueueQuerySchema
>;
export type AdminRetryMintBody = z.infer<typeof AdminRetryMintBodySchema>;
export type AdminCancelMintBody = z.infer<typeof AdminCancelMintBodySchema>;

export type AdminFeatureFlagBody = z.infer<typeof AdminFeatureFlagBodySchema>;
export type AdminSystemSettingBody = z.infer<
  typeof AdminSystemSettingBodySchema
>;

export type AdminListRiskEventsQuery = z.infer<
  typeof AdminListRiskEventsQuerySchema
>;
export type AdminResolveRiskEventBody = z.infer<
  typeof AdminResolveRiskEventBodySchema
>;
export type AdminListAuditLogsQuery = z.infer<
  typeof AdminListAuditLogsQuerySchema
>;

export type AdminBulkActionBody = z.infer<typeof AdminBulkActionBodySchema>;
export type AdminMutationResponse = z.infer<typeof AdminMutationResponseSchema>;
export type AdminListResponseMeta = z.infer<typeof AdminListResponseMetaSchema>;
