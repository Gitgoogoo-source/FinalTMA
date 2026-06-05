import { beforeEach, describe, expect, it, vi } from "vitest";

import { API_ENDPOINTS } from "@/api/endpoints";

import {
  claimVipDailyBenefit,
  claimVipFreeBox,
  createVipOrder,
  normalizeClaimVipDailyBenefitResponse,
  normalizeClaimVipFreeBoxResponse,
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

  it("normalizes split VIP today status fields", () => {
    expect(
      normalizeVipStatus({
        is_vip: true,
        subscription_id: "sub-1",
        today: {
          business_date_utc: "2026-06-05",
          claim_id: "claim-1",
          claimed: true,
          can_claim: false,
          fgems_amount: 100,
          fgems_claimed: true,
          fgems_claimed_at: "2026-06-05T00:01:00.000Z",
          can_claim_fgems: false,
          free_box_count: 1,
          free_box_used_count: 0,
          remaining_free_box_count: 1,
          free_box_available: true,
          free_box_claimed: true,
          free_box_claimed_at: "2026-06-05T00:02:00.000Z",
          can_claim_free_box: false,
        },
      }),
    ).toMatchObject({
      isVip: true,
      subscriptionId: "sub-1",
      today: {
        businessDateUtc: "2026-06-05",
        canClaim: false,
        canClaimFgems: false,
        canClaimFreeBox: false,
        claimId: "claim-1",
        claimed: true,
        fgemsAmount: 100,
        fgemsClaimed: true,
        fgemsClaimedAt: "2026-06-05T00:01:00.000Z",
        freeBoxAvailable: true,
        freeBoxClaimed: true,
        freeBoxClaimedAt: "2026-06-05T00:02:00.000Z",
        freeBoxCount: 1,
        freeBoxUsedCount: 0,
        remainingFreeBoxCount: 1,
      },
      todayClaimed: true,
    });
  });

  it("claims the daily FGEMS benefit through the FGEMS endpoint", async () => {
    mocks.apiRequest.mockResolvedValue({
      claim_id: "claim-1",
      fgems_amount: 100,
      fgems_claimed: true,
      free_box_available: false,
      free_box_claimed: false,
      free_box_count: 1,
      free_box_used_count: 0,
      remaining_free_box_count: 0,
      idempotent: false,
    });

    await expect(
      claimVipDailyBenefit({
        idempotencyKey: "vip:claim-daily:test",
      }),
    ).resolves.toMatchObject({
      claimId: "claim-1",
      fgemsAmount: 100,
      fgemsClaimed: true,
      freeBoxAvailable: false,
      freeBoxClaimed: false,
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      API_ENDPOINTS.vip.claimDaily,
      expect.objectContaining({
        method: "POST",
        body: {
          idempotency_key: "vip:claim-daily:test",
        },
        headers: {
          "X-Idempotency-Key": "vip:claim-daily:test",
        },
      }),
    );
  });

  it("claims the free box through the separate free-box endpoint", async () => {
    mocks.apiRequest.mockResolvedValue({
      claim_id: "claim-2",
      free_box_available: true,
      free_box_claimed: true,
      free_box_claimed_at: "2026-06-05T00:02:00.000Z",
      free_box_count: 1,
      free_box_used_count: 0,
      remaining_free_box_count: 1,
      fgems_claimed: false,
      idempotent: false,
    });

    await expect(
      claimVipFreeBox({
        idempotencyKey: "vip:claim-free-box:test",
      }),
    ).resolves.toMatchObject({
      claimId: "claim-2",
      fgemsClaimed: false,
      freeBoxAvailable: true,
      freeBoxClaimed: true,
      freeBoxClaimedAt: "2026-06-05T00:02:00.000Z",
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      API_ENDPOINTS.vip.claimFreeBox,
      expect.objectContaining({
        method: "POST",
        body: {
          idempotency_key: "vip:claim-free-box:test",
        },
        headers: {
          "X-Idempotency-Key": "vip:claim-free-box:test",
        },
      }),
    );
  });

  it("keeps normalized FGEMS and free-box claim responses separate", () => {
    expect(
      normalizeClaimVipDailyBenefitResponse({
        claim_id: "claim-fgems",
        fgems_amount: 100,
        fgems_claimed: true,
        free_box_claimed: false,
        remaining_free_box_count: 1,
      }),
    ).toMatchObject({
      claimId: "claim-fgems",
      fgemsClaimed: true,
      freeBoxAvailable: false,
      freeBoxClaimed: false,
    });

    expect(
      normalizeClaimVipFreeBoxResponse({
        claim_id: "claim-free-box",
        fgems_claimed: false,
        free_box_claimed: true,
        remaining_free_box_count: 1,
      }),
    ).toMatchObject({
      claimId: "claim-free-box",
      fgemsClaimed: false,
      freeBoxAvailable: true,
      freeBoxClaimed: true,
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
