import {
  CreateBoxOpenOrderRequestSchema,
  type CreateBoxOpenOrderRequest,
} from "../../packages/validation/src/box.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import {
  inferPaymentOrderStatusFromDrawOrderStatus,
  normalizePaymentOrderStatus,
} from "../../packages/server/src/payments/paymentEvents.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { recordRiskEventSafely } from "../_shared/riskEvents.js";
import { assertUserRiskAllowed } from "../_shared/riskGuards.js";
import { validate } from "../_shared/validate.js";

type CreateOrderRpcResult = {
  draw_order_id?: unknown;
  star_order_id?: unknown;
  invoice_payload?: unknown;
  xtr_amount?: unknown;
  paid_kcoin?: unknown;
  total_price_kcoin?: unknown;
  draw_count?: unknown;
  quantity?: unknown;
  discount_bps?: unknown;
  status?: unknown;
  payment_status?: unknown;
  expires_at?: unknown;
  pool_version_id?: unknown;
  idempotent?: unknown;
  result_ready?: unknown;
};

type GachaRecentOrderCountRpcResult = {
  count?: unknown;
};

type GachaBoxSlug = "starter_egg" | "premium_egg" | "legendary_egg";

type GachaServerPriceSnapshot = {
  boxSlug: GachaBoxSlug;
  unitPriceKcoin: number;
  discountBps: number;
  totalPriceKcoin: number;
};

type CreateOpenOrderResponse = {
  order_id: string;
  star_order_id: string | null;
  invoice_payload: string | null;
  xtr_amount: number;
  paid_kcoin: number;
  total_price_kcoin: number;
  draw_count: 1 | 10;
  order_status: string;
  payment_status: string;
  payment_order_status: string;
  invoice_link: string | null;
  invoice_open_mode: string | null;
  expires_at: string | null;
  dev_payment_processed: boolean;
  idempotent: boolean;
  result_ready: boolean;
};

const GACHA_BOX_PRICE_ENV_BY_SLUG: Record<GachaBoxSlug, string> = {
  starter_egg: "GACHA_STARTER_EGG_PRICE_STARS",
  premium_egg: "GACHA_PREMIUM_EGG_PRICE_STARS",
  legendary_egg: "GACHA_LEGENDARY_EGG_PRICE_STARS",
};

const GACHA_TEN_DRAW_DISCOUNT_RATE_ENV = "GACHA_TEN_DRAW_DISCOUNT_RATE";
const GACHA_HIGH_FREQUENCY_WINDOW_MS = 5 * 60 * 1000;
const GACHA_HIGH_FREQUENCY_THRESHOLD = 5;

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

    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "box.create_open_order",
      idempotencyKey: input.idempotencyKey,
      metadata: {
        boxSlug: input.boxSlug,
        drawCount: input.quantity,
      },
    });

    const priceSnapshot = readGachaServerPriceSnapshot(input);
    const order = await callGachaCreateOrder(
      input,
      priceSnapshot,
      session.userId,
      ctx.requestId,
    );
    const orderId = getRequiredString(order, "draw_order_id");
    await recordGachaHighFrequencyRiskIfNeeded({
      userId: session.userId,
      orderId,
      boxSlug: input.boxSlug,
      quantity: input.quantity,
      idempotencyKey: input.idempotencyKey,
      requestId: ctx.requestId,
    });

    return buildCreateOpenOrderResponse(order, input);
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
    boxSlug:
      body.boxSlug ??
      body.box_slug ??
      boxSlugFromTier(body.boxTier ?? body.box_tier),
    openType,
    quantity: drawCount,
    paymentProvider: body.paymentProvider ?? body.payment_provider,
    idempotencyKey:
      body.idempotencyKey ?? body.idempotency_key ?? headerIdempotencyKey,
    clientContext: body.clientContext ?? body.client_context,
  };
}

export function buildCreateOpenOrderResponse(
  order: CreateOrderRpcResult,
  input: CreateBoxOpenOrderRequest,
): CreateOpenOrderResponse {
  const orderStatus = stringOrNull(order.status) ?? "completed";
  const paymentStatus =
    normalizePaymentOrderStatus(order.payment_status) ??
    inferPaymentOrderStatusFromDrawOrderStatus(orderStatus) ??
    "fulfilled";
  const paidKcoin =
    numberOrZero(order.paid_kcoin) ||
    numberOrZero(order.total_price_kcoin) ||
    numberOrZero(order.xtr_amount);

  return {
    order_id: getRequiredString(order, "draw_order_id"),
    star_order_id: stringOrNull(order.star_order_id),
    invoice_payload: null,
    xtr_amount: 0,
    paid_kcoin: paidKcoin,
    total_price_kcoin: paidKcoin,
    draw_count: input.quantity,
    order_status: orderStatus,
    payment_status: paymentStatus,
    payment_order_status: paymentStatus,
    invoice_link: null,
    invoice_open_mode: null,
    expires_at: stringOrNull(order.expires_at),
    dev_payment_processed: false,
    idempotent: Boolean(order.idempotent),
    result_ready:
      Boolean(order.result_ready) || isCompletedOrderStatus(orderStatus),
  };
}

async function callGachaCreateOrder(
  input: CreateBoxOpenOrderRequest,
  priceSnapshot: GachaServerPriceSnapshot,
  userId: string,
  requestId: string,
): Promise<CreateOrderRpcResult> {
  try {
    return await callRpcRaw<CreateOrderRpcResult>(
      "gacha_open_with_kcoin_from_server_price",
      {
        p_user_id: userId,
        p_box_slug: input.boxSlug,
        p_quantity: input.quantity,
        p_idempotency_key: input.idempotencyKey,
        p_unit_price_kcoin: priceSnapshot.unitPriceKcoin,
        p_discount_bps: priceSnapshot.discountBps,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          boxSlug: input.boxSlug,
          quantity: input.quantity,
          idempotencyKey: input.idempotencyKey,
          serverUnitPriceKcoin: priceSnapshot.unitPriceKcoin,
          serverDiscountBps: priceSnapshot.discountBps,
          serverTotalPriceKcoin: priceSnapshot.totalPriceKcoin,
        },
      },
    );
  } catch (error) {
    throw mapGachaRpcError(error);
  }
}

async function recordGachaHighFrequencyRiskIfNeeded(input: {
  userId: string;
  orderId: string;
  boxSlug: string;
  quantity: 1 | 10;
  idempotencyKey: string;
  requestId: string;
}): Promise<void> {
  const since = new Date(
    Date.now() - GACHA_HIGH_FREQUENCY_WINDOW_MS,
  ).toISOString();
  let recentOrderCount: number;

  try {
    const result = await callRpcRaw<GachaRecentOrderCountRpcResult>(
      "gacha_count_recent_draw_orders",
      {
        p_user_id: input.userId,
        p_since: since,
      },
      {
        schema: "api" as never,
        context: {
          requestId: input.requestId,
          userId: input.userId,
          orderId: input.orderId,
          boxSlug: input.boxSlug,
        },
      },
    );

    recentOrderCount = numberOrZero(result?.count);
  } catch (error) {
    console.error("[risk-event:gacha-frequency-count-failed]", {
      requestId: input.requestId,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (recentOrderCount < GACHA_HIGH_FREQUENCY_THRESHOLD) {
    return;
  }

  await recordRiskEventSafely({
    userId: input.userId,
    eventType: "gacha_high_frequency",
    sourceType: "gacha_order",
    sourceId: input.orderId,
    detail: {
      request_id: input.requestId,
      action: "boxes.create_open_order",
      box_slug: input.boxSlug,
      draw_count: input.quantity,
      recent_order_count: recentOrderCount,
      window_seconds: Math.trunc(GACHA_HIGH_FREQUENCY_WINDOW_MS / 1000),
      threshold: GACHA_HIGH_FREQUENCY_THRESHOLD,
    },
    idempotencyKey: `risk:gacha_high_frequency:${input.orderId}:${input.idempotencyKey}`,
    context: {
      requestId: input.requestId,
      userId: input.userId,
      orderId: input.orderId,
      idempotencyKey: input.idempotencyKey,
    },
  });
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
    return new ApiError(404, "BOX_NOT_FOUND", "盲盒不存在。");
  }

  if (
    message.includes("not active") ||
    message.includes("has not started") ||
    message.includes("has ended")
  ) {
    return new ApiError(400, "BOX_NOT_ACTIVE", "当前盲盒不可开启。");
  }

  if (message.includes("stock is insufficient")) {
    return new ApiError(
      409,
      "BOX_STOCK_NOT_ENOUGH",
      "当前盲盒暂时不可开启，请刷新后重试。",
    );
  }

  if (
    message.includes("active drop pool not found") ||
    message.includes("drop pool is empty") ||
    message.includes("drop pool empty") ||
    message.includes("reward pool is empty")
  ) {
    return new ApiError(
      409,
      "DROP_POOL_EMPTY",
      "当前奖励池为空，暂时无法开盒。",
    );
  }

  if (message.includes("quantity must be 1 or 10")) {
    return new ApiError(400, "DRAW_COUNT_INVALID", "开盒次数只能是 1 或 10。");
  }

  if (message.includes("idempotency_key is required")) {
    return ApiError.badRequest("缺少幂等键。");
  }

  if (message.includes("box slug is required")) {
    return ApiError.badRequest("缺少盲盒档位。");
  }

  if (message.includes("idempotency key conflict")) {
    return new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "幂等键已被其他开盒请求使用。",
    );
  }

  if (message.includes("expected price changed")) {
    return new ApiError(
      409,
      "BOX_PRICE_CHANGED",
      "盲盒价格已变化，请刷新后重试。",
    );
  }

  if (message.includes("expected pool version changed")) {
    return new ApiError(
      409,
      "BOX_POOL_VERSION_CHANGED",
      "奖励池版本已变化，请刷新后重试。",
    );
  }

  if (message.includes("draw order not found")) {
    return new ApiError(404, "ORDER_NOT_FOUND", "订单不存在或不属于当前用户。");
  }

  if (
    message.includes("order already processed") ||
    message.includes("order already completed") ||
    message.includes("draw order already processed") ||
    message.includes("draw order already opened")
  ) {
    return new ApiError(409, "ORDER_ALREADY_PROCESSED", "订单已处理。");
  }

  if (message.includes("insufficient balance")) {
    return new ApiError(
      402,
      "INSUFFICIENT_BALANCE",
      "K-coin 余额不足，请先充值。",
    );
  }

  if (message.includes("user not found")) {
    return new ApiError(404, "USER_NOT_FOUND", "登录用户不存在。");
  }

  if (message.includes("user is not active")) {
    return ApiError.userBlocked("当前账号已被限制使用。");
  }

  if (
    message.includes("currency ledger") ||
    message.includes("ledger write failed") ||
    message.includes("ledger insert failed")
  ) {
    return new ApiError(
      500,
      "BALANCE_LEDGER_FAILED",
      "资产流水写入失败，请稍后重试。",
      {
        expose: true,
      },
    );
  }

  if (
    message.includes("inventory create failed") ||
    message.includes("inventory insert failed") ||
    message.includes("item instance create failed")
  ) {
    return new ApiError(
      500,
      "INVENTORY_CREATE_FAILED",
      "库存写入失败，请稍后查看结果。",
      {
        expose: true,
      },
    );
  }

  return new ApiError(500, "GACHA_CREATE_ORDER_FAILED", "创建开盒订单失败。", {
    expose: false,
    cause: error,
  });
}

function readGachaServerPriceSnapshot(
  input: CreateBoxOpenOrderRequest,
): GachaServerPriceSnapshot {
  const boxSlug = normalizeGachaBoxSlug(input.boxSlug);
  const unitPriceKcoin = readPositiveIntEnv(
    GACHA_BOX_PRICE_ENV_BY_SLUG[boxSlug],
  );
  const discountBps =
    input.quantity === 10
      ? readDiscountRateEnvAsBps(GACHA_TEN_DRAW_DISCOUNT_RATE_ENV)
      : 0;
  const totalPriceKcoin = Math.ceil(
    (unitPriceKcoin * input.quantity * (10000 - discountBps)) / 10000,
  );

  if (totalPriceKcoin <= 0) {
    throw new ApiError(
      500,
      "GACHA_PRICE_CONFIG_INVALID",
      "盲盒价格配置无效。",
      {
        expose: false,
        details: {
          boxSlug,
          quantity: input.quantity,
        },
      },
    );
  }

  return {
    boxSlug,
    discountBps,
    totalPriceKcoin,
    unitPriceKcoin,
  };
}

function normalizeGachaBoxSlug(value: string): GachaBoxSlug {
  if (
    value === "starter_egg" ||
    value === "premium_egg" ||
    value === "legendary_egg"
  ) {
    return value;
  }

  throw new ApiError(400, "BOX_NOT_FOUND", "盲盒不存在。");
}

function readPositiveIntEnv(name: string): number {
  const value = process.env[name]?.trim();

  if (!value || !/^[1-9]\d*$/.test(value)) {
    throw new ApiError(
      500,
      "GACHA_PRICE_CONFIG_INVALID",
      "盲盒价格配置无效。",
      {
        expose: false,
        details: {
          envName: name,
        },
      },
    );
  }

  return Number(value);
}

function readDiscountRateEnvAsBps(name: string): number {
  const value = process.env[name]?.trim();

  if (!value || !/^(?:0|0?\.\d+)$/.test(value)) {
    throw new ApiError(
      500,
      "GACHA_PRICE_CONFIG_INVALID",
      "盲盒折扣配置无效。",
      {
        expose: false,
        details: {
          envName: name,
        },
      },
    );
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue >= 1) {
    throw new ApiError(
      500,
      "GACHA_PRICE_CONFIG_INVALID",
      "盲盒折扣配置无效。",
      {
        expose: false,
        details: {
          envName: name,
        },
      },
    );
  }

  return Math.round(numberValue * 10000);
}

function boxSlugFromTier(value: unknown): GachaBoxSlug | undefined {
  switch (String(value ?? "").trim()) {
    case "normal":
    case "ordinary":
    case "starter":
      return "starter_egg";
    case "rare":
    case "premium":
      return "premium_egg";
    case "legendary":
      return "legendary_egg";
    default:
      return undefined;
  }
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

function isCompletedOrderStatus(value: string): boolean {
  return value === "completed" || value === "opened";
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
