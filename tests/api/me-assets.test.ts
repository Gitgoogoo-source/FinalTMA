import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import assetsHandler from "../../api/me/assets";
import type { MeAssetsResponse } from "../../packages/validation/src/me.schemas";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock, requireSessionMock } = vi.hoisted(() => ({
  callRpcRawMock: vi.fn(),
  requireSessionMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
}));

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("/api/me/assets", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-me-assets-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-06-02T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("reads balances for the session user and returns only top-bar internal assets", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      userId: USER_ID,
      balances: {
        KCOIN: { currencyCode: "KCOIN", available: "1200", locked: "0" },
        FGEMS: { currencyCode: "FGEMS", available: "35", locked: "0" },
        STAR_DISPLAY: {
          currencyCode: "STAR_DISPLAY",
          available: "999",
          locked: "0",
        },
      },
      updatedAt: "2026-06-02T00:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse<MeAssetsResponse>>(
      assetsHandler,
      {
        method: "GET",
        headers: { "x-request-id": "req-me-assets-ok" },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.data).toMatchObject({
      userId: USER_ID,
      balances: {
        KCOIN: { currencyCode: "KCOIN", available: "1200", locked: "0" },
        FGEMS: { currencyCode: "FGEMS", available: "35", locked: "0" },
      },
      assets: {
        kcoin: { currencyCode: "KCOIN", available: "1200", locked: "0" },
        fgems: { currencyCode: "FGEMS", available: "35", locked: "0" },
      },
      updatedAt: "2026-06-02T00:00:00.000Z",
    });
    expect("STAR_DISPLAY" in result.body.data.balances).toBe(false);
    expect("stars" in result.body.data.assets).toBe(false);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "get_user_asset_balances",
      {
        p_user_id: USER_ID,
      },
      {
        schema: "api",
        context: {
          requestId: "req-me-assets-ok",
          userId: USER_ID,
        },
      },
    );
  });

  it("rejects RPC payloads missing required top-bar balances", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      userId: USER_ID,
      balances: {
        KCOIN: { currencyCode: "KCOIN", available: "1200", locked: "0" },
      },
      updatedAt: "2026-06-02T00:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiErrorResponse>(assetsHandler, {
      method: "GET",
      headers: { "x-request-id": "req-me-assets-invalid" },
    });

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe("ASSET_RESULT_INVALID");
    expect(result.body.error.message).toBe("Internal server error");
  });
});
