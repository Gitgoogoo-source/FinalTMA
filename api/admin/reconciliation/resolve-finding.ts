import { parseJsonBody } from "../../_shared/parseBody.js";
import { withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  mapAdminRpcError,
  normalizeRequiredText,
  readBodyIdempotencyKey,
  toJsonObject,
} from "../_shared.js";
import {
  normalizeResolveStatus,
  normalizeRiskEventId,
  parseResolutionDetail,
  requireReconciliationConfirmation,
} from "./_shared.js";

type ResolveFindingRpcResult = {
  risk_event_id: string;
  status: string;
  previous_status?: string;
  audit_log_id?: string;
  resolved_at?: string | null;
  server_time?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["risk:write"],
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const findingId = normalizeRiskEventId(
      body.findingId ?? body.finding_id ?? body.riskEventId ?? body.risk_event_id,
    );
    requireReconciliationConfirmation(req, body, findingId);

    const status = normalizeResolveStatus(body.status);
    const reason = normalizeRequiredText(body.reason, "reason");
    const resolutionDetailInput = parseResolutionDetail(
      body.resolutionDetail ?? body.resolution_detail,
    );

    if (body.fixMethod ?? body.fix_method) {
      resolutionDetailInput.fix_method = body.fixMethod ?? body.fix_method;
    }

    if (body.escalationOwner ?? body.escalation_owner) {
      resolutionDetailInput.escalation_owner =
        body.escalationOwner ?? body.escalation_owner;
    }

    if (body.escalationTicketId ?? body.escalation_ticket_id) {
      resolutionDetailInput.ticket_id =
        body.escalationTicketId ?? body.escalation_ticket_id;
    }

    const resolutionDetail = toJsonObject(resolutionDetailInput);

    try {
      const result = await callAdminWriteRpc<ResolveFindingRpcResult>({
        functionName: "admin_resolve_reconciliation_finding",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_risk_event_id: findingId,
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
      throw mapAdminRpcError(
        error,
        "ADMIN_RESOLVE_RECONCILIATION_FINDING_FAILED",
      );
    }
  },
  {
    methods: ["PATCH"],
    rateLimit: {
      action: "admin.write",
    },
  },
);
