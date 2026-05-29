import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import updatePriceHandler from "../../api/market/update-price";
import { RpcError } from "../../packages/server/src/db/rpc";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock, requireSessionMock } = vi.hoisted(() => ({
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

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FORGED_USER_ID = "99999999-9999-4999-8999-999999999999";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "market:update-price-focused-0001";

describe("market update price API focused coverage", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.FEATURE_MARKET_ENABLED = "true";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-update-price-focused-test",
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
      updatePriceHandler,
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
      updatePriceHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          new_unit_price_kcoin: 650,
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
      updatePriceHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          new_unit_price_kcoin: 650,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("passes only the session user id to market_update_listing_price", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      unit_price_kcoin: 650,
      expected_net_amount: 618,
      status: "active",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(updatePriceHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-market-update-price-session-user",
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        listing_id: LISTING_ID,
        new_unit_price_kcoin: 650,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_update_listing_price",
      {
        p_user_id: USER_ID,
        p_listing_id: LISTING_ID,
        p_new_unit_price_kcoin: 650,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-market-update-price-session-user",
          userId: USER_ID,
          listingId: LISTING_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      listing_id: LISTING_ID,
      unit_price_kcoin: 650,
    });
  });

  it("maps non-seller RPC errors to FORBIDDEN", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_update_listing_price",
        error: {
          message: "not listing owner",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      updatePriceHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          new_unit_price_kcoin: 650,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(403);
    expect(result.body.error.code).toBe("FORBIDDEN");
    expect(result.body.error.message).toBe("只有卖家可以修改挂单价格。");
  });
});
