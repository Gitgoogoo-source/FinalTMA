import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import buyListingHandler from "../../api/market/buy";
import { RpcError } from "../../packages/server/src/db/rpc";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock, getSupabaseAdminMock, requireSessionMock } = vi.hoisted(
  () => ({
  callRpcRawMock: vi.fn(),
  getSupabaseAdminMock: vi.fn(),
  requireSessionMock: vi.fn(),
  }),
);

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
  getSupabaseAdmin: getSupabaseAdminMock,
  requireSession: requireSessionMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FORGED_USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "88888888-8888-4888-8888-888888888888";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const TEMPLATE_ID = "33333333-3333-4333-8333-333333333333";
const FORM_ID = "44444444-4444-4444-8444-444444444444";
const IDEMPOTENCY_KEY = "market:buy-listing-focused-0001";
const SELLER_ID = "55555555-5555-4555-8555-555555555555";

function createMarketBuyDbMock(
  listing: Record<string, unknown> | null = {
    id: LISTING_ID,
    seller_user_id: SELLER_ID,
    status: "active",
  },
) {
  return {
    schema: vi.fn((schema: string) => ({
      from: vi.fn((table: string) => {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
          maybeSingle: vi.fn(() =>
            Promise.resolve({
              data:
                schema === "market" && table === "listings" ? listing : null,
              error: null,
            }),
          ),
          then: (
            resolve: (value: { data: unknown[]; error: null }) => unknown,
            reject?: (reason: unknown) => unknown,
          ) =>
            Promise.resolve(resolve({ data: [], error: null })).catch(reject),
        };

        return builder;
      }),
    })),
  };
}

describe("market buy API focused coverage", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.FEATURE_MARKET_ENABLED = "true";
    callRpcRawMock.mockReset();
    getSupabaseAdminMock.mockReset();
    getSupabaseAdminMock.mockReturnValue(createMarketBuyDbMock());
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-buy-focused-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("returns 401 before calling RPC when the user is not logged in", async () => {
    requireSessionMock.mockRejectedValueOnce(
      ApiError.authSessionExpired("登录状态缺失，请重新进入应用。"),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
    });

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe("AUTH_SESSION_EXPIRED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects forged user_id before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
        idempotency_key: IDEMPOTENCY_KEY,
        user_id: FORGED_USER_ID,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects missing idempotency_key before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("passes only the session buyer id to market_buy_listing", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      order_id: ORDER_ID,
      purchased_items: [
        {
          item_instance_id: ITEM_ID,
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
        },
      ],
      total_price_kcoin: 500,
      fee_amount_kcoin: 25,
      seller_net_amount_kcoin: 475,
      buyer_balance_after: 1500,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(buyListingHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-market-buy-session-user",
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_buy_listing",
      {
        p_buyer_user_id: USER_ID,
        p_listing_id: LISTING_ID,
        p_quantity: 1,
        p_expected_unit_price_kcoin: 500,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-market-buy-session-user",
          userId: USER_ID,
          listingId: LISTING_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      order_id: ORDER_ID,
      buyer_balance_after: 1500,
    });
  });

  it("maps insufficient balance RPC errors to KCOIN_NOT_ENOUGH", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_buy_listing",
        error: {
          message:
            "insufficient balance: currency KCOIN, available 0, required 500",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("KCOIN_NOT_ENOUGH");
    expect(result.body.error.message).toBe("KCOIN 余额不足。");
  });

  it("maps stale price RPC errors to LISTING_PRICE_CHANGED", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_buy_listing",
        error: {
          message: "listing price changed",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("LISTING_PRICE_CHANGED");
    expect(result.body.error.message).toBe("价格已变化，请刷新后重试。");
  });

  it("maps own listing RPC errors to CANNOT_BUY_OWN_LISTING", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_buy_listing",
        error: {
          message: "buyer cannot buy own listing",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("CANNOT_BUY_OWN_LISTING");
    expect(result.body.error.message).toBe("不能购买自己的挂单。");
  });

  it("records self-trade risk before rejecting own listings", async () => {
    getSupabaseAdminMock.mockReturnValue(
      createMarketBuyDbMock({
        id: LISTING_ID,
        seller_user_id: USER_ID,
        status: "active",
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-market-buy-self-trade",
      },
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("CANNOT_BUY_OWN_LISTING");
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "risk_record_event",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_event_type: "market_self_trade",
        p_source_type: "market_listing",
        p_source_id: LISTING_ID,
      }),
      expect.objectContaining({
        schema: "api",
      }),
    );
    expect(callRpcRawMock).not.toHaveBeenCalledWith(
      "market_buy_listing",
      expect.any(Object),
      expect.any(Object),
    );
  });
});
