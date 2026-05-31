import { createHash } from "node:crypto";

import { ApiError } from "../../_shared/handler.js";
import {
  asJsonRecord,
  firstQueryValue,
  isRecord,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeRequiredUuid,
  normalizeUuid,
  toJsonObject,
  type JsonRecord,
} from "../_shared.js";

export type RiskEventRow = {
  id: string;
  user_id: string | null;
  event_type: string;
  severity: string;
  status: string;
  source_type: string | null;
  source_id: string | null;
  score_delta: number | string | null;
  detail: unknown;
  resolved_by_admin_id: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type RiskAssociation = {
  kind: string;
  label: string;
  sourceType: string;
  source_type: string;
  sourceId: string;
  source_id: string;
  routeKey: string | null;
  route_key: string | null;
  summary: Record<string, unknown>;
};

export type UserFlagRow = {
  id: string;
  user_id: string;
  flag_code: string;
  flag_level: string;
  reason: string | null;
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_by_admin_id: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type RiskEventFilters = {
  severity?: string;
  status?: string;
  eventType?: string;
  userId?: string;
  sourceId?: string;
  sourceType?: string;
  from?: string;
  to?: string;
};

export type RiskEventSort = "severity" | "created_at";
type RiskEventFilterQuery<TQuery> = {
  eq(column: string, value: unknown): TQuery;
  gte(column: string, value: unknown): TQuery;
  lte(column: string, value: unknown): TQuery;
};

const RISK_EVENT_STATUSES = new Set([
  "open",
  "reviewing",
  "resolved",
  "ignored",
  "fixed",
  "false_positive",
  "escalated",
]);
const RISK_EVENT_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const USER_FLAG_LEVELS = new Set(["info", "warning", "restriction", "ban"]);
const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
const SENSITIVE_KEY_RE =
  /(^|[_-])(initdata|init_data|authorization|cookie|token|privatekey|private_key|secret|service_role|bot_token|mnemonic|seed|proof_signature)([_-]|$)/i;
const RAW_IP_KEY_RE =
  /(^|[_-])(ip|client_ip|remote_ip|ip_address|remote_addr|x_forwarded_for)([_-]|$)/i;
const MAX_SANITIZE_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;
const ASSOCIATION_KIND_BY_KEY: Record<string, string> = {
  business_id: "payment_order",
  businessId: "payment_order",
  draw_order_id: "gacha_order",
  drawOrderId: "gacha_order",
  gacha_order_id: "gacha_order",
  gachaOrderId: "gacha_order",
  listing_id: "market_listing",
  listingId: "market_listing",
  market_listing_id: "market_listing",
  marketListingId: "market_listing",
  market_order_id: "market_order",
  marketOrderId: "market_order",
  mint_queue_id: "mint_queue",
  mintQueueId: "mint_queue",
  payment_order_id: "payment_order",
  paymentOrderId: "payment_order",
  payment_star_order_id: "payment_order",
  paymentStarOrderId: "payment_order",
  reconciliation_run_id: "reconciliation_run",
  reconciliationRunId: "reconciliation_run",
  star_order_id: "payment_order",
  starOrderId: "payment_order",
  user_wallet_id: "wallet",
  userWalletId: "wallet",
  wallet_id: "wallet",
  walletId: "wallet",
};
const SOURCE_KIND_BY_TYPE: Record<string, string> = {
  draw_order: "gacha_order",
  gacha_order: "gacha_order",
  ledger: "ledger",
  market_listing: "market_listing",
  market_order: "market_order",
  mint_queue: "mint_queue",
  payment_order: "payment_order",
  reconciliation_run: "reconciliation_run",
  referral: "referral",
  star_order: "payment_order",
  user_wallet: "wallet",
  wallet: "wallet",
};

export const RISK_EVENT_COLUMNS = [
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

export const USER_FLAG_COLUMNS = [
  "id",
  "user_id",
  "flag_code",
  "flag_level",
  "reason",
  "active",
  "starts_at",
  "ends_at",
  "created_by_admin_id",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

export function parseRiskEventFilters(
  queryInput: Record<string, unknown>,
): RiskEventFilters {
  const filters: RiskEventFilters = {};
  const severity = parseRiskSeverity(queryInput.severity);
  const status = parseRiskStatus(queryInput.status);
  const eventType = normalizeOptionalText(
    firstQueryValue(queryInput.eventType ?? queryInput.event_type),
  );
  const userId = normalizeOptionalUuidQuery(
    queryInput.userId ?? queryInput.user_id,
    "userId",
  );
  const sourceId = normalizeOptionalUuidQuery(
    queryInput.sourceId ?? queryInput.source_id,
    "sourceId",
  );
  const sourceType = normalizeOptionalText(
    firstQueryValue(queryInput.sourceType ?? queryInput.source_type),
  );
  const from = parseDateBound(queryInput.from, "from", "start");
  const to = parseDateBound(queryInput.to, "to", "end");

  if (severity) {
    filters.severity = severity;
  }

  if (status) {
    filters.status = status;
  }

  if (eventType) {
    filters.eventType = eventType;
  }

  if (userId) {
    filters.userId = userId;
  }

  if (sourceId) {
    filters.sourceId = sourceId;
  }

  if (sourceType) {
    filters.sourceType = sourceType;
  }

  if (from) {
    filters.from = from;
  }

  if (to) {
    filters.to = to;
  }

  return filters;
}

export function parseRiskSort(value: unknown): RiskEventSort {
  const sort = firstQueryValue(value)?.trim().toLowerCase();

  if (!sort) {
    return "severity";
  }

  if (sort === "severity" || sort === "created_at") {
    return sort;
  }

  throw new ApiError(
    400,
    "RISK_EVENT_SORT_INVALID",
    "sort must be one of severity or created_at",
  );
}

export function parseRiskSeverity(value: unknown): string | undefined {
  const severity = firstQueryValue(value)?.trim().toLowerCase();

  if (!severity) {
    return undefined;
  }

  if (!RISK_EVENT_SEVERITIES.has(severity)) {
    throw new ApiError(
      400,
      "RISK_EVENT_SEVERITY_INVALID",
      "severity must be one of low, medium, high, critical",
    );
  }

  return severity;
}

export function parseRiskStatus(value: unknown): string | undefined {
  const status = firstQueryValue(value)?.trim().toLowerCase();

  if (!status) {
    return undefined;
  }

  if (!RISK_EVENT_STATUSES.has(status)) {
    throw new ApiError(
      400,
      "RISK_EVENT_STATUS_INVALID",
      "status is not supported for risk events",
    );
  }

  return status;
}

export function normalizeResolveRiskStatus(value: unknown): string {
  const status = normalizeRequiredText(value, "status").toLowerCase();

  if (
    status === "reviewing" ||
    status === "ignored" ||
    status === "fixed" ||
    status === "false_positive" ||
    status === "escalated" ||
    status === "resolved"
  ) {
    return status;
  }

  throw new ApiError(
    400,
    "RISK_EVENT_STATUS_INVALID",
    "status must be one of reviewing, ignored, fixed, false_positive, escalated, resolved",
  );
}

export function normalizeUserFlagLevel(value: unknown): string {
  const level = normalizeOptionalText(value)?.toLowerCase() ?? "restriction";

  if (!USER_FLAG_LEVELS.has(level)) {
    throw new ApiError(
      400,
      "USER_FLAG_LEVEL_INVALID",
      "flagLevel must be one of info, warning, restriction, ban",
    );
  }

  return level;
}

export function normalizeOptionalIsoDateTime(
  value: unknown,
  field: string,
): string | undefined {
  const raw = normalizeOptionalText(value);

  if (!raw) {
    return undefined;
  }

  const parsed = Date.parse(raw);

  if (!Number.isFinite(parsed)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a valid ISO date-time`,
    );
  }

  return new Date(parsed).toISOString();
}

export function normalizeRiskEventId(value: unknown): string {
  return normalizeRequiredUuid(value, "riskEventId");
}

export function normalizeRiskUserId(value: unknown): string {
  return normalizeRequiredUuid(firstQueryValue(value), "userId");
}

export function normalizeJsonMetadata(value: unknown): ReturnType<typeof toJsonObject> {
  return toJsonObject(asJsonRecord(sanitizeRiskDetail(value)));
}

export function serializeRiskEvent(row: RiskEventRow): Record<string, unknown> {
  const associations = buildRiskAssociations(row);

  return {
    id: row.id,
    risk_event_id: row.id,
    riskEventId: row.id,
    user_id: row.user_id,
    userId: row.user_id,
    event_type: row.event_type,
    eventType: row.event_type,
    severity: row.severity,
    status: row.status,
    source_type: row.source_type,
    sourceType: row.source_type,
    source_id: row.source_id,
    sourceId: row.source_id,
    score_delta: row.score_delta,
    scoreDelta: row.score_delta,
    detail: sanitizeRiskDetail(row.detail),
    resolved_by_admin_id: row.resolved_by_admin_id,
    resolvedByAdminId: row.resolved_by_admin_id,
    resolved_at: row.resolved_at,
    resolvedAt: row.resolved_at,
    created_at: row.created_at,
    createdAt: row.created_at,
    associations,
  };
}

export function buildRiskAssociations(row: RiskEventRow): RiskAssociation[] {
  const associations = new Map<string, RiskAssociation>();
  const sourceType = readString(row.source_type);
  const sourceId = readString(row.source_id);

  if (sourceType && sourceId) {
    addAssociation(associations, {
      kind: kindFromSourceType(sourceType),
      sourceType,
      sourceId,
      summary: {
        origin: "source",
        event_type: row.event_type,
      },
    });
  }

  collectAssociationsFromDetail(
    sanitizeRiskDetail(row.detail),
    associations,
    {},
    0,
  );

  return Array.from(associations.values());
}

export function serializeUserFlag(row: UserFlagRow): Record<string, unknown> {
  return {
    id: row.id,
    user_id: row.user_id,
    userId: row.user_id,
    flag_code: row.flag_code,
    flagCode: row.flag_code,
    flag_level: row.flag_level,
    flagLevel: row.flag_level,
    reason: row.reason,
    active: row.active,
    starts_at: row.starts_at,
    startsAt: row.starts_at,
    ends_at: row.ends_at,
    endsAt: row.ends_at,
    created_by_admin_id: row.created_by_admin_id,
    createdByAdminId: row.created_by_admin_id,
    metadata: sanitizeRiskDetail(row.metadata),
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at,
  };
}

export function summarizeRiskEvents(
  items: Array<Record<string, unknown>>,
  totalCount?: number,
): Record<string, unknown> {
  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const item of items) {
    const severity = readString(item.severity);
    const status = readString(item.status);

    if (severity) {
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    }

    if (status) {
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
  }

  return {
    totalCount: totalCount ?? items.length,
    total_count: totalCount ?? items.length,
    pageCount: items.length,
    page_count: items.length,
    criticalCount: bySeverity.critical ?? 0,
    critical_count: bySeverity.critical ?? 0,
    bySeverity,
    byStatus,
  };
}

export function applyRiskEventFiltersToQuery<
  TQuery extends RiskEventFilterQuery<TQuery>,
>(
  query: TQuery,
  filters: RiskEventFilters,
): TQuery {
  let nextQuery = query;

  if (filters.severity) {
    nextQuery = nextQuery.eq("severity", filters.severity);
  }

  if (filters.status) {
    nextQuery = nextQuery.eq("status", filters.status);
  }

  if (filters.eventType) {
    nextQuery = nextQuery.eq("event_type", filters.eventType);
  }

  if (filters.userId) {
    nextQuery = nextQuery.eq("user_id", filters.userId);
  }

  if (filters.sourceId) {
    nextQuery = nextQuery.eq("source_id", filters.sourceId);
  }

  if (filters.sourceType) {
    nextQuery = nextQuery.eq("source_type", filters.sourceType);
  }

  if (filters.from) {
    nextQuery = nextQuery.gte("created_at", filters.from);
  }

  if (filters.to) {
    nextQuery = nextQuery.lte("created_at", filters.to);
  }

  return nextQuery;
}

export function severityOrder(): readonly string[] {
  return SEVERITY_ORDER;
}

function collectAssociationsFromDetail(
  value: unknown,
  associations: Map<string, RiskAssociation>,
  context: Record<string, unknown>,
  depth: number,
): void {
  if (depth > 4 || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item) =>
      collectAssociationsFromDetail(item, associations, context, depth + 1),
    );
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const nextContext = {
    ...context,
    ...collectAssociationSummary(value),
  };

  for (const [key, childValue] of Object.entries(value)) {
    const kind = ASSOCIATION_KIND_BY_KEY[key];
    const sourceId = readString(childValue);

    if (kind && sourceId) {
      addAssociation(associations, {
        kind,
        sourceType: sourceTypeFromKind(kind),
        sourceId,
        summary: {
          ...nextContext,
          field: key,
        },
      });
      continue;
    }

    collectAssociationsFromDetail(
      childValue,
      associations,
      nextContext,
      depth + 1,
    );
  }
}

function collectAssociationSummary(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  for (const key of [
    "status",
    "event_type",
    "reconciliation_run_type",
    "message",
    "suggested_action",
    "reason",
  ]) {
    const text = readString(value[key]);

    if (text) {
      summary[key] = text;
    }
  }

  return summary;
}

function addAssociation(
  associations: Map<string, RiskAssociation>,
  input: {
    kind: string;
    sourceType: string;
    sourceId: string;
    summary: Record<string, unknown>;
  },
): void {
  const key = `${input.kind}:${input.sourceId}`;

  if (associations.has(key)) {
    return;
  }

  associations.set(key, {
    kind: input.kind,
    label: labelForAssociationKind(input.kind),
    sourceType: input.sourceType,
    source_type: input.sourceType,
    sourceId: input.sourceId,
    source_id: input.sourceId,
    routeKey: routeKeyForAssociationKind(input.kind),
    route_key: routeKeyForAssociationKind(input.kind),
    summary: input.summary,
  });
}

function kindFromSourceType(sourceType: string): string {
  return SOURCE_KIND_BY_TYPE[sourceType] ?? sourceType;
}

function sourceTypeFromKind(kind: string): string {
  switch (kind) {
    case "gacha_order":
      return "gacha_order";
    case "market_listing":
      return "market_listing";
    case "market_order":
      return "market_order";
    case "payment_order":
      return "payment_order";
    case "reconciliation_run":
      return "reconciliation_run";
    case "wallet":
      return "wallet";
    default:
      return kind;
  }
}

function labelForAssociationKind(kind: string): string {
  switch (kind) {
    case "gacha_order":
      return "订单";
    case "market_listing":
      return "市场挂单";
    case "market_order":
      return "市场订单";
    case "payment_order":
      return "支付";
    case "reconciliation_run":
      return "对账 run";
    case "wallet":
      return "钱包";
    case "mint_queue":
      return "Mint";
    case "referral":
      return "邀请";
    case "ledger":
      return "账本";
    default:
      return kind;
  }
}

function routeKeyForAssociationKind(kind: string): string | null {
  switch (kind) {
    case "payment_order":
      return "payment-detail";
    case "reconciliation_run":
      return "reconciliation";
    case "wallet":
      return "wallets";
    case "market_listing":
    case "market_order":
      return "market";
    case "mint_queue":
      return "mint";
    case "gacha_order":
      return "gacha";
    default:
      return null;
  }
}

export function sanitizeRiskDetail(value: unknown, depth = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) {
    return "[MaxDepth]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeRiskDetail(item, depth + 1));
  }

  if (!isRecord(value)) {
    if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
      return `${value.slice(0, MAX_STRING_LENGTH)}...`;
    }

    return value;
  }

  const output: JsonRecord = {};

  for (const [key, childValue] of Object.entries(value)) {
    if (isSensitiveDetailKey(key)) {
      output[key] = "[REDACTED]";
      continue;
    }

    output[key] = sanitizeRiskDetail(childValue, depth + 1);
  }

  return output;
}

export function shortAddress(value: string | null | undefined): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.length <= 10) {
    return normalized;
  }

  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

export function last4(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(-4) : null;
}

export function hashRiskValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return createHash("sha256").update(normalized).digest("hex");
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeOptionalUuidQuery(
  value: unknown,
  field: string,
): string | undefined {
  const raw = firstQueryValue(value);

  if (!raw) {
    return undefined;
  }

  const uuid = normalizeUuid(raw);

  if (!uuid) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be a UUID`);
  }

  return uuid;
}

function parseDateBound(
  value: unknown,
  field: string,
  bound: "start" | "end",
): string | undefined {
  const raw = firstQueryValue(value);

  if (!raw) {
    return undefined;
  }

  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T${bound === "start" ? "00:00:00.000" : "23:59:59.999"}Z`
    : raw;
  const parsed = Date.parse(candidate);

  if (!Number.isFinite(parsed)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a valid date or ISO date-time`,
    );
  }

  return new Date(parsed).toISOString();
}

function isSensitiveDetailKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");

  if (SENSITIVE_KEY_RE.test(normalized)) {
    return true;
  }

  if (
    compact.includes("initdata") ||
    compact.includes("authorization") ||
    compact.includes("privatekey") ||
    compact.includes("servicerole") ||
    compact.includes("bottoken") ||
    compact === "token" ||
    compact.endsWith("token") ||
    compact.endsWith("secret")
  ) {
    return true;
  }

  if (RAW_IP_KEY_RE.test(normalized)) {
    return !normalized.endsWith("_hash") && !normalized.endsWith("hash");
  }

  if (
    compact === "ip" ||
    compact === "clientip" ||
    compact === "remoteip" ||
    compact === "ipaddress" ||
    compact === "remoteaddr" ||
    compact === "xforwardedfor"
  ) {
    return !compact.endsWith("hash");
  }

  return false;
}
