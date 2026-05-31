import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  buildPageResult,
  normalizeRunType,
  toUiRunType,
} from "./_shared.js";
import {
  firstQueryValue,
  parseAdminLimit,
  parseOffsetCursor,
} from "../_shared.js";

type ReconciliationRunRow = {
  id: string;
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  result: unknown;
  error_message: string | null;
  created_by: string | null;
};

const RUN_COLUMNS = [
  "id",
  "run_type",
  "status",
  "started_at",
  "finished_at",
  "result",
  "error_message",
  "created_by",
].join(",");

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["ops:read", "risk:read"],
      requireAll: false,
    });

    const db = getSupabaseAdminClient();
    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const rows = await listRuns(db, req.query, offset, limit);
    const page = buildPageResult(rows, limit, offset);
    const items = page.items.map(serializeRun);

    return {
      items,
      runs: items,
      summary: summarizeRuns(items),
      nextCursor: page.nextCursor,
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

async function listRuns(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
  offset: number,
  limit: number,
): Promise<ReconciliationRunRow[]> {
  let query = db
    .schema("economy")
    .from("reconciliation_runs")
    .select(RUN_COLUMNS);
  const status = normalizeRunStatus(queryInput.status);
  const runType = normalizeRunType(queryInput.runType ?? queryInput.run_type);

  if (status) {
    query = query.eq("status", status);
  }

  if (runType) {
    query = query.eq("run_type", runType);
  }

  const { data, error } = await query
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RECONCILIATION_RUNS_LOOKUP_FAILED",
      "对账运行记录查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as ReconciliationRunRow[]) : [];
}

function normalizeRunStatus(value: unknown): string | undefined {
  const status = firstQueryValue(value)?.trim().toLowerCase();

  if (!status) {
    return undefined;
  }

  if (status === "running" || status === "success" || status === "failed") {
    return status;
  }

  throw new ApiError(
    400,
    "RECONCILIATION_RUN_STATUS_INVALID",
    "对账运行状态无效。",
  );
}

function serializeRun(row: ReconciliationRunRow): Record<string, unknown> {
  const result = asRecord(row.result);
  const checkedCount = readNumber(result.checked_count);
  const findingCount = readNumber(result.finding_count);
  const criticalCount = readNumber(result.critical_count);
  const riskEventInsertedCount = readNumber(
    result.risk_event_inserted_count ?? result.riskEventInsertedCount,
  );
  const riskEventExistingCount = readNumber(
    result.risk_event_existing_count ?? result.riskEventExistingCount,
  );
  const riskEventSkippedCount = readNumber(
    result.risk_event_skipped_count ?? result.riskEventSkippedCount,
  );
  const riskEventCount =
    readNumber(result.risk_event_count ?? result.riskEventCount) ||
    riskEventInsertedCount;
  const elapsedMs = readNumber(result.elapsed_ms);
  const dryRun = readBoolean(result.dry_run ?? result.dryRun);
  const writeRiskEvents = readBoolean(
    result.write_risk_events ?? result.writeRiskEvents,
  );

  return {
    ...row,
    runType: toUiRunType(row.run_type),
    checked_count: checkedCount,
    checkedCount,
    finding_count: findingCount,
    findingCount,
    critical_count: criticalCount,
    criticalCount,
    risk_event_count: riskEventCount,
    riskEventCount,
    risk_event_inserted_count: riskEventInsertedCount,
    riskEventInsertedCount,
    risk_event_existing_count: riskEventExistingCount,
    riskEventExistingCount,
    risk_event_skipped_count: riskEventSkippedCount,
    riskEventSkippedCount,
    elapsed_ms: elapsedMs,
    elapsedMs,
    ...(dryRun !== null ? { dry_run: dryRun, dryRun } : {}),
    ...(writeRiskEvents !== null
      ? { write_risk_events: writeRiskEvents, writeRiskEvents }
      : {}),
  };
}

function summarizeRuns(items: Array<Record<string, unknown>>) {
  return {
    latestRun: items[0] ?? null,
    latest_run: items[0] ?? null,
    totalRuns: items.length,
    total_runs: items.length,
    checkedCount: sumNumber(items, "checkedCount"),
    checked_count: sumNumber(items, "checkedCount"),
    findingCount: sumNumber(items, "findingCount"),
    finding_count: sumNumber(items, "findingCount"),
    criticalCount: sumNumber(items, "criticalCount"),
    critical_count: sumNumber(items, "criticalCount"),
    riskEventCount: sumNumber(items, "riskEventCount"),
    risk_event_count: sumNumber(items, "riskEventCount"),
  };
}

function sumNumber(items: Array<Record<string, unknown>>, field: string): number {
  return items.reduce((sum, item) => sum + readNumber(item[field]), 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return null;
}
