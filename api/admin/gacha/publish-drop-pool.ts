import { withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  GACHA_WRITE_PERMISSIONS,
  buildApprovalContext,
  callGachaWriteRpc,
  readGachaWriteBody,
  requireGachaWriteControls,
  type DropPoolMutationResult,
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
    const dropPoolVersionId = normalizeRequiredUuid(
      body.dropPoolVersionId ??
        body.drop_pool_version_id ??
        body.poolVersionId ??
        body.pool_version_id,
      "dropPoolVersionId",
    );

    return await callGachaWriteRpc<DropPoolMutationResult>({
      functionName: "admin_publish_drop_pool_version",
      requestId: ctx.requestId,
      args: {
        p_admin_user_id: admin.adminId,
        p_drop_pool_version_id: dropPoolVersionId,
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
