import { parseJsonBody } from "../_shared/parseBody.js";
import { withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  loadMonitoringThresholds,
  normalizeMonitoringThresholds,
} from "../_shared/monitoringThresholds.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  mapAdminRpcError,
  normalizeRequiredText,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
} from "./_shared.js";

type MonitoringThresholdMutationResult = Record<string, unknown> & {
  audit_log_id?: string | null;
  server_time?: string;
  thresholds?: unknown;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    if (ctx.method === "GET") {
      const admin = await requireAdmin(req, {
        permissions: ["admin:read", "ops:read"],
        requireAll: false,
      });

      const config = await loadMonitoringThresholds({
        adminUserId: admin.adminId,
        requestContext: buildAdminRpcContext(admin, ctx),
        requestId: ctx.requestId,
      });

      return {
        key: "monitoring.thresholds",
        thresholds: config.thresholds,
        updatedAt: config.updatedAt,
        source: config.source,
        serverTime: new Date().toISOString(),
      };
    }

    const admin = await requireAdmin(req, {
      permissions: ["admin:write", "ops:write"],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const reason = normalizeRequiredText(body.reason, "reason");
    const current = await loadMonitoringThresholds({
      adminUserId: admin.adminId,
      requestContext: buildAdminRpcContext(admin, ctx),
      requestId: ctx.requestId,
    });
    const thresholdsInput =
      body.thresholds ?? body.value ?? body.monitoringThresholds ?? body;
    const thresholds = normalizeMonitoringThresholds(
      thresholdsInput,
      current.thresholds,
    );

    try {
      const result = await callAdminWriteRpc<MonitoringThresholdMutationResult>(
        {
          functionName: "admin_update_monitoring_thresholds",
          requestId: ctx.requestId,
          args: {
            p_admin_user_id: admin.adminId,
            p_thresholds: thresholds,
            p_reason: reason,
            p_idempotency_key: idempotencyKey,
            p_request_context: buildAdminRpcContext(admin, ctx),
          },
        },
      );

      return {
        audit_log_id: result.audit_log_id ?? null,
        key: "monitoring.thresholds",
        thresholds: normalizeMonitoringThresholds(result.thresholds),
        updatedAt:
          typeof result.updated_at === "string" ? result.updated_at : null,
        source: "system_settings" as const,
        idempotent: result.idempotent === true,
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(
        error,
        "ADMIN_MONITORING_THRESHOLDS_UPDATE_FAILED",
      );
    }
  },
  {
    methods: ["GET", "PATCH"],
    rateLimit: {
      action: "admin.write",
    },
  },
);
