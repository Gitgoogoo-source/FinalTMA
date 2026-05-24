import {
  InventoryUpgradeItemBodySchema,
  type InventoryUpgradeItemBody,
} from "../../packages/validation/src/inventory.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
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
} from "./_shared.js";

type InventoryUpgradeRpcPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      InventoryUpgradeItemBodySchema,
      normalizeInventoryUpgradeInput(body, getIdempotencyKey(req)),
    );

    const payload = await callInventoryUpgradeRpc(
      input,
      session.userId,
      ctx.requestId,
    );

    return normalizeInventoryUpgradePayload(payload);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "inventory.upgrade",
    },
  },
);

export function normalizeInventoryUpgradeInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotency_key: headerIdempotencyKey,
    };
  }

  return {
    item_instance_id: body.item_instance_id ?? body.itemInstanceId,
    target_level: body.target_level ?? body.targetLevel,
    expected_fgems_cost: body.expected_fgems_cost ?? body.expectedFgemsCost,
    expected_item_version:
      body.expected_item_version ?? body.expectedItemVersion,
    idempotency_key:
      headerIdempotencyKey ?? body.idempotency_key ?? body.idempotencyKey,
    ...(body.user_id !== undefined ? { user_id: body.user_id } : {}),
    ...(body.owner_user_id !== undefined
      ? { owner_user_id: body.owner_user_id }
      : {}),
  };
}

async function callInventoryUpgradeRpc(
  input: InventoryUpgradeItemBody,
  userId: string,
  requestId: string,
): Promise<InventoryUpgradeRpcPayload> {
  try {
    return await callRpcRaw<InventoryUpgradeRpcPayload>(
      "inventory_upgrade_item",
      {
        p_user_id: userId,
        p_item_instance_id: input.item_instance_id,
        p_idempotency_key: input.idempotency_key,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          itemInstanceId: input.item_instance_id,
          idempotencyKey: input.idempotency_key,
        },
      },
    );
  } catch (error) {
    throw mapInventoryUpgradeRpcError(error);
  }
}

export function normalizeInventoryUpgradePayload(payload: unknown) {
  const result = assertRecordPayload(
    payload,
    "INVENTORY_UPGRADE_RESULT_INVALID",
    "升级结果格式无效。",
  );
  const itemInstanceId = readString(result.item_instance_id);
  const toLevel = readNumber(result.to_level);
  const toPower = readNumber(result.to_power);

  if (!itemInstanceId || toLevel === null || toPower === null) {
    throw invalidInventoryResult(
      "INVENTORY_UPGRADE_RESULT_INVALID",
      "升级结果缺少必要字段。",
      {
        item_instance_id: result.item_instance_id,
        to_level: result.to_level,
        to_power: result.to_power,
      },
    );
  }

  const consumedFgems =
    readNumber(result.consumed_fgems) ?? readNumber(result.cost_fgems) ?? 0;
  const fgemsBalanceBefore =
    readNumber(result.fgems_balance_before) ??
    readNumber(result.balance_before) ??
    readNumber(result.available_before);
  const fgemsBalanceAfter =
    readNumber(result.fgems_balance_after) ??
    readNumber(result.balance_after) ??
    readNumber(result.available_after);

  return {
    item_instance_id: itemInstanceId,
    from_level: readNumber(result.from_level),
    to_level: toLevel,
    from_power: readNumber(result.from_power),
    to_power: toPower,
    consumed_fgems: consumedFgems,
    cost_fgems: consumedFgems,
    fgems_balance_before: fgemsBalanceBefore,
    fgems_balance_after: fgemsBalanceAfter,
    balance_change:
      readNumber(result.balance_delta) ??
      (fgemsBalanceBefore !== null && fgemsBalanceAfter !== null
        ? fgemsBalanceAfter - fgemsBalanceBefore
        : null),
    ledger_id: readString(result.ledger_id),
    upgraded_at: readString(result.upgraded_at),
    idempotent: readBoolean(result.idempotent) ?? false,
  };
}

function mapInventoryUpgradeRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("升级失败，请稍后重试。", {
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
      "幂等键已被其他升级请求使用。",
    );
  }

  if (message.includes("item not found")) {
    return new ApiError(404, "ITEM_NOT_FOUND", "藏品不存在。");
  }

  if (message.includes("not item owner")) {
    return new ApiError(403, "ITEM_NOT_OWNER", "不能升级不属于你的藏品。");
  }

  if (message.includes("item is not available")) {
    return new ApiError(409, "ITEM_NOT_AVAILABLE", "藏品当前不可升级。");
  }

  if (message.includes("item is not upgradeable")) {
    return new ApiError(409, "ITEM_NOT_UPGRADEABLE", "该藏品不可升级。");
  }

  if (message.includes("item already at max level")) {
    return new ApiError(409, "ITEM_MAX_LEVEL", "藏品已达到最高等级。");
  }

  if (message.includes("upgrade rule not found")) {
    return new ApiError(500, "UPGRADE_RULE_NOT_FOUND", "升级配置缺失。", {
      cause: error,
      expose: false,
    });
  }

  if (message.includes("insufficient balance")) {
    return new ApiError(409, "INSUFFICIENT_FGEMS", "FGEMS 余额不足。");
  }

  return new ApiError(500, "INVENTORY_UPGRADE_RPC_FAILED", "升级失败。", {
    cause: error,
    expose: false,
  });
}
