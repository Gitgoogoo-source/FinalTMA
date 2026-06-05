import { beforeEach, describe, expect, it, vi } from "vitest";

import { API_ENDPOINTS } from "@/api/endpoints";

import {
  createVipOrder,
  normalizeCreateVipOrderResponse,
  normalizeVipStatus,
} from "./vip.api";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  apiRequest: mocks.apiRequest,
}));

describe("vip.api", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
  });

  it("normalizes VIP status from snake_case fields", () => {
    expect(
      normalizeVipStatus({
        is_vip: true,
        subscription_id: "sub-1",
        current_period_end: "2026-07-05T00:00:00.000Z",
        today_claimed: false,
        plan: {
          id: "plan-1",
          code: "vip_monthly",
          display_name: "VIP 月卡",
          price_xtr: 199,
          duration_days: 30,
          daily_fgems: "100",
          daily_free_box_count: 1,
          fee_rebate_bps: 2000,
        },
        server_time: "2026-06-05T00:00:00.000Z",
      }),
    ).toEqual({
      currentPeriodEnd: "2026-07-05T00:00:00.000Z",
      isVip: true,
      plan: {
        code: "vip_monthly",
        dailyFgems: 100,
        dailyFreeBoxCount: 1,
        displayName: "VIP 月卡",
        durationDays: 30,
        feeRebateBps: 2000,
        id: "plan-1",
        priceXtr: 199,
      },
      serverTime: "2026-06-05T00:00:00.000Z",
      subscriptionId: "sub-1",
      today: null,
      todayClaimed: false,
    });
  });

  it("creates a VIP order with plan id and idempotency key", async () => {
    mocks.apiRequest.mockResolvedValue({
      vip_order_id: "vip-order-1",
      star_order_id: "star-order-1",
      invoice_payload: "vip:payload",
      invoice_link: "https://t.me/invoice/vip-test",
      invoice_open_mode: "web_app_open_invoice",
      xtr_amount: 199,
      order_status: "invoice_created",
      payment_order_status: "invoice_created",
      expires_at: "2026-06-05T00:15:00.000Z",
      idempotent: false,
    });

    await expect(
      createVipOrder({
        planId: "plan-1",
        idempotencyKey: "vip:create-order:test",
      }),
    ).resolves.toEqual({
      expiresAt: "2026-06-05T00:15:00.000Z",
      fulfilledAt: null,
      idempotent: false,
      invoiceLink: "https://t.me/invoice/vip-test",
      invoiceOpenMode: "web_app_open_invoice",
      invoicePayload: "vip:payload",
      orderId: "vip-order-1",
      orderStatus: "invoice_created",
      paidAt: null,
      paymentOrderStatus: "invoice_created",
      paymentStatus: "invoice_created",
      starOrderId: "star-order-1",
      xtrAmount: 199,
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      API_ENDPOINTS.vip.createOrder,
      {
        method: "POST",
        body: {
          idempotency_key: "vip:create-order:test",
          plan_id: "plan-1",
        },
        headers: {
          "X-Idempotency-Key": "vip:create-order:test",
        },
      },
    );
  });

  it("normalizes VIP order response from camelCase fields", () => {
    expect(
      normalizeCreateVipOrderResponse({
        orderId: "vip-order-2",
        starOrderId: "star-order-2",
        invoicePayload: "vip:payload-2",
        invoiceLink: "https://t.me/invoice/vip-test-2",
        invoiceOpenMode: "web_app_open_invoice",
        xtrAmount: 299,
        orderStatus: "created",
        paymentStatus: "created",
        paymentOrderStatus: "created",
      }),
    ).toMatchObject({
      invoiceLink: "https://t.me/invoice/vip-test-2",
      orderId: "vip-order-2",
      paymentOrderStatus: "created",
      starOrderId: "star-order-2",
      xtrAmount: 299,
    });
  });
});
