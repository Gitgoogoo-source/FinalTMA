import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { processTelegramPreCheckoutUpdateMock } = vi.hoisted(() => ({
  processTelegramPreCheckoutUpdateMock: vi.fn(),
}));

vi.mock("../../packages/server/src/payments/telegramStars.js", () => ({
  hasTelegramPreCheckoutQuery: (update: unknown) =>
    typeof update === "object" &&
    update !== null &&
    "pre_checkout_query" in update,
  inferTelegramUpdateEventType: (update: unknown) =>
    typeof update === "object" &&
    update !== null &&
    "pre_checkout_query" in update
      ? "pre_checkout_query"
      : "unsupported_update",
  processTelegramPreCheckoutUpdate: processTelegramPreCheckoutUpdateMock,
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

describe("telegram webhook API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
    processTelegramPreCheckoutUpdateMock.mockReset();
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
  });
});
