import type { VercelRequest } from "@vercel/node";

import { ApiError, type ApiContext } from "../../_shared/handler.js";
import { parseJsonBody } from "../../_shared/parseBody.js";
import type { AdminContext } from "../../_shared/requireAdmin.js";
import type {
  JsonObject,
  JsonValue,
} from "../../../packages/server/src/db/transactions.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  callAdminWriteRpc,
  firstQueryValue,
  isRecord,
  mapAdminRpcError,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeRequiredUuid,
  readBodyIdempotencyKey,
  requireAdminConfirmation,
  toJsonObject,
  type JsonRecord,
} from "../_shared.js";

export const GACHA_READ_PERMISSIONS = ["gacha:read", "admin:read"];
export const GACHA_WRITE_PERMISSIONS = ["gacha:write", "admin:write"];

export const BOX_STATUS_VALUES = [
  "draft",
  "not_started",
  "active",
  "paused",
  "ended",
  "sold_out",
  "hidden",
] as const;

export const BOX_TIER_VALUES = [
  "normal",
  "rare",
  "legendary",
  "event",
] as const;

export const DROP_POOL_STATUS_VALUES = ["draft", "active", "archived"] as const;

const SENSITIVE_JSON_KEY_RE =
  /(secret|token|private|service_role|authorization|cookie|random_seed|seed_hash)/i;

export type BlindBoxRow = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  tier: string;
  status: string;
  price_stars: number | string;
  total_stock: number | null;
  remaining_stock: number | null;
  open_reward_kcoin: number | string;
  cover_image_url: string | null;
  hero_image_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type DropPoolVersionRow = {
  id: string;
  box_id: string;
  version_no: number;
  status: string;
  total_weight: number | string;
  published_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
  config_snapshot: unknown;
  created_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DropPoolItemRow = {
  id: string;
  pool_version_id: string;
  template_id: string;
  form_id: string | null;
  rarity_code: string;
  drop_weight: number | string;
  probability_bps: number | string | null;
  stock_total: number | string | null;
  stock_remaining: number | string | null;
  is_pity_eligible: boolean;
  is_featured: boolean;
  sort_order: number;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type PityRuleRow = {
  id: string;
  box_id: string;
  pool_version_id: string | null;
  rule_name: string;
  threshold: number;
  target_rarity_code: string;
  reset_on_rarity_code: string | null;
  guaranteed_template_id: string | null;
  guaranteed_form_id: string | null;
  priority: number;
  active: boolean;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type TemplateSummaryRow = {
  id: string;
  slug: string;
  display_name: string;
};

export type FormSummaryRow = {
  id: string;
  display_name: string;
};

export type GachaWriteControls = {
  idempotencyKey: string;
  reason: string;
  requestContext: JsonObject;
};

export type DropPoolMutationResult = Record<string, unknown> & {
  audit_log_id?: string | null;
  server_time?: string;
};

export const BLIND_BOX_COLUMNS = [
  "id",
  "slug",
  "display_name",
  "description",
  "tier",
  "status",
  "price_stars",
  "total_stock",
  "remaining_stock",
  "open_reward_kcoin",
  "cover_image_url",
  "hero_image_url",
  "starts_at",
  "ends_at",
  "sort_order",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

export const DROP_POOL_VERSION_COLUMNS = [
  "id",
  "box_id",
  "version_no",
  "status",
  "total_weight",
  "published_at",
  "effective_from",
  "effective_to",
  "config_snapshot",
  "created_by_admin_id",
  "created_at",
  "updated_at",
].join(",");

export const DROP_POOL_ITEM_COLUMNS = [
  "id",
  "pool_version_id",
  "template_id",
  "form_id",
  "rarity_code",
  "drop_weight",
  "probability_bps",
  "stock_total",
  "stock_remaining",
  "is_pity_eligible",
  "is_featured",
  "sort_order",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

export const PITY_RULE_COLUMNS = [
  "id",
  "box_id",
  "pool_version_id",
  "rule_name",
  "threshold",
  "target_rarity_code",
  "reset_on_rarity_code",
  "guaranteed_template_id",
  "guaranteed_form_id",
  "priority",
  "active",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

export const TEMPLATE_SUMMARY_COLUMNS = ["id", "slug", "display_name"].join(
  ",",
);
export const FORM_SUMMARY_COLUMNS = ["id", "display_name"].join(",");

export async function readGachaWriteBody(
  req: VercelRequest,
): Promise<JsonRecord> {
  return asJsonRecord(await parseJsonBody(req, { maxBytes: 256 * 1024 }));
}

export function requireGachaWriteControls(
  req: VercelRequest,
  body: JsonRecord,
  admin: AdminContext,
  ctx: ApiContext,
): GachaWriteControls {
  requireAdminConfirmation(req, body);

  return {
    idempotencyKey: readBodyIdempotencyKey(req, body),
    reason: normalizeRequiredText(body.reason, "reason"),
    requestContext: buildAdminRpcContext(admin, ctx),
  };
}

export async function callGachaWriteRpc<
  TResult extends DropPoolMutationResult,
>(input: {
  functionName: string;
  requestId: string;
  args: Record<string, JsonValue | undefined>;
  fallbackCode: string;
}): Promise<TResult & { serverTime: string }> {
  try {
    const result = await callAdminWriteRpc<TResult>({
      functionName: input.functionName,
      requestId: input.requestId,
      args: input.args,
    });

    return {
      ...result,
      serverTime: readServerTime(result),
    };
  } catch (error) {
    throw mapAdminRpcError(error, input.fallbackCode);
  }
}

export function normalizeOptionalQueryUuid(
  value: unknown,
  field: string,
): string | undefined {
  const raw = firstQueryValue(value);
  return raw ? normalizeRequiredUuid(raw, field) : undefined;
}

export function normalizeRequiredQueryUuid(
  value: unknown,
  field: string,
): string {
  const raw = firstQueryValue(value);
  return normalizeRequiredUuid(raw, field);
}

export function normalizeOptionalBodyUuid(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return normalizeRequiredUuid(value, field);
}

export function normalizeNullableBodyUuid(
  value: unknown,
  field: string,
): string | null {
  return normalizeOptionalBodyUuid(value, field) ?? null;
}

export function normalizeOptionalEnumQuery<T extends readonly string[]>(
  value: unknown,
  field: string,
  allowedValues: T,
): T[number] | undefined {
  const raw = firstQueryValue(value);

  if (!raw) {
    return undefined;
  }

  return normalizeEnum(raw, field, allowedValues);
}

export function normalizeEnum<T extends readonly string[]>(
  value: unknown,
  field: string,
  allowedValues: T,
): T[number] {
  const normalized = normalizeRequiredText(value, field).toLowerCase();

  if (!(allowedValues as readonly string[]).includes(normalized)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be one of: ${allowedValues.join(", ")}`,
    );
  }

  return normalized as T[number];
}

export function normalizeWriteAction(value: unknown): "validate" | "archive" {
  const normalized = normalizeRequiredText(value, "action")
    .replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)
    .replace(/[-\s]+/g, "_")
    .toLowerCase();

  if (normalized === "validate" || normalized === "archive") {
    return normalized;
  }

  throw new ApiError(
    400,
    "VALIDATION_FAILED",
    `Unsupported drop pool action: ${normalized}`,
  );
}

export function normalizeDropPoolItemsInput(value: unknown): JsonValue[] {
  if (!Array.isArray(value)) {
    throw new ApiError(400, "VALIDATION_FAILED", "items must be an array");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        `items[${index}] must be an object`,
      );
    }

    const normalized: JsonObject = {
      template_id: normalizeRequiredUuid(
        readField(item, "template_id", "templateId"),
        `items[${index}].template_id`,
      ),
      form_id: normalizeNullableBodyUuid(
        readField(item, "form_id", "formId"),
        `items[${index}].form_id`,
      ),
      rarity_code: normalizeRequiredText(
        readField(item, "rarity_code", "rarityCode", "rarity"),
        `items[${index}].rarity_code`,
      ).toUpperCase(),
      drop_weight: normalizePositiveNumber(
        readField(item, "drop_weight", "dropWeight", "weight"),
        `items[${index}].drop_weight`,
      ),
      probability_bps: normalizeNullableInteger(
        readField(item, "probability_bps", "probabilityBps"),
        `items[${index}].probability_bps`,
        { min: 0, max: 10000 },
      ),
      stock_total: normalizeNullableInteger(
        readField(item, "stock_total", "stockTotal", "stockLimit"),
        `items[${index}].stock_total`,
        { min: 0 },
      ),
      stock_remaining: normalizeNullableInteger(
        readField(item, "stock_remaining", "stockRemaining"),
        `items[${index}].stock_remaining`,
        { min: 0 },
      ),
      is_pity_eligible: normalizeBooleanDefault(
        readField(item, "is_pity_eligible", "isPityEligible"),
        true,
        `items[${index}].is_pity_eligible`,
      ),
      is_featured: normalizeBooleanDefault(
        readField(item, "is_featured", "isFeatured"),
        false,
        `items[${index}].is_featured`,
      ),
      sort_order: normalizeIntegerDefault(
        readField(item, "sort_order", "sortOrder"),
        100,
        `items[${index}].sort_order`,
      ),
      metadata: normalizeJsonObject(readField(item, "metadata")),
    };

    const id = normalizeOptionalBodyUuid(
      readField(item, "id"),
      `items[${index}].id`,
    );

    if (id) {
      normalized.id = id;
    }

    return normalized;
  });
}

export function normalizePityRulesInput(value: unknown): JsonValue[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ApiError(400, "VALIDATION_FAILED", "pityRules must be an array");
  }

  return value.map((rule, index) => {
    if (!isRecord(rule)) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        `pityRules[${index}] must be an object`,
      );
    }

    const normalized: JsonObject = {
      rule_name: normalizeRequiredText(
        readField(rule, "rule_name", "ruleName"),
        `pityRules[${index}].rule_name`,
      ),
      threshold: normalizeIntegerRequired(
        readField(rule, "threshold"),
        `pityRules[${index}].threshold`,
        { min: 1 },
      ),
      target_rarity_code: normalizeRequiredText(
        readField(rule, "target_rarity_code", "targetRarityCode"),
        `pityRules[${index}].target_rarity_code`,
      ).toUpperCase(),
      reset_on_rarity_code:
        normalizeOptionalText(
          readField(rule, "reset_on_rarity_code", "resetOnRarityCode"),
        )?.toUpperCase() ?? null,
      guaranteed_template_id: normalizeNullableBodyUuid(
        readField(rule, "guaranteed_template_id", "guaranteedTemplateId"),
        `pityRules[${index}].guaranteed_template_id`,
      ),
      guaranteed_form_id: normalizeNullableBodyUuid(
        readField(rule, "guaranteed_form_id", "guaranteedFormId"),
        `pityRules[${index}].guaranteed_form_id`,
      ),
      priority: normalizeIntegerDefault(
        readField(rule, "priority"),
        100,
        `pityRules[${index}].priority`,
      ),
      active: normalizeBooleanDefault(
        readField(rule, "active", "enabled"),
        true,
        `pityRules[${index}].active`,
      ),
      metadata: normalizeJsonObject(readField(rule, "metadata")),
    };

    const id = normalizeOptionalBodyUuid(
      readField(rule, "id"),
      `pityRules[${index}].id`,
    );

    if (id) {
      normalized.id = id;
    }

    return normalized;
  });
}

export function mapBlindBoxRow(
  row: BlindBoxRow,
  options: {
    activeVersion?: ReturnType<typeof mapDropPoolVersionRow> | null;
    versionCount?: number;
    activeItemCount?: number;
  } = {},
) {
  return {
    ...row,
    price_stars: Number(row.price_stars),
    total_stock: row.total_stock === null ? null : Number(row.total_stock),
    remaining_stock:
      row.remaining_stock === null ? null : Number(row.remaining_stock),
    sort_order: Number(row.sort_order),
    metadata: sanitizeAdminJson(row.metadata),
    active_version: options.activeVersion ?? null,
    version_count: options.versionCount ?? 0,
    active_item_count: options.activeItemCount ?? 0,
  };
}

export function mapDropPoolVersionRow(
  row: DropPoolVersionRow,
  itemCount?: number,
) {
  return {
    ...row,
    version_no: Number(row.version_no),
    config_snapshot: sanitizeAdminJson(row.config_snapshot),
    item_count: itemCount ?? 0,
  };
}

export function mapDropPoolItemRow(
  row: DropPoolItemRow,
  templatesById: Map<string, TemplateSummaryRow>,
  formsById: Map<string, FormSummaryRow>,
) {
  const template = templatesById.get(row.template_id);
  const form = row.form_id ? formsById.get(row.form_id) : undefined;

  return {
    ...row,
    probability_bps:
      row.probability_bps === null ? null : Number(row.probability_bps),
    stock_total: row.stock_total === null ? null : Number(row.stock_total),
    stock_remaining:
      row.stock_remaining === null ? null : Number(row.stock_remaining),
    sort_order: Number(row.sort_order),
    metadata: sanitizeAdminJson(row.metadata),
    template_slug: template?.slug ?? null,
    template_display_name: template?.display_name ?? null,
    form_display_name: form?.display_name ?? null,
  };
}

export function mapPityRuleRow(
  row: PityRuleRow,
  templatesById: Map<string, TemplateSummaryRow>,
  formsById: Map<string, FormSummaryRow>,
) {
  const template = row.guaranteed_template_id
    ? templatesById.get(row.guaranteed_template_id)
    : undefined;
  const form = row.guaranteed_form_id
    ? formsById.get(row.guaranteed_form_id)
    : undefined;

  return {
    ...row,
    threshold: Number(row.threshold),
    priority: Number(row.priority),
    metadata: sanitizeAdminJson(row.metadata),
    guaranteed_template_display_name: template?.display_name ?? null,
    guaranteed_form_display_name: form?.display_name ?? null,
  };
}

export function summarizeByStatus(rows: Array<{ status: string }>) {
  return rows.reduce<Record<string, number>>((summary, row) => {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
    return summary;
  }, {});
}

export function summarizeDropPoolItems(rows: DropPoolItemRow[]) {
  return rows.reduce<Record<string, number>>((summary, row) => {
    summary[row.rarity_code] = (summary[row.rarity_code] ?? 0) + 1;
    return summary;
  }, {});
}

export function summarizePityRules(rows: PityRuleRow[]) {
  return rows.reduce<Record<string, number>>((summary, row) => {
    const key = row.active ? "active" : "inactive";
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});
}

export function sanitizeAdminJson(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return null;
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
    return value.map((item) => sanitizeAdminJson(item, depth + 1));
  }

  if (!isRecord(value)) {
    return null;
  }

  const output: JsonRecord = {};

  for (const [key, childValue] of Object.entries(value)) {
    output[key] = SENSITIVE_JSON_KEY_RE.test(key)
      ? "[redacted]"
      : sanitizeAdminJson(childValue, depth + 1);
  }

  return output;
}

export function normalizeJsonObject(value: unknown): JsonObject {
  return toJsonObject(isRecord(value) ? value : {});
}

export function buildApprovalContext(value: unknown): JsonObject {
  return normalizeJsonObject(value);
}

export function readServerTime(result: { server_time?: string }): string {
  return result.server_time ?? new Date().toISOString();
}

export function assertReadSuccess(
  error: unknown,
  code: string,
  message: string,
): void {
  if (!error) {
    return;
  }

  throw new ApiError(500, code, message, {
    cause: error,
    expose: false,
  });
}

export function toDropPoolItemsRpcPayload(
  rows: DropPoolItemRow[],
): JsonValue[] {
  return rows.map((row) =>
    toJsonObject({
      id: row.id,
      template_id: row.template_id,
      form_id: row.form_id,
      rarity_code: row.rarity_code,
      drop_weight: row.drop_weight,
      probability_bps: row.probability_bps,
      stock_total: row.stock_total,
      stock_remaining: row.stock_remaining,
      is_pity_eligible: row.is_pity_eligible,
      is_featured: row.is_featured,
      sort_order: row.sort_order,
      metadata: isRecord(row.metadata) ? row.metadata : {},
    }),
  );
}

function readField(
  record: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }

  return undefined;
}

function normalizePositiveNumber(value: unknown, field: string): number {
  const normalized = normalizeNumber(value, field);

  if (normalized <= 0) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be positive`);
  }

  return normalized;
}

function normalizeNumber(value: unknown, field: string): number {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(normalized)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be a number`);
  }

  return normalized;
}

function normalizeNullableInteger(
  value: unknown,
  field: string,
  bounds: { min?: number; max?: number } = {},
): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return normalizeIntegerRequired(value, field, bounds);
}

function normalizeIntegerDefault(
  value: unknown,
  fallback: number,
  field: string,
): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return normalizeIntegerRequired(value, field);
}

function normalizeIntegerRequired(
  value: unknown,
  field: string,
  bounds: { min?: number; max?: number } = {},
): number {
  const normalized = normalizeNumber(value, field);

  if (!Number.isInteger(normalized)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be an integer`);
  }

  if (bounds.min !== undefined && normalized < bounds.min) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be >= ${bounds.min}`,
    );
  }

  if (bounds.max !== undefined && normalized > bounds.max) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be <= ${bounds.max}`,
    );
  }

  return normalized;
}

function normalizeBooleanDefault(
  value: unknown,
  fallback: boolean,
  field: string,
): boolean {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  throw new ApiError(400, "VALIDATION_FAILED", `${field} must be boolean`);
}
