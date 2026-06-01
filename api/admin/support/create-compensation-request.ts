import { parseJsonBody } from "../../_shared/parseBody.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  isRecord,
  mapAdminRpcError,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeRequiredUuid,
  readHeaderIdempotencyKey,
  requireAdminConfirmHeader,
  toJsonObject,
} from "../_shared.js";

type CompensationRpcResult = Record<string, unknown> & {
  server_time?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["support:write", "users:compensate", "admin:write"],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 64 * 1024 }),
    );

    requireAdminConfirmHeader(req);

    const idempotencyKey = readHeaderIdempotencyKey(req);
    const targetUserId = normalizeRequiredUuid(
      body.targetUserId ?? body.target_user_id ?? body.userId ?? body.user_id,
      "targetUserId",
    );
    const compensationType = normalizeRequiredText(
      body.compensationType ?? body.compensation_type,
      "compensationType",
    );
    const reason = normalizeRequiredText(body.reason, "reason");
    const currencyCode = normalizeOptionalText(
      body.currencyCode ?? body.currency_code,
    );
    const amount = normalizeOptionalNumber(body.amount, "amount");
    const itemTemplateId = normalizeOptionalUuid(
      body.itemTemplateId ?? body.item_template_id,
      "itemTemplateId",
    );
    const requestContext = toJsonObject({
      ...normalizeMetadata(body.requestContext ?? body.request_context),
      metadata: normalizeMetadata(body.metadata),
      approval_context: normalizeMetadata(
        body.approvalContext ?? body.approval_context,
      ),
      ticket_id: normalizeOptionalText(body.ticketId ?? body.ticket_id) ?? null,
      item_form_id:
        normalizeOptionalText(body.itemFormId ?? body.item_form_id) ?? null,
      source_type:
        normalizeOptionalText(body.sourceType ?? body.source_type) ?? null,
      source_id: normalizeOptionalText(body.sourceId ?? body.source_id) ?? null,
      source_task_progress_id:
        normalizeOptionalText(
          body.sourceTaskProgressId ?? body.source_task_progress_id,
        ) ?? null,
      source_task_id:
        normalizeOptionalText(body.sourceTaskId ?? body.source_task_id) ?? null,
      source_task_period_key:
        normalizeOptionalText(
          body.sourceTaskPeriodKey ?? body.source_task_period_key,
        ) ?? null,
      source_draw_order_id:
        normalizeOptionalText(
          body.sourceDrawOrderId ?? body.source_draw_order_id,
        ) ?? null,
      source_star_order_id:
        normalizeOptionalText(
          body.sourceStarOrderId ?? body.source_star_order_id,
        ) ?? null,
      title:
        normalizeOptionalText(
          body.notificationTitle ?? body.notification_title,
        ) ?? null,
      body:
        normalizeOptionalText(
          body.notificationBody ?? body.notification_body,
        ) ?? null,
      preview: normalizeMetadata(
        body.preview ?? body.impactPreview ?? body.impact_preview,
      ),
      ...buildAdminRpcContext(admin, ctx),
    });

    try {
      const result = await callAdminWriteRpc<CompensationRpcResult>({
        functionName: "admin_compensate_user",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_target_user_id: targetUserId,
          p_compensation_type: compensationType,
          p_currency_code: currencyCode,
          p_amount: amount,
          p_item_template_id: itemTemplateId,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_request_context: requestContext,
        },
      });

      return {
        ...result,
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_COMPENSATE_USER_FAILED");
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function normalizeOptionalNumber(
  value: unknown,
  field: string,
): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numberValue)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be a number`);
  }

  return numberValue;
}

function normalizeOptionalUuid(
  value: unknown,
  field: string,
): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return normalizeRequiredUuid(value, field);
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
