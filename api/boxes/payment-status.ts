import {
  BoxPaymentStatusQuerySchema,
  type BoxPaymentStatusQuery,
} from "../../packages/validation/src/box.schemas.js";
import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import {
  inferPaymentOrderStatusFromDrawOrderStatus,
  normalizePaymentOrderStatus,
  type PaymentOrderStatus,
} from "../../packages/server/src/payments/paymentEvents.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireSession } from "../_shared/requireSession.js";
import { validate } from "../_shared/validate.js";

type DrawOrderRow = {
  id: string;
  user_id: string;
  box_id: string;
  payment_star_order_id: string | null;
  status: string;
  payment_status: string | null;
  draw_count: number;
  quantity: number;
  total_price_stars: number;
  open_reward_kcoin: number | string;
  paid_at: string | null;
  opened_at: string | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
};

type StarOrderRow = {
  id: string;
  user_id: string;
  business_type: string;
  business_id: string | null;
  status: string;
  xtr_amount: number;
  expires_at: string | null;
  precheckout_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
};

type StarPaymentRow = {
  id: string;
  star_order_id: string;
  user_id: string;
  currency: string;
  xtr_amount: number;
  paid_at: string;
  created_at: string;
};

type PaymentStatusSnapshot = {
  draw_order: DrawOrderRow;
  star_order: StarOrderRow | null;
  payment: StarPaymentRow | null;
};

type PaymentStatusRpcClient = {
  schema: (schema: string) => {
    rpc: <TResult>(
      functionName: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{
      data: TResult | null;
      error: unknown;
    }>;
  };
};

type PaymentStatusResponse = {
  order_id: string;
  star_order_id: string | null;
  status: PaymentOrderStatus;
  payment_order_status: PaymentOrderStatus;
  result_ready: boolean;
  draw_order: {
    id: string;
    status: string;
    payment_status: PaymentOrderStatus;
    draw_count: number;
    quantity: number;
    total_price_stars: number;
    returned_kcoin: number;
    paid_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
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
    created_at: string;
    updated_at: string;
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
    result_ready: boolean;
    completed_at: string | null;
    failed: boolean;
    retryable: boolean;
  };
  server_time: string;
};

const PENDING_PAYMENT_STATUSES = new Set<PaymentOrderStatus>([
  "created",
  "invoice_created",
  "precheckout_checked",
]);

export default withApiHandler(
  async (req, _res, ctx) => {
    const session = await requireSession(req);
    const query = validate(
      BoxPaymentStatusQuerySchema,
      normalizePaymentStatusQuery(req.query),
    );
    const status = await getPaymentStatus(
      session.userId,
      query,
      new Date(),
      getSupabaseAdminClient(),
    );

    return {
      ...status,
      request_id: ctx.requestId,
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "boxes.payment_status",
    },
  },
);

export function normalizePaymentStatusQuery(
  query: Record<string, unknown>,
): Record<string, unknown> {
  return {
    orderId: query.orderId ?? query.order_id,
  };
}

export async function getPaymentStatus(
  userId: string,
  query: BoxPaymentStatusQuery,
  now: Date,
  db: SupabaseAdminClient = getSupabaseAdminClient(),
): Promise<PaymentStatusResponse> {
  const snapshot = await getPaymentStatusSnapshot(db, userId, query.orderId);

  if (!snapshot?.draw_order) {
    throw new ApiError(404, "ORDER_NOT_FOUND", "订单不存在或不属于当前用户。");
  }

  const drawOrder = snapshot.draw_order;
  const starOrder = snapshot.star_order;
  const starPayment = snapshot.payment;
  const paymentOrderStatus = derivePaymentOrderStatus(
    drawOrder,
    starOrder,
    now,
  );
  const resultReady = isFulfilled(drawOrder, paymentOrderStatus);
  const fulfillmentStatus = deriveFulfillmentStatus(
    drawOrder,
    paymentOrderStatus,
  );
  const paymentPaidAt =
    starPayment?.paid_at ?? starOrder?.paid_at ?? drawOrder.paid_at;

  return {
    order_id: drawOrder.id,
    star_order_id: starOrder?.id ?? drawOrder.payment_star_order_id,
    status: paymentOrderStatus,
    payment_order_status: paymentOrderStatus,
    result_ready: resultReady,
    draw_order: {
      id: drawOrder.id,
      status: drawOrder.status,
      payment_status:
        normalizePaymentOrderStatus(drawOrder.payment_status) ??
        inferPaymentOrderStatusFromDrawOrderStatus(drawOrder.status) ??
        paymentOrderStatus,
      draw_count: numberOrZero(drawOrder.draw_count),
      quantity: numberOrZero(drawOrder.quantity),
      total_price_stars: numberOrZero(drawOrder.total_price_stars),
      returned_kcoin:
        numberOrZero(drawOrder.open_reward_kcoin) *
        Math.max(numberOrZero(drawOrder.quantity), 1),
      paid_at: drawOrder.paid_at,
      completed_at: drawOrder.opened_at,
      created_at: drawOrder.created_at,
      updated_at: drawOrder.updated_at,
      has_error: Boolean(drawOrder.error_message),
    },
    star_order: starOrder
      ? {
          id: starOrder.id,
          status: starOrder.status,
          payment_order_status:
            normalizePaymentOrderStatus(starOrder.status) ?? paymentOrderStatus,
          xtr_amount: numberOrZero(starOrder.xtr_amount),
          expires_at: starOrder.expires_at,
          precheckout_at: starOrder.precheckout_at,
          paid_at: starOrder.paid_at,
          fulfilled_at: starOrder.fulfilled_at,
          created_at: starOrder.created_at,
          updated_at: starOrder.updated_at,
          has_error: Boolean(starOrder.error_message),
        }
      : null,
    payment: {
      recorded: starPayment !== null,
      status: starPayment ? "paid" : paymentOrderStatus,
      currency: starPayment?.currency ?? "XTR",
      xtr_amount: numberOrZero(
        starPayment?.xtr_amount ??
          starOrder?.xtr_amount ??
          drawOrder.total_price_stars,
      ),
      paid_at: paymentPaidAt,
      created_at: starPayment?.created_at ?? null,
    },
    fulfillment: {
      status: fulfillmentStatus,
      result_ready: resultReady,
      completed_at: starOrder?.fulfilled_at ?? drawOrder.opened_at,
      failed: fulfillmentStatus === "failed",
      retryable: fulfillmentStatus === "failed" && paymentPaidAt !== null,
    },
    server_time: now.toISOString(),
  };
}

async function getPaymentStatusSnapshot(
  db: SupabaseAdminClient,
  userId: string,
  orderId: string,
): Promise<PaymentStatusSnapshot | null> {
  const { data, error } = await (db as unknown as PaymentStatusRpcClient)
    .schema("api")
    .rpc<PaymentStatusSnapshot | null>("gacha_get_payment_status", {
      p_user_id: userId,
      p_draw_order_id: orderId,
    });

  if (error) {
    throw ApiError.internal("查询订单状态失败。", { cause: error });
  }

  return data ?? null;
}

function derivePaymentOrderStatus(
  drawOrder: DrawOrderRow,
  starOrder: StarOrderRow | null,
  now: Date,
): PaymentOrderStatus {
  const status =
    normalizePaymentOrderStatus(starOrder?.status) ??
    normalizePaymentOrderStatus(drawOrder.payment_status) ??
    inferPaymentOrderStatusFromDrawOrderStatus(drawOrder.status) ??
    "created";

  if (
    PENDING_PAYMENT_STATUSES.has(status) &&
    starOrder?.expires_at &&
    Date.parse(starOrder.expires_at) <= now.getTime()
  ) {
    return "expired";
  }

  return status;
}

function deriveFulfillmentStatus(
  drawOrder: DrawOrderRow,
  paymentOrderStatus: PaymentOrderStatus,
): PaymentOrderStatus {
  const drawStatus = inferPaymentOrderStatusFromDrawOrderStatus(
    drawOrder.status,
  );

  if (drawStatus === "fulfilled") {
    return "fulfilled";
  }

  if (drawStatus === "failed" || paymentOrderStatus === "failed") {
    return "failed";
  }

  if (paymentOrderStatus === "paid") {
    return "paid";
  }

  if (paymentOrderStatus === "fulfilling") {
    return "fulfilling";
  }

  return paymentOrderStatus;
}

function isFulfilled(
  drawOrder: DrawOrderRow,
  paymentOrderStatus: PaymentOrderStatus,
): boolean {
  return (
    paymentOrderStatus === "fulfilled" ||
    inferPaymentOrderStatusFromDrawOrderStatus(drawOrder.status) === "fulfilled"
  );
}

function normalizeNumberInput(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return null;
}

function numberOrZero(value: unknown): number {
  return Math.trunc(normalizeNumberInput(value) ?? 0);
}
