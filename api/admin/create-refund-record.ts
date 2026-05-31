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

type CreateRefundRecordRpcResult = {
  star_order_id: string;
  star_payment_id: string;
  star_refund_id: string;
  status: string;
  order_status?: string | null;
  xtr_amount: number | string;
  external_refund_completed?: boolean;
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
    const starPaymentId = normalizeRequiredUuid(
      body.starPaymentId ?? body.star_payment_id,
      "starPaymentId",
    );
    const starOrderId = normalizeRequiredUuid(
      body.starOrderId ?? body.star_order_id,
      "starOrderId",
    );
    const reason = normalizeRequiredText(body.reason, "reason");
    const xtrAmount = normalizePositiveInteger(
      body.xtrAmount ?? body.xtr_amount,
      "xtrAmount",
    );
    const status = normalizeRefundStatus(body.status);
    const approvalContext = toJsonObject(
      isRecord(body.approvalContext) ? body.approvalContext : {},
    );

    try {
      const result = await callAdminWriteRpc<CreateRefundRecordRpcResult>({
        functionName: "admin_create_refund_record",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_star_payment_id: starPaymentId,
          p_star_order_id: starOrderId,
          p_reason: reason,
          p_xtr_amount: xtrAmount,
          p_status: status,
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
      throw mapAdminRpcError(error, "ADMIN_CREATE_REFUND_RECORD_FAILED");
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function normalizeRefundStatus(value: unknown): string {
  const status = normalizeRequiredText(value, "status").toLowerCase();

  if (
    status === "requested" ||
    status === "processing" ||
    status === "completed" ||
    status === "rejected" ||
    status === "failed"
  ) {
    return status;
  }

  throw new ApiError(
    400,
    "VALIDATION_FAILED",
    "status must be one of requested, processing, completed, rejected, failed",
  );
}

function normalizePositiveInteger(value: unknown, field: string): number {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a positive integer`,
    );
  }

  return amount;
}
