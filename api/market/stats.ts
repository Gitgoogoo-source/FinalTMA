import {
  MarketDepthLevelDtoSchema,
  MarketPriceStatsDtoSchema,
  MarketStatsQuerySchema,
  MarketStatsResponseSchema,
  type MarketStatsQuery,
} from "../../packages/validation/src/market.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type MarketStatsRpcPayload = Record<string, unknown>;
type MarketStatsResponse = {
  price: Record<string, unknown> | null;
  depth: Array<Record<string, unknown>>;
  price_health: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(MarketStatsQuerySchema, req.query);

    const payload = await callMarketGetStats(query, session.userId, ctx.requestId);

    return normalizeMarketStatsPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "market.stats",
    },
  },
);

async function callMarketGetStats(
  query: MarketStatsQuery,
  userId: string,
  requestId: string,
): Promise<MarketStatsRpcPayload> {
  try {
    return await callRpcRaw<MarketStatsRpcPayload>(
      "market_get_stats",
      {
        p_user_id: userId,
        p_template_id: query.template_id ?? null,
        p_form_id: query.form_id ?? null,
        p_series_id: query.series_id ?? null,
        p_rarity: query.rarity ?? null,
        p_type_code: query.type_code ?? null,
        p_period: query.period,
        p_include_depth: query.include_depth,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          templateId: query.template_id ?? null,
          formId: query.form_id ?? null,
        },
      },
    );
  } catch (error) {
    throw mapMarketStatsRpcError(error);
  }
}

function normalizeMarketStatsPayload(payload: unknown): MarketStatsResponse {
  if (!isRecord(payload)) {
    throw invalidMarketStatsResult();
  }

  const normalized = {
    price: payload.price === null ? null : normalizePriceStats(payload.price),
    depth: Array.isArray(payload.depth)
      ? payload.depth.map(normalizeDepthLevel)
      : payload.depth,
    price_health: payload.price_health ?? "unknown",
  };

  const parsed = MarketStatsResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidMarketStatsResult(parsed.error.issues);
  }

  return parsed.data;
}

function normalizePriceStats(price: unknown): Record<string, unknown> | null {
  if (!isRecord(price)) {
    return null;
  }

  const normalized = {
    template_id: price.template_id,
    form_id: price.form_id,
    floor_price_kcoin: price.floor_price_kcoin,
    avg_price_kcoin: price.avg_price_kcoin,
    last_sale_price_kcoin: price.last_sale_price_kcoin,
    active_listing_count: price.active_listing_count,
    sale_count_24h: price.sale_count_24h,
    volume_24h_kcoin: price.volume_24h_kcoin,
    snapshot_at: price.snapshot_at,
  };

  const parsed = MarketPriceStatsDtoSchema.safeParse(normalized);

  if (!parsed.success) {
    return normalized;
  }

  return parsed.data;
}

function normalizeDepthLevel(level: unknown): Record<string, unknown> {
  if (!isRecord(level)) {
    return {};
  }

  const normalized = {
    price_kcoin: level.price_kcoin ?? level.price_bucket_kcoin,
    listing_count: level.listing_count,
    item_count: level.item_count,
  };

  const parsed = MarketDepthLevelDtoSchema.safeParse(normalized);

  if (!parsed.success) {
    return normalized;
  }

  return parsed.data;
}

function invalidMarketStatsResult(details?: unknown): ApiError {
  return new ApiError(500, "MARKET_STATS_RESULT_INVALID", "市场统计格式无效。", {
    details,
    expose: false,
  });
}

function mapMarketStatsRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("读取市场统计失败，请稍后重试。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("at least one filter is required")) {
    return new ApiError(400, "MARKET_STATS_FILTER_REQUIRED", "请选择统计范围。");
  }

  return new ApiError(
    500,
    "MARKET_STATS_RPC_FAILED",
    "读取市场统计失败，请稍后重试。",
    {
      cause: error,
      expose: false,
    },
  );
}

function getRpcErrorText(error: RpcError): string {
  return [error.message, error.details, error.hint, error.code]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
