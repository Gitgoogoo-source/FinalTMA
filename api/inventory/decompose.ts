import {
  InventoryDecomposeItemBodySchema,
  type InventoryDecomposeItemBody,
} from "../../packages/validation/src/inventory.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
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
  assertRecordPayload,
  getErrorMessage,
  getRpcErrorText,
  invalidInventoryResult,
  isRecord,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
} from "./_shared.js";

type InventoryDecomposeRpcPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      InventoryDecomposeItemBodySchema,
      normalizeInventoryDecomposeInput(body, getIdempotencyKey(req)),
    );
    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "inventory.decompose",
      idempotencyKey: input.idempotency_key,
      metadata: {
        itemIds: input.item_instance_ids,
        itemCount: input.item_instance_ids.length,
      },
    });

    const payload = await callInventoryDecomposeRpc(
      input,
      session.userId,
      ctx.requestId,
    );

    return normalizeInventoryDecomposePayload(payload, input.item_instance_ids);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "inventory.decompose",
    },
  },
);

export function normalizeInventoryDecomposeInput(
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
    expected_fgems_reward:
      body.expected_fgems_reward ?? body.expectedFgemsReward,
    idempotency_key:
      headerIdempotencyKey ?? body.idempotency_key ?? body.idempotencyKey,
    ...(body.user_id !== undefined ? { user_id: body.user_id } : {}),
    ...(body.owner_user_id !== undefined
      ? { owner_user_id: body.owner_user_id }
      : {}),
  };
}

async function callInventoryDecomposeRpc(
  input: InventoryDecomposeItemBody,
  userId: string,
  requestId: string,
): Promise<InventoryDecomposeRpcPayload> {
  try {
    return await callRpcRaw<InventoryDecomposeRpcPayload>(
      "inventory_decompose_items",
      {
        p_user_id: userId,
        p_item_instance_ids: input.item_instance_ids,
        p_idempotency_key: input.idempotency_key,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          itemCount: input.item_instance_ids.length,
          idempotencyKey: input.idempotency_key,
        },
      },
    );
  } catch (error) {
    throw mapInventoryDecomposeRpcError(error);
  }
}

export function normalizeInventoryDecomposePayload(
  payload: unknown,
  fallbackItemInstanceIds: string[],
) {
  const result = assertRecordPayload(
    payload,
    "INVENTORY_DECOMPOSE_RESULT_INVALID",
    "分解结果格式无效。",
  );
  const decomposedItemInstanceIds = readStringArray(result.item_instance_ids);
  const gainedFgems =
    readNumber(result.total_reward_fgems) ??
    readNumber(result.reward_fgems) ??
    readNumber(result.gained_fgems);

  if (gainedFgems === null) {
    throw invalidInventoryResult(
      "INVENTORY_DECOMPOSE_RESULT_INVALID",
      "分解结果缺少奖励字段。",
      {
        total_reward_fgems: result.total_reward_fgems,
        reward_fgems: result.reward_fgems,
      },
    );
  }
  const fgemsBalanceBefore =
    readNumber(result.fgems_balance_before) ??
    readNumber(result.balance_before) ??
    readNumber(result.available_before);
  const fgemsBalanceAfter =
    readNumber(result.fgems_balance_after) ??
    readNumber(result.balance_after) ??
    readNumber(result.available_after);

  return {
    decomposed_item_instance_ids:
      decomposedItemInstanceIds.length > 0
        ? decomposedItemInstanceIds
        : fallbackItemInstanceIds,
    gained_fgems: gainedFgems,
    total_reward_fgems: gainedFgems,
    fgems_balance_before: fgemsBalanceBefore,
    fgems_balance_after: fgemsBalanceAfter,
    balance_change:
      readNumber(result.balance_delta) ??
      (fgemsBalanceBefore !== null && fgemsBalanceAfter !== null
        ? fgemsBalanceAfter - fgemsBalanceBefore
        : null),
    ledger_id: readString(result.ledger_id),
    items: Array.isArray(result.items) ? result.items : [],
    decomposed_at: readString(result.decomposed_at),
    idempotent: readBoolean(result.idempotent) ?? false,
  };
}

function mapInventoryDecomposeRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("分解失败，请稍后重试。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("idempotency key is required")) {
    return new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键。");
  }

  if (message.includes("idempotency conflict")) {
    return new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "幂等键已被其他分解请求使用。",
    );
  }

  if (message.includes("one to one hundred item ids are required")) {
    return new ApiError(
      400,
      "DECOMPOSE_ITEM_COUNT_INVALID",
      "分解数量必须在 1 到 100 之间。",
    );
  }

  if (message.includes("duplicate item ids are not allowed")) {
    return new ApiError(
      400,
      "DECOMPOSE_DUPLICATE_ITEM_IDS",
      "分解藏品不能重复。",
    );
  }

  if (message.includes("item not found")) {
    return new ApiError(404, "ITEM_NOT_FOUND", "藏品不存在。");
  }

  if (
    message.includes("item is not available") ||
    message.includes("item is locked") ||
    message.includes("item is minting")
  ) {
    return new ApiError(409, "ITEM_NOT_AVAILABLE", "藏品当前不可分解。");
  }

  if (message.includes("item is not decomposable")) {
    return new ApiError(409, "ITEM_NOT_DECOMPOSABLE", "该藏品不可分解。");
  }

  if (message.includes("only duplicate collectibles can be decomposed")) {
    return new ApiError(
      409,
      "DECOMPOSE_REQUIRES_DUPLICATE",
      "只能分解重复藏品。",
    );
  }

  if (message.includes("decompose rule not found")) {
    return new ApiError(500, "DECOMPOSE_RULE_NOT_FOUND", "分解配置缺失。", {
      cause: error,
      expose: false,
    });
  }

  return new ApiError(500, "INVENTORY_DECOMPOSE_RPC_FAILED", "分解失败。", {
    cause: error,
    expose: false,
  });
}
