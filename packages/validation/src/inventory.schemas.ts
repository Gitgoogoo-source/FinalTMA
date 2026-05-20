// packages/validation/src/inventory.schemas.ts

import { z } from 'zod';

/**
 * Inventory validation schemas
 *
 * 负责：
 * - 用户库存查询
 * - 藏品详情查询
 * - 升级
 * - 合成 / 进化
 * - 分解
 * - 藏品详情直接出售
 * - 藏品详情直接下架
 * - 库存变动记录
 *
 * 注意：
 * - 挂售中、锁定中、Mint 中的藏品不能升级、合成、分解。
 * - 合成失败返还规则必须由后端 RPC 执行。
 * - 前端传来的消耗和奖励只能作为乐观校验，最终以后端返回为准。
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

const isoDateTimeSchema = z.string().datetime();

const positiveIntegerSchema = z.coerce.number().int().min(1);

const nonNegativeIntegerSchema = z.coerce.number().int().min(0);

const positiveAmountSchema = z.coerce
  .number()
  .int()
  .min(1, 'amount must be greater than 0')
  .max(1_000_000_000, 'amount is too large');

const nonNegativeAmountSchema = z.coerce
  .number()
  .int()
  .min(0, 'amount cannot be negative')
  .max(1_000_000_000, 'amount is too large');

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

export const InventoryCurrencySchema = z.enum(['KCOIN', 'FGEMS']);

export const InventoryRarityCodeSchema = z.enum([
  'common',
  'rare',
  'epic',
  'legendary',
  'mythic',
]);

export const InventoryItemTypeSchema = z.enum([
  'character',
  'pet',
  'egg',
  'decoration',
  'prop',
  'material',
]);

export const InventoryItemStatusSchema = z.enum([
  'available',
  'locked',
  'listed',
  'consumed',
  'decomposed',
  'minting',
  'minted',
  'transferred',
  'burned',
]);

export const InventoryLockReasonSchema = z.enum([
  'market_listing',
  'market_order',
  'evolution',
  'decompose',
  'upgrade',
  'mint',
  'admin',
]);

export const InventoryActivityTypeSchema = z.enum([
  'obtained_by_gacha',
  'obtained_by_market',
  'obtained_by_admin',
  'listed',
  'listing_cancelled',
  'sold',
  'bought',
  'upgraded',
  'evolved_success',
  'evolved_failed_returned',
  'consumed_by_evolution',
  'decomposed',
  'mint_requested',
  'minted',
  'transferred_onchain',
  'admin_adjusted',
]);

export const InventorySortSchema = z.enum([
  'recently_obtained',
  'oldest_obtained',
  'rarity_desc',
  'rarity_asc',
  'level_desc',
  'level_asc',
  'power_desc',
  'power_asc',
  'name_asc',
  'name_desc',
]);

export const InventoryItemIdParamSchema = z
  .object({
    item_instance_id: uuidSchema,
  })
  .strict();

export const InventoryListQuerySchema = z
  .object({
    keyword: z.string().trim().max(64).optional(),

    statuses: csvArraySchema(InventoryItemStatusSchema, 12),
    rarities: csvArraySchema(InventoryRarityCodeSchema, 8),
    types: csvArraySchema(InventoryItemTypeSchema, 12),

    series_ids: csvArraySchema(uuidSchema, 20),
    faction_ids: csvArraySchema(uuidSchema, 20),
    template_ids: csvArraySchema(uuidSchema, 80),
    form_ids: csvArraySchema(uuidSchema, 80),

    only_sellable: booleanFromQuerySchema.default(false),
    only_duplicates: booleanFromQuerySchema.default(false),
    only_unlocked: booleanFromQuerySchema.default(false),
    only_mintable: booleanFromQuerySchema.default(false),
    include_locked: booleanFromQuerySchema.default(false),

    min_level: z.coerce.number().int().min(1).max(999).optional(),
    max_level: z.coerce.number().int().min(1).max(999).optional(),

    min_power: z.coerce.number().int().min(0).max(1_000_000).optional(),
    max_power: z.coerce.number().int().min(0).max(1_000_000).optional(),

    sort: InventorySortSchema.default('recently_obtained'),

    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(40),
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

    if (
      data.min_power !== undefined &&
      data.max_power !== undefined &&
      data.min_power > data.max_power
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['min_power'],
        message: 'min_power cannot be greater than max_power',
      });
    }
  });

export const InventoryDetailQuerySchema = z
  .object({
    item_instance_id: uuidSchema,

    include_market_status: booleanFromQuerySchema.default(true),
    include_upgrade_preview: booleanFromQuerySchema.default(true),
    include_evolution_preview: booleanFromQuerySchema.default(true),
    include_decompose_preview: booleanFromQuerySchema.default(true),
    include_onchain_status: booleanFromQuerySchema.default(true),
  })
  .strict();

export const InventoryUpgradePreviewQuerySchema = z
  .object({
    item_instance_id: uuidSchema,
    target_level: z.coerce.number().int().min(2).max(999).optional(),
  })
  .strict();

export const InventoryUpgradeItemBodySchema = z
  .object({
    item_instance_id: uuidSchema,

    /**
     * 不传 target_level 时，后端默认升 1 级。
     * 传 target_level 时，后端计算从当前等级升到目标等级的总消耗。
     */
    target_level: z.coerce.number().int().min(2).max(999).optional(),

    /**
     * 前端看到的 Fgems 消耗。
     * 用于防止用户在过期配置下误操作。
     * 最终消耗必须以后端 RPC 当前规则为准。
     */
    expected_fgems_cost: nonNegativeAmountSchema.optional(),

    expected_item_version: z.coerce.number().int().min(0).optional(),

    idempotency_key: idempotencyKeySchema,
  })
  .strict();

export const InventoryEvolvePreviewQuerySchema = z
  .object({
    source_item_instance_ids: uniqueUuidArraySchema({
      min: 3,
      max: 3,
      fieldName: 'source_item_instance_ids',
    }),

    target_form_id: uuidSchema.optional(),
  })
  .strict();

export const InventoryEvolveItemBodySchema = z
  .object({
    /**
     * 必须是 3 份相同藏品或符合 evolution_rules 的藏品实例。
     * 后端必须校验：
     * - owner 是否为当前用户
     * - 是否 available
     * - 是否未挂售、未锁定、未 Mint
     * - 是否符合相同模板 / 相同形态 / 可进化条件
     */
    source_item_instance_ids: uniqueUuidArraySchema({
      min: 3,
      max: 3,
      fieldName: 'source_item_instance_ids',
    }),

    /**
     * 可选。
     * 如果一个藏品存在多条进化路线，可由前端指定目标形态。
     * 如果只有唯一进化路线，可以不传，由后端决定。
     */
    target_form_id: uuidSchema.optional(),

    /**
     * 前端预期消耗。
     * 只用于乐观校验，最终扣费以后端 RPC 为准。
     */
    expected_kcoin_cost: nonNegativeAmountSchema.optional(),

    /**
     * 前端预期成功率。
     * 只用于防止配置过期，不作为真实概率来源。
     */
    expected_success_rate_bps: z.coerce.number().int().min(0).max(10_000).optional(),

    /**
     * 前端期望失败后保留的主藏品。
     * 后端仍必须按“3个藏品中等级最高的那个返还给用户”的规则重新计算。
     */
    expected_return_item_instance_id: uuidSchema.optional(),

    idempotency_key: idempotencyKeySchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.expected_return_item_instance_id &&
      !data.source_item_instance_ids.includes(data.expected_return_item_instance_id)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expected_return_item_instance_id'],
        message: 'expected_return_item_instance_id must be one of source_item_instance_ids',
      });
    }
  });

export const InventoryDecomposePreviewQuerySchema = z
  .object({
    item_instance_ids: uniqueUuidArraySchema({
      min: 1,
      max: 100,
      fieldName: 'item_instance_ids',
    }),
  })
  .strict();

export const InventoryDecomposeItemBodySchema = z
  .object({
    item_instance_ids: uniqueUuidArraySchema({
      min: 1,
      max: 100,
      fieldName: 'item_instance_ids',
    }),

    /**
     * 前端展示的预期 Fgems 奖励。
     * 后端可用于防止用户在过期配置下误操作。
     */
    expected_fgems_reward: nonNegativeAmountSchema.optional(),

    idempotency_key: idempotencyKeySchema,
  })
  .strict();

export const InventorySellEntryBodySchema = z
  .object({
    item_instance_ids: uniqueUuidArraySchema({
      min: 1,
      max: 100,
      fieldName: 'item_instance_ids',
    }),

    unit_price: positiveAmountSchema,

    currency: z.literal('KCOIN').default('KCOIN'),

    allow_partial_fill: z.boolean().default(false),

    expires_at: isoDateTimeSchema.optional(),

    idempotency_key: idempotencyKeySchema,
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

export const InventoryCancelSellBodySchema = z
  .object({
    /**
     * 从藏品详情页下架时，前端可以传 listing_id。
     */
    listing_id: uuidSchema.optional(),

    /**
     * 如果前端只知道藏品实例，也可以传 item_instance_id。
     * 后端需要查找该藏品当前 active listing。
     */
    item_instance_id: uuidSchema.optional(),

    idempotency_key: idempotencyKeySchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.listing_id && !data.item_instance_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['listing_id'],
        message: 'listing_id or item_instance_id is required',
      });
    }
  });

export const InventoryActivityQuerySchema = z
  .object({
    item_instance_id: uuidSchema.optional(),
    template_id: uuidSchema.optional(),

    activity_types: csvArraySchema(InventoryActivityTypeSchema, 30),

    from_at: isoDateTimeSchema.optional(),
    to_at: isoDateTimeSchema.optional(),

    cursor: cursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.from_at && data.to_at) {
      const from = Date.parse(data.from_at);
      const to = Date.parse(data.to_at);

      if (from > to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['from_at'],
          message: 'from_at cannot be later than to_at',
        });
      }
    }
  });

export const InventoryLockDtoSchema = z
  .object({
    lock_id: uuidSchema,
    reason: InventoryLockReasonSchema,
    source_type: z.string().min(1),
    source_id: uuidSchema.optional(),
    locked_at: isoDateTimeSchema,
    expires_at: isoDateTimeSchema.nullable().optional(),
  })
  .strict();

export const InventoryItemDtoSchema = z
  .object({
    item_instance_id: uuidSchema,
    template_id: uuidSchema,
    form_id: uuidSchema.optional(),

    serial_no: z.number().int().positive().optional(),

    name: z.string(),
    description: z.string().nullable().optional(),

    rarity: InventoryRarityCodeSchema,
    type: InventoryItemTypeSchema,

    series_id: uuidSchema.optional(),
    series_name: z.string().nullable().optional(),

    faction_id: uuidSchema.optional(),
    faction_name: z.string().nullable().optional(),

    level: z.number().int().min(1),
    power: z.number().int().min(0),

    status: InventoryItemStatusSchema,

    is_tradeable: z.boolean(),
    is_upgradeable: z.boolean(),
    is_evolvable: z.boolean(),
    is_decomposable: z.boolean(),
    is_mintable: z.boolean(),

    image_url: z.string().url().nullable().optional(),
    thumb_url: z.string().url().nullable().optional(),

    obtained_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,

    active_lock: InventoryLockDtoSchema.nullable().optional(),
  })
  .strict();

export const InventoryItemDetailDtoSchema = InventoryItemDtoSchema.extend({
  base_power: z.number().int().min(0).optional(),

  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),

  market_status: z
    .object({
      is_listed: z.boolean(),
      listing_id: uuidSchema.nullable(),
      unit_price: nonNegativeAmountSchema.nullable(),
      currency: z.literal('KCOIN').nullable(),
    })
    .strict()
    .optional(),

  upgrade_preview: z
    .object({
      can_upgrade: z.boolean(),
      current_level: z.number().int().min(1),
      next_level: z.number().int().min(1).nullable(),
      fgems_cost: nonNegativeAmountSchema.nullable(),
      power_after: z.number().int().min(0).nullable(),
    })
    .strict()
    .optional(),

  evolution_preview: z
    .object({
      can_evolve: z.boolean(),
      required_same_items: z.number().int().min(0),
      kcoin_cost: nonNegativeAmountSchema.nullable(),
      success_rate_bps: z.number().int().min(0).max(10_000).nullable(),
      target_template_id: uuidSchema.nullable(),
      target_form_id: uuidSchema.nullable(),
    })
    .strict()
    .optional(),

  decompose_preview: z
    .object({
      can_decompose: z.boolean(),
      fgems_reward: nonNegativeAmountSchema.nullable(),
    })
    .strict()
    .optional(),

  onchain_status: z
    .object({
      is_minted: z.boolean(),
      mint_status: z.enum(['none', 'queued', 'processing', 'minted', 'failed']).default('none'),
      nft_item_address: z.string().nullable(),
      owner_wallet_address: z.string().nullable(),
    })
    .strict()
    .optional(),
}).strict();

export const InventoryListResponseSchema = z
  .object({
    items: z.array(InventoryItemDtoSchema),
    next_cursor: cursorSchema.nullable(),

    summary: z
      .object({
        total_count: nonNegativeIntegerSchema,
        available_count: nonNegativeIntegerSchema,
        listed_count: nonNegativeIntegerSchema,
        locked_count: nonNegativeIntegerSchema,
        duplicate_count: nonNegativeIntegerSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export const InventoryUpgradeItemResponseSchema = z
  .object({
    item: InventoryItemDetailDtoSchema,

    consumed_fgems: nonNegativeAmountSchema,

    fgems_balance_after: nonNegativeAmountSchema,

    upgraded_at: isoDateTimeSchema,
  })
  .strict();

export const InventoryEvolveResultSchema = z.enum(['success', 'failed']);

export const InventoryEvolveItemResponseSchema = z
  .object({
    result: InventoryEvolveResultSchema,

    consumed_item_instance_ids: z.array(uuidSchema),
    returned_item_instance_id: uuidSchema.nullable(),

    created_item_instance_id: uuidSchema.nullable(),

    consumed_kcoin: nonNegativeAmountSchema,
    kcoin_balance_after: nonNegativeAmountSchema,

    success_rate_bps: z.number().int().min(0).max(10_000),

    evolved_at: isoDateTimeSchema,
  })
  .strict();

export const InventoryDecomposeItemResponseSchema = z
  .object({
    decomposed_item_instance_ids: z.array(uuidSchema),

    gained_fgems: nonNegativeAmountSchema,
    fgems_balance_after: nonNegativeAmountSchema,

    decomposed_at: isoDateTimeSchema,
  })
  .strict();

export const InventoryActivityDtoSchema = z
  .object({
    activity_id: uuidSchema,

    activity_type: InventoryActivityTypeSchema,

    item_instance_id: uuidSchema.nullable(),
    template_id: uuidSchema.nullable(),

    source_type: z.string().min(1),
    source_id: uuidSchema.nullable(),

    title: z.string(),
    description: z.string().nullable(),

    created_at: isoDateTimeSchema,
  })
  .strict();

export const InventoryActivityResponseSchema = z
  .object({
    items: z.array(InventoryActivityDtoSchema),
    next_cursor: cursorSchema.nullable(),
  })
  .strict();

export type InventoryCurrency = z.infer<typeof InventoryCurrencySchema>;
export type InventoryRarityCode = z.infer<typeof InventoryRarityCodeSchema>;
export type InventoryItemType = z.infer<typeof InventoryItemTypeSchema>;
export type InventoryItemStatus = z.infer<typeof InventoryItemStatusSchema>;
export type InventoryLockReason = z.infer<typeof InventoryLockReasonSchema>;
export type InventoryActivityType = z.infer<typeof InventoryActivityTypeSchema>;
export type InventorySort = z.infer<typeof InventorySortSchema>;

export type InventoryListQueryInput = z.input<typeof InventoryListQuerySchema>;
export type InventoryListQuery = z.output<typeof InventoryListQuerySchema>;

export type InventoryDetailQueryInput = z.input<typeof InventoryDetailQuerySchema>;
export type InventoryDetailQuery = z.output<typeof InventoryDetailQuerySchema>;

export type InventoryUpgradeItemBodyInput = z.input<typeof InventoryUpgradeItemBodySchema>;
export type InventoryUpgradeItemBody = z.output<typeof InventoryUpgradeItemBodySchema>;

export type InventoryEvolveItemBodyInput = z.input<typeof InventoryEvolveItemBodySchema>;
export type InventoryEvolveItemBody = z.output<typeof InventoryEvolveItemBodySchema>;

export type InventoryDecomposeItemBodyInput = z.input<typeof InventoryDecomposeItemBodySchema>;
export type InventoryDecomposeItemBody = z.output<typeof InventoryDecomposeItemBodySchema>;

export type InventorySellEntryBodyInput = z.input<typeof InventorySellEntryBodySchema>;
export type InventorySellEntryBody = z.output<typeof InventorySellEntryBodySchema>;

export type InventoryCancelSellBodyInput = z.input<typeof InventoryCancelSellBodySchema>;
export type InventoryCancelSellBody = z.output<typeof InventoryCancelSellBodySchema>;

export type InventoryActivityQueryInput = z.input<typeof InventoryActivityQuerySchema>;
export type InventoryActivityQuery = z.output<typeof InventoryActivityQuerySchema>;

export type InventoryItemDto = z.infer<typeof InventoryItemDtoSchema>;
export type InventoryItemDetailDto = z.infer<typeof InventoryItemDetailDtoSchema>;
export type InventoryListResponse = z.infer<typeof InventoryListResponseSchema>;
export type InventoryUpgradeItemResponse = z.infer<typeof InventoryUpgradeItemResponseSchema>;
export type InventoryEvolveItemResponse = z.infer<typeof InventoryEvolveItemResponseSchema>;
export type InventoryDecomposeItemResponse = z.infer<typeof InventoryDecomposeItemResponseSchema>;
export type InventoryActivityDto = z.infer<typeof InventoryActivityDtoSchema>;