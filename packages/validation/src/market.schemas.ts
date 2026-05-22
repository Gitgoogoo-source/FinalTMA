// packages/validation/src/market.schemas.ts

import { z } from "zod";

/**
 * Market API contract schemas.
 *
 * These schemas only validate frontend -> Vercel API payload shape.
 * Final ownership, balance, fee, lock and listing-state decisions must happen
 * in Vercel API handlers and Supabase RPC transactions.
 */

const ID_RE = /^[a-zA-Z0-9:_-]+$/;

const rejectBlankString = (value: unknown): unknown => {
  if (typeof value === "string" && value.trim().length === 0) {
    return Number.NaN;
  }

  return value;
};

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
  .regex(ID_RE, {
    message:
      "idempotency_key can only contain letters, numbers, colon, underscore and hyphen",
  });

const integerRangeSchema = (
  min: number,
  max: number,
  messages?: {
    min?: string;
    max?: string;
  },
) =>
  z.preprocess(
    rejectBlankString,
    z.coerce
      .number()
      .finite()
      .int()
      .min(min, messages?.min)
      .max(max, messages?.max),
  );

const positiveIntegerSchema = integerRangeSchema(1, Number.MAX_SAFE_INTEGER);

const nonNegativeIntegerSchema = integerRangeSchema(0, Number.MAX_SAFE_INTEGER);

const positiveKcoinAmountSchema = integerRangeSchema(1, 1_000_000_000, {
  min: "KCOIN amount must be greater than 0",
  max: "KCOIN amount is too large",
});

const nonNegativeKcoinAmountSchema = integerRangeSchema(0, 1_000_000_000, {
  min: "KCOIN amount cannot be negative",
  max: "KCOIN amount is too large",
});

const bpsSchema = integerRangeSchema(0, 10_000, {
  min: "bps cannot be negative",
  max: "bps cannot exceed 10000",
});

const isoDateTimeSchema = z.string().trim().datetime();

const optionalImageUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .nullable()
  .optional();

const booleanFromQuerySchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  }

  return value;
}, z.boolean());

const csvArraySchema = <T extends z.ZodTypeAny>(itemSchema: T, max: number) =>
  z
    .preprocess((value) => {
      if (value === undefined || value === null) return undefined;

      if (Array.isArray(value)) {
        return value
          .flatMap((item) =>
            typeof item === "string" ? item.split(",") : [item],
          )
          .map((item) => (typeof item === "string" ? item.trim() : item));
      }

      if (typeof value === "string") {
        return value.split(",").map((item) => item.trim());
      }

      return value;
    }, z.array(itemSchema).min(1).max(max))
    .optional();

const uniqueUuidArraySchema = (options: {
  min: number;
  max: number;
  fieldName: string;
}) =>
  z
    .array(uuidSchema)
    .min(
      options.min,
      `${options.fieldName} must contain at least ${options.min} item(s)`,
    )
    .max(
      options.max,
      `${options.fieldName} cannot contain more than ${options.max} item(s)`,
    )
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();

      ids.forEach((id, index) => {
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: `${options.fieldName} contains duplicated id: ${id}`,
          });
        }

        seen.add(id);
      });
    });

const priceRangeRefinement = (
  data: Record<string, unknown>,
  ctx: z.RefinementCtx,
) => {
  const minPrice = data.min_price;
  const maxPrice = data.max_price;

  if (
    typeof minPrice === "number" &&
    typeof maxPrice === "number" &&
    minPrice > maxPrice
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["min_price"],
      message: "min_price cannot be greater than max_price",
    });
  }
};

export const MarketCurrencySchema = z.literal("KCOIN");

export const MarketRarityCodeSchema = z.enum([
  "common",
  "rare",
  "epic",
  "legendary",
  "mythic",
]);

export const MarketItemTypeCodeSchema = z.enum([
  "character",
  "pet",
  "egg",
  "decoration",
  "prop",
  "material",
]);

export const MarketItemTypeSchema = MarketItemTypeCodeSchema;

export const MarketListingStatusSchema = z.enum([
  "active",
  "partially_sold",
  "sold",
  "cancelled",
  "expired",
  "suspended",
]);

export const MarketOrderStatusSchema = z.enum([
  "pending",
  "completed",
  "cancelled",
  "failed",
  "refunded",
]);

export const MarketListingSortSchema = z.enum([
  "recently_listed",
  "price_low_to_high",
  "price_high_to_low",
  "rarity_high_to_low",
]);

export const MarketMyListingSortSchema = z.enum([
  "recently_listed",
  "price_low_to_high",
  "price_high_to_low",
  "value_high_to_low",
  "value_low_to_high",
]);

export const MarketSellableItemSortSchema = z.enum([
  "recently_obtained",
  "rarity_high_to_low",
  "rarity_low_to_high",
  "level_high_to_low",
  "level_low_to_high",
  "power_high_to_low",
  "power_low_to_high",
  "name_a_to_z",
]);

export const MarketPriceHealthSchema = z.enum([
  "too_low",
  "healthy",
  "too_high",
  "unknown",
]);

export const MarketCancelReasonSchema = z.enum([
  "user_cancelled",
  "price_too_low",
  "price_too_high",
  "changed_mind",
]);

export const MarketPricePeriodSchema = z.enum([
  "1h",
  "24h",
  "7d",
  "30d",
  "all",
]);

export const MarketClientContextSchema = z
  .object({
    source: z
      .enum(["trade_buy_tab", "trade_sell_tab", "trade_manage_tab", "unknown"])
      .optional(),
    client_nonce: z.string().trim().min(8).max(128).regex(ID_RE).optional(),
    client_seen_at: isoDateTimeSchema.optional(),
  })
  .strict();

export const MarketListListingsQuerySchema = z
  .object({
    rarities: csvArraySchema(MarketRarityCodeSchema, 8),
    type_codes: csvArraySchema(MarketItemTypeCodeSchema, 12),
    series_ids: csvArraySchema(uuidSchema, 20),
    template_ids: csvArraySchema(uuidSchema, 50),

    min_price: nonNegativeKcoinAmountSchema.optional(),
    max_price: nonNegativeKcoinAmountSchema.optional(),

    sort: MarketListingSortSchema.default("recently_listed"),
    cursor: cursorSchema.optional(),
    limit: integerRangeSchema(1, 50).default(24),
  })
  .strict()
  .superRefine(priceRangeRefinement);

export const MarketListQuerySchema = MarketListListingsQuerySchema;

export const MarketPaginationQuerySchema = z
  .object({
    cursor: cursorSchema.optional(),
    limit: integerRangeSchema(1, 50).default(24),
  })
  .strict();

export const MarketListingDetailQuerySchema = z
  .object({
    listing_id: uuidSchema,
  })
  .strict();

export const MarketListingIdParamSchema = MarketListingDetailQuerySchema;

export const MarketOrderIdParamSchema = z
  .object({
    order_id: uuidSchema,
  })
  .strict();

export const MarketSellableItemsQuerySchema = z
  .object({
    rarities: csvArraySchema(MarketRarityCodeSchema, 8),
    type_codes: csvArraySchema(MarketItemTypeCodeSchema, 12),
    series_ids: csvArraySchema(uuidSchema, 20),
    template_ids: csvArraySchema(uuidSchema, 50),

    only_tradeable: booleanFromQuerySchema.default(true),
    only_duplicates: booleanFromQuerySchema.default(false),

    min_level: integerRangeSchema(1, 999).optional(),
    max_level: integerRangeSchema(1, 999).optional(),

    sort: MarketSellableItemSortSchema.default("recently_obtained"),
    cursor: cursorSchema.optional(),
    limit: integerRangeSchema(1, 50).default(30),
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
        path: ["min_level"],
        message: "min_level cannot be greater than max_level",
      });
    }
  });

export const MarketCreateListingBodySchema = z
  .object({
    item_instance_ids: uniqueUuidArraySchema({
      min: 1,
      max: 100,
      fieldName: "item_instance_ids",
    }),
    unit_price_kcoin: positiveKcoinAmountSchema,
    idempotency_key: idempotencyKeySchema,
    client_context: MarketClientContextSchema.optional(),
  })
  .strict();

export const MarketBuyListingBodySchema = z
  .object({
    listing_id: uuidSchema,
    quantity: z.literal(1).default(1),
    expected_unit_price_kcoin: positiveKcoinAmountSchema,
    idempotency_key: idempotencyKeySchema,
    client_context: MarketClientContextSchema.optional(),
  })
  .strict();

export const MarketMyListingsQuerySchema = z
  .object({
    statuses: csvArraySchema(MarketListingStatusSchema, 8),
    rarities: csvArraySchema(MarketRarityCodeSchema, 8),
    type_codes: csvArraySchema(MarketItemTypeCodeSchema, 12),
    template_ids: csvArraySchema(uuidSchema, 50),

    min_price: nonNegativeKcoinAmountSchema.optional(),
    max_price: nonNegativeKcoinAmountSchema.optional(),

    sort: MarketMyListingSortSchema.default("recently_listed"),
    cursor: cursorSchema.optional(),
    limit: integerRangeSchema(1, 50).default(30),
  })
  .strict()
  .superRefine(priceRangeRefinement);

export const MarketMyListingStatsQuerySchema = z
  .object({
    statuses: csvArraySchema(MarketListingStatusSchema, 8),
  })
  .strict();

export const MarketUpdateListingPriceBodySchema = z
  .object({
    listing_id: uuidSchema,
    new_unit_price_kcoin: positiveKcoinAmountSchema,
    idempotency_key: idempotencyKeySchema,
    client_context: MarketClientContextSchema.optional(),
  })
  .strict();

export const MarketCancelListingBodySchema = z
  .object({
    listing_id: uuidSchema,
    idempotency_key: idempotencyKeySchema,
    reason: MarketCancelReasonSchema.default("user_cancelled"),
    client_context: MarketClientContextSchema.optional(),
  })
  .strict();

export const MarketStatsQuerySchema = z
  .object({
    template_id: uuidSchema.optional(),
    form_id: uuidSchema.optional(),
    series_id: uuidSchema.optional(),
    rarity: MarketRarityCodeSchema.optional(),
    type_code: MarketItemTypeCodeSchema.optional(),
    period: MarketPricePeriodSchema.default("7d"),
    include_depth: booleanFromQuerySchema.default(true),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      !data.template_id &&
      !data.series_id &&
      !data.rarity &&
      !data.type_code
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["template_id"],
        message: "at least one filter is required",
      });
    }
  });

export const MarketListingCardDtoSchema = z
  .object({
    listing_id: uuidSchema,
    seller_user_id: uuidSchema.optional(),
    template_id: uuidSchema,
    form_id: uuidSchema.nullable().optional(),

    name: z.string().trim().min(1),
    serial_no: positiveIntegerSchema.optional(),
    rarity: MarketRarityCodeSchema,
    type_code: MarketItemTypeCodeSchema,
    image_url: optionalImageUrlSchema,

    unit_price_kcoin: nonNegativeKcoinAmountSchema,
    currency_code: MarketCurrencySchema.default("KCOIN"),

    item_count: positiveIntegerSchema,
    remaining_count: nonNegativeIntegerSchema,
    status: MarketListingStatusSchema,

    seller_display_name: z.string().trim().min(1).max(80).nullable().optional(),
    is_own_listing: z.boolean().optional(),
    is_buyable: z.boolean().optional(),
    not_buyable_reason: z.string().trim().min(1).max(80).nullable().optional(),
    price_health: MarketPriceHealthSchema.default("unknown"),

    created_at: isoDateTimeSchema,
    expires_at: isoDateTimeSchema.nullable().optional(),
  })
  .strict();

export const MarketDepthLevelDtoSchema = z
  .object({
    price_kcoin: nonNegativeKcoinAmountSchema,
    listing_count: nonNegativeIntegerSchema,
    item_count: nonNegativeIntegerSchema,
  })
  .strict();

export const MarketPriceStatsDtoSchema = z
  .object({
    template_id: uuidSchema,
    form_id: uuidSchema.nullable().optional(),
    floor_price_kcoin: nonNegativeKcoinAmountSchema.nullable(),
    avg_price_kcoin: nonNegativeKcoinAmountSchema.nullable(),
    last_sale_price_kcoin: nonNegativeKcoinAmountSchema.nullable(),
    active_listing_count: nonNegativeIntegerSchema,
    sale_count_24h: nonNegativeIntegerSchema,
    volume_24h_kcoin: nonNegativeKcoinAmountSchema,
    snapshot_at: isoDateTimeSchema,
  })
  .strict();

export const MarketListingSellerDtoSchema = z
  .object({
    user_id: uuidSchema,
    display_name: z.string().trim().min(1).max(80).nullable().optional(),
    avatar_url: optionalImageUrlSchema,
  })
  .strict();

export const MarketListingDetailDtoSchema = MarketListingCardDtoSchema.extend({
  description: z.string().trim().max(512).nullable().optional(),
  seller: MarketListingSellerDtoSchema,
  floor_price_kcoin: nonNegativeKcoinAmountSchema.nullable().optional(),
  avg_price_kcoin: nonNegativeKcoinAmountSchema.nullable().optional(),
  last_sale_price_kcoin: nonNegativeKcoinAmountSchema.nullable().optional(),
  reference_price_kcoin: nonNegativeKcoinAmountSchema.nullable().optional(),
  active_listing_count: nonNegativeIntegerSchema.default(0),
  sale_count_24h: nonNegativeIntegerSchema.default(0),
  volume_24h_kcoin: nonNegativeKcoinAmountSchema.default(0),
  snapshot_at: isoDateTimeSchema.nullable().optional(),
  market_depth: z.array(MarketDepthLevelDtoSchema).default([]),
  item_instance_ids: z.array(uuidSchema).optional(),
  can_buy: z.boolean(),
  disabled_reason: z.string().trim().min(1).max(80).nullable().optional(),
}).strict();

export const MarketSellableItemDtoSchema = z
  .object({
    item_instance_id: uuidSchema,
    item_instance_ids: z.array(uuidSchema).optional(),
    template_id: uuidSchema,
    form_id: uuidSchema.nullable().optional(),
    serial_no: positiveIntegerSchema.optional(),
    name: z.string().trim().min(1),
    rarity: MarketRarityCodeSchema,
    type_code: MarketItemTypeCodeSchema,
    image_url: optionalImageUrlSchema,
    level: positiveIntegerSchema,
    power: nonNegativeIntegerSchema,
    owned_count: positiveIntegerSchema.optional(),
    available_count: positiveIntegerSchema.optional(),
    suggested_price: nonNegativeKcoinAmountSchema.nullable().optional(),
    min_price: nonNegativeKcoinAmountSchema.nullable().optional(),
    max_price: nonNegativeKcoinAmountSchema.nullable().optional(),
    acquired_at: isoDateTimeSchema,
    is_tradeable: z.boolean(),
  })
  .strict();

export const MarketOrderDtoSchema = z
  .object({
    order_id: uuidSchema,
    listing_id: uuidSchema,
    buyer_user_id: uuidSchema,
    seller_user_id: uuidSchema,
    status: MarketOrderStatusSchema,
    item_count: positiveIntegerSchema,
    unit_price_kcoin: nonNegativeKcoinAmountSchema,
    total_price_kcoin: nonNegativeKcoinAmountSchema,
    fee_amount_kcoin: nonNegativeKcoinAmountSchema,
    seller_net_amount_kcoin: nonNegativeKcoinAmountSchema,
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

export const MarketListingDetailResponseSchema = z
  .object({
    listing: MarketListingDetailDtoSchema,
  })
  .strict();

export const MarketSellableItemsResponseSchema = z
  .object({
    items: z.array(MarketSellableItemDtoSchema),
    next_cursor: cursorSchema.nullable(),
  })
  .strict();

export const MarketCreateListingCreatedResponseSchema = z
  .object({
    listing_id: uuidSchema,
    item_count: positiveIntegerSchema,
    remaining_count: nonNegativeIntegerSchema,
    unit_price_kcoin: nonNegativeKcoinAmountSchema,
    fee_bps: bpsSchema,
    expected_net_amount: nonNegativeKcoinAmountSchema,
    status: MarketListingStatusSchema,
    price_health: MarketPriceHealthSchema.optional(),
    idempotent: z.literal(false).optional(),
  })
  .strict();

export const MarketCreateListingIdempotentResponseSchema = z
  .object({
    listing_id: uuidSchema,
    status: MarketListingStatusSchema,
    idempotent: z.literal(true),
  })
  .strict();

export const MarketCreateListingResponseSchema = z.union([
  MarketCreateListingCreatedResponseSchema,
  MarketCreateListingIdempotentResponseSchema,
]);

export const MarketBuyListingResponseSchema = z
  .object({
    order_id: uuidSchema,
    purchased_items: z.array(
      z
        .object({
          item_instance_id: uuidSchema,
          template_id: uuidSchema.optional(),
          form_id: uuidSchema.nullable().optional(),
        })
        .strict(),
    ),
    total_price_kcoin: nonNegativeKcoinAmountSchema,
    fee_amount_kcoin: nonNegativeKcoinAmountSchema,
    seller_net_amount_kcoin: nonNegativeKcoinAmountSchema,
    buyer_balance_after: nonNegativeKcoinAmountSchema,
  })
  .strict();

export const MarketMyListingsResponseSchema = z
  .object({
    items: z.array(MarketListingCardDtoSchema),
    next_cursor: cursorSchema.nullable(),
  })
  .strict();

export const MarketMyListingStatsResponseSchema = z
  .object({
    active_count: nonNegativeIntegerSchema,
    active_listing_count: nonNegativeIntegerSchema.optional(),
    active_item_count: nonNegativeIntegerSchema.optional(),
    total_listing_value_kcoin: nonNegativeKcoinAmountSchema,
    expected_net_amount_kcoin: nonNegativeKcoinAmountSchema,
    sold_24h_count: nonNegativeIntegerSchema.optional(),
    sold_24h_value_kcoin: nonNegativeKcoinAmountSchema.optional(),
  })
  .strict();

export const MarketUpdateListingPriceResponseSchema = z
  .object({
    listing_id: uuidSchema,
    unit_price_kcoin: nonNegativeKcoinAmountSchema,
    expected_net_amount: nonNegativeKcoinAmountSchema,
    status: MarketListingStatusSchema.optional(),
  })
  .strict();

export const MarketCancelListingResponseSchema = z
  .object({
    listing_id: uuidSchema,
    status: MarketListingStatusSchema,
    released_item_instance_ids: z.array(uuidSchema),
    cancelled_at: isoDateTimeSchema.optional(),
  })
  .strict();

export const MarketStatsResponseSchema = z
  .object({
    price: MarketPriceStatsDtoSchema.nullable(),
    depth: z.array(MarketDepthLevelDtoSchema),
    price_health: MarketPriceHealthSchema.default("unknown"),
  })
  .strict();

export type MarketCurrency = z.infer<typeof MarketCurrencySchema>;
export type MarketRarityCode = z.infer<typeof MarketRarityCodeSchema>;
export type MarketItemTypeCode = z.infer<typeof MarketItemTypeCodeSchema>;
export type MarketItemType = MarketItemTypeCode;
export type MarketListingStatus = z.infer<typeof MarketListingStatusSchema>;
export type MarketOrderStatus = z.infer<typeof MarketOrderStatusSchema>;
export type MarketListingSort = z.infer<typeof MarketListingSortSchema>;
export type MarketMyListingSort = z.infer<typeof MarketMyListingSortSchema>;
export type MarketSellableItemSort = z.infer<
  typeof MarketSellableItemSortSchema
>;
export type MarketPriceHealth = z.infer<typeof MarketPriceHealthSchema>;

export type MarketListListingsQueryInput = z.input<
  typeof MarketListListingsQuerySchema
>;
export type MarketListListingsQuery = z.output<
  typeof MarketListListingsQuerySchema
>;

export type MarketListQueryInput = MarketListListingsQueryInput;
export type MarketListQuery = MarketListListingsQuery;

export type MarketListingDetailQueryInput = z.input<
  typeof MarketListingDetailQuerySchema
>;
export type MarketListingDetailQuery = z.output<
  typeof MarketListingDetailQuerySchema
>;

export type MarketSellableItemsQueryInput = z.input<
  typeof MarketSellableItemsQuerySchema
>;
export type MarketSellableItemsQuery = z.output<
  typeof MarketSellableItemsQuerySchema
>;

export type MarketCreateListingBodyInput = z.input<
  typeof MarketCreateListingBodySchema
>;
export type MarketCreateListingBody = z.output<
  typeof MarketCreateListingBodySchema
>;

export type MarketBuyListingBodyInput = z.input<
  typeof MarketBuyListingBodySchema
>;
export type MarketBuyListingBody = z.output<typeof MarketBuyListingBodySchema>;

export type MarketMyListingsQueryInput = z.input<
  typeof MarketMyListingsQuerySchema
>;
export type MarketMyListingsQuery = z.output<
  typeof MarketMyListingsQuerySchema
>;

export type MarketMyListingStatsQueryInput = z.input<
  typeof MarketMyListingStatsQuerySchema
>;
export type MarketMyListingStatsQuery = z.output<
  typeof MarketMyListingStatsQuerySchema
>;

export type MarketUpdateListingPriceBodyInput = z.input<
  typeof MarketUpdateListingPriceBodySchema
>;
export type MarketUpdateListingPriceBody = z.output<
  typeof MarketUpdateListingPriceBodySchema
>;

export type MarketCancelListingBodyInput = z.input<
  typeof MarketCancelListingBodySchema
>;
export type MarketCancelListingBody = z.output<
  typeof MarketCancelListingBodySchema
>;

export type MarketStatsQueryInput = z.input<typeof MarketStatsQuerySchema>;
export type MarketStatsQuery = z.output<typeof MarketStatsQuerySchema>;

export type MarketListingCardDto = z.infer<typeof MarketListingCardDtoSchema>;
export type MarketListingDetailDto = z.infer<
  typeof MarketListingDetailDtoSchema
>;
export type MarketSellableItemDto = z.infer<typeof MarketSellableItemDtoSchema>;
export type MarketOrderDto = z.infer<typeof MarketOrderDtoSchema>;
