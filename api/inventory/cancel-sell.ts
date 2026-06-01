import {
  InventoryCancelSellBodySchema,
  type InventoryCancelSellBody,
} from "../../packages/validation/src/inventory.schemas.js";
import { MarketCancelListingResponseSchema } from "../../packages/validation/src/market.schemas.js";
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
import {
  getErrorMessage,
  getRpcErrorText,
  isRecord,
  readBoolean,
  readString,
} from "./_shared.js";

type InventoryDetailRpcPayload = Record<string, unknown>;
type MarketCancelListingRpcPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      InventoryCancelSellBodySchema,
      normalizeInventoryCancelSellInput(body, getIdempotencyKey(req)),
    );

    await assertMarketWriteAllowed();
    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "market.cancel_listing",
      idempotencyKey: input.idempotency_key,
      metadata: {
        source: "inventory.cancel_sell",
        listingId: input.listing_id ?? null,
        itemInstanceId: input.item_instance_id ?? null,
      },
    });

    const listingId = await resolveListingId(
      input,
      session.userId,
      ctx.requestId,
    );
    const payload = await callMarketCancelListing(
      listingId,
      input.idempotency_key,
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

export function normalizeInventoryCancelSellInput(
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
    item_instance_id: body.item_instance_id ?? body.itemInstanceId,
    idempotency_key:
      headerIdempotencyKey ?? body.idempotency_key ?? body.idempotencyKey,
    ...(body.user_id !== undefined ? { user_id: body.user_id } : {}),
    ...(body.seller_user_id !== undefined
      ? { seller_user_id: body.seller_user_id }
      : {}),
    ...(body.buyer_user_id !== undefined
      ? { buyer_user_id: body.buyer_user_id }
      : {}),
  };
}

async function resolveListingId(
  input: InventoryCancelSellBody,
  userId: string,
  requestId: string,
): Promise<string> {
  if (input.listing_id) {
    return input.listing_id;
  }

  if (!input.item_instance_id) {
    throw new ApiError(400, "LISTING_ID_REQUIRED", "缺少挂单或藏品 ID。");
  }

  const detail = await callInventoryDetailRpc(
    input.item_instance_id,
    userId,
    requestId,
  );
  const marketStatus = isRecord(detail.market_status)
    ? detail.market_status
    : null;
  const listingId = readString(marketStatus?.listing_id);
  const isListed = readBoolean(marketStatus?.is_listed) ?? Boolean(listingId);

  if (!isListed || !listingId) {
    throw new ApiError(404, "LISTING_NOT_FOUND", "该藏品没有可下架挂单。");
  }

  return listingId;
}

async function callInventoryDetailRpc(
  itemInstanceId: string,
  userId: string,
  requestId: string,
): Promise<InventoryDetailRpcPayload> {
  try {
    return await callRpcRaw<InventoryDetailRpcPayload>(
      "inventory_get_item_detail",
      {
        p_user_id: userId,
        p_item_instance_id: itemInstanceId,
        p_include_market_status: true,
        p_include_upgrade_preview: false,
        p_include_evolution_preview: false,
        p_include_decompose_preview: false,
        p_include_onchain_status: false,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          itemInstanceId,
          source: "inventory.cancel_sell",
        },
      },
    );
  } catch (error) {
    throw mapInventoryDetailRpcError(error);
  }
}

async function callMarketCancelListing(
  listingId: string,
  idempotencyKey: string,
  userId: string,
  requestId: string,
): Promise<MarketCancelListingRpcPayload> {
  try {
    return await callRpcRaw<MarketCancelListingRpcPayload>(
      "market_cancel_listing",
      {
        p_user_id: userId,
        p_listing_id: listingId,
        p_idempotency_key: idempotencyKey,
        p_reason: "user_cancelled",
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          listingId,
          idempotencyKey,
          source: "inventory.cancel_sell",
        },
      },
    );
  } catch (error) {
    throw mapMarketCancelListingRpcError(error);
  }
}

function normalizeMarketCancelListingPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    throw invalidMarketCancelListingResult();
  }

  const parsed = MarketCancelListingResponseSchema.safeParse({
    listing_id: payload.listing_id,
    status: payload.status,
    released_item_instance_ids:
      payload.released_item_instance_ids ?? payload.released_item_ids,
    cancelled_at: payload.cancelled_at,
  });

  if (!parsed.success) {
    throw invalidMarketCancelListingResult(parsed.error.issues);
  }

  return parsed.data;
}

function invalidMarketCancelListingResult(details?: unknown): ApiError {
  return new ApiError(
    500,
    "INVENTORY_CANCEL_SELL_RESULT_INVALID",
    "藏品下架结果格式无效。",
    {
      details,
      expose: false,
    },
  );
}

function mapInventoryDetailRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("查询藏品挂单状态失败，请稍后重试。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("item not found")) {
    return new ApiError(404, "ITEM_NOT_FOUND", "藏品不存在。");
  }

  if (message.includes("not item owner")) {
    return new ApiError(403, "ITEM_NOT_OWNER", "不能操作不属于你的藏品。");
  }

  return new ApiError(
    500,
    "INVENTORY_DETAIL_RPC_FAILED",
    "查询藏品挂单状态失败。",
    {
      cause: error,
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

  return new ApiError(500, "INVENTORY_CANCEL_SELL_RPC_FAILED", "下架失败。", {
    cause: error,
    expose: false,
  });
}
