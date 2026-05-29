import {
  MarketUpdateListingPriceBodySchema,
  MarketUpdateListingPriceResponseSchema,
  type MarketUpdateListingPriceBody,
} from "../../packages/validation/src/market.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { assertMarketWriteAllowed } from "../../packages/server/src/market/marketGuards.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type MarketUpdateListingPriceRpcPayload = Record<string, unknown>;
type MarketUpdateListingPriceResponse = {
  listing_id: string;
  unit_price_kcoin: number;
  expected_net_amount: number;
  status?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      MarketUpdateListingPriceBodySchema,
      normalizeMarketUpdateListingPriceInput(body, getIdempotencyKey(req)),
    );

    await assertMarketWriteAllowed();

    const payload = await callMarketUpdateListingPrice(
      input,
      session.userId,
      ctx.requestId,
    );

    return normalizeMarketUpdateListingPricePayload(payload);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "market.update_price",
    },
  },
);

export function normalizeMarketUpdateListingPriceInput(
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
    new_unit_price_kcoin:
      body.new_unit_price_kcoin ??
      body.newUnitPriceKcoin ??
      body.unit_price_kcoin ??
      body.unitPriceKcoin,
    idempotency_key:
      body.idempotency_key ?? body.idempotencyKey ?? headerIdempotencyKey,
    client_context: body.client_context ?? body.clientContext,
    ...(body.user_id !== undefined ? { user_id: body.user_id } : {}),
    ...(body.seller_user_id !== undefined
      ? { seller_user_id: body.seller_user_id }
      : {}),
    ...(body.buyer_user_id !== undefined
      ? { buyer_user_id: body.buyer_user_id }
      : {}),
  };
}

async function callMarketUpdateListingPrice(
  input: MarketUpdateListingPriceBody,
  userId: string,
  requestId: string,
): Promise<MarketUpdateListingPriceRpcPayload> {
  try {
    return await callRpcRaw<MarketUpdateListingPriceRpcPayload>(
      "market_update_listing_price",
      {
        p_user_id: userId,
        p_listing_id: input.listing_id,
        p_new_unit_price_kcoin: input.new_unit_price_kcoin,
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
    throw mapMarketUpdateListingPriceRpcError(error);
  }
}

function normalizeMarketUpdateListingPricePayload(
  payload: unknown,
): MarketUpdateListingPriceResponse {
  if (!isRecord(payload)) {
    throw invalidMarketUpdateListingPriceResult();
  }

  const normalized = {
    listing_id: payload.listing_id,
    unit_price_kcoin: payload.unit_price_kcoin,
    expected_net_amount: payload.expected_net_amount,
    status: payload.status,
  };

  const parsed = MarketUpdateListingPriceResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidMarketUpdateListingPriceResult(parsed.error.issues);
  }

  return {
    listing_id: parsed.data.listing_id,
    unit_price_kcoin: parsed.data.unit_price_kcoin,
    expected_net_amount: parsed.data.expected_net_amount,
    ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
  };
}

function invalidMarketUpdateListingPriceResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "MARKET_UPDATE_PRICE_RESULT_INVALID",
    "改价结果格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function mapMarketUpdateListingPriceRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("改价失败，请稍后重试。", {
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
      "幂等键已被其他改价请求使用。",
    );
  }

  if (message.includes("new price must be positive")) {
    return new ApiError(400, "MARKET_PRICE_INVALID", "挂单价格无效。");
  }

  if (message.includes("listing not found")) {
    return new ApiError(404, "LISTING_NOT_FOUND", "挂单不存在或已下架。");
  }

  if (message.includes("not listing owner")) {
    return new ApiError(403, "FORBIDDEN", "只有卖家可以修改挂单价格。");
  }

  if (message.includes("listing is not editable")) {
    return new ApiError(409, "LISTING_NOT_ACTIVE", "当前挂单状态不可改价。");
  }

  return new ApiError(
    500,
    "MARKET_UPDATE_PRICE_RPC_FAILED",
    "改价失败，请稍后重试。",
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
