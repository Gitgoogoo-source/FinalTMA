import { randomUUID } from "node:crypto";

import { callRpcRaw } from "../db/rpc.js";
import type { JsonObject, JsonValue } from "../db/transactions.js";
import {
  LEGACY_OPS_FEATURE_FLAGS,
  OPS_FEATURE_FLAGS,
  readOpsFeatureFlag,
  FeatureFlagReadError,
  type OpsFeatureFlagDecision,
} from "../ops/featureFlags.js";

export const WORKER_JOB_NAMES = [
  "reconciliation",
  "market_stats",
  "leaderboard",
  "retry_payments",
  "retry_mints",
  "expire_listings",
  "campaign_close",
  "cleanup_idempotency",
  "daily_reports",
] as const;

export type WorkerJobName = (typeof WORKER_JOB_NAMES)[number];

export type WorkerRunStatus =
  | "running"
  | "success"
  | "partial_failed"
  | "failed"
  | "skipped"
  | "already_running";

export type WorkerTrigger = "cron" | "admin" | "script" | "system";

export type WorkerRunSummary = {
  job_name: WorkerJobName;
  request_id: string;
  started_at: string;
  finished_at: string;
  status: Exclude<WorkerRunStatus, "running">;
  processed_count: number;
  failed_count: number;
  error_message: string | null;
  job_run_id?: string;
  idempotent?: boolean;
  result?: JsonObject;
};

export type WorkerTaskResult = {
  status?: Exclude<WorkerRunStatus, "running"> | undefined;
  processedCount?: number | undefined;
  failedCount?: number | undefined;
  errorMessage?: string | null | undefined;
  result?: JsonObject | undefined;
};

export type WorkerRunRow = {
  id: string;
  job_name: WorkerJobName;
  request_id: string;
  triggered_by: WorkerTrigger;
  triggered_by_admin_user_id: string | null;
  idempotency_key: string | null;
  status: WorkerRunStatus;
  started_at: string;
  finished_at: string | null;
  processed_count: number | string | null;
  failed_count: number | string | null;
  error_message: string | null;
  params: unknown;
  result: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type WorkerFlagRequirement = {
  key: string;
  envName?: string | undefined;
  fallbackKeys?: readonly string[] | undefined;
  defaultEnabled?: boolean | undefined;
};

export type WorkerJobDefinition = {
  jobName: WorkerJobName;
  label: string;
  description: string;
  cronPath: string;
  schedule: string;
  nextRunHint: string;
  permission: "ops:read" | "ops:write";
  flag: WorkerFlagRequirement;
  dependencyFlags?: readonly WorkerFlagRequirement[] | undefined;
};

export type WorkerJobFlagState = {
  key: string;
  enabled: boolean;
  source: string;
  envName?: string;
};

export type WorkerJobState = {
  enabled: boolean;
  disabledReason: string | null;
  flags: WorkerJobFlagState[];
};

type ManagedWorkerInput = {
  jobName: WorkerJobName;
  requestId: string;
  triggeredBy: WorkerTrigger;
  triggeredByAdminUserId?: string | null | undefined;
  idempotencyKey?: string | null | undefined;
  params?: JsonObject | undefined;
  lockTtlMs?: number | undefined;
  task: () => Promise<WorkerTaskResult>;
};

const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;
const MAX_ERROR_MESSAGE_LENGTH = 400;

export const WORKER_JOB_DEFINITIONS: readonly WorkerJobDefinition[] = [
  {
    jobName: "reconciliation",
    label: "Reconciliation",
    description: "支付、Mint、ledger 和市场对账。",
    cronPath: "/api/cron/reconciliation",
    schedule: "15m / 1h / daily",
    nextRunHint: "支付每 15 分钟，Mint 每小时，ledger 和市场每日。",
    permission: "ops:read",
    flag: {
      key: "FEATURE_RECONCILIATION_WORKER_ENABLED",
      envName: "FEATURE_RECONCILIATION_WORKER_ENABLED",
      defaultEnabled: true,
    },
  },
  {
    jobName: "market_stats",
    label: "Market stats",
    description: "刷新市场价格、深度和健康度统计。",
    cronPath: "/api/cron/rebuild-market-stats",
    schedule: "*/10 * * * *",
    nextRunHint: "每 10 分钟。",
    permission: "ops:read",
    flag: {
      key: "FEATURE_MARKET_STATS_WORKER_ENABLED",
      envName: "FEATURE_MARKET_STATS_WORKER_ENABLED",
      defaultEnabled: true,
    },
    dependencyFlags: [
      {
        key: OPS_FEATURE_FLAGS.MARKET,
        envName: "FEATURE_MARKET_ENABLED",
        fallbackKeys: [LEGACY_OPS_FEATURE_FLAGS.MARKET],
        defaultEnabled: true,
      },
    ],
  },
  {
    jobName: "leaderboard",
    label: "Leaderboard",
    description: "重建每周图鉴排行榜。",
    cronPath: "/api/cron/rebuild-leaderboard",
    schedule: "5 0 * * *",
    nextRunHint: "每天 00:05 UTC。",
    permission: "ops:read",
    flag: {
      key: "FEATURE_LEADERBOARD_WORKER_ENABLED",
      envName: "FEATURE_LEADERBOARD_WORKER_ENABLED",
      defaultEnabled: true,
    },
  },
  {
    jobName: "retry_payments",
    label: "Retry payments",
    description: "重试已支付但未发货订单。",
    cronPath: "/api/cron/retry-payments",
    schedule: "*/5 * * * *",
    nextRunHint: "每 5 分钟。",
    permission: "ops:read",
    flag: {
      key: "FEATURE_RETRY_PAYMENTS_WORKER_ENABLED",
      envName: "FEATURE_RETRY_PAYMENTS_WORKER_ENABLED",
      defaultEnabled: true,
    },
    dependencyFlags: [
      {
        key: OPS_FEATURE_FLAGS.PAYMENT_WEBHOOK_FULFILLMENT,
        envName: "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
        defaultEnabled: false,
      },
    ],
  },
  {
    jobName: "retry_mints",
    label: "Retry mints",
    description: "处理可重试 Mint 队列。",
    cronPath: "/api/cron/retry-mints",
    schedule: "*/5 * * * *",
    nextRunHint: "每 5 分钟。",
    permission: "ops:read",
    flag: {
      key: "FEATURE_RETRY_MINTS_WORKER_ENABLED",
      envName: "FEATURE_RETRY_MINTS_WORKER_ENABLED",
      defaultEnabled: true,
    },
    dependencyFlags: [
      {
        key: OPS_FEATURE_FLAGS.MINT_WORKER,
        envName: "FEATURE_MINT_WORKER_ENABLED",
        defaultEnabled: false,
      },
      {
        key: OPS_FEATURE_FLAGS.TON_MINT,
        envName: "FEATURE_TON_MINT_ENABLED",
        fallbackKeys: [LEGACY_OPS_FEATURE_FLAGS.TON_MINT],
        defaultEnabled: false,
      },
    ],
  },
  {
    jobName: "expire_listings",
    label: "Expire listings",
    description: "过期挂单并释放库存锁。",
    cronPath: "/api/cron/expire-listings",
    schedule: "*/15 * * * *",
    nextRunHint: "每 15 分钟。",
    permission: "ops:read",
    flag: {
      key: "FEATURE_EXPIRE_LISTINGS_WORKER_ENABLED",
      envName: "FEATURE_EXPIRE_LISTINGS_WORKER_ENABLED",
      defaultEnabled: true,
    },
    dependencyFlags: [
      {
        key: OPS_FEATURE_FLAGS.MARKET,
        envName: "FEATURE_MARKET_ENABLED",
        fallbackKeys: [LEGACY_OPS_FEATURE_FLAGS.MARKET],
        defaultEnabled: true,
      },
    ],
  },
  {
    jobName: "campaign_close",
    label: "Campaign close",
    description: "处理活动和盲盒到期上下线。",
    cronPath: "/api/cron/close-ended-campaigns",
    schedule: "*/5 * * * *",
    nextRunHint: "每 5 分钟。",
    permission: "ops:read",
    flag: {
      key: "FEATURE_CAMPAIGN_CLOSE_WORKER_ENABLED",
      envName: "FEATURE_CAMPAIGN_CLOSE_WORKER_ENABLED",
      defaultEnabled: true,
    },
  },
  {
    jobName: "cleanup_idempotency",
    label: "Cleanup idempotency",
    description: "清理过期幂等记录。",
    cronPath: "/api/cron/cleanup-idempotency",
    schedule: "35 2 * * *",
    nextRunHint: "每天 02:35 UTC。",
    permission: "ops:read",
    flag: {
      key: "FEATURE_CLEANUP_IDEMPOTENCY_WORKER_ENABLED",
      envName: "FEATURE_CLEANUP_IDEMPOTENCY_WORKER_ENABLED",
      defaultEnabled: true,
    },
  },
  {
    jobName: "daily_reports",
    label: "Daily reports",
    description: "生成商业运营 BI 日报快照。",
    cronPath: "/api/cron/build-daily-reports",
    schedule: "10 17 * * *",
    nextRunHint: "每天 17:10 UTC，聚合前一天数据。",
    permission: "ops:read",
    flag: {
      key: "FEATURE_DAILY_REPORTS_WORKER_ENABLED",
      envName: "FEATURE_DAILY_REPORTS_WORKER_ENABLED",
      defaultEnabled: true,
    },
  },
];

export function isWorkerJobName(value: unknown): value is WorkerJobName {
  return (
    typeof value === "string" &&
    (WORKER_JOB_NAMES as readonly string[]).includes(value)
  );
}

export function getWorkerJobDefinition(
  jobName: WorkerJobName,
): WorkerJobDefinition {
  const definition = WORKER_JOB_DEFINITIONS.find(
    (item) => item.jobName === jobName,
  );

  if (!definition) {
    throw new Error(`Unknown worker job: ${jobName}`);
  }

  return definition;
}

export function createWorkerRequestId(jobName: WorkerJobName): string {
  return `worker-${jobName}-${Date.now()}-${randomUUID()}`;
}

export async function readWorkerJobState(
  jobName: WorkerJobName,
): Promise<WorkerJobState> {
  const definition = getWorkerJobDefinition(jobName);
  const requirements = [definition.flag, ...(definition.dependencyFlags ?? [])];
  const decisions: WorkerJobFlagState[] = [];

  for (const requirement of requirements) {
    const decision = await readWorkerFlag(requirement);
    decisions.push(toWorkerFlagState(decision));
  }

  const disabled = decisions.find((decision) => !decision.enabled) ?? null;

  return {
    enabled: disabled === null,
    disabledReason: disabled ? `${disabled.key} disabled` : null,
    flags: decisions,
  };
}

export async function runManagedWorker(
  input: ManagedWorkerInput,
): Promise<WorkerRunSummary> {
  const startedAt = new Date();
  const run = await startWorkerRun({
    jobName: input.jobName,
    requestId: input.requestId,
    triggeredBy: input.triggeredBy,
    triggeredByAdminUserId: input.triggeredByAdminUserId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    params: input.params ?? {},
  });

  const jobRunId = readRequiredString(run.id, "worker run id");
  const startIso = readIsoString(run.started_at) ?? startedAt.toISOString();

  if (run.idempotent === true) {
    return summarizeIdempotentWorkerRun({
      jobName: input.jobName,
      requestId: input.requestId,
      row: run,
      startedAt: startIso,
      jobRunId,
    });
  }

  const flagState = await readWorkerJobState(input.jobName);

  if (!flagState.enabled) {
    return finishWorkerRunSummary({
      jobRunId,
      jobName: input.jobName,
      requestId: input.requestId,
      startedAt: startIso,
      status: "skipped",
      processedCount: 0,
      failedCount: 0,
      errorMessage: flagState.disabledReason,
      result: {
        skipped_reason: flagState.disabledReason,
        flags: flagState.flags as unknown as JsonValue,
      },
    });
  }

  const lockToken = `${input.requestId}:${randomUUID()}`;
  const lock = await tryAcquireWorkerLock({
    jobName: input.jobName,
    lockToken,
    expiresAt: new Date(
      Date.now() + (input.lockTtlMs ?? DEFAULT_LOCK_TTL_MS),
    ).toISOString(),
    requestId: input.requestId,
  });

  if (!lock.acquired) {
    return finishWorkerRunSummary({
      jobRunId,
      jobName: input.jobName,
      requestId: input.requestId,
      startedAt: startIso,
      status: "already_running",
      processedCount: 0,
      failedCount: 0,
      errorMessage: "Worker is already running.",
      result: toJsonObject({
        lock_status: "already_running",
        expires_at: lock.expiresAt,
      }),
    });
  }

  try {
    const taskResult = await input.task();
    const processedCount = normalizeCount(taskResult.processedCount);
    const failedCount = normalizeCount(taskResult.failedCount);
    const status =
      taskResult.status ??
      (failedCount > 0
        ? processedCount > failedCount
          ? "partial_failed"
          : "failed"
        : "success");

    return await finishWorkerRunSummary({
      jobRunId,
      jobName: input.jobName,
      requestId: input.requestId,
      startedAt: startIso,
      status,
      processedCount,
      failedCount,
      errorMessage: taskResult.errorMessage ?? null,
      result: taskResult.result ?? {},
    });
  } catch (error) {
    return await finishWorkerRunSummary({
      jobRunId,
      jobName: input.jobName,
      requestId: input.requestId,
      startedAt: startIso,
      status: "failed",
      processedCount: 0,
      failedCount: 1,
      errorMessage: sanitizeWorkerError(error),
      result: {},
    });
  } finally {
    await releaseWorkerLock({
      jobName: input.jobName,
      lockToken,
      requestId: input.requestId,
    });
  }
}

function summarizeIdempotentWorkerRun(input: {
  jobName: WorkerJobName;
  requestId: string;
  row: Record<string, unknown>;
  startedAt: string;
  jobRunId: string;
}): WorkerRunSummary {
  const existingStatus = normalizeExistingRunStatus(input.row.status);

  return {
    job_run_id: input.jobRunId,
    job_name: input.jobName,
    request_id: readString(input.row.request_id) ?? input.requestId,
    started_at: input.startedAt,
    finished_at:
      readIsoString(input.row.finished_at) ?? new Date().toISOString(),
    status: existingStatus,
    processed_count: readCount(input.row.processed_count),
    failed_count: readCount(input.row.failed_count),
    error_message: readString(input.row.error_message),
    idempotent: true,
    result: readJsonObject(input.row.result),
  };
}

export function sanitizeWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const clean = message
    .replace(
      /(authorization|cookie|token|secret|service_role|private_key|mnemonic|seed)=([^&\s]+)/gi,
      "$1=[REDACTED]",
    )
    .trim();

  return clean.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${clean.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`
    : clean;
}

function toWorkerFlagState(
  decision: OpsFeatureFlagDecision,
): WorkerJobFlagState {
  const state: WorkerJobFlagState = {
    key: decision.key,
    enabled: decision.enabled,
    source: decision.source,
  };

  if (decision.envName) {
    state.envName = decision.envName;
  }

  return state;
}

async function readWorkerFlag(
  requirement: WorkerFlagRequirement,
): Promise<OpsFeatureFlagDecision> {
  try {
    return await readOpsFeatureFlag({
      key: requirement.key,
      fallbackKeys: requirement.fallbackKeys,
      envName: requirement.envName,
      defaultEnabled: requirement.defaultEnabled ?? false,
    });
  } catch (error) {
    if (
      process.env.NODE_ENV === "test" &&
      error instanceof FeatureFlagReadError
    ) {
      return {
        key: requirement.key,
        enabled: requirement.defaultEnabled ?? false,
        source: "default",
        envName: requirement.envName,
      };
    }

    throw error;
  }
}

async function startWorkerRun(input: {
  jobName: WorkerJobName;
  requestId: string;
  triggeredBy: WorkerTrigger;
  triggeredByAdminUserId: string | null;
  idempotencyKey: string | null;
  params: JsonObject;
}): Promise<Record<string, unknown>> {
  return callRpcRaw<Record<string, unknown>>(
    "worker_start_run",
    {
      p_job_name: input.jobName,
      p_request_id: input.requestId,
      p_triggered_by: input.triggeredBy,
      p_triggered_by_admin_user_id: input.triggeredByAdminUserId,
      p_idempotency_key: input.idempotencyKey,
      p_params: input.params,
      p_request_context: {
        request_id: input.requestId,
        source: `worker.${input.triggeredBy}`,
      },
    },
    {
      schema: "api" as never,
      context: {
        requestId: input.requestId,
        source: "worker.start_run",
        jobName: input.jobName,
      },
    },
  );
}

async function finishWorkerRunSummary(input: {
  jobRunId: string;
  jobName: WorkerJobName;
  requestId: string;
  startedAt: string;
  status: Exclude<WorkerRunStatus, "running">;
  processedCount: number;
  failedCount: number;
  errorMessage: string | null;
  result: JsonObject;
}): Promise<WorkerRunSummary> {
  const finished = await callRpcRaw<Record<string, unknown>>(
    "worker_finish_run",
    {
      p_job_run_id: input.jobRunId,
      p_status: input.status,
      p_processed_count: input.processedCount,
      p_failed_count: input.failedCount,
      p_error_message: input.errorMessage,
      p_result: input.result,
      p_request_context: {
        request_id: input.requestId,
        source: "worker.finish_run",
      },
    },
    {
      schema: "api" as never,
      context: {
        requestId: input.requestId,
        source: "worker.finish_run",
        jobName: input.jobName,
      },
    },
  );

  if (input.status === "failed" || input.status === "partial_failed") {
    await recordWorkerFailureRisk(input);
  }

  return {
    job_run_id: input.jobRunId,
    job_name: input.jobName,
    request_id: input.requestId,
    started_at: input.startedAt,
    finished_at:
      readIsoString(finished.finished_at) ?? new Date().toISOString(),
    status: input.status,
    processed_count: input.processedCount,
    failed_count: input.failedCount,
    error_message: input.errorMessage,
    result: input.result,
  };
}

async function recordWorkerFailureRisk(input: {
  jobRunId: string;
  jobName: WorkerJobName;
  requestId: string;
  status: Exclude<WorkerRunStatus, "running">;
  processedCount: number;
  failedCount: number;
  errorMessage: string | null;
  result: JsonObject;
}): Promise<void> {
  try {
    await callRpcRaw<Record<string, unknown>>(
      "risk_record_event",
      {
        p_user_id: null,
        p_event_type: "worker_failed",
        p_severity: input.status === "failed" ? "high" : "medium",
        p_source_type: "worker_job_run",
        p_source_id: input.jobRunId,
        p_score_delta: input.status === "failed" ? 20 : 10,
        p_detail: {
          job_name: input.jobName,
          request_id: input.requestId,
          status: input.status,
          processed_count: input.processedCount,
          failed_count: input.failedCount,
          error_message: input.errorMessage,
          result: input.result,
        },
        p_idempotency_key: `worker-failed:${input.jobRunId}`,
      },
      {
        schema: "api" as never,
        context: {
          requestId: input.requestId,
          source: "worker.failure_risk_event",
          jobName: input.jobName,
        },
      },
    );
  } catch (error) {
    console.error("[worker.failure_risk_event_failed]", {
      jobName: input.jobName,
      requestId: input.requestId,
      error: sanitizeWorkerError(error),
    });
  }
}

async function tryAcquireWorkerLock(input: {
  jobName: WorkerJobName;
  lockToken: string;
  expiresAt: string;
  requestId: string;
}): Promise<{
  acquired: boolean;
  expiresAt: string | null;
}> {
  const payload = await callRpcRaw<Record<string, unknown>>(
    "worker_try_acquire_lock",
    {
      p_job_name: input.jobName,
      p_lock_token: input.lockToken,
      p_expires_at: input.expiresAt,
      p_request_context: {
        request_id: input.requestId,
        source: "worker.lock",
      },
    },
    {
      schema: "api" as never,
      context: {
        requestId: input.requestId,
        source: "worker.acquire_lock",
        jobName: input.jobName,
      },
    },
  );

  return {
    acquired: payload.acquired === true,
    expiresAt: readIsoString(payload.expires_at),
  };
}

async function releaseWorkerLock(input: {
  jobName: WorkerJobName;
  lockToken: string;
  requestId: string;
}): Promise<void> {
  try {
    await callRpcRaw<Record<string, unknown>>(
      "worker_release_lock",
      {
        p_job_name: input.jobName,
        p_lock_token: input.lockToken,
        p_request_context: {
          request_id: input.requestId,
          source: "worker.lock_release",
        },
      },
      {
        schema: "api" as never,
        context: {
          requestId: input.requestId,
          source: "worker.release_lock",
          jobName: input.jobName,
        },
      },
    );
  } catch (error) {
    console.error("[worker.lock_release_failed]", {
      jobName: input.jobName,
      requestId: input.requestId,
      error: sanitizeWorkerError(error),
    });
  }
}

function normalizeCount(value: number | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function readCount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readJsonObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function normalizeExistingRunStatus(
  value: unknown,
): Exclude<WorkerRunStatus, "running"> {
  return value === "success" ||
    value === "partial_failed" ||
    value === "failed" ||
    value === "skipped" ||
    value === "already_running"
    ? value
    : "already_running";
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new Error(`Missing ${label}.`);
}

function readIsoString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
