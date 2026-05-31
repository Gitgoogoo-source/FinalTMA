import type { VercelRequest } from "@vercel/node";

import { ApiError } from "../../_shared/handler.js";
import {
  asJsonRecord,
  buildNextCursor,
  firstQueryValue,
  normalizeOptionalText,
  parseAdminLimit,
  parseOffsetCursor,
  requireAdminConfirmation,
  type JsonRecord,
} from "../_shared.js";
import type {
  Phase5ReconciliationFinding,
  Phase5ReconciliationRunType,
} from "../../../packages/server/src/jobs/ledgerReconcileJob.js";

export type ReconciliationUiRunType =
  | "payment"
  | "ledger"
  | "market"
  | "inventory"
  | "gacha"
  | "referral"
  | "mint"
  | "wallet";

export const RECONCILIATION_RUN_TYPE_OPTIONS: ReadonlyArray<{
  uiType: ReconciliationUiRunType;
  jobType: Phase5ReconciliationRunType;
}> = [
  { uiType: "payment", jobType: "payment_fulfillment" },
  { uiType: "ledger", jobType: "ledger_balance" },
  { uiType: "market", jobType: "market_settlement" },
  { uiType: "inventory", jobType: "inventory_lock" },
  { uiType: "gacha", jobType: "gacha_stock" },
  { uiType: "referral", jobType: "referral_commission" },
  { uiType: "mint", jobType: "mint_queue" },
  { uiType: "wallet", jobType: "wallet_sync" },
];

const UI_TO_JOB = new Map(
  RECONCILIATION_RUN_TYPE_OPTIONS.map((item) => [item.uiType, item.jobType]),
);
const JOB_TO_UI = new Map(
  RECONCILIATION_RUN_TYPE_OPTIONS.map((item) => [item.jobType, item.uiType]),
);
const JOB_TYPES = new Set<Phase5ReconciliationRunType>(
  RECONCILIATION_RUN_TYPE_OPTIONS.map((item) => item.jobType),
);
const FINDING_STATUSES = new Set([
  "open",
  "reviewing",
  "resolved",
  "ignored",
  "fixed",
  "false_positive",
  "escalated",
]);
const FINDING_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

export type ReconciliationPageInput = {
  limit: number;
  offset: number;
  nextCursor: string | null;
};

export function parseReconciliationPage(req: VercelRequest): ReconciliationPageInput {
  const limit = parseAdminLimit(req.query.limit);
  const offset = parseOffsetCursor(req.query.cursor);

  return {
    limit,
    offset,
    nextCursor: null,
  };
}

export function buildPageResult<T>(
  rows: T[],
  limit: number,
  offset: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);

  return {
    items,
    nextCursor: buildNextCursor(rows.length, limit, offset),
  };
}

export function parseRunTypes(value: unknown): Phase5ReconciliationRunType[] | undefined {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : undefined;

  if (!rawItems) {
    return undefined;
  }

  const runTypes = rawItems
    .map((item) => normalizeRunType(item))
    .filter((item): item is Phase5ReconciliationRunType => Boolean(item));

  return runTypes.length ? [...new Set(runTypes)] : undefined;
}

export function buildRunTypesConfirmationTarget(
  rawValue: unknown,
  runTypes: Phase5ReconciliationRunType[],
): string {
  const rawItems = Array.isArray(rawValue)
    ? rawValue
    : typeof rawValue === "string"
      ? rawValue.split(",")
      : [];
  const normalizedRawItems = rawItems
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean);

  return normalizedRawItems.length
    ? [...new Set(normalizedRawItems)].join(",")
    : runTypes.join(",");
}

export function normalizeRunType(value: unknown): Phase5ReconciliationRunType | undefined {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (!raw) {
    return undefined;
  }

  const mapped = UI_TO_JOB.get(raw as ReconciliationUiRunType);
  if (mapped) {
    return mapped;
  }

  if (JOB_TYPES.has(raw as Phase5ReconciliationRunType)) {
    return raw as Phase5ReconciliationRunType;
  }

  throw new ApiError(
    400,
    "RECONCILIATION_RUN_TYPE_INVALID",
    "对账类型无效。",
  );
}

export function toUiRunType(
  runType: string | null | undefined,
): ReconciliationUiRunType | string | null {
  if (!runType) {
    return null;
  }

  return JOB_TO_UI.get(runType as Phase5ReconciliationRunType) ?? runType;
}

export function parseFindingStatus(value: unknown): string | undefined {
  const status = firstQueryValue(value)?.trim().toLowerCase();

  if (!status) {
    return undefined;
  }

  if (!FINDING_STATUSES.has(status)) {
    throw new ApiError(
      400,
      "RECONCILIATION_FINDING_STATUS_INVALID",
      "对账问题状态无效。",
    );
  }

  return status;
}

export function parseFindingSeverity(value: unknown): string | undefined {
  const severity = firstQueryValue(value)?.trim().toLowerCase();

  if (!severity) {
    return undefined;
  }

  if (!FINDING_SEVERITIES.has(severity)) {
    throw new ApiError(
      400,
      "RECONCILIATION_FINDING_SEVERITY_INVALID",
      "对账问题等级无效。",
    );
  }

  return severity;
}

export function parseDryRun(body: JsonRecord): boolean {
  if (typeof body.dryRun === "boolean") {
    return body.dryRun;
  }

  if (typeof body.dry_run === "boolean") {
    return body.dry_run;
  }

  if (typeof body.writeRiskEvents === "boolean") {
    return !body.writeRiskEvents;
  }

  if (typeof body.write_risk_events === "boolean") {
    return !body.write_risk_events;
  }

  return true;
}

export function parseRunNowLimit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError(400, "VALIDATION_FAILED", "limit 必须是正整数。");
  }

  return parsed;
}

export function parseResolutionDetail(value: unknown): JsonRecord {
  return asJsonRecord(value);
}

export function normalizeRiskEventId(value: unknown): string {
  const text = normalizeOptionalText(value);
  const uuid =
    text && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
      ? text
      : undefined;

  if (!uuid) {
    throw new ApiError(400, "VALIDATION_FAILED", "findingId must be a UUID");
  }

  return uuid;
}

export function normalizeResolveStatus(value: unknown): string {
  const status = normalizeOptionalText(value)?.toLowerCase();

  if (
    status === "reviewing" ||
    status === "ignored" ||
    status === "fixed" ||
    status === "false_positive" ||
    status === "escalated"
  ) {
    return status;
  }

  throw new ApiError(
    400,
    "VALIDATION_FAILED",
    "status must be one of reviewing, ignored, fixed, false_positive, escalated",
  );
}

export function requireReconciliationConfirmation(
  req: VercelRequest,
  body: JsonRecord,
  expectedTarget: string,
): void {
  requireAdminConfirmation(req, body);

  const confirmationTarget = normalizeOptionalText(
    body.confirmationTarget ?? body.confirmation_target,
  );
  const confirmationCode = normalizeOptionalText(
    body.confirmationCode ?? body.confirmation_code ?? body.targetCode ?? body.target_code,
  );

  if (!confirmationTarget || !confirmationCode) {
    throw new ApiError(
      400,
      "ADMIN_CONFIRMATION_REQUIRED",
      "High-risk admin operation requires confirmation target and code",
    );
  }

  if (confirmationTarget !== expectedTarget) {
    throw new ApiError(
      400,
      "ADMIN_CONFIRMATION_TARGET_INVALID",
      "Confirmation target does not match this admin operation",
    );
  }

  if (confirmationCode !== buildReconciliationConfirmationCode(expectedTarget)) {
    throw new ApiError(
      400,
      "ADMIN_CONFIRMATION_CODE_INVALID",
      "Confirmation code does not match this admin operation",
    );
  }
}

export function buildReconciliationConfirmationCode(value: string): string {
  const normalized = value.trim();

  if (normalized.length <= 8) {
    return normalized;
  }

  return normalized.slice(-6);
}

export function serializeDryRunFinding(
  finding: Phase5ReconciliationFinding,
  runId: string,
  runType: Phase5ReconciliationRunType,
): Record<string, unknown> {
  return {
    id: `${runId}:${finding.code}:${finding.sourceId ?? "source"}`,
    code: finding.code,
    message: finding.message,
    severity: finding.severity,
    status: "open",
    source_type: finding.sourceType,
    sourceType: finding.sourceType,
    source_id: finding.sourceId,
    sourceId: finding.sourceId,
    user_id: finding.userId,
    userId: finding.userId,
    detail: finding.detail,
    reconciliation_run_id: runId,
    reconciliationRunId: runId,
    reconciliation_run_type: runType,
    reconciliationRunType: toUiRunType(runType),
    star_order_id: finding.starOrderId ?? null,
    starOrderId: finding.starOrderId ?? null,
    draw_order_id: finding.drawOrderId ?? null,
    drawOrderId: finding.drawOrderId ?? null,
    payment_charge_id: finding.paymentChargeId ?? null,
    paymentChargeId: finding.paymentChargeId ?? null,
    mint_queue_id: finding.mintQueueId ?? null,
    mintQueueId: finding.mintQueueId ?? null,
    tx_hash: finding.txHash ?? null,
    txHash: finding.txHash ?? null,
    suggested_action: finding.suggestedAction,
    suggestedAction: finding.suggestedAction,
    dry_run: true,
    dryRun: true,
  };
}
