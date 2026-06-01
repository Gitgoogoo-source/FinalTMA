import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "../../api/_shared/handler";
import cancelSellHandler from "../../api/inventory/cancel-sell";
import sellEntryHandler from "../../api/inventory/sell-entry";
import { invokeApiHandler } from "./_utils";

const {
  assertMarketWriteAllowedMock,
  assertUserRiskAllowedMock,
  callRpcRawMock,
  requireSessionMock,
} = vi.hoisted(() => ({
  assertMarketWriteAllowedMock: vi.fn(),
  assertUserRiskAllowedMock: vi.fn(),
  callRpcRawMock: vi.fn(),
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

vi.mock("../../api/_shared/riskGuards.js", () => ({
  assertUserRiskAllowed: assertUserRiskAllowedMock,
}));

vi.mock("../../packages/server/src/market/marketGuards.js", () => ({
  assertMarketWriteAllowed: assertMarketWriteAllowedMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FORGED_USER_ID = "99999999-9999-4999-8999-999999999999";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const LISTING_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "inventory-sell-entry-focused-0001";

describe("inventory direct sell entry APIs", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    assertMarketWriteAllowedMock.mockReset();
    assertMarketWriteAllowedMock.mockResolvedValue(undefined);
    assertUserRiskAllowedMock.mockReset();
    assertUserRiskAllowedMock.mockResolvedValue(undefined);
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-inventory-sell-entry-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("creates a market listing from the verified session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      item_count: 1,
      remaining_count: 1,
      unit_price_kcoin: 500,
      fee_bps: 500,
      expected_net_amount: 475,
      status: "active",
      price_health: "healthy",
      idempotent: false,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(sellEntryHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-inventory-sell-entry",
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        item_instance_ids: [ITEM_ID],
        unit_price: 500,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(assertMarketWriteAllowedMock).toHaveBeenCalled();
    expect(assertUserRiskAllowedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "market.create_listing",
        idempotencyKey: IDEMPOTENCY_KEY,
        metadata: expect.objectContaining({
          source: "inventory.sell_entry",
          itemCount: 1,
          priceKcoin: 500,
        }),
      }),
    );
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_create_listing",
      {
        p_user_id: USER_ID,
        p_item_instance_ids: [ITEM_ID],
        p_unit_price_kcoin: 500,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-inventory-sell-entry",
          userId: USER_ID,
          source: "inventory.sell_entry",
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      listing_id: LISTING_ID,
      expected_net_amount: 475,
    });
  });

  it("rejects forged seller ids before risk or RPC calls", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(sellEntryHandler, {
      method: "POST",
      body: {
        item_instance_ids: [ITEM_ID],
        unit_price: 500,
        idempotency_key: IDEMPOTENCY_KEY,
        seller_user_id: FORGED_USER_ID,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(assertUserRiskAllowedMock).not.toHaveBeenCalled();
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects risk-denied direct sell entries before RPC calls", async () => {
    assertUserRiskAllowedMock.mockRejectedValueOnce(
      new ApiError(403, "RISK_REJECTED", "当前操作存在风险，已被系统拦截。"),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(sellEntryHandler, {
      method: "POST",
      headers: {
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        item_instance_ids: [ITEM_ID],
        unit_price: 500,
      },
    });

    expect(result.statusCode).toBe(403);
    expect(result.body.error.code).toBe("RISK_REJECTED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("cancels a listing directly when listing_id is known", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      status: "cancelled",
      released_item_instance_ids: [ITEM_ID],
      cancelled_at: "2026-05-22T00:00:00.000Z",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(cancelSellHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-inventory-cancel-sell",
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        item_instance_id: ITEM_ID,
        listing_id: LISTING_ID,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(assertUserRiskAllowedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "market.cancel_listing",
        idempotencyKey: IDEMPOTENCY_KEY,
        metadata: expect.objectContaining({
          source: "inventory.cancel_sell",
          listingId: LISTING_ID,
          itemInstanceId: ITEM_ID,
        }),
      }),
    );
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_cancel_listing",
      {
        p_user_id: USER_ID,
        p_listing_id: LISTING_ID,
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_reason: "user_cancelled",
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-inventory-cancel-sell",
          userId: USER_ID,
          source: "inventory.cancel_sell",
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      listing_id: LISTING_ID,
      released_item_instance_ids: [ITEM_ID],
    });
  });

  it("resolves the active listing from item_instance_id before cancelling", async () => {
    callRpcRawMock
      .mockResolvedValueOnce({
        item_instance_id: ITEM_ID,
        template_id: "44444444-4444-4444-8444-444444444444",
        name: "Moon Crown Guardian",
        market_status: {
          is_listed: true,
          listing_id: LISTING_ID,
          unit_price: 500,
          currency: "KCOIN",
        },
      })
      .mockResolvedValueOnce({
        listing_id: LISTING_ID,
        status: "cancelled",
        released_item_ids: [ITEM_ID],
      });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(cancelSellHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-inventory-cancel-sell-by-item",
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        item_instance_id: ITEM_ID,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      1,
      "inventory_get_item_detail",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_item_instance_id: ITEM_ID,
        p_include_market_status: true,
      }),
      expect.any(Object),
    );
    expect(callRpcRawMock).toHaveBeenNthCalledWith(
      2,
      "market_cancel_listing",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_listing_id: LISTING_ID,
      }),
      expect.any(Object),
    );
    expect(result.body.data).toMatchObject({
      listing_id: LISTING_ID,
      released_item_instance_ids: [ITEM_ID],
    });
  });
});
