import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../../packages/server/src/db/supabaseAdmin.js";
import {
  getWorkerJobDefinition,
  isWorkerJobName,
  readWorkerJobState,
  WORKER_JOB_DEFINITIONS,
  type WorkerJobName,
  type WorkerRunRow,
} from "../../../packages/server/src/jobs/workerRuntime.js";
import { readOpsFeatureFlag } from "../../../packages/server/src/ops/featureFlags.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  buildNextCursor,
  firstQueryValue,
  parseAdminLimit,
  parseOffsetCursor,
} from "../_shared.js";

type WorkerRunsTable = {
  select(columns: string): WorkerRunsQuery;
};

type WorkerRunsQuery = {
  eq(column: string, value: string): WorkerRunsQuery;
  order(column: string, options: { ascending: boolean }): WorkerRunsQuery;
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: unknown[] | null;
    error: { message?: string } | null;
  }>;
  limit(count: number): PromiseLike<{
    data: unknown[] | null;
    error: { message?: string } | null;
  }>;
};

type OpsClient = SupabaseAdminClient & {
  schema(schema: "ops"): {
    from(table: "job_runs"): WorkerRunsTable;
  };
};

const RUN_COLUMNS = [
  "id",
  "job_name",
  "request_id",
  "triggered_by",
  "triggered_by_admin_user_id",
  "idempotency_key",
  "status",
  "started_at",
  "finished_at",
  "processed_count",
  "failed_count",
  "error_message",
  "params",
  "result",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["ops:read"],
    });

    const db = getSupabaseAdminClient();
    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const jobName = parseWorkerJobQuery(
      req.query.jobName ?? req.query.job_name,
    );
    const pageFlag = await readOpsFeatureFlag({
      key: "FEATURE_WORKERS_PAGE_ENABLED",
      envName: "FEATURE_WORKERS_PAGE_ENABLED",
      defaultEnabled: true,
    });
    const pageDisabledReason = pageFlag.enabled
      ? null
      : `${pageFlag.key} disabled`;
    const rows = await listWorkerRuns(db, jobName, limit, offset);
    const items = rows.slice(0, limit).map(serializeRun);
    const latestRows = await listLatestWorkerRuns(db);
    const latestByJob = new Map(
      latestRows.map((row) => [row.job_name, serializeRun(row)]),
    );
    const jobs = await Promise.all(
      WORKER_JOB_DEFINITIONS.map(async (definition) => {
        const state = await readWorkerJobState(definition.jobName);

        return {
          jobName: definition.jobName,
          job_name: definition.jobName,
          label: definition.label,
          description: definition.description,
          cronPath: definition.cronPath,
          cron_path: definition.cronPath,
          schedule: definition.schedule,
          nextRunHint: definition.nextRunHint,
          next_run_hint: definition.nextRunHint,
          enabled: state.enabled,
          disabledReason: state.disabledReason,
          disabled_reason: state.disabledReason,
          flags: state.flags,
          lastRun: latestByJob.get(definition.jobName) ?? null,
          last_run: latestByJob.get(definition.jobName) ?? null,
        };
      }),
    );

    return {
      jobs,
      items,
      runs: items,
      summary: {
        totalRuns: items.length,
        total_runs: items.length,
        jobCount: jobs.length,
        job_count: jobs.length,
      },
      nextCursor: buildNextCursor(rows.length, limit, offset),
      next_cursor: buildNextCursor(rows.length, limit, offset),
      pageEnabled: pageFlag.enabled,
      page_enabled: pageFlag.enabled,
      disabledReason: pageDisabledReason,
      disabled_reason: pageDisabledReason,
      serverTime: new Date().toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);

function parseWorkerJobQuery(value: unknown): WorkerJobName | undefined {
  const raw = firstQueryValue(value);

  if (!raw) {
    return undefined;
  }

  if (!isWorkerJobName(raw)) {
    throw new ApiError(400, "WORKER_JOB_INVALID", "worker jobName 无效。");
  }

  return raw;
}

async function listWorkerRuns(
  db: SupabaseAdminClient,
  jobName: WorkerJobName | undefined,
  limit: number,
  offset: number,
): Promise<WorkerRunRow[]> {
  let query = (db as OpsClient)
    .schema("ops")
    .from("job_runs")
    .select(RUN_COLUMNS);

  if (jobName) {
    query = query.eq("job_name", jobName);
  }

  const { data, error } = await query
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_WORKER_RUNS_LOOKUP_FAILED",
      "Worker 运行历史查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as WorkerRunRow[]) : [];
}

async function listLatestWorkerRuns(
  db: SupabaseAdminClient,
): Promise<WorkerRunRow[]> {
  const { data, error } = await (db as OpsClient)
    .schema("ops")
    .from("job_runs")
    .select(RUN_COLUMNS)
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_WORKER_RUNS_LOOKUP_FAILED",
      "Worker 最近运行历史查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const seen = new Set<WorkerJobName>();
  const latest: WorkerRunRow[] = [];

  for (const row of Array.isArray(data) ? (data as WorkerRunRow[]) : []) {
    if (!isWorkerJobName(row.job_name) || seen.has(row.job_name)) {
      continue;
    }

    seen.add(row.job_name);
    latest.push(row);
  }

  return latest;
}

function serializeRun(row: WorkerRunRow): Record<string, unknown> {
  const definition = isWorkerJobName(row.job_name)
    ? getWorkerJobDefinition(row.job_name)
    : null;

  return {
    ...row,
    jobName: row.job_name,
    label: definition?.label ?? row.job_name,
    requestId: row.request_id,
    triggeredBy: row.triggered_by,
    triggeredByAdminUserId: row.triggered_by_admin_user_id,
    idempotencyKey: row.idempotency_key,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    processedCount: readNumber(row.processed_count),
    processed_count: readNumber(row.processed_count),
    failedCount: readNumber(row.failed_count),
    failed_count: readNumber(row.failed_count),
    errorMessage: row.error_message,
    error_message: row.error_message,
  };
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
