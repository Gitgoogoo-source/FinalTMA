import type { VercelRequest, VercelResponse } from "@vercel/node";

import { ApiError } from "../../_shared/handler.js";
import type { ApiContext } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  runReadRpc,
  type JsonObject,
} from "../../../packages/server/src/db/transactions.js";
import { writeAdminAuditLog } from "../../../packages/server/src/security/auditLog.js";
import {
  buildAdminRpcContext,
  firstQueryValue,
  hashAuditValue,
  isRecord,
  mapAdminRpcError,
  normalizeRequiredText,
  requireAdminConfirmHeader,
  toJsonObject,
} from "../_shared.js";

export type ReportType = "daily" | "gacha" | "economy" | "market";

export type ReportQuery = {
  from: string;
  to: string;
  filters: JsonObject;
  limit: number;
  cursor: number;
};

export type ReportExportInput = ReportQuery & {
  reportType: ReportType;
  reason: string;
};

const MAX_REPORT_RANGE_DAYS = 90;
const LARGE_EXPORT_RANGE_DAYS = 31;
const DEFAULT_REPORT_LIMIT = 100;
const MAX_REPORT_LIMIT = 500;
const MAX_EXPORT_ROWS = 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const CODE_RE = /^[a-z0-9:_-]+$/i;
const SENSITIVE_KEY_RE =
  /(authorization|bot[_-]?token|cookie|init[_-]?data|password|private[_-]?key|secret|service[_-]?role|token|signature|proof|mnemonic|seed|wallet[_-]?address|payment[_-]?charge)/i;

const REPORT_RPC_BY_TYPE: Record<ReportType, string> = {
  daily: "admin_list_daily_reports",
  gacha: "admin_list_gacha_reports",
  economy: "admin_list_economy_reports",
  market: "admin_list_market_reports",
};

const REPORT_AUDIT_TABLE_BY_TYPE: Record<ReportType, string> = {
  daily: "daily_business_reports",
  gacha: "daily_gacha_reports",
  economy: "daily_economy_reports",
  market: "daily_market_reports",
};

export function parseReportQuery(
  query: Record<string, unknown>,
  reportType: ReportType,
): ReportQuery {
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = shiftDate(today, -30);
  const from = normalizeDateParam(query.from, "from") ?? defaultFrom;
  const to = normalizeDateParam(query.to, "to") ?? today;
  const dayCount = countInclusiveDays(from, to);

  if (dayCount < 1) {
    throw new ApiError(400, "REPORT_RANGE_INVALID", "from must be before to");
  }

  if (dayCount > MAX_REPORT_RANGE_DAYS) {
    throw new ApiError(
      400,
      "REPORT_RANGE_TOO_LARGE",
      `Report range cannot exceed ${MAX_REPORT_RANGE_DAYS} days`,
      {
        details: {
          maxDays: MAX_REPORT_RANGE_DAYS,
        },
      },
    );
  }

  return {
    from,
    to,
    filters: normalizeReportFilters(query, reportType),
    limit: parseReportLimit(query.limit),
    cursor: parseReportCursor(query.cursor),
  };
}

export async function fetchReportResponse(input: {
  req: VercelRequest;
  ctx: ApiContext;
  reportType: ReportType;
}) {
  const admin = await requireAdmin(input.req, {
    permissions: ["reports:read", "admin:read"],
    requireAll: false,
  });
  const reportQuery = parseReportQuery(input.req.query, input.reportType);

  try {
    return await runReadRpc<JsonObject>({
      schema: "api",
      functionName: REPORT_RPC_BY_TYPE[input.reportType],
      args: {
        p_admin_user_id: admin.adminId,
        p_from: reportQuery.from,
        p_to: reportQuery.to,
        p_filters: reportQuery.filters,
        p_limit: reportQuery.limit,
        p_cursor: reportQuery.cursor,
        p_request_context: buildAdminRpcContext(admin, input.ctx),
      },
      traceId: input.ctx.requestId,
      label: REPORT_RPC_BY_TYPE[input.reportType],
    });
  } catch (error) {
    throw mapAdminRpcError(error, "ADMIN_REPORTS_LOOKUP_FAILED");
  }
}

export async function exportReportsCsv(input: {
  req: VercelRequest;
  res: VercelResponse;
  ctx: ApiContext;
  body: Record<string, unknown>;
}) {
  const admin = await requireAdmin(input.req, {
    permissions: ["reports:export", "admin:write"],
    requireAll: false,
  });
  const exportInput = normalizeExportInput(input.body);
  const dayCount = countInclusiveDays(exportInput.from, exportInput.to);

  if (dayCount > LARGE_EXPORT_RANGE_DAYS) {
    requireAdminConfirmHeader(input.req);
  }

  const payload = await runReadRpc<JsonObject>({
    schema: "api",
    functionName: REPORT_RPC_BY_TYPE[exportInput.reportType],
    args: {
      p_admin_user_id: admin.adminId,
      p_from: exportInput.from,
      p_to: exportInput.to,
      p_filters: exportInput.filters,
      p_limit: MAX_EXPORT_ROWS,
      p_cursor: 0,
      p_request_context: buildAdminRpcContext(admin, input.ctx),
    },
    traceId: input.ctx.requestId,
    label: `${REPORT_RPC_BY_TYPE[exportInput.reportType]}_export`,
  });
  const rows = extractRowsForExport(exportInput.reportType, payload);

  if (rows.length > MAX_EXPORT_ROWS) {
    throw new ApiError(
      400,
      "REPORT_EXPORT_TOO_LARGE",
      "报表导出结果超过上限，请缩小筛选范围。",
      {
        details: {
          maxRows: MAX_EXPORT_ROWS,
        },
      },
    );
  }

  const auditResult = await writeAdminAuditLog({
    adminUserId: admin.adminId,
    action: "reports.export",
    targetSchema: "ops",
    targetTable: REPORT_AUDIT_TABLE_BY_TYPE[exportInput.reportType],
    beforeState: {},
    afterState: toJsonObject({
      request_id: input.ctx.requestId,
      report_type: exportInput.reportType,
      from: exportInput.from,
      to: exportInput.to,
      filters: exportInput.filters,
      row_count: rows.length,
      max_rows: MAX_EXPORT_ROWS,
      format: "csv",
    }),
    ipHash: hashAuditValue(input.ctx.ip),
    userAgent: hashAuditValue(input.ctx.userAgent),
    reason: exportInput.reason,
    traceId: input.ctx.requestId,
  });
  const csv = buildReportsCsv(rows);

  input.res.setHeader("Content-Type", "text/csv; charset=utf-8");
  input.res.setHeader(
    "Content-Disposition",
    `attachment; filename="${buildReportFilename(exportInput)}"`,
  );
  input.res.setHeader("X-Audit-Log-Id", auditResult.auditLogId);
  input.res.status(200).end(csv);
}

function normalizeExportInput(
  body: Record<string, unknown>,
): ReportExportInput {
  const reportType = normalizeReportType(body.reportType ?? body.report_type);
  const query = parseReportQuery(
    asQueryRecord(body.filters ?? body),
    reportType,
  );
  const reason = normalizeRequiredText(body.reason, "reason");

  if (reason.length < 5) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "reason must be at least 5 characters",
    );
  }

  return {
    ...query,
    reportType,
    reason,
  };
}

function normalizeReportType(value: unknown): ReportType {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (
    raw === "daily" ||
    raw === "gacha" ||
    raw === "economy" ||
    raw === "market"
  ) {
    return raw;
  }

  throw new ApiError(400, "VALIDATION_FAILED", "reportType is invalid");
}

function normalizeReportFilters(
  query: Record<string, unknown>,
  reportType: ReportType,
): JsonObject {
  const filters: Record<string, unknown> = {};
  const campaignId = normalizeOptionalUuid(
    query.campaignId ?? query.campaign_id,
    "campaignId",
  );
  const boxId = normalizeOptionalUuid(query.boxId ?? query.box_id, "boxId");
  const seriesId = normalizeOptionalUuid(
    query.seriesId ?? query.series_id,
    "seriesId",
  );
  const templateId = normalizeOptionalUuid(
    query.templateId ?? query.template_id,
    "templateId",
  );
  const rarityCode = normalizeOptionalCode(
    query.rarityCode ?? query.rarity_code,
    "rarityCode",
  );
  const cohortKey = normalizeOptionalCode(
    query.cohortKey ?? query.cohort_key,
    "cohortKey",
  );
  const currencyCode = normalizeOptionalCode(
    query.currencyCode ?? query.currency_code,
    "currencyCode",
  );

  if (campaignId && (reportType === "daily" || reportType === "gacha")) {
    filters.campaignId = campaignId;
  }

  if (boxId && (reportType === "daily" || reportType === "gacha")) {
    filters.boxId = boxId;
  }

  if (seriesId && (reportType === "gacha" || reportType === "market")) {
    filters.seriesId = seriesId;
  }

  if (templateId && (reportType === "gacha" || reportType === "market")) {
    filters.templateId = templateId;
  }

  if (rarityCode && (reportType === "gacha" || reportType === "market")) {
    filters.rarityCode = rarityCode.toUpperCase();
  }

  if (cohortKey) {
    filters.cohortKey = cohortKey;
  }

  if (currencyCode && reportType === "economy") {
    filters.currencyCode = currencyCode.toUpperCase();
  }

  return toJsonObject(filters);
}

function normalizeOptionalUuid(
  value: unknown,
  field: string,
): string | undefined {
  const raw = firstQueryValue(value);

  if (!raw) {
    return undefined;
  }

  if (!UUID_RE.test(raw)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be a UUID`);
  }

  return raw;
}

function normalizeOptionalCode(
  value: unknown,
  field: string,
): string | undefined {
  const raw = firstQueryValue(value)?.trim();

  if (!raw) {
    return undefined;
  }

  if (!CODE_RE.test(raw)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a valid code`,
    );
  }

  return raw;
}

function normalizeDateParam(value: unknown, field: string): string | undefined {
  const raw = firstQueryValue(value);

  if (!raw) {
    return undefined;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    Number.isNaN(Date.parse(`${raw}T00:00:00.000Z`))
  ) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be YYYY-MM-DD`);
  }

  return raw;
}

function parseReportLimit(value: unknown): number {
  const raw = firstQueryValue(value);
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_REPORT_LIMIT;

  if (!Number.isSafeInteger(parsed)) {
    return DEFAULT_REPORT_LIMIT;
  }

  return Math.min(Math.max(parsed, 1), MAX_REPORT_LIMIT);
}

function parseReportCursor(value: unknown): number {
  const raw = firstQueryValue(value);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function countInclusiveDays(from: string, to: string): number {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((toTime - fromTime) / 86_400_000) + 1;
}

function shiftDate(date: string, days: number): string {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  return new Date(timestamp + days * 86_400_000).toISOString().slice(0, 10);
}

function asQueryRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

type ExportRow = {
  reportType: ReportType;
  section: string;
  row: Record<string, unknown>;
};

function extractRowsForExport(
  reportType: ReportType,
  payload: JsonObject,
): ExportRow[] {
  if (reportType === "daily") {
    return [
      ...toRows(
        payload.businessReports ?? payload.items,
        reportType,
        "business",
      ),
      ...toRows(payload.referralReports, reportType, "referral"),
    ];
  }

  return toRows(payload.items, reportType, reportType);
}

function toRows(
  value: unknown,
  reportType: ReportType,
  section: string,
): ExportRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map((row) => ({
    reportType,
    section,
    row,
  }));
}

const CSV_HEADERS = [
  "report_type",
  "section",
  "report_date",
  "scope_key",
  "campaign_id",
  "box_id",
  "series_id",
  "template_id",
  "rarity_code",
  "currency_code",
  "source_type",
  "cohort_key",
  "metrics_json",
] as const;

function buildReportsCsv(rows: ExportRow[]): string {
  const lines = [
    CSV_HEADERS.map(escapeCsvCell).join(","),
    ...rows.map(({ reportType, section, row }) =>
      [
        reportType,
        section,
        row.report_date,
        row.scope_key,
        row.campaign_id,
        row.box_id,
        row.series_id,
        row.template_id,
        row.rarity_code,
        row.currency_code,
        row.source_type,
        row.cohort_key,
        JSON.stringify(redactSensitiveJson(row.metrics)),
      ]
        .map(escapeCsvCell)
        .join(","),
    ),
  ];

  return `\uFEFF${lines.join("\n")}\n`;
}

function redactSensitiveJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveJson);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      SENSITIVE_KEY_RE.test(key) ? "[redacted_key]" : key,
      SENSITIVE_KEY_RE.test(key) ? "[redacted]" : redactSensitiveJson(nested),
    ]),
  );
}

function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);

  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function buildReportFilename(input: ReportExportInput): string {
  return `reports-${input.reportType}-${input.from}-${input.to}.csv`;
}
