import {
  BoxRewardsQuerySchema,
  type BoxRewardsQuery,
} from "../../packages/validation/src/box.schemas.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { getSupabaseAdmin, requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type BlindBoxRow = {
  id: string;
  slug: string;
  display_name: string;
  status: string;
};

type DropPoolVersionRow = {
  id: string;
  box_id: string;
  version_no: number;
  status: string;
  total_weight: number | string;
  effective_from: string | null;
  effective_to: string | null;
  updated_at: string;
};

type DropPoolItemRow = {
  id: string;
  template_id: string;
  form_id: string | null;
  rarity_code: string;
  drop_weight: number | string;
  probability_bps: number | string | null;
  stock_remaining: number | string | null;
  is_pity_eligible: boolean;
  is_featured: boolean;
  sort_order: number;
};

type CollectibleTemplateRow = {
  id: string;
  slug: string;
  display_name: string;
  subtitle: string | null;
  description: string | null;
  rarity_code: string;
  type_code: string;
};

type CollectibleFormRow = {
  id: string;
  template_id: string;
  display_name: string;
  form_index: number;
  image_url: string | null;
  thumbnail_url: string | null;
  avatar_url: string | null;
};

type RarityRow = {
  code: string;
  display_name: string;
};

type ItemTypeRow = {
  code: string;
  display_name: string;
};

type PityRuleRow = {
  threshold: number | string;
  target_rarity_code: string;
  rule_name: string;
};

export default withApiHandler(
  async (req) => {
    await requireSession(req);
    const query = validate(
      BoxRewardsQuerySchema,
      normalizeRewardsQuery(req.query),
    );
    const db = getSupabaseAdmin();
    const box = await loadDisplayableBox(query.boxId, query.includeInactive);
    const poolVersion = await loadActivePoolVersion(query);
    const poolItems = await loadPoolItems(poolVersion.id, query.includeSoldOut);
    const catalog = await loadRewardCatalog(poolItems);
    const pityRule = await loadPityRule(box.id, poolVersion.id);
    const totalWeight = toNumber(poolVersion.total_weight);

    return {
      box_id: box.id,
      box_slug: box.slug,
      box_name: box.display_name,
      box_status: box.status,
      pool_version_id: poolVersion.id,
      pool_version: poolVersion.version_no,
      items: poolItems.map((item) => toRewardItem(item, catalog, totalWeight)),
      pity_rule: pityRule
        ? {
            threshold: toInteger(pityRule.threshold),
            target_rarity: pityRule.target_rarity_code,
            description: `累计未命中达到 ${toInteger(pityRule.threshold)} 次后，保底 ${pityRule.target_rarity_code}。`,
          }
        : null,
      generated_at: new Date().toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "boxes.rewards",
    },
  },
);

function normalizeRewardsQuery(
  query: Record<string, unknown>,
): Record<string, unknown> {
  return {
    boxId: query.boxId ?? query.box_id,
    poolVersionId: query.poolVersionId ?? query.pool_version_id,
    includeInactive: query.includeInactive ?? query.include_inactive,
    includeSoldOut: query.includeSoldOut ?? query.include_sold_out,
  };
}

async function loadDisplayableBox(
  boxId: string,
  includeInactive: boolean,
): Promise<BlindBoxRow> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("gacha")
    .from("blind_boxes")
    .select("id,slug,display_name,status")
    .eq("id", boxId)
    .maybeSingle<BlindBoxRow>();

  if (error) {
    throw new ApiError(500, "BOX_LOOKUP_FAILED", "查询盲盒失败。", {
      details: error,
      expose: false,
    });
  }

  if (!data || data.status === "draft" || data.status === "hidden") {
    throw ApiError.notFound("盲盒不存在或不可展示。");
  }

  if (!includeInactive && data.status === "hidden") {
    throw ApiError.notFound("盲盒不存在或不可展示。");
  }

  return data;
}

async function loadActivePoolVersion(
  query: BoxRewardsQuery,
): Promise<DropPoolVersionRow> {
  const db = getSupabaseAdmin();
  let poolQuery = db
    .schema("gacha")
    .from("drop_pool_versions")
    .select(
      "id,box_id,version_no,status,total_weight,effective_from,effective_to,updated_at",
    )
    .eq("box_id", query.boxId)
    .eq("status", "active")
    .order("version_no", { ascending: false });

  if (query.poolVersionId) {
    poolQuery = poolQuery.eq("id", query.poolVersionId);
  }

  const { data, error } = await poolQuery.returns<DropPoolVersionRow[]>();

  if (error) {
    throw new ApiError(500, "BOX_POOL_LOOKUP_FAILED", "查询盲盒奖励池失败。", {
      details: error,
      expose: false,
    });
  }

  const poolVersion = (data ?? []).find((row) => isEffectiveNow(row));

  if (!poolVersion) {
    throw ApiError.notFound("当前盲盒没有可展示的 active 奖励池。");
  }

  return poolVersion;
}

async function loadPoolItems(
  poolVersionId: string,
  includeSoldOut: boolean,
): Promise<DropPoolItemRow[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("gacha")
    .from("drop_pool_items")
    .select(
      [
        "id",
        "template_id",
        "form_id",
        "rarity_code",
        "drop_weight",
        "probability_bps",
        "stock_remaining",
        "is_pity_eligible",
        "is_featured",
        "sort_order",
      ].join(","),
    )
    .eq("pool_version_id", poolVersionId)
    .order("sort_order", { ascending: true })
    .returns<DropPoolItemRow[]>();

  if (error) {
    throw new ApiError(
      500,
      "BOX_POOL_ITEMS_LOOKUP_FAILED",
      "查询盲盒奖励项失败。",
      {
        details: error,
        expose: false,
      },
    );
  }

  return (data ?? []).filter(
    (item) => includeSoldOut || nullableInteger(item.stock_remaining) !== 0,
  );
}

async function loadRewardCatalog(poolItems: DropPoolItemRow[]) {
  const templateIds = unique(poolItems.map((item) => item.template_id));
  const formIds = unique(
    poolItems.map((item) => item.form_id).filter(isString),
  );
  const rarityCodes = unique(poolItems.map((item) => item.rarity_code));

  const [templates, forms, rarities, itemTypes] = await Promise.all([
    loadTemplates(templateIds),
    loadForms(formIds),
    loadRarities(rarityCodes),
    loadItemTypes(),
  ]);

  return {
    templates: new Map(templates.map((row) => [row.id, row])),
    forms: new Map(forms.map((row) => [row.id, row])),
    rarities: new Map(rarities.map((row) => [row.code, row])),
    itemTypes: new Map(itemTypes.map((row) => [row.code, row])),
  };
}

async function loadTemplates(
  templateIds: string[],
): Promise<CollectibleTemplateRow[]> {
  if (templateIds.length === 0) {
    return [];
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("catalog")
    .from("collectible_templates")
    .select("id,slug,display_name,subtitle,description,rarity_code,type_code")
    .in("id", templateIds)
    .returns<CollectibleTemplateRow[]>();

  if (error) {
    throw new ApiError(
      500,
      "BOX_REWARD_TEMPLATE_LOOKUP_FAILED",
      "查询藏品模板失败。",
      {
        details: error,
        expose: false,
      },
    );
  }

  return data ?? [];
}

async function loadForms(formIds: string[]): Promise<CollectibleFormRow[]> {
  if (formIds.length === 0) {
    return [];
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("catalog")
    .from("collectible_forms")
    .select(
      "id,template_id,display_name,form_index,image_url,thumbnail_url,avatar_url",
    )
    .in("id", formIds)
    .returns<CollectibleFormRow[]>();

  if (error) {
    throw new ApiError(
      500,
      "BOX_REWARD_FORM_LOOKUP_FAILED",
      "查询藏品形态失败。",
      {
        details: error,
        expose: false,
      },
    );
  }

  return data ?? [];
}

async function loadRarities(rarityCodes: string[]): Promise<RarityRow[]> {
  if (rarityCodes.length === 0) {
    return [];
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("catalog")
    .from("rarities")
    .select("code,display_name")
    .in("code", rarityCodes)
    .returns<RarityRow[]>();

  if (error) {
    throw new ApiError(
      500,
      "BOX_REWARD_RARITY_LOOKUP_FAILED",
      "查询稀有度失败。",
      {
        details: error,
        expose: false,
      },
    );
  }

  return data ?? [];
}

async function loadItemTypes(): Promise<ItemTypeRow[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("catalog")
    .from("item_types")
    .select("code,display_name")
    .returns<ItemTypeRow[]>();

  if (error) {
    throw new ApiError(
      500,
      "BOX_REWARD_TYPE_LOOKUP_FAILED",
      "查询藏品类型失败。",
      {
        details: error,
        expose: false,
      },
    );
  }

  return data ?? [];
}

async function loadPityRule(
  boxId: string,
  poolVersionId: string,
): Promise<PityRuleRow | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .schema("gacha")
    .from("pity_rules")
    .select("threshold,target_rarity_code,rule_name")
    .eq("box_id", boxId)
    .eq("pool_version_id", poolVersionId)
    .eq("active", true)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle<PityRuleRow>();

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

  return data ?? null;
}

function toRewardItem(
  item: DropPoolItemRow,
  catalog: Awaited<ReturnType<typeof loadRewardCatalog>>,
  totalWeight: number,
) {
  const template = catalog.templates.get(item.template_id);
  const form = item.form_id ? catalog.forms.get(item.form_id) : undefined;
  const rarity = catalog.rarities.get(item.rarity_code);
  const itemType = template
    ? catalog.itemTypes.get(template.type_code)
    : undefined;
  const probabilityBps =
    nullableInteger(item.probability_bps) ??
    (totalWeight > 0
      ? Math.round((toNumber(item.drop_weight) / totalWeight) * 10_000)
      : 0);

  return {
    pool_item_id: item.id,
    template_id: item.template_id,
    form_id: item.form_id,
    name: form?.display_name ?? template?.display_name ?? "Unknown reward",
    description: template?.description ?? null,
    rarity: item.rarity_code,
    rarity_label: rarity?.display_name ?? item.rarity_code,
    item_type: template?.type_code ?? null,
    item_type_label: itemType?.display_name ?? template?.type_code ?? null,
    image_url:
      form?.image_url ?? form?.thumbnail_url ?? form?.avatar_url ?? null,
    display_probability: formatProbability(probabilityBps),
    probability_bps: probabilityBps,
    remaining_stock: nullableInteger(item.stock_remaining),
    is_limited: item.stock_remaining !== null,
    is_pity_eligible: item.is_pity_eligible,
    is_featured: item.is_featured,
  };
}

function isEffectiveNow(row: {
  effective_from: string | null;
  effective_to: string | null;
}): boolean {
  const now = Date.now();
  const effectiveFrom = row.effective_from
    ? Date.parse(row.effective_from)
    : null;
  const effectiveTo = row.effective_to ? Date.parse(row.effective_to) : null;

  return (
    (effectiveFrom === null || effectiveFrom <= now) &&
    (effectiveTo === null || effectiveTo > now)
  );
}

function formatProbability(probabilityBps: number): string {
  const percentage = probabilityBps / 100;

  return `${percentage.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
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
  return Math.trunc(toNumber(value));
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}
