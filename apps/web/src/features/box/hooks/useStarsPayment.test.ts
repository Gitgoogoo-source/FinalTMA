import { afterEach, describe, expect, it, vi } from "vitest";

import type { TelegramGlobal, TelegramWebApp } from "@/types/telegram";

import type { CreateOpenOrderResponse } from "../box.types";
import {
  PENDING_STARS_PAYMENT_STORAGE_KEY,
  clearPendingStarsPaymentOrder,
  normalizeTelegramInvoiceStatus,
  openTelegramStarsInvoice,
  readPendingStarsPaymentOrder,
  savePendingStarsPaymentOrder,
} from "./useStarsPayment";

describe("useStarsPayment helpers", () => {
  afterEach(() => {
    delete (globalThis as TelegramGlobal).Telegram;
    globalThis.localStorage?.removeItem(PENDING_STARS_PAYMENT_STORAGE_KEY);
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

  it("stores a minimal pending order restore hint when opening invoice", () => {
    const storage = createMemoryStorage();

    openTelegramStarsInvoice(createOrder(), {
      now: () => new Date("2026-05-28T00:01:00.000Z"),
      storage,
      webApp: {
        openInvoice: vi.fn(),
      } as TelegramWebApp,
    });

    const stored = JSON.parse(
      storage.getItem(PENDING_STARS_PAYMENT_STORAGE_KEY) ?? "{}",
    ) as Record<string, unknown>;

    expect(stored).toEqual({
      expiresAt: "2026-05-28T00:15:00.000Z",
      orderId: "11111111-1111-4111-8111-111111111111",
      savedAt: "2026-05-28T00:01:00.000Z",
    });
    expect(stored.invoiceLink).toBeUndefined();
    expect(stored.invoicePayload).toBeUndefined();
    expect(stored.starOrderId).toBeUndefined();
  });

  it("keeps invoice opening best effort when local storage throws", () => {
    const openInvoice = vi.fn();
    const storage = {
      getItem: vi.fn(),
      removeItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
    };

    const attempt = openTelegramStarsInvoice(createOrder(), {
      storage,
      webApp: {
        openInvoice,
      } as TelegramWebApp,
    });

    expect(attempt).toEqual({
      ok: true,
      status: "opening",
    });
    expect(openInvoice).toHaveBeenCalledOnce();
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

  it("reads and clears pending order restore hints", () => {
    const storage = createMemoryStorage();
    const order = createOrder();

    savePendingStarsPaymentOrder(order, {
      now: () => new Date("2026-05-28T00:01:00.000Z"),
      storage,
    });

    expect(
      readPendingStarsPaymentOrder({
        now: () => new Date("2026-05-28T00:02:00.000Z"),
        storage,
      }),
    ).toEqual({
      expiresAt: "2026-05-28T00:15:00.000Z",
      orderId: order.orderId,
      savedAt: "2026-05-28T00:01:00.000Z",
    });

    clearPendingStarsPaymentOrder("different-order", storage);
    expect(storage.getItem(PENDING_STARS_PAYMENT_STORAGE_KEY)).not.toBeNull();

    clearPendingStarsPaymentOrder(order.orderId, storage);
    expect(storage.getItem(PENDING_STARS_PAYMENT_STORAGE_KEY)).toBeNull();
  });

  it("drops expired pending order restore hints", () => {
    const storage = createMemoryStorage();

    savePendingStarsPaymentOrder(createOrder(), {
      now: () => new Date("2026-05-28T00:01:00.000Z"),
      storage,
    });

    expect(
      readPendingStarsPaymentOrder({
        now: () => new Date("2026-05-28T00:16:00.000Z"),
        storage,
      }),
    ).toBeNull();
    expect(storage.getItem(PENDING_STARS_PAYMENT_STORAGE_KEY)).toBeNull();
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
    paidKcoin: 0,
    paymentOrderStatus: "invoice_created",
    paymentStatus: "invoice_created",
    resultReady: false,
    starOrderId: "22222222-2222-4222-8222-222222222222",
    totalPriceKcoin: 0,
    xtrAmount: 100,
    ...overrides,
  };
}

function createMemoryStorage(): Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
> {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
