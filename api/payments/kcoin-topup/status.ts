import {
  KcoinTopupStatusQuerySchema,
  type KcoinTopupStatusQuery,
} from "../../../packages/validation/src/payment.schemas.js";
import { callRpcRaw, RpcError } from "../../../packages/server/src/db/rpc.js";
import {
  normalizePaymentOrderStatus,
  type PaymentOrderStatus,
} from "../../../packages/server/src/payments/paymentEvents.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireSession } from "../../_shared/requireSession.js";
import { validate } from "../../_shared/validate.js";

type KcoinTopupStatusRpcResult = Record<string, unknown> | null;

type KcoinTopupStatusResponse = {
  order_id: string;
  topup_order_id: string;
  star_order_id: string | null;
  status: PaymentOrderStatus;
  payment_order_status: PaymentOrderStatus;
  xtr_amount: number;
  kcoin_amount: number;
  paid_at: string | null;
  fulfilled_at: string | null;
  topup_order: {
    id: string;
    status: string;
    payment_order_status: PaymentOrderStatus;
    xtr_amount: number;
    kcoin_amount: number;
    paid_at: string | null;
    fulfilled_at: string | null;
    created_at: string | null;
    updated_at: string | null;
    has_error: boolean;
  };
  star_order: {
    id: string;
    status: string;
    payment_order_status: PaymentOrderStatus;
    xtr_amount: number;
    expires_at: string | null;
    precheckout_at: string | null;
    paid_at: string | null;
    fulfilled_at: string | null;
    created_at: string | null;
    updated_at: string | null;
    has_error: boolean;
  } | null;
  payment: {
    recorded: boolean;
    status: PaymentOrderStatus;
    currency: string;
    xtr_amount: number;
    paid_at: string | null;
    created_at: string | null;
  };
  fulfillment: {
    status: PaymentOrderStatus;
    credited: boolean;
    completed_at: string | null;
    failed: boolean;
    retryable: boolean;
  };
  server_time: string;
};

const PENDING_PAYMENT_STATUSES = new Set<PaymentOrderStatus>([
  "created",
  "precheckout_checked",
]);

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(
      KcoinTopupStatusQuerySchema,
      normalizeKcoinTopupStatusQuery(req.query),
    );
    const snapshot = await getKcoinTopupStatus(
      session.userId,
      query,
      new Date(),
      ctx.requestId,
    );

    return {
      ...snapshot,
      request_id: ctx.requestId,
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "payments.kcoin_topup.status",
    },
  },
);

export function normalizeKcoinTopupStatusQuery(
  query: Record<string, unknown>,
): Record<string, unknown> {
  return {
    orderId:
      query.orderId ??
      query.order_id ??
      query.topupOrderId ??
      query.topup_order_id,
  };
}

export async function getKcoinTopupStatus(
  userId: string,
  query: KcoinTopupStatusQuery,
  now: Date,
  requestId: string,
): Promise<KcoinTopupStatusResponse> {
  const payload = await callKcoinTopupStatusRpc(
    userId,
    query.orderId,
    requestId,
  );

  if (!payload) {
    throw new ApiError(
      404,
      "ORDER_NOT_FOUND",
      "充值订单不存在或不属于当前用户。",
    );
  }

  return normalizeKcoinTopupStatusPayload(payload, now);
}

async function callKcoinTopupStatusRpc(
  userId: string,
  orderId: string,
  requestId: string,
): Promise<KcoinTopupStatusRpcResult> {
  try {
    return await callRpcRaw<KcoinTopupStatusRpcResult>(
      "kcoin_topup_get_status",
      {
        p_user_id: userId,
        p_topup_order_id: orderId,
      },
      {
        schema: "api" as never,
        context: {
          requestId,
          userId,
          orderId,
        },
      },
    );
  } catch (error) {
    throw mapKcoinTopupStatusRpcError(error);
  }
}

function normalizeKcoinTopupStatusPayload(
  payload: Record<string, unknown>,
  now: Date,
): KcoinTopupStatusResponse {
  const topupOrder = readRecord(payload.topup_order);
  const starOrder = readRecord(payload.star_order);
  const payment = readRecord(payload.payment);
  const fulfillment = readRecord(payload.fulfillment);
  const orderId =
    readString(payload.order_id) ??
    readString(payload.topup_order_id) ??
    readString(topupOrder.id);

  if (!orderId) {
    throw invalidStatusPayload("缺少充值订单 ID。");
  }

  const paymentOrderStatus = derivePaymentOrderStatus({
    payload,
    topupOrder,
    starOrder,
    payment,
    now,
  });
  const xtrAmount =
    readNumber(payload.xtr_amount) ??
    readNumber(topupOrder.xtr_amount) ??
    readNumber(starOrder.xtr_amount) ??
    readNumber(payment.xtr_amount) ??
    0;
  const kcoinAmount =
    readNumber(payload.kcoin_amount) ??
    readNumber(topupOrder.kcoin_amount) ??
    0;
  const paidAt =
    readString(payload.paid_at) ??
    readString(topupOrder.paid_at) ??
    readString(starOrder.paid_at) ??
    readString(payment.paid_at);
  const fulfilledAt =
    readString(payload.fulfilled_at) ??
    readString(topupOrder.fulfilled_at) ??
    readString(starOrder.fulfilled_at) ??
    readString(fulfillment.completed_at);
  const fulfillmentStatus = deriveFulfillmentStatus({
    paymentOrderStatus,
    topupOrder,
    fulfillment,
    paidAt,
  });

  return {
    order_id: orderId,
    topup_order_id: orderId,
    star_order_id:
      readString(payload.star_order_id) ?? readString(starOrder.id),
    status: paymentOrderStatus,
    payment_order_status: paymentOrderStatus,
    xtr_amount: xtrAmount,
    kcoin_amount: kcoinAmount,
    paid_at: paidAt,
    fulfilled_at: fulfilledAt,
    topup_order: {
      id: orderId,
      status: readString(topupOrder.status) ?? "unknown",
      payment_order_status: normalizeKnownPaymentStatus(topupOrder.status),
      xtr_amount: readNumber(topupOrder.xtr_amount) ?? xtrAmount,
      kcoin_amount: readNumber(topupOrder.kcoin_amount) ?? kcoinAmount,
      paid_at: readString(topupOrder.paid_at),
      fulfilled_at: readString(topupOrder.fulfilled_at),
      created_at: readString(topupOrder.created_at),
      updated_at: readString(topupOrder.updated_at),
      has_error: readBoolean(topupOrder.has_error) ?? false,
    },
    star_order: readString(starOrder.id)
      ? {
          id: readString(starOrder.id) ?? "",
          status: readString(starOrder.status) ?? "unknown",
          payment_order_status: normalizeKnownPaymentStatus(starOrder.status),
          xtr_amount: readNumber(starOrder.xtr_amount) ?? xtrAmount,
          expires_at: readString(starOrder.expires_at),
          precheckout_at: readString(starOrder.precheckout_at),
          paid_at: readString(starOrder.paid_at),
          fulfilled_at: readString(starOrder.fulfilled_at),
          created_at: readString(starOrder.created_at),
          updated_at: readString(starOrder.updated_at),
          has_error: readBoolean(starOrder.has_error) ?? false,
        }
      : null,
    payment: {
      recorded: readBoolean(payment.recorded) ?? false,
      status:
        normalizePaymentOrderStatus(payment.status) ??
        (readBoolean(payment.recorded) === true ? "paid" : paymentOrderStatus),
      currency: readString(payment.currency) ?? "XTR",
      xtr_amount: readNumber(payment.xtr_amount) ?? xtrAmount,
      paid_at: readString(payment.paid_at),
      created_at: readString(payment.created_at),
    },
    fulfillment: {
      status: fulfillmentStatus,
      credited:
        readBoolean(fulfillment.credited) ?? fulfillmentStatus === "fulfilled",
      completed_at: readString(fulfillment.completed_at) ?? fulfilledAt,
      failed: fulfillmentStatus === "failed",
      retryable:
        (readBoolean(fulfillment.retryable) ?? false) ||
        (fulfillmentStatus === "failed" && paidAt !== null),
    },
    server_time: readString(payload.server_time) ?? now.toISOString(),
  };
}

function derivePaymentOrderStatus(input: {
  payload: Record<string, unknown>;
  topupOrder: Record<string, unknown>;
  starOrder: Record<string, unknown>;
  payment: Record<string, unknown>;
  now: Date;
}): PaymentOrderStatus {
  const paidAt =
    readString(input.payload.paid_at) ??
    readString(input.topupOrder.paid_at) ??
    readString(input.starOrder.paid_at) ??
    readString(input.payment.paid_at);
  const expiresAt = readString(input.starOrder.expires_at);
  const status =
    normalizePaymentOrderStatus(input.payload.payment_order_status) ??
    normalizePaymentOrderStatus(input.payload.status) ??
    normalizePaymentOrderStatus(input.starOrder.payment_order_status) ??
    normalizePaymentOrderStatus(input.starOrder.status) ??
    normalizePaymentOrderStatus(input.topupOrder.status) ??
    "created";

  if (
    PENDING_PAYMENT_STATUSES.has(status) &&
    paidAt === null &&
    isPast(expiresAt, input.now)
  ) {
    return "expired";
  }

  return status;
}

function deriveFulfillmentStatus(input: {
  paymentOrderStatus: PaymentOrderStatus;
  topupOrder: Record<string, unknown>;
  fulfillment: Record<string, unknown>;
  paidAt: string | null;
}): PaymentOrderStatus {
  const status =
    normalizePaymentOrderStatus(input.fulfillment.status) ??
    normalizePaymentOrderStatus(input.topupOrder.status) ??
    input.paymentOrderStatus;

  if (status === "failed" && input.paidAt) {
    return "failed";
  }

  return status;
}

function normalizeKnownPaymentStatus(value: unknown): PaymentOrderStatus {
  return normalizePaymentOrderStatus(value) ?? "created";
}

function mapKcoinTopupStatusRpcError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!(error instanceof RpcError)) {
    return ApiError.internal("查询 K-coin 充值状态失败。", {
      cause: getErrorMessage(error),
    });
  }

  return new ApiError(
    500,
    "KCOIN_TOPUP_STATUS_RPC_FAILED",
    "查询 K-coin 充值状态失败。",
    {
      expose: false,
      cause: error,
    },
  );
}

function invalidStatusPayload(reason: string): ApiError {
  return new ApiError(500, "KCOIN_TOPUP_STATUS_RESULT_INVALID", reason, {
    expose: false,
  });
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isPast(value: string | null, now: Date): boolean {
  if (!value) {
    return false;
  }

  const parsed = new Date(value);

  return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= now.getTime();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
