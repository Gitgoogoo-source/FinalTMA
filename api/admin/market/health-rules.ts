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
  callAdminWriteRpc,
  firstQueryValue,
  isRecord,
  mapAdminRpcError,
  normalizeBoolean,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeRequiredUuid,
  readHeaderIdempotencyKey,
  requireAdminConfirmHeader,
  toJsonObject,
  type JsonRecord,
} from "../_shared.js";
import { sanitizeAdminJson } from "../gacha/_shared.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const FLOOR_RATIO = 1;
const FLOOR_RATIO_BPS = 10_000;
const UUID_FIELD_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type HealthRuleFilters = {
  active: boolean | null;
  rarityCode: string | null;
  templateId: string | null;
  formId: string | null;
  limit: number;
  cursor: number;
};

type HealthRuleInput = {
  id: string | null;
  rarityCode: string | null;
  templateId: string | null;
  formId: string | null;
  minRatioToFloor: number;
  maxRatioToFloor: number;
  active: boolean;
  metadata: JsonObject;
};

type HealthRuleMutationResult = Record<string, unknown> & {
  audit_log_id: string;
  risk_event_id?: string | null;
  server_time?: string;
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
      const filters = parseHealthRuleFilters(req.query);

      try {
        const payload = await runReadRpc<JsonObject>({
          schema: "api",
          functionName: "admin_list_market_health_rules",
          args: {
            p_admin_user_id: admin.adminId,
            p_active: filters.active,
            p_rarity_code: filters.rarityCode,
            p_template_id: filters.templateId,
            p_form_id: filters.formId,
            p_limit: filters.limit,
            p_cursor: filters.cursor,
            p_request_context: buildAdminRpcContext(admin, ctx),
          },
          traceId: ctx.requestId,
          label: "admin_list_market_health_rules",
        });

        return normalizeHealthRulesPayload(payload, filters);
      } catch (error) {
        throw mapAdminRpcError(
          error,
          "ADMIN_MARKET_HEALTH_RULES_LOOKUP_FAILED",
        );
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

    const idempotencyKey = readHeaderIdempotencyKey(req);
    const reason = normalizeRequiredText(body.reason, "reason");
    const input = normalizeHealthRuleInput(body, {
      requireId: ctx.method === "PATCH",
    });

    try {
      const result = await callUpsertHealthRule({
        adminUserId: admin.adminId,
        input,
        idempotencyKey,
        reason,
        requestId: ctx.requestId,
        requestContext: buildAdminRpcContext(admin, ctx),
      });

      assertRiskEventResult(result);

      return {
        ...normalizeHealthRuleMutationResult(result),
        serverTime: result.server_time ?? new Date().toISOString(),
      };
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_MARKET_HEALTH_RULE_UPSERT_FAILED");
    }
  },
  {
    methods: ["GET", "POST", "PATCH"],
    rateLimit: false,
  },
);

async function callUpsertHealthRule(input: {
  adminUserId: string;
  input: HealthRuleInput;
  idempotencyKey: string;
  reason: string;
  requestId: string;
  requestContext: JsonObject;
}): Promise<HealthRuleMutationResult> {
  return await callAdminWriteRpc<HealthRuleMutationResult>({
    functionName: "admin_upsert_market_health_rule",
    requestId: input.requestId,
    args: {
      p_admin_user_id: input.adminUserId,
      p_health_rule_id: input.input.id,
      p_rarity_code: input.input.rarityCode,
      p_template_id: input.input.templateId,
      p_form_id: input.input.formId,
      p_min_ratio_to_floor: input.input.minRatioToFloor,
      p_max_ratio_to_floor: input.input.maxRatioToFloor,
      p_active: input.input.active,
      p_metadata: input.input.metadata,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
      p_request_context: input.requestContext,
    },
  });
}

function parseHealthRuleFilters(
  query: Record<string, unknown>,
): HealthRuleFilters {
  return {
    active: parseOptionalBoolean(query.active, "active"),
    rarityCode: parseOptionalCode(query.rarityCode ?? query.rarity_code),
    templateId: parseOptionalUuidAlias(
      query.templateId ?? query.template_id ?? query.template,
      "templateId",
    ),
    formId: parseOptionalUuidAlias(query.formId ?? query.form_id, "formId"),
    limit: parseStrictLimit(query.limit),
    cursor: parseStrictCursor(query.cursor),
  };
}

function normalizeHealthRuleInput(
  body: JsonRecord,
  options: { requireId: boolean },
): HealthRuleInput {
  const id = parseOptionalBodyUuid(
    body.healthRuleId ?? body.health_rule_id ?? body.id,
    "healthRuleId",
  );

  if (options.requireId && !id) {
    throw new ApiError(400, "VALIDATION_FAILED", "healthRuleId is required");
  }

  const ratios = normalizeFloorRatios(body);

  return {
    id: id ?? null,
    rarityCode: parseOptionalCode(body.rarityCode ?? body.rarity_code),
    templateId:
      parseOptionalBodyUuid(
        body.templateId ?? body.template_id,
        "templateId",
      ) ?? null,
    formId:
      parseOptionalBodyUuid(body.formId ?? body.form_id, "formId") ?? null,
    minRatioToFloor: ratios.minRatioToFloor,
    maxRatioToFloor: ratios.maxRatioToFloor,
    active: normalizeBoolean(body.active ?? true, "active"),
    metadata: normalizeJsonObject(body.metadata),
  };
}

function normalizeFloorRatios(body: JsonRecord): {
  minRatioToFloor: number;
  maxRatioToFloor: number;
} {
  const minBps = findFirstDefined(
    body.lowBps,
    body.low_bps,
    body.minBps,
    body.min_bps,
    body.minRatioBps,
    body.min_ratio_bps,
  );
  const maxBps = findFirstDefined(
    body.highBps,
    body.high_bps,
    body.maxBps,
    body.max_bps,
    body.maxRatioBps,
    body.max_ratio_bps,
  );

  const usingBps = minBps !== undefined || maxBps !== undefined;

  if (usingBps) {
    if (minBps === undefined || maxBps === undefined) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        "Both lowBps and highBps are required when using bps input",
      );
    }

    const lowBps = normalizeInteger(minBps, "lowBps", { min: 0 });
    const highBps = normalizeInteger(maxBps, "highBps", { min: 1 });

    if (!(lowBps < FLOOR_RATIO_BPS && highBps > FLOOR_RATIO_BPS)) {
      throw new ApiError(
        400,
        "VALIDATION_FAILED",
        "lowBps must be < 10000 and highBps must be > 10000",
      );
    }

    return {
      minRatioToFloor: Number((lowBps / FLOOR_RATIO_BPS).toFixed(4)),
      maxRatioToFloor: Number((highBps / FLOOR_RATIO_BPS).toFixed(4)),
    };
  }

  const minRatioToFloor = normalizeNumber(
    findFirstDefined(
      body.minRatioToFloor,
      body.min_ratio_to_floor,
      body.lowRatioToFloor,
      body.low_ratio_to_floor,
    ),
    "minRatioToFloor",
  );
  const maxRatioToFloor = normalizeNumber(
    findFirstDefined(
      body.maxRatioToFloor,
      body.max_ratio_to_floor,
      body.highRatioToFloor,
      body.high_ratio_to_floor,
    ),
    "maxRatioToFloor",
  );

  if (!(minRatioToFloor < FLOOR_RATIO && maxRatioToFloor > FLOOR_RATIO)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "minRatioToFloor must be < 1 and maxRatioToFloor must be > 1",
    );
  }

  return {
    minRatioToFloor,
    maxRatioToFloor,
  };
}

function normalizeHealthRulesPayload(
  payload: JsonObject,
  filters: HealthRuleFilters,
) {
  const itemsSource = readArray(payload.items) ?? readArray(payload.rows) ?? [];
  const items = itemsSource
    .slice(0, filters.limit)
    .map(normalizeHealthRuleItem);
  const nextCursor =
    readCursorValue(payload.nextCursor) ??
    readCursorValue(payload.next_cursor) ??
    buildNextCursorFromRows(itemsSource.length, filters.limit, filters.cursor);

  return {
    items,
    summary: readRecord(payload.summary) ?? summarizeHealthRules(items),
    nextCursor,
    serverTime:
      readString(payload.serverTime) ??
      readString(payload.server_time) ??
      new Date().toISOString(),
  };
}

function normalizeHealthRuleMutationResult(
  result: HealthRuleMutationResult,
): Record<string, unknown> {
  return {
    ...result,
    rule: normalizeHealthRuleItem(result.rule),
  };
}

function normalizeHealthRuleItem(value: unknown): Record<string, unknown> {
  const item = readRecord(value);

  if (!item) {
    return {};
  }

  return {
    id: readString(item.id),
    rarityCode: readString(item.rarityCode) ?? readString(item.rarity_code),
    templateId: readString(item.templateId) ?? readString(item.template_id),
    formId: readString(item.formId) ?? readString(item.form_id),
    formIndex: readNumberLike(item.formIndex) ?? readNumberLike(item.form_index),
    formName: readString(item.formName) ?? readString(item.form_name),
    minRatioToFloor:
      readNumberLike(item.minRatioToFloor) ??
      readNumberLike(item.min_ratio_to_floor),
    maxRatioToFloor:
      readNumberLike(item.maxRatioToFloor) ??
      readNumberLike(item.max_ratio_to_floor),
    active: readBoolean(item.active),
    metadata: sanitizeAdminJson(item.metadata) ?? {},
    createdAt: readString(item.createdAt) ?? readString(item.created_at),
    updatedAt: readString(item.updatedAt) ?? readString(item.updated_at),
  };
}

function assertRiskEventResult(
  value: unknown,
): asserts value is HealthRuleMutationResult {
  if (
    !isRecord(value) ||
    typeof value.risk_event_id !== "string" ||
    value.risk_event_id.trim().length === 0
  ) {
    throw new ApiError(
      500,
      "ADMIN_RISK_EVENT_REQUIRED",
      "Admin health rule write RPC did not return risk_event_id.",
      {
        details: { functionName: "admin_upsert_market_health_rule" },
        expose: false,
      },
    );
  }
}

function parseStrictLimit(value: unknown): number {
  const raw = firstQueryValue(value);

  if (!raw) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);

  if (
    !Number.isFinite(parsed) ||
    String(parsed) !== raw ||
    parsed < 1 ||
    parsed > MAX_LIMIT
  ) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `limit must be an integer from 1 to ${MAX_LIMIT}`,
    );
  }

  return parsed;
}

function parseStrictCursor(value: unknown): number {
  const raw = firstQueryValue(value);

  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || String(parsed) !== raw || parsed < 0) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "cursor must be a non-negative integer offset",
    );
  }

  return parsed;
}

function parseOptionalBoolean(value: unknown, field: string): boolean | null {
  const raw = firstQueryValue(value);
  return raw ? normalizeBoolean(raw, field) : null;
}

function parseOptionalCode(value: unknown): string | null {
  const normalized = firstQueryValue(value)?.trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  if (!/^[A-Z0-9_-]{1,64}$/.test(normalized)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "rarityCode must be a valid code",
    );
  }

  return normalized;
}

function parseOptionalUuidAlias(value: unknown, field: string): string | null {
  const raw = firstQueryValue(value);

  if (!raw) {
    return null;
  }

  if (!UUID_FIELD_RE.test(raw)) {
    throw new ApiError(400, "VALIDATION_FAILED", `${field} must be a UUID`);
  }

  return raw;
}

function parseOptionalBodyUuid(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return normalizeRequiredUuid(value, field);
}

function normalizeJsonObject(value: unknown): JsonObject {
  return toJsonObject(isRecord(value) ? value : {});
}

function normalizeNumber(value: unknown, field: string): number {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a non-negative number`,
    );
  }

  return normalized;
}

function normalizeInteger(
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

function findFirstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function summarizeHealthRules(
  rows: Array<Record<string, unknown>>,
): Record<string, number> {
  return rows.reduce<Record<string, number>>((summary, row) => {
    const key = row.active === false ? "inactive" : "active";
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});
}

function buildNextCursorFromRows(
  rowCount: number,
  limit: number,
  cursor: number,
): string | null {
  return rowCount > limit ? String(cursor + limit) : null;
}

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readString(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized ?? null;
}

function readCursorValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(value);
  }

  return readString(value);
}

function readNumberLike(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
