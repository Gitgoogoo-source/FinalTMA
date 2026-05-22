import { MarketMyListingStatsResponseSchema } from "../../packages/validation/src/market.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";

type MarketMyListingStatsRpcPayload = Record<string, unknown>;
type MarketMyListingStatsResponse = {
  active_count: number;
  active_listing_count?: number | undefined;
  active_item_count?: number | undefined;
  total_listing_value_kcoin: number;
  expected_net_amount_kcoin: number;
  sold_24h_count?: number | undefined;
  sold_24h_value_kcoin?: number | undefined;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const payload = await callMarketGetMyListingStats(
      session.userId,
      ctx.requestId,
    );

    return normalizeMarketMyListingStatsPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "market.my_listing_stats",
    },
  },
);

async function callMarketGetMyListingStats(
  userId: string,
  requestId: string,
): Promise<MarketMyListingStatsRpcPayload> {
  try {
    return await callRpcRaw<MarketMyListingStatsRpcPayload>(
      "market_get_my_listing_stats",
      {
        p_user_id: userId,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
        },
      },
    );
  } catch (error) {
    throw mapMarketMyListingStatsRpcError(error);
  }
}

function normalizeMarketMyListingStatsPayload(
  payload: unknown,
): MarketMyListingStatsResponse {
  if (!isRecord(payload)) {
    throw invalidMarketMyListingStatsResult();
  }

  const activeCount = payload.active_count ?? payload.active_listing_count;
  const normalized = {
    active_count: activeCount,
    active_listing_count: payload.active_listing_count ?? activeCount,
    active_item_count: payload.active_item_count,
    total_listing_value_kcoin: payload.total_listing_value_kcoin,
    expected_net_amount_kcoin: payload.expected_net_amount_kcoin,
    sold_24h_count: payload.sold_24h_count,
    sold_24h_value_kcoin: payload.sold_24h_value_kcoin,
  };

  const parsed = MarketMyListingStatsResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidMarketMyListingStatsResult(parsed.error.issues);
  }

  return parsed.data;
}

function invalidMarketMyListingStatsResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "MARKET_MY_LISTING_STATS_RESULT_INVALID",
    "我的挂单统计格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function mapMarketMyListingStatsRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof RpcError) {
    return new ApiError(
      500,
      "MARKET_MY_LISTING_STATS_RPC_FAILED",
      "读取我的挂单统计失败，请稍后重试。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return ApiError.internal("读取我的挂单统计失败，请稍后重试。", {
    cause: getErrorMessage(error),
  });
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
