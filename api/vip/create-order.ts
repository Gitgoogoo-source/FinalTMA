import {
  VipCreateOrderRequestSchema,
  type VipCreateOrderRequest,
} from "../../packages/validation/src/vip.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import { assertStarsPaymentCreateAllowed } from "../../packages/server/src/payments/paymentGuards.js";
import {
  createTelegramStarsInvoice,
  type TelegramStarsInvoiceResult,
} from "../../packages/server/src/payments/telegramStars.js";
import {
  readVipMonthlyPriceXtr,
  VipPriceConfigError,
} from "../../packages/server/src/vip/vipPrice.js";
import {
  ApiError,
  getIdempotencyKey,
  withApiHandler,
} from "../_shared/handler.js";
import { parseJsonBody } from "../_shared/parseBody.js";
import { requireSession } from "../_shared/requireSession.js";
import { assertUserRiskAllowed } from "../_shared/riskGuards.js";
import { validate } from "../_shared/validate.js";

type CreateVipOrderRpcResult = {
  vip_order_id?: unknown;
  star_order_id?: unknown;
  invoice_payload?: unknown;
  xtr_amount?: unknown;
  status?: unknown;
  payment_order_status?: unknown;
  expires_at?: unknown;
  paid_at?: unknown;
  fulfilled_at?: unknown;
  idempotent?: unknown;
};

type CreateVipOrderResponse = {
  order_id: string;
  vip_order_id: string;
  star_order_id: string | null;
  invoice_payload: string | null;
  invoice_link: string | null;
  invoice_open_mode: string | null;
  xtr_amount: number;
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
      VipCreateOrderRequestSchema,
      normalizeCreateVipOrderInput(body, getIdempotencyKey(req)),
    );
    const serverPriceXtr = readVipMonthlyPriceXtrForApi();

    await assertStarsPaymentCreateAllowed();
    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "vip.create_order",
      idempotencyKey: input.idempotencyKey,
      metadata: {
        planId: input.planId,
        serverPriceXtr,
      },
    });

    const order = await callVipCreateOrder(
      input,
      session.userId,
      ctx.requestId,
      serverPriceXtr,
    );
    const vipOrderId = getRequiredString(order, "vip_order_id");
    const starOrderId = getRequiredString(order, "star_order_id");
    const invoicePayload = getRequiredString(order, "invoice_payload");
    const xtrAmount = numberOrZero(order.xtr_amount);
    const invoiceResult = await createTelegramStarsInvoice({
      starOrderId,
      drawOrderId: vipOrderId,
      businessType: "vip_monthly",
      userId: session.userId,
      invoicePayload,
      xtrAmount,
      requestId: ctx.requestId,
    });

    return buildCreateVipOrderResponse(order, invoiceResult);
  },
  {
    methods: ["POST"],
    rateLimit: {
      action: "vip.create_order",
    },
  },
);

export function normalizeCreateVipOrderInput(
  body: unknown,
  headerIdempotencyKey: string | null,
): Record<string, unknown> {
  if (!isRecord(body)) {
    return {
      idempotencyKey: headerIdempotencyKey,
    };
  }

  return {
    planId: body.planId ?? body.plan_id,
    idempotencyKey:
      body.idempotencyKey ?? body.idempotency_key ?? headerIdempotencyKey,
    ...(body.user_id !== undefined ? { user_id: body.user_id } : {}),
    ...(body.telegram_user_id !== undefined
      ? { telegram_user_id: body.telegram_user_id }
      : {}),
  };
}

export function buildCreateVipOrderResponse(
  order: CreateVipOrderRpcResult,
  invoiceResult: TelegramStarsInvoiceResult | null,
): CreateVipOrderResponse {
  const vipOrderId = getRequiredString(order, "vip_order_id");
  const paymentOrderStatus =
    stringOrNull(invoiceResult?.paymentOrderStatus) ??
    stringOrNull(order.payment_order_status) ??
    stringOrNull(order.status) ??
    "created";
  const orderStatus = stringOrNull(order.status) ?? "created";

  return {
    order_id: vipOrderId,
    vip_order_id: vipOrderId,
    star_order_id: stringOrNull(order.star_order_id),
    invoice_payload: stringOrNull(order.invoice_payload),
    invoice_link: invoiceResult?.invoiceLink ?? null,
    invoice_open_mode: invoiceResult?.openMode ?? null,
    xtr_amount: numberOrZero(order.xtr_amount),
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

async function callVipCreateOrder(
  input: VipCreateOrderRequest,
  userId: string,
  requestId: string,
  serverPriceXtr: number,
): Promise<CreateVipOrderRpcResult> {
  try {
    return await callRpcRaw<CreateVipOrderRpcResult>(
      "vip_create_order_with_server_price_checked",
      {
        p_user_id: userId,
        p_plan_id: input.planId,
        p_idempotency_key: input.idempotencyKey,
        p_server_price_xtr: serverPriceXtr,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          planId: input.planId,
          serverPriceXtr,
          idempotencyKey: input.idempotencyKey,
        },
      },
    );
  } catch (error) {
    throw mapCreateVipOrderRpcError(error);
  }
}

function mapCreateVipOrderRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("创建月卡订单失败。", {
      cause: getErrorMessage(error),
    });
  }

  const message = getRpcErrorText(error);

  if (message.includes("idempotency_key is required")) {
    return new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少幂等键。");
  }

  if (message.includes("idempotency key conflict")) {
    return new ApiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "幂等键已被其他月卡请求使用。",
    );
  }

  if (message.includes("vip plan not found")) {
    return new ApiError(404, "VIP_PLAN_NOT_FOUND", "月卡套餐不存在。");
  }

  if (
    message.includes("vip plan is not active") ||
    message.includes("vip plan is unavailable")
  ) {
    return new ApiError(409, "VIP_PLAN_NOT_ACTIVE", "当前月卡套餐不可购买。");
  }

  if (message.includes("user not found")) {
    return new ApiError(404, "USER_NOT_FOUND", "登录用户不存在。");
  }

  if (message.includes("user is not active")) {
    return ApiError.userBlocked("当前账号已被限制使用。");
  }

  if (
    message.includes("server price xtr is invalid") ||
    message.includes("server_price_xtr is required")
  ) {
    return new ApiError(503, "VIP_PRICE_CONFIG_INVALID", "月卡价格配置无效。", {
      expose: false,
      cause: error,
    });
  }

  if (
    message.includes(
      "function api.vip_create_order_with_server_price_checked",
    ) ||
    (message.includes("vip_create_order_with_server_price_checked") &&
      message.includes("could not find")) ||
    message.includes("function api.vip_create_order_checked") ||
    (message.includes("vip_create_order_checked") &&
      message.includes("could not find")) ||
    message.includes('schema "vip" does not exist') ||
    message.includes('relation "vip.')
  ) {
    return new ApiError(
      503,
      "VIP_DATABASE_NOT_READY",
      "月卡数据库尚未初始化。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return new ApiError(
    500,
    "VIP_CREATE_ORDER_RPC_FAILED",
    "创建月卡订单失败。",
    {
      expose: false,
      cause: error,
    },
  );
}

function readVipMonthlyPriceXtrForApi(): number {
  try {
    return readVipMonthlyPriceXtr();
  } catch (error) {
    if (error instanceof VipPriceConfigError) {
      throw new ApiError(error.statusCode, error.code, "月卡价格配置无效。", {
        expose: error.expose,
        cause: error,
      });
    }

    throw error;
  }
}

function getRequiredString(
  value: CreateVipOrderRpcResult,
  key: keyof CreateVipOrderRpcResult,
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

function getRpcErrorText(error: RpcError): string {
  return [error.message, error.details, error.hint]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
