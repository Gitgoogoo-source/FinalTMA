import {
  runPhase5Reconciliation,
} from "../../packages/server/src/jobs/ledgerReconcileJob.js";
import { assertCronRequest } from "../_shared/cron.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { parseRunTypes } from "../admin/reconciliation/_shared.js";

export default withApiHandler(
  async (req, _res, ctx) => {
    assertCronRequest(req);

    try {
      return await runPhase5Reconciliation({
        requestId: ctx.requestId,
        runTypes: parseRunTypes(req.query.runTypes ?? req.query.run_types),
        limit: parseLimit(req.query.limit),
        createdBy: "cron.reconcile-ledger",
      });
    } catch (error) {
      throw mapReconciliationError(error);
    }
  },
  {
    methods: ["GET", "POST"],
    rateLimit: {
      action: "cron.job",
    },
  },
);

function parseLimit(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;

  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, "VALIDATION_FAILED", "limit 必须是正整数。");
  }

  return parsed;
}

function mapReconciliationError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  return ApiError.internal("Phase 5 对账任务执行失败。", {
    cause: error instanceof Error ? error.message : String(error),
  });
}
