import {
  BoxDrawResultQuerySchema,
  type BoxDrawResultQuery,
} from "../../packages/validation/src/box.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type RawDrawResultPayload = {
  draw_order_id?: unknown;
  status?: unknown;
  draw_count?: unknown;
  quantity?: unknown;
  total_price_stars?: unknown;
  open_reward_kcoin?: unknown;
  returned_kcoin?: unknown;
  kcoin_reward?: unknown;
  invoice_payload?: unknown;
  paid_at?: unknown;
  opened_at?: unknown;
  completed_at?: unknown;
  box?: unknown;
  payment?: unknown;
  balances?: unknown;
  results?: unknown;
  server_time?: unknown;
};

type RawDrawResultItem = {
  draw_index?: unknown;
  was_pity?: unknown;
  item_instance_id?: unknown;
  template_id?: unknown;
  template_slug?: unknown;
  display_name?: unknown;
  subtitle?: unknown;
  description?: unknown;
  rarity_code?: unknown;
  rarity_display_name?: unknown;
  type_code?: unknown;
  form_id?: unknown;
  form_index?: unknown;
  form_name?: unknown;
  serial_no?: unknown;
  level?: unknown;
  power?: unknown;
  image_url?: unknown;
  thumbnail_url?: unknown;
  avatar_url?: unknown;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(
      BoxDrawResultQuerySchema,
      normalizeResultQuery(req.query),
    );
    const result = await getDrawResult(session.userId, query, ctx.requestId);

    return toDrawResultResponse(result, query.includeItems);
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "boxes.result",
    },
  },
);

function normalizeResultQuery(
  query: Record<string, unknown>,
): Record<string, unknown> {
  return {
    orderId: query.orderId ?? query.order_id,
    includeItems: query.includeItems ?? query.include_items,
  };
}

async function getDrawResult(
  userId: string,
  query: BoxDrawResultQuery,
  requestId: string,
): Promise<RawDrawResultPayload> {
  try {
    return await callRpcRaw<RawDrawResultPayload>(
      "gacha_get_draw_result",
      {
        p_user_id: userId,
        p_draw_order_id: query.orderId,
        p_invoice_payload: null,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          orderId: query.orderId,
        },
      },
    );
  } catch (error) {
    throw mapDrawResultRpcError(error);
  }
}

export function toDrawResultResponse(
  payload: RawDrawResultPayload,
  includeItems: boolean,
) {
  const rawOrderStatus = stringOrNull(payload.status) ?? "unknown";
  const isCompleted = isCompletedOrderStatus(rawOrderStatus);
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const quantity = numberOrZero(payload.draw_count ?? payload.quantity);
  const explicitKcoinReturn = numberOrZero(
    payload.returned_kcoin ?? payload.kcoin_reward,
  );
  const perDrawKcoinReturn = numberOrZero(payload.open_reward_kcoin);
  const returnedKcoin =
    explicitKcoinReturn > 0
      ? explicitKcoinReturn
      : perDrawKcoinReturn * Math.max(quantity, 1);

  return {
    order_id: stringOrNull(payload.draw_order_id),
    status: isCompleted ? "completed" : "pending",
    order_status: rawOrderStatus,
    quantity,
    paid_stars: numberOrZero(payload.total_price_stars),
    returned_kcoin: returnedKcoin,
    invoice_payload: stringOrNull(payload.invoice_payload),
    paid_at: stringOrNull(payload.paid_at),
    completed_at:
      stringOrNull(payload.completed_at) ?? stringOrNull(payload.opened_at),
    box: isRecord(payload.box) ? payload.box : null,
    payment: isRecord(payload.payment) ? payload.payment : null,
    balances: isRecord(payload.balances) ? payload.balances : null,
    results:
      includeItems && isCompleted ? rawResults.map(toDrawResultItem) : [],
    server_time: stringOrNull(payload.server_time) ?? new Date().toISOString(),
  };
}

function isCompletedOrderStatus(value: string): boolean {
  return value === "completed" || value === "opened";
}

function toDrawResultItem(value: unknown) {
  const item = isRecord(value) ? (value as RawDrawResultItem) : {};
  const wasPity = Boolean(item.was_pity);

  return {
    draw_index: numberOrZero(item.draw_index),
    reward_source: wasPity ? "pity" : "random",
    is_pity_hit: wasPity,
    item_instance_id: stringOrNull(item.item_instance_id),
    template_id: stringOrNull(item.template_id),
    template_slug: stringOrNull(item.template_slug),
    name: stringOrNull(item.display_name) ?? "Unknown reward",
    subtitle: stringOrNull(item.subtitle),
    description: stringOrNull(item.description),
    serial_number: nullableNumber(item.serial_no),
    rarity: stringOrNull(item.rarity_code),
    rarity_label: stringOrNull(item.rarity_display_name),
    item_type: stringOrNull(item.type_code),
    form_id: stringOrNull(item.form_id),
    form_index: nullableNumber(item.form_index),
    form_name: stringOrNull(item.form_name),
    image_url:
      stringOrNull(item.image_url) ??
      stringOrNull(item.thumbnail_url) ??
      stringOrNull(item.avatar_url),
    thumbnail_url: stringOrNull(item.thumbnail_url),
    level: numberOrZero(item.level),
    power: numberOrZero(item.power),
  };
}

function mapDrawResultRpcError(error: unknown): ApiError {
  if (!(error instanceof RpcError)) {
    return error instanceof ApiError
      ? error
      : ApiError.internal("查询开盒结果失败。", {
          cause: getErrorMessage(error),
        });
  }

  const message = error.message.toLowerCase();

  if (message.includes("draw order not found")) {
    return new ApiError(404, "ORDER_NOT_FOUND", "订单不存在或不属于当前用户。");
  }

  if (
    message.includes("order already processed") ||
    message.includes("order already completed") ||
    message.includes("draw order already processed")
  ) {
    return new ApiError(409, "ORDER_ALREADY_PROCESSED", "订单已处理。");
  }

  if (message.includes("draw_order_id or invoice_payload is required")) {
    return ApiError.badRequest("缺少开盒订单 ID。");
  }

  return new ApiError(500, "GACHA_DRAW_RESULT_FAILED", "查询开盒结果失败。", {
    expose: false,
    cause: error,
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return numberOrZero(value);
}

function numberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return Math.trunc(Number(value));
  }

  return 0;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
