import {
  type JsonObject,
  type JsonValue,
  makeRpcAuditContext,
  runWriteRpc,
} from "../db/transactions.js";

export type AdminAuditAction =
  | "admin.login"
  | "admin.logout"
  | "admin.create"
  | "admin.update"
  | "admin.delete"
  | "box.create"
  | "box.update"
  | "drop_pool.publish"
  | "collectible.update"
  | "market.rule_update"
  | "task.update"
  | "feature_flag.update"
  | "user.restrict"
  | "user.balance_adjust"
  | "payment.review"
  | "mint.retry"
  | (string & {});

export interface AdminAuditLogInput {
  adminUserId: string;
  action: AdminAuditAction;
  targetSchema?: string | null | undefined;
  targetTable?: string | null | undefined;
  targetId?: string | null | undefined;
  beforeState?: JsonObject | null | undefined;
  afterState?: JsonObject | null | undefined;
  ipHash?: string | null | undefined;
  userAgent?: string | null | undefined;
  reason?: string | null | undefined;
  traceId?: string | undefined;
}

export interface AdminAuditLogResult {
  auditLogId: string;
  adminUserId: string;
  action: string;
  targetSchema?: string | null | undefined;
  targetTable?: string | null | undefined;
  targetId?: string | null | undefined;
  createdAt?: string | undefined;
}

export type AuditLogErrorCode =
  | "AUDIT_ADMIN_USER_REQUIRED"
  | "AUDIT_ACTION_REQUIRED"
  | "AUDIT_WRITE_FAILED";

export class AuditLogError extends Error {
  override readonly name = "AuditLogError";
  readonly code: AuditLogErrorCode;
  readonly status = 500;
  override readonly cause: unknown;

  constructor(
    message: string,
    options: {
      code: AuditLogErrorCode;
      cause?: unknown;
    },
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.code = options.code;
    this.cause = options.cause;
  }
}

export async function writeAdminAuditLog(
  input: AdminAuditLogInput,
): Promise<AdminAuditLogResult> {
  const adminUserId = normalizeRequiredString(
    input.adminUserId,
    "AUDIT_ADMIN_USER_REQUIRED",
    "adminUserId is required for audit logging.",
  );
  const action = normalizeRequiredString(
    input.action,
    "AUDIT_ACTION_REQUIRED",
    "action is required for audit logging.",
  );

  try {
    const rpcOptions = {
      schema: "api",
      functionName: "admin_write_audit_log",
      args: {
        p_admin_user_id: adminUserId,
        p_action: action,
        p_target_schema: normalizeOptionalString(input.targetSchema),
        p_target_table: normalizeOptionalString(input.targetTable),
        p_target_id: normalizeOptionalString(input.targetId),
        p_before_state: input.beforeState ?? {},
        p_after_state: input.afterState ?? {},
        p_ip_hash: normalizeOptionalString(input.ipHash),
        p_user_agent: normalizeOptionalString(input.userAgent),
        p_reason: normalizeOptionalString(input.reason),
      },
      throwOnNullData: true,
      label: "admin_write_audit_log",
      ...(input.traceId ? { traceId: input.traceId } : {}),
    };

    const result = await runWriteRpc<JsonObject>(rpcOptions);

    return normalizeAuditResult(result, {
      adminUserId,
      action,
      targetSchema: input.targetSchema ?? null,
      targetTable: input.targetTable ?? null,
      targetId: input.targetId ?? null,
    });
  } catch (error) {
    if (error instanceof AuditLogError) {
      throw error;
    }

    throw new AuditLogError("Failed to write admin audit log.", {
      code: "AUDIT_WRITE_FAILED",
      cause: error,
    });
  }
}

export function buildAuditContext(input: {
  adminUserId: string;
  traceId?: string | undefined;
  ipHash?: string | null | undefined;
  userAgentHash?: string | null | undefined;
}): JsonObject {
  const context = {
    userId: input.adminUserId,
    source: "admin",
  };

  return makeRpcAuditContext({
    ...context,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.ipHash ? { ipHash: input.ipHash } : {}),
    ...(input.userAgentHash ? { userAgentHash: input.userAgentHash } : {}),
  });
}

function normalizeAuditResult(
  value: JsonObject,
  fallback: Pick<
    AdminAuditLogResult,
    "adminUserId" | "action" | "targetSchema" | "targetTable" | "targetId"
  >,
): AdminAuditLogResult {
  const auditLogId = getString(value.audit_log_id);

  if (!auditLogId) {
    throw new AuditLogError("Audit RPC did not return audit_log_id.", {
      code: "AUDIT_WRITE_FAILED",
    });
  }

  const result: AdminAuditLogResult = {
    auditLogId,
    adminUserId: getString(value.admin_user_id) ?? fallback.adminUserId,
    action: getString(value.action) ?? fallback.action,
    targetSchema: getString(value.target_schema) ?? fallback.targetSchema,
    targetTable: getString(value.target_table) ?? fallback.targetTable,
    targetId: getString(value.target_id) ?? fallback.targetId,
  };

  const createdAt = getString(value.created_at);
  if (createdAt) {
    result.createdAt = createdAt;
  }

  return result;
}

function normalizeRequiredString(
  value: string | null | undefined,
  code: AuditLogErrorCode,
  message: string,
): string {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    throw new AuditLogError(message, {
      code,
    });
  }

  return normalized;
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getString(value: JsonValue | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}
