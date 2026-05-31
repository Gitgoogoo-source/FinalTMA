import { parseJsonBody } from "../../_shared/parseBody.js";
import { withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  mapAdminRpcError,
  normalizeRequiredText,
  normalizeRequiredUuid,
  readHeaderIdempotencyKey,
  requireAdminConfirmHeader,
} from "../_shared.js";
import {
  normalizeJsonMetadata,
  normalizeOptionalIsoDateTime,
  normalizeUserFlagLevel,
} from "./_shared.js";

type ApplyUserFlagRpcResult = Record<string, unknown> & {
  server_time?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["risk:write", "admin:write"],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    requireAdminConfirmHeader(req);

    const idempotencyKey = readHeaderIdempotencyKey(req);
    const userId = normalizeRequiredUuid(body.userId ?? body.user_id, "userId");
    const flagCode = normalizeRequiredText(
      body.flagCode ?? body.flag_code,
      "flagCode",
    );
    const flagLevel = normalizeUserFlagLevel(body.flagLevel ?? body.flag_level);
    const reason = normalizeRequiredText(body.reason, "reason");
    const endsAt = normalizeOptionalIsoDateTime(
      body.endsAt ?? body.ends_at,
      "endsAt",
    );
    const metadata = normalizeJsonMetadata(body.metadata);

    try {
      const result = await callAdminWriteRpc<ApplyUserFlagRpcResult>({
        functionName: "admin_apply_user_flag",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_user_id: userId,
          p_flag_code: flagCode,
          p_flag_level: flagLevel,
          p_reason: reason,
          p_ends_at: endsAt,
          p_idempotency_key: idempotencyKey,
          p_request_context: buildAdminRpcContext(admin, ctx),
          p_metadata: metadata,
        },
      });

      return {
        ...result,
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_APPLY_USER_FLAG_FAILED");
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);
