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

    await assertStarsPaymentCreateAllowed();
    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "payments.kcoin_topup.create_order",
      idempotencyKey: input.idempotencyKey,
      metadata: {
        amount: input.amount,
      },
    });

    const order = await callKcoinTopupCreateOrder(
      input,
      session.userId,
      ctx.requestId,
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
): Promise<KcoinTopupCreateOrderRpcResult> {
  try {
    return await callRpcRaw<KcoinTopupCreateOrderRpcResult>(
      "kcoin_topup_create_order",
      {
        p_user_id: userId,
        p_amount: input.amount,
        p_idempotency_key: input.idempotencyKey,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          amount: input.amount,
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
