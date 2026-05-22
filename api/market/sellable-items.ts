import {
  MarketSellableItemDtoSchema,
  MarketSellableItemsQuerySchema,
  MarketSellableItemsResponseSchema,
  type MarketSellableItemsQuery,
} from "../../packages/validation/src/market.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type MarketSellableItemsRpcPayload = Record<string, unknown>;
type MarketSellableItemsResponse = {
  items: Array<Record<string, unknown>>;
  next_cursor: string | null;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(MarketSellableItemsQuerySchema, req.query);

    const payload = await callMarketListSellableItems(
      query,
      session.userId,
      ctx.requestId,
    );

    return normalizeMarketSellableItemsPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "market.sellable_items",
    },
  },
);

async function callMarketListSellableItems(
  query: MarketSellableItemsQuery,
  userId: string,
  requestId: string,
): Promise<MarketSellableItemsRpcPayload> {
  try {
    return await callRpcRaw<MarketSellableItemsRpcPayload>(
      "market_list_sellable_items",
      {
        p_user_id: userId,
        p_rarities: query.rarities ?? null,
        p_type_codes: query.type_codes ?? null,
        p_series_ids: query.series_ids ?? null,
        p_template_ids: query.template_ids ?? null,
        p_only_duplicates: query.only_duplicates,
        p_min_level: query.min_level ?? null,
        p_max_level: query.max_level ?? null,
        p_keyword: null,
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
    throw mapMarketSellableItemsRpcError(error);
  }
}

function normalizeMarketSellableItemsPayload(
  payload: unknown,
): MarketSellableItemsResponse {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw invalidMarketSellableItemsResult();
  }

  const normalized = {
    items: payload.items.map(normalizeSellableItem),
    next_cursor: payload.next_cursor ?? null,
  };

  const parsed = MarketSellableItemsResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidMarketSellableItemsResult(parsed.error.issues);
  }

  return parsed.data;
}

function normalizeSellableItem(item: unknown): Record<string, unknown> {
  if (!isRecord(item)) {
    return {};
  }

  const normalized = {
    item_instance_id: item.item_instance_id,
    item_instance_ids: item.item_instance_ids,
    template_id: item.template_id,
    form_id: item.form_id,
    serial_no: item.serial_no,
    name: item.name,
    rarity: item.rarity,
    type_code: item.type_code,
    image_url: item.image_url,
    level: item.level,
    power: item.power,
    owned_count: item.owned_count,
    available_count: item.available_count,
    suggested_price: item.suggested_price,
    min_price: item.min_price,
    max_price: item.max_price,
    acquired_at: item.acquired_at,
    is_tradeable: item.is_tradeable,
  };

  const parsed = MarketSellableItemDtoSchema.safeParse(normalized);

  if (!parsed.success) {
    return normalized;
  }

  return parsed.data;
}

function invalidMarketSellableItemsResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "MARKET_SELLABLE_ITEMS_RESULT_INVALID",
    "可出售藏品列表格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function mapMarketSellableItemsRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof RpcError) {
    return new ApiError(
      500,
      "MARKET_SELLABLE_ITEMS_RPC_FAILED",
      "读取可出售藏品失败，请稍后重试。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return ApiError.internal("读取可出售藏品失败，请稍后重试。", {
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
