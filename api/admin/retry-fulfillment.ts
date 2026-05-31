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

type RetryFulfillmentRpcResult = {
  star_order_id: string;
  status: string;
  previous_status?: string;
  fulfilled?: boolean;
  fulfillment_status?: string | null;
  reason_code?: string | null;
  retryable?: string | null;
  payment_order_status?: string | null;
  draw_order_id?: string | null;
  result_count?: string | number | null;
  idempotent?: boolean;
  audit_log_id?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["payments:write", "payments:retry"],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const starOrderId = normalizeRequiredUuid(
      body.starOrderId ?? body.star_order_id,
      "starOrderId",
    );
    const reason = normalizeRequiredText(body.reason, "reason");

    try {
      const result = await callAdminWriteRpc<RetryFulfillmentRpcResult>({
        functionName: "admin_retry_payment_fulfillment",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_star_order_id: starOrderId,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_request_context: buildAdminRpcContext(admin, ctx),
        },
      });

      return {
        ...result,
        serverTime: new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_RETRY_FULFILLMENT_FAILED");
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);
