import { parseJsonBody } from "../../_shared/parseBody.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import { readOpsFeatureFlag } from "../../../packages/server/src/ops/featureFlags.js";
import type { JsonObject } from "../../../packages/server/src/db/transactions.js";
import {
  asJsonRecord,
  callAdminWriteRpc,
  hashAuditValue,
  normalizeUuid,
  normalizeRequiredText,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
} from "../_shared.js";
import {
  normalizeWorkerJobName,
  runWorkerByName,
} from "../../_shared/workerJobs.js";

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["ops:write"],
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 64 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const jobName = normalizeWorkerJobName(body.jobName ?? body.job_name);
    const reason = normalizeRequiredText(body.reason, "reason");
    const manualFlag = await readOpsFeatureFlag({
      key: "FEATURE_WORKERS_MANUAL_RUN_ENABLED",
      envName: "FEATURE_WORKERS_MANUAL_RUN_ENABLED",
      defaultEnabled: true,
    });

    if (!manualFlag.enabled) {
      throw new ApiError(
        403,
        "WORKER_MANUAL_RUN_DISABLED",
        "Worker 手动运行已暂停。",
      );
    }

    const params = asJsonRecord(body.params);
    const summary = await runWorkerByName({
      jobName,
      requestId: ctx.requestId,
      triggeredBy: "admin",
      triggeredByAdminUserId: admin.adminId,
      idempotencyKey,
      params: toJsonObject({
        ...params,
        reason,
      }),
    });
    const audit = await callAdminWriteRpc<{ audit_log_id: string }>({
      functionName: "admin_write_audit_log",
      requestId: ctx.requestId,
      args: {
        p_admin_user_id: admin.adminId,
        p_action: "worker.run_now",
        p_target_schema: "ops",
        p_target_table: "job_runs",
        p_target_id: normalizeUuid(summary.job_run_id),
        p_before_state: {},
        p_after_state: toJsonObject({
          job_name: summary.job_name,
          request_id: summary.request_id,
          status: summary.status,
          processed_count: summary.processed_count,
          failed_count: summary.failed_count,
          error_message: summary.error_message,
          idempotency_key: idempotencyKey,
          params,
        }),
        p_ip_hash: hashAuditValue(ctx.ip),
        p_user_agent: ctx.userAgent,
        p_reason: reason,
      },
    });

    return {
      ...summary,
      auditLogId: audit.audit_log_id,
      audit_log_id: audit.audit_log_id,
      serverTime: new Date().toISOString(),
    };
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
