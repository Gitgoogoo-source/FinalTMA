import { parseJsonBody } from "../../_shared/parseBody.js";
import { withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  mapAdminRpcError,
  normalizeOptionalText,
  normalizeRequiredText,
  readHeaderIdempotencyKey,
  requireAdminConfirmHeader,
  toJsonObject,
} from "../_shared.js";
import {
  normalizeResolveRiskStatus,
  normalizeRiskEventId,
  sanitizeRiskDetail,
} from "./_shared.js";

type ResolveRiskEventRpcResult = Record<string, unknown> & {
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
    const riskEventId = normalizeRiskEventId(
      body.riskEventId ?? body.risk_event_id ?? body.eventId ?? body.id,
    );
    const status = normalizeResolveRiskStatus(body.status);
    const reason = normalizeRequiredText(body.reason, "reason");
    const resolutionDetail = buildResolutionDetail(body);

    try {
      const result = await callAdminWriteRpc<ResolveRiskEventRpcResult>({
        functionName: "admin_resolve_risk_event",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_risk_event_id: riskEventId,
          p_status: status,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_request_context: buildAdminRpcContext(admin, ctx),
          p_resolution_detail: resolutionDetail,
        },
      });

      return {
        ...result,
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_RESOLVE_RISK_EVENT_FAILED");
    }
  },
  {
    methods: ["PATCH", "POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function buildResolutionDetail(body: Record<string, unknown>) {
  const detail = asJsonRecord(
    sanitizeRiskDetail(body.resolutionDetail ?? body.resolution_detail),
  );
  const fixMethod = normalizeOptionalText(body.fixMethod ?? body.fix_method);
  const escalationOwner = normalizeOptionalText(
    body.escalationOwner ?? body.escalation_owner,
  );
  const escalationTicketId = normalizeOptionalText(
    body.escalationTicketId ?? body.escalation_ticket_id,
  );

  if (fixMethod) {
    detail.fix_method = fixMethod;
    detail.fixMethod = fixMethod;
  }

  if (escalationOwner) {
    detail.escalation_owner = escalationOwner;
    detail.escalationOwner = escalationOwner;
  }

  if (escalationTicketId) {
    detail.escalation_ticket_id = escalationTicketId;
    detail.escalationTicketId = escalationTicketId;
  }

  return toJsonObject(detail);
}
