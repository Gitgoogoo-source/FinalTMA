import { parseJsonBody } from "../../_shared/parseBody.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  asJsonRecord,
  normalizeRequiredText,
  readBodyIdempotencyKey,
} from "../_shared.js";
import {
  parseDryRun,
  buildRunTypesConfirmationTarget,
  parseRunNowLimit,
  parseRunTypes,
  requireReconciliationConfirmation,
} from "./_shared.js";
import {
  runPhase5Reconciliation,
  type Phase5ReconciliationResult,
} from "../../../packages/server/src/jobs/ledgerReconcileJob.js";
import {
  IdempotencyError,
  withIdempotency,
} from "../../../packages/server/src/db/idempotency.js";
import type {
  JsonObject,
  JsonValue,
} from "../../../packages/server/src/db/transactions.js";

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["ops:write", "risk:write"],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 64 * 1024 }),
    );

    const idempotencyKey = readBodyIdempotencyKey(req, body);
    const reason = normalizeRequiredText(body.reason, "reason");
    const runTypes = parseRunTypes(body.runTypes ?? body.run_types);
    const dryRun = parseDryRun(body);
    const limit = parseRunNowLimit(body.limit);

    if (!runTypes?.length) {
      throw new ApiError(
        400,
        "RECONCILIATION_RUN_TYPE_REQUIRED",
        "至少选择一个对账类型。",
      );
    }

    requireReconciliationConfirmation(
      req,
      body,
      buildRunTypesConfirmationTarget(body.runTypes ?? body.run_types, runTypes),
    );

    try {
      const idempotentResult = await withIdempotency<JsonObject>({
        scope: "admin.reconciliation.run_now",
        key: idempotencyKey,
        userId: admin.userId,
        traceId: ctx.requestId,
        requestPayload: {
          runTypes,
          dryRun,
          limit: limit ?? null,
          reason,
        },
        lockMs: 10 * 60 * 1000,
        handler: async () => {
          const result = await runPhase5Reconciliation({
            requestId: ctx.requestId,
            runTypes,
            limit,
            createdBy: `admin:${admin.adminId}`,
            writeRiskEvents: !dryRun,
          });

          return toJsonObject({
            ...result,
            dryRun,
            dry_run: dryRun,
            writeRiskEvents: !dryRun,
            write_risk_events: !dryRun,
          });
        },
      });

      return {
        ...idempotentResult.data,
        idempotent: idempotentResult.replayed,
        nextCursor: null,
        serverTime: new Date().toISOString(),
      };
    } catch (error) {
      throw mapRunNowError(error);
    }
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function mapRunNowError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof IdempotencyError) {
    return new ApiError(error.status, error.code, error.message, {
      details: error.details,
      cause: error,
    });
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

  return new ApiError(
    500,
    "RECONCILIATION_RUN_FAILED",
    "对账任务执行失败。",
    {
      details: { message },
      expose: false,
      cause: error,
    },
  );
}

function toJsonObject(value: Phase5ReconciliationResult & Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonValue as JsonObject;
}
