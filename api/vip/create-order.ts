import {
  VipCreateOrderRequestSchema,
  type VipCreateOrderRequest,
} from "../../packages/validation/src/vip.schemas.js";
import { callRpcRaw, RpcError } from "../../packages/server/src/db/rpc.js";
import {
  readVipMonthlyPriceKcoin,
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
  kcoin_amount?: unknown;
  currency_code?: unknown;
  subscription_id?: unknown;
  current_period_start?: unknown;
  current_period_end?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  kcoin_ledger_id?: unknown;
  status?: unknown;
  payment_status?: unknown;
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
  kcoin_amount: number;
  currency_code: "KCOIN";
  subscription_id: string | null;
  subscriptionId: string | null;
  current_period_start: string | null;
  currentPeriodStart: string | null;
  current_period_end: string | null;
  currentPeriodEnd: string | null;
  kcoin_ledger_id: string | null;
  kcoinLedgerId: string | null;
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
    const serverPriceKcoin = readVipMonthlyPriceKcoinForApi();

    await assertUserRiskAllowed({
      req,
      ctx,
      session,
      action: "vip.create_order",
      idempotencyKey: input.idempotencyKey,
      metadata: {
        planId: input.planId,
        serverPriceKcoin,
        paymentCurrency: "KCOIN",
      },
    });

    const order = await callVipCreateOrder(
      input,
      session.userId,
      ctx.requestId,
      serverPriceKcoin,
    );

    return buildCreateVipOrderResponse(order);
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
): CreateVipOrderResponse {
  const vipOrderId = getRequiredString(order, "vip_order_id");
  const paymentOrderStatus =
    stringOrNull(order.payment_order_status) ??
    stringOrNull(order.payment_status) ??
    stringOrNull(order.status) ??
    "fulfilled";
  const orderStatus = stringOrNull(order.status) ?? "fulfilled";
  const currentPeriodStart = stringOrNull(order.current_period_start);
  const currentPeriodEnd = stringOrNull(order.current_period_end);
  const kcoinLedgerId = stringOrNull(order.kcoin_ledger_id);
  const subscriptionId = stringOrNull(order.subscription_id);

  return {
    order_id: vipOrderId,
    vip_order_id: vipOrderId,
    star_order_id: stringOrNull(order.star_order_id),
    invoice_payload: stringOrNull(order.invoice_payload),
    invoice_link: null,
    invoice_open_mode: null,
    xtr_amount: numberOrZero(order.xtr_amount),
    kcoin_amount: numberOrZero(order.kcoin_amount),
    currency_code: "KCOIN",
    subscription_id: subscriptionId,
    subscriptionId,
    current_period_start: currentPeriodStart,
    currentPeriodStart,
    current_period_end: currentPeriodEnd,
    currentPeriodEnd,
    kcoin_ledger_id: kcoinLedgerId,
    kcoinLedgerId,
    order_status: orderStatus,
    payment_status: paymentOrderStatus,
    payment_order_status: paymentOrderStatus,
    expires_at: stringOrNull(order.expires_at),
    paid_at: stringOrNull(order.paid_at),
    fulfilled_at: stringOrNull(order.fulfilled_at),
    idempotent: Boolean(order.idempotent),
  };
}

async function callVipCreateOrder(
  input: VipCreateOrderRequest,
  userId: string,
  requestId: string,
  serverPriceKcoin: number,
): Promise<CreateVipOrderRpcResult> {
  try {
    return await callRpcRaw<CreateVipOrderRpcResult>(
      "vip_create_order_with_server_kcoin_checked",
      {
        p_user_id: userId,
        p_plan_id: input.planId,
        p_idempotency_key: input.idempotencyKey,
        p_server_price_kcoin: serverPriceKcoin,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          planId: input.planId,
          serverPriceKcoin,
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
    message.includes("server price kcoin is invalid") ||
    message.includes("server_price_kcoin is required")
  ) {
    return new ApiError(503, "VIP_PRICE_CONFIG_INVALID", "月卡价格配置无效。", {
      expose: false,
      cause: error,
    });
  }

  if (message.includes("insufficient balance")) {
    const shortageDetails = readInsufficientKcoinDetails(
      [error.message, error.details, error.hint]
        .filter((item): item is string => typeof item === "string")
        .join(" "),
    );

    return new ApiError(
      402,
      "INSUFFICIENT_KCOIN",
      "K-coin 余额不足，请先充值。",
      {
        details: {
          required: shortageDetails?.required ?? null,
          balance: shortageDetails?.balance ?? null,
          shortage: shortageDetails?.shortage ?? null,
          canTopup: true,
          fixedTopupPackages: [...KCOIN_FIXED_TOPUP_PACKAGES],
        },
      },
    );
  }

  if (
    message.includes(
      "function api.vip_create_order_with_server_kcoin_checked",
    ) ||
    (message.includes("vip_create_order_with_server_kcoin_checked") &&
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

const KCOIN_FIXED_TOPUP_PACKAGES = [500, 1000, 5000, 10000] as const;

function readVipMonthlyPriceKcoinForApi(): number {
  try {
    return readVipMonthlyPriceKcoin();
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

function readInsufficientKcoinDetails(message: string): {
  required: number;
  balance: number;
  shortage: number;
} | null {
  const required = readNamedNumber(message, "required");
  const balance = readNamedNumber(message, "balance");
  const shortage = readNamedNumber(message, "shortage");

  if (required === null || balance === null || shortage === null) {
    return null;
  }

  return {
    required,
    balance,
    shortage,
  };
}

function readNamedNumber(message: string, key: string): number | null {
  const match = new RegExp(`${key}=([0-9]+(?:\\.[0-9]+)?)`).exec(message);
  const value = match?.[1];

  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
