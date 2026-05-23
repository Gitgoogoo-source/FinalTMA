import {
  MarketBuyListingBodySchema,
  MarketBuyListingResponseSchema,
  type MarketBuyListingBody,
} from "../../packages/validation/src/market.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type MarketBuyListingRpcPayload = Record<string, unknown>;
type MarketBuyListingResponse = {
  order_id: string;
  purchased_items: Array<Record<string, unknown>>;
  total_price_kcoin: number;
  fee_amount_kcoin: number;
  seller_net_amount_kcoin: number;
  buyer_balance_after: number;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      MarketBuyListingBodySchema,
      normalizeMarketBuyListingInput(body, getIdempotencyKey(req)),
    );

    const payload = await callMarketBuyListing(
      input,
      session.userId,
      ctx.requestId,
    );

    return normalizeMarketBuyListingPayload(payload);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "market.buy",
    },
  },
);

export function normalizeMarketBuyListingInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotency_key: headerIdempotencyKey,
    };
  }

  return {
    listing_id: body.listing_id ?? body.listingId,
    quantity: body.quantity,
    expected_unit_price_kcoin:
      body.expected_unit_price_kcoin ?? body.expectedUnitPriceKcoin,
    idempotency_key:
      body.idempotency_key ?? body.idempotencyKey ?? headerIdempotencyKey,
    client_context: body.client_context ?? body.clientContext,
    ...(body.user_id !== undefined ? { user_id: body.user_id } : {}),
    ...(body.buyer_user_id !== undefined
      ? { buyer_user_id: body.buyer_user_id }
      : {}),
    ...(body.seller_user_id !== undefined
      ? { seller_user_id: body.seller_user_id }
      : {}),
  };
}

async function callMarketBuyListing(
  input: MarketBuyListingBody,
  userId: string,
  requestId: string,
): Promise<MarketBuyListingRpcPayload> {
  try {
    return await callRpcRaw<MarketBuyListingRpcPayload>(
      "market_buy_listing",
      {
        p_buyer_user_id: userId,
        p_listing_id: input.listing_id,
        p_quantity: input.quantity,
        p_expected_unit_price_kcoin: input.expected_unit_price_kcoin,
        p_idempotency_key: input.idempotency_key,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          listingId: input.listing_id,
          idempotencyKey: input.idempotency_key,
        },
      },
    );
  } catch (error) {
    throw mapMarketBuyListingRpcError(error);
  }
}

function normalizeMarketBuyListingPayload(
  payload: unknown,
): MarketBuyListingResponse {
  if (!isRecord(payload)) {
    throw invalidMarketBuyListingResult();
  }

  const normalized = {
    order_id: payload.order_id,
    purchased_items: Array.isArray(payload.purchased_items)
      ? payload.purchased_items.map(normalizePurchasedItem)
      : payload.purchased_items,
    total_price_kcoin: payload.total_price_kcoin,
    fee_amount_kcoin: payload.fee_amount_kcoin,
    seller_net_amount_kcoin: payload.seller_net_amount_kcoin,
    buyer_balance_after: payload.buyer_balance_after,
  };

  const parsed = MarketBuyListingResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidMarketBuyListingResult(parsed.error.issues);
  }

  return parsed.data;
}

function normalizePurchasedItem(item: unknown): Record<string, unknown> {
  if (!isRecord(item)) {
    return {};
  }

  return {
    item_instance_id: item.item_instance_id,
    template_id: item.template_id,
    form_id: item.form_id,
  };
}

function invalidMarketBuyListingResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "MARKET_BUY_LISTING_RESULT_INVALID",
    "购买结果格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function mapMarketBuyListingRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("购买失败，请稍后重试。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("idempotency_key is required")) {
    return new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键。");
  }

  if (message.includes("idempotency conflict")) {
    return new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "幂等键已被其他购买请求使用。",
    );
  }

  if (message.includes("listing not found")) {
    return new ApiError(404, "LISTING_NOT_FOUND", "挂单不存在或已下架。");
  }

  if (message.includes("buyer cannot buy own listing")) {
    return new ApiError(409, "CANNOT_BUY_OWN_LISTING", "不能购买自己的挂单。");
  }

  if (message.includes("insufficient balance")) {
    return new ApiError(409, "KCOIN_NOT_ENOUGH", "KCOIN 余额不足。");
  }

  if (message.includes("listing price changed")) {
    return new ApiError(
      409,
      "LISTING_PRICE_CHANGED",
      "价格已变化，请刷新后重试。",
    );
  }

  if (
    message.includes("listing sold out") ||
    message.includes("not enough reserved items")
  ) {
    return new ApiError(409, "LISTING_SOLD_OUT", "商品已售罄。");
  }

  if (
    message.includes("listing is not buyable") ||
    message.includes("listing item integrity violation") ||
    message.includes("listing lock integrity violation")
  ) {
    return new ApiError(
      409,
      "LISTING_NOT_BUYABLE",
      "挂单当前不可购买，请刷新后重试。",
    );
  }

  return new ApiError(
    500,
    "MARKET_BUY_LISTING_RPC_FAILED",
    "购买失败，请稍后重试。",
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
