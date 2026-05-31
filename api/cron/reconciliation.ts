import {
  runPhase5Reconciliation,
  type Phase5ReconciliationRunType,
} from "../../packages/server/src/jobs/ledgerReconcileJob.js";
import { getSupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin.js";
import { assertCronRequest } from "../_shared/cron.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { parseOptionalJsonBody } from "../_shared/parseBody.js";
import { parseRunTypes } from "../admin/reconciliation/_shared.js";

export default withApiHandler(
  async (req, _res, ctx) => {
    assertCronRequest(req);

    const body =
      req.method === "POST"
        ? asRecord(
            await parseOptionalJsonBody(req, {
              maxBytes: 16 * 1024,
            }),
          )
        : {};
    const runTypes = parseRunTypes(
      req.query.runTypes ??
        req.query.run_types ??
        body.runTypes ??
        body.run_types,
    );
    const limit = parseLimit(req.query.limit ?? body.limit);

    try {
      return await runPhase5Reconciliation({
        requestId: ctx.requestId,
        runTypes,
        limit,
        createdBy: "cron.reconciliation",
        writeRiskEvents: true,
      });
    } catch (error) {
      await recordCronFailure(ctx.requestId, runTypes, error);
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

function parseLimit(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;

  if (!raw) {
    return undefined;
  }

  const parsed =
    typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, "VALIDATION_FAILED", "limit 必须是正整数。");
  }

  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function recordCronFailure(
  requestId: string,
  runTypes: Phase5ReconciliationRunType[] | undefined,
  error: unknown,
): Promise<void> {
  try {
    await getSupabaseAdminClient()
      .schema("ops")
      .from("app_events")
      .insert({
        user_id: null,
        event_name: "reconciliation_cron_failed",
        event_source: "cron",
        payload: {
          request_id: requestId,
          run_types: runTypes ?? null,
          error: error instanceof Error ? error.message : String(error),
        },
      });
  } catch (logError) {
    console.error("[reconciliation-cron:failure-log-failed]", {
      requestId,
      error: logError instanceof Error ? logError.message : String(logError),
    });
  }
}

function mapReconciliationError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("RECONCILIATION_RUN_LOCKED")) {
    return new ApiError(
      409,
      "RECONCILIATION_RUN_LOCKED",
      "同类型对账任务正在运行，请稍后重试。",
      {
        details: { message },
        cause: error,
      },
    );
  }

  return ApiError.internal("对账任务执行失败。", {
    cause: message,
  });
}
