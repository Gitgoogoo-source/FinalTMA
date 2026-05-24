import {
  InventoryActivityQuerySchema,
  type InventoryActivityQuery,
} from "../../packages/validation/src/inventory.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";
import {
  assertRecordPayload,
  getErrorMessage,
  getRpcErrorText,
  invalidInventoryResult,
  isRecord,
  readString,
} from "./_shared.js";

type InventoryActivityRpcPayload = Record<string, unknown>;

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(InventoryActivityQuerySchema, req.query);

    const payload = await callInventoryActivityRpc(
      session.userId,
      query,
      ctx.requestId,
    );

    return normalizeInventoryActivityPayload(payload);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "inventory.activity",
    },
  },
);

async function callInventoryActivityRpc(
  userId: string,
  query: InventoryActivityQuery,
  requestId: string,
): Promise<InventoryActivityRpcPayload> {
  try {
    return await callRpcRaw<InventoryActivityRpcPayload>(
      "inventory_list_activity",
      {
        p_user_id: userId,
        p_item_instance_id: query.item_instance_id ?? null,
        p_template_id: query.template_id ?? null,
        p_activity_types: query.activity_types ?? null,
        p_from_at: query.from_at ?? null,
        p_to_at: query.to_at ?? null,
        p_limit: query.limit,
        p_cursor: query.cursor ?? null,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          itemInstanceId: query.item_instance_id,
          templateId: query.template_id,
          activityTypes: query.activity_types,
          limit: query.limit,
        },
      },
    );
  } catch (error) {
    throw mapInventoryActivityRpcError(error);
  }
}

export function normalizeInventoryActivityPayload(payload: unknown) {
  const result = assertRecordPayload(
    payload,
    "INVENTORY_ACTIVITY_RESULT_INVALID",
    "库存记录结果格式无效。",
  );

  if (result.items !== undefined && !Array.isArray(result.items)) {
    throw invalidInventoryResult(
      "INVENTORY_ACTIVITY_RESULT_INVALID",
      "库存记录 items 格式无效。",
      { items: result.items },
    );
  }

  return {
    items: Array.isArray(result.items)
      ? result.items.map(normalizeInventoryActivityItem)
      : [],
    next_cursor: readString(result.next_cursor),
  };
}

function normalizeInventoryActivityItem(value: unknown) {
  const item = isRecord(value) ? value : {};
  const activityId = readString(item.activity_id);
  const activityType = readString(item.activity_type);

  if (!activityId || !activityType) {
    throw invalidInventoryResult(
      "INVENTORY_ACTIVITY_RESULT_INVALID",
      "库存记录缺少必要字段。",
      { activity_id: item.activity_id, activity_type: item.activity_type },
    );
  }

  return {
    activity_id: activityId,
    activity_type: activityType,
    item_instance_id: readString(item.item_instance_id),
    template_id: readString(item.template_id),
    source_type: readString(item.source_type) ?? "unknown",
    source_id: readString(item.source_id),
    title: readString(item.title) ?? "Inventory updated",
    description: readString(item.description),
    created_at: readString(item.created_at),
  };
}

function mapInventoryActivityRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("查询库存记录失败。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("user_id is required")) {
    return ApiError.unauthorized("缺少用户会话。");
  }

  if (message.includes("from_at cannot be later than to_at")) {
    return ApiError.badRequest("from_at 不能晚于 to_at。");
  }

  if (message.includes("invalid cursor")) {
    return ApiError.badRequest("库存记录分页 cursor 无效。");
  }

  return new ApiError(
    500,
    "INVENTORY_ACTIVITY_RPC_FAILED",
    "查询库存记录失败。",
    {
      cause: error,
      expose: false,
    },
  );
}
