import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import createVipOrderHandler from "../../api/vip/create-order";
import {
  buildCreateVipOrderResponse,
  normalizeCreateVipOrderInput,
} from "../../api/vip/create-order";
import statusHandler, { normalizeVipStatusPayload } from "../../api/vip/status";
import { invokeApiHandler } from "./_utils";

const {
  assertStarsPaymentCreateAllowedMock,
  assertUserRiskAllowedMock,
  callRpcRawMock,
  createTelegramStarsInvoiceMock,
  requireSessionMock,
} = vi.hoisted(() => ({
  assertStarsPaymentCreateAllowedMock: vi.fn(),
  assertUserRiskAllowedMock: vi.fn(),
  callRpcRawMock: vi.fn(),
  createTelegramStarsInvoiceMock: vi.fn(),
  requireSessionMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
  RpcError: class RpcError extends Error {
    public readonly rpcName: string;
    public readonly details: string | null | undefined;
    public readonly hint: string | null | undefined;
    public readonly code: string | null | undefined;

    constructor(params: {
      rpcName: string;
      error?: {
        message?: string;
        details?: string | null;
        hint?: string | null;
        code?: string | null;
      };
    }) {
      super(params.error?.message ?? "RPC error");
      this.name = "RpcError";
      this.rpcName = params.rpcName;
      this.details = params.error?.details;
      this.hint = params.error?.hint;
      this.code = params.error?.code;
    }
  },
}));

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("../../packages/server/src/payments/paymentGuards.js", () => ({
  assertStarsPaymentCreateAllowed: assertStarsPaymentCreateAllowedMock,
}));

vi.mock("../../packages/server/src/payments/telegramStars.js", () => ({
  createTelegramStarsInvoice: createTelegramStarsInvoiceMock,
}));

vi.mock("../../api/_shared/riskGuards.js", () => ({
  assertUserRiskAllowed: assertUserRiskAllowedMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FORGED_USER_ID = "99999999-9999-4999-8999-999999999999";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const VIP_ORDER_ID = "33333333-3333-4333-8333-333333333333";
const STAR_ORDER_ID = "44444444-4444-4444-8444-444444444444";
const SUBSCRIPTION_ID = "55555555-5555-4555-8555-555555555555";
const IDEMPOTENCY_KEY = "vip:create-order:test-0001";
const INVOICE_PAYLOAD =
  "vip_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const INVOICE_LINK = "https://t.me/invoice/vip-test";

describe("vip API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    assertStarsPaymentCreateAllowedMock.mockReset();
    assertStarsPaymentCreateAllowedMock.mockResolvedValue(undefined);
    assertUserRiskAllowedMock.mockReset();
    assertUserRiskAllowedMock.mockResolvedValue(undefined);
    createTelegramStarsInvoiceMock.mockReset();
    createTelegramStarsInvoiceMock.mockResolvedValue({
      starOrderId: STAR_ORDER_ID,
      payload: INVOICE_PAYLOAD,
      invoiceLink: INVOICE_LINK,
      openMode: "web_app_open_invoice",
      botApiMethod: "createInvoiceLink",
      expiresAt: "2026-06-05T10:15:00.000Z",
      invoiceStatus: "created",
      paymentOrderStatus: "created",
      reused: false,
    });
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-vip-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-06-06T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("normalizes create-order input from snake_case and header idempotency", () => {
    expect(
      normalizeCreateVipOrderInput(
        {
          plan_id: PLAN_ID,
          expected_price_xtr: "199",
        },
        IDEMPOTENCY_KEY,
      ),
    ).toEqual({
      planId: PLAN_ID,
      expectedPriceXtr: "199",
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("normalizes VIP status for existing frontend readers", () => {
    expect(
      normalizeVipStatusPayload({
        is_vip: true,
        subscription_id: SUBSCRIPTION_ID,
        current_period_end: "2026-07-05T00:00:00.000Z",
        today: {
          claimed: true,
        },
        plan: {
          id: PLAN_ID,
          code: "vip_monthly",
          display_name: "VIP 月卡",
          price_xtr: "199",
          daily_fgems: "100",
          daily_free_box_count: 1,
          fee_rebate_bps: 2000,
        },
        server_time: "2026-06-05T00:00:00.000Z",
      }),
    ).toMatchObject({
      is_vip: true,
      isVip: true,
      subscription_id: SUBSCRIPTION_ID,
      subscriptionId: SUBSCRIPTION_ID,
      current_period_end: "2026-07-05T00:00:00.000Z",
      currentPeriodEnd: "2026-07-05T00:00:00.000Z",
      today_claimed: true,
      todayClaimed: true,
      plan: {
        id: PLAN_ID,
        code: "vip_monthly",
        display_name: "VIP 月卡",
        displayName: "VIP 月卡",
        price_xtr: 199,
        priceXtr: 199,
      },
      server_time: "2026-06-05T00:00:00.000Z",
      serverTime: "2026-06-05T00:00:00.000Z",
    });
  });

  it("/api/vip/status reads status through the session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      is_vip: false,
      subscription_id: null,
      current_period_end: null,
      today: {
        claimed: false,
      },
      plan: {
        id: PLAN_ID,
        code: "vip_monthly",
        display_name: "VIP 月卡",
        price_xtr: 199,
        daily_fgems: 100,
        daily_free_box_count: 1,
        fee_rebate_bps: 2000,
      },
      server_time: "2026-06-05T00:00:00.000Z",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(statusHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-vip-status",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "vip_get_status",
      {
        p_user_id: USER_ID,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-vip-status",
          userId: USER_ID,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      isVip: false,
      todayClaimed: false,
      plan: {
        id: PLAN_ID,
        priceXtr: 199,
      },
    });
  });

  it("/api/vip/create-order rejects forged user fields before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      createVipOrderHandler,
      {
        method: "POST",
        body: {
          plan_id: PLAN_ID,
          expected_price_xtr: 199,
          idempotency_key: IDEMPOTENCY_KEY,
          user_id: FORGED_USER_ID,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("/api/vip/create-order creates a VIP Stars invoice with the session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      vip_order_id: VIP_ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: INVOICE_PAYLOAD,
      xtr_amount: 199,
      status: "created",
      payment_order_status: "created",
      expires_at: "2026-06-05T10:15:00.000Z",
      idempotent: false,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(createVipOrderHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-vip-create-order",
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        plan_id: PLAN_ID,
        expected_price_xtr: 199,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(assertStarsPaymentCreateAllowedMock).toHaveBeenCalledOnce();
    expect(assertUserRiskAllowedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "vip.create_order",
        idempotencyKey: IDEMPOTENCY_KEY,
        metadata: {
          planId: PLAN_ID,
          expectedPriceXtr: 199,
        },
      }),
    );
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "vip_create_order_checked",
      {
        p_user_id: USER_ID,
        p_plan_id: PLAN_ID,
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_expected_price_xtr: 199,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-vip-create-order",
          userId: USER_ID,
          planId: PLAN_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      }),
    );
    expect(createTelegramStarsInvoiceMock).toHaveBeenCalledWith({
      starOrderId: STAR_ORDER_ID,
      drawOrderId: VIP_ORDER_ID,
      businessType: "vip_monthly",
      userId: USER_ID,
      invoicePayload: INVOICE_PAYLOAD,
      xtrAmount: 199,
      requestId: "req-vip-create-order",
    });
    expect(result.body.data).toMatchObject({
      order_id: VIP_ORDER_ID,
      vip_order_id: VIP_ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: INVOICE_PAYLOAD,
      invoice_link: INVOICE_LINK,
      invoice_open_mode: "web_app_open_invoice",
      xtr_amount: 199,
      payment_order_status: "created",
      idempotent: false,
    });
  });

  it("/api/vip/create-order returns 401 before RPC without a session", async () => {
    requireSessionMock.mockRejectedValueOnce(
      ApiError.authSessionExpired("登录状态缺失，请重新进入应用。"),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      createVipOrderHandler,
      {
        method: "POST",
        body: {
          plan_id: PLAN_ID,
          expected_price_xtr: 199,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe("AUTH_SESSION_EXPIRED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("builds create-order responses with reused invoice idempotency", () => {
    expect(
      buildCreateVipOrderResponse(
        {
          vip_order_id: VIP_ORDER_ID,
          star_order_id: STAR_ORDER_ID,
          invoice_payload: INVOICE_PAYLOAD,
          xtr_amount: "199",
          status: "created",
          payment_order_status: "created",
          expires_at: "2026-06-05T10:15:00.000Z",
          idempotent: true,
        },
        {
          starOrderId: STAR_ORDER_ID,
          payload: INVOICE_PAYLOAD,
          invoiceLink: INVOICE_LINK,
          openMode: "web_app_open_invoice",
          botApiMethod: "createInvoiceLink",
          expiresAt: "2026-06-05T10:15:00.000Z",
          invoiceStatus: "created",
          paymentOrderStatus: "created",
          reused: true,
        },
      ),
    ).toMatchObject({
      order_id: VIP_ORDER_ID,
      xtr_amount: 199,
      invoice_link: INVOICE_LINK,
      idempotent: true,
    });
  });
});
