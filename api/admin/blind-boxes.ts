import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import {
  ApiError,
  assertApiRateLimit,
  withApiHandler,
} from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  buildNextCursor,
  firstQueryValue,
  isRecord,
  normalizeOptionalText,
  normalizeRequiredText,
  parseAdminLimit,
  parseOffsetCursor,
  toJsonObject,
  type JsonRecord,
} from "./_shared.js";
import {
  BLIND_BOX_COLUMNS,
  BOX_STATUS_VALUES,
  BOX_TIER_VALUES,
  DROP_POOL_ITEM_COLUMNS,
  DROP_POOL_VERSION_COLUMNS,
  GACHA_READ_PERMISSIONS,
  GACHA_WRITE_PERMISSIONS,
  assertReadSuccess,
  callGachaWriteRpc,
  mapBlindBoxRow,
  mapDropPoolVersionRow,
  normalizeEnum,
  normalizeOptionalBodyUuid,
  normalizeOptionalEnumQuery,
  normalizeOptionalQueryUuid,
  normalizeRequiredQueryUuid,
  readGachaWriteBody,
  requireGachaWriteControls,
  sanitizeAdminJson,
  summarizeByStatus,
  type BlindBoxRow,
  type DropPoolItemRow,
  type DropPoolMutationResult,
  type DropPoolVersionRow,
} from "./gacha/_shared.js";

type BoxPriceRuleRow = {
  id: string;
  box_id: string;
  quantity: number | string;
  discount_bps: number | string;
  price_stars_override: number | string | null;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type BlindBoxInput = {
  id: string | null;
  slug: string;
  displayName: string;
  description: string | null;
  tier: (typeof BOX_TIER_VALUES)[number];
  status: (typeof BOX_STATUS_VALUES)[number];
  priceStars: number;
  totalStock: number | null;
  remainingStock: number | null;
  openRewardKcoin: number;
  coverImageUrl: string | null;
  heroImageUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  metadata: ReturnType<typeof toJsonObject>;
};

const BOX_PRICE_RULE_COLUMNS = [
  "id",
  "box_id",
  "quantity",
  "discount_bps",
  "price_stars_override",
  "active",
  "starts_at",
  "ends_at",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req, res, ctx) => {
    await assertApiRateLimit(req, res, ctx, {
      action: ctx.method === "GET" ? "admin.read" : "admin.write",
    });

    if (ctx.method === "GET") {
      await requireAdmin(req, {
        permissions: GACHA_READ_PERMISSIONS,
        requireAll: false,
      });

      return await listBlindBoxes(getSupabaseAdminClient(), req.query);
    }

    const admin = await requireAdmin(req, {
      permissions: GACHA_WRITE_PERMISSIONS,
      requireAll: false,
    });
    const body = await readGachaWriteBody(req);
    const controls = requireGachaWriteControls(req, body, admin, ctx);

    if (ctx.method === "POST") {
      return await upsertBlindBox({
        body,
        adminUserId: admin.adminId,
        requestId: ctx.requestId,
        controls,
      });
    }

    if (ctx.method === "PATCH") {
      return await updateBlindBoxStatus({
        body,
        adminUserId: admin.adminId,
        requestId: ctx.requestId,
        controls,
      });
    }

    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Method is not allowed");
  },
  {
    methods: ["GET", "POST", "PATCH"],
    rateLimit: false,
  },
);

async function listBlindBoxes(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
) {
  const limit = parseAdminLimit(queryInput.limit);
  const offset = parseOffsetCursor(queryInput.cursor);
  const rows = await loadBlindBoxRows(db, queryInput, offset, limit);
  const pageRows = rows.slice(0, limit);
  const boxIds = pageRows.map((box) => box.id);
  const versions = await loadVersionsForBoxes(db, boxIds);
  const activeVersions = versions.filter(
    (version) => version.status === "active",
  );
  const activeVersionByBoxId = new Map(
    activeVersions.map((version) => [version.box_id, version]),
  );
  const versionCountByBoxId = countBy(versions, (version) => version.box_id);
  const itemCountByVersionId = await loadItemCountsByVersionId(
    db,
    activeVersions.map((version) => version.id),
  );
  const priceRulesByBoxId = await loadPriceRulesByBoxId(db, boxIds);

  return {
    items: pageRows.map((box) => {
      const activeVersion = activeVersionByBoxId.get(box.id);
      const activeItemCount = activeVersion
        ? (itemCountByVersionId.get(activeVersion.id) ?? 0)
        : 0;

      return {
        ...mapBlindBoxRow(box, {
          activeVersion: activeVersion
            ? mapDropPoolVersionRow(activeVersion, activeItemCount)
            : null,
          activeItemCount,
          versionCount: versionCountByBoxId.get(box.id) ?? 0,
        }),
        price_rules: priceRulesByBoxId.get(box.id) ?? [],
      };
    }),
    summary: summarizeByStatus(pageRows),
    nextCursor: buildNextCursor(rows.length, limit, offset),
    serverTime: new Date().toISOString(),
  };
}

async function loadBlindBoxRows(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
  offset: number,
  limit: number,
): Promise<BlindBoxRow[]> {
  let query = db.schema("gacha").from("blind_boxes").select(BLIND_BOX_COLUMNS);
  const id = normalizeOptionalQueryUuid(queryInput.id, "id");
  const status = normalizeOptionalEnumQuery(
    queryInput.status,
    "status",
    BOX_STATUS_VALUES,
  );
  const tier = normalizeOptionalEnumQuery(
    queryInput.tier,
    "tier",
    BOX_TIER_VALUES,
  );
  const q = firstQueryValue(queryInput.q);

  if (id) {
    query = query.eq("id", id);
  }

  if (status) {
    query = query.eq("status", status);
  }

  if (tier) {
    query = query.eq("tier", tier);
  }

  if (q) {
    const escaped = escapePostgrestLike(q);
    query = query.or(`slug.ilike.%${escaped}%,display_name.ilike.%${escaped}%`);
  }

  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  assertReadSuccess(
    error,
    "ADMIN_BLIND_BOXES_LOOKUP_FAILED",
    "Failed to load blind boxes.",
  );

  return ((data ?? []) as unknown as BlindBoxRow[]).map((row) => ({
    ...row,
    metadata: sanitizeAdminJson(row.metadata),
  }));
}

async function loadVersionsForBoxes(
  db: SupabaseAdminClient,
  boxIds: string[],
): Promise<DropPoolVersionRow[]> {
  if (boxIds.length === 0) {
    return [];
  }

  const { data, error } = await db
    .schema("gacha")
    .from("drop_pool_versions")
    .select(DROP_POOL_VERSION_COLUMNS)
    .in("box_id", boxIds)
    .order("version_no", { ascending: false });

  assertReadSuccess(
    error,
    "ADMIN_BLIND_BOX_DROP_POOL_VERSIONS_LOOKUP_FAILED",
    "Failed to load blind box drop pool versions.",
  );

  return (data ?? []) as unknown as DropPoolVersionRow[];
}

async function loadItemCountsByVersionId(
  db: SupabaseAdminClient,
  poolVersionIds: string[],
): Promise<Map<string, number>> {
  if (poolVersionIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("gacha")
    .from("drop_pool_items")
    .select(DROP_POOL_ITEM_COLUMNS)
    .in("pool_version_id", poolVersionIds);

  assertReadSuccess(
    error,
    "ADMIN_BLIND_BOX_DROP_POOL_ITEMS_LOOKUP_FAILED",
    "Failed to load active blind box reward counts.",
  );

  return countBy(
    (data ?? []) as unknown as DropPoolItemRow[],
    (item) => item.pool_version_id,
  );
}

async function loadPriceRulesByBoxId(
  db: SupabaseAdminClient,
  boxIds: string[],
): Promise<Map<string, ReturnType<typeof mapBoxPriceRuleRow>[]>> {
  if (boxIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("gacha")
    .from("box_price_rules")
    .select(BOX_PRICE_RULE_COLUMNS)
    .in("box_id", boxIds)
    .order("quantity", { ascending: true })
    .order("created_at", { ascending: true });

  assertReadSuccess(
    error,
    "ADMIN_BOX_PRICE_RULES_LOOKUP_FAILED",
    "Failed to load blind box price rules.",
  );

  const grouped = new Map<string, ReturnType<typeof mapBoxPriceRuleRow>[]>();

  for (const row of (data ?? []) as unknown as BoxPriceRuleRow[]) {
    const mapped = mapBoxPriceRuleRow(row);
    const existing = grouped.get(mapped.box_id) ?? [];
    existing.push(mapped);
    grouped.set(mapped.box_id, existing);
  }

  return grouped;
}

async function upsertBlindBox(input: {
  body: JsonRecord;
  adminUserId: string;
  requestId: string;
  controls: ReturnType<typeof requireGachaWriteControls>;
}) {
  const box = normalizeBlindBoxInput(input.body);

  return await callGachaWriteRpc<DropPoolMutationResult>({
    functionName: "admin_upsert_blind_box",
    requestId: input.requestId,
    args: {
      p_admin_user_id: input.adminUserId,
      p_box_id: box.id,
      p_slug: box.slug,
      p_display_name: box.displayName,
      p_description: box.description,
      p_tier: box.tier,
      p_status: box.status,
      p_price_stars: box.priceStars,
      p_total_stock: box.totalStock,
      p_remaining_stock: box.remainingStock,
      p_open_reward_kcoin: box.openRewardKcoin,
      p_cover_image_url: box.coverImageUrl,
      p_hero_image_url: box.heroImageUrl,
      p_starts_at: box.startsAt,
      p_ends_at: box.endsAt,
      p_sort_order: box.sortOrder,
      p_metadata: box.metadata,
      p_reason: input.controls.reason,
      p_idempotency_key: input.controls.idempotencyKey,
      p_request_context: input.controls.requestContext,
    },
    fallbackCode: "ADMIN_BLIND_BOX_UPSERT_FAILED",
  });
}

async function updateBlindBoxStatus(input: {
  body: JsonRecord;
  adminUserId: string;
  requestId: string;
  controls: ReturnType<typeof requireGachaWriteControls>;
}) {
  const action = normalizeOptionalText(input.body.action) ?? "update_status";

  if (normalizeWriteAction(action) !== "update_status") {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `Unsupported blind box action: ${action}`,
    );
  }

  const boxId = normalizeRequiredQueryUuid(
    input.body.boxId ?? input.body.box_id ?? input.body.id,
    "boxId",
  );
  const status = normalizeEnum(
    input.body.status,
    "status",
    BOX_STATUS_VALUES,
  );

  return await callGachaWriteRpc<DropPoolMutationResult>({
    functionName: "admin_update_box_status",
    requestId: input.requestId,
    args: {
      p_admin_user_id: input.adminUserId,
      p_box_id: boxId,
      p_status: status,
      p_reason: input.controls.reason,
      p_idempotency_key: input.controls.idempotencyKey,
      p_request_context: input.controls.requestContext,
    },
    fallbackCode: "ADMIN_BLIND_BOX_STATUS_UPDATE_FAILED",
  });
}

function normalizeBlindBoxInput(body: JsonRecord): BlindBoxInput {
  const totalStock = normalizeNullableInteger(body.total_stock, "total_stock", {
    min: 0,
  });
  const remainingStock = normalizeNullableInteger(
    body.remaining_stock,
    "remaining_stock",
    { min: 0 },
  );
  const startsAt = normalizeNullableIsoDateTime(body.starts_at, "starts_at");
  const endsAt = normalizeNullableIsoDateTime(body.ends_at, "ends_at");

  if (
    totalStock !== null &&
    remainingStock !== null &&
    remainingStock > totalStock
  ) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "remaining_stock must be <= total_stock",
    );
  }

  assertValidTimeWindow(startsAt, endsAt);

  return {
    id: normalizeOptionalBodyUuid(body.id, "id") ?? null,
    slug: normalizeSlug(body.slug, "slug"),
    displayName: normalizeRequiredText(body.display_name, "display_name"),
    description: normalizeOptionalText(body.description) ?? null,
    tier: normalizeEnum(body.tier, "tier", BOX_TIER_VALUES),
    status: normalizeEnum(body.status, "status", BOX_STATUS_VALUES),
    priceStars: normalizeInteger(body.price_stars, "price_stars", { min: 1 }),
    totalStock,
    remainingStock,
    openRewardKcoin: normalizeInteger(
      body.open_reward_kcoin,
      "open_reward_kcoin",
      { min: 0 },
    ),
    coverImageUrl: normalizeNullableUrl(body.cover_image_url, "cover_image_url"),
    heroImageUrl: normalizeNullableUrl(body.hero_image_url, "hero_image_url"),
    startsAt,
    endsAt,
    sortOrder: normalizeInteger(body.sort_order, "sort_order"),
    metadata: normalizeJsonObject(body.metadata),
  };
}

function mapBoxPriceRuleRow(row: BoxPriceRuleRow) {
  return {
    ...row,
    quantity: Number(row.quantity),
    discount_bps: Number(row.discount_bps),
    price_stars_override:
      row.price_stars_override === null
        ? null
        : Number(row.price_stars_override),
    metadata: sanitizeAdminJson(row.metadata),
  };
}

function countBy<T>(
  rows: T[],
  getKey: (row: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = getKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function normalizeWriteAction(value: string): string {
  return value
    .trim()
    .replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function normalizeSlug(value: unknown, field: string): string {
  const normalized = normalizeRequiredText(value, field);

  if (!/^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/.test(normalized)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must start and end with a lowercase letter or number and contain only lowercase letters, numbers, _, or -`,
    );
  }

  return normalized;
}

function normalizeNullableUrl(value: unknown, field: string): string | null {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be a URL`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must use http or https`,
    );
  }

  return normalized;
}

function normalizeNullableIsoDateTime(
  value: unknown,
  field: string,
): string | null {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  const time = Date.parse(normalized);

  if (!Number.isFinite(time)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a valid ISO datetime`,
    );
  }

  return new Date(time).toISOString();
}

function assertValidTimeWindow(
  startsAt: string | null,
  endsAt: string | null,
): void {
  if (!startsAt || !endsAt) {
    return;
  }

  if (Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "starts_at must be before ends_at",
    );
  }
}

function normalizeNullableInteger(
  value: unknown,
  field: string,
  bounds: { min?: number; max?: number } = {},
): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return normalizeInteger(value, field, bounds);
}

function normalizeInteger(
  value: unknown,
  field: string,
  bounds: { min?: number; max?: number } = {},
): number {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isInteger(normalized)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be an integer`);
  }

  if (bounds.min !== undefined && normalized < bounds.min) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be >= ${bounds.min}`,
    );
  }

  if (bounds.max !== undefined && normalized > bounds.max) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be <= ${bounds.max}`,
    );
  }

  return normalized;
}

function normalizeJsonObject(value: unknown): ReturnType<typeof toJsonObject> {
  return toJsonObject(isRecord(value) ? value : {});
}

function escapePostgrestLike(value: string): string {
  return value.replace(/[%*,()]/g, "");
}
