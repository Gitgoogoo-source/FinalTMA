import {
  KcoinTopupCreateOrderRequestSchema,
  type KcoinTopupCreateOrderRequest,
} from "../../../packages/validation/src/payment.schemas.js";
import { callRpcRaw, RpcError } from "../../../packages/server/src/db/rpc.js";
import { assertStarsPaymentCreateAllowed } from "../../../packages/server/src/payments/paymentGuards.js";
import {
  createTelegramStarsInvoice,
  type TelegramStarsInvoiceResult,
} from "../../../packages/server/src/payments/telegramStars.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../../_shared/handler.js";
import { parseJsonBody } from "../../_shared/parseBody.js";
import { requireSession } from "../../_shared/requireSession.js";
import { assertUserRiskAllowed } from "../../_shared/riskGuards.js";
import { validate } from "../../_shared/validate.js";

type KcoinTopupCreateOrderRpcResult = {
  topup_order_id?: unknown;
  star_order_id?: unknown;
  invoice_payload?: unknown;
  xtr_amount?: unknown;
  kcoin_amount?: unknown;
  status?: unknown;
  payment_order_status?: unknown;
  expires_at?: unknown;
  paid_at?: unknown;
  fulfilled_at?: unknown;
  idempotent?: unknown;
};

type GachaBoxSlug = "starter_egg" | "premium_egg" | "legendary_egg";

type OpenBoxTopupContext = {
  intent: "OPEN_BOX";
  boxSlug: GachaBoxSlug;
  drawCount: 1 | 10;
  requiredKcoin: number;
  unitPriceKcoin: number;
  discountBps: number;
};

type KcoinTopupCreateOrderResponse = {
  order_id: string;
  topup_order_id: string;
  star_order_id: string | null;
  invoice_payload: string | null;
  invoice_link: string | null;
  invoice_open_mode: string | null;
  xtr_amount: number;
  kcoin_amount: number;
  order_status: string;
  payment_status: string;
  payment_order_status: string;
  expires_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  idempotent: boolean;
};

const GACHA_BOX_PRICE_ENV_BY_SLUG: Record<GachaBoxSlug, string> = {
  starter_egg: "GACHA_STARTER_EGG_PRICE_STARS",
  premium_egg: "GACHA_PREMIUM_EGG_PRICE_STARS",
  legendary_egg: "GACHA_LEGENDARY_EGG_PRICE_STARS",
};

const GACHA_TEN_DRAW_DISCOUNT_RATE_ENV = "GACHA_TEN_DRAW_DISCOUNT_RATE";

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const body = await parseJsonBody<unknown>(req, {
      maxBytes: 16 * 1024,
    });
    const input = validate(
      KcoinTopupCreateOrderRequestSchema,
      normalizeKcoinTopupCreateOrderInput(body, getIdempotencyKey(req)),
    );

    const openBoxContext = readOpenBoxTopupContext(input);

    await assertStarsPaymentCreateAllowed();
    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "payments.kcoin_topup.create_order",
      idempotencyKey: input.idempotencyKey,
      metadata: {
        amount: input.amount,
        intent: input.intent,
        boxSlug: openBoxContext?.boxSlug ?? input.boxSlug,
        drawCount: openBoxContext?.drawCount ?? input.drawCount,
      },
    });

    const order = await callKcoinTopupCreateOrder(
      input,
      session.userId,
      ctx.requestId,
      openBoxContext,
    );
    const topupOrderId = getRequiredString(order, "topup_order_id");
    const starOrderId = getRequiredString(order, "star_order_id");
    const invoicePayload = getRequiredString(order, "invoice_payload");
    const xtrAmount = numberOrZero(order.xtr_amount);
    const invoiceResult = await createTelegramStarsInvoice({
      starOrderId,
      drawOrderId: topupOrderId,
      businessType: "kcoin_topup",
      userId: session.userId,
      invoicePayload,
      xtrAmount,
      requestId: ctx.requestId,
    });

    return buildKcoinTopupCreateOrderResponse(order, invoiceResult);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "payments.kcoin_topup.create_order",
    },
  },
);

export function normalizeKcoinTopupCreateOrderInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  const payload = isRecord(body) ? body : {};

  return {
    amount:
      payload.amount ??
      payload.kcoinAmount ??
      payload.kcoin_amount ??
      payload.xtrAmount ??
      payload.xtr_amount,
    intent: normalizeTopupIntent(
      payload.intent ?? payload.topupIntent ?? payload.topup_intent,
    ),
    boxSlug: payload.boxSlug ?? payload.box_slug,
    drawCount: payload.drawCount ?? payload.draw_count ?? payload.quantity,
    idempotencyKey:
      payload.idempotencyKey ?? payload.idempotency_key ?? headerIdempotencyKey,
  };
}

export function buildKcoinTopupCreateOrderResponse(
  order: KcoinTopupCreateOrderRpcResult,
  invoiceResult: TelegramStarsInvoiceResult | null,
): KcoinTopupCreateOrderResponse {
  const topupOrderId = getRequiredString(order, "topup_order_id");
  const orderStatus = stringOrNull(order.status) ?? "created";
  const paymentOrderStatus =
    stringOrNull(invoiceResult?.paymentOrderStatus) ??
    stringOrNull(order.payment_order_status) ??
    orderStatus;

  return {
    order_id: topupOrderId,
    topup_order_id: topupOrderId,
    star_order_id: stringOrNull(order.star_order_id),
    invoice_payload: stringOrNull(order.invoice_payload),
    invoice_link: invoiceResult?.invoiceLink ?? null,
    invoice_open_mode: invoiceResult?.openMode ?? null,
    xtr_amount: numberOrZero(order.xtr_amount),
    kcoin_amount: numberOrZero(order.kcoin_amount),
    order_status: orderStatus,
    payment_status: paymentOrderStatus,
    payment_order_status: paymentOrderStatus,
    expires_at:
      invoiceResult?.expiresAt ?? stringOrNull(order.expires_at) ?? null,
    paid_at: stringOrNull(order.paid_at),
    fulfilled_at: stringOrNull(order.fulfilled_at),
    idempotent: Boolean(order.idempotent) || Boolean(invoiceResult?.reused),
  };
}

async function callKcoinTopupCreateOrder(
  input: KcoinTopupCreateOrderRequest,
  userId: string,
  requestId: string,
  openBoxContext: OpenBoxTopupContext | null,
): Promise<KcoinTopupCreateOrderRpcResult> {
  try {
    return await callRpcRaw<KcoinTopupCreateOrderRpcResult>(
      "kcoin_topup_create_order",
      {
        p_user_id: userId,
        p_amount: input.amount,
        p_idempotency_key: input.idempotencyKey,
        p_intent: openBoxContext?.intent ?? "MANUAL_TOPUP",
        p_box_slug: openBoxContext?.boxSlug ?? null,
        p_draw_count: openBoxContext?.drawCount ?? null,
        p_required_kcoin: openBoxContext?.requiredKcoin ?? null,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          amount: input.amount,
          intent: openBoxContext?.intent ?? input.intent,
          boxSlug: openBoxContext?.boxSlug ?? input.boxSlug,
          drawCount: openBoxContext?.drawCount ?? input.drawCount,
          requiredKcoin: openBoxContext?.requiredKcoin,
          idempotencyKey: input.idempotencyKey,
        },
      },
    );
  } catch (error) {
    throw mapKcoinTopupRpcError(error);
  }
}

function mapKcoinTopupRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("创建 K-coin 充值订单失败。", {
      cause: getErrorMessage(error),
    });
  }

  const message = [error.message, error.details, error.hint]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();

  if (message.includes("idempotency_key is required")) {
    return new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键。");
  }

  if (message.includes("idempotency key conflict")) {
    return new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "幂等键已被其他充值请求使用。",
    );
  }

  if (message.includes("topup amount is invalid")) {
    return new ApiError(400, "KCOIN_TOPUP_AMOUNT_INVALID", "充值档位无效。");
  }

  if (message.includes("topup amount is not enough for open box")) {
    return new ApiError(
      400,
      "KCOIN_TOPUP_AMOUNT_NOT_ENOUGH",
      "本次充值不足以完成开盒，请选择补足差额或更高档位。",
    );
  }

  if (message.includes("open box topup context is invalid")) {
    return new ApiError(
      400,
      "KCOIN_TOPUP_CONTEXT_INVALID",
      "开盒补差额参数无效，请刷新后重试。",
    );
  }

  if (message.includes("user not found")) {
    return new ApiError(404, "USER_NOT_FOUND", "登录用户不存在。");
  }

  if (message.includes("user is not active")) {
    return ApiError.userBlocked("当前账号已被限制使用。");
  }

  return new ApiError(
    500,
    "KCOIN_TOPUP_CREATE_ORDER_RPC_FAILED",
    "创建 K-coin 充值订单失败。",
    {
      expose: false,
      cause: error,
    },
  );
}

function readOpenBoxTopupContext(
  input: KcoinTopupCreateOrderRequest,
): OpenBoxTopupContext | null {
  if (input.intent !== "OPEN_BOX") {
    return null;
  }

  const boxSlug = normalizeGachaBoxSlug(input.boxSlug ?? "");
  const drawCount = input.drawCount;

  if (drawCount !== 1 && drawCount !== 10) {
    throw new ApiError(
      400,
      "KCOIN_TOPUP_CONTEXT_INVALID",
      "开盒补差额参数无效，请刷新后重试。",
    );
  }

  const unitPriceKcoin = readPositiveIntEnv(
    GACHA_BOX_PRICE_ENV_BY_SLUG[boxSlug],
  );
  const discountBps =
    drawCount === 10
      ? readDiscountRateEnvAsBps(GACHA_TEN_DRAW_DISCOUNT_RATE_ENV)
      : 0;
  const requiredKcoin = Math.ceil(
    (unitPriceKcoin * drawCount * (10000 - discountBps)) / 10000,
  );

  if (requiredKcoin <= 0) {
    throw new ApiError(
      500,
      "GACHA_PRICE_CONFIG_INVALID",
      "盲盒价格配置无效。",
      {
        expose: false,
        details: {
          boxSlug,
          drawCount,
        },
      },
    );
  }

  return {
    intent: "OPEN_BOX",
    boxSlug,
    drawCount,
    requiredKcoin,
    unitPriceKcoin,
    discountBps,
  };
}

function normalizeTopupIntent(value: unknown): "MANUAL_TOPUP" | "OPEN_BOX" {
  const normalized = String(value ?? "MANUAL_TOPUP")
    .trim()
    .toUpperCase();

  return normalized === "OPEN_BOX" ? "OPEN_BOX" : "MANUAL_TOPUP";
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

function getRequiredString(
  value: KcoinTopupCreateOrderRpcResult,
  key: keyof KcoinTopupCreateOrderRpcResult,
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
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
