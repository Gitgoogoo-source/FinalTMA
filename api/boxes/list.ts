import {
  BoxListQuerySchema,
  type BoxListQuery,
} from "../../packages/validation/src/box.schemas.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { getSupabaseAdmin, requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type DisplayableBoxStatus =
  | "not_started"
  | "active"
  | "paused"
  | "ended"
  | "sold_out";
type BoxTier = "normal" | "rare" | "legendary" | "event";
type StockStatus = "available" | "low_stock" | "sold_out" | "unlimited";

type BlindBoxRow = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  tier: string;
  status: string;
  price_stars: number | string;
  total_stock: number | string | null;
  remaining_stock: number | string | null;
  open_reward_kcoin: number | string;
  cover_image_url: string | null;
  hero_image_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  updated_at: string;
};

type PriceRuleRow = {
  box_id: string;
  quantity: number;
  discount_bps: number | string;
  price_stars_override: number | string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};

type PityRuleRow = {
  id: string;
  box_id: string;
  threshold: number | string;
  target_rarity_code: string;
  priority: number;
  created_at: string;
};

type PityStateRow = {
  box_id: string;
  pity_rule_id: string;
  current_count: number | string;
  total_draws: number | string;
  updated_at: string;
};

type PityProgress = {
  rule_id: string;
  threshold: number;
  current_count: number;
  total_draws: number;
  remaining_to_guaranteed: number;
  target_rarity: string;
  guaranteed_next: boolean;
  updated_at: string | null;
} | null;

type BoxListItem = {
  box_id: string;
  slug: string;
  name: string;
  description: string | null;
  tier: BoxTier | string;
  status: DisplayableBoxStatus;
  single_star_price: number;
  ten_draw_price: number;
  discount_rate: number;
  discount_bps: number;
  stock_status: StockStatus;
  total_stock: number | null;
  remaining_stock: number | null;
  pity_progress: PityProgress;
  hero_image_url: string | null;
  cover_image_url: string | null;
  is_openable: boolean;
  disabled_reason: string | null;
  kcoin_return_per_draw: number;
  sort_order: number;
  updated_at: string;
};

const DISPLAYABLE_BOX_STATUSES: DisplayableBoxStatus[] = [
  "not_started",
  "active",
  "paused",
  "ended",
  "sold_out",
];

export default withApiHandler(
  async (req) => {
    const session = await requireSession(req);
    const query = validate(BoxListQuerySchema, req.query);
    const db = getSupabaseAdmin();
    const statuses = getRequestedStatuses(query);
    const now = new Date();

    if (statuses.length === 0) {
      return {
        items: [],
        next_cursor: null,
        server_time: now.toISOString(),
      };
    }

    let boxesQuery = db
      .schema("gacha")
      .from("blind_boxes")
      .select(
        [
          "id",
          "slug",
          "display_name",
          "description",
          "tier",
          "status",
          "price_stars",
          "total_stock",
          "remaining_stock",
          "open_reward_kcoin",
          "cover_image_url",
          "hero_image_url",
          "starts_at",
          "ends_at",
          "sort_order",
          "updated_at",
        ].join(","),
      )
      .in("status", statuses)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (query.tier) {
      boxesQuery = boxesQuery.eq("tier", normalizeBoxTier(query.tier));
    }

    const { data: boxRows, error: boxesError } = await boxesQuery
      .limit(query.limit)
      .returns<BlindBoxRow[]>();

    if (boxesError) {
      throw new ApiError(500, "BOX_LIST_LOOKUP_FAILED", "查询盲盒列表失败。", {
        details: boxesError,
        expose: false,
      });
    }

    const boxes = boxRows ?? [];
    const boxIds = boxes.map((box) => box.id);
    const [priceRules, pityRules, pityStates] = await Promise.all([
      loadPriceRules(boxIds),
      loadPityRules(boxIds),
      loadUserPityStates(session.userId, boxIds),
    ]);

    const priceRulesByBox = groupPriceRules(priceRules);
    const pityRulesByBox = groupPityRules(pityRules);
    const pityStatesByRule = groupPityStates(pityStates);
    return {
      items: boxes.map((box) =>
        toBoxListItem(box, {
          priceRules: priceRulesByBox.get(box.id) ?? new Map(),
          pityRules: pityRulesByBox.get(box.id) ?? [],
          pityStates: pityStatesByRule,
          now,
        }),
      ),
      next_cursor: null,
      server_time: now.toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "boxes.list",
    },
  },
);

async function loadPriceRules(boxIds: string[]): Promise<PriceRuleRow[]> {
  if (boxIds.length === 0) {
    return [];
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("gacha")
    .from("box_price_rules")
    .select(
      "box_id,quantity,discount_bps,price_stars_override,starts_at,ends_at,created_at",
    )
    .in("box_id", boxIds)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .returns<PriceRuleRow[]>();

  if (error) {
    throw new ApiError(
      500,
      "BOX_PRICE_RULE_LOOKUP_FAILED",
      "查询盲盒价格规则失败。",
      {
        details: error,
        expose: false,
      },
    );
  }

  return (data ?? []).filter((rule) => isEffectiveNow(rule));
}

async function loadPityRules(boxIds: string[]): Promise<PityRuleRow[]> {
  if (boxIds.length === 0) {
    return [];
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("gacha")
    .from("pity_rules")
    .select("id,box_id,threshold,target_rarity_code,priority,created_at")
    .in("box_id", boxIds)
    .eq("active", true)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<PityRuleRow[]>();

  if (error) {
    throw new ApiError(
      500,
      "BOX_PITY_RULE_LOOKUP_FAILED",
      "查询盲盒保底规则失败。",
      {
        details: error,
        expose: false,
      },
    );
  }

  return data ?? [];
}

async function loadUserPityStates(
  userId: string,
  boxIds: string[],
): Promise<PityStateRow[]> {
  if (boxIds.length === 0) {
    return [];
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("gacha")
    .from("user_pity_states")
    .select("box_id,pity_rule_id,current_count,total_draws,updated_at")
    .eq("user_id", userId)
    .in("box_id", boxIds)
    .returns<PityStateRow[]>();

  if (error) {
    throw new ApiError(
      500,
      "BOX_PITY_STATE_LOOKUP_FAILED",
      "查询用户保底进度失败。",
      {
        details: error,
        expose: false,
      },
    );
  }

  return data ?? [];
}

function toBoxListItem(
  box: BlindBoxRow,
  context: {
    priceRules: Map<number, PriceRuleRow>;
    pityRules: PityRuleRow[];
    pityStates: Map<string, PityStateRow>;
    now: Date;
  },
): BoxListItem {
  const singleRule = context.priceRules.get(1) ?? null;
  const tenRule = context.priceRules.get(10) ?? null;
  const singleStarPrice = calculateDrawPrice(box, 1, singleRule);
  const tenDrawPrice = calculateDrawPrice(box, 10, tenRule);
  const tenDiscountBps = tenRule ? toInteger(tenRule.discount_bps) : 1000;
  const availability = getAvailability(box, context.now);

  return {
    box_id: box.id,
    slug: box.slug,
    name: box.display_name,
    description: box.description,
    tier: normalizeBoxTier(box.tier),
    status: box.status as DisplayableBoxStatus,
    single_star_price: singleStarPrice,
    ten_draw_price: tenDrawPrice,
    discount_rate: Number(((10_000 - tenDiscountBps) / 10_000).toFixed(4)),
    discount_bps: tenDiscountBps,
    stock_status: getStockStatus(box),
    total_stock: nullableInteger(box.total_stock),
    remaining_stock: nullableInteger(box.remaining_stock),
    pity_progress: buildPityProgress(context.pityRules[0], context.pityStates),
    hero_image_url: box.hero_image_url ?? box.cover_image_url,
    cover_image_url: box.cover_image_url,
    is_openable: availability.isOpenable,
    disabled_reason: availability.disabledReason,
    kcoin_return_per_draw: toInteger(box.open_reward_kcoin),
    sort_order: box.sort_order,
    updated_at: box.updated_at,
  };
}

function groupPriceRules(
  rows: PriceRuleRow[],
): Map<string, Map<number, PriceRuleRow>> {
  const result = new Map<string, Map<number, PriceRuleRow>>();

  for (const row of rows) {
    const byQuantity =
      result.get(row.box_id) ?? new Map<number, PriceRuleRow>();

    if (!byQuantity.has(row.quantity)) {
      byQuantity.set(row.quantity, row);
    }

    result.set(row.box_id, byQuantity);
  }

  return result;
}

function groupPityRules(rows: PityRuleRow[]): Map<string, PityRuleRow[]> {
  const result = new Map<string, PityRuleRow[]>();

  for (const row of rows) {
    const list = result.get(row.box_id) ?? [];
    list.push(row);
    result.set(row.box_id, list);
  }

  return result;
}

function groupPityStates(rows: PityStateRow[]): Map<string, PityStateRow> {
  return new Map(rows.map((row) => [row.pity_rule_id, row]));
}

function buildPityProgress(
  pityRule: PityRuleRow | undefined,
  pityStates: Map<string, PityStateRow>,
): PityProgress {
  if (!pityRule) {
    return null;
  }

  const state = pityStates.get(pityRule.id);
  const threshold = toInteger(pityRule.threshold);
  const currentCount = toInteger(state?.current_count);
  const remainingToGuaranteed = Math.max(threshold - currentCount, 0);

  return {
    rule_id: pityRule.id,
    threshold,
    current_count: currentCount,
    total_draws: toInteger(state?.total_draws),
    remaining_to_guaranteed: remainingToGuaranteed,
    target_rarity: pityRule.target_rarity_code,
    guaranteed_next: remainingToGuaranteed <= 0,
    updated_at: state?.updated_at ?? null,
  };
}

function calculateDrawPrice(
  box: BlindBoxRow,
  quantity: 1 | 10,
  priceRule: PriceRuleRow | null,
): number {
  const unitPrice =
    nullableInteger(priceRule?.price_stars_override) ??
    toInteger(box.price_stars);
  const discountBps = priceRule
    ? toInteger(priceRule.discount_bps)
    : quantity === 10
      ? 1000
      : 0;

  return Math.ceil((unitPrice * quantity * (10_000 - discountBps)) / 10_000);
}

function getAvailability(
  box: BlindBoxRow,
  now: Date,
): {
  isOpenable: boolean;
  disabledReason: string | null;
} {
  if (box.status !== "active") {
    return {
      isOpenable: false,
      disabledReason: disabledReasonForStatus(box.status),
    };
  }

  if (box.starts_at && Date.parse(box.starts_at) > now.getTime()) {
    return {
      isOpenable: false,
      disabledReason: "盲盒活动尚未开始。",
    };
  }

  if (box.ends_at && Date.parse(box.ends_at) <= now.getTime()) {
    return {
      isOpenable: false,
      disabledReason: "盲盒活动已结束。",
    };
  }

  const remainingStock = nullableInteger(box.remaining_stock);

  if (remainingStock !== null && remainingStock <= 0) {
    return {
      isOpenable: false,
      disabledReason: "盲盒库存已售罄。",
    };
  }

  return {
    isOpenable: true,
    disabledReason: null,
  };
}

function disabledReasonForStatus(status: string): string {
  switch (status) {
    case "not_started":
      return "盲盒活动尚未开始。";
    case "paused":
      return "盲盒活动已暂停。";
    case "ended":
      return "盲盒活动已结束。";
    case "sold_out":
      return "盲盒库存已售罄。";
    default:
      return "当前盲盒不可开启。";
  }
}

function getStockStatus(box: BlindBoxRow): StockStatus {
  const remainingStock = nullableInteger(box.remaining_stock);

  if (box.status === "sold_out" || remainingStock === 0) {
    return "sold_out";
  }

  if (remainingStock === null) {
    return "unlimited";
  }

  const totalStock = nullableInteger(box.total_stock);

  if (
    remainingStock <= 10 ||
    (totalStock !== null && remainingStock / Math.max(totalStock, 1) <= 0.1)
  ) {
    return "low_stock";
  }

  return "available";
}

function normalizeBoxTier(value: string): BoxTier | string {
  return value === "ordinary" ? "normal" : value;
}

function getRequestedStatuses(query: BoxListQuery): DisplayableBoxStatus[] {
  if (!query.status) {
    return DISPLAYABLE_BOX_STATUSES;
  }

  return isDisplayableBoxStatus(query.status) ? [query.status] : [];
}

function isDisplayableBoxStatus(value: string): value is DisplayableBoxStatus {
  return (DISPLAYABLE_BOX_STATUSES as readonly string[]).includes(value);
}

function isEffectiveNow(row: {
  starts_at: string | null;
  ends_at: string | null;
}): boolean {
  const now = Date.now();
  const startsAt = row.starts_at ? Date.parse(row.starts_at) : null;
  const endsAt = row.ends_at ? Date.parse(row.ends_at) : null;

  return (
    (startsAt === null || startsAt <= now) && (endsAt === null || endsAt > now)
  );
}

function nullableInteger(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return toInteger(value);
}

function toInteger(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return Math.trunc(Number(value));
  }

  return 0;
}
