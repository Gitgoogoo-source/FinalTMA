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

  it("normalizes K-coin result-ready fields from createOpenOrder", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      dev_payment_processed: false,
      draw_count: 10,
      expires_at: null,
      idempotent: true,
      invoice_link: null,
      invoice_open_mode: null,
      invoice_payload: null,
      order_id: "11111111-1111-4111-8111-111111111111",
      order_status: "completed",
      paid_kcoin: 90,
      payment_order_status: "fulfilled",
      payment_status: "fulfilled",
      result_ready: true,
      star_order_id: null,
      total_price_kcoin: 90,
      xtr_amount: 0,
    });

    const { createOpenOrder } = await import("./box.api");
    const order = await createOpenOrder({
      boxSlug: "legendary_egg",
      drawCount: 10,
    });

    const requestBody = mocks.apiRequest.mock.calls[0]?.[1]?.body as Record<
      string,
      unknown
    >;
    expect(requestBody).toEqual({
      box_slug: "legendary_egg",
      draw_count: 10,
    });
    expect(requestBody).not.toHaveProperty("box_id");
    expect(requestBody).not.toHaveProperty("expected_price_stars");
    expect(requestBody).not.toHaveProperty("expected_pool_version_id");
    expect(order).toMatchObject({
      devPaymentProcessed: false,
      drawCount: 10,
      expiresAt: null,
      idempotent: true,
      invoiceLink: null,
      invoiceOpenMode: null,
      invoicePayload: null,
      orderId: "11111111-1111-4111-8111-111111111111",
      paidKcoin: 90,
      paymentOrderStatus: "fulfilled",
      paymentStatus: "fulfilled",
      resultReady: true,
      starOrderId: null,
      totalPriceKcoin: 90,
      xtrAmount: 0,
    });
  });

  it("creates a K-coin topup order through the payment endpoint", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      expires_at: "2026-06-05T00:15:00.000Z",
      idempotent: false,
      invoice_link: "https://t.me/invoice/kcoin-topup",
      invoice_open_mode: "web_app_open_invoice",
      invoice_payload: "kcoin_topup:test-payload",
      kcoin_amount: 500,
      order_id: "33333333-3333-4333-8333-333333333333",
      order_status: "invoice_created",
      payment_order_status: "invoice_created",
      payment_status: "invoice_created",
      star_order_id: "22222222-2222-4222-8222-222222222222",
      topup_order_id: "33333333-3333-4333-8333-333333333333",
      xtr_amount: 500,
    });

    const { createKcoinTopupOrder } = await import("./box.api");
    const order = await createKcoinTopupOrder({
      amount: 500,
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/payments/kcoin-topup/create-order",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          amount: 500,
        }),
        headers: expect.objectContaining({
          "X-Idempotency-Key": expect.stringMatching(/^kcoin:topup:500:/),
        }),
      }),
    );
    expect(order).toMatchObject({
      invoiceLink: "https://t.me/invoice/kcoin-topup",
      invoiceOpenMode: "web_app_open_invoice",
      invoicePayload: "kcoin_topup:test-payload",
      kcoinAmount: 500,
      orderId: "33333333-3333-4333-8333-333333333333",
      paymentOrderStatus: "invoice_created",
      topupOrderId: "33333333-3333-4333-8333-333333333333",
      xtrAmount: 500,
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
      boxSlug: "starter_egg",
      drawCount: 1,
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

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/boxes/result?orderId=11111111-1111-4111-8111-111111111111&includeItems=true",
      {
        method: "GET",
      },
    );
    expect(result).toMatchObject({
      orderStatus: "failed",
      paidAt: "2026-05-28T00:01:00.000Z",
      paymentOrderStatus: "failed",
      paymentStatus: "fulfillment_failed_retrying",
      status: "pending",
    });
  });

  it("queries payment status without requesting result items", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      order_id: "11111111-1111-4111-8111-111111111111",
      payment_order_status: "invoice_created",
      result_ready: false,
      draw_order: {
        draw_count: 10,
        id: "11111111-1111-4111-8111-111111111111",
        paid_at: null,
        quantity: 10,
        returned_kcoin: 1000,
        status: "invoice_created",
        total_price_stars: 90,
      },
      payment: {
        paid_at: null,
        status: "invoice_created",
        xtr_amount: 90,
      },
      status: "pending",
    });

    const { fetchPaymentStatus } = await import("./box.api");
    const result = await fetchPaymentStatus(
      "11111111-1111-4111-8111-111111111111",
    );

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/boxes/payment-status?orderId=11111111-1111-4111-8111-111111111111",
      {
        method: "GET",
      },
    );
    expect(result).toMatchObject({
      orderId: "11111111-1111-4111-8111-111111111111",
      orderStatus: "invoice_created",
      paidStars: 90,
      paidKcoin: 0,
      paymentStatus: "invoice_created",
      quantity: 10,
      returnedKcoin: 0,
      status: "pending",
    });
    expect(result.results).toEqual([]);
  });

  it("normalizes configured payment support contacts", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      configured: true,
      support_url: "https://t.me/tma_support",
      support_email: "pay@example.test",
      server_time: "2026-05-31T09:00:00.000Z",
    });

    const { fetchPaymentSupportConfig } = await import("./box.api");
    const result = await fetchPaymentSupportConfig();

    expect(mocks.apiRequest).toHaveBeenCalledWith("/telegram/payment-support", {
      method: "GET",
    });
    expect(result).toEqual({
      configured: true,
      supportEmail: "pay@example.test",
      supportUrl: "https://t.me/tma_support",
      serverTime: "2026-05-31T09:00:00.000Z",
    });
  });

  it("does not expose partial payment support contacts when config is disabled", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      configured: false,
      support_url: "https://t.me/tma_support",
      support_email: "pay@example.test",
    });

    const { fetchPaymentSupportConfig } = await import("./box.api");
    const result = await fetchPaymentSupportConfig();

    expect(result).toMatchObject({
      configured: false,
      supportEmail: null,
      supportUrl: null,
    });
  });
});
