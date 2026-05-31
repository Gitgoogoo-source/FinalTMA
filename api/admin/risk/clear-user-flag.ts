import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { parseJsonBody } from "../../_shared/parseBody.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  mapAdminRpcError,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeUuid,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
} from "../_shared.js";

type ClearUserFlagRpcResult = Record<string, unknown> & {
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

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const userFlagId = normalizeOptionalBodyUuid(
      body.userFlagId ?? body.user_flag_id ?? body.flagId ?? body.flag_id,
      "userFlagId",
    );
    const userId = normalizeOptionalBodyUuid(
      body.userId ?? body.user_id,
      "userId",
    );
    const flagCode = normalizeOptionalText(body.flagCode ?? body.flag_code);
    const reason = normalizeRequiredText(body.reason, "reason");

    if (!userFlagId && (!userId || !flagCode)) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        "Provide userFlagId or userId with flagCode",
      );
    }

    try {
      const result = await callAdminWriteRpc<ClearUserFlagRpcResult>({
        functionName: "admin_clear_user_flag",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_user_flag_id: userFlagId,
          p_user_id: userId,
          p_flag_code: flagCode,
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
      throw mapAdminRpcError(error, "ADMIN_CLEAR_USER_FLAG_FAILED");
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function normalizeOptionalBodyUuid(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const uuid = normalizeUuid(value);

  if (!uuid) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be a UUID`);
  }

  return uuid;
}
