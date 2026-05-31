import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  buildPageResult,
  normalizeRunType,
  parseFindingSeverity,
  parseFindingStatus,
  toUiRunType,
} from "./_shared.js";
import {
  firstQueryValue,
  normalizeUuid,
  parseAdminLimit,
  parseOffsetCursor,
} from "../_shared.js";

type RiskEventRow = {
  id: string;
  user_id: string | null;
  event_type: string;
  severity: string;
  status: string;
  source_type: string | null;
  source_id: string | null;
  score_delta: number | string;
  detail: unknown;
  resolved_by_admin_id: string | null;
  resolved_at: string | null;
  created_at: string;
};

type FindingFilters = {
  severity: string | undefined;
  status: string | undefined;
};

const RISK_EVENT_COLUMNS = [
  "id",
  "user_id",
  "event_type",
  "severity",
  "status",
  "source_type",
  "source_id",
  "score_delta",
  "detail",
  "resolved_by_admin_id",
  "resolved_at",
  "created_at",
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
    const runId = normalizeUuid(
      req.query.runId ?? req.query.run_id ?? req.query.reconciliationRunId,
    );
    const filters = parseFindingFilters(req.query);
    const rows = await listFindings(db, req.query, offset, limit, filters);
    const page = buildPageResult(rows, limit, offset);
    const riskEventItems = page.items.map(serializeFinding);
    const items = runId
      ? mergeRiskEventAndRunResultFindings(
          riskEventItems,
          await loadRunResultFindings(db, runId, filters),
        )
      : riskEventItems;

    return {
      items,
      findings: items,
      summary: summarizeFindings(items),
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

async function listFindings(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
  offset: number,
  limit: number,
  filters: FindingFilters,
): Promise<RiskEventRow[]> {
  let query = db.schema("ops").from("risk_events").select(RISK_EVENT_COLUMNS);
  const status = filters.status;
  const severity = filters.severity;
  const runType = normalizeRunType(queryInput.runType ?? queryInput.run_type);
  const runId = normalizeUuid(
    queryInput.runId ?? queryInput.run_id ?? queryInput.reconciliationRunId,
  );
  const sourceId = normalizeUuid(
    queryInput.sourceId ?? queryInput.source_id ?? queryInput.source,
  );
  const sourceType = firstQueryValue(
    queryInput.sourceType ?? queryInput.source_type,
  )?.trim();
  const source = firstQueryValue(queryInput.source)?.trim();
  const q = firstQueryValue(queryInput.q);

  query = query
    .not("detail->>reconciliation_run_id", "is", null)
    .not("detail->>reconciliation_run_type", "is", null);

  if (status) {
    query = query.eq("status", status);
  }

  if (severity) {
    query = query.eq("severity", severity);
  }

  if (runType) {
    query = query.eq("detail->>reconciliation_run_type", runType);
  }

  if (runId) {
    query = query.eq("detail->>reconciliation_run_id", runId);
  }

  if (sourceId) {
    query = query.eq("source_id", sourceId);
  } else if (sourceType) {
    query = query.eq("source_type", sourceType);
  } else if (source) {
    query = query.eq("source_type", source);
  } else if (q) {
    const qUuid = normalizeUuid(q);
    query = qUuid ? query.eq("id", qUuid) : query.ilike("event_type", `%${q}%`);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RECONCILIATION_FINDINGS_LOOKUP_FAILED",
      "对账问题查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as RiskEventRow[]) : [];
}

function serializeFinding(row: RiskEventRow): Record<string, unknown> {
  const detail = asRecord(row.detail);
  const runType =
    typeof detail.reconciliation_run_type === "string"
      ? detail.reconciliation_run_type
      : null;

  return {
    ...row,
    risk_event_id: row.id,
    riskEventId: row.id,
    code: row.event_type,
    message: readString(detail.message) ?? row.event_type,
    sourceType: row.source_type,
    sourceId: row.source_id,
    userId: row.user_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedByAdminId: row.resolved_by_admin_id,
    reconciliation_run_id: readString(detail.reconciliation_run_id),
    reconciliationRunId: readString(detail.reconciliation_run_id),
    reconciliation_run_type: runType,
    reconciliationRunType: toUiRunType(runType),
    star_order_id: readString(detail.star_order_id),
    starOrderId: readString(detail.star_order_id),
    draw_order_id: readString(detail.draw_order_id),
    drawOrderId: readString(detail.draw_order_id),
    payment_charge_id: readString(detail.payment_charge_id),
    paymentChargeId: readString(detail.payment_charge_id),
    mint_queue_id: readString(detail.mint_queue_id),
    mintQueueId: readString(detail.mint_queue_id),
    tx_hash: readString(detail.tx_hash),
    txHash: readString(detail.tx_hash),
    suggested_action: readString(detail.suggested_action),
    suggestedAction: readString(detail.suggested_action),
  };
}

async function loadRunResultFindings(
  db: SupabaseAdminClient,
  runId: string,
  filters: FindingFilters,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db
    .schema("economy")
    .from("reconciliation_runs")
    .select("id,run_type,started_at,result")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RECONCILIATION_RUN_LOOKUP_FAILED",
      "对账运行记录查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const row = asRecord(data);
  const result = asRecord(row.result);
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const runType = readString(row.run_type);
  const startedAt = readString(row.started_at);

  return findings
    .filter((finding): finding is Record<string, unknown> =>
      Boolean(asRecord(finding)),
    )
    .map((finding, index) =>
      serializeRunResultFinding(finding, {
        index,
        runId,
        runType,
        startedAt,
      }),
    )
    .filter((finding) => matchesFindingFilters(finding, filters));
}

function parseFindingFilters(
  queryInput: Record<string, unknown>,
): FindingFilters {
  return {
    severity: parseFindingSeverity(queryInput.severity),
    status: parseFindingStatus(queryInput.status),
  };
}

function matchesFindingFilters(
  finding: Record<string, unknown>,
  filters: FindingFilters,
): boolean {
  if (
    filters.severity &&
    readString(finding.severity)?.toLowerCase() !== filters.severity
  ) {
    return false;
  }

  if (
    filters.status &&
    readString(finding.status)?.toLowerCase() !== filters.status
  ) {
    return false;
  }

  return true;
}

function serializeRunResultFinding(
  finding: Record<string, unknown>,
  input: {
    index: number;
    runId: string;
    runType: string | null;
    startedAt: string | null;
  },
): Record<string, unknown> {
  const sourceType = readString(finding.source_type);
  const sourceId = readString(finding.source_id);
  const suggestedAction = readString(finding.suggested_action);

  return {
    id: `${input.runId}:${input.index}`,
    code: readString(finding.code) ?? "reconciliation_finding",
    message: readString(finding.message) ?? "对账异常",
    severity: readString(finding.severity) ?? "medium",
    status: "open",
    source_type: sourceType,
    sourceType,
    source_id: sourceId,
    sourceId,
    user_id: readString(finding.user_id),
    userId: readString(finding.user_id),
    detail: asRecord(finding.detail),
    created_at: input.startedAt,
    createdAt: input.startedAt,
    reconciliation_run_id: input.runId,
    reconciliationRunId: input.runId,
    reconciliation_run_type: input.runType,
    reconciliationRunType: toUiRunType(input.runType),
    star_order_id: readString(finding.star_order_id),
    starOrderId: readString(finding.star_order_id),
    draw_order_id: readString(finding.draw_order_id),
    drawOrderId: readString(finding.draw_order_id),
    payment_charge_id: readString(finding.payment_charge_id),
    paymentChargeId: readString(finding.payment_charge_id),
    mint_queue_id: readString(finding.mint_queue_id),
    mintQueueId: readString(finding.mint_queue_id),
    tx_hash: readString(finding.tx_hash),
    txHash: readString(finding.tx_hash),
    suggested_action: suggestedAction,
    suggestedAction,
    dry_run: true,
    dryRun: true,
  };
}

function summarizeFindings(items: Array<Record<string, unknown>>) {
  const riskEventCount = items.filter(hasRiskEventId).length;

  return {
    findingCount: items.length,
    finding_count: items.length,
    criticalCount: items.filter((item) => item.severity === "critical").length,
    critical_count: items.filter((item) => item.severity === "critical").length,
    riskEventCount,
    risk_event_count: riskEventCount,
  };
}

function hasRiskEventId(item: Record<string, unknown>): boolean {
  return Boolean(readString(item.risk_event_id) ?? readString(item.riskEventId));
}

function mergeRiskEventAndRunResultFindings(
  riskEventItems: Array<Record<string, unknown>>,
  runResultItems: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (runResultItems.length === 0) {
    return riskEventItems;
  }

  const riskEventKeys = new Set(
    riskEventItems.map(buildBusinessFindingKey).filter(Boolean),
  );
  const missingRunResultItems = runResultItems.filter((item) => {
    const key = buildBusinessFindingKey(item);

    return !key || !riskEventKeys.has(key);
  });

  return [...riskEventItems, ...missingRunResultItems];
}

function buildBusinessFindingKey(item: Record<string, unknown>): string | null {
  const code = readString(item.code ?? item.event_type);
  const sourceType = readString(item.sourceType ?? item.source_type);
  const sourceId = readString(item.sourceId ?? item.source_id);

  if (!code || !sourceType || !sourceId) {
    return null;
  }

  return `${code}:${sourceType}:${sourceId}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
