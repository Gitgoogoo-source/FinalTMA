import { beforeEach, describe, expect, it, vi } from "vitest";

import { API_ENDPOINTS } from "@/api/endpoints";

import {
  claimVipDailyBenefit,
  claimVipFreeBox,
  normalizeClaimVipDailyBenefitResponse,
  normalizeClaimVipFreeBoxResponse,
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
        today: {
          business_date_utc: "2026-06-05",
          claimed: false,
          can_claim: true,
          fgems_amount: "100",
          fgems_claimed: false,
          can_claim_fgems: true,
          free_box_count: 1,
          free_box_used_count: 0,
          remaining_free_box_count: 0,
          free_box_claimed: false,
          can_claim_free_box: true,
          free_box_available: false,
        },
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
      today: {
        businessDateUtc: "2026-06-05",
        canClaim: true,
        canClaimFgems: true,
        canClaimFreeBox: true,
        claimId: null,
        claimed: false,
        fgemsAmount: 100,
        fgemsClaimed: false,
        fgemsClaimedAt: null,
        freeBoxAvailable: false,
        freeBoxClaimed: false,
        freeBoxClaimedAt: null,
        freeBoxCount: 1,
        freeBoxUsedCount: 0,
        remainingFreeBoxCount: 0,
      },
      todayClaimed: false,
    });
  });

  it("normalizes split daily FGEMS claim responses without free-box auto availability", () => {
    expect(
      normalizeClaimVipDailyBenefitResponse({
        claim_id: "claim-1",
        subscription_id: "sub-1",
        claim_date: "2026-06-05",
        fgems_amount: "100",
        fgems_ledger_id: "ledger-1",
        fgems_claimed: true,
        fgems_claimed_at: "2026-06-05T00:01:00.000Z",
        free_box_count: 1,
        free_box_used_count: 0,
        remaining_free_box_count: 1,
        free_box_claimed: false,
        free_box_available: false,
      }),
    ).toEqual({
      alreadyClaimed: false,
      claimDate: "2026-06-05",
      claimId: "claim-1",
      fgemsAmount: 100,
      fgemsClaimed: true,
      fgemsClaimedAt: "2026-06-05T00:01:00.000Z",
      fgemsLedgerId: "ledger-1",
      freeBoxAvailable: false,
      freeBoxClaimed: false,
      freeBoxClaimedAt: null,
      freeBoxCount: 1,
      freeBoxUsedCount: 0,
      idempotent: false,
      remainingFreeBoxCount: 1,
      subscriptionId: "sub-1",
    });
  });

  it("normalizes split free-box claim responses", () => {
    expect(
      normalizeClaimVipFreeBoxResponse({
        claim_id: "claim-2",
        subscription_id: "sub-1",
        claim_date: "2026-06-05",
        free_box_count: 1,
        free_box_used_count: 0,
        remaining_free_box_count: 1,
        free_box_available: true,
        free_box_claimed: true,
        free_box_claimed_at: "2026-06-05T00:02:00.000Z",
        fgems_claimed: false,
      }),
    ).toEqual({
      alreadyClaimed: false,
      claimDate: "2026-06-05",
      claimId: "claim-2",
      fgemsClaimed: false,
      freeBoxAvailable: true,
      freeBoxClaimed: true,
      freeBoxClaimedAt: "2026-06-05T00:02:00.000Z",
      freeBoxCount: 1,
      freeBoxUsedCount: 0,
      idempotent: false,
      remainingFreeBoxCount: 1,
      subscriptionId: "sub-1",
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

  it("claims daily FGEMS through the split endpoint", async () => {
    mocks.apiRequest.mockResolvedValue({
      claim_id: "claim-1",
      fgems_amount: 100,
      fgems_ledger_id: "ledger-1",
      free_box_count: 0,
      free_box_used_count: 0,
      free_box_available: false,
    });

    await expect(
      claimVipDailyBenefit({
        idempotencyKey: "vip:claim-daily:test-0001",
      }),
    ).resolves.toMatchObject({
      claimId: "claim-1",
      fgemsAmount: 100,
      freeBoxAvailable: false,
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      API_ENDPOINTS.vip.claimDaily,
      expect.objectContaining({
        method: "POST",
        body: {
          idempotency_key: "vip:claim-daily:test-0001",
        },
        headers: {
          "X-Idempotency-Key": "vip:claim-daily:test-0001",
        },
      }),
    );
  });

  it("claims the daily free box through its own endpoint", async () => {
    mocks.apiRequest.mockResolvedValue({
      claim_id: "claim-2",
      free_box_count: 1,
      free_box_used_count: 0,
      free_box_available: true,
      free_box_claimed: true,
    });

    await expect(
      claimVipFreeBox({
        idempotencyKey: "vip:claim-free-box:test-0001",
      }),
    ).resolves.toMatchObject({
      claimId: "claim-2",
      freeBoxAvailable: true,
      freeBoxClaimed: true,
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      API_ENDPOINTS.vip.claimFreeBox,
      expect.objectContaining({
        method: "POST",
        body: {
          idempotency_key: "vip:claim-free-box:test-0001",
        },
        headers: {
          "X-Idempotency-Key": "vip:claim-free-box:test-0001",
        },
      }),
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
