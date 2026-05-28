import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const {
  processTelegramPreCheckoutUpdateMock,
  processTelegramSuccessfulPaymentUpdateMock,
} = vi.hoisted(() => ({
  processTelegramPreCheckoutUpdateMock: vi.fn(),
  processTelegramSuccessfulPaymentUpdateMock: vi.fn(),
}));

vi.mock("../../packages/server/src/payments/telegramStars.js", () => ({
  hasTelegramPreCheckoutQuery: (update: unknown) =>
    typeof update === "object" &&
    update !== null &&
    "pre_checkout_query" in update,
  hasTelegramSuccessfulPayment: (update: unknown) =>
    typeof update === "object" &&
    update !== null &&
    "message" in update &&
    typeof (update as { message?: unknown }).message === "object" &&
    (update as { message?: { successful_payment?: unknown } }).message !==
      null &&
    "successful_payment" in
      (update as { message: { successful_payment?: unknown } }).message,
  inferTelegramUpdateEventType: (update: unknown) =>
    typeof update === "object" &&
    update !== null &&
    "pre_checkout_query" in update
      ? "pre_checkout_query"
      : typeof update === "object" &&
          update !== null &&
          "message" in update &&
          typeof (update as { message?: unknown }).message === "object" &&
          (update as { message?: { successful_payment?: unknown } }).message !==
            null &&
          "successful_payment" in
            (update as { message: { successful_payment?: unknown } }).message
        ? "successful_payment"
        : "unsupported_update",
  processTelegramPreCheckoutUpdate: processTelegramPreCheckoutUpdateMock,
  processTelegramSuccessfulPaymentUpdate:
    processTelegramSuccessfulPaymentUpdateMock,
}));

const WEBHOOK_SECRET = "test-telegram-webhook-secret";
const PRE_CHECKOUT_UPDATE = {
  update_id: 95050001,
  pre_checkout_query: {
    id: "pcq-test-001",
    from: {
      id: 7050001,
      first_name: "Test",
    },
    currency: "XTR",
    total_amount: 90,
    invoice_payload:
      "gacha_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
};
const SUCCESSFUL_PAYMENT_UPDATE = {
  update_id: 96060001,
  message: {
    message_id: 777,
    from: {
      id: 7050001,
      first_name: "Test",
    },
    successful_payment: {
      currency: "XTR",
      total_amount: 90,
      invoice_payload: PRE_CHECKOUT_UPDATE.pre_checkout_query.invoice_payload,
      telegram_payment_charge_id: "tg-charge-api-success-001",
      provider_payment_charge_id: "provider-charge-api-success-001",
    },
  },
};

describe("telegram webhook API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    processTelegramPreCheckoutUpdateMock.mockReset();
    processTelegramSuccessfulPaymentUpdateMock.mockReset();
    processTelegramPreCheckoutUpdateMock.mockResolvedValue({
      eventType: "pre_checkout_query",
      allowed: true,
      answered: true,
      telegramAnswerOk: true,
      idempotent: false,
      eventId: "44444444-4444-4444-8444-444444444444",
      starOrderId: "33333333-3333-4333-8333-333333333333",
      drawOrderId: "22222222-2222-4222-8222-222222222222",
      invoicePayload: PRE_CHECKOUT_UPDATE.pre_checkout_query.invoice_payload,
      reasonCode: null,
      errorMessage: null,
      paymentOrderStatus: "precheckout_checked",
    });
    processTelegramSuccessfulPaymentUpdateMock.mockResolvedValue({
      eventType: "successful_payment",
      paymentRecorded: true,
      idempotent: false,
      duplicateUpdate: false,
      duplicateCharge: false,
      eventId: "55555555-5555-4555-8555-555555555555",
      starOrderId: "33333333-3333-4333-8333-333333333333",
      starPaymentId: "77777777-7777-4777-8777-777777777777",
      drawOrderId: "22222222-2222-4222-8222-222222222222",
      invoicePayload:
        SUCCESSFUL_PAYMENT_UPDATE.message.successful_payment.invoice_payload,
      telegramPaymentChargeId:
        SUCCESSFUL_PAYMENT_UPDATE.message.successful_payment
          .telegram_payment_charge_id,
      reasonCode: null,
      errorMessage: null,
      paymentOrderStatus: "fulfilled",
      processStatus: "processed",
      paidAt: "2026-05-28T05:06:20.000Z",
      fulfillmentAttempted: true,
      fulfillment: {
        fulfilled: true,
        idempotent: false,
        status: "completed",
        starOrderId: "33333333-3333-4333-8333-333333333333",
        drawOrderId: "22222222-2222-4222-8222-222222222222",
        drawCount: 1,
        quantity: 1,
        resultCount: 1,
        reasonCode: null,
        errorMessage: null,
        paymentOrderStatus: "fulfilled",
        retryable: false,
      },
    });
  });

  it("rejects requests with an invalid webhook secret before processing", async () => {
    const { default: webhookHandler } =
      await import("../../api/telegram/webhook");
    const result = await invokeApiHandler<ApiErrorResponse>(webhookHandler, {
      method: "POST",
      url: "/api/telegram/webhook",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong-secret",
      },
      body: PRE_CHECKOUT_UPDATE,
    });

    expect(result.statusCode).toBe(403);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "TELEGRAM_WEBHOOK_SECRET_INVALID",
      },
    });
    expect(processTelegramPreCheckoutUpdateMock).not.toHaveBeenCalled();
  });

  it("processes pre_checkout_query updates after secret verification", async () => {
    const { default: webhookHandler } =
      await import("../../api/telegram/webhook");
    const result = await invokeApiHandler<ApiSuccessResponse>(webhookHandler, {
      method: "POST",
      url: "/api/telegram/webhook",
      headers: {
        "content-type": "application/json",
        "user-agent": "TelegramBotWebhookTest/1.0",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: PRE_CHECKOUT_UPDATE,
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        handled: true,
        event_type: "pre_checkout_query",
        allowed: true,
        answered: true,
        idempotent: false,
        event_id: "44444444-4444-4444-8444-444444444444",
        payment_order_status: "precheckout_checked",
      },
    });
    expect(processTelegramPreCheckoutUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: PRE_CHECKOUT_UPDATE,
        requestId: expect.any(String),
        requestHeadersHash: expect.any(String),
        webhookSecretVerified: true,
      }),
    );
  });

  it("records successful_payment updates after secret verification", async () => {
    const { default: webhookHandler } =
      await import("../../api/telegram/webhook");
    const result = await invokeApiHandler<ApiSuccessResponse>(webhookHandler, {
      method: "POST",
      url: "/api/telegram/webhook",
      headers: {
        "content-type": "application/json",
        "user-agent": "TelegramBotWebhookTest/1.0",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: SUCCESSFUL_PAYMENT_UPDATE,
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        handled: true,
        event_type: "successful_payment",
        payment_recorded: true,
        idempotent: false,
        duplicate_update: false,
        duplicate_charge: false,
        event_id: "55555555-5555-4555-8555-555555555555",
        star_payment_id: "77777777-7777-4777-8777-777777777777",
        payment_order_status: "fulfilled",
        process_status: "processed",
        fulfillment_attempted: true,
        fulfillment_status: "completed",
        fulfillment_idempotent: false,
        fulfillment_reason_code: null,
        fulfillment_retryable: false,
      },
    });
    expect(processTelegramSuccessfulPaymentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: SUCCESSFUL_PAYMENT_UPDATE,
        requestId: expect.any(String),
        requestHeadersHash: expect.any(String),
        webhookSecretVerified: true,
      }),
    );
    expect(processTelegramPreCheckoutUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 200 for duplicate successful_payment charge webhooks without recording another payment", async () => {
    processTelegramSuccessfulPaymentUpdateMock.mockResolvedValueOnce({
      eventType: "successful_payment",
      paymentRecorded: false,
      idempotent: true,
      duplicateUpdate: false,
      duplicateCharge: true,
      eventId: "55555555-5555-4555-8555-555555555556",
      starOrderId: "33333333-3333-4333-8333-333333333333",
      starPaymentId: "77777777-7777-4777-8777-777777777777",
      drawOrderId: "22222222-2222-4222-8222-222222222222",
      invoicePayload:
        SUCCESSFUL_PAYMENT_UPDATE.message.successful_payment.invoice_payload,
      telegramPaymentChargeId:
        SUCCESSFUL_PAYMENT_UPDATE.message.successful_payment
          .telegram_payment_charge_id,
      reasonCode: null,
      errorMessage: null,
      paymentOrderStatus: "fulfilled",
      processStatus: "processed",
      paidAt: "2026-05-28T05:06:20.000Z",
      fulfillmentAttempted: true,
      fulfillment: {
        fulfilled: true,
        idempotent: true,
        status: "completed",
        starOrderId: "33333333-3333-4333-8333-333333333333",
        drawOrderId: "22222222-2222-4222-8222-222222222222",
        drawCount: 1,
        quantity: 1,
        resultCount: 1,
        reasonCode: null,
        errorMessage: null,
        paymentOrderStatus: "fulfilled",
        retryable: false,
      },
    });
    const { default: webhookHandler } =
      await import("../../api/telegram/webhook");
    const result = await invokeApiHandler<ApiSuccessResponse>(webhookHandler, {
      method: "POST",
      url: "/api/telegram/webhook",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: SUCCESSFUL_PAYMENT_UPDATE,
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        handled: true,
        event_type: "successful_payment",
        payment_recorded: false,
        idempotent: true,
        duplicate_update: false,
        duplicate_charge: true,
        star_payment_id: "77777777-7777-4777-8777-777777777777",
        payment_order_status: "fulfilled",
        process_status: "processed",
        fulfillment_attempted: true,
        fulfillment_status: "completed",
        fulfillment_idempotent: true,
        fulfillment_reason_code: null,
        fulfillment_retryable: false,
      },
    });
    expect(processTelegramSuccessfulPaymentUpdateMock).toHaveBeenCalledTimes(1);
    expect(processTelegramPreCheckoutUpdateMock).not.toHaveBeenCalled();
  });

  it("returns 200 with a failed process status for successful_payment amount mismatch", async () => {
    processTelegramSuccessfulPaymentUpdateMock.mockResolvedValueOnce({
      eventType: "successful_payment",
      paymentRecorded: false,
      idempotent: false,
      duplicateUpdate: false,
      duplicateCharge: false,
      eventId: "55555555-5555-4555-8555-555555555557",
      starOrderId: "33333333-3333-4333-8333-333333333333",
      starPaymentId: null,
      drawOrderId: "22222222-2222-4222-8222-222222222222",
      invoicePayload:
        SUCCESSFUL_PAYMENT_UPDATE.message.successful_payment.invoice_payload,
      telegramPaymentChargeId:
        SUCCESSFUL_PAYMENT_UPDATE.message.successful_payment
          .telegram_payment_charge_id,
      reasonCode: "AMOUNT_MISMATCH",
      errorMessage: "Stars 支付金额不一致。",
      paymentOrderStatus: "failed",
      processStatus: "failed",
      paidAt: null,
      fulfillmentAttempted: false,
      fulfillment: null,
    });
    const { default: webhookHandler } =
      await import("../../api/telegram/webhook");
    const result = await invokeApiHandler<ApiSuccessResponse>(webhookHandler, {
      method: "POST",
      url: "/api/telegram/webhook",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: {
        ...SUCCESSFUL_PAYMENT_UPDATE,
        message: {
          ...SUCCESSFUL_PAYMENT_UPDATE.message,
          successful_payment: {
            ...SUCCESSFUL_PAYMENT_UPDATE.message.successful_payment,
            total_amount:
              SUCCESSFUL_PAYMENT_UPDATE.message.successful_payment
                .total_amount + 1,
          },
        },
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        handled: true,
        event_type: "successful_payment",
        payment_recorded: false,
        duplicate_charge: false,
        reason_code: "AMOUNT_MISMATCH",
        payment_order_status: "failed",
        process_status: "failed",
        fulfillment_attempted: false,
        fulfillment_status: null,
      },
    });
    expect(processTelegramSuccessfulPaymentUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          message: expect.objectContaining({
            successful_payment: expect.objectContaining({
              total_amount: 91,
            }),
          }),
        }),
      }),
    );
    expect(processTelegramPreCheckoutUpdateMock).not.toHaveBeenCalled();
  });

  it("ignores unsupported update types without calling pre_checkout processing", async () => {
    const { default: webhookHandler } =
      await import("../../api/telegram/webhook");
    const result = await invokeApiHandler<ApiSuccessResponse>(webhookHandler, {
      method: "POST",
      url: "/api/telegram/webhook",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: {
        update_id: 95050002,
        message: {
          message_id: 1,
        },
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        handled: false,
        event_type: "unsupported_update",
      },
    });
    expect(processTelegramPreCheckoutUpdateMock).not.toHaveBeenCalled();
    expect(processTelegramSuccessfulPaymentUpdateMock).not.toHaveBeenCalled();
  });
});
