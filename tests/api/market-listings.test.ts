import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import listingsHandler from "../../api/market/listings";
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
const TEMPLATE_ID = "33333333-3333-4333-8333-333333333333";
const FORM_ID = "44444444-4444-4444-8444-444444444444";

describe("market listings API focused coverage", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-listings-focused-test",
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

    const result = await invokeApiHandler<ApiErrorResponse>(listingsHandler, {
      method: "GET",
    });

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe("AUTH_SESSION_EXPIRED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects forged user_id query before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(listingsHandler, {
      method: "GET",
      query: {
        user_id: FORGED_USER_ID,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("uses the session user id when listing market items", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      items: [
        {
          listing_id: LISTING_ID,
          seller_user_id: FORGED_USER_ID,
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          name: "测试藏品",
          rarity: "rare",
          type_code: "character",
          image_url: "https://example.test/item.png",
          unit_price_kcoin: 500,
          currency_code: "KCOIN",
          item_count: 1,
          remaining_count: 1,
          status: "active",
          seller_display_name: "卖家",
          is_own_listing: false,
          is_buyable: true,
          not_buyable_reason: null,
          price_health: "healthy",
          created_at: "2026-05-22T00:00:00.000Z",
          expires_at: null,
        },
      ],
      next_cursor: null,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<{
        items: Array<Record<string, unknown>>;
        next_cursor: string | null;
      }>
    >(listingsHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-market-listings-session-user",
      },
      query: {
        limit: "10",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_list_listings",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_limit: 10,
      }),
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-market-listings-session-user",
          userId: USER_ID,
        }),
      }),
    );
    expect(result.body.data.items).toHaveLength(1);
  });
});
