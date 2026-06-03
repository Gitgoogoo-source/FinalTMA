import {
  runPhase5Reconciliation,
  type Phase5ReconciliationRunType,
} from "../../packages/server/src/jobs/ledgerReconcileJob.js";
import { assertCronRequest } from "../_shared/cron.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";

const RECONCILIATION_RUN_TYPE_ALIASES: Readonly<
  Record<string, Phase5ReconciliationRunType>
> = {
  payment: "payment_fulfillment",
  ledger: "ledger_balance",
  market: "market_settlement",
  inventory: "inventory_lock",
  gacha: "gacha_stock",
  referral: "referral_commission",
  mint: "mint_queue",
  wallet: "wallet_sync",
};

const RECONCILIATION_RUN_TYPES = new Set<Phase5ReconciliationRunType>([
  "payment_fulfillment",
  "ledger_balance",
  "market_settlement",
  "inventory_lock",
  "gacha_stock",
  "referral_commission",
  "mint_queue",
  "wallet_sync",
]);

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

function parseRunTypes(
  value: string | string[] | undefined,
): Phase5ReconciliationRunType[] | undefined {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : undefined;

  if (!rawItems) {
    return undefined;
  }

  const runTypes = rawItems
    .map((item) => normalizeRunType(item))
    .filter((item): item is Phase5ReconciliationRunType => Boolean(item));

  return runTypes.length ? [...new Set(runTypes)] : undefined;
}

function normalizeRunType(
  value: string | undefined,
): Phase5ReconciliationRunType | undefined {
  const raw = value?.trim().toLowerCase();

  if (!raw) {
    return undefined;
  }

  const mapped = RECONCILIATION_RUN_TYPE_ALIASES[raw];
  if (mapped) {
    return mapped;
  }

  if (RECONCILIATION_RUN_TYPES.has(raw as Phase5ReconciliationRunType)) {
    return raw as Phase5ReconciliationRunType;
  }

  throw new ApiError(400, "RECONCILIATION_RUN_TYPE_INVALID", "对账类型无效。", {
    details: { value: raw },
  });
}

function mapReconciliationError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  return ApiError.internal("Phase 5 对账任务执行失败。", {
    cause: error instanceof Error ? error.message : String(error),
  });
}
