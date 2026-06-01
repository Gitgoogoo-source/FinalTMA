import { parseJsonBody } from "../../_shared/parseBody.js";
import { withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  getWorkerJobDefinition,
  type WorkerJobName,
} from "../../../packages/server/src/jobs/workerRuntime.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  mapAdminRpcError,
  normalizeBoolean,
  normalizeRequiredText,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
} from "../_shared.js";
import { normalizeWorkerJobName } from "../../_shared/workerJobs.js";

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["ops:write"],
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    requireAdminConfirmation(req, body);

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const jobName = normalizeWorkerJobName(body.jobName ?? body.job_name);
    const enabled = normalizeBoolean(body.enabled, "enabled");
    const reason = normalizeRequiredText(body.reason, "reason");
    const definition = getWorkerJobDefinition(jobName as WorkerJobName);

    try {
      const result = await callAdminWriteRpc<Record<string, unknown>>({
        functionName: "admin_update_feature_flag",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_key: definition.flag.key,
          p_enabled: enabled,
          p_description: `Worker toggle for ${definition.label}`,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_request_context: buildAdminRpcContext(admin, ctx),
        },
      });

      return {
        ...result,
        jobName,
        job_name: jobName,
        flagKey: definition.flag.key,
        flag_key: definition.flag.key,
        enabled,
        serverTime: new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_WORKER_TOGGLE_FAILED");
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);
