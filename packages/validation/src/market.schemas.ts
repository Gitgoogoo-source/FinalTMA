// packages/validation/src/market.schemas.ts

import { z } from 'zod';

/**
 * Market validation schemas
 *
 * 负责：
 * - 市场购买列表筛选
 * - 商品详情查询
 * - 购买挂单
 * - 创建出售挂单
 * - 改价
 * - 下架
 * - 我的出售中列表
 * - 可出售藏品列表
 * - 市场价格统计
 *
 * 注意：
 * - 前端传来的价格、手续费、预计到手都只能作为展示或乐观校验。
 * - 最终价格、手续费、余额、库存锁定、藏品转移必须以后端 RPC / 数据库事务为准。
 */

const uuidSchema = z.string().trim().uuid();

const cursorSchema = z
  .string()
  .trim()
  .min(1, 'cursor cannot be empty')
  .max(512, 'cursor is too long');

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(16, 'idempotency_key must be at least 16 characters')
  .max(128, 'idempotency_key is too long')
  .regex(/^[a-zA-Z0-9:_-]+$/, {
    message: 'idempotency_key can only contain letters, numbers, colon, underscore and hyphen',
  });

const positiveIntegerSchema = z.coerce.number().int().min(1);

const positiveKCoinAmountSchema = z.coerce
  .number()
  .int()
  .min(1, 'price must be greater than 0')
  .max(1_000_000_000, 'price is too large');

const nonNegativeKCoinAmountSchema = z.coerce
  .number()
  .int()
  .min(0, 'amount cannot be negative')
  .max(1_000_000_000, 'amount is too large');

const bpsSchema = z.coerce
  .number()
  .int()
  .min(0, 'bps cannot be negative')
  .max(10_000, 'bps cannot exceed 10000');

const isoDateTimeSchema = z.string().datetime();

const booleanFromQuerySchema = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }

  return value;
}, z.boolean());

const csvArraySchema = <T extends z.ZodTypeAny>(itemSchema: T, max = 20) =>
  z
    .preprocess((value) => {
      if (value === undefined || value === null || value === '') return undefined;

      if (Array.isArray(value)) {
        return value
          .flatMap((item) => (typeof item === 'string' ? item.split(',') : [item]))
          .map((item) => (typeof item === 'string' ? item.trim() : item))
          .filter((item) => item !== '');
      }

      if (typeof value === 'string') {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }

      return value;
    }, z.array(itemSchema).max(max))
    .optional();

const uniqueUuidArraySchema = (options?: { min?: number; max?: number; fieldName?: string }) => {
  const min = options?.min ?? 1;
  const max = options?.max ?? 100;
  const fieldName = options?.fieldName ?? 'ids';

  return z
    .array(uuidSchema)
    .min(min, `${fieldName} must contain at least ${min} item(s)`)
    .max(max, `${fieldName} cannot contain more than ${max} item(s)`)
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();

      ids.forEach((id, index) => {
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: `${fieldName} contains duplicated id: ${id}`,
          });
        }

        seen.add(id);
      });
    });
};

const priceRangeRefinement = (
  data: {
    min_price?: number;
    max_price?: number;
  },
  ctx: z.RefinementCtx,
) => {
  if (
    data.min_price !== undefined &&
    data.max_price !== undefined &&
    data.min_price > data.max_price
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['min_price'],
      message: 'min_price cannot be greater than max_price',
    });
  }
};

export const MarketCurrencySchema = z.enum(['KCOIN']);

export const MarketRarityCodeSchema = z.enum([
  'common',
  'rare',
  'epic',
  'legendary',
  'mythic',
]);

export const MarketItemTypeSchema = z.enum([
  'character',
  'pet',
  'egg',
  'decoration',
  'prop',
  'material',
]);

export const MarketListingStatusSchema = z.enum([
  'active',
  'sold',
  'cancelled',
  'expired',
  'paused',
  'locked',
]);

export const MarketOrderStatusSchema = z.enum([
  'pending',
  'paid',
  'completed',
  'cancelled',
  'failed',
  'refunded',
]);

export const MarketListingSortSchema = z.enum([
  'recently_listed',
  'price_asc',
  'price_desc',
  'rarity_asc',
  'rarity_desc',
  'recently_sold',
  'ending_soon',
]);

export const MarketCancelReasonSchema = z.enum([
  'user_cancelled',
  'price_too_low',
  'price_too_high',
  'changed_mind',
  'admin_cancelled',
  'expired',
]);

export const MarketPricePeriodSchema = z.enum(['1h', '24h', '7d', '30d', 'all']);

export const MarketListingIdParamSchema = z
  .object({
    listing_id: uuidSchema,
  })
  .strict();

export const MarketOrderIdParamSchema = z
  .object({
    order_id: uuidSchema,
  })
  .strict();

export const MarketPaginationQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(24),
  })
  .strict();

export const MarketListQuerySchema = z
  .object({
    keyword: z.string().trim().max(64).optional(),

    rarities: csvArraySchema(MarketRarityCodeSchema, 8),
    types: csvArraySchema(MarketItemTypeSchema, 12),
    series_ids: csvArraySchema(uuidSchema, 20),
    faction_ids: csvArraySchema(uuidSchema, 20),
    template_ids: csvArraySchema(uuidSchema, 50),

    min_price: nonNegativeKCoinAmountSchema.optional(),
    max_price: nonNegativeKCoinAmountSchema.optional(),

    currency: MarketCurrencySchema.default('KCOIN'),
    status: MarketListingStatusSchema.default('active'),
    sort: MarketListingSortSchema.default('recently_listed'),

    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(60).default(24),

    include_seller: booleanFromQuerySchema.default(false),
    include_price_stats: booleanFromQuerySchema.default(true),
  })
  .strict()
  .superRefine(priceRangeRefinement);

export const MarketListingDetailQuerySchema = z
  .object({
    listing_id: uuidSchema,
    include_seller: booleanFromQuerySchema.default(true),
    include_depth: booleanFromQuerySchema.default(true),
    include_price_stats: booleanFromQuerySchema.default(true),
    include_recent_sales: booleanFromQuerySchema.default(true),
  })
  .strict();

export const MarketSellableItemsQuerySchema = z
  .object({
    keyword: z.string().trim().max(64).optional(),

    rarities: csvArraySchema(MarketRarityCodeSchema, 8),
    types: csvArraySchema(MarketItemTypeSchema, 12),
    series_ids: csvArraySchema(uuidSchema, 20),
    faction_ids: csvArraySchema(uuidSchema, 20),
    template_ids: csvArraySchema(uuidSchema, 50),

    only_duplicates: booleanFromQuerySchema.default(false),
    only_tradeable: booleanFromQuerySchema.default(true),

    min_level: z.coerce.number().int().min(1).max(999).optional(),
    max_level: z.coerce.number().int().min(1).max(999).optional(),

    sort: z
      .enum([
        'recently_obtained',
        'rarity_desc',
        'rarity_asc',
        'level_desc',
        'level_asc',
        'power_desc',
        'power_asc',
        'name_asc',
      ])
      .default('recently_obtained'),

    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(80).default(30),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.min_level !== undefined &&
      data.max_level !== undefined &&
      data.min_level > data.max_level
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['min_level'],
        message: 'min_level cannot be greater than max_level',
      });
    }
  });

export const MarketMyListingsQuerySchema = z
  .object({
    keyword: z.string().trim().max(64).optional(),

    statuses: csvArraySchema(MarketListingStatusSchema, 10),
    rarities: csvArraySchema(MarketRarityCodeSchema, 8),
    types: csvArraySchema(MarketItemTypeSchema, 12),
    template_ids: csvArraySchema(uuidSchema, 50),

    min_price: nonNegativeKCoinAmountSchema.optional(),
    max_price: nonNegativeKCoinAmountSchema.optional(),

    sort: z
      .enum([
        'recently_listed',
        'price_asc',
        'price_desc',
        'value_desc',
        'value_asc',
        'ending_soon',
      ])
      .default('recently_listed'),

    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(80).default(30),
  })
  .strict()
  .superRefine(priceRangeRefinement);

export const MarketCreateListingBodySchema = z
  .object({
    item_instance_ids: uniqueUuidArraySchema({
      min: 1,
      max: 100,
      fieldName: 'item_instance_ids',
    }),

    unit_price: positiveKCoinAmountSchema,
    currency: MarketCurrencySchema.default('KCOIN'),

    allow_partial_fill: z.boolean().default(false),

    expires_at: isoDateTimeSchema.optional(),

    expected_fee_bps: bpsSchema.optional(),

    idempotency_key: idempotencyKeySchema,

    client_note: z.string().trim().max(256).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.expires_at !== undefined) {
      const expiresAtMs = Date.parse(data.expires_at);

      if (Number.isNaN(expiresAtMs)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expires_at'],
          message: 'expires_at must be a valid ISO datetime',
        });

        return;
      }

      if (expiresAtMs <= Date.now()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expires_at'],
          message: 'expires_at must be in the future',
        });
      }
    }
  });

export const MarketBuyListingBodySchema = z
  .object({
    listing_id: uuidSchema,

    quantity: positiveIntegerSchema.max(100).default(1),

    /**
     * 前端看到的价格。
     * 后端用于防止用户在过期价格下误购。
     * 最终成交价仍以数据库 active listing 当前价格为准。
     */
    expected_unit_price: positiveKCoinAmountSchema.optional(),

    currency: MarketCurrencySchema.default('KCOIN'),

    idempotency_key: idempotencyKeySchema,

    client_seen_at: isoDateTimeSchema.optional(),
  })
  .strict();

export const MarketUpdateListingPriceBodySchema = z
  .object({
    listing_id: uuidSchema,

    unit_price: positiveKCoinAmountSchema,
    currency: MarketCurrencySchema.default('KCOIN'),

    expected_listing_version: z.coerce.number().int().min(0).optional(),

    idempotency_key: idempotencyKeySchema,
  })
  .strict();

export const MarketCancelListingBodySchema = z
  .object({
    listing_id: uuidSchema,

    reason: MarketCancelReasonSchema.default('user_cancelled'),

    expected_listing_version: z.coerce.number().int().min(0).optional(),

    idempotency_key: idempotencyKeySchema,
  })
  .strict();

export const MarketPricePreviewBodySchema = z
  .object({
    item_instance_ids: uniqueUuidArraySchema({
      min: 1,
      max: 100,
      fieldName: 'item_instance_ids',
    }),

    unit_price: positiveKCoinAmountSchema,
    currency: MarketCurrencySchema.default('KCOIN'),
  })
  .strict();

export const MarketStatsQuerySchema = z
  .object({
    template_id: uuidSchema.optional(),
    series_id: uuidSchema.optional(),
    rarity: MarketRarityCodeSchema.optional(),
    type: MarketItemTypeSchema.optional(),

    period: MarketPricePeriodSchema.default('7d'),

    include_depth: booleanFromQuerySchema.default(true),
    include_recent_sales: booleanFromQuerySchema.default(true),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.template_id && !data.series_id && !data.rarity && !data.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['template_id'],
        message: 'at least one filter is required: template_id, series_id, rarity or type',
      });
    }
  });

export const MarketAdminForceCancelListingBodySchema = z
  .object({
    listing_id: uuidSchema,
    reason: z.string().trim().min(3).max(256),
    unlock_inventory: z.boolean().default(true),
    idempotency_key: idempotencyKeySchema,
  })
  .strict();

export const MarketListingCardDtoSchema = z
  .object({
    listing_id: uuidSchema,
    template_id: uuidSchema,

    name: z.string(),
    serial_no: z.number().int().positive().optional(),

    rarity: MarketRarityCodeSchema,
    type: MarketItemTypeSchema,

    image_url: z.string().url().nullable().optional(),

    unit_price: nonNegativeKCoinAmountSchema,
    currency: MarketCurrencySchema,

    quantity_total: z.number().int().min(1),
    quantity_available: z.number().int().min(0),

    status: MarketListingStatusSchema,

    seller_display_name: z.string().nullable().optional(),

    created_at: isoDateTimeSchema,
    expires_at: isoDateTimeSchema.nullable().optional(),
  })
  .strict();

export const MarketListingDetailDtoSchema = MarketListingCardDtoSchema.extend({
  seller_user_id: uuidSchema.optional(),

  market_reference_price: nonNegativeKCoinAmountSchema.nullable().optional(),
  recent_trade_price: nonNegativeKCoinAmountSchema.nullable().optional(),
  floor_price: nonNegativeKCoinAmountSchema.nullable().optional(),

  price_health: z.enum(['too_low', 'healthy', 'too_high', 'unknown']).default('unknown'),

  market_depth: z
    .array(
      z
        .object({
          price: nonNegativeKCoinAmountSchema,
          quantity: z.number().int().min(0),
        })
        .strict(),
    )
    .optional(),

  item_instance_ids: z.array(uuidSchema).optional(),
}).strict();

export const MarketOrderDtoSchema = z
  .object({
    order_id: uuidSchema,
    listing_id: uuidSchema,

    buyer_user_id: uuidSchema,
    seller_user_id: uuidSchema,

    status: MarketOrderStatusSchema,

    quantity: z.number().int().min(1),
    unit_price: nonNegativeKCoinAmountSchema,
    total_price: nonNegativeKCoinAmountSchema,

    fee_amount: nonNegativeKCoinAmountSchema,
    seller_receivable_amount: nonNegativeKCoinAmountSchema,

    currency: MarketCurrencySchema,

    created_at: isoDateTimeSchema,
    completed_at: isoDateTimeSchema.nullable().optional(),
  })
  .strict();

export const MarketListingsResponseSchema = z
  .object({
    items: z.array(MarketListingCardDtoSchema),
    next_cursor: cursorSchema.nullable(),
  })
  .strict();

export const MarketMyListingsResponseSchema = z
  .object({
    items: z.array(MarketListingCardDtoSchema),
    next_cursor: cursorSchema.nullable(),

    stats: z
      .object({
        active_count: z.number().int().min(0),
        total_value: nonNegativeKCoinAmountSchema,
        estimated_receivable: nonNegativeKCoinAmountSchema,
        currency: MarketCurrencySchema,
      })
      .strict(),
  })
  .strict();

export const MarketCreateListingResponseSchema = z
  .object({
    listing_id: uuidSchema,
    status: MarketListingStatusSchema,
    locked_item_instance_ids: z.array(uuidSchema),

    unit_price: nonNegativeKCoinAmountSchema,
    fee_bps: bpsSchema,
    estimated_fee_amount: nonNegativeKCoinAmountSchema,
    estimated_receivable_amount: nonNegativeKCoinAmountSchema,

    created_at: isoDateTimeSchema,
  })
  .strict();

export const MarketBuyListingResponseSchema = z
  .object({
    order: MarketOrderDtoSchema,

    acquired_item_instance_ids: z.array(uuidSchema),

    buyer_balance_after: nonNegativeKCoinAmountSchema,

    seller_receivable_amount: nonNegativeKCoinAmountSchema,
    platform_fee_amount: nonNegativeKCoinAmountSchema,
  })
  .strict();

export const MarketCancelListingResponseSchema = z
  .object({
    listing_id: uuidSchema,
    status: MarketListingStatusSchema,
    unlocked_item_instance_ids: z.array(uuidSchema),
    cancelled_at: isoDateTimeSchema,
  })
  .strict();

export type MarketCurrency = z.infer<typeof MarketCurrencySchema>;
export type MarketRarityCode = z.infer<typeof MarketRarityCodeSchema>;
export type MarketItemType = z.infer<typeof MarketItemTypeSchema>;
export type MarketListingStatus = z.infer<typeof MarketListingStatusSchema>;
export type MarketOrderStatus = z.infer<typeof MarketOrderStatusSchema>;
export type MarketListingSort = z.infer<typeof MarketListingSortSchema>;

export type MarketListQueryInput = z.input<typeof MarketListQuerySchema>;
export type MarketListQuery = z.output<typeof MarketListQuerySchema>;

export type MarketListingDetailQueryInput = z.input<typeof MarketListingDetailQuerySchema>;
export type MarketListingDetailQuery = z.output<typeof MarketListingDetailQuerySchema>;

export type MarketSellableItemsQueryInput = z.input<typeof MarketSellableItemsQuerySchema>;
export type MarketSellableItemsQuery = z.output<typeof MarketSellableItemsQuerySchema>;

export type MarketMyListingsQueryInput = z.input<typeof MarketMyListingsQuerySchema>;
export type MarketMyListingsQuery = z.output<typeof MarketMyListingsQuerySchema>;

export type MarketCreateListingBodyInput = z.input<typeof MarketCreateListingBodySchema>;
export type MarketCreateListingBody = z.output<typeof MarketCreateListingBodySchema>;

export type MarketBuyListingBodyInput = z.input<typeof MarketBuyListingBodySchema>;
export type MarketBuyListingBody = z.output<typeof MarketBuyListingBodySchema>;

export type MarketUpdateListingPriceBodyInput = z.input<
  typeof MarketUpdateListingPriceBodySchema
>;
export type MarketUpdateListingPriceBody = z.output<typeof MarketUpdateListingPriceBodySchema>;

export type MarketCancelListingBodyInput = z.input<typeof MarketCancelListingBodySchema>;
export type MarketCancelListingBody = z.output<typeof MarketCancelListingBodySchema>;

export type MarketStatsQueryInput = z.input<typeof MarketStatsQuerySchema>;
export type MarketStatsQuery = z.output<typeof MarketStatsQuerySchema>;

export type MarketListingCardDto = z.infer<typeof MarketListingCardDtoSchema>;
export type MarketListingDetailDto = z.infer<typeof MarketListingDetailDtoSchema>;
export type MarketOrderDto = z.infer<typeof MarketOrderDtoSchema>;