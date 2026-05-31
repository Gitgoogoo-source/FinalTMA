import { parseJsonBody } from "../_shared/parseBody.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  isRecord,
  mapAdminRpcError,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeRequiredUuid,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
  toJsonObject,
} from "./_shared.js";

type RefundAssetHandlingStrategy =
  | "keep"
  | "freeze"
  | "reclaim"
  | "manual_review";

type CreateRefundRecordRpcResult = {
  star_order_id: string;
  star_payment_id: string;
  star_refund_id: string;
  status: string;
  order_status?: string | null;
  xtr_amount: number | string;
  refund_context?: Record<string, unknown>;
  external_ticket_id?: string | null;
  asset_handling_strategy?: RefundAssetHandlingStrategy;
  risk_restriction_required?: boolean;
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
    const refundContext = normalizeRefundContext(body);

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
          p_refund_context: refundContext,
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

function normalizeRefundContext(
  body: Record<string, unknown>,
): ReturnType<typeof toJsonObject> {
  const source = isRecord(body.refundContext)
    ? body.refundContext
    : isRecord(body.refund_context)
      ? body.refund_context
      : {};
  const externalRefundCompleted = readBooleanLike(
    source.externalRefundCompleted ??
      source.external_refund_completed ??
      body.externalRefundCompleted ??
      body.external_refund_completed,
    "externalRefundCompleted",
  );

  if (externalRefundCompleted === true) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "create-refund-record cannot mark an external Telegram Stars refund as completed",
    );
  }

  const externalTicketId = normalizeBoundedOptionalText(
    source.externalTicketId ??
      source.external_ticket_id ??
      body.externalTicketId ??
      body.external_ticket_id,
    "externalTicketId",
    256,
  );
  const assetHandlingStrategy = normalizeAssetHandlingStrategy(
    source.assetHandlingStrategy ??
      source.asset_handling_strategy ??
      body.assetHandlingStrategy ??
      body.asset_handling_strategy,
  );
  const assetHandlingNote = normalizeBoundedOptionalText(
    source.assetHandlingNote ??
      source.asset_handling_note ??
      body.assetHandlingNote ??
      body.asset_handling_note,
    "assetHandlingNote",
    1000,
  );
  const riskRestrictionRequired =
    readBooleanLike(
      source.riskRestrictionRequired ??
        source.risk_restriction_required ??
        source.riskRestriction ??
        body.riskRestrictionRequired ??
        body.risk_restriction_required ??
        body.riskRestriction,
      "riskRestrictionRequired",
    ) ?? false;
  const riskRestrictionReason = normalizeBoundedOptionalText(
    source.riskRestrictionReason ??
      source.risk_restriction_reason ??
      body.riskRestrictionReason ??
      body.risk_restriction_reason,
    "riskRestrictionReason",
    1000,
  );

  if (riskRestrictionRequired && !riskRestrictionReason) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "riskRestrictionReason is required when riskRestrictionRequired is true",
    );
  }

  return toJsonObject({
    external_ticket_id: externalTicketId ?? null,
    asset_handling_strategy: assetHandlingStrategy,
    asset_handling_note: assetHandlingNote ?? null,
    risk_restriction_required: riskRestrictionRequired,
    risk_restriction_reason: riskRestrictionReason ?? null,
    external_refund_completed: false,
  });
}

function normalizeAssetHandlingStrategy(
  value: unknown,
): RefundAssetHandlingStrategy {
  const raw = normalizeOptionalText(value)?.toLowerCase() ?? "manual_review";
  const strategy =
    raw === "retain" ? "keep" : raw === "manual" ? "manual_review" : raw;

  if (
    strategy === "keep" ||
    strategy === "freeze" ||
    strategy === "reclaim" ||
    strategy === "manual_review"
  ) {
    return strategy;
  }

  throw new ApiError(
    400,
    "VALIDATION_FAILED",
    "assetHandlingStrategy must be one of keep, freeze, reclaim, manual_review",
  );
}

function normalizeBoundedOptionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | undefined {
  const normalized = normalizeOptionalText(value);

  if (normalized && normalized.length > maxLength) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be ${maxLength} characters or fewer`,
    );
  }

  return normalized;
}

function readBooleanLike(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  throw new ApiError(400, "VALIDATION_FAILED", `${field} must be boolean`);
}
