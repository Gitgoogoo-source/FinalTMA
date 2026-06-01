import {
  InventorySellEntryBodySchema,
  type InventorySellEntryBody,
} from "../../packages/validation/src/inventory.schemas.js";
import { MarketCreateListingResponseSchema } from "../../packages/validation/src/market.schemas.js";
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
import { getErrorMessage, getRpcErrorText, isRecord } from "./_shared.js";

type MarketCreateListingRpcPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 32 * 1024,
    });
    const input = validate(
      InventorySellEntryBodySchema,
      normalizeInventorySellEntryInput(body, getIdempotencyKey(req)),
    );

    assertSupportedInventorySellEntry(input);
    await assertMarketWriteAllowed();
    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "market.create_listing",
      idempotencyKey: input.idempotency_key,
      metadata: {
        source: "inventory.sell_entry",
        itemCount: input.item_instance_ids.length,
        priceKcoin: input.unit_price,
      },
    });

    const payload = await callMarketCreateListing(
      input,
      session.userId,
      ctx.requestId,
    );

    return normalizeMarketCreateListingPayload(payload);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "market.create_listing",
    },
  },
);

export function normalizeInventorySellEntryInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotency_key: headerIdempotencyKey,
    };
  }

  return {
    item_instance_ids: body.item_instance_ids ?? body.itemInstanceIds,
    unit_price:
      body.unit_price ??
      body.unitPrice ??
      body.unit_price_kcoin ??
      body.unitPriceKcoin,
    currency: body.currency,
    allow_partial_fill:
      body.allow_partial_fill ?? body.allowPartialFill ?? false,
    expires_at: body.expires_at ?? body.expiresAt,
    idempotency_key:
      headerIdempotencyKey ?? body.idempotency_key ?? body.idempotencyKey,
    ...(body.user_id !== undefined ? { user_id: body.user_id } : {}),
    ...(body.seller_user_id !== undefined
      ? { seller_user_id: body.seller_user_id }
      : {}),
  };
}

function assertSupportedInventorySellEntry(
  input: InventorySellEntryBody,
): void {
  if (input.allow_partial_fill) {
    throw new ApiError(
      400,
      "SELL_ENTRY_PARTIAL_FILL_UNSUPPORTED",
      "藏品详情暂不支持部分成交挂单。",
    );
  }

  if (input.expires_at) {
    throw new ApiError(
      400,
      "SELL_ENTRY_EXPIRES_AT_UNSUPPORTED",
      "藏品详情暂不支持设置挂单过期时间。",
    );
  }
}

async function callMarketCreateListing(
  input: InventorySellEntryBody,
  userId: string,
  requestId: string,
): Promise<MarketCreateListingRpcPayload> {
  try {
    return await callRpcRaw<MarketCreateListingRpcPayload>(
      "market_create_listing",
      {
        p_user_id: userId,
        p_item_instance_ids: input.item_instance_ids,
        p_unit_price_kcoin: input.unit_price,
        p_idempotency_key: input.idempotency_key,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          itemCount: input.item_instance_ids.length,
          idempotencyKey: input.idempotency_key,
          source: "inventory.sell_entry",
        },
      },
    );
  } catch (error) {
    throw mapMarketCreateListingRpcError(error);
  }
}

function normalizeMarketCreateListingPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    throw invalidMarketCreateListingResult();
  }

  const parsed = MarketCreateListingResponseSchema.safeParse({
    listing_id: payload.listing_id,
    item_count: payload.item_count,
    remaining_count: payload.remaining_count,
    unit_price_kcoin: payload.unit_price_kcoin,
    fee_bps: payload.fee_bps,
    expected_net_amount: payload.expected_net_amount,
    status: payload.status,
    price_health: payload.price_health,
    idempotent: payload.idempotent ?? false,
  });

  if (!parsed.success) {
    throw invalidMarketCreateListingResult(parsed.error.issues);
  }

  return parsed.data;
}

function invalidMarketCreateListingResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "INVENTORY_SELL_ENTRY_RESULT_INVALID",
    "藏品出售结果格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function mapMarketCreateListingRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("创建藏品出售挂单失败，请稍后重试。", {
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
      "幂等键已被其他挂单请求使用。",
    );
  }

  if (message.includes("unit price must be positive")) {
    return new ApiError(400, "MARKET_PRICE_INVALID", "挂单价格无效。");
  }

  if (
    message.includes("item_instance_ids are required") ||
    message.includes("duplicate item ids are not allowed") ||
    message.includes("one listing must contain the same collectible and form")
  ) {
    return new ApiError(400, "ITEM_NOT_SELLABLE", "请选择可出售的同款藏品。");
  }

  if (message.includes("some items do not exist")) {
    return new ApiError(404, "ITEM_NOT_FOUND", "部分藏品不存在。");
  }

  if (message.includes("some items are already locked")) {
    return new ApiError(409, "ITEM_ALREADY_LOCKED", "藏品已被锁定。");
  }

  if (message.includes("some items are not sellable")) {
    return new ApiError(409, "ITEM_NOT_SELLABLE", "部分藏品不可出售。");
  }

  return new ApiError(
    500,
    "INVENTORY_SELL_ENTRY_RPC_FAILED",
    "创建藏品出售挂单失败。",
    {
      cause: error,
      expose: false,
    },
  );
}
