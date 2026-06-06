import { afterEach, describe, expect, it, vi } from "vitest";

import type { TelegramGlobal, TelegramWebApp } from "@/types/telegram";

import type { CreateVipOrderResponse } from "../vip.types";
import {
  normalizeVipInvoiceStatus,
  openVipStarsInvoice,
} from "./useVipStarsPayment";

describe("useVipStarsPayment helpers", () => {
  afterEach(() => {
    delete (globalThis as TelegramGlobal).Telegram;
  });

  it("opens a Telegram invoice link without storing box pending order state", () => {
    const onStatus = vi.fn();
    const openInvoice = vi.fn(
      (_url: string, callback?: (status: string) => void) => {
        callback?.("paid");
      },
    );

    expect(
      openVipStarsInvoice(createOrder(), {
        webApp: {
          openInvoice,
        } as TelegramWebApp,
        onStatus,
      }),
    ).toEqual({
      ok: true,
      status: "opening",
    });
    expect(openInvoice).toHaveBeenCalledWith(
      "https://t.me/invoice/vip-test",
      expect.any(Function),
    );
    expect(onStatus).toHaveBeenCalledWith({
      rawStatus: "paid",
      status: "paid",
    });
  });

  it("returns retryable not-opened state when Telegram openInvoice is unavailable", () => {
    expect(
      openVipStarsInvoice(createOrder(), {
        webApp: {} as TelegramWebApp,
      }),
    ).toMatchObject({
      ok: false,
      reason: "unsupported",
      status: "not_opened",
    });
  });

  it("normalizes unknown invoice callback statuses without treating them as paid", () => {
    expect(normalizeVipInvoiceStatus("unexpected")).toEqual({
      rawStatus: "unexpected",
      status: "unknown",
    });
  });
});

function createOrder(
  overrides: Partial<CreateVipOrderResponse> = {},
): CreateVipOrderResponse {
  return {
    currencyCode: "KCOIN",
    currentPeriodEnd: null,
    currentPeriodStart: null,
    expiresAt: "2026-06-05T00:15:00.000Z",
    fulfilledAt: null,
    idempotent: false,
    invoiceLink: "https://t.me/invoice/vip-test",
    invoiceOpenMode: "web_app_open_invoice",
    invoicePayload: "vip:payload",
    kcoinAmount: 0,
    kcoinLedgerId: null,
    orderId: "vip-order-1",
    orderStatus: "invoice_created",
    paidAt: null,
    paymentOrderStatus: "invoice_created",
    paymentStatus: "invoice_created",
    starOrderId: "star-order-1",
    subscriptionId: null,
    xtrAmount: 199,
    ...overrides,
  };
}
