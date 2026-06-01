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

type MarketFeeRuleListPayload = Record<string, unknown> & {
  feeRules?: unknown;
  fee_rules?: unknown;
  nextCursor?: unknown;
  next_cursor?: unknown;
  serverTime?: unknown;
  server_time?: unknown;
};

type MarketFeeRuleMutationResult = Record<string, unknown> & {
  audit_log_id?: string | null;
  risk_event_id?: string | null;
  server_time?: string | null;
};

type MarketFeeRuleInput = {
  id: string | null;
  code: string | null;
  feeBps: number;
  minFee: number;
  maxFee: number | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  metadata: JsonObject;
};

export default withApiHandler(
  async (req, res, ctx) => {
    await assertApiRateLimit(req, res, ctx, {
      action: ctx.method === "GET" ? "admin.read" : "admin.write",
    });

    if (ctx.method === "GET") {
      const admin = await requireAdmin(req, {
        permissions: ["market:read", "admin:read"],
        requireAll: false,
      });
      const limit = parseAdminLimit(req.query.limit);
      const cursor = parseOffsetCursor(req.query.cursor);
      const active = normalizeOptionalBoolean(req.query.active, "active");

      try {
        const payload = await runReadRpc<MarketFeeRuleListPayload>({
          schema: "api",
          functionName: "admin_list_market_price_rules",
          args: {
            p_admin_user_id: admin.adminId,
            p_active: active,
            p_limit: limit,
            p_cursor: cursor,
            p_request_context: buildAdminRpcContext(admin, ctx),
          },
          traceId: ctx.requestId,
          label: "admin_list_market_price_rules",
        });

        return normalizeMarketFeeRuleListPayload(payload, limit, cursor);
      } catch (error) {
        throw mapAdminRpcError(error, "ADMIN_MARKET_FEE_RULES_LOOKUP_FAILED");
      }
    }

    const admin = await requireAdmin(req, {
      permissions: ["market:write", "admin:write"],
      requireAll: false,
    });
    const body = asJsonRecord(
      await parseJsonBody(req, { maxBytes: 32 * 1024 }),
    );

    requireAdminConfirmHeader(req);

    const rule = normalizeMarketFeeRuleInput(body, {
      requireId: ctx.method === "PATCH",
    });
    const reason = normalizeRequiredText(body.reason, "reason");
    const idempotencyKey = readHeaderIdempotencyKey(req);

    try {
      const result = await callAdminWriteRpc<MarketFeeRuleMutationResult>({
        functionName: "admin_upsert_market_fee_rule",
        requestId: ctx.requestId,
        args: {
          p_admin_user_id: admin.adminId,
          p_fee_rule_id: rule.id,
          p_code: rule.code,
          p_fee_type: "market_sell",
          p_currency_code: "KCOIN",
          p_fee_bps: rule.feeBps,
          p_min_fee: rule.minFee,
          p_max_fee: rule.maxFee,
          p_active: rule.active,
          p_starts_at: rule.startsAt,
          p_ends_at: rule.endsAt,
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
      throw mapAdminRpcError(error, "ADMIN_MARKET_FEE_RULE_UPSERT_FAILED");
    }
  },
  {
    methods: ["GET", "POST", "PATCH"],
    rateLimit: false,
  },
);

function normalizeMarketFeeRuleListPayload(
  payload: MarketFeeRuleListPayload,
  limit: number,
  cursor: number,
) {
  if (!isRecord(payload)) {
    throw invalidReadResult("payload");
  }

  const rawRows = readRows(payload.feeRules ?? payload.fee_rules);
  const items = rawRows.slice(0, limit).map(mapMarketFeeRuleRow);
  const explicitNextCursor = readOptionalCursor(
    payload.nextCursor ?? payload.next_cursor,
  );

  return {
    items,
    summary: summarizeMarketFeeRules(items),
    nextCursor:
      explicitNextCursor === undefined
        ? buildNextCursor(rawRows.length, limit, cursor)
        : explicitNextCursor,
    serverTime:
      readOptionalString(payload.serverTime ?? payload.server_time) ??
      new Date().toISOString(),
  };
}

function normalizeMarketFeeRuleInput(
  body: JsonRecord,
  options: { requireId: boolean },
): MarketFeeRuleInput {
  const id = normalizeNullableUuid(
    readField(body, "id", "feeRuleId", "fee_rule_id"),
    "id",
  );

  if (options.requireId && !id) {
    throw new ApiError(400, "VALIDATION_FAILED", "id is required");
  }

  const feeBps = normalizeInteger(
    readField(body, "feeBps", "fee_bps"),
    "feeBps",
    {
      min: 0,
      max: 3000,
    },
  );
  const minFee = normalizeInteger(
    readField(body, "minFee", "min_fee") ?? 0,
    "minFee",
    {
      min: 0,
    },
  );
  const maxFee = normalizeNullableInteger(
    readField(body, "maxFee", "max_fee"),
    "maxFee",
    {
      min: 0,
    },
  );

  if (maxFee !== null && maxFee < minFee) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "maxFee must be greater than or equal to minFee",
    );
  }

  return {
    id,
    code: normalizeNullableCode(readField(body, "code")),
    feeBps,
    minFee,
    maxFee,
    active: normalizeBoolean(readField(body, "active") ?? true, "active"),
    startsAt: normalizeNullableIsoDate(
      readField(body, "startsAt", "starts_at"),
      "startsAt",
    ),
    endsAt: normalizeNullableIsoDate(
      readField(body, "endsAt", "ends_at"),
      "endsAt",
    ),
    metadata: normalizeJsonObject(readField(body, "metadata")),
  };
}

function mapMarketFeeRuleRow(row: unknown) {
  if (!isRecord(row)) {
    throw invalidReadResult("row");
  }

  return {
    id: readRequiredString(row.id, "id"),
    code: readRequiredString(row.code, "code"),
    feeType: readRequiredString(row.feeType ?? row.fee_type, "fee_type"),
    currencyCode: readRequiredString(
      row.currencyCode ?? row.currency_code,
      "currency_code",
    ),
    feeBps: readRequiredNumber(row.feeBps ?? row.fee_bps, "fee_bps"),
    minFee: readRequiredNumber(row.minFee ?? row.min_fee, "min_fee"),
    maxFee: readNullableNumber(row.maxFee ?? row.max_fee),
    startsAt: readNullableString(row.startsAt ?? row.starts_at),
    endsAt: readNullableString(row.endsAt ?? row.ends_at),
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

function assertRiskEventResult(
  value: unknown,
): asserts value is MarketFeeRuleMutationResult {
  if (
    !isRecord(value) ||
    typeof value.risk_event_id !== "string" ||
    value.risk_event_id.trim().length === 0
  ) {
    throw new ApiError(
      500,
      "ADMIN_RISK_EVENT_REQUIRED",
      "Admin fee rule write RPC did not return risk_event_id.",
      {
        details: { functionName: "admin_upsert_market_fee_rule" },
        expose: false,
      },
    );
  }
}

function summarizeMarketFeeRules(
  rows: ReturnType<typeof mapMarketFeeRuleRow>[],
) {
  return rows.reduce<Record<string, number>>((summary, row) => {
    const key = row.active ? "active" : "inactive";
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});
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

function normalizeNullableCode(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeInteger(
  value: unknown,
  field: string,
  bounds: { min?: number; max?: number } = {},
): number {
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

function normalizeNullableInteger(
  value: unknown,
  field: string,
  bounds: { min?: number; max?: number } = {},
): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return normalizeInteger(value, field, bounds);
}

function normalizeNullableIsoDate(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const raw = normalizeRequiredText(value, field);
  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be an ISO date`,
    );
  }

  return parsed.toISOString();
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
    "ADMIN_MARKET_FEE_RULES_RESULT_INVALID",
    "Market fee rules RPC returned an invalid payload.",
    {
      details: { field },
      expose: false,
    },
  );
}
