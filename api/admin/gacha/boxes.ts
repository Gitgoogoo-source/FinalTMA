import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  BLIND_BOX_COLUMNS,
  BOX_STATUS_VALUES,
  BOX_TIER_VALUES,
  DROP_POOL_ITEM_COLUMNS,
  DROP_POOL_VERSION_COLUMNS,
  GACHA_READ_PERMISSIONS,
  assertReadSuccess,
  mapBlindBoxRow,
  mapDropPoolVersionRow,
  normalizeOptionalEnumQuery,
  normalizeOptionalQueryUuid,
  sanitizeAdminJson,
  summarizeByStatus,
  type BlindBoxRow,
  type DropPoolItemRow,
  type DropPoolVersionRow,
} from "./_shared.js";
import {
  buildNextCursor,
  firstQueryValue,
  parseAdminLimit,
  parseOffsetCursor,
} from "../_shared.js";

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: GACHA_READ_PERMISSIONS,
      requireAll: false,
    });

    const db = getSupabaseAdminClient();
    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const rows = await listBlindBoxes(db, req.query, offset, limit);
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

    return {
      items: pageRows.map((box) => {
        const activeVersion = activeVersionByBoxId.get(box.id);
        const activeItemCount = activeVersion
          ? (itemCountByVersionId.get(activeVersion.id) ?? 0)
          : 0;

        return mapBlindBoxRow(box, {
          activeVersion: activeVersion
            ? mapDropPoolVersionRow(activeVersion, activeItemCount)
            : null,
          activeItemCount,
          versionCount: versionCountByBoxId.get(box.id) ?? 0,
        });
      }),
      summary: summarizeByStatus(pageRows),
      nextCursor: buildNextCursor(rows.length, limit, offset),
      serverTime: new Date().toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);

async function listBlindBoxes(
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
    query = query.or(
      `slug.ilike.%${escapePostgrestLike(q)}%,display_name.ilike.%${escapePostgrestLike(q)}%`,
    );
  }

  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  assertReadSuccess(
    error,
    "ADMIN_GACHA_BOXES_LOOKUP_FAILED",
    "Failed to load gacha boxes.",
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
    "ADMIN_GACHA_DROP_POOL_VERSIONS_LOOKUP_FAILED",
    "Failed to load drop pool versions.",
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
    "ADMIN_GACHA_DROP_POOL_ITEMS_LOOKUP_FAILED",
    "Failed to load active drop pool item counts.",
  );

  return countBy(
    (data ?? []) as unknown as DropPoolItemRow[],
    (item) => item.pool_version_id,
  );
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

function escapePostgrestLike(value: string): string {
  return value.replace(/[%*,()]/g, "");
}
