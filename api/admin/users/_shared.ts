import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../../packages/server/src/db/supabaseAdmin.js";
import { ApiError } from "../../_shared/handler.js";
import type { AdminContext } from "../../_shared/requireAdmin.js";
import type { ApiContext } from "../../_shared/handler.js";
import {
  buildAdminRpcContext,
  buildNextCursor,
  firstQueryValue,
  hashAuditValue,
  isRecord,
  normalizeRequiredText,
  normalizeRequiredUuid,
  normalizeUuid,
  parseAdminLimit,
  parseOffsetCursor,
  toJsonObject,
  type JsonRecord,
} from "../_shared.js";

export type UserRow = {
  id: string;
  telegram_user_id: number | string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  is_premium: boolean;
  is_bot: boolean;
  photo_url: string | null;
  invite_code: string;
  referred_by_user_id: string | null;
  status: string;
  risk_score: number | string;
  first_seen_at: string;
  last_seen_at: string | null;
  last_auth_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserProfileRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  selected_language: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportTicketRow = {
  id: string;
  user_id: string | null;
  ticket_type: string;
  subject: string;
  message: string | null;
  status: string;
  related_type: string | null;
  related_id: string | null;
  assigned_admin_id: string | null;
  resolved_at: string | null;
  resolution?: string | null;
  rejected_reason?: string | null;
  escalation_owner?: string | null;
  escalation_queue?: string | null;
  status_reason?: string | null;
  last_handled_by_admin_id?: string | null;
  last_handled_at?: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export const USER_COLUMNS = [
  "id",
  "telegram_user_id",
  "username",
  "first_name",
  "last_name",
  "language_code",
  "is_premium",
  "is_bot",
  "photo_url",
  "invite_code",
  "referred_by_user_id",
  "status",
  "risk_score",
  "first_seen_at",
  "last_seen_at",
  "last_auth_at",
  "created_at",
  "updated_at",
].join(",");

export const USER_PROFILE_COLUMNS = [
  "user_id",
  "display_name",
  "avatar_url",
  "selected_language",
  "timezone",
  "created_at",
  "updated_at",
].join(",");

export const SUPPORT_TICKET_COLUMNS = [
  "id",
  "user_id",
  "ticket_type",
  "subject",
  "message",
  "status",
  "related_type",
  "related_id",
  "assigned_admin_id",
  "resolved_at",
  "resolution",
  "rejected_reason",
  "escalation_owner",
  "escalation_queue",
  "status_reason",
  "last_handled_by_admin_id",
  "last_handled_at",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

const SENSITIVE_KEY_RE =
  /(token|secret|service.?role|authorization|cookie|init.?data|private|mnemonic|seed|signature|proof|raw_update|session)/i;

export function getAdminDb(): SupabaseAdminClient {
  return getSupabaseAdminClient();
}

export function getPage(query: Record<string, unknown>): {
  limit: number;
  offset: number;
} {
  return {
    limit: parseAdminLimit(query.limit),
    offset: parseOffsetCursor(query.cursor),
  };
}

export function nextCursorFor<T>(
  rows: T[],
  limit: number,
  offset: number,
): {
  pageRows: T[];
  nextCursor: string | null;
} {
  return {
    pageRows: rows.slice(0, limit),
    nextCursor: buildNextCursor(rows.length, limit, offset),
  };
}

export function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function requireUserId(value: unknown): string {
  return normalizeRequiredUuid(value, "userId");
}

export function optionalUuid(value: unknown): string | undefined {
  return normalizeUuid(firstQueryValue(value));
}

export function serializeUserProfile(
  user: UserRow,
  profile: UserProfileRow | null,
): Record<string, unknown> {
  return {
    id: user.id,
    telegramUserId: user.telegram_user_id,
    telegram_user_id: user.telegram_user_id,
    username: user.username,
    firstName: user.first_name,
    first_name: user.first_name,
    lastName: user.last_name,
    last_name: user.last_name,
    displayName:
      profile?.display_name ??
      [user.first_name, user.last_name].filter(Boolean).join(" ") ??
      user.username,
    display_name:
      profile?.display_name ??
      [user.first_name, user.last_name].filter(Boolean).join(" ") ??
      user.username,
    avatarUrl: profile?.avatar_url ?? user.photo_url,
    avatar_url: profile?.avatar_url ?? user.photo_url,
    languageCode: user.language_code,
    language_code: user.language_code,
    selectedLanguage: profile?.selected_language ?? null,
    selected_language: profile?.selected_language ?? null,
    timezone: profile?.timezone ?? null,
    isPremium: user.is_premium,
    is_premium: user.is_premium,
    isBot: user.is_bot,
    is_bot: user.is_bot,
    inviteCode: user.invite_code,
    invite_code: user.invite_code,
    referredByUserId: user.referred_by_user_id,
    referred_by_user_id: user.referred_by_user_id,
    status: user.status,
    riskScore: user.risk_score,
    risk_score: user.risk_score,
    firstSeenAt: user.first_seen_at,
    first_seen_at: user.first_seen_at,
    lastSeenAt: user.last_seen_at,
    last_seen_at: user.last_seen_at,
    lastAuthAt: user.last_auth_at,
    last_auth_at: user.last_auth_at,
    createdAt: user.created_at,
    created_at: user.created_at,
    updatedAt: maxIso(user.updated_at, profile?.updated_at ?? null),
    updated_at: maxIso(user.updated_at, profile?.updated_at ?? null),
  };
}

export function serializeTicket(
  row: SupportTicketRow,
): Record<string, unknown> {
  const metadata = jsonRecord(row.metadata);
  const resolutionResult =
    metadata.resolution_result ?? metadata.result ?? metadata.handling_result;

  return {
    id: row.id,
    userId: row.user_id,
    user_id: row.user_id,
    ticketType: row.ticket_type,
    ticket_type: row.ticket_type,
    subject: row.subject,
    message: row.message,
    status: row.status,
    relatedType: row.related_type,
    related_type: row.related_type,
    relatedId: row.related_id,
    related_id: row.related_id,
    assignedAdminId: row.assigned_admin_id,
    assigned_admin_id: row.assigned_admin_id,
    resolvedAt: row.resolved_at,
    resolved_at: row.resolved_at,
    resolution: row.resolution ?? null,
    rejectedReason: row.rejected_reason ?? null,
    rejected_reason: row.rejected_reason ?? null,
    resolutionResult: resolutionResult ?? null,
    resolution_result: resolutionResult ?? null,
    escalationOwner: row.escalation_owner ?? null,
    escalation_owner: row.escalation_owner ?? null,
    escalationQueue: row.escalation_queue ?? null,
    escalation_queue: row.escalation_queue ?? null,
    statusReason: row.status_reason ?? null,
    status_reason: row.status_reason ?? null,
    lastHandledByAdminId: row.last_handled_by_admin_id ?? null,
    last_handled_by_admin_id: row.last_handled_by_admin_id ?? null,
    lastHandledAt: row.last_handled_at ?? null,
    last_handled_at: row.last_handled_at ?? null,
    metadataSummary: summarizeMetadata(row.metadata),
    metadata_summary: summarizeMetadata(row.metadata),
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
}

export function summarizeMetadata(value: unknown): Record<string, unknown> {
  const record = isRecord(value) ? value : {};
  const keys = Object.keys(record).filter((key) => !SENSITIVE_KEY_RE.test(key));

  return {
    keys,
    redactedKeys: Object.keys(record).filter((key) =>
      SENSITIVE_KEY_RE.test(key),
    ),
  };
}

export function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[MaxDepth]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item, depth + 1));
  }

  if (isRecord(value)) {
    const output: Record<string, unknown> = {};

    for (const [key, itemValue] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_RE.test(key)
        ? "[REDACTED]"
        : sanitizeJson(itemValue, depth + 1);
    }

    return output;
  }

  return "[UnsupportedValue]";
}

export async function loadProfilesByUserId(
  db: SupabaseAdminClient,
  userIds: string[],
): Promise<Map<string, UserProfileRow>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("core")
    .from("user_profiles")
    .select(USER_PROFILE_COLUMNS)
    .in("user_id", userIds);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USER_PROFILES_LOOKUP_FAILED",
      "用户资料查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return new Map(rows<UserProfileRow>(data).map((row) => [row.user_id, row]));
}

export async function loadUserById(
  db: SupabaseAdminClient,
  userId: string,
): Promise<UserRow> {
  const { data, error } = await db
    .schema("core")
    .from("users")
    .select(USER_COLUMNS)
    .eq("id", userId)
    .maybeSingle<UserRow>();

  if (error) {
    throw new ApiError(500, "ADMIN_USER_LOOKUP_FAILED", "用户查询失败。", {
      expose: false,
      cause: error,
    });
  }

  if (!data) {
    throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  }

  return data;
}

export function buildDataBlock(
  source: string,
  payload: Record<string, unknown>,
  updatedAt: string | null,
): Record<string, unknown> {
  return {
    dataSource: source,
    data_source: source,
    updatedAt,
    updated_at: updatedAt,
    ...payload,
  };
}

export function maxIso(
  ...values: Array<string | null | undefined>
): string | null {
  const normalized = values.filter((value): value is string => Boolean(value));

  if (normalized.length === 0) {
    return null;
  }

  return normalized.sort().at(-1) ?? null;
}

export function normalizeSupportStatus(value: unknown): string | undefined {
  const normalized = firstQueryValue(value)?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "open" ||
    normalized === "pending_user" ||
    normalized === "pending_ops" ||
    normalized === "resolved" ||
    normalized === "rejected" ||
    normalized === "escalated"
  ) {
    return normalized;
  }

  throw new ApiError(400, "VALIDATION_FAILED", "status is not supported");
}

export function normalizeTicketType(value: unknown): string {
  const normalized = normalizeRequiredText(value, "ticketType")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();

  if (
    normalized === "payment" ||
    normalized === "market" ||
    normalized === "inventory" ||
    normalized === "wallet" ||
    normalized === "bug" ||
    normalized === "other"
  ) {
    return normalized;
  }

  throw new ApiError(400, "VALIDATION_FAILED", "ticketType is not supported");
}

export function assertSupportStatusPayload(input: {
  status: string;
  resolution?: string | null | undefined;
  rejectedReason?: string | null | undefined;
  escalationOwner?: string | null | undefined;
  escalationQueue?: string | null | undefined;
}): void {
  if (input.status === "resolved" && !input.resolution?.trim()) {
    throw new ApiError(400, "VALIDATION_FAILED", "resolution is required");
  }

  if (input.status === "rejected" && !input.rejectedReason?.trim()) {
    throw new ApiError(400, "VALIDATION_FAILED", "rejectedReason is required");
  }

  if (
    input.status === "escalated" &&
    !input.escalationOwner?.trim() &&
    !input.escalationQueue?.trim()
  ) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "escalationOwner or escalationQueue is required",
    );
  }
}

export async function writeAdminAudit(input: {
  db: SupabaseAdminClient;
  admin: AdminContext;
  ctx: ApiContext;
  action: string;
  targetTable: string;
  targetId: string | null;
  beforeState: unknown;
  afterState: unknown;
  reason: string | null;
}): Promise<string | null> {
  const { data, error } = await input.db
    .schema("ops")
    .from("admin_audit_logs")
    .insert({
      admin_user_id: input.admin.adminId,
      action: input.action,
      target_schema: "ops",
      target_table: input.targetTable,
      target_id: input.targetId,
      before_state: toJsonObject(
        isRecord(input.beforeState)
          ? input.beforeState
          : { value: input.beforeState },
      ),
      after_state: toJsonObject(
        isRecord(input.afterState)
          ? input.afterState
          : { value: input.afterState },
      ),
      ip_hash: hashAuditValue(input.ctx.ip),
      user_agent: hashAuditValue(input.ctx.userAgent),
      reason: input.reason,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw new ApiError(500, "ADMIN_AUDIT_WRITE_FAILED", "后台审计写入失败。", {
      expose: false,
      cause: error,
    });
  }

  return data?.id ?? null;
}

export function adminContext(admin: AdminContext, ctx: ApiContext) {
  return buildAdminRpcContext(admin, ctx);
}

export function jsonRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}
