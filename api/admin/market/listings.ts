import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  runReadRpc,
  type JsonObject,
} from "../../../packages/server/src/db/transactions.js";
import {
  buildAdminRpcContext,
  firstQueryValue,
  mapAdminRpcError,
  normalizeOptionalText,
} from "../_shared.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const UUID_FIELD_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LISTING_STATUSES = new Set([
  "active",
  "sold",
  "partially_sold",
  "cancelled",
  "expired",
  "suspended",
]);

const PRICE_HEALTH_STATUSES = new Set([
  "too_low",
  "healthy",
  "too_high",
  "unknown",
]);

type AdminMarketListingFilters = {
  status: string | null;
  rarityCode: string | null;
  templateId: string | null;
  formId: string | null;
  minPriceKcoin: number | null;
  maxPriceKcoin: number | null;
  sellerUserId: string | null;
  priceHealth: string | null;
  limit: number;
  cursor: number;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const admin = await requireAdmin(req, {
      permissions: ["market:read", "admin:read"],
      requireAll: false,
    });
    const filters = parseAdminMarketListingFilters(req.query);

    try {
      const payload = await runReadRpc<JsonObject>({
        schema: "api",
        functionName: "admin_list_market_listings",
        args: {
          p_admin_user_id: admin.adminId,
          p_status: filters.status,
          p_rarity_code: filters.rarityCode,
          p_template_id: filters.templateId,
          p_form_id: filters.formId,
          p_min_price_kcoin: filters.minPriceKcoin,
          p_max_price_kcoin: filters.maxPriceKcoin,
          p_seller_user_id: filters.sellerUserId,
          p_price_health: filters.priceHealth,
          p_limit: filters.limit,
          p_cursor: filters.cursor,
          p_request_context: buildAdminRpcContext(admin, ctx),
        },
        traceId: ctx.requestId,
        label: "admin_list_market_listings",
      });

      return normalizeAdminMarketListingsPayload(payload, filters);
    } catch (error) {
      throw mapAdminRpcError(error, "ADMIN_MARKET_LISTINGS_LOOKUP_FAILED");
    }
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);

function parseAdminMarketListingFilters(
  query: Record<string, unknown>,
): AdminMarketListingFilters {
  const limit = parseStrictLimit(query.limit);
  const cursor = parseStrictCursor(query.cursor);
  const minPriceKcoin = parseOptionalIntegerAmount(
    query.minPriceKcoin ?? query.min_price_kcoin,
    "minPriceKcoin",
  );
  const maxPriceKcoin = parseOptionalIntegerAmount(
    query.maxPriceKcoin ?? query.max_price_kcoin,
    "maxPriceKcoin",
  );

  if (
    minPriceKcoin !== null &&
    maxPriceKcoin !== null &&
    minPriceKcoin > maxPriceKcoin
  ) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "minPriceKcoin must be less than or equal to maxPriceKcoin",
    );
  }

  return {
    status: parseOptionalEnum(
      query.status,
      LISTING_STATUSES,
      "status",
      "listing status",
    ),
    rarityCode: parseOptionalCode(query.rarityCode ?? query.rarity_code),
    templateId: parseOptionalUuidAlias(
      query.templateId ?? query.template_id ?? query.template,
      "templateId",
    ),
    formId: parseOptionalUuidAlias(query.formId ?? query.form_id, "formId"),
    minPriceKcoin,
    maxPriceKcoin,
    sellerUserId: parseOptionalUuidAlias(
      query.sellerUserId ?? query.seller_user_id ?? query.user,
      "sellerUserId",
    ),
    priceHealth: parseOptionalEnum(
      query.priceHealth ?? query.price_health,
      PRICE_HEALTH_STATUSES,
      "priceHealth",
      "price health",
    ),
    limit,
    cursor,
  };
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

function parseOptionalIntegerAmount(
  value: unknown,
  field: string,
): number | null {
  const raw = firstQueryValue(value);

  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || String(parsed) !== raw || parsed < 0) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a non-negative integer`,
    );
  }

  return parsed;
}

function parseOptionalEnum(
  value: unknown,
  allowed: Set<string>,
  field: string,
  label: string,
): string | null {
  const normalized = firstQueryValue(value)?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (!allowed.has(normalized)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `${field} must be a valid ${label}`,
    );
  }

  return normalized;
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

function normalizeAdminMarketListingsPayload(
  payload: JsonObject,
  filters: AdminMarketListingFilters,
): JsonObject {
  const itemsSource = readArray(payload.items) ?? readArray(payload.rows) ?? [];
  const items = itemsSource
    .slice(0, filters.limit)
    .map(normalizeAdminMarketListingItem);
  const nextCursor =
    readCursorValue(payload.nextCursor) ??
    readCursorValue(payload.next_cursor) ??
    buildNextCursorFromRows(itemsSource.length, filters.limit, filters.cursor);

  return {
    items,
    summary: (readRecord(payload.summary) ?? {}) as JsonObject,
    nextCursor,
    serverTime:
      readString(payload.serverTime) ??
      readString(payload.server_time) ??
      new Date().toISOString(),
  };
}

function normalizeAdminMarketListingItem(value: unknown): JsonObject {
  const item = readRecord(value);

  if (!item) {
    return {};
  }

  return {
    id: readString(item.id),
    status: readString(item.status),
    sellerUserId:
      readString(item.sellerUserId) ?? readString(item.seller_user_id),
    sellerTelegramId:
      readPrimitive(item.sellerTelegramId) ??
      readPrimitive(item.seller_telegram_id),
    templateId: readString(item.templateId) ?? readString(item.template_id),
    templateName:
      readString(item.templateName) ?? readString(item.template_name),
    templateSlug:
      readString(item.templateSlug) ?? readString(item.template_slug),
    formId: readString(item.formId) ?? readString(item.form_id),
    formName: readString(item.formName) ?? readString(item.form_name),
    rarityCode: readString(item.rarityCode) ?? readString(item.rarity_code),
    itemCount:
      readNumberLike(item.itemCount) ?? readNumberLike(item.item_count),
    remainingCount:
      readNumberLike(item.remainingCount) ??
      readNumberLike(item.remaining_count),
    unitPriceKcoin:
      readNumberLike(item.unitPriceKcoin) ??
      readNumberLike(item.unit_price_kcoin),
    totalPriceKcoin:
      readNumberLike(item.totalPriceKcoin) ??
      readNumberLike(item.total_price_kcoin),
    feeBps: readNumberLike(item.feeBps) ?? readNumberLike(item.fee_bps),
    feeAmountKcoin:
      readNumberLike(item.feeAmountKcoin) ??
      readNumberLike(item.fee_amount_kcoin),
    expectedNetAmount:
      readNumberLike(item.expectedNetAmount) ??
      readNumberLike(item.expected_net_amount),
    priceHealth: readString(item.priceHealth) ?? readString(item.price_health),
    abnormalReasons:
      readStringArray(item.abnormalReasons) ??
      readStringArray(item.abnormal_reasons),
    anomalyType: readString(item.anomalyType) ?? readString(item.anomaly_type),
    anomalyTypes:
      readStringArray(item.anomalyTypes) ?? readStringArray(item.anomaly_types),
    lockWarning: readString(item.lockWarning) ?? readString(item.lock_warning),
    lockStatus: readString(item.lockStatus) ?? readString(item.lock_status),
    expiresAt: readString(item.expiresAt) ?? readString(item.expires_at),
    lastPriceChangedAt:
      readString(item.lastPriceChangedAt) ??
      readString(item.last_price_changed_at),
    createdAt: readString(item.createdAt) ?? readString(item.created_at),
    updatedAt: readString(item.updatedAt) ?? readString(item.updated_at),
  };
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
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

function readPrimitive(value: unknown): string | number | boolean | null {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : null;
}

function readNumberLike(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const strings = value.filter(
    (item): item is string => typeof item === "string",
  );
  return strings.length === value.length ? strings : null;
}
