// packages/validation/src/album.schemas.ts

import { z } from "zod";

/**
 * Album validation schemas
 *
 * 负责：
 * - 图鉴进度查询
 * - 系列图鉴查询
 * - 图鉴里程碑奖励领取
 * - 周榜 / 排行榜
 * - 用户首次发现记录
 *
 * 注意：
 * - 图鉴进度应基于 user_discoveries，而不是当前库存。
 * - 用户出售、分解或 Mint 藏品后，不应该丢失已经点亮的图鉴。
 * - 奖励是否可领取必须以后端根据图鉴进度判断。
 */

const uuidSchema = z.string().trim().uuid();

const cursorSchema = z
  .string()
  .trim()
  .min(1, "cursor cannot be empty")
  .max(512, "cursor is too long");

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(16, "idempotency_key must be at least 16 characters")
  .max(128, "idempotency_key is too long")
  .regex(/^[a-zA-Z0-9:_-]+$/, {
    message:
      "idempotency_key can only contain letters, numbers, colon, underscore and hyphen",
  });

const isoDateTimeSchema = z.string().datetime();

const nonNegativeIntegerSchema = z.coerce.number().int().min(0);

const nonNegativeAmountSchema = z.coerce
  .number()
  .int()
  .min(0, "amount cannot be negative")
  .max(1_000_000_000, "amount is too large");

const booleanFromQuerySchema = z.preprocess((value) => {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  }

  return value;
}, z.boolean());

const csvArraySchema = <T extends z.ZodTypeAny>(itemSchema: T, max = 20) =>
  z
    .preprocess((value) => {
      if (value === undefined || value === null || value === "")
        return undefined;

      if (Array.isArray(value)) {
        return value
          .flatMap((item) =>
            typeof item === "string" ? item.split(",") : [item],
          )
          .map((item) => (typeof item === "string" ? item.trim() : item))
          .filter((item) => item !== "");
      }

      if (typeof value === "string") {
        return value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }

      return value;
    }, z.array(itemSchema).max(max))
    .optional();

export const AlbumCurrencySchema = z.enum([
  "KCOIN",
  "FGEMS",
  "STAR_DISPLAY",
  "ITEM",
  "DECORATION",
]);

export const AlbumRarityCodeSchema = z.enum([
  "common",
  "rare",
  "epic",
  "legendary",
  "mythic",
]);

export const AlbumItemTypeSchema = z.enum([
  "character",
  "pet",
  "egg",
  "decoration",
  "prop",
  "material",
]);

export const AlbumBookTypeSchema = z.enum([
  "all",
  "series",
  "faction",
  "rarity",
  "event",
  "limited",
]);

export const AlbumItemCollectStatusSchema = z.enum([
  "collected",
  "uncollected",
  "all",
]);

export const AlbumMilestoneStatusSchema = z.enum([
  "locked",
  "claimable",
  "claimed",
  "expired",
]);

export const AlbumLeaderboardScopeSchema = z.enum([
  "global",
  "friends",
  "series",
  "faction",
  "rarity",
]);

export const AlbumLeaderboardSortSchema = z.enum([
  "score_desc",
  "completion_desc",
  "rare_count_desc",
  "mint_count_desc",
]);

export const AlbumLeaderboardPeriodSchema = z.enum([
  "current_week",
  "last_week",
  "current_month",
  "all_time",
]);

export const AlbumBookIdParamSchema = z
  .object({
    book_id: uuidSchema,
  })
  .strict();

export const AlbumMilestoneIdParamSchema = z
  .object({
    milestone_id: uuidSchema,
  })
  .strict();

export const AlbumProgressQuerySchema = z
  .object({
    /**
     * 不传 book_id 时，返回总图鉴进度。
     * 传 book_id 时，返回指定图鉴册进度。
     */
    book_id: uuidSchema.optional(),

    book_type: AlbumBookTypeSchema.optional(),

    series_id: uuidSchema.optional(),
    faction_id: uuidSchema.optional(),
    rarity: AlbumRarityCodeSchema.optional(),

    include_items: booleanFromQuerySchema.default(true),
    include_milestones: booleanFromQuerySchema.default(true),
    include_rewards: booleanFromQuerySchema.default(true),
    include_locked_items: booleanFromQuerySchema.default(true),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.book_type === "series" && !data.series_id && !data.book_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["series_id"],
        message:
          "series_id is required when book_type is series and book_id is not provided",
      });
    }

    if (data.book_type === "faction" && !data.faction_id && !data.book_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["faction_id"],
        message:
          "faction_id is required when book_type is faction and book_id is not provided",
      });
    }

    if (data.book_type === "rarity" && !data.rarity && !data.book_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rarity"],
        message:
          "rarity is required when book_type is rarity and book_id is not provided",
      });
    }
  });

export const AlbumSeriesQuerySchema = z
  .object({
    book_type: AlbumBookTypeSchema.optional(),

    series_ids: csvArraySchema(uuidSchema, 30),
    faction_ids: csvArraySchema(uuidSchema, 30),
    rarities: csvArraySchema(AlbumRarityCodeSchema, 8),
    types: csvArraySchema(AlbumItemTypeSchema, 12),

    status: AlbumItemCollectStatusSchema.default("all"),

    keyword: z.string().trim().max(64).optional(),

    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const AlbumItemsQuerySchema = z
  .object({
    book_id: uuidSchema.optional(),

    series_id: uuidSchema.optional(),
    faction_id: uuidSchema.optional(),
    rarity: AlbumRarityCodeSchema.optional(),
    type: AlbumItemTypeSchema.optional(),

    status: AlbumItemCollectStatusSchema.default("all"),

    keyword: z.string().trim().max(64).optional(),

    sort: z
      .enum([
        "album_order",
        "rarity_desc",
        "rarity_asc",
        "name_asc",
        "name_desc",
        "collected_at_desc",
      ])
      .default("album_order"),

    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(120).default(60),
  })
  .strict();

export const AlbumClaimMilestoneRewardBodySchema = z
  .object({
    milestone_id: uuidSchema,

    /**
     * 可选。
     * 如果前端知道图鉴册 ID，可以一起传入，后端用于更快定位。
     */
    book_id: uuidSchema.optional(),

    /**
     * 前端看到的 milestone version。
     * 后端用于防止奖励配置变更后用户误领旧奖励。
     */
    expected_milestone_version: z.coerce.number().int().min(0).optional(),

    idempotency_key: idempotencyKeySchema,
  })
  .strict();

export const AlbumMilestonesQuerySchema = z
  .object({
    book_id: uuidSchema.optional(),

    statuses: csvArraySchema(AlbumMilestoneStatusSchema, 10),

    include_claimed: booleanFromQuerySchema.default(true),
    include_locked: booleanFromQuerySchema.default(true),
    include_expired: booleanFromQuerySchema.default(false),
  })
  .strict();

export const AlbumLeaderboardQuerySchema = z
  .object({
    board_id: uuidSchema.optional(),

    period: AlbumLeaderboardPeriodSchema.default("current_week"),
    scope: AlbumLeaderboardScopeSchema.default("global"),

    /**
     * scope 为 series / faction / rarity 时，后端需要对应 scope id。
     */
    series_id: uuidSchema.optional(),
    faction_id: uuidSchema.optional(),
    rarity: AlbumRarityCodeSchema.optional(),

    sort: AlbumLeaderboardSortSchema.default("score_desc"),

    around_me: booleanFromQuerySchema.default(false),

    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.scope === "series" && !data.series_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["series_id"],
        message: "series_id is required when scope is series",
      });
    }

    if (data.scope === "faction" && !data.faction_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["faction_id"],
        message: "faction_id is required when scope is faction",
      });
    }

    if (data.scope === "rarity" && !data.rarity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rarity"],
        message: "rarity is required when scope is rarity",
      });
    }
  });

export const AlbumDiscoveriesQuerySchema = z
  .object({
    book_id: uuidSchema.optional(),

    template_id: uuidSchema.optional(),
    series_id: uuidSchema.optional(),
    faction_id: uuidSchema.optional(),

    rarities: csvArraySchema(AlbumRarityCodeSchema, 8),
    types: csvArraySchema(AlbumItemTypeSchema, 12),

    from_at: isoDateTimeSchema.optional(),
    to_at: isoDateTimeSchema.optional(),

    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.from_at && data.to_at) {
      const from = Date.parse(data.from_at);
      const to = Date.parse(data.to_at);

      if (from > to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["from_at"],
          message: "from_at cannot be later than to_at",
        });
      }
    }
  });

export const AlbumRewardSchema = z
  .object({
    reward_type: AlbumCurrencySchema,

    /**
     * reward_type 为 KCOIN / FGEMS / STAR_DISPLAY 时使用 amount。
     */
    amount: nonNegativeAmountSchema.optional(),

    /**
     * reward_type 为 ITEM / DECORATION 时使用 template_id。
     */
    template_id: uuidSchema.optional(),

    label: z.string().trim().min(1).max(64),
    icon_url: z.string().url().nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      ["KCOIN", "FGEMS", "STAR_DISPLAY"].includes(data.reward_type) &&
      data.amount === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "amount is required for currency rewards",
      });
    }

    if (
      ["ITEM", "DECORATION"].includes(data.reward_type) &&
      !data.template_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["template_id"],
        message: "template_id is required for item rewards",
      });
    }
  });

export const AlbumBookDtoSchema = z
  .object({
    book_id: uuidSchema,

    book_type: AlbumBookTypeSchema,

    name: z.string(),
    description: z.string().nullable().optional(),

    cover_url: z.string().url().nullable().optional(),

    total_count: nonNegativeIntegerSchema,
    collected_count: nonNegativeIntegerSchema,
    completion_percent: z.number().min(0).max(100),

    is_event_limited: z.boolean().default(false),

    starts_at: isoDateTimeSchema.nullable().optional(),
    ends_at: isoDateTimeSchema.nullable().optional(),
  })
  .strict();

export const AlbumItemDtoSchema = z
  .object({
    template_id: uuidSchema,
    form_id: uuidSchema.optional(),

    name: z.string(),
    description: z.string().nullable().optional(),

    rarity: AlbumRarityCodeSchema,
    type: AlbumItemTypeSchema,

    series_id: uuidSchema.optional(),
    series_name: z.string().nullable().optional(),

    faction_id: uuidSchema.optional(),
    faction_name: z.string().nullable().optional(),

    image_url: z.string().url().nullable().optional(),
    thumb_url: z.string().url().nullable().optional(),

    is_collected: z.boolean(),

    first_collected_at: isoDateTimeSchema.nullable().optional(),

    collected_count: nonNegativeIntegerSchema.optional(),

    album_order: z.number().int().min(0).optional(),
  })
  .strict();

export const AlbumMilestoneDtoSchema = z
  .object({
    milestone_id: uuidSchema,
    book_id: uuidSchema,

    required_count: z.number().int().min(1),
    required_percent: z.number().min(0).max(100).optional(),

    status: AlbumMilestoneStatusSchema,

    rewards: z.array(AlbumRewardSchema),

    claimed_at: isoDateTimeSchema.nullable().optional(),

    version: z.number().int().min(0),
  })
  .strict();

export const AlbumProgressDtoSchema = z
  .object({
    book: AlbumBookDtoSchema,

    items: z.array(AlbumItemDtoSchema).optional(),

    milestones: z.array(AlbumMilestoneDtoSchema).optional(),

    rarity_summary: z
      .array(
        z
          .object({
            rarity: AlbumRarityCodeSchema,
            total_count: nonNegativeIntegerSchema,
            collected_count: nonNegativeIntegerSchema,
          })
          .strict(),
      )
      .optional(),

    series_summary: z
      .array(
        z
          .object({
            series_id: uuidSchema,
            series_name: z.string(),
            total_count: nonNegativeIntegerSchema,
            collected_count: nonNegativeIntegerSchema,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const AlbumClaimMilestoneRewardResponseSchema = z
  .object({
    milestone_id: uuidSchema,
    book_id: uuidSchema,

    status: z.literal("claimed"),

    rewards: z.array(AlbumRewardSchema),

    /**
     * 领取奖励后的资产快照。
     * 只返回受影响资产即可。
     */
    balance_changes: z
      .array(
        z
          .object({
            currency: z.enum(["KCOIN", "FGEMS"]),
            delta: z.number().int(),
            balance_after: nonNegativeAmountSchema,
          })
          .strict(),
      )
      .optional(),

    claimed_at: isoDateTimeSchema,
  })
  .strict();

export const AlbumLeaderboardEntryDtoSchema = z
  .object({
    rank: z.number().int().min(1),

    user_id: uuidSchema,

    display_name: z.string(),
    avatar_url: z.string().url().nullable().optional(),

    score: nonNegativeIntegerSchema,

    completion_percent: z.number().min(0).max(100),

    collected_count: nonNegativeIntegerSchema,
    total_count: nonNegativeIntegerSchema,

    rare_count: nonNegativeIntegerSchema,
    epic_count: nonNegativeIntegerSchema,
    legendary_count: nonNegativeIntegerSchema,

    mint_count: nonNegativeIntegerSchema,

    updated_at: isoDateTimeSchema,
  })
  .strict();

export const AlbumLeaderboardResponseSchema = z
  .object({
    board_id: uuidSchema.nullable(),

    period: AlbumLeaderboardPeriodSchema,
    scope: AlbumLeaderboardScopeSchema,

    entries: z.array(AlbumLeaderboardEntryDtoSchema),

    my_entry: AlbumLeaderboardEntryDtoSchema.nullable().optional(),

    next_cursor: cursorSchema.nullable(),

    generated_at: isoDateTimeSchema,
  })
  .strict();

export const AlbumDiscoveryDtoSchema = z
  .object({
    discovery_id: uuidSchema,

    template_id: uuidSchema,
    item_instance_id: uuidSchema.nullable(),

    name: z.string(),
    rarity: AlbumRarityCodeSchema,
    type: AlbumItemTypeSchema,

    image_url: z.string().url().nullable().optional(),

    source_type: z.enum([
      "gacha",
      "market",
      "admin",
      "task_reward",
      "album_reward",
      "onchain_sync",
    ]),

    source_id: uuidSchema.nullable(),

    discovered_at: isoDateTimeSchema,
  })
  .strict();

export const AlbumDiscoveriesResponseSchema = z
  .object({
    items: z.array(AlbumDiscoveryDtoSchema),
    next_cursor: cursorSchema.nullable(),
  })
  .strict();

export const AlbumSeriesResponseSchema = z
  .object({
    books: z.array(AlbumBookDtoSchema),
    next_cursor: cursorSchema.nullable(),
  })
  .strict();

export type AlbumCurrency = z.infer<typeof AlbumCurrencySchema>;
export type AlbumRarityCode = z.infer<typeof AlbumRarityCodeSchema>;
export type AlbumItemType = z.infer<typeof AlbumItemTypeSchema>;
export type AlbumBookType = z.infer<typeof AlbumBookTypeSchema>;
export type AlbumItemCollectStatus = z.infer<
  typeof AlbumItemCollectStatusSchema
>;
export type AlbumMilestoneStatus = z.infer<typeof AlbumMilestoneStatusSchema>;
export type AlbumLeaderboardScope = z.infer<typeof AlbumLeaderboardScopeSchema>;
export type AlbumLeaderboardSort = z.infer<typeof AlbumLeaderboardSortSchema>;
export type AlbumLeaderboardPeriod = z.infer<
  typeof AlbumLeaderboardPeriodSchema
>;

export type AlbumProgressQueryInput = z.input<typeof AlbumProgressQuerySchema>;
export type AlbumProgressQuery = z.output<typeof AlbumProgressQuerySchema>;

export type AlbumSeriesQueryInput = z.input<typeof AlbumSeriesQuerySchema>;
export type AlbumSeriesQuery = z.output<typeof AlbumSeriesQuerySchema>;

export type AlbumItemsQueryInput = z.input<typeof AlbumItemsQuerySchema>;
export type AlbumItemsQuery = z.output<typeof AlbumItemsQuerySchema>;

export type AlbumClaimMilestoneRewardBodyInput = z.input<
  typeof AlbumClaimMilestoneRewardBodySchema
>;
export type AlbumClaimMilestoneRewardBody = z.output<
  typeof AlbumClaimMilestoneRewardBodySchema
>;

export type AlbumMilestonesQueryInput = z.input<
  typeof AlbumMilestonesQuerySchema
>;
export type AlbumMilestonesQuery = z.output<typeof AlbumMilestonesQuerySchema>;

export type AlbumLeaderboardQueryInput = z.input<
  typeof AlbumLeaderboardQuerySchema
>;
export type AlbumLeaderboardQuery = z.output<
  typeof AlbumLeaderboardQuerySchema
>;

export type AlbumDiscoveriesQueryInput = z.input<
  typeof AlbumDiscoveriesQuerySchema
>;
export type AlbumDiscoveriesQuery = z.output<
  typeof AlbumDiscoveriesQuerySchema
>;

export type AlbumReward = z.infer<typeof AlbumRewardSchema>;
export type AlbumBookDto = z.infer<typeof AlbumBookDtoSchema>;
export type AlbumItemDto = z.infer<typeof AlbumItemDtoSchema>;
export type AlbumMilestoneDto = z.infer<typeof AlbumMilestoneDtoSchema>;
export type AlbumProgressDto = z.infer<typeof AlbumProgressDtoSchema>;
export type AlbumLeaderboardEntryDto = z.infer<
  typeof AlbumLeaderboardEntryDtoSchema
>;
export type AlbumDiscoveryDto = z.infer<typeof AlbumDiscoveryDtoSchema>;
