import {
  InventoryEvolveItemBodySchema,
  type InventoryEvolveItemBody,
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
} from "./_shared.js";

type InventoryEvolveRpcPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      InventoryEvolveItemBodySchema,
      normalizeInventoryEvolveInput(body, getIdempotencyKey(req)),
    );
    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "inventory.evolve",
      idempotencyKey: input.idempotency_key,
      metadata: {
        itemIds: input.source_item_instance_ids,
        itemCount: input.source_item_instance_ids.length,
      },
    });

    const payload = await callInventoryEvolveRpc(
      input,
      session.userId,
      ctx.requestId,
    );

    return normalizeInventoryEvolvePayload(
      payload,
      input.source_item_instance_ids,
    );
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "inventory.evolve",
    },
  },
);

export function normalizeInventoryEvolveInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotency_key: headerIdempotencyKey,
    };
  }

  return {
    source_item_instance_ids:
      body.source_item_instance_ids ?? body.sourceItemInstanceIds,
    target_form_id: body.target_form_id ?? body.targetFormId,
    expected_kcoin_cost: body.expected_kcoin_cost ?? body.expectedKcoinCost,
    expected_success_rate_bps:
      body.expected_success_rate_bps ?? body.expectedSuccessRateBps,
    expected_return_item_instance_id:
      body.expected_return_item_instance_id ??
      body.expectedReturnItemInstanceId,
    idempotency_key:
      headerIdempotencyKey ?? body.idempotency_key ?? body.idempotencyKey,
    ...(body.user_id !== undefined ? { user_id: body.user_id } : {}),
    ...(body.owner_user_id !== undefined
      ? { owner_user_id: body.owner_user_id }
      : {}),
  };
}

async function callInventoryEvolveRpc(
  input: InventoryEvolveItemBody,
  userId: string,
  requestId: string,
): Promise<InventoryEvolveRpcPayload> {
  try {
    return await callRpcRaw<InventoryEvolveRpcPayload>(
      "inventory_evolve_item",
      {
        p_user_id: userId,
        p_item_instance_ids: input.source_item_instance_ids,
        p_idempotency_key: input.idempotency_key,
        p_target_form_id: input.target_form_id ?? null,
        p_expected_kcoin_cost: input.expected_kcoin_cost ?? null,
        p_expected_success_rate_bps: input.expected_success_rate_bps ?? null,
        p_expected_return_item_instance_id:
          input.expected_return_item_instance_id ?? null,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          itemCount: input.source_item_instance_ids.length,
          idempotencyKey: input.idempotency_key,
          targetFormId: input.target_form_id,
          expectedKcoinCost: input.expected_kcoin_cost,
          expectedSuccessRateBps: input.expected_success_rate_bps,
          expectedReturnItemInstanceId: input.expected_return_item_instance_id,
        },
      },
    );
  } catch (error) {
    throw mapInventoryEvolveRpcError(error);
  }
}

export function normalizeInventoryEvolvePayload(
  payload: unknown,
  sourceItemInstanceIds: string[],
) {
  const result = assertRecordPayload(
    payload,
    "INVENTORY_EVOLVE_RESULT_INVALID",
    "合成结果格式无效。",
  );
  const success =
    readBoolean(result.success) ??
    (readString(result.result) === "success" ? true : null);
  const mainItemInstanceId =
    readString(result.main_item_instance_id) ??
    readString(result.returned_item_instance_id);

  if (success === null) {
    throw invalidInventoryResult(
      "INVENTORY_EVOLVE_RESULT_INVALID",
      "合成结果缺少状态字段。",
      { success: result.success, result: result.result },
    );
  }

  const returnedItemInstanceId = success ? null : mainItemInstanceId;
  const kcoinBalanceBefore =
    readNumber(result.kcoin_balance_before) ??
    readNumber(result.balance_before) ??
    readNumber(result.available_before);
  const kcoinBalanceAfter =
    readNumber(result.kcoin_balance_after) ??
    readNumber(result.balance_after) ??
    readNumber(result.available_after);

  return {
    result: success ? "success" : "failed",
    success,
    attempt_id: readString(result.attempt_id),
    source_item_instance_ids: sourceItemInstanceIds,
    consumed_item_instance_ids: success
      ? sourceItemInstanceIds
      : sourceItemInstanceIds.filter((id) => id !== returnedItemInstanceId),
    returned_item_instance_id: returnedItemInstanceId,
    created_item_instance_id: success
      ? (readString(result.result_item_instance_id) ??
        readString(result.created_item_instance_id))
      : null,
    main_item_instance_id: mainItemInstanceId,
    consumed_kcoin:
      readNumber(result.consumed_kcoin) ?? readNumber(result.cost_kcoin) ?? 0,
    cost_kcoin:
      readNumber(result.cost_kcoin) ?? readNumber(result.consumed_kcoin) ?? 0,
    kcoin_balance_before: kcoinBalanceBefore,
    kcoin_balance_after: kcoinBalanceAfter,
    balance_change:
      readNumber(result.balance_delta) ??
      (kcoinBalanceBefore !== null && kcoinBalanceAfter !== null
        ? kcoinBalanceAfter - kcoinBalanceBefore
        : null),
    ledger_id: readString(result.ledger_id),
    success_rate_bps: readNumber(result.success_rate_bps) ?? 0,
    random_roll_bps: readNumber(result.random_roll_bps),
    evolved_at: readString(result.evolved_at),
    idempotent: readBoolean(result.idempotent) ?? false,
  };
}

function mapInventoryEvolveRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("合成失败，请稍后重试。", {
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
      "幂等键已被其他合成请求使用。",
    );
  }

  if (message.includes("exactly three item ids are required")) {
    return new ApiError(
      400,
      "EVOLVE_ITEM_COUNT_INVALID",
      "合成必须选择 3 个藏品。",
    );
  }

  if (message.includes("duplicate item ids are not allowed")) {
    return new ApiError(400, "EVOLVE_DUPLICATE_ITEM_IDS", "合成材料不能重复。");
  }

  if (message.includes("some items do not exist")) {
    return new ApiError(404, "ITEM_NOT_FOUND", "部分藏品不存在。");
  }

  if (message.includes("some items are not evolvable or not available")) {
    return new ApiError(409, "ITEM_NOT_EVOLVABLE", "部分藏品当前不可合成。");
  }

  if (
    message.includes("evolution requires three copies") ||
    message.includes("source form is required")
  ) {
    return new ApiError(
      409,
      "EVOLVE_REQUIRES_SAME_TEMPLATE_AND_FORM",
      "合成需要 3 个同模板、同形态藏品。",
    );
  }

  if (message.includes("evolution rule not found")) {
    return new ApiError(500, "EVOLVE_RULE_NOT_FOUND", "合成配置缺失。", {
      cause: error,
      expose: false,
    });
  }

  if (message.includes("insufficient balance")) {
    return new ApiError(409, "INSUFFICIENT_KCOIN", "KCOIN 余额不足。");
  }

  if (message.includes("evolution preview mismatch")) {
    return new ApiError(
      409,
      "INVENTORY_PREVIEW_STALE",
      "藏品合成配置已变化，请刷新后重试。",
    );
  }

  return new ApiError(500, "INVENTORY_EVOLVE_RPC_FAILED", "合成失败。", {
    cause: error,
    expose: false,
  });
}
