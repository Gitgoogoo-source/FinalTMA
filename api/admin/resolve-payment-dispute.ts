import { parseJsonBody } from "../_shared/parseBody.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  isRecord,
  mapAdminRpcError,
  normalizeRequiredText,
  normalizeRequiredUuid,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
  toJsonObject,
} from "./_shared.js";

type ResolvePaymentDisputeRpcResult = {
  dispute_id: string;
  star_order_id?: string | null;
  star_payment_id?: string | null;
  status: string;
  resolution: string;
  order_status?: string | null;
  audit_log_id?: string;
  server_time?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: "payments:write",
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const disputeId = normalizeRequiredUuid(
      body.disputeId ?? body.dispute_id,
      "disputeId",
    );
    const resolution = normalizeRequiredText(body.resolution, "resolution");
    const status = normalizeDisputeStatus(body.status);
    const reason = normalizeRequiredText(body.reason, "reason");
    const approvalContext = toJsonObject(
      isRecord(body.approvalContext) ? body.approvalContext : {},
    );

    try {
      const result = await callAdminWriteRpc<ResolvePaymentDisputeRpcResult>({
        functionName: "admin_resolve_payment_dispute",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_dispute_id: disputeId,
          p_resolution: resolution,
          p_status: status,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_request_context: buildAdminRpcContext(admin, ctx),
          p_approval_context: approvalContext,
        },
      });

      return {
        ...result,
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_RESOLVE_PAYMENT_DISPUTE_FAILED");
    }
  },
  {
    methods: ["POST", "PATCH"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function normalizeDisputeStatus(value: unknown): string {
  const status = normalizeRequiredText(value, "status").toLowerCase();

  if (
    status === "open" ||
    status === "investigating" ||
    status === "resolved" ||
    status === "rejected"
  ) {
    return status;
  }

  throw new ApiError(
    400,
    "VALIDATION_FAILED",
    "status must be one of open, investigating, resolved, rejected",
  );
}
