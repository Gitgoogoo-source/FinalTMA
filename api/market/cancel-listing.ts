import {
  MarketCancelListingBodySchema,
  MarketCancelListingResponseSchema,
  type MarketCancelListingBody,
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
import { assertUserRiskAllowed } from "../_shared/riskGuards.js";
import { validate } from "../_shared/validate.js";

type MarketCancelListingRpcPayload = Record<string, unknown>;
type MarketCancelListingResponse = {
  listing_id: string;
  status: string;
  released_item_instance_ids: string[];
  cancelled_at?: string;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      MarketCancelListingBodySchema,
      normalizeMarketCancelListingInput(body, getIdempotencyKey(req)),
    );

    await assertMarketWriteAllowed();
    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "market.cancel_listing",
      idempotencyKey: input.idempotency_key,
      metadata: {
        listingId: input.listing_id,
        reason: input.reason ?? null,
      },
    });

    const payload = await callMarketCancelListing(
      input,
      session.userId,
      ctx.requestId,
    );

    return normalizeMarketCancelListingPayload(payload);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "market.cancel_listing",
    },
  },
);

export function normalizeMarketCancelListingInput(
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
    idempotency_key:
      body.idempotency_key ?? body.idempotencyKey ?? headerIdempotencyKey,
    reason: body.reason,
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

async function callMarketCancelListing(
  input: MarketCancelListingBody,
  userId: string,
  requestId: string,
): Promise<MarketCancelListingRpcPayload> {
  try {
    return await callRpcRaw<MarketCancelListingRpcPayload>(
      "market_cancel_listing",
      {
        p_user_id: userId,
        p_listing_id: input.listing_id,
        p_idempotency_key: input.idempotency_key,
        p_reason: input.reason,
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
    throw mapMarketCancelListingRpcError(error);
  }
}

function normalizeMarketCancelListingPayload(
  payload: unknown,
): MarketCancelListingResponse {
  if (!isRecord(payload)) {
    throw invalidMarketCancelListingResult();
  }

  const normalized = {
    listing_id: payload.listing_id,
    status: payload.status,
    released_item_instance_ids:
      payload.released_item_instance_ids ?? payload.released_item_ids,
    cancelled_at: payload.cancelled_at,
  };

  const parsed = MarketCancelListingResponseSchema.safeParse(normalized);

  if (!parsed.success) {
    throw invalidMarketCancelListingResult(parsed.error.issues);
  }

  return {
    listing_id: parsed.data.listing_id,
    status: parsed.data.status,
    released_item_instance_ids: parsed.data.released_item_instance_ids,
    ...(parsed.data.cancelled_at !== undefined
      ? { cancelled_at: parsed.data.cancelled_at }
      : {}),
  };
}

function invalidMarketCancelListingResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "MARKET_CANCEL_LISTING_RESULT_INVALID",
    "下架结果格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function mapMarketCancelListingRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("下架失败，请稍后重试。", {
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
      "幂等键已被其他下架请求使用。",
    );
  }

  if (message.includes("listing not found")) {
    return new ApiError(404, "LISTING_NOT_FOUND", "挂单不存在或已下架。");
  }

  if (message.includes("not listing owner")) {
    return new ApiError(403, "FORBIDDEN", "只有卖家可以下架挂单。");
  }

  if (message.includes("listing cannot be cancelled")) {
    return new ApiError(409, "LISTING_NOT_ACTIVE", "当前挂单状态不可下架。");
  }

  if (
    message.includes("listing item integrity violation") ||
    message.includes("listing lock integrity violation")
  ) {
    return new ApiError(
      409,
      "LISTING_NOT_ACTIVE",
      "挂单库存状态异常，请刷新后重试。",
    );
  }

  return new ApiError(
    500,
    "MARKET_CANCEL_LISTING_RPC_FAILED",
    "下架失败，请稍后重试。",
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
