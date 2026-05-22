import {
  MarketMyListingsQuerySchema,
  MarketMyListingsResponseSchema,
  type MarketMyListingsQuery,
} from "../../packages/validation/src/market.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type MarketMyListingsRpcPayload = Record<string, unknown>;
type MarketMyListingsResponse = {
  items: Array<Record<string, unknown>>;
  next_cursor: string | null;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(MarketMyListingsQuerySchema, req.query);

    const payload = await callMarketListMyListings(
      query,
      session.userId,
      ctx.requestId,
    );

    return normalizeMarketMyListingsPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "market.my_listings",
    },
  },
);

async function callMarketListMyListings(
  query: MarketMyListingsQuery,
  userId: string,
  requestId: string,
): Promise<MarketMyListingsRpcPayload> {
  try {
    return await callRpcRaw<MarketMyListingsRpcPayload>(
      "market_list_my_listings",
      {
        p_user_id: userId,
        p_statuses: query.statuses ?? null,
        p_rarities: query.rarities ?? null,
        p_type_codes: query.type_codes ?? null,
        p_template_ids: query.template_ids ?? null,
        p_min_price: query.min_price ?? null,
        p_max_price: query.max_price ?? null,
        p_sort: query.sort,
        p_limit: query.limit,
        p_cursor: query.cursor ?? null,
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
    throw mapMarketMyListingsRpcError(error);
  }
}

function normalizeMarketMyListingsPayload(
  payload: unknown,
): MarketMyListingsResponse {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw invalidMarketMyListingsResult();
  }

  const normalized = {
    items: payload.items.map(normalizeMyListingCard),
    next_cursor: payload.next_cursor ?? null,
  };

  const parsed = MarketMyListingsResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidMarketMyListingsResult(parsed.error.issues);
  }

  return parsed.data;
}

function normalizeMyListingCard(item: unknown): Record<string, unknown> {
  if (!isRecord(item)) {
    return {};
  }

  const normalized = {
    listing_id: item.listing_id,
    seller_user_id: item.seller_user_id,
    template_id: item.template_id,
    form_id: item.form_id,
    name: item.name,
    serial_no: item.serial_no,
    rarity: item.rarity,
    type_code: item.type_code,
    image_url: item.image_url,
    unit_price_kcoin: item.unit_price_kcoin,
    currency_code: item.currency_code,
    item_count: item.item_count,
    remaining_count: item.remaining_count,
    expected_net_amount: item.expected_net_amount,
    status: item.status,
    seller_display_name: item.seller_display_name,
    is_own_listing: item.is_own_listing,
    is_buyable: item.is_buyable,
    not_buyable_reason: item.not_buyable_reason,
    price_health: item.price_health,
    last_price_changed_at: item.last_price_changed_at,
    created_at: item.created_at,
    expires_at: item.expires_at,
  };

  return normalized;
}

function invalidMarketMyListingsResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "MARKET_MY_LISTINGS_RESULT_INVALID",
    "我的挂单列表格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function mapMarketMyListingsRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof RpcError) {
    return new ApiError(
      500,
      "MARKET_MY_LISTINGS_RPC_FAILED",
      "读取我的挂单失败，请稍后重试。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return ApiError.internal("读取我的挂单失败，请稍后重试。", {
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
