import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import cancelListingHandler from "../../api/market/cancel-listing";
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
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const IDEMPOTENCY_KEY = "market:cancel-listing-focused-0001";

function createRiskDbMock(rows: Array<Record<string, unknown>> = []) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };

  return {
    schema: vi.fn(() => ({
      from: vi.fn(() => builder),
    })),
  };
}

describe("market cancel listing API focused coverage", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.FEATURE_MARKET_ENABLED = "true";
    callRpcRawMock.mockReset();
    getSupabaseAdminMock.mockReset();
    getSupabaseAdminMock.mockReturnValue(createRiskDbMock());
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-cancel-listing-focused-test",
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
      cancelListingHandler,
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
      cancelListingHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
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
      cancelListingHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("passes only the session user id to market_cancel_listing", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      status: "cancelled",
      released_item_instance_ids: [ITEM_ID],
      cancelled_at: "2026-05-22T00:00:00.000Z",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(cancelListingHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-market-cancel-listing-session-user",
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        listing_id: LISTING_ID,
      },
    });

    expect(result.statusCode).toBe(200);
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
          requestId: "req-market-cancel-listing-session-user",
          userId: USER_ID,
          listingId: LISTING_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      listing_id: LISTING_ID,
      status: "cancelled",
      released_item_instance_ids: [ITEM_ID],
    });
  });

  it("rejects market_sell_blocked users before calling the cancel listing RPC", async () => {
    getSupabaseAdminMock.mockReturnValue(
      createRiskDbMock([
        {
          flag_code: "market_sell_blocked",
          flag_level: "restriction",
          active: true,
          ends_at: null,
          metadata: { reason: "risk test" },
        },
      ]),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      cancelListingHandler,
      {
        method: "POST",
        headers: {
          "x-idempotency-key": IDEMPOTENCY_KEY,
        },
        body: {
          listing_id: LISTING_ID,
        },
      },
    );

    expect(result.statusCode).toBe(403);
    expect(result.body.error.code).toBe("RISK_REJECTED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("maps non-seller RPC errors to FORBIDDEN", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_cancel_listing",
        error: {
          message: "not listing owner",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      cancelListingHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(403);
    expect(result.body.error.code).toBe("FORBIDDEN");
    expect(result.body.error.message).toBe("只有卖家可以下架挂单。");
  });
});
