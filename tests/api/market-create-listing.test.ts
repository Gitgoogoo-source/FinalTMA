import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import createListingHandler from "../../api/market/create-listing";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock, requireSessionMock } = vi.hoisted(() => ({
  callRpcRawMock: vi.fn(),
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

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FORGED_USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const IDEMPOTENCY_KEY = "market:create-listing-focused-0001";

describe("market create listing API focused coverage", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-create-listing-focused-test",
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

    const result = await invokeApiHandler<ApiErrorResponse>(
      createListingHandler,
      {
        method: "POST",
      },
    );

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe("AUTH_SESSION_EXPIRED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects forged user_id before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      createListingHandler,
      {
        method: "POST",
        body: {
          item_instance_ids: [ITEM_ID],
          unit_price_kcoin: 500,
          idempotency_key: IDEMPOTENCY_KEY,
          user_id: FORGED_USER_ID,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects missing idempotency_key before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      createListingHandler,
      {
        method: "POST",
        body: {
          item_instance_ids: [ITEM_ID],
          unit_price_kcoin: 500,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("passes only the session user id to market_create_listing", async () => {
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
    >(createListingHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-market-create-listing-session-user",
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        item_instance_ids: [ITEM_ID],
        unit_price_kcoin: 500,
      },
    });

    expect(result.statusCode).toBe(200);
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
          requestId: "req-market-create-listing-session-user",
          userId: USER_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      listing_id: LISTING_ID,
      expected_net_amount: 475,
    });
  });
});
