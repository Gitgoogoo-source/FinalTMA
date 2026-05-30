import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../../packages/server/src/db/supabaseAdmin.js";
import {
  ApiError,
  assertApiRateLimit,
  withApiHandler,
} from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import type { JsonValue } from "../../../packages/server/src/db/transactions.js";
import {
  DROP_POOL_ITEM_COLUMNS,
  DROP_POOL_STATUS_VALUES,
  DROP_POOL_VERSION_COLUMNS,
  GACHA_READ_PERMISSIONS,
  GACHA_WRITE_PERMISSIONS,
  assertReadSuccess,
  callGachaWriteRpc,
  normalizeDropPoolItemsInput,
  normalizeOptionalBodyUuid,
  normalizeOptionalEnumQuery,
  normalizeOptionalQueryUuid,
  normalizePityRulesInput,
  normalizeRequiredQueryUuid,
  normalizeWriteAction,
  mapDropPoolVersionRow,
  readGachaWriteBody,
  requireGachaWriteControls,
  summarizeByStatus,
  type DropPoolItemRow,
  type DropPoolMutationResult,
  type DropPoolVersionRow,
} from "./_shared.js";
import {
  buildNextCursor,
  normalizeOptionalText,
  parseAdminLimit,
  parseOffsetCursor,
} from "../_shared.js";

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

      return await listDropPoolVersions(getSupabaseAdminClient(), req.query);
    }

    const admin = await requireAdmin(req, {
      permissions: GACHA_WRITE_PERMISSIONS,
      requireAll: false,
    });
    const body = await readGachaWriteBody(req);
    const controls = requireGachaWriteControls(req, body, admin, ctx);

    if (ctx.method === "POST") {
      return await saveDropPoolDraft({
        body,
        adminUserId: admin.adminId,
        controls,
        requestId: ctx.requestId,
      });
    }

    if (ctx.method === "PATCH") {
      return await runDropPoolVersionAction({
        body,
        adminUserId: admin.adminId,
        controls,
        requestId: ctx.requestId,
      });
    }

    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Method is not allowed");
  },
  {
    methods: ["GET", "POST", "PATCH"],
    rateLimit: false,
  },
);

async function listDropPoolVersions(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
) {
  const limit = parseAdminLimit(queryInput.limit);
  const offset = parseOffsetCursor(queryInput.cursor);
  const boxId = normalizeOptionalQueryUuid(
    queryInput.boxId ?? queryInput.box_id,
    "boxId",
  );
  const versionId = normalizeOptionalQueryUuid(
    queryInput.dropPoolVersionId ?? queryInput.poolVersionId ?? queryInput.id,
    "dropPoolVersionId",
  );
  const status = normalizeOptionalEnumQuery(
    queryInput.status,
    "status",
    DROP_POOL_STATUS_VALUES,
  );
  let query = db
    .schema("gacha")
    .from("drop_pool_versions")
    .select(DROP_POOL_VERSION_COLUMNS);

  if (boxId) {
    query = query.eq("box_id", boxId);
  }

  if (versionId) {
    query = query.eq("id", versionId);
  }

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query
    .order("version_no", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  assertReadSuccess(
    error,
    "ADMIN_GACHA_DROP_POOL_VERSIONS_LOOKUP_FAILED",
    "Failed to load drop pool versions.",
  );

  const rows = (data ?? []) as unknown as DropPoolVersionRow[];
  const pageRows = rows.slice(0, limit);
  const itemCounts = await loadItemCountsByVersionId(
    db,
    pageRows.map((row) => row.id),
  );
  const activeVersion = boxId ? await loadActiveVersion(db, boxId) : null;
  const activeItemCount = activeVersion
    ? ((await loadItemCountsByVersionId(db, [activeVersion.id])).get(
        activeVersion.id,
      ) ?? 0)
    : 0;

  return {
    items: pageRows.map((row) =>
      mapDropPoolVersionRow(row, itemCounts.get(row.id) ?? 0),
    ),
    activeVersion: activeVersion
      ? mapDropPoolVersionRow(activeVersion, activeItemCount)
      : null,
    summary: summarizeByStatus(pageRows),
    nextCursor: buildNextCursor(rows.length, limit, offset),
    serverTime: new Date().toISOString(),
  };
}

async function saveDropPoolDraft(input: {
  body: Record<string, unknown>;
  adminUserId: string;
  controls: ReturnType<typeof requireGachaWriteControls>;
  requestId: string;
}) {
  const boxId = normalizeRequiredQueryUuid(
    input.body.boxId ?? input.body.box_id,
    "boxId",
  );
  const dropPoolVersionId = normalizeOptionalBodyUuid(
    input.body.dropPoolVersionId ??
      input.body.drop_pool_version_id ??
      input.body.poolVersionId,
    "dropPoolVersionId",
  );
  const sourceVersionId = normalizeOptionalBodyUuid(
    input.body.sourceVersionId ??
      input.body.source_version_id ??
      input.body.cloneFromVersionId,
    "sourceVersionId",
  );
  const versionName = normalizeOptionalText(
    input.body.versionName ?? input.body.version_name,
  );
  const hasItems = input.body.items !== undefined && input.body.items !== null;
  const hasPityRules =
    input.body.pityRules !== undefined || input.body.pity_rules !== undefined;
  const items = hasItems
    ? normalizeDropPoolItemsInput(input.body.items)
    : undefined;
  const pityRules = hasPityRules
    ? normalizePityRulesInput(input.body.pityRules ?? input.body.pity_rules)
    : undefined;

  if (dropPoolVersionId) {
    await assertDropPoolVersionEditable(
      getSupabaseAdminClient(),
      dropPoolVersionId,
    );

    if (!items) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        "items must be an array when updating a drop pool draft",
      );
    }
  }

  const functionName = dropPoolVersionId
    ? "admin_update_drop_pool_item"
    : "admin_create_drop_pool_draft";
  const args: Record<string, JsonValue | undefined> = dropPoolVersionId
    ? {
        p_admin_user_id: input.adminUserId,
        p_drop_pool_version_id: dropPoolVersionId,
        p_box_id: boxId,
        p_version_name: versionName ?? null,
        p_items: items,
        p_pity_rules: pityRules ?? [],
        p_reason: input.controls.reason,
        p_idempotency_key: input.controls.idempotencyKey,
        p_request_context: input.controls.requestContext,
      }
    : {
        p_admin_user_id: input.adminUserId,
        p_box_id: boxId,
        p_source_version_id: sourceVersionId ?? null,
        p_version_name: versionName ?? null,
        p_items: items ?? null,
        p_pity_rules: pityRules ?? null,
        p_reason: input.controls.reason,
        p_idempotency_key: input.controls.idempotencyKey,
        p_request_context: input.controls.requestContext,
      };

  return await callGachaWriteRpc<DropPoolMutationResult>({
    functionName,
    requestId: input.requestId,
    args,
    fallbackCode: "ADMIN_DROP_POOL_DRAFT_SAVE_FAILED",
  });
}

async function assertDropPoolVersionEditable(
  db: SupabaseAdminClient,
  dropPoolVersionId: string,
): Promise<void> {
  const { data, error } = await db
    .schema("gacha")
    .from("drop_pool_versions")
    .select("id,status")
    .eq("id", dropPoolVersionId)
    .limit(1);

  assertReadSuccess(
    error,
    "ADMIN_GACHA_DROP_POOL_VERSION_LOOKUP_FAILED",
    "Failed to load drop pool version.",
  );

  const version = ((data ?? []) as Array<{ id: string; status: string }>)[0];

  if (!version) {
    throw new ApiError(
      404,
      "ADMIN_DROP_POOL_VERSION_NOT_FOUND",
      "Drop pool version was not found",
    );
  }

  if (version.status !== "draft") {
    throw new ApiError(
      409,
      "ADMIN_DROP_POOL_VERSION_NOT_EDITABLE",
      "Only draft drop pool versions can be edited. Clone a published version into a new draft first.",
      {
        details: {
          dropPoolVersionId,
          status: version.status,
        },
      },
    );
  }
}

async function runDropPoolVersionAction(input: {
  body: Record<string, unknown>;
  adminUserId: string;
  controls: ReturnType<typeof requireGachaWriteControls>;
  requestId: string;
}) {
  const action = normalizeWriteAction(input.body.action);
  const dropPoolVersionId = normalizeRequiredQueryUuid(
    input.body.dropPoolVersionId ??
      input.body.drop_pool_version_id ??
      input.body.poolVersionId,
    "dropPoolVersionId",
  );
  const commonArgs = {
    p_admin_user_id: input.adminUserId,
    p_drop_pool_version_id: dropPoolVersionId,
    p_reason: input.controls.reason,
    p_idempotency_key: input.controls.idempotencyKey,
    p_request_context: input.controls.requestContext,
  };

  if (action === "validate") {
    return await callGachaWriteRpc<DropPoolMutationResult>({
      functionName: "admin_validate_drop_pool",
      requestId: input.requestId,
      args: commonArgs,
      fallbackCode: "ADMIN_DROP_POOL_VALIDATE_FAILED",
    });
  }

  return await callGachaWriteRpc<DropPoolMutationResult>({
    functionName: "admin_archive_drop_pool_version",
    requestId: input.requestId,
    args: commonArgs,
    fallbackCode: "ADMIN_DROP_POOL_ARCHIVE_FAILED",
  });
}

async function loadActiveVersion(
  db: SupabaseAdminClient,
  boxId: string,
): Promise<DropPoolVersionRow | null> {
  const { data, error } = await db
    .schema("gacha")
    .from("drop_pool_versions")
    .select(DROP_POOL_VERSION_COLUMNS)
    .eq("box_id", boxId)
    .eq("status", "active")
    .limit(1);

  assertReadSuccess(
    error,
    "ADMIN_GACHA_ACTIVE_DROP_POOL_LOOKUP_FAILED",
    "Failed to load active drop pool version.",
  );

  return ((data ?? []) as unknown as DropPoolVersionRow[])[0] ?? null;
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
    "Failed to load drop pool item counts.",
  );

  const counts = new Map<string, number>();

  for (const item of (data ?? []) as unknown as DropPoolItemRow[]) {
    counts.set(
      item.pool_version_id,
      (counts.get(item.pool_version_id) ?? 0) + 1,
    );
  }

  return counts;
}
