import { parseJsonBody } from "../../_shared/parseBody.js";
import {
  ApiError,
  assertApiRateLimit,
  withApiHandler,
} from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  isRecord,
  mapAdminRpcError,
  normalizeRequiredText,
  readHeaderIdempotencyKey,
  requireAdminConfirmHeader,
} from "../_shared.js";

type MarketStatsRebuildResult = Record<string, unknown> & {
  status?: string | null;
  audit_log_id?: string | null;
  risk_event_id?: string | null;
  server_time?: string | null;
};

export default withApiHandler(
  async (req, res, ctx) => {
    await assertApiRateLimit(req, res, ctx, {
      action: "admin.write",
    });

    const admin = await requireAdmin(req, {
      permissions: ["market:write", "admin:write"],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 16 * 1024 }),
    );

    requireAdminConfirmHeader(req);

    const reason = normalizeRequiredText(body.reason, "reason");
    const idempotencyKey = readHeaderIdempotencyKey(req);

    try {
      const result = await callAdminWriteRpc<MarketStatsRebuildResult>({
        functionName: "admin_rebuild_market_stats",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_request_context: buildAdminRpcContext(admin, ctx),
        },
      });

      assertRiskEventResult(result);

      return {
        ...result,
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_MARKET_STATS_REBUILD_FAILED");
    }
  },
  {
    methods: ["POST"],
    rateLimit: false,
  },
);

function assertRiskEventResult(
  value: unknown,
): asserts value is MarketStatsRebuildResult {
  if (
    !isRecord(value) ||
    typeof value.risk_event_id !== "string" ||
    value.risk_event_id.trim().length === 0
  ) {
    throw new ApiError(
      500,
      "ADMIN_RISK_EVENT_REQUIRED",
      "Admin market stats rebuild RPC did not return risk_event_id.",
      {
        details: { functionName: "admin_rebuild_market_stats" },
        expose: false,
      },
    );
  }
}
