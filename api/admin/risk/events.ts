import { callRpcRaw } from "../../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  buildNextCursor,
  normalizeUuid,
  parseAdminLimit,
  parseOffsetCursor,
} from "../_shared.js";
import {
  parseRiskEventFilters,
  parseRiskSort,
  serializeRiskEvent,
  summarizeRiskEvents,
  type RiskAssociation,
  type RiskEventRow,
} from "./_shared.js";

type SerializedRiskEvent = Record<string, unknown> & {
  associations?: RiskAssociation[];
};

type RiskEventsRpcPayload = {
  total_count?: number | string | null;
  rows?: unknown;
};

type RiskAssociationSummaryRpcPayload = {
  summaries?: unknown;
};

type RiskAssociationSummaryRow = {
  kind?: unknown;
  source_id?: unknown;
  summary?: unknown;
};

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["risk:read", "admin:read"],
      requireAll: false,
    });

    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const filters = parseRiskEventFilters(req.query);
    const sort = parseRiskSort(req.query.sort);
    const payload = await listRiskEvents(filters, sort, offset, limit);
    const rows = readRows<RiskEventRow>(payload.rows);
    const items = await enrichRiskEventAssociations(
      rows.slice(0, limit).map(serializeRiskEvent),
    );

    return {
      items,
      summary: summarizeRiskEvents(items, readCount(payload.total_count)),
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

async function listRiskEvents(
  filters: ReturnType<typeof parseRiskEventFilters>,
  sort: ReturnType<typeof parseRiskSort>,
  offset: number,
  limit: number,
): Promise<RiskEventsRpcPayload> {
  try {
    return await callRpcRaw<RiskEventsRpcPayload>(
      "admin_list_risk_events",
      {
        p_filters: filters,
        p_sort: sort,
        p_limit: limit,
        p_offset: offset,
      },
      {
        schema: "api" as never,
        context: {
          route: "admin.risk.events",
          sort,
        },
      },
    );
  } catch (error) {
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
}

async function enrichRiskEventAssociations(
  items: SerializedRiskEvent[],
): Promise<SerializedRiskEvent[]> {
  const associationIds = collectAssociationIds(items);
  const summaries = await loadAssociationSummaries(associationIds);

  return items.map((item) => ({
    ...item,
    associations: (item.associations ?? []).map((association) => {
      const summary = summaries.get(associationKey(association));

      if (!summary) {
        return association;
      }

      return {
        ...association,
        summary: {
          ...association.summary,
          ...summary,
          lookup: "loaded",
        },
      };
    }),
  }));
}

function collectAssociationIds(
  items: SerializedRiskEvent[],
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  for (const item of items) {
    for (const association of item.associations ?? []) {
      const kind = association.kind;
      const sourceId = normalizeUuid(
        association.sourceId ?? association.source_id,
      );

      if (!kind || !sourceId) {
        continue;
      }

      const ids = result.get(kind) ?? new Set<string>();
      ids.add(sourceId);
      result.set(kind, ids);
    }
  }

  return result;
}

async function loadAssociationSummaries(
  associationIds: Map<string, Set<string>>,
): Promise<Map<string, Record<string, unknown>>> {
  const requested = Array.from(associationIds.entries()).flatMap(
    ([kind, ids]) =>
      Array.from(ids)
        .slice(0, 100)
        .map((sourceId) => ({
          kind,
          source_id: sourceId,
        })),
  );

  if (requested.length === 0) {
    return new Map();
  }

  let payload: RiskAssociationSummaryRpcPayload;

  try {
    payload = await callRpcRaw<RiskAssociationSummaryRpcPayload>(
      "admin_get_risk_association_summaries",
      {
        p_associations: requested,
      },
      {
        schema: "api" as never,
        context: {
          route: "admin.risk.events.associations",
          associationCount: requested.length,
        },
      },
    );
  } catch (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_ASSOCIATION_LOOKUP_FAILED",
      "风险事件关联对象查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const summaries = new Map<string, Record<string, unknown>>();
  const rows = readRows<RiskAssociationSummaryRow>(payload.summaries);

  for (const row of rows) {
    if (
      typeof row.kind !== "string" ||
      typeof row.source_id !== "string" ||
      !isRecord(row.summary)
    ) {
      continue;
    }

    summaries.set(`${row.kind}:${row.source_id}`, row.summary);
  }

  return summaries;
}

function associationKey(association: RiskAssociation): string {
  return `${association.kind}:${association.sourceId ?? association.source_id}`;
}

function readRows<TRow>(value: unknown): TRow[] {
  return Array.isArray(value) ? (value as TRow[]) : [];
}

function readCount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
