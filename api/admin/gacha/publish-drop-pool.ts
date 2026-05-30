import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  DROP_POOL_ITEM_COLUMNS,
  DROP_POOL_VERSION_COLUMNS,
  GACHA_WRITE_PERMISSIONS,
  assertReadSuccess,
  buildApprovalContext,
  callGachaWriteRpc,
  normalizeDropPoolItemsInput,
  normalizeOptionalBodyUuid,
  readGachaWriteBody,
  requireGachaWriteControls,
  toDropPoolItemsRpcPayload,
  type DropPoolItemRow,
  type DropPoolMutationResult,
  type DropPoolVersionRow,
} from "./_shared.js";
import { normalizeRequiredUuid } from "../_shared.js";

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: GACHA_WRITE_PERMISSIONS,
      requireAll: false,
    });
    const body = await readGachaWriteBody(req);
    const controls = requireGachaWriteControls(req, body, admin, ctx);
    const payload = await buildPublishPayload(getSupabaseAdminClient(), body);

    return await callGachaWriteRpc<DropPoolMutationResult>({
      functionName: "admin_publish_drop_pool_version",
      requestId: ctx.requestId,
      args: {
        p_admin_user_id: admin.adminId,
        p_box_id: payload.boxId,
        p_items: payload.items,
        p_reason: controls.reason,
        p_idempotency_key: controls.idempotencyKey,
        p_request_context: controls.requestContext,
        p_approval_context: buildApprovalContext(body.approvalContext),
      },
      fallbackCode: "ADMIN_DROP_POOL_PUBLISH_FAILED",
    });
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

async function buildPublishPayload(
  db: SupabaseAdminClient,
  body: Record<string, unknown>,
): Promise<{
  boxId: string;
  items: ReturnType<typeof normalizeDropPoolItemsInput>;
}> {
  const dropPoolVersionId = normalizeOptionalBodyUuid(
    body.dropPoolVersionId ??
      body.drop_pool_version_id ??
      body.poolVersionId ??
      body.pool_version_id,
    "dropPoolVersionId",
  );

  if (dropPoolVersionId) {
    const version = await loadDropPoolVersion(db, dropPoolVersionId);
    const items = await loadDropPoolItems(db, dropPoolVersionId);

    if (items.length === 0) {
      throw new ApiError(
        400,
        "ADMIN_DROP_POOL_ITEMS_REQUIRED",
        "Drop pool version has no items to publish.",
      );
    }

    return {
      boxId: version.box_id,
      items: toDropPoolItemsRpcPayload(items),
    };
  }

  return {
    boxId: normalizeRequiredUuid(body.boxId ?? body.box_id, "boxId"),
    items: normalizeDropPoolItemsInput(body.items),
  };
}

async function loadDropPoolVersion(
  db: SupabaseAdminClient,
  dropPoolVersionId: string,
): Promise<DropPoolVersionRow> {
  const { data, error } = await db
    .schema("gacha")
    .from("drop_pool_versions")
    .select(DROP_POOL_VERSION_COLUMNS)
    .eq("id", dropPoolVersionId)
    .limit(1);

  assertReadSuccess(
    error,
    "ADMIN_GACHA_DROP_POOL_VERSION_LOOKUP_FAILED",
    "Failed to load drop pool version for publish.",
  );

  const version = ((data ?? []) as unknown as DropPoolVersionRow[])[0];

  if (!version) {
    throw new ApiError(
      404,
      "ADMIN_DROP_POOL_VERSION_NOT_FOUND",
      "Drop pool version not found.",
    );
  }

  return version;
}

async function loadDropPoolItems(
  db: SupabaseAdminClient,
  dropPoolVersionId: string,
): Promise<DropPoolItemRow[]> {
  const { data, error } = await db
    .schema("gacha")
    .from("drop_pool_items")
    .select(DROP_POOL_ITEM_COLUMNS)
    .eq("pool_version_id", dropPoolVersionId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  assertReadSuccess(
    error,
    "ADMIN_GACHA_DROP_POOL_ITEMS_LOOKUP_FAILED",
    "Failed to load drop pool items for publish.",
  );

  return (data ?? []) as unknown as DropPoolItemRow[];
}
