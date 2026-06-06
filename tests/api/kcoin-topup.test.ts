import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import { RpcError } from "../../packages/server/src/db/rpc";
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

    constructor(params: { rpcName: string; error?: { message?: string } }) {
      super(params.error?.message ?? "RPC error");
      this.name = "RpcError";
      this.rpcName = params.rpcName;
    }
  },
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

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOPUP_ORDER_ID = "22222222-2222-4222-8222-222222222222";
const STAR_ORDER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_TOPUP_ORDER_ID = "99999999-9999-4999-8999-999999999999";
const INVOICE_PAYLOAD =
  "kcoin_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("K-coin topup APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    assertStarsPaymentCreateAllowedMock.mockReset();
    assertStarsPaymentCreateAllowedMock.mockResolvedValue(undefined);
    assertUserRiskAllowedMock.mockReset();
    assertUserRiskAllowedMock.mockResolvedValue(undefined);
    callRpcRawMock.mockReset();
    createTelegramStarsInvoiceMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-kcoin-topup-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-06-06T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("creates a fixed-package K-coin topup order and invoice for the session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      topup_order_id: TOPUP_ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: INVOICE_PAYLOAD,
      xtr_amount: 500,
      kcoin_amount: "500",
      status: "created",
      payment_order_status: "created",
      expires_at: "2026-06-05T12:15:00.000Z",
      idempotent: false,
    });
    createTelegramStarsInvoiceMock.mockResolvedValueOnce({
      starOrderId: STAR_ORDER_ID,
      payload: INVOICE_PAYLOAD,
      invoiceLink: "https://t.me/invoice/kcoin-topup-500",
      openMode: "web_app_open_invoice",
      botApiMethod: "createInvoiceLink",
      expiresAt: "2026-06-05T12:15:00.000Z",
      invoiceStatus: "created",
      paymentOrderStatus: "created",
      reused: false,
    });

    const { default: createOrderHandler } =
      await import("../../api/payments/kcoin-topup/create-order");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/payments/kcoin-topup/create-order",
        headers: {
          "x-idempotency-key": "kcoin:topup:test:0500",
        },
        body: {
          amount: 500,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        order_id: TOPUP_ORDER_ID,
        topup_order_id: TOPUP_ORDER_ID,
        star_order_id: STAR_ORDER_ID,
        invoice_link: "https://t.me/invoice/kcoin-topup-500",
        xtr_amount: 500,
        kcoin_amount: 500,
        payment_order_status: "created",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "kcoin_topup_create_order",
      {
        p_user_id: USER_ID,
        p_amount: 500,
        p_idempotency_key: "kcoin:topup:test:0500",
        p_intent: "MANUAL_TOPUP",
        p_box_slug: null,
        p_draw_count: null,
        p_required_kcoin: null,
      },
      expect.objectContaining({
        schema: "api",
      }),
    );
    expect(createTelegramStarsInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        businessType: "kcoin_topup",
        drawOrderId: TOPUP_ORDER_ID,
        starOrderId: STAR_ORDER_ID,
        userId: USER_ID,
        xtrAmount: 500,
      }),
    );
  });

  it("creates a shortage topup order with open-box context", async () => {
    vi.stubEnv("GACHA_STARTER_EGG_PRICE_STARS", "10");
    vi.stubEnv("GACHA_TEN_DRAW_DISCOUNT_RATE", "0.1");
    callRpcRawMock.mockResolvedValueOnce({
      topup_order_id: TOPUP_ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: INVOICE_PAYLOAD,
      xtr_amount: 9,
      kcoin_amount: "9",
      status: "created",
      payment_order_status: "created",
      expires_at: "2026-06-05T12:15:00.000Z",
      idempotent: false,
    });
    createTelegramStarsInvoiceMock.mockResolvedValueOnce({
      starOrderId: STAR_ORDER_ID,
      payload: INVOICE_PAYLOAD,
      invoiceLink: "https://t.me/invoice/kcoin-topup-9",
      openMode: "web_app_open_invoice",
      botApiMethod: "createInvoiceLink",
      expiresAt: "2026-06-05T12:15:00.000Z",
      invoiceStatus: "created",
      paymentOrderStatus: "created",
      reused: false,
    });

    const { default: createOrderHandler } =
      await import("../../api/payments/kcoin-topup/create-order");
    const result = await invokeApiHandler<ApiSuccessResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/payments/kcoin-topup/create-order",
        headers: {
          "x-idempotency-key": "kcoin:topup:shortage:0009",
        },
        body: {
          amount: 9,
          intent: "OPEN_BOX",
          box_slug: "starter_egg",
          draw_count: 1,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        xtr_amount: 9,
        kcoin_amount: 9,
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "kcoin_topup_create_order",
      {
        p_user_id: USER_ID,
        p_amount: 9,
        p_idempotency_key: "kcoin:topup:shortage:0009",
        p_intent: "OPEN_BOX",
        p_box_slug: "starter_egg",
        p_draw_count: 1,
        p_required_kcoin: 10,
      },
      expect.objectContaining({
        schema: "api",
      }),
    );
  });

  it("maps unsupported manual K-coin topup amounts from the database", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "kcoin_topup_create_order",
        error: {
          message: "kcoin topup amount is invalid",
        },
      }),
    );

    const { default: createOrderHandler } =
      await import("../../api/payments/kcoin-topup/create-order");
    const result = await invokeApiHandler<ApiErrorResponse>(
      createOrderHandler,
      {
        method: "POST",
        url: "/api/payments/kcoin-topup/create-order",
        headers: {
          "x-idempotency-key": "kcoin:topup:test:0001",
        },
        body: {
          amount: 50,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "KCOIN_TOPUP_AMOUNT_INVALID",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "kcoin_topup_create_order",
      expect.objectContaining({
        p_amount: 50,
        p_intent: "MANUAL_TOPUP",
      }),
      expect.any(Object),
    );
    expect(createTelegramStarsInvoiceMock).not.toHaveBeenCalled();
  });

  it("returns a redacted fulfilled topup status for the current session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      order_id: TOPUP_ORDER_ID,
      topup_order_id: TOPUP_ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      status: "fulfilled",
      payment_order_status: "fulfilled",
      xtr_amount: 500,
      kcoin_amount: "500",
      paid_at: "2026-06-05T12:01:00.000Z",
      fulfilled_at: "2026-06-05T12:01:02.000Z",
      topup_order: {
        id: TOPUP_ORDER_ID,
        status: "fulfilled",
        xtr_amount: 500,
        kcoin_amount: "500",
        paid_at: "2026-06-05T12:01:00.000Z",
        fulfilled_at: "2026-06-05T12:01:02.000Z",
        created_at: "2026-06-05T12:00:00.000Z",
        updated_at: "2026-06-05T12:01:02.000Z",
        has_error: false,
        credit_ledger_id: "should-not-leak",
      },
      star_order: {
        id: STAR_ORDER_ID,
        status: "fulfilled",
        xtr_amount: 500,
        expires_at: "2026-06-05T12:15:00.000Z",
        paid_at: "2026-06-05T12:01:00.000Z",
        fulfilled_at: "2026-06-05T12:01:02.000Z",
        has_error: false,
        telegram_payment_charge_id: "tg-charge-should-not-leak",
      },
      payment: {
        recorded: true,
        status: "paid",
        currency: "XTR",
        xtr_amount: 500,
        paid_at: "2026-06-05T12:01:00.000Z",
        created_at: "2026-06-05T12:01:00.000Z",
        telegram_payment_charge_id: "tg-charge-should-not-leak",
        raw_update: {
          secret: "raw-update-should-not-leak",
        },
      },
      fulfillment: {
        status: "fulfilled",
        credited: true,
        completed_at: "2026-06-05T12:01:02.000Z",
        failed: false,
        retryable: false,
      },
      server_time: "2026-06-05T12:01:03.000Z",
    });

    const { default: statusHandler } =
      await import("../../api/payments/kcoin-topup/status");
    const result = await invokeApiHandler<ApiSuccessResponse>(statusHandler, {
      method: "GET",
      url: "/api/payments/kcoin-topup/status",
      query: {
        order_id: TOPUP_ORDER_ID,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        order_id: TOPUP_ORDER_ID,
        topup_order_id: TOPUP_ORDER_ID,
        star_order_id: STAR_ORDER_ID,
        status: "fulfilled",
        payment_order_status: "fulfilled",
        xtr_amount: 500,
        kcoin_amount: 500,
        payment: {
          recorded: true,
          status: "paid",
          currency: "XTR",
          xtr_amount: 500,
        },
        fulfillment: {
          status: "fulfilled",
          credited: true,
          failed: false,
          retryable: false,
        },
      },
    });
    expect(JSON.stringify(result.body)).not.toContain(
      "telegram_payment_charge_id",
    );
    expect(JSON.stringify(result.body)).not.toContain("raw_update");
    expect(JSON.stringify(result.body)).not.toContain(
      "tg-charge-should-not-leak",
    );
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "kcoin_topup_get_status",
      {
        p_user_id: USER_ID,
        p_topup_order_id: TOPUP_ORDER_ID,
      },
      expect.objectContaining({
        schema: "api",
      }),
    );
  });

  it("returns ORDER_NOT_FOUND when the topup order is absent or not owned by the session user", async () => {
    callRpcRawMock.mockResolvedValueOnce(null);

    const { default: statusHandler } =
      await import("../../api/payments/kcoin-topup/status");
    const result = await invokeApiHandler<ApiErrorResponse>(statusHandler, {
      method: "GET",
      url: "/api/payments/kcoin-topup/status",
      query: {
        orderId: OTHER_TOPUP_ORDER_ID,
        user_id: "88888888-8888-4888-8888-888888888888",
      },
    });

    expect(result.statusCode).toBe(404);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "ORDER_NOT_FOUND",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "kcoin_topup_get_status",
      {
        p_user_id: USER_ID,
        p_topup_order_id: OTHER_TOPUP_ORDER_ID,
      },
      expect.anything(),
    );
  });

  it("requires a valid session for topup status", async () => {
    requireSessionMock.mockRejectedValueOnce(
      ApiError.authSessionExpired("登录状态已过期，请重新进入应用。"),
    );

    const { default: statusHandler } =
      await import("../../api/payments/kcoin-topup/status");
    const result = await invokeApiHandler<ApiErrorResponse>(statusHandler, {
      method: "GET",
      url: "/api/payments/kcoin-topup/status",
      query: {
        orderId: TOPUP_ORDER_ID,
      },
    });

    expect(result.statusCode).toBe(401);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "AUTH_SESSION_EXPIRED",
      },
    });
  });
});
