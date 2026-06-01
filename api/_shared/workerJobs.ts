import { getSupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin.js";
import { callRpcRaw } from "../../packages/server/src/db/rpc.js";
import type { JsonObject } from "../../packages/server/src/db/transactions.js";
import {
  runPhase5Reconciliation,
  type Phase5ReconciliationRunType,
} from "../../packages/server/src/jobs/ledgerReconcileJob.js";
import {
  createWorkerRequestId,
  isWorkerJobName,
  runManagedWorker,
  type WorkerJobName,
  type WorkerRunSummary,
  type WorkerTaskResult,
  type WorkerTrigger,
} from "../../packages/server/src/jobs/workerRuntime.js";
import { createTonNftService } from "../../packages/server/src/ton/nft.js";
import {
  runRetryFailedPayments,
  parsePaymentRetryLimit,
} from "../../scripts/retry-failed-payments.js";
import { runMintQueueWorker } from "../cron/retry-mint-queue.js";
import { ApiError } from "./handler.js";

type RunWorkerByNameInput = {
  jobName: WorkerJobName;
  requestId?: string | undefined;
  triggeredBy: WorkerTrigger;
  triggeredByAdminUserId?: string | null | undefined;
  idempotencyKey?: string | null | undefined;
  params?: JsonObject | undefined;
};

const RECONCILIATION_RUN_TYPE_MAP: Record<string, Phase5ReconciliationRunType> =
  {
    payment: "payment_fulfillment",
    payment_fulfillment: "payment_fulfillment",
    mint: "mint_queue",
    mint_queue: "mint_queue",
    wallet: "wallet_sync",
    wallet_sync: "wallet_sync",
    ledger: "ledger_balance",
    ledger_balance: "ledger_balance",
    market: "market_settlement",
    market_settlement: "market_settlement",
    inventory: "inventory_lock",
    inventory_lock: "inventory_lock",
    gacha: "gacha_stock",
    gacha_stock: "gacha_stock",
    referral: "referral_commission",
    referral_commission: "referral_commission",
  };

export function normalizeWorkerJobName(value: unknown): WorkerJobName {
  if (!isWorkerJobName(value)) {
    throw new Error("WORKER_JOB_INVALID");
  }

  return value;
}

export async function runWorkerByName(
  input: RunWorkerByNameInput,
): Promise<WorkerRunSummary> {
  const requestId = input.requestId ?? createWorkerRequestId(input.jobName);
  const params = input.params ?? {};

  validateWorkerParams(input.jobName, params);

  return runManagedWorker({
    jobName: input.jobName,
    requestId,
    triggeredBy: input.triggeredBy,
    triggeredByAdminUserId: input.triggeredByAdminUserId,
    idempotencyKey: input.idempotencyKey,
    params,
    task: () =>
      runWorkerTask({
        jobName: input.jobName,
        requestId,
        triggeredByAdminUserId: input.triggeredByAdminUserId ?? null,
        params,
      }),
  });
}

function validateWorkerParams(jobName: WorkerJobName, params: JsonObject): void {
  if (jobName === "reconciliation") {
    parseReconciliationRunTypes(params.runTypes);
  }

  if (jobName === "daily_reports") {
    readDateString(params.reportDate ?? params.report_date ?? params.date);
  }
}

async function runWorkerTask(input: {
  jobName: WorkerJobName;
  requestId: string;
  triggeredByAdminUserId: string | null;
  params: JsonObject;
}): Promise<WorkerTaskResult> {
  switch (input.jobName) {
    case "reconciliation":
      return runReconciliationWorker(input);
    case "market_stats":
      return runMarketStatsWorker(input);
    case "leaderboard":
      return runLeaderboardWorker(input);
    case "retry_payments":
      return runRetryPaymentsWorker(input);
    case "retry_mints":
      return runRetryMintsWorker(input);
    case "expire_listings":
      return runExpireListingsWorker(input);
    case "campaign_close":
      return runCampaignCloseWorker(input);
    case "cleanup_idempotency":
      return runCleanupIdempotencyWorker(input);
    case "daily_reports":
      return runDailyReportsWorker(input);
  }
}

async function runReconciliationWorker(input: {
  requestId: string;
  triggeredByAdminUserId: string | null;
  params: JsonObject;
}): Promise<WorkerTaskResult> {
  const result = await runPhase5Reconciliation({
    requestId: input.requestId,
    runTypes: parseReconciliationRunTypes(input.params.runTypes),
    limit: readPositiveInteger(input.params.limit),
    createdBy: input.triggeredByAdminUserId
      ? `admin:${input.triggeredByAdminUserId}`
      : "worker.reconciliation",
    writeRiskEvents: true,
  });
  const runs = Array.isArray(result.runs) ? result.runs : [];
  const processedCount = sumNumber(
    runs.map((run) => readNumber((run as Record<string, unknown>).checkedCount)),
  );
  const failedCount = runs.filter(
    (run) => String((run as Record<string, unknown>).status) === "failed",
  ).length;

  return {
    processedCount,
    failedCount,
    result: toJsonObject(result as unknown as Record<string, unknown>),
  };
}

async function runMarketStatsWorker(input: {
  requestId: string;
}): Promise<WorkerTaskResult> {
  const payload = await callRpcRaw<Record<string, unknown>>(
    "market_refresh_price_stats",
    {},
    {
      schema: "api" as never,
      context: {
        requestId: input.requestId,
        source: "worker.market_stats",
      },
    },
  );
  const processedCount =
      readNumber(payload.price_snapshot_count) +
      readNumber(payload.depth_snapshot_count) +
      readNumber(payload.price_health_update_count);

  return {
    processedCount,
    failedCount: 0,
    errorMessage: null,
    result: toJsonObject(payload),
  };
}

async function runLeaderboardWorker(input: {
  requestId: string;
  params: JsonObject;
}): Promise<WorkerTaskResult> {
  const payload = await callRpcRaw<Record<string, unknown>>(
    "album_refresh_weekly_leaderboard",
    {
      p_week_start: readString(input.params.weekStart ?? input.params.week_start),
    },
    {
      schema: "api" as never,
      context: {
        requestId: input.requestId,
        source: "worker.leaderboard",
      },
    },
  );

  return {
    processedCount: readNumber(payload.entry_count),
    failedCount: 0,
    result: toJsonObject(payload),
  };
}

async function runRetryPaymentsWorker(input: {
  requestId: string;
  triggeredByAdminUserId: string | null;
  params: JsonObject;
}): Promise<WorkerTaskResult> {
  const limit =
    readPositiveInteger(input.params.limit) ??
    parsePaymentRetryLimit(process.env.PAYMENT_RETRY_LIMIT);
  const output = await runRetryFailedPayments({
    dryRun: false,
    limit,
    onlyStatus: null,
    requestId: input.requestId,
    systemAdminUserId:
      input.triggeredByAdminUserId ?? readString(process.env.SYSTEM_ADMIN_USER_ID),
  });

  return {
    processedCount: output.processed,
    failedCount: output.failed,
    result: toJsonObject(output as unknown as Record<string, unknown>),
  };
}

async function runRetryMintsWorker(input: {
  requestId: string;
  params: JsonObject;
}): Promise<WorkerTaskResult> {
  const limit = readPositiveInteger(input.params.limit);
  const env = limit
    ? { ...process.env, TON_MINT_BATCH_SIZE: String(limit) }
    : process.env;
  const result = await runMintQueueWorker({
    db: getSupabaseAdminClient(),
    provider: createTonNftService(),
    requestId: input.requestId,
    env,
  });

  return {
    processedCount: result.claimed,
    failedCount: result.errors.length,
    result: toJsonObject(result as unknown as Record<string, unknown>),
  };
}

async function runExpireListingsWorker(input: {
  requestId: string;
  params: JsonObject;
}): Promise<WorkerTaskResult> {
  const payload = await callRpcRaw<Record<string, unknown>>(
    "worker_expire_market_listings",
    {
      p_limit: readPositiveInteger(input.params.limit) ?? 100,
      p_request_context: {
        request_id: input.requestId,
        source: "worker.expire_listings",
      },
    },
    {
      schema: "api" as never,
      context: {
        requestId: input.requestId,
        source: "worker.expire_listings",
      },
    },
  );

  return {
    processedCount: readNumber(payload.expired_listing_count),
    failedCount: 0,
    result: toJsonObject(payload),
  };
}

async function runCampaignCloseWorker(input: {
  requestId: string;
}): Promise<WorkerTaskResult> {
  const payload = await callRpcRaw<Record<string, unknown>>(
    "sync_campaign_box_statuses",
    {
      p_request_context: {
        request_id: input.requestId,
        source: "worker.campaign_close",
      },
      p_now: null,
    },
    {
      schema: "api" as never,
      context: {
        requestId: input.requestId,
        source: "worker.campaign_close",
      },
    },
  );
  const processedCount =
    readNumber(payload.campaigns_ended_count) +
    readNumber(payload.boxes_activated_count) +
    readNumber(payload.boxes_ended_count) +
    readNumber(payload.boxes_sold_out_count);

  return {
    processedCount,
    failedCount: readNumber(payload.box_activation_blocked_count),
    result: toJsonObject(payload),
  };
}

async function runCleanupIdempotencyWorker(input: {
  requestId: string;
  params: JsonObject;
}): Promise<WorkerTaskResult> {
  const retentionDays = readPositiveInteger(input.params.retentionDays) ?? 7;
  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const payload = await callRpcRaw<Record<string, unknown>>(
    "worker_cleanup_idempotency_keys",
    {
      p_cutoff: cutoff,
      p_limit: readPositiveInteger(input.params.limit) ?? 500,
      p_request_context: {
        request_id: input.requestId,
        source: "worker.cleanup_idempotency",
      },
    },
    {
      schema: "api" as never,
      context: {
        requestId: input.requestId,
        source: "worker.cleanup_idempotency",
      },
    },
  );

  return {
    processedCount: readNumber(payload.deleted_count),
    failedCount: 0,
    result: toJsonObject(payload),
  };
}

async function runDailyReportsWorker(input: {
  requestId: string;
  params: JsonObject;
}): Promise<WorkerTaskResult> {
  const payload = await callRpcRaw<Record<string, unknown>>(
    "worker_build_daily_reports",
    {
      p_report_date: readDateString(
        input.params.reportDate ?? input.params.report_date ?? input.params.date,
      ),
      p_request_context: {
        request_id: input.requestId,
        source: "worker.daily_reports",
      },
    },
    {
      schema: "api" as never,
      context: {
        requestId: input.requestId,
        source: "worker.daily_reports",
      },
    },
  );

  return {
    processedCount: readNumber(payload.processed_count),
    failedCount: payload.status === "success" ? 0 : 1,
    result: toJsonObject(payload),
  };
}

function parseReconciliationRunTypes(
  value: unknown,
): Phase5ReconciliationRunType[] | undefined {
  const rawItems =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value
        : undefined;

  if (!rawItems) {
    return undefined;
  }

  const runTypes: Phase5ReconciliationRunType[] = [];

  for (const item of rawItems) {
    if (typeof item !== "string" || item.trim().length === 0) {
      continue;
    }

    const mapped = RECONCILIATION_RUN_TYPE_MAP[item.trim().toLowerCase()];

    if (!mapped) {
      throw new ApiError(
        400,
        "RECONCILIATION_RUN_TYPE_INVALID",
        "对账类型无效。",
      );
    }

    runTypes.push(mapped);
  }

  return runTypes.length ? [...new Set(runTypes)] : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;

  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readDateString(value: unknown): string | null {
  const raw = readString(value);

  if (raw === null) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ApiError(
      400,
      "WORKER_REPORT_DATE_INVALID",
      "reportDate must be YYYY-MM-DD.",
    );
  }

  return raw;
}

function sumNumber(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
