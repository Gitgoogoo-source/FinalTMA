import { parseJsonBody } from "../../_shared/parseBody.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  isRecord,
  mapAdminRpcError,
  normalizeRequiredText,
  normalizeRequiredUuid,
  readHeaderIdempotencyKey,
  requireAdminConfirmHeader,
} from "../_shared.js";

type ForceCancelMarketListingRpcResult = Record<string, unknown> & {
  audit_log_id: string;
  risk_event_id: string;
  server_time?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["market:write", "admin:write"],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    requireAdminConfirmHeader(req);

    const idempotencyKey = readHeaderIdempotencyKey(req);
    const listingId = normalizeRequiredUuid(
      body.listingId ?? body.listing_id,
      "listingId",
    );
    const reason = normalizeRequiredText(body.reason, "reason");

    try {
      const result = await callAdminWriteRpc<ForceCancelMarketListingRpcResult>(
        {
          functionName: "admin_force_cancel_market_listing",
          requestId: ctx.requestId,
          args: {
            p_admin_user_id: admin.adminId,
            p_listing_id: listingId,
            p_reason: reason,
            p_idempotency_key: idempotencyKey,
            p_request_context: buildAdminRpcContext(admin, ctx),
          },
        },
      );

      assertRiskEventResult(result);

      return {
        ...result,
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_FORCE_CANCEL_MARKET_LISTING_FAILED");
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function assertRiskEventResult(
  value: unknown,
): asserts value is ForceCancelMarketListingRpcResult {
  if (
    !isRecord(value) ||
    typeof value.risk_event_id !== "string" ||
    value.risk_event_id.trim().length === 0
  ) {
    throw new ApiError(
      500,
      "ADMIN_RISK_EVENT_REQUIRED",
      "Admin force-cancel listing RPC did not return risk_event_id.",
      {
        details: { functionName: "admin_force_cancel_market_listing" },
        expose: false,
      },
    );
  }
}
