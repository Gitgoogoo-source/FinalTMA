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
  hashRiskValue,
  last4,
  parseRiskEventFilters,
  parseRiskSort,
  RISK_EVENT_COLUMNS,
  sanitizeRiskDetail,
  serializeRiskEvent,
  severityOrder,
  shortAddress,
  summarizeRiskEvents,
  type RiskAssociation,
  type RiskEventFilters,
  type RiskEventRow,
} from "./_shared.js";

type SerializedRiskEvent = Record<string, unknown> & {
  associations?: RiskAssociation[];
};

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
    const items = await enrichRiskEventAssociations(
      db,
      rows.slice(0, limit).map(serializeRiskEvent),
    );

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

async function enrichRiskEventAssociations(
  db: SupabaseAdminClient,
  items: SerializedRiskEvent[],
): Promise<SerializedRiskEvent[]> {
  const associationIds = collectAssociationIds(items);
  const summaries = new Map<string, Record<string, unknown>>();

  await Promise.all([
    loadAssociationSummaries(
      db,
      associationIds,
      summaries,
      "payment_order",
      "payments",
      "star_orders",
      "id,status,business_type,business_id,xtr_amount,paid_at,fulfilled_at,created_at",
      paymentSummary,
    ),
    loadAssociationSummaries(
      db,
      associationIds,
      summaries,
      "gacha_order",
      "gacha",
      "draw_orders",
      "id,status,user_id,box_id,draw_count,total_price_stars,payment_status,payment_star_order_id,created_at,paid_at,opened_at",
      gachaOrderSummary,
    ),
    loadAssociationSummaries(
      db,
      associationIds,
      summaries,
      "wallet",
      "core",
      "user_wallets",
      "id,status,chain,network,address,wallet_app_name,wallet_device,verified_at,last_sync_at,created_at",
      walletSummary,
    ),
    loadAssociationSummaries(
      db,
      associationIds,
      summaries,
      "market_listing",
      "market",
      "listings",
      "id,status,seller_user_id,item_count,remaining_count,unit_price_kcoin,price_health,created_at,updated_at",
      marketListingSummary,
    ),
    loadAssociationSummaries(
      db,
      associationIds,
      summaries,
      "market_order",
      "market",
      "orders",
      "id,status,buyer_user_id,seller_user_id,listing_id,item_count,total_price_kcoin,unit_price_kcoin,completed_at,created_at",
      marketOrderSummary,
    ),
    loadAssociationSummaries(
      db,
      associationIds,
      summaries,
      "reconciliation_run",
      "economy",
      "reconciliation_runs",
      "id,run_type,status,started_at,finished_at,error_message",
      reconciliationRunSummary,
    ),
    loadAssociationSummaries(
      db,
      associationIds,
      summaries,
      "mint_queue",
      "onchain",
      "mint_queue",
      "id,status,user_id,item_instance_id,attempt_count,max_attempts,tx_hash,created_at,updated_at,completed_at",
      mintQueueSummary,
    ),
    loadAssociationSummaries(
      db,
      associationIds,
      summaries,
      "referral",
      "tasks",
      "referrals",
      "id,status,inviter_user_id,invitee_user_id,first_open_order_id,qualified_at,rewarded_at,created_at",
      referralSummary,
    ),
  ]);

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
      const sourceId = association.sourceId ?? association.source_id;

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
  db: SupabaseAdminClient,
  associationIds: Map<string, Set<string>>,
  output: Map<string, Record<string, unknown>>,
  kind: string,
  schema:
    | "core"
    | "economy"
    | "gacha"
    | "market"
    | "onchain"
    | "payments"
    | "tasks",
  table:
    | "draw_orders"
    | "listings"
    | "mint_queue"
    | "orders"
    | "reconciliation_runs"
    | "referrals"
    | "star_orders"
    | "user_wallets",
  columns: string,
  summarize: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const ids = [...(associationIds.get(kind) ?? [])].slice(0, 100);

  if (ids.length === 0) {
    return;
  }

  const { data, error } = await db
    .schema(schema)
    .from(table)
    .select(columns)
    .in("id", ids)
    .limit(100);

  if (error) {
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

  const rows = Array.isArray(data)
    ? (data as unknown as Record<string, unknown>[])
    : [];

  for (const row of rows) {
    const id = readString(row.id);

    if (id) {
      output.set(`${kind}:${id}`, summarize(row));
    }
  }
}

function associationKey(association: RiskAssociation): string {
  return `${association.kind}:${association.sourceId ?? association.source_id}`;
}

function paymentSummary(row: Record<string, unknown>): Record<string, unknown> {
  return pickSummary(row, [
    "status",
    "business_type",
    "business_id",
    "xtr_amount",
    "paid_at",
    "fulfilled_at",
    "created_at",
  ]);
}

function gachaOrderSummary(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return pickSummary(row, [
    "status",
    "user_id",
    "box_id",
    "draw_count",
    "total_price_stars",
    "payment_status",
    "payment_star_order_id",
    "created_at",
    "paid_at",
    "opened_at",
  ]);
}

function walletSummary(row: Record<string, unknown>): Record<string, unknown> {
  const address = readString(row.address);

  return {
    ...pickSummary(row, [
      "status",
      "chain",
      "network",
      "wallet_app_name",
      "wallet_device",
      "verified_at",
      "last_sync_at",
      "created_at",
    ]),
    address_short: shortAddress(address),
    address_last4: last4(address),
    address_hash: hashRiskValue(address),
  };
}

function marketListingSummary(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return pickSummary(row, [
    "status",
    "seller_user_id",
    "item_count",
    "remaining_count",
    "unit_price_kcoin",
    "price_health",
    "created_at",
    "updated_at",
  ]);
}

function marketOrderSummary(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return pickSummary(row, [
    "status",
    "buyer_user_id",
    "seller_user_id",
    "listing_id",
    "item_count",
    "total_price_kcoin",
    "unit_price_kcoin",
    "completed_at",
    "created_at",
  ]);
}

function reconciliationRunSummary(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return pickSummary(row, [
    "run_type",
    "status",
    "started_at",
    "finished_at",
    "error_message",
  ]);
}

function mintQueueSummary(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return pickSummary(row, [
    "status",
    "user_id",
    "item_instance_id",
    "attempt_count",
    "max_attempts",
    "tx_hash",
    "created_at",
    "updated_at",
    "completed_at",
  ]);
}

function referralSummary(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return pickSummary(row, [
    "status",
    "inviter_user_id",
    "invitee_user_id",
    "first_open_order_id",
    "qualified_at",
    "rewarded_at",
    "created_at",
  ]);
}

function pickSummary(
  row: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  for (const key of keys) {
    const value = sanitizeRiskDetail(row[key]);

    if (value !== null && value !== undefined && value !== "") {
      summary[key] = value;
    }
  }

  return summary;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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
