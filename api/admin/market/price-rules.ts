import { parseJsonBody } from "../../_shared/parseBody.js";
import {
  ApiError,
  assertApiRateLimit,
  withApiHandler,
} from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  runReadRpc,
  type JsonObject,
} from "../../../packages/server/src/db/transactions.js";
import {
  asJsonRecord,
  buildAdminRpcContext,
  buildNextCursor,
  callAdminWriteRpc,
  firstQueryValue,
  isRecord,
  mapAdminRpcError,
  normalizeBoolean,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeRequiredUuid,
  parseAdminLimit,
  parseOffsetCursor,
  readHeaderIdempotencyKey,
  requireAdminConfirmHeader,
  toJsonObject,
  type JsonRecord,
} from "../_shared.js";
import { sanitizeAdminJson } from "../gacha/_shared.js";

const MARKET_PRICE_RULE_READ_PERMISSIONS = ["market:read", "admin:read"];
const MARKET_PRICE_RULE_WRITE_PERMISSIONS = ["market:write", "admin:write"];

type MarketPriceRuleListRpcPayload = Record<string, unknown> & {
  items?: unknown;
  rows?: unknown;
  summary?: unknown;
  nextCursor?: unknown;
  next_cursor?: unknown;
  serverTime?: unknown;
  server_time?: unknown;
};

type MarketPriceRuleMutationResult = Record<string, unknown> & {
  audit_log_id?: string | null;
  risk_event_id?: string | null;
  server_time?: string | null;
};

type MarketPriceRuleInput = {
  id: string | null;
  templateId: string | null;
  rarityCode: string | null;
  formIndex: number | null;
  minPriceKcoin: number;
  maxPriceKcoin: number | null;
  suggestedPriceKcoin: number | null;
  active: boolean;
  metadata: JsonObject;
};

export default withApiHandler(
  async (req, res, ctx) => {
    await assertApiRateLimit(req, res, ctx, {
      action: ctx.method === "GET" ? "admin.read" : "admin.write",
    });

    if (ctx.method === "GET") {
      const admin = await requireAdmin(req, {
        permissions: MARKET_PRICE_RULE_READ_PERMISSIONS,
        requireAll: false,
      });
      const limit = parseAdminLimit(req.query.limit);
      const cursor = parseOffsetCursor(req.query.cursor);
      const active = normalizeOptionalBoolean(req.query.active, "active");
      const payload = await listMarketPriceRules({
        adminUserId: admin.adminId,
        active,
        limit,
        cursor,
        requestContext: buildAdminRpcContext(admin, ctx),
        requestId: ctx.requestId,
      });

      return normalizeMarketPriceRuleListPayload(payload, limit, cursor);
    }

    const admin = await requireAdmin(req, {
      permissions: MARKET_PRICE_RULE_WRITE_PERMISSIONS,
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    requireAdminConfirmHeader(req);

    const rule = normalizeMarketPriceRuleInput(body, {
      requireId: ctx.method === "PATCH",
    });
    const reason = normalizeRequiredText(body.reason, "reason");
    const idempotencyKey = readHeaderIdempotencyKey(req);

    try {
      const result = await callAdminWriteRpc<MarketPriceRuleMutationResult>({
        functionName: "admin_upsert_market_price_rule",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_price_rule_id: rule.id,
          p_template_id: rule.templateId,
          p_rarity_code: rule.rarityCode,
          p_form_index: rule.formIndex,
          p_min_price_kcoin: rule.minPriceKcoin,
          p_max_price_kcoin: rule.maxPriceKcoin,
          p_suggested_price_kcoin: rule.suggestedPriceKcoin,
          p_active: rule.active,
          p_metadata: rule.metadata,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
          p_request_context: buildAdminRpcContext(admin, ctx),
        },
      });

      assertRiskEventResult(result);

      return {
        ...result,
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_MARKET_PRICE_RULE_UPSERT_FAILED");
    }
  },
  {
    methods: ["GET", "POST", "PATCH"],
    rateLimit: false,
  },
);

async function listMarketPriceRules(input: {
  adminUserId: string;
  active: boolean | undefined;
  limit: number;
  cursor: number;
  requestContext: JsonObject;
  requestId: string;
}): Promise<MarketPriceRuleListRpcPayload> {
  try {
    return await runReadRpc<MarketPriceRuleListRpcPayload>({
      schema: "api",
      functionName: "admin_list_market_price_rules",
      args: {
        p_admin_user_id: input.adminUserId,
        p_active: input.active,
        p_limit: input.limit,
        p_cursor: input.cursor,
        p_request_context: input.requestContext,
      },
      traceId: input.requestId,
      label: "admin_list_market_price_rules",
    });
  } catch (error) {
    throw mapAdminRpcError(error, "ADMIN_MARKET_PRICE_RULES_LOOKUP_FAILED");
  }
}

function normalizeMarketPriceRuleListPayload(
  payload: MarketPriceRuleListRpcPayload,
  limit: number,
  cursor: number,
) {
  if (!isRecord(payload)) {
    throw invalidReadResult("payload");
  }

  const rawRows = readRows(payload.items ?? payload.rows);
  const items = rawRows.slice(0, limit).map(mapMarketPriceRuleRow);
  const explicitNextCursor = readOptionalCursor(
    payload.nextCursor ?? payload.next_cursor,
  );

  return {
    items,
    summary: isRecord(payload.summary)
      ? payload.summary
      : summarizeMarketPriceRules(items),
    nextCursor:
      explicitNextCursor === undefined
        ? buildNextCursor(rawRows.length, limit, cursor)
        : explicitNextCursor,
    serverTime:
      readOptionalString(payload.serverTime ?? payload.server_time) ??
      new Date().toISOString(),
  };
}

function normalizeMarketPriceRuleInput(
  body: JsonRecord,
  options: { requireId: boolean },
): MarketPriceRuleInput {
  const id = normalizeNullableUuid(
    readField(body, "id", "price_rule_id", "priceRuleId"),
    "id",
  );

  if (options.requireId && !id) {
    throw new ApiError(400, "VALIDATION_FAILED", "id is required");
  }

  const minPriceKcoin = normalizeRequiredKcoinAmount(
    readField(body, "min_price_kcoin", "minPriceKcoin"),
    "min_price_kcoin",
  );
  const maxPriceKcoin = normalizeNullableKcoinAmount(
    readField(body, "max_price_kcoin", "maxPriceKcoin"),
    "max_price_kcoin",
  );
  const suggestedPriceKcoin = normalizeNullableKcoinAmount(
    readField(body, "suggested_price_kcoin", "suggestedPriceKcoin"),
    "suggested_price_kcoin",
  );

  assertValidPriceBounds({
    minPriceKcoin,
    maxPriceKcoin,
    suggestedPriceKcoin,
  });

  return {
    id,
    templateId: normalizeNullableUuid(
      readField(body, "template_id", "templateId"),
      "template_id",
    ),
    rarityCode: normalizeNullableRarityCode(
      readField(body, "rarity_code", "rarityCode", "rarity"),
    ),
    formIndex: normalizeNullableInteger(
      readField(body, "form_index", "formIndex"),
      "form_index",
      { min: 1 },
    ),
    minPriceKcoin,
    maxPriceKcoin,
    suggestedPriceKcoin,
    active: normalizeBoolean(readField(body, "active"), "active"),
    metadata: normalizeJsonObject(readField(body, "metadata")),
  };
}

function mapMarketPriceRuleRow(row: unknown) {
  if (!isRecord(row)) {
    throw invalidReadResult("row");
  }

  return {
    id: readRequiredString(row.id, "id"),
    templateId: readNullableString(row.templateId ?? row.template_id),
    formIndex: readNullableNumber(row.formIndex ?? row.form_index),
    rarityCode: readNullableString(row.rarityCode ?? row.rarity_code),
    minPriceKcoin: readRequiredNumber(
      row.minPriceKcoin ?? row.min_price_kcoin,
      "min_price_kcoin",
    ),
    maxPriceKcoin: readNullableNumber(row.maxPriceKcoin ?? row.max_price_kcoin),
    suggestedPriceKcoin: readNullableNumber(
      row.suggestedPriceKcoin ?? row.suggested_price_kcoin,
    ),
    active: readRequiredBoolean(row.active, "active"),
    metadata: sanitizeAdminJson(row.metadata),
    createdAt: readRequiredString(
      row.createdAt ?? row.created_at,
      "created_at",
    ),
    updatedAt: readRequiredString(
      row.updatedAt ?? row.updated_at,
      "updated_at",
    ),
  };
}

function summarizeMarketPriceRules(
  rows: ReturnType<typeof mapMarketPriceRuleRow>[],
) {
  return rows.reduce<Record<string, number>>((summary, row) => {
    const key = row.active ? "active" : "inactive";
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});
}

function assertRiskEventResult(
  value: unknown,
): asserts value is MarketPriceRuleMutationResult {
  if (
    !isRecord(value) ||
    typeof value.risk_event_id !== "string" ||
    value.risk_event_id.trim().length === 0
  ) {
    throw new ApiError(
      500,
      "ADMIN_RISK_EVENT_REQUIRED",
      "Admin price rule write RPC did not return risk_event_id.",
      {
        details: { functionName: "admin_upsert_market_price_rule" },
        expose: false,
      },
    );
  }
}

function assertValidPriceBounds(input: {
  minPriceKcoin: number;
  maxPriceKcoin: number | null;
  suggestedPriceKcoin: number | null;
}): void {
  if (
    input.maxPriceKcoin !== null &&
    input.maxPriceKcoin < input.minPriceKcoin
  ) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "max_price_kcoin must be >= min_price_kcoin",
    );
  }

  if (
    input.suggestedPriceKcoin !== null &&
    input.suggestedPriceKcoin < input.minPriceKcoin
  ) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "suggested_price_kcoin must be >= min_price_kcoin",
    );
  }

  if (
    input.suggestedPriceKcoin !== null &&
    input.maxPriceKcoin !== null &&
    input.suggestedPriceKcoin > input.maxPriceKcoin
  ) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "suggested_price_kcoin must be <= max_price_kcoin",
    );
  }
}

function normalizeOptionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  const raw = firstQueryValue(value);
  return raw ? normalizeBoolean(raw, field) : undefined;
}

function normalizeNullableUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return normalizeRequiredUuid(value, field);
}

function normalizeNullableRarityCode(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeRequiredKcoinAmount(value: unknown, field: string): number {
  if (value === undefined || value === null || value === "") {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} is required`);
  }

  return normalizeKcoinAmount(value, field);
}

function normalizeNullableKcoinAmount(
  value: unknown,
  field: string,
): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return normalizeKcoinAmount(value, field);
}

function normalizeKcoinAmount(value: unknown, field: string): number {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (
    !Number.isFinite(normalized) ||
    !Number.isInteger(normalized) ||
    normalized < 0
  ) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a non-negative integer`,
    );
  }

  if (normalized > Number.MAX_SAFE_INTEGER) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} exceeds the safe integer limit`,
    );
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

  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

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

function normalizeJsonObject(value: unknown): JsonObject {
  return toJsonObject(isRecord(value) ? value : {});
}

function readField(record: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function readRows(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw invalidReadResult("rows");
  }

  return value;
}

function readOptionalCursor(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() ? value.trim() : null;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return String(value);
  }

  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidReadResult(field);
  }

  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw invalidReadResult("string");
  }

  return value;
}

function readRequiredNumber(value: unknown, field: string): number {
  const normalized = readNullableNumber(value);

  if (normalized === null) {
    throw invalidReadResult(field);
  }

  return normalized;
}

function readNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(normalized)) {
    throw invalidReadResult("number");
  }

  return normalized;
}

function readRequiredBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1"].includes(normalized)) {
      return true;
    }

    if (["false", "0"].includes(normalized)) {
      return false;
    }
  }

  throw invalidReadResult(field);
}

function invalidReadResult(field: string): ApiError {
  return new ApiError(
    500,
    "ADMIN_MARKET_PRICE_RULES_RESULT_INVALID",
    "Market price rules RPC returned an invalid payload.",
    {
      details: { field },
      expose: false,
    },
  );
}
