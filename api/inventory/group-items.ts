import {
  InventoryGroupItemsQuerySchema,
  type InventoryGroupItemsQuery,
} from "../../packages/validation/src/inventory.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";
import { buildInventoryListResponse } from "./list.js";

type InventoryGroupItemsRpcPayload = {
  items?: unknown;
  total?: unknown;
  limit?: unknown;
  offset?: unknown;
  statuses?: unknown;
  server_time?: unknown;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(InventoryGroupItemsQuerySchema, req.query);
    const offset = parseOffsetCursor(query.cursor);
    const statuses = resolveStatuses(query);
    const payload = await callInventoryGroupItemsRpc(
      session.userId,
      query,
      statuses,
      offset,
      ctx.requestId,
    );

    return buildInventoryListResponse(payload, offset, query.limit);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "inventory.list",
    },
  },
);

async function callInventoryGroupItemsRpc(
  userId: string,
  query: InventoryGroupItemsQuery,
  statuses: string[],
  offset: number,
  requestId: string,
): Promise<InventoryGroupItemsRpcPayload> {
  try {
    return await callRpcRaw<InventoryGroupItemsRpcPayload>(
      "inventory_list_collection_group_items",
      {
        p_user_id: userId,
        p_template_id: query.template_id,
        p_form_id: query.form_id ?? null,
        p_statuses: statuses,
        p_limit: query.limit,
        p_offset: offset,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          templateId: query.template_id,
          formId: query.form_id ?? null,
          statuses,
          limit: query.limit,
          offset,
        },
      },
    );
  } catch (error) {
    throw mapInventoryGroupItemsRpcError(error);
  }
}

function resolveStatuses(query: InventoryGroupItemsQuery): string[] {
  if (query.statuses && query.statuses.length > 0) {
    return query.statuses;
  }

  if (query.include_locked) {
    return ["available", "locked", "listed", "minting", "minted"];
  }

  return ["available", "listed", "minting", "minted"];
}

function parseOffsetCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }

  const parsed = Number.parseInt(cursor, 10);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    String(parsed) !== cursor.trim()
  ) {
    throw ApiError.badRequest("库存分页 cursor 无效。");
  }

  return parsed;
}

function mapInventoryGroupItemsRpcError(error: unknown): ApiError {
  if (!(error instanceof RpcError)) {
    return error instanceof ApiError
      ? error
      : ApiError.internal("查询藏品组失败。", {
          cause: getErrorMessage(error),
        });
  }

  const message = error.message.toLowerCase();

  if (message.includes("user_id is required")) {
    return ApiError.unauthorized("缺少用户会话。");
  }

  if (message.includes("template_id is required")) {
    return ApiError.badRequest("缺少藏品模板。");
  }

  return new ApiError(500, "INVENTORY_GROUP_ITEMS_FAILED", "查询藏品组失败。", {
    expose: false,
    cause: error,
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
