import type { SupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin.js";
import { ApiError } from "../_shared/handler.js";
import { firstQueryValue, normalizeUuid } from "./_shared.js";

export type AuditRiskLevel = "low" | "medium" | "high";

export type AdminAuditLogRow = {
  id: string;
  admin_user_id: string | null;
  action: string;
  target_schema: string | null;
  target_table: string | null;
  target_id: string | null;
  before_state: unknown;
  after_state: unknown;
  ip_hash: string | null;
  user_agent: string | null;
  reason: string | null;
  created_at: string;
};

export type AdminAuditLogAdminRow = {
  id: string;
  display_name: string | null;
  telegram_user_id: number | string | null;
  email: string | null;
};

export type AdminAuditLogResponseItem = Omit<
  AdminAuditLogRow,
  "before_state" | "after_state"
> & {
  admin: AdminAuditLogAdminRow | null;
  before_state: unknown;
  after_state: unknown;
  request_id: string | null;
  risk_level: AuditRiskLevel;
};

const AUDIT_LOG_COLUMNS = [
  "id",
  "admin_user_id",
  "action",
  "target_schema",
  "target_table",
  "target_id",
  "before_state",
  "after_state",
  "ip_hash",
  "user_agent",
  "reason",
  "created_at",
].join(",");

const ADMIN_SUMMARY_COLUMNS = [
  "id",
  "display_name",
  "telegram_user_id",
  "email",
].join(",");

const MAX_TEXT_FILTER_LENGTH = 128;
const MAX_AUDIT_STATE_JSON_BYTES = 4096;
const SENSITIVE_KEY_RE =
  /(authorization|bot[_-]?token|cookie|init[_-]?data|password|private[_-]?key|secret|service[_-]?role|token|signature|proof|mnemonic|seed)/i;
const HIGH_RISK_ACTION_PATTERNS = [
  "ban",
  "compensate",
  "refund",
  "release",
  "publish",
  "grant",
  "revoke",
  "bootstrap",
  "approval",
  "danger",
  "payment.retry",
  "mint.retry",
] as const;
const MEDIUM_RISK_ACTION_PATTERNS = [
  "create",
  "update",
  "retry",
  "feature_flag",
  "feature-flag",
  "status",
  "audit.export",
] as const;

export async function listAuditLogs(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
  offset: number,
  limit: number,
): Promise<AdminAuditLogRow[]> {
  let query = db
    .schema("ops")
    .from("admin_audit_logs")
    .select(AUDIT_LOG_COLUMNS);
  const adminUserId = normalizeUuidFilter(
    queryInput.adminUserId ?? queryInput.admin_user_id,
    "adminUserId",
  );
  const targetId = normalizeUuidFilter(
    queryInput.targetId ?? queryInput.target_id,
    "targetId",
  );
  const action = normalizeTextFilter(queryInput.action, "action");
  const targetSchema = normalizeTextFilter(
    queryInput.targetSchema ?? queryInput.target_schema,
    "targetSchema",
  );
  const targetTable = normalizeTextFilter(
    queryInput.targetTable ?? queryInput.target_table,
    "targetTable",
  );
  const from = normalizeTimestampFilter(queryInput.from, "from");
  const to = normalizeTimestampFilter(queryInput.to, "to");
  const q = normalizeTextFilter(queryInput.q, "q");
  const riskLevel = normalizeRiskLevelFilter(
    queryInput.riskLevel ?? queryInput.risk_level,
  );

  if (from && to && from > to) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "from must be earlier than to",
    );
  }

  if (adminUserId) {
    query = query.eq("admin_user_id", adminUserId);
  }

  if (action) {
    query = query.ilike("action", `%${action}%`);
  }

  if (targetSchema) {
    query = query.eq("target_schema", targetSchema);
  }

  if (targetTable) {
    query = query.eq("target_table", targetTable);
  }

  if (targetId) {
    query = query.eq("target_id", targetId);
  }

  if (from) {
    query = query.gte("created_at", from);
  }

  if (to) {
    query = query.lte("created_at", to);
  }

  if (q) {
    const uuidQuery = normalizeUuid(q);

    if (uuidQuery) {
      query = query.or(
        [
          `id.eq.${uuidQuery}`,
          `admin_user_id.eq.${uuidQuery}`,
          `target_id.eq.${uuidQuery}`,
        ].join(","),
      );
    } else {
      const safeQuery = toPostgrestOrSearchTerm(q);

      if (safeQuery) {
        query = query.or(
          [
            `action.ilike.%${safeQuery}%`,
            `reason.ilike.%${safeQuery}%`,
            `target_schema.ilike.%${safeQuery}%`,
            `target_table.ilike.%${safeQuery}%`,
          ].join(","),
        );
      }
    }
  }

  if (riskLevel) {
    if (riskLevel === "high") {
      query = query.or(buildRiskActionSearch(HIGH_RISK_ACTION_PATTERNS));
    }

    if (riskLevel === "medium") {
      query = query.or(buildRiskActionSearch(MEDIUM_RISK_ACTION_PATTERNS));
      query = excludeRiskActionPatterns(query, HIGH_RISK_ACTION_PATTERNS);
    }

    if (riskLevel === "low") {
      query = excludeRiskActionPatterns(query, HIGH_RISK_ACTION_PATTERNS);
      query = excludeRiskActionPatterns(query, MEDIUM_RISK_ACTION_PATTERNS);
    }
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_AUDIT_LOGS_LOOKUP_FAILED",
      "审计日志查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as AdminAuditLogRow[]) : [];
}

export async function loadAdminsById(
  db: SupabaseAdminClient,
  rows: AdminAuditLogRow[],
): Promise<Map<string, AdminAuditLogAdminRow>> {
  const adminIds = Array.from(
    new Set(rows.map((row) => row.admin_user_id).filter(isNonEmptyString)),
  );

  if (adminIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("ops")
    .from("admin_users")
    .select(ADMIN_SUMMARY_COLUMNS)
    .in("id", adminIds);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_AUDIT_ADMINS_LOOKUP_FAILED",
      "审计日志管理员信息查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return new Map(
    (Array.isArray(data)
      ? (data as unknown as AdminAuditLogAdminRow[])
      : []
    ).map((admin) => [admin.id, admin]),
  );
}

export function normalizeAuditLogItem(
  row: AdminAuditLogRow,
  admin: AdminAuditLogAdminRow | null,
): AdminAuditLogResponseItem {
  const beforeState = limitAuditState(row.before_state);
  const afterState = limitAuditState(row.after_state);

  return {
    ...row,
    admin,
    before_state: beforeState,
    after_state: afterState,
    request_id: extractRequestId(row.before_state, row.after_state),
    risk_level: mapAuditRiskLevel(row.action),
  };
}

export function mapAuditRiskLevel(action: string): AuditRiskLevel {
  const normalized = action.trim().toLowerCase();

  if (
    HIGH_RISK_ACTION_PATTERNS.some((pattern) => normalized.includes(pattern))
  ) {
    return "high";
  }

  if (
    MEDIUM_RISK_ACTION_PATTERNS.some((pattern) => normalized.includes(pattern))
  ) {
    return "medium";
  }

  return "low";
}

export function summarizeAuditLogs(
  items: AdminAuditLogResponseItem[],
): Record<string, number> {
  const summary: Record<string, number> = {
    total: items.length,
  };

  for (const item of items) {
    summary[item.risk_level] = (summary[item.risk_level] ?? 0) + 1;
  }

  return summary;
}

export function redactSensitiveJson(value: unknown, depth = 0): unknown {
  if (depth > 10) {
    return "[MaxDepth]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveJson(item, depth + 1));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY_RE.test(key)
        ? "[redacted]"
        : redactSensitiveJson(nestedValue, depth + 1),
    ]),
  );
}

export function extractRequestId(
  beforeState: unknown,
  afterState: unknown,
): string | null {
  for (const state of [afterState, beforeState]) {
    const direct =
      readStringKey(state, "request_id") ?? readStringKey(state, "requestId");

    if (direct) {
      return direct;
    }

    const requestContext = readRecordKey(state, "request_context");
    const nested =
      readStringKey(requestContext, "request_id") ??
      readStringKey(requestContext, "requestId");

    if (nested) {
      return nested;
    }
  }

  return null;
}

function normalizeUuidFilter(
  value: unknown,
  field: string,
): string | undefined {
  const raw = firstQueryValue(value);

  if (!raw) {
    return undefined;
  }

  const normalized = normalizeUuid(raw);

  if (!normalized) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be a UUID`);
  }

  return normalized;
}

function normalizeTextFilter(
  value: unknown,
  field: string,
): string | undefined {
  const raw = firstQueryValue(value);

  if (!raw) {
    return undefined;
  }

  if (raw.length > MAX_TEXT_FILTER_LENGTH) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be at most ${MAX_TEXT_FILTER_LENGTH} characters`,
    );
  }

  return raw;
}

function normalizeTimestampFilter(
  value: unknown,
  field: string,
): string | undefined {
  const raw = firstQueryValue(value);

  if (!raw) {
    return undefined;
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a valid datetime`,
    );
  }

  return parsed.toISOString();
}

function normalizeRiskLevelFilter(value: unknown): AuditRiskLevel | undefined {
  const raw = firstQueryValue(value)?.trim().toLowerCase();

  if (!raw) {
    return undefined;
  }

  if (raw === "low" || raw === "medium" || raw === "high") {
    return raw;
  }

  throw new ApiError(
    400,
    "VALIDATION_FAILED",
    "riskLevel must be low, medium, or high",
  );
}

function toPostgrestOrSearchTerm(value: string): string {
  return value
    .replace(/[(),]/g, " ")
    .replace(/[%*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRiskActionSearch(patterns: readonly string[]): string {
  return patterns.map((pattern) => `action.ilike.%${pattern}%`).join(",");
}

function excludeRiskActionPatterns<
  TQuery extends {
    not: (column: string, operator: string, value: string) => TQuery;
  },
>(query: TQuery, patterns: readonly string[]): TQuery {
  let nextQuery = query;

  for (const pattern of patterns) {
    nextQuery = nextQuery.not("action", "ilike", `%${pattern}%`);
  }

  return nextQuery;
}

function limitAuditState(value: unknown): unknown {
  const redacted = redactSensitiveJson(value);
  const serialized = safeStringify(redacted);
  const byteLength = Buffer.byteLength(serialized, "utf8");

  if (byteLength <= MAX_AUDIT_STATE_JSON_BYTES) {
    return redacted;
  }

  return {
    __truncated: true,
    byteLength,
    maxBytes: MAX_AUDIT_STATE_JSON_BYTES,
    summary: summarizeJsonValue(redacted),
  };
}

function summarizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, 5).map(summarizeJsonValue),
    };
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort();

    return {
      type: "object",
      keyCount: keys.length,
      keys: keys.slice(0, 30),
    };
  }

  if (typeof value === "string") {
    return {
      type: "string",
      length: value.length,
      preview: value.slice(0, 120),
    };
  }

  return {
    type: value === null ? "null" : typeof value,
  };
}

function readRecordKey(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function readStringKey(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const nested = value[key];
  return typeof nested === "string" && nested.trim() ? nested : null;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
