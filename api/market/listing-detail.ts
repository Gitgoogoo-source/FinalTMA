import {
  MarketListingDetailDtoSchema,
  MarketListingDetailQuerySchema,
  MarketListingDetailResponseSchema,
  type MarketListingDetailQuery,
} from "../../packages/validation/src/market.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { normalizePublicStorageUrl } from "../_shared/publicStorageUrl.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type MarketListingDetailRpcPayload = Record<string, unknown>;
type MarketListingDetailResponse = {
  listing: Record<string, unknown>;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(MarketListingDetailQuerySchema, req.query);

    const payload = await callMarketGetListingDetail(
      query,
      session.userId,
      ctx.requestId,
    );

    return normalizeMarketListingDetailPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "market.listing_detail",
    },
  },
);

async function callMarketGetListingDetail(
  query: MarketListingDetailQuery,
  userId: string,
  requestId: string,
): Promise<MarketListingDetailRpcPayload> {
  try {
    return await callRpcRaw<MarketListingDetailRpcPayload>(
      "market_get_listing_detail",
      {
        p_user_id: userId,
        p_listing_id: query.listing_id,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          listingId: query.listing_id,
        },
      },
    );
  } catch (error) {
    throw mapMarketListingDetailRpcError(error);
  }
}

function normalizeMarketListingDetailPayload(
  payload: unknown,
): MarketListingDetailResponse {
  if (!isRecord(payload) || !isRecord(payload.listing)) {
    throw invalidMarketListingDetailResult();
  }

  const normalized = {
    listing: normalizeListingDetail(payload.listing),
  };

  const parsed = MarketListingDetailResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidMarketListingDetailResult(parsed.error.issues);
  }

  return parsed.data;
}

function normalizeListingDetail(item: Record<string, unknown>) {
  const normalized = {
    listing_id: item.listing_id,
    seller_user_id: item.seller_user_id,
    template_id: item.template_id,
    form_id: item.form_id,
    name: item.name,
    serial_no: item.serial_no,
    rarity: item.rarity,
    type_code: item.type_code,
    image_url: normalizePublicStorageUrl(item.image_url),
    seller: item.seller,
    seller_display_name: item.seller_display_name,
    unit_price_kcoin: item.unit_price_kcoin,
    currency_code: item.currency_code,
    item_count: item.item_count,
    remaining_count: item.remaining_count,
    status: item.status,
    description: item.description,
    floor_price_kcoin: item.floor_price_kcoin,
    avg_price_kcoin: item.avg_price_kcoin,
    last_sale_price_kcoin: item.last_sale_price_kcoin,
    reference_price_kcoin: item.reference_price_kcoin,
    active_listing_count: item.active_listing_count,
    sale_count_24h: item.sale_count_24h,
    volume_24h_kcoin: item.volume_24h_kcoin,
    snapshot_at: item.snapshot_at,
    price_health: item.price_health,
    market_depth: item.market_depth,
    item_instance_ids: item.item_instance_ids,
    is_own_listing: item.is_own_listing,
    is_buyable: item.is_buyable,
    not_buyable_reason: item.not_buyable_reason,
    can_buy: item.can_buy,
    disabled_reason: item.disabled_reason,
    created_at: item.created_at,
    expires_at: item.expires_at,
  };

  const parsed = MarketListingDetailDtoSchema.safeParse(normalized);

  if (!parsed.success) {
    return normalized;
  }

  return parsed.data;
}

function invalidMarketListingDetailResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "MARKET_LISTING_DETAIL_RESULT_INVALID",
    "挂单详情格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function mapMarketListingDetailRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof RpcError) {
    if (isListingNotFoundError(error)) {
      return new ApiError(404, "LISTING_NOT_FOUND", "挂单不存在或已下架。");
    }

    return new ApiError(
      500,
      "MARKET_LISTING_DETAIL_RPC_FAILED",
      "读取挂单详情失败，请稍后重试。",
      {
        cause: error,
        expose: false,
      },
    );
  }

  return ApiError.internal("读取挂单详情失败，请稍后重试。", {
    cause: getErrorMessage(error),
  });
}

function isListingNotFoundError(error: RpcError): boolean {
  const message = [error.message, error.details, error.hint, error.code]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return message.includes("listing not found");
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
