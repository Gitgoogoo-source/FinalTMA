import {
  CreateBoxOpenOrderRequestSchema,
  type CreateBoxOpenOrderRequest,
} from "../../packages/validation/src/box.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type CreateOrderRpcResult = {
  draw_order_id?: unknown;
  star_order_id?: unknown;
  invoice_payload?: unknown;
  xtr_amount?: unknown;
  quantity?: unknown;
  discount_bps?: unknown;
  status?: unknown;
  idempotent?: unknown;
};

type DevPaidRpcResult = {
  draw_order_id?: unknown;
  status?: unknown;
  results?: unknown;
  idempotent?: unknown;
  payment_mode?: unknown;
  payment_status?: unknown;
};

type CreateOpenOrderResponse = {
  order_id: string;
  star_order_id: string | null;
  invoice_payload: string | null;
  xtr_amount: number;
  draw_count: 1 | 10;
  order_status: string;
  payment_status: string;
  dev_payment_processed: boolean;
  idempotent: boolean;
  result_ready: boolean;
};

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 32 * 1024,
    });
    const input = validate(
      CreateBoxOpenOrderRequestSchema,
      normalizeCreateOpenOrderInput(body, getIdempotencyKey(req)),
    );

    const order = await callGachaCreateOrder(
      input,
      session.userId,
      ctx.requestId,
    );
    const orderId = getRequiredString(order, "draw_order_id");
    let devPaidResult: DevPaidRpcResult | null = null;

    if (isDevGachaPaymentModeEnabled(process.env.DEV_GACHA_PAYMENT_MODE)) {
      devPaidResult = await callDevPaidOrder(
        orderId,
        session.userId,
        ctx.requestId,
      );
    }

    return buildCreateOpenOrderResponse(order, input, devPaidResult);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "boxes.create_open_order",
    },
  },
);

export function normalizeCreateOpenOrderInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {};
  }

  const drawCount = body.draw_count ?? body.drawCount ?? body.quantity;
  const openType =
    body.openType ?? body.open_type ?? openTypeFromDrawCount(drawCount);

  return {
    boxId: body.boxId ?? body.box_id,
    openType,
    quantity: drawCount,
    paymentProvider: body.paymentProvider ?? body.payment_provider,
    expectedPriceStars: body.expectedPriceStars ?? body.expected_price_stars,
    expectedPoolVersionId:
      body.expectedPoolVersionId ?? body.expected_pool_version_id,
    idempotencyKey:
      body.idempotencyKey ?? body.idempotency_key ?? headerIdempotencyKey,
    clientContext: body.clientContext ?? body.client_context,
  };
}

export function isDevGachaPaymentModeEnabled(
  value: string | undefined,
): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

export function buildCreateOpenOrderResponse(
  order: CreateOrderRpcResult,
  input: CreateBoxOpenOrderRequest,
  devPaidResult: DevPaidRpcResult | null,
): CreateOpenOrderResponse {
  const orderStatus =
    stringOrNull(devPaidResult?.status) ??
    stringOrNull(order.status) ??
    "invoice_created";
  const paymentStatus =
    stringOrNull(devPaidResult?.payment_status) ??
    (devPaidResult ? "dev_paid" : "pending_payment");

  return {
    order_id: getRequiredString(order, "draw_order_id"),
    star_order_id: stringOrNull(order.star_order_id),
    invoice_payload: stringOrNull(order.invoice_payload),
    xtr_amount: numberOrZero(order.xtr_amount),
    draw_count: input.quantity,
    order_status: orderStatus,
    payment_status: paymentStatus,
    dev_payment_processed: devPaidResult !== null,
    idempotent: Boolean(order.idempotent) || Boolean(devPaidResult?.idempotent),
    result_ready: orderStatus === "opened",
  };
}

async function callGachaCreateOrder(
  input: CreateBoxOpenOrderRequest,
  userId: string,
  requestId: string,
): Promise<CreateOrderRpcResult> {
  try {
    return await callRpcRaw<CreateOrderRpcResult>(
      "gacha_create_order",
      {
        p_user_id: userId,
        p_box_id: input.boxId,
        p_quantity: input.quantity,
        p_idempotency_key: input.idempotencyKey,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          boxId: input.boxId,
          quantity: input.quantity,
          idempotencyKey: input.idempotencyKey,
        },
      },
    );
  } catch (error) {
    throw mapGachaRpcError(error);
  }
}

async function callDevPaidOrder(
  orderId: string,
  userId: string,
  requestId: string,
): Promise<DevPaidRpcResult> {
  try {
    return await callRpcRaw<DevPaidRpcResult>(
      "gacha_process_dev_paid_order",
      {
        p_order_id: orderId,
        p_user_id: userId,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          orderId,
          paymentMode: "DEV_GACHA_PAYMENT_MODE",
        },
      },
    );
  } catch (error) {
    throw mapGachaRpcError(error);
  }
}

function mapGachaRpcError(error: unknown): ApiError {
  if (!(error instanceof RpcError)) {
    return error instanceof ApiError
      ? error
      : ApiError.internal("创建开盒订单失败。", {
          cause: getErrorMessage(error),
        });
  }

  const message = error.message.toLowerCase();

  if (message.includes("blind box not found")) {
    return ApiError.notFound("盲盒不存在。");
  }

  if (
    message.includes("not active") ||
    message.includes("has not started") ||
    message.includes("has ended")
  ) {
    return new ApiError(400, "BOX_NOT_ACTIVE", "当前盲盒不可开启。");
  }

  if (message.includes("stock is insufficient")) {
    return new ApiError(409, "BOX_STOCK_NOT_ENOUGH", "盲盒库存不足。");
  }

  if (message.includes("active drop pool not found")) {
    return new ApiError(409, "BOX_POOL_NOT_ACTIVE", "当前盲盒没有可用奖励池。");
  }

  if (message.includes("quantity must be 1 or 10")) {
    return new ApiError(400, "DRAW_COUNT_INVALID", "开盒次数只能是 1 或 10。");
  }

  if (message.includes("idempotency_key is required")) {
    return ApiError.badRequest("缺少幂等键。");
  }

  if (message.includes("idempotency key conflict")) {
    return new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "幂等键已被其他开盒请求使用。",
    );
  }

  if (message.includes("draw order not found")) {
    return ApiError.notFound("开盒订单不存在。");
  }

  return new ApiError(500, "GACHA_CREATE_ORDER_FAILED", "创建开盒订单失败。", {
    expose: false,
    cause: error,
  });
}

function openTypeFromDrawCount(value: unknown): "single" | "ten" | undefined {
  const drawCount = Number(value);

  if (drawCount === 1) {
    return "single";
  }

  if (drawCount === 10) {
    return "ten";
  }

  return undefined;
}

function getRequiredString(
  value: CreateOrderRpcResult,
  key: keyof CreateOrderRpcResult,
): string {
  const fieldValue = value[key];

  if (typeof fieldValue === "string" && fieldValue.trim().length > 0) {
    return fieldValue;
  }

  throw new ApiError(
    500,
    "RPC_RESULT_INVALID",
    `RPC 返回缺少字段 ${String(key)}。`,
    {
      expose: false,
    },
  );
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
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
