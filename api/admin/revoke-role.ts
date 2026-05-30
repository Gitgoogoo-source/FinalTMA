import { parseJsonBody } from "../_shared/parseBody.js";
import { withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  mapAdminRpcError,
  normalizeRequiredText,
  normalizeRequiredUuid,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
} from "./_shared.js";

type AdminRoleChangeRpcResult = {
  admin_user_id: string;
  role_id?: string;
  audit_log_id?: string;
  idempotent?: boolean;
  server_time?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["admin:write", "roles:write"],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const targetAdminUserId = normalizeRequiredUuid(
      body.adminUserId ?? body.targetAdminUserId,
      "adminUserId",
    );
    const roleId = normalizeRequiredUuid(body.roleId, "roleId");
    const reason = normalizeRequiredText(body.reason, "reason");

    try {
      const result = await callAdminWriteRpc<AdminRoleChangeRpcResult>({
        functionName: "admin_revoke_role",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_target_admin_user_id: targetAdminUserId,
          p_role_id: roleId,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_request_context: buildAdminRpcContext(admin, ctx),
        },
      });

      return {
        ...result,
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_REVOKE_ROLE_FAILED");
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);
