import { afterEach, describe, expect, it, vi } from "vitest";

import type { TelegramGlobal, TelegramWebApp } from "@/types/telegram";

import type { CreateOpenOrderResponse } from "../box.types";
import {
  normalizeTelegramInvoiceStatus,
  openTelegramStarsInvoice,
} from "./useStarsPayment";

describe("useStarsPayment helpers", () => {
  afterEach(() => {
    delete (globalThis as TelegramGlobal).Telegram;
  });

  it("opens a Telegram invoice link with WebApp.openInvoice", () => {
    const onStatus = vi.fn();
    const openInvoice = vi.fn(
      (_url: string, callback?: (status: string) => void) => {
        callback?.("paid");
      },
    );

    const attempt = openTelegramStarsInvoice(createOrder(), {
      webApp: {
        openInvoice,
      } as TelegramWebApp,
      onStatus,
    });

    expect(attempt).toEqual({
      ok: true,
      status: "opening",
    });
    expect(openInvoice).toHaveBeenCalledWith(
      "https://t.me/invoice/test-open-order",
      expect.any(Function),
    );
    expect(onStatus).toHaveBeenCalledWith({
      status: "paid",
      rawStatus: "paid",
    });
  });

  it("does not fall back to a generic link opener when openInvoice is unavailable", () => {
    const attempt = openTelegramStarsInvoice(createOrder(), {
      webApp: {
        openLink: vi.fn(),
      } as TelegramWebApp,
    });

    expect(attempt).toMatchObject({
      ok: false,
      status: "not_opened",
      reason: "unsupported",
    });
  });

  it("returns a retryable not-opened state when invoice opening throws", () => {
    const attempt = openTelegramStarsInvoice(createOrder(), {
      webApp: {
        openInvoice: vi.fn(() => {
          throw new Error("Telegram rejected invoice link");
        }),
      } as TelegramWebApp,
    });

    expect(attempt).toMatchObject({
      ok: false,
      status: "not_opened",
      reason: "open_failed",
      message: "支付未打开，可重试支付。",
    });
  });

  it("normalizes unknown invoice callback statuses without treating them as paid", () => {
    expect(normalizeTelegramInvoiceStatus("weird_status")).toEqual({
      status: "unknown",
      rawStatus: "weird_status",
    });
  });
});

function createOrder(
  overrides: Partial<CreateOpenOrderResponse> = {},
): CreateOpenOrderResponse {
  return {
    devPaymentProcessed: false,
    drawCount: 1,
    expiresAt: "2026-05-28T00:15:00.000Z",
    idempotent: false,
    invoiceLink: "https://t.me/invoice/test-open-order",
    invoiceOpenMode: "web_app_open_invoice",
    invoicePayload: "invoice-payload",
    orderId: "11111111-1111-4111-8111-111111111111",
    orderStatus: "created",
    paymentOrderStatus: "invoice_created",
    paymentStatus: "invoice_created",
    resultReady: false,
    starOrderId: "22222222-2222-4222-8222-222222222222",
    xtrAmount: 100,
    ...overrides,
  };
}
