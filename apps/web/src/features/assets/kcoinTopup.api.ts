import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import type {
  CreateKcoinTopupOrderInput,
  CreateKcoinTopupOrderResponse,
  KcoinTopupPaymentStatus,
  KcoinTopupStatusResponse,
} from "./assets.types";

export async function createKcoinTopupOrder(
  input: CreateKcoinTopupOrderInput,
): Promise<CreateKcoinTopupOrderResponse> {
  const idempotencyKey = createScopedIdempotencyKey(
    `kcoin:topup:${input.amount}`,
  );
  const response = await apiRequest<unknown>(
    API_ENDPOINTS.payments.kcoinTopupCreateOrder,
    {
      method: "POST",
      body: {
        amount: input.amount,
        intent: input.intent,
        box_slug: input.boxSlug,
        draw_count: input.drawCount,
        idempotency_key: idempotencyKey,
      },
      headers: {
        "X-Idempotency-Key": idempotencyKey,
      },
    },
  );

  return normalizeCreateKcoinTopupOrderResponse(response);
}

export async function fetchKcoinTopupStatus(
  orderId: string,
): Promise<KcoinTopupStatusResponse> {
  const params = new URLSearchParams({
    orderId,
  });
  const response = await apiRequest<unknown>(
    `${API_ENDPOINTS.payments.kcoinTopupStatus}?${params.toString()}`,
    {
      method: "GET",
    },
  );

  return normalizeKcoinTopupStatusResponse(response, orderId);
}

function normalizeCreateKcoinTopupOrderResponse(
  response: unknown,
): CreateKcoinTopupOrderResponse {
  const payload = isRecord(response) ? response : {};
  const orderStatus =
    readString(payload.orderStatus) ??
    readString(payload.order_status) ??
    "created";
  const paymentOrderStatus =
    readString(payload.paymentOrderStatus) ??
    readString(payload.payment_order_status) ??
    orderStatus;
  const topupOrderId =
    readString(payload.topupOrderId) ??
    readString(payload.topup_order_id) ??
    readString(payload.orderId) ??
    readString(payload.order_id) ??
    "";

  return {
    orderId:
      readString(payload.orderId) ??
      readString(payload.order_id) ??
      topupOrderId,
    topupOrderId,
    starOrderId:
      readString(payload.starOrderId) ?? readString(payload.star_order_id),
    invoicePayload:
      readString(payload.invoicePayload) ?? readString(payload.invoice_payload),
    invoiceLink:
      readString(payload.invoiceLink) ?? readString(payload.invoice_link),
    invoiceOpenMode:
      readString(payload.invoiceOpenMode) ??
      readString(payload.invoice_open_mode),
    xtrAmount:
      readNumber(payload.xtrAmount) ?? readNumber(payload.xtr_amount) ?? 0,
    kcoinAmount:
      readNumber(payload.kcoinAmount) ?? readNumber(payload.kcoin_amount) ?? 0,
    orderStatus,
    paymentStatus:
      readString(payload.paymentStatus) ??
      readString(payload.payment_status) ??
      paymentOrderStatus,
    paymentOrderStatus,
    expiresAt: readString(payload.expiresAt) ?? readString(payload.expires_at),
    paidAt: readString(payload.paidAt) ?? readString(payload.paid_at),
    fulfilledAt:
      readString(payload.fulfilledAt) ?? readString(payload.fulfilled_at),
    idempotent: readBoolean(payload.idempotent) ?? false,
  };
}

function normalizeKcoinTopupStatusResponse(
  response: unknown,
  fallbackOrderId: string,
): KcoinTopupStatusResponse {
  const payload = isRecord(response) ? response : {};
  const topupOrder = readRecord(payload.topupOrder ?? payload.topup_order);
  const starOrder = readRecord(payload.starOrder ?? payload.star_order);
  const payment = readRecord(payload.payment);
  const fulfillment = readRecord(payload.fulfillment);
  const orderId =
    readString(payload.orderId) ??
    readString(payload.order_id) ??
    readString(payload.topupOrderId) ??
    readString(payload.topup_order_id) ??
    fallbackOrderId;
  const paymentOrderStatus = normalizePaymentStatus(
    payload.paymentOrderStatus ??
      payload.payment_order_status ??
      payload.status,
  );
  const xtrAmount =
    readNumber(payload.xtrAmount) ??
    readNumber(payload.xtr_amount) ??
    readNumber(topupOrder.xtrAmount) ??
    readNumber(topupOrder.xtr_amount) ??
    0;
  const kcoinAmount =
    readNumber(payload.kcoinAmount) ??
    readNumber(payload.kcoin_amount) ??
    readNumber(topupOrder.kcoinAmount) ??
    readNumber(topupOrder.kcoin_amount) ??
    0;

  return {
    orderId,
    topupOrderId:
      readString(payload.topupOrderId) ??
      readString(payload.topup_order_id) ??
      orderId,
    starOrderId:
      readString(payload.starOrderId) ?? readString(payload.star_order_id),
    status: normalizePaymentStatus(payload.status ?? paymentOrderStatus),
    paymentOrderStatus,
    xtrAmount,
    kcoinAmount,
    paidAt: readString(payload.paidAt) ?? readString(payload.paid_at),
    fulfilledAt:
      readString(payload.fulfilledAt) ?? readString(payload.fulfilled_at),
    topupOrder: {
      id: readString(topupOrder.id) ?? orderId,
      status: readString(topupOrder.status) ?? "unknown",
      paymentOrderStatus: normalizePaymentStatus(
        topupOrder.paymentOrderStatus ??
          topupOrder.payment_order_status ??
          topupOrder.status,
      ),
      xtrAmount:
        readNumber(topupOrder.xtrAmount) ??
        readNumber(topupOrder.xtr_amount) ??
        xtrAmount,
      kcoinAmount:
        readNumber(topupOrder.kcoinAmount) ??
        readNumber(topupOrder.kcoin_amount) ??
        kcoinAmount,
      paidAt: readString(topupOrder.paidAt) ?? readString(topupOrder.paid_at),
      fulfilledAt:
        readString(topupOrder.fulfilledAt) ??
        readString(topupOrder.fulfilled_at),
      createdAt:
        readString(topupOrder.createdAt) ?? readString(topupOrder.created_at),
      updatedAt:
        readString(topupOrder.updatedAt) ?? readString(topupOrder.updated_at),
      hasError:
        readBoolean(topupOrder.hasError) ??
        readBoolean(topupOrder.has_error) ??
        false,
    },
    starOrder: readString(starOrder.id)
      ? {
          id: readString(starOrder.id) ?? "",
          status: readString(starOrder.status) ?? "unknown",
          paymentOrderStatus: normalizePaymentStatus(
            starOrder.paymentOrderStatus ??
              starOrder.payment_order_status ??
              starOrder.status,
          ),
          xtrAmount:
            readNumber(starOrder.xtrAmount) ??
            readNumber(starOrder.xtr_amount) ??
            xtrAmount,
          expiresAt:
            readString(starOrder.expiresAt) ?? readString(starOrder.expires_at),
          precheckoutAt:
            readString(starOrder.precheckoutAt) ??
            readString(starOrder.precheckout_at),
          paidAt: readString(starOrder.paidAt) ?? readString(starOrder.paid_at),
          fulfilledAt:
            readString(starOrder.fulfilledAt) ??
            readString(starOrder.fulfilled_at),
          createdAt:
            readString(starOrder.createdAt) ?? readString(starOrder.created_at),
          updatedAt:
            readString(starOrder.updatedAt) ?? readString(starOrder.updated_at),
          hasError:
            readBoolean(starOrder.hasError) ??
            readBoolean(starOrder.has_error) ??
            false,
        }
      : null,
    payment: {
      recorded: readBoolean(payment.recorded) ?? false,
      status: normalizePaymentStatus(payment.status),
      currency: readString(payment.currency) ?? "XTR",
      xtrAmount:
        readNumber(payment.xtrAmount) ??
        readNumber(payment.xtr_amount) ??
        xtrAmount,
      paidAt: readString(payment.paidAt) ?? readString(payment.paid_at),
      createdAt:
        readString(payment.createdAt) ?? readString(payment.created_at),
    },
    fulfillment: {
      status: normalizePaymentStatus(fulfillment.status),
      credited: readBoolean(fulfillment.credited) ?? false,
      completedAt:
        readString(fulfillment.completedAt) ??
        readString(fulfillment.completed_at),
      failed: readBoolean(fulfillment.failed) ?? false,
      retryable: readBoolean(fulfillment.retryable) ?? false,
    },
    serverTime:
      readString(payload.serverTime) ?? readString(payload.server_time),
  };
}

function normalizePaymentStatus(value: unknown): KcoinTopupPaymentStatus {
  const status =
    typeof value === "string" && value.trim().length > 0
      ? value.trim().toLowerCase()
      : null;

  switch (status) {
    case "invoice_created":
    case "pending":
    case "pending_payment":
      return "created";
    case "precheckout_ok":
      return "precheckout_checked";
    case "cancelled":
    case "canceled":
      return "expired";
    case "created":
    case "precheckout_checked":
    case "paid":
    case "fulfilling":
    case "fulfilled":
    case "failed":
    case "refunded":
    case "disputed":
    case "expired":
      return status;
    default:
      return "created";
  }
}

function createScopedIdempotencyKey(scope: string): string {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${scope}:${randomPart}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
