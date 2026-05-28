import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  apiRequest: mocks.apiRequest,
}));

describe("box api", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
  });

  it("keeps the fifth-stage Stars invoice fields from createOpenOrder", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      dev_payment_processed: false,
      draw_count: 10,
      expires_at: "2026-05-28T00:15:00.000Z",
      idempotent: true,
      invoice_link: "https://t.me/invoice/test-open-order",
      invoice_open_mode: "web_app_open_invoice",
      invoice_payload: "gacha:test-payload",
      order_id: "11111111-1111-4111-8111-111111111111",
      order_status: "invoice_created",
      payment_order_status: "invoice_created",
      payment_status: "invoice_created",
      result_ready: false,
      star_order_id: "22222222-2222-4222-8222-222222222222",
      xtr_amount: 90,
    });

    const { createOpenOrder } = await import("./box.api");
    const order = await createOpenOrder({
      boxId: "33333333-3333-4333-8333-333333333333",
      drawCount: 10,
      expectedPriceStars: 90,
      expectedPoolVersionId: "44444444-4444-4444-8444-444444444444",
    });

    expect(order).toMatchObject({
      devPaymentProcessed: false,
      drawCount: 10,
      expiresAt: "2026-05-28T00:15:00.000Z",
      idempotent: true,
      invoiceLink: "https://t.me/invoice/test-open-order",
      invoiceOpenMode: "web_app_open_invoice",
      invoicePayload: "gacha:test-payload",
      orderId: "11111111-1111-4111-8111-111111111111",
      paymentOrderStatus: "invoice_created",
      paymentStatus: "invoice_created",
      starOrderId: "22222222-2222-4222-8222-222222222222",
      xtrAmount: 90,
    });
  });

  it("normalizes legacy payment order status aliases from createOpenOrder", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      draw_count: 1,
      invoice_link: "https://t.me/invoice/test-open-order",
      order_id: "11111111-1111-4111-8111-111111111111",
      order_status: "invoice_created",
      payment_order_status: "precheckout_ok",
      payment_status: "precheckout_ok",
      star_order_id: "22222222-2222-4222-8222-222222222222",
      xtr_amount: 10,
    });

    const { createOpenOrder } = await import("./box.api");
    const order = await createOpenOrder({
      boxId: "33333333-3333-4333-8333-333333333333",
      drawCount: 1,
      expectedPriceStars: 10,
    });

    expect(order).toMatchObject({
      paymentOrderStatus: "precheckout_checked",
      paymentStatus: "precheckout_checked",
    });
  });

  it("normalizes paid failed fulfillment results into a retrying display status", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      draw_order_id: "11111111-1111-4111-8111-111111111111",
      draw_count: 1,
      order_status: "failed",
      paid_at: "2026-05-28T00:01:00.000Z",
      payment: {
        paid_at: "2026-05-28T00:01:00.000Z",
        status: "failed",
      },
      results: [],
      status: "failed",
      total_price_stars: 10,
    });

    const { fetchDrawResult } = await import("./box.api");
    const result = await fetchDrawResult(
      "11111111-1111-4111-8111-111111111111",
    );

    expect(result).toMatchObject({
      orderStatus: "failed",
      paidAt: "2026-05-28T00:01:00.000Z",
      paymentOrderStatus: "failed",
      paymentStatus: "fulfillment_failed_retrying",
      status: "pending",
    });
  });
});
