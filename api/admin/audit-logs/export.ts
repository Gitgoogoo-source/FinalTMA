import type { VercelResponse } from "@vercel/node";

import { parseJsonBody } from "../../_shared/parseBody.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import { getSupabaseAdminClient } from "../../../packages/server/src/db/supabaseAdmin.js";
import {
  ADMIN_AUDIT_ACTIONS,
  writeAdminAuditLog,
} from "../../../packages/server/src/security/auditLog.js";
import {
  asJsonRecord,
  firstQueryValue,
  hashAuditValue,
  isRecord,
  normalizeRequiredText,
  toJsonObject,
} from "../_shared.js";
import {
  extractRequestId,
  listAuditLogs,
  loadAdminsById,
  mapAuditRiskLevel,
  redactSensitiveJson,
  type AdminAuditLogAdminRow,
  type AdminAuditLogRow,
} from "../audit-logs.shared.js";

const MAX_EXPORT_ROWS = 1000;
const MIN_EXPORT_REASON_LENGTH = 5;
const SENSITIVE_KEY_RE =
  /(authorization|bot[_-]?token|cookie|init[_-]?data|password|private[_-]?key|secret|service[_-]?role|token|signature|proof|mnemonic|seed)/i;
const CSV_HEADERS = [
  "id",
  "created_at",
  "admin_user_id",
  "admin_display_name",
  "admin_telegram_user_id",
  "admin_email",
  "action",
  "risk_level",
  "target_schema",
  "target_table",
  "target_id",
  "reason",
  "request_id",
  "ip_hash",
  "user_agent_hash",
  "before_summary",
  "after_summary",
] as const;

export default withApiHandler(
  async (req, res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: "audit:export",
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );
    const reason = normalizeExportReason(body.reason);
    const filters = getExportFilters(body);
    const db = getSupabaseAdminClient();
    const rows = await listAuditLogs(db, filters, 0, MAX_EXPORT_ROWS);

    if (rows.length > MAX_EXPORT_ROWS) {
      throw new ApiError(
        400,
        "ADMIN_AUDIT_EXPORT_TOO_LARGE",
        "审计日志导出结果超过上限，请缩小筛选范围。",
        {
          details: {
            maxRows: MAX_EXPORT_ROWS,
          },
        },
      );
    }

    const adminsById = await loadAdminsById(db, rows);
    const auditResult = await writeAdminAuditLog({
      adminUserId: admin.adminId,
      action: ADMIN_AUDIT_ACTIONS.auditExport,
      targetSchema: "ops",
      targetTable: "admin_audit_logs",
      beforeState: {},
      afterState: toJsonObject({
        request_id: ctx.requestId,
        filters: normalizeFiltersForAudit(filters),
        format: "csv",
        row_count: rows.length,
        max_rows: MAX_EXPORT_ROWS,
      }),
      ipHash: hashAuditValue(ctx.ip),
      userAgent: hashAuditValue(ctx.userAgent),
      reason,
      traceId: ctx.requestId,
    });
    const csv = buildAuditLogsCsv(rows, adminsById);

    sendCsv(res, csv, auditResult.auditLogId);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "admin.write",
    },
  },
);

function normalizeExportReason(value: unknown): string {
  const reason = normalizeRequiredText(value, "reason");

  if (reason.length < MIN_EXPORT_REASON_LENGTH) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `reason must be at least ${MIN_EXPORT_REASON_LENGTH} characters`,
    );
  }

  return reason;
}

function getExportFilters(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const filters = body.filters;
  return isRecord(filters) ? filters : body;
}

function normalizeFiltersForAudit(
  filters: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const filterKeys = [
    ["adminUserId", "adminUserId", "admin_user_id"],
    ["action", "action"],
    ["targetSchema", "targetSchema", "target_schema"],
    ["targetTable", "targetTable", "target_table"],
    ["targetId", "targetId", "target_id"],
    ["from", "from"],
    ["to", "to"],
    ["riskLevel", "riskLevel", "risk_level"],
    ["q", "q"],
  ] as const;

  for (const [canonicalKey, ...inputKeys] of filterKeys) {
    const value = inputKeys
      .map((key) => firstQueryValue(filters[key]))
      .find((item): item is string => Boolean(item));

    if (value) {
      result[canonicalKey] = value;
    }
  }

  return result;
}

function buildAuditLogsCsv(
  rows: AdminAuditLogRow[],
  adminsById: Map<string, AdminAuditLogAdminRow>,
): string {
  const lines = [
    CSV_HEADERS.map(escapeCsvCell).join(","),
    ...rows.map((row) => {
      const admin = adminsById.get(row.admin_user_id ?? "") ?? null;
      const cells = [
        row.id,
        row.created_at,
        row.admin_user_id,
        admin?.display_name,
        admin?.telegram_user_id,
        admin?.email,
        row.action,
        mapAuditRiskLevel(row.action),
        row.target_schema,
        row.target_table,
        row.target_id,
        row.reason,
        extractRequestId(row.before_state, row.after_state),
        row.ip_hash,
        row.user_agent,
        summarizeAuditStateForCsv(row.before_state),
        summarizeAuditStateForCsv(row.after_state),
      ];

      return cells.map(escapeCsvCell).join(",");
    }),
  ];

  return `\uFEFF${lines.join("\n")}\n`;
}

function summarizeAuditStateForCsv(value: unknown): string {
  const redacted = redactSensitiveJson(value);

  if (redacted === null || redacted === undefined) {
    return "null";
  }

  if (Array.isArray(redacted)) {
    return `array(length=${redacted.length})`;
  }

  if (isRecord(redacted)) {
    const keys = Object.keys(redacted)
      .map((key) => (SENSITIVE_KEY_RE.test(key) ? "[redacted_key]" : key))
      .sort();
    const keySummary =
      keys.length > 20
        ? `${keys.slice(0, 20).join("|")}|+${keys.length - 20}`
        : keys.join("|");

    return `object(keys=${keySummary})`;
  }

  if (typeof redacted === "string") {
    return `string(length=${redacted.length})`;
  }

  return `${typeof redacted}:${String(redacted)}`;
}

function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);

  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function sendCsv(res: VercelResponse, csv: string, auditLogId: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${buildCsvFilename()}"`,
  );
  res.setHeader("X-Audit-Log-Id", auditLogId);
  res.status(200).end(csv);
}

function buildCsvFilename(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  return `audit-logs-${timestamp}.csv`;
}
