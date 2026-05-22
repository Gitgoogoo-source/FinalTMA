import { z } from "zod";

/**
 * box.schemas.ts
 *
 * 责任：
 * 1. 校验盲盒列表、奖励池、保底、开盒订单、开盒结果相关 API。
 * 2. 校验 Telegram Stars 开盒订单创建参数。
 * 3. 校验后台盲盒、价格、奖励池、保底规则配置。
 *
 * 安全原则：
 * - 前端传 expectedPriceStars / expectedPoolVersionId 只用于防止用户看到旧价格。
 * - 最终价格、库存、活动状态、概率、保底、奖励发放全部以后端和数据库事务为准。
 * - 任何开盒结果不能由前端生成或提交。
 */

const ISO_DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9:_-]{16,128}$/;

const blankToUndefined = (value: unknown): unknown => {
  if (value === "" || value === null) return undefined;
  return value;
};

const emptyStringToUndefined = (value: unknown): unknown => {
  if (value === "") return undefined;
  return value;
};

const createIntQuerySchema = (min: number, max: number, defaultValue: number) =>
  z
    .preprocess((value) => {
      if (value === "" || value === null || value === undefined) {
        return undefined;
      }
      return value;
    }, z.coerce.number().int().min(min).max(max).optional())
    .transform((value) => value ?? defaultValue);

const createBooleanQuerySchema = (defaultValue: boolean) =>
  z
    .preprocess((value) => {
      if (value === "" || value === null || value === undefined) {
        return undefined;
      }

      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
        return value;
      }

      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();

        if (["true", "1", "yes", "on"].includes(normalized)) {
          return true;
        }

        if (["false", "0", "no", "off"].includes(normalized)) {
          return false;
        }

        return value;
      }

      return value;
    }, z.boolean().optional())
    .transform((value) => value ?? defaultValue);

const BoxUuidSchema = z.string().uuid();

const BoxIsoDateTimeSchema = z
  .string()
  .trim()
  .regex(ISO_DATE_TIME_RE, "Expected ISO 8601 datetime with timezone.");

const BoxNullableIsoDateTimeSchema = z
  .preprocess(emptyStringToUndefined, BoxIsoDateTimeSchema.nullish())
  .transform((value) => value ?? null);

const BoxRequiredUrlSchema = z.string().trim().url().max(2048);

const BoxOptionalUrlSchema = z.preprocess(
  blankToUndefined,
  BoxRequiredUrlSchema.optional(),
);

const BoxNonNegativeIntSchema = z.number().int().nonnegative();

const BoxPositiveIntSchema = z.number().int().positive();

const BoxBasisPointsSchema = z.number().int().min(0).max(10000);

const BoxProbabilityBasisPointsSchema = z.number().int().min(0).max(10000);

export const BoxIdSchema = BoxUuidSchema;

export const BoxSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    SLUG_RE,
    "Slug must use lowercase letters, numbers, underscore or dash.",
  );

export const BoxCursorSchema = z.string().trim().min(1).max(512);

export const BoxIdempotencyKeySchema = z
  .string()
  .trim()
  .regex(
    IDEMPOTENCY_KEY_RE,
    "Idempotency key must be 16-128 chars and use letters, numbers, colon, underscore or dash.",
  );

export const BoxRarityCodeSchema = z.enum([
  "common",
  "rare",
  "epic",
  "legendary",
  "mythic",
]);

export const BoxItemTypeSchema = z.enum([
  "character",
  "pet",
  "egg",
  "decoration",
  "material",
  "ticket",
]);

export const BoxTierSchema = z.enum([
  "normal",
  "ordinary",
  "rare",
  "legendary",
  "event",
]);

export const BoxStatusSchema = z.enum([
  "not_started",
  "active",
  "paused",
  "ended",
  "sold_out",
  "hidden",
]);

export const BoxOpenTypeSchema = z.enum(["single", "ten"]);

export const BoxPaymentProviderSchema = z.literal("telegram_stars");

export const BoxPaymentCurrencySchema = z.literal("XTR");

export const BoxCurrencyCodeSchema = z.enum(["KCOIN", "FGEMS", "XTR"]);

export const BoxDrawOrderStatusSchema = z.enum([
  "pending_payment",
  "paid",
  "processing",
  "completed",
  "failed",
  "expired",
  "cancelled",
]);

export const BoxRewardSourceSchema = z.enum([
  "random",
  "pity",
  "admin_compensation",
]);

export const BoxClientContextSchema = z
  .object({
    source: z
      .enum([
        "box_page",
        "quick_open",
        "task_entry",
        "admin_preview",
        "unknown",
      ])
      .optional(),
    platform: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(32).optional(),
    ),
    clientOrderNonce: z.preprocess(
      blankToUndefined,
      z.string().trim().min(8).max(128).optional(),
    ),
  })
  .strict();

export const BoxAssetAmountSchema = z
  .object({
    currency: BoxCurrencyCodeSchema,
    amount: BoxNonNegativeIntSchema,
  })
  .strict();

export const BoxPriceSchema = z
  .object({
    paymentProvider: BoxPaymentProviderSchema,
    paymentCurrency: BoxPaymentCurrencySchema,

    /**
     * 单抽 Stars 数量。
     */
    singleStars: BoxPositiveIntSchema,

    /**
     * 十连原价，一般为 singleStars * 10。
     */
    tenOriginalStars: BoxPositiveIntSchema,

    /**
     * 十连折扣价。
     * 例如 9 折：tenDiscountedStars = tenOriginalStars * 0.9。
     */
    tenDiscountedStars: BoxPositiveIntSchema,

    /**
     * 折扣比例，basis points。
     * 1000 表示 10% off；9000 表示支付 90% 不建议这样存。
     * 本项目约定：discountBps = 优惠比例。
     */
    tenDiscountBps: BoxBasisPointsSchema,

    /**
     * 每抽返还 K-coin。
     * 如果十连每抽返还 100，则十连返还 1000。
     */
    kcoinReturnPerDraw: BoxNonNegativeIntSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.tenDiscountedStars > value.tenOriginalStars) {
      ctx.addIssue({
        code: "custom",
        path: ["tenDiscountedStars"],
        message: "tenDiscountedStars cannot be greater than tenOriginalStars.",
      });
    }
  });

export const BoxPityStateSchema = z
  .object({
    boxId: BoxIdSchema,
    threshold: BoxPositiveIntSchema,
    currentCount: BoxNonNegativeIntSchema,
    remainingToGuaranteed: BoxNonNegativeIntSchema,
    targetRarity: BoxRarityCodeSchema,
    guaranteedNext: z.boolean(),
    updatedAt: BoxIsoDateTimeSchema,
  })
  .strict();

export const BoxRewardPreviewItemSchema = z
  .object({
    poolItemId: BoxUuidSchema,
    collectibleTemplateId: BoxUuidSchema,
    name: z.string().trim().min(1).max(128),
    description: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(512).optional(),
    ),
    rarity: BoxRarityCodeSchema,
    rarityLabel: z.string().trim().min(1).max(64),
    itemType: BoxItemTypeSchema,
    itemTypeLabel: z.string().trim().min(1).max(64),
    imageUrl: BoxRequiredUrlSchema,

    /**
     * 概率展示用。
     * 例如 125 = 1.25%。
     */
    probabilityBps: BoxProbabilityBasisPointsSchema,

    /**
     * 展示文案，例如 "1.25%"。
     */
    probabilityLabel: z.string().trim().min(1).max(32),

    weight: BoxPositiveIntSchema,
    remainingStock: BoxNonNegativeIntSchema.nullable(),
    isLimited: z.boolean(),
    isPityEligible: z.boolean(),
    formStage: z.number().int().min(1).max(3),
  })
  .strict();

export const BlindBoxSchema = z
  .object({
    id: BoxIdSchema,
    slug: BoxSlugSchema,
    name: z.string().trim().min(1).max(128),
    description: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(512).optional(),
    ),
    tier: BoxTierSchema,
    status: BoxStatusSchema,
    imageUrl: BoxRequiredUrlSchema,
    sortOrder: BoxNonNegativeIntSchema,

    startsAt: BoxNullableIsoDateTimeSchema,
    endsAt: BoxNullableIsoDateTimeSchema,

    totalStock: BoxNonNegativeIntSchema.nullable(),
    remainingStock: BoxNonNegativeIntSchema.nullable(),

    price: BoxPriceSchema,
    pityState: BoxPityStateSchema.optional(),

    isOpenable: z.boolean(),
    disabledReason: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(256).optional(),
    ),

    createdAt: BoxIsoDateTimeSchema,
    updatedAt: BoxIsoDateTimeSchema,
  })
  .strict();

export const BoxListQuerySchema = z
  .object({
    includeInactive: createBooleanQuerySchema(false),
    status: z.preprocess(blankToUndefined, BoxStatusSchema.optional()),
    tier: z.preprocess(blankToUndefined, BoxTierSchema.optional()),
    limit: createIntQuerySchema(1, 50, 20),
    cursor: z.preprocess(blankToUndefined, BoxCursorSchema.optional()),
  })
  .strict();

export const BoxListResponseSchema = z
  .object({
    items: z.array(BlindBoxSchema),
    nextCursor: BoxCursorSchema.nullable(),
    serverTime: BoxIsoDateTimeSchema,
  })
  .strict();

export const BoxRewardsQuerySchema = z
  .object({
    boxId: BoxIdSchema,
    poolVersionId: z.preprocess(blankToUndefined, BoxUuidSchema.optional()),
    includeInactive: createBooleanQuerySchema(false),
    includeSoldOut: createBooleanQuerySchema(true),
  })
  .strict();

export const BoxRewardsResponseSchema = z
  .object({
    boxId: BoxIdSchema,
    boxName: z.string().trim().min(1).max(128),
    boxStatus: BoxStatusSchema,
    poolVersionId: BoxUuidSchema,
    poolVersion: z.number().int().positive(),
    items: z.array(BoxRewardPreviewItemSchema).min(1),
    pityRule: z
      .object({
        threshold: BoxPositiveIntSchema,
        targetRarity: BoxRarityCodeSchema,
        description: z.string().trim().min(1).max(512),
      })
      .strict()
      .nullable(),
    generatedAt: BoxIsoDateTimeSchema,
  })
  .strict();

const CreateBoxOpenOrderBaseSchema = z.object({
  boxId: BoxIdSchema,
  paymentProvider: BoxPaymentProviderSchema.default("telegram_stars"),

  /**
   * 前端看到的价格。
   * 后端只用它做 stale price 检查，不以它作为最终扣款依据。
   */
  expectedPriceStars: BoxPositiveIntSchema.optional(),

  /**
   * 前端看到的奖励池版本。
   * 后端只用它做 stale pool 检查，不以它作为最终抽卡依据。
   */
  expectedPoolVersionId: BoxUuidSchema.optional(),

  /**
   * 防重复点击、防重复创建订单。
   */
  idempotencyKey: BoxIdempotencyKeySchema,

  clientContext: BoxClientContextSchema.optional(),
});

export const CreateBoxOpenOrderRequestSchema = z.discriminatedUnion(
  "openType",
  [
    CreateBoxOpenOrderBaseSchema.extend({
      openType: z.literal("single"),
      quantity: z.literal(1).default(1),
    }).strict(),

    CreateBoxOpenOrderBaseSchema.extend({
      openType: z.literal("ten"),
      quantity: z.literal(10).default(10),
    }).strict(),
  ],
);

export const CreateBoxOpenOrderResponseSchema = z
  .object({
    orderId: BoxUuidSchema,
    orderStatus: z.literal("pending_payment"),
    boxId: BoxIdSchema,
    openType: BoxOpenTypeSchema,
    quantity: z.union([z.literal(1), z.literal(10)]),
    paymentProvider: BoxPaymentProviderSchema,
    paymentCurrency: BoxPaymentCurrencySchema,
    amountStars: BoxPositiveIntSchema,

    /**
     * Telegram invoice payload。
     * 必须和 payments.star_orders / gacha.draw_orders 绑定。
     */
    invoicePayload: z.string().trim().min(16).max(512),

    /**
     * 如果后端创建 invoice link，则返回。
     * 如果前端通过 Bot API 其它方式拉起，可以为空。
     */
    invoiceLink: BoxOptionalUrlSchema,

    expiresAt: BoxIsoDateTimeSchema,

    priceBreakdown: z
      .object({
        singleStars: BoxPositiveIntSchema,
        originalStars: BoxPositiveIntSchema,
        discountStars: BoxNonNegativeIntSchema,
        payableStars: BoxPositiveIntSchema,
        expectedKcoinReturn: BoxNonNegativeIntSchema,
      })
      .strict(),
  })
  .strict();

export const BoxDrawResultQuerySchema = z
  .object({
    orderId: BoxUuidSchema,
    includeItems: createBooleanQuerySchema(true),
  })
  .strict();

export const BoxDrawResultItemSchema = z
  .object({
    drawIndex: z.number().int().min(1).max(10),
    rewardSource: BoxRewardSourceSchema,
    isPityHit: z.boolean(),

    itemInstanceId: BoxUuidSchema,
    collectibleTemplateId: BoxUuidSchema,
    name: z.string().trim().min(1).max(128),
    serialNumber: BoxPositiveIntSchema.optional(),

    rarity: BoxRarityCodeSchema,
    rarityLabel: z.string().trim().min(1).max(64),
    itemType: BoxItemTypeSchema,
    itemTypeLabel: z.string().trim().min(1).max(64),

    imageUrl: BoxRequiredUrlSchema,
    formStage: z.number().int().min(1).max(3),
    level: z.number().int().min(1).max(999),
    power: BoxNonNegativeIntSchema,

    isNewDiscovery: z.boolean(),
  })
  .strict();

export const BoxDrawResultResponseSchema = z
  .object({
    orderId: BoxUuidSchema,
    orderStatus: BoxDrawOrderStatusSchema,
    boxId: BoxIdSchema,
    boxName: z.string().trim().min(1).max(128),
    openType: BoxOpenTypeSchema,
    quantity: z.union([z.literal(1), z.literal(10)]),

    paidStars: BoxPositiveIntSchema,
    returnedKcoin: BoxNonNegativeIntSchema,

    results: z.array(BoxDrawResultItemSchema).max(10),

    balances: z
      .object({
        kcoin: BoxNonNegativeIntSchema,
        fgems: BoxNonNegativeIntSchema,
      })
      .strict()
      .optional(),

    pityState: BoxPityStateSchema.optional(),

    completedAt: BoxNullableIsoDateTimeSchema,
    serverTime: BoxIsoDateTimeSchema,
  })
  .strict();

export const BoxDrawHistoryQuerySchema = z
  .object({
    boxId: z.preprocess(blankToUndefined, BoxIdSchema.optional()),
    status: z.preprocess(blankToUndefined, BoxDrawOrderStatusSchema.optional()),
    limit: createIntQuerySchema(1, 50, 20),
    cursor: z.preprocess(blankToUndefined, BoxCursorSchema.optional()),
  })
  .strict();

export const BoxDrawHistoryItemSchema = z
  .object({
    orderId: BoxUuidSchema,
    boxId: BoxIdSchema,
    boxName: z.string().trim().min(1).max(128),
    openType: BoxOpenTypeSchema,
    quantity: z.union([z.literal(1), z.literal(10)]),
    orderStatus: BoxDrawOrderStatusSchema,
    paidStars: BoxPositiveIntSchema.nullable(),
    returnedKcoin: BoxNonNegativeIntSchema,
    legendaryCount: BoxNonNegativeIntSchema,
    epicCount: BoxNonNegativeIntSchema,
    createdAt: BoxIsoDateTimeSchema,
    completedAt: BoxNullableIsoDateTimeSchema,
  })
  .strict();

export const BoxDrawHistoryResponseSchema = z
  .object({
    items: z.array(BoxDrawHistoryItemSchema),
    nextCursor: BoxCursorSchema.nullable(),
    serverTime: BoxIsoDateTimeSchema,
  })
  .strict();

export const BoxPityQuerySchema = z
  .object({
    boxId: z.preprocess(blankToUndefined, BoxIdSchema.optional()),
  })
  .strict();

export const BoxPityResponseSchema = z
  .object({
    items: z.array(BoxPityStateSchema),
    serverTime: BoxIsoDateTimeSchema,
  })
  .strict();

export const BoxAdminPriceRuleInputSchema = z
  .object({
    singleStars: BoxPositiveIntSchema,
    tenOriginalStars: BoxPositiveIntSchema,
    tenDiscountedStars: BoxPositiveIntSchema,
    tenDiscountBps: BoxBasisPointsSchema.default(1000),
    kcoinReturnPerDraw: BoxNonNegativeIntSchema.default(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.tenDiscountedStars > value.tenOriginalStars) {
      ctx.addIssue({
        code: "custom",
        path: ["tenDiscountedStars"],
        message: "tenDiscountedStars cannot be greater than tenOriginalStars.",
      });
    }

    if (value.tenOriginalStars !== value.singleStars * 10) {
      ctx.addIssue({
        code: "custom",
        path: ["tenOriginalStars"],
        message: "tenOriginalStars should equal singleStars * 10.",
      });
    }
  });

export const BoxAdminUpsertBlindBoxRequestSchema = z
  .object({
    id: z.preprocess(blankToUndefined, BoxIdSchema.optional()),
    slug: BoxSlugSchema,
    name: z.string().trim().min(1).max(128),
    description: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(512).optional(),
    ),
    tier: BoxTierSchema,
    status: BoxStatusSchema,
    imageUrl: BoxOptionalUrlSchema,
    sortOrder: BoxNonNegativeIntSchema.default(0),

    startsAt: BoxNullableIsoDateTimeSchema,
    endsAt: BoxNullableIsoDateTimeSchema,

    /**
     * null 表示不限总库存。
     */
    totalStock: z
      .preprocess(
        emptyStringToUndefined,
        BoxNonNegativeIntSchema.nullable().optional(),
      )
      .transform((value) => value ?? null),

    price: BoxAdminPriceRuleInputSchema,

    isVisible: z.boolean().default(true),
    isOpenableOverride: z.boolean().optional(),

    adminNote: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(1024).optional(),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.startsAt && value.endsAt) {
      const startsAt = Date.parse(value.startsAt);
      const endsAt = Date.parse(value.endsAt);

      if (Number.isFinite(startsAt) && Number.isFinite(endsAt)) {
        if (endsAt <= startsAt) {
          ctx.addIssue({
            code: "custom",
            path: ["endsAt"],
            message: "endsAt must be later than startsAt.",
          });
        }
      }
    }
  });

export const BoxAdminDropPoolItemInputSchema = z
  .object({
    collectibleTemplateId: BoxUuidSchema,
    weight: BoxPositiveIntSchema,

    /**
     * 可选。
     * 如果后台按固定概率配置，则所有 item 都必须传 probabilityBps，且总和必须等于 10000。
     * 如果后台按 weight 配置，则不传 probabilityBps。
     */
    probabilityBps: BoxProbabilityBasisPointsSchema.optional(),

    /**
     * null 表示该奖励项不限库存。
     */
    stockLimit: z
      .preprocess(
        emptyStringToUndefined,
        BoxNonNegativeIntSchema.nullable().optional(),
      )
      .transform((value) => value ?? null),

    isLimited: z.boolean().default(false),
    isPityEligible: z.boolean().default(true),
    minUserLevel: BoxNonNegativeIntSchema.default(0),
    maxPerUser: z
      .preprocess(
        emptyStringToUndefined,
        BoxPositiveIntSchema.nullable().optional(),
      )
      .transform((value) => value ?? null),
  })
  .strict();

export const BoxAdminPublishDropPoolVersionRequestSchema = z
  .object({
    boxId: BoxIdSchema,
    versionName: z.string().trim().min(1).max(128),
    effectiveAt: BoxNullableIsoDateTimeSchema,
    items: z.array(BoxAdminDropPoolItemInputSchema).min(1).max(500),
    notes: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(2048).optional(),
    ),
    dryRun: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    const probabilityItemCount = value.items.filter(
      (item) => item.probabilityBps !== undefined,
    ).length;

    if (
      probabilityItemCount > 0 &&
      probabilityItemCount !== value.items.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message:
          "If probabilityBps is used, every drop pool item must provide probabilityBps.",
      });
    }

    if (probabilityItemCount === value.items.length) {
      const sum = value.items.reduce(
        (total, item) => total + (item.probabilityBps ?? 0),
        0,
      );

      if (sum !== 10000) {
        ctx.addIssue({
          code: "custom",
          path: ["items"],
          message: "Sum of probabilityBps must equal 10000.",
        });
      }
    }
  });

export const BoxAdminUpsertPityRuleRequestSchema = z
  .object({
    boxId: BoxIdSchema,
    enabled: z.boolean().default(true),
    threshold: BoxPositiveIntSchema,
    targetRarity: BoxRarityCodeSchema,

    /**
     * 如果为空，后端按 targetRarity 从奖励池中选择可保底奖励。
     * 如果传入，则只能从这些 poolItemId 中保底。
     */
    guaranteedPoolItemIds: z.array(BoxUuidSchema).max(100).default([]),

    /**
     * true：抽到 targetRarity 或更高稀有度后重置保底。
     */
    resetOnHitRarityGte: z.boolean().default(true),

    notes: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(1024).optional(),
    ),
  })
  .strict();

export const BoxAdminSetStatusRequestSchema = z
  .object({
    boxId: BoxIdSchema,
    status: BoxStatusSchema,
    reason: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).max(512).optional(),
    ),
  })
  .strict();

export const BoxErrorCodeSchema = z.enum([
  "BOX_NOT_FOUND",
  "BOX_NOT_ACTIVE",
  "BOX_NOT_STARTED",
  "BOX_ENDED",
  "BOX_SOLD_OUT",
  "BOX_STOCK_NOT_ENOUGH",
  "BOX_PAUSED",
  "DRAW_COUNT_INVALID",
  "BOX_PRICE_CHANGED",
  "BOX_POOL_VERSION_CHANGED",
  "BOX_ORDER_NOT_FOUND",
  "BOX_ORDER_ALREADY_PAID",
  "BOX_ORDER_EXPIRED",
  "BOX_PAYMENT_REQUIRED",
  "BOX_PAYMENT_NOT_CONFIRMED",
  "BOX_DRAW_RESULT_NOT_READY",
  "BOX_IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
]);

export const BoxErrorResponseSchema = z
  .object({
    status: z.literal("error"),
    code: BoxErrorCodeSchema,
    message: z.string().trim().min(1).max(512),
    requestId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const parseBoxListQuery = (input: unknown) =>
  BoxListQuerySchema.parse(input);

export const parseBoxRewardsQuery = (input: unknown) =>
  BoxRewardsQuerySchema.parse(input);

export const parseCreateBoxOpenOrderRequest = (input: unknown) =>
  CreateBoxOpenOrderRequestSchema.parse(input);

export const parseBoxDrawResultQuery = (input: unknown) =>
  BoxDrawResultQuerySchema.parse(input);

export const parseBoxDrawHistoryQuery = (input: unknown) =>
  BoxDrawHistoryQuerySchema.parse(input);

export const parseBoxPityQuery = (input: unknown) =>
  BoxPityQuerySchema.parse(input);

export type BoxId = z.infer<typeof BoxIdSchema>;
export type BoxSlug = z.infer<typeof BoxSlugSchema>;
export type BoxCursor = z.infer<typeof BoxCursorSchema>;
export type BoxIdempotencyKey = z.infer<typeof BoxIdempotencyKeySchema>;
export type BoxRarityCode = z.infer<typeof BoxRarityCodeSchema>;
export type BoxItemType = z.infer<typeof BoxItemTypeSchema>;
export type BoxTier = z.infer<typeof BoxTierSchema>;
export type BoxStatus = z.infer<typeof BoxStatusSchema>;
export type BoxOpenType = z.infer<typeof BoxOpenTypeSchema>;
export type BoxPaymentProvider = z.infer<typeof BoxPaymentProviderSchema>;
export type BoxPaymentCurrency = z.infer<typeof BoxPaymentCurrencySchema>;
export type BoxCurrencyCode = z.infer<typeof BoxCurrencyCodeSchema>;
export type BoxDrawOrderStatus = z.infer<typeof BoxDrawOrderStatusSchema>;
export type BoxRewardSource = z.infer<typeof BoxRewardSourceSchema>;
export type BoxClientContext = z.infer<typeof BoxClientContextSchema>;
export type BoxAssetAmount = z.infer<typeof BoxAssetAmountSchema>;
export type BoxPrice = z.infer<typeof BoxPriceSchema>;
export type BoxPityState = z.infer<typeof BoxPityStateSchema>;
export type BoxRewardPreviewItem = z.infer<typeof BoxRewardPreviewItemSchema>;
export type BlindBox = z.infer<typeof BlindBoxSchema>;

export type BoxListQuery = z.infer<typeof BoxListQuerySchema>;
export type BoxListResponse = z.infer<typeof BoxListResponseSchema>;

export type BoxRewardsQuery = z.infer<typeof BoxRewardsQuerySchema>;
export type BoxRewardsResponse = z.infer<typeof BoxRewardsResponseSchema>;

export type CreateBoxOpenOrderRequest = z.infer<
  typeof CreateBoxOpenOrderRequestSchema
>;
export type CreateBoxOpenOrderResponse = z.infer<
  typeof CreateBoxOpenOrderResponseSchema
>;

export type BoxDrawResultQuery = z.infer<typeof BoxDrawResultQuerySchema>;
export type BoxDrawResultItem = z.infer<typeof BoxDrawResultItemSchema>;
export type BoxDrawResultResponse = z.infer<typeof BoxDrawResultResponseSchema>;

export type BoxDrawHistoryQuery = z.infer<typeof BoxDrawHistoryQuerySchema>;
export type BoxDrawHistoryItem = z.infer<typeof BoxDrawHistoryItemSchema>;
export type BoxDrawHistoryResponse = z.infer<
  typeof BoxDrawHistoryResponseSchema
>;

export type BoxPityQuery = z.infer<typeof BoxPityQuerySchema>;
export type BoxPityResponse = z.infer<typeof BoxPityResponseSchema>;

export type BoxAdminPriceRuleInput = z.infer<
  typeof BoxAdminPriceRuleInputSchema
>;
export type BoxAdminUpsertBlindBoxRequest = z.infer<
  typeof BoxAdminUpsertBlindBoxRequestSchema
>;
export type BoxAdminDropPoolItemInput = z.infer<
  typeof BoxAdminDropPoolItemInputSchema
>;
export type BoxAdminPublishDropPoolVersionRequest = z.infer<
  typeof BoxAdminPublishDropPoolVersionRequestSchema
>;
export type BoxAdminUpsertPityRuleRequest = z.infer<
  typeof BoxAdminUpsertPityRuleRequestSchema
>;
export type BoxAdminSetStatusRequest = z.infer<
  typeof BoxAdminSetStatusRequestSchema
>;

export type BoxErrorCode = z.infer<typeof BoxErrorCodeSchema>;
export type BoxErrorResponse = z.infer<typeof BoxErrorResponseSchema>;
