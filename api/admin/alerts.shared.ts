import { ApiError } from "../_shared/handler.js";
import {
  firstQueryValue,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeRequiredUuid,
  normalizeUuid,
  type JsonRecord,
} from "./_shared.js";

export type AlertRow = {
  id: string;
  alert_type: string;
  severity: string;
  status: string;
  title: string;
  message: string | null;
  source_type: string;
  source_id: string;
  detail: unknown;
  occurrence_count: number | string;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_by_admin_id: string | null;
  acknowledged_at: string | null;
  resolved_by_admin_id: string | null;
  resolved_at: string | null;
  ignored_by_admin_id: string | null;
  ignored_at: string | null;
  status_reason: string | null;
  resolution_result: string | null;
  created_at: string;
  updated_at: string;
};

export type AlertFilters = {
  statuses?: string[];
  status?: string;
  severity?: string;
  alertType?: string;
  sourceType?: string;
  sourceId?: string;
  from?: string;
  to?: string;
};

export type AlertSort = "severity" | "created_at" | "last_seen_at";

const ALERT_STATUSES = new Set(["open", "acknowledged", "resolved", "ignored"]);
const ALERT_SEVERITIES = new Set(["info", "warning", "critical"]);
const ALERT_SORTS = new Set(["severity", "created_at", "last_seen_at"]);
const ACTIVE_ALERT_STATUSES = ["open", "acknowledged"] as const;
const MAX_SANITIZE_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;
const SENSITIVE_DETAIL_KEY_RE =
  /(^|[_-])(initdata|init_data|authorization|cookie|token|privatekey|private_key|secret|service_role|bot_token|mnemonic|seed|proof|signature)([_-]|$)/i;
const RAW_IP_KEY_RE =
  /(^|[_-])(ip|client_ip|remote_ip|ip_address|remote_addr|x_forwarded_for)([_-]|$)/i;

export function parseAlertFilters(
  queryInput: Record<string, unknown>,
): AlertFilters {
  const filters: AlertFilters = {};
  const statuses = parseAlertStatuses(queryInput.statuses ?? queryInput.status);
  const severity = parseAlertSeverity(queryInput.severity);
  const alertType = normalizeOptionalText(
    firstQueryValue(queryInput.alertType ?? queryInput.alert_type),
  );
  const sourceType = normalizeOptionalText(
    firstQueryValue(queryInput.sourceType ?? queryInput.source_type),
  );
  const sourceId = normalizeOptionalUuidQuery(
    queryInput.sourceId ?? queryInput.source_id,
    "sourceId",
  );
  const from = parseDateBound(queryInput.from, "from");
  const to = parseDateBound(queryInput.to, "to");

  if (statuses === "all") {
    // No status filter.
  } else if (statuses.length === 1) {
    const [status] = statuses;
    if (status) {
      filters.status = status;
    }
  } else {
    filters.statuses = statuses;
  }

  if (severity) {
    filters.severity = severity;
  }

  if (alertType) {
    filters.alertType = alertType;
  }

  if (sourceType) {
    filters.sourceType = sourceType;
  }

  if (sourceId) {
    filters.sourceId = sourceId;
  }

  if (from) {
    filters.from = from;
  }

  if (to) {
    filters.to = to;
  }

  return filters;
}

export function parseAlertSort(value: unknown): AlertSort {
  const sort = firstQueryValue(value)?.trim().toLowerCase();

  if (!sort) {
    return "last_seen_at";
  }

  if (ALERT_SORTS.has(sort)) {
    return sort as AlertSort;
  }

  throw new ApiError(
    400,
    "ADMIN_ALERT_SORT_INVALID",
    "sort must be one of severity, created_at, last_seen_at",
  );
}

export function normalizeAlertId(value: unknown): string {
  return normalizeRequiredUuid(value, "alertId");
}

export function normalizeAlertActionStatus(value: unknown): string {
  const raw = normalizeRequiredText(value, "action").toLowerCase();

  switch (raw) {
    case "ack":
    case "acknowledge":
    case "acknowledged":
      return "acknowledged";
    case "resolve":
    case "resolved":
      return "resolved";
    case "ignore":
    case "ignored":
      return "ignored";
    default:
      throw new ApiError(
        400,
        "ADMIN_ALERT_STATUS_INVALID",
        "action must be ack, resolve, or ignore",
      );
  }
}

export function normalizeResolutionResult(
  value: unknown,
  status: string,
): string | undefined {
  const result = normalizeOptionalText(value);

  if (status === "resolved" && !result) {
    throw new ApiError(
      400,
      "ADMIN_ALERT_RESOLUTION_RESULT_REQUIRED",
      "resolutionResult is required when resolving an alert",
    );
  }

  return result;
}

export function serializeAlert(row: AlertRow): Record<string, unknown> {
  const source = buildAlertSource(row.source_type, row.source_id);

  return {
    id: row.id,
    alert_id: row.id,
    alertId: row.id,
    alert_type: row.alert_type,
    alertType: row.alert_type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    message: row.message,
    source_type: row.source_type,
    sourceType: row.source_type,
    source_id: row.source_id,
    sourceId: row.source_id,
    source,
    detail: sanitizeAlertDetail(row.detail),
    occurrence_count: row.occurrence_count,
    occurrenceCount: row.occurrence_count,
    first_seen_at: row.first_seen_at,
    firstSeenAt: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    lastSeenAt: row.last_seen_at,
    acknowledged_by_admin_id: row.acknowledged_by_admin_id,
    acknowledgedByAdminId: row.acknowledged_by_admin_id,
    acknowledged_at: row.acknowledged_at,
    acknowledgedAt: row.acknowledged_at,
    resolved_by_admin_id: row.resolved_by_admin_id,
    resolvedByAdminId: row.resolved_by_admin_id,
    resolved_at: row.resolved_at,
    resolvedAt: row.resolved_at,
    ignored_by_admin_id: row.ignored_by_admin_id,
    ignoredByAdminId: row.ignored_by_admin_id,
    ignored_at: row.ignored_at,
    ignoredAt: row.ignored_at,
    status_reason: row.status_reason,
    statusReason: row.status_reason,
    resolution_result: row.resolution_result,
    resolutionResult: row.resolution_result,
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at,
  };
}

export function summarizeAlerts(
  items: Array<Record<string, unknown>>,
  totalCount?: number,
): Record<string, unknown> {
  const byStatus: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const item of items) {
    const status = readString(item.status);
    const severity = readString(item.severity);

    if (status) {
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }

    if (severity) {
      bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    }
  }

  return {
    totalCount: totalCount ?? items.length,
    total_count: totalCount ?? items.length,
    pageCount: items.length,
    page_count: items.length,
    openCount: byStatus.open ?? 0,
    open_count: byStatus.open ?? 0,
    acknowledgedCount: byStatus.acknowledged ?? 0,
    acknowledged_count: byStatus.acknowledged ?? 0,
    criticalCount: bySeverity.critical ?? 0,
    critical_count: bySeverity.critical ?? 0,
    byStatus,
    bySeverity,
  };
}

export function sanitizeAlertDetail(value: unknown, depth = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) {
    return "[MaxDepth]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeAlertDetail(item, depth + 1));
  }

  if (!isRecord(value)) {
    if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
      return `${value.slice(0, MAX_STRING_LENGTH)}...`;
    }

    return value;
  }

  const output: JsonRecord = {};

  for (const [key, childValue] of Object.entries(value)) {
    if (SENSITIVE_DETAIL_KEY_RE.test(key) || RAW_IP_KEY_RE.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }

    output[key] = sanitizeAlertDetail(childValue, depth + 1);
  }

  return output;
}

function parseAlertStatuses(value: unknown): string[] | "all" {
  const raw = firstQueryValue(value);

  if (!raw) {
    return [...ACTIVE_ALERT_STATUSES];
  }

  const statuses = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (statuses.length === 1 && statuses[0] === "all") {
    return "all";
  }

  if (statuses.length === 0) {
    return [...ACTIVE_ALERT_STATUSES];
  }

  for (const status of statuses) {
    if (!ALERT_STATUSES.has(status)) {
      throw new ApiError(
        400,
        "ADMIN_ALERT_STATUS_INVALID",
        "status must be one of open, acknowledged, resolved, ignored, all",
      );
    }
  }

  return Array.from(new Set(statuses));
}

function parseAlertSeverity(value: unknown): string | undefined {
  const severity = firstQueryValue(value)?.trim().toLowerCase();

  if (!severity) {
    return undefined;
  }

  if (!ALERT_SEVERITIES.has(severity)) {
    throw new ApiError(
      400,
      "ADMIN_ALERT_SEVERITY_INVALID",
      "severity must be one of info, warning, critical",
    );
  }

  return severity;
}

function parseDateBound(value: unknown, field: string): string | undefined {
  const raw = firstQueryValue(value);

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

function buildAlertSource(sourceType: string, sourceId: string) {
  return {
    source_type: sourceType,
    sourceType,
    source_id: sourceId,
    sourceId,
    route_key: routeKeyForSourceType(sourceType),
    routeKey: routeKeyForSourceType(sourceType),
    label: labelForSourceType(sourceType),
  };
}

function routeKeyForSourceType(sourceType: string): string | null {
  switch (sourceType) {
    case "star_order":
    case "payment_order":
      return "payment-detail";
    case "mint_queue":
      return "mint";
    case "telegram_webhook_event":
    case "webhook_event":
      return "payments";
    case "risk_event":
      return "risk";
    case "reconciliation_run":
      return "reconciliation";
    case "user":
      return "users";
    case "market_listing":
    case "market_order":
      return "market";
    case "gacha_order":
      return "gacha";
    default:
      return null;
  }
}

function labelForSourceType(sourceType: string): string {
  switch (sourceType) {
    case "star_order":
    case "payment_order":
      return "支付";
    case "mint_queue":
      return "Mint";
    case "telegram_webhook_event":
    case "webhook_event":
      return "Webhook";
    case "monitoring_metric":
      return "监控指标";
    case "risk_event":
      return "风险事件";
    case "reconciliation_run":
      return "对账 run";
    case "user":
      return "用户";
    case "market_listing":
      return "市场挂单";
    case "market_order":
      return "市场订单";
    case "gacha_order":
      return "开盒订单";
    default:
      return sourceType;
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
