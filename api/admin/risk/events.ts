import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  buildNextCursor,
  parseAdminLimit,
  parseOffsetCursor,
} from "../_shared.js";
import {
  applyRiskEventFiltersToQuery,
  parseRiskEventFilters,
  parseRiskSort,
  RISK_EVENT_COLUMNS,
  serializeRiskEvent,
  severityOrder,
  summarizeRiskEvents,
  type RiskEventFilters,
  type RiskEventRow,
} from "./_shared.js";

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["risk:read", "admin:read"],
      requireAll: false,
    });

    const db = getSupabaseAdminClient();
    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const filters = parseRiskEventFilters(req.query);
    const sort = parseRiskSort(req.query.sort);
    const totalCount = await countRiskEvents(db, filters);
    const rows =
      sort === "created_at"
        ? await listRiskEventsByCreatedAt(db, filters, offset, limit)
        : await listRiskEventsBySeverity(db, filters, offset, limit);
    const items = rows.slice(0, limit).map(serializeRiskEvent);

    return {
      items,
      summary: summarizeRiskEvents(items, totalCount),
      nextCursor: buildNextCursor(rows.length, limit, offset),
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

async function countRiskEvents(
  db: SupabaseAdminClient,
  filters: RiskEventFilters,
): Promise<number> {
  const query = applyRiskEventFiltersToQuery(
    db.schema("ops").from("risk_events").select("id", {
      count: "exact",
      head: true,
    }),
    filters,
  );
  const { count, error } = await query;

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_EVENTS_COUNT_FAILED",
      "风险事件数量查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return count ?? 0;
}

async function listRiskEventsByCreatedAt(
  db: SupabaseAdminClient,
  filters: RiskEventFilters,
  offset: number,
  limit: number,
): Promise<RiskEventRow[]> {
  const query = applyRiskEventFiltersToQuery(
    db.schema("ops").from("risk_events").select(RISK_EVENT_COLUMNS),
    filters,
  );
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_EVENTS_LOOKUP_FAILED",
      "风险事件查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as RiskEventRow[]) : [];
}

async function listRiskEventsBySeverity(
  db: SupabaseAdminClient,
  filters: RiskEventFilters,
  offset: number,
  limit: number,
): Promise<RiskEventRow[]> {
  const rows: RiskEventRow[] = [];
  let remainingOffset = offset;
  const severities = filters.severity ? [filters.severity] : severityOrder();

  for (const severity of severities) {
    const severityFilters = { ...filters, severity };
    const severityCount = await countRiskEvents(db, severityFilters);

    if (remainingOffset >= severityCount) {
      remainingOffset -= severityCount;
      continue;
    }

    const needed = limit + 1 - rows.length;
    const severityRows = await listRiskEventSeverityPage(
      db,
      severityFilters,
      remainingOffset,
      needed,
    );

    rows.push(...severityRows);
    remainingOffset = 0;

    if (rows.length > limit) {
      break;
    }
  }

  return rows;
}

async function listRiskEventSeverityPage(
  db: SupabaseAdminClient,
  filters: RiskEventFilters,
  offset: number,
  needed: number,
): Promise<RiskEventRow[]> {
  if (needed <= 0) {
    return [];
  }

  const query = applyRiskEventFiltersToQuery(
    db.schema("ops").from("risk_events").select(RISK_EVENT_COLUMNS),
    filters,
  );
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + needed - 1);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_EVENTS_LOOKUP_FAILED",
      "风险事件查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as RiskEventRow[]) : [];
}
