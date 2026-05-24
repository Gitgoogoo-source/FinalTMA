import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "../../api/_shared/handler";
import leaderboardHandler from "../../api/album/leaderboard";
import refreshLeaderboardCronHandler from "../../api/cron/refresh-leaderboard";
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
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";

describe("album leaderboard API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-album-leaderboard-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("calls album_get_leaderboard with the session user and validated query", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      board_id: BOARD_ID,
      period: "current_week",
      scope: "global",
      entries: [
        {
          rank: 1,
          user_id: OTHER_USER_ID,
          display_name: "榜首玩家",
          avatar_url: "https://example.test/avatar.png",
          score: "225",
          completion_percent: 33.33,
          collected_count: 4,
          total_count: 12,
          rare_count: 1,
          epic_count: 1,
          legendary_count: 2,
          mint_count: 0,
          updated_at: "2026-05-24T14:30:17.958418+00:00",
        },
      ],
      my_entry: {
        rank: 8,
        user_id: USER_ID,
        display_name: "当前玩家",
        avatar_url: null,
        score: 80,
        completion_percent: "12.5",
        collected_count: 2,
        total_count: 16,
        rare_count: 1,
        epic_count: 0,
        legendary_count: 0,
        mint_count: 0,
        generated_at: "2026-05-24T14:30:17.958418+00:00",
      },
      next_cursor: "75",
      generated_at: "2026-05-24T14:30:17.958418+00:00",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(leaderboardHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-album-leaderboard-test",
      },
      query: {
        period: "current_week",
        scope: "global",
        around_me: "true",
        sort: "score_desc",
        limit: "25",
        cursor: "50",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "album_get_leaderboard",
      {
        p_user_id: USER_ID,
        p_board_id: null,
        p_period: "current_week",
        p_scope: "global",
        p_series_id: null,
        p_faction_id: null,
        p_rarity: null,
        p_sort: "score_desc",
        p_around_me: true,
        p_limit: 25,
        p_offset: 50,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-album-leaderboard-test",
          userId: USER_ID,
          period: "current_week",
          scope: "global",
          sort: "score_desc",
          limit: 25,
          offset: 50,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      board_id: BOARD_ID,
      entries: [
        {
          rank: 1,
          user_id: OTHER_USER_ID,
          score: 225,
          completion_percent: 33.33,
          mint_count: 0,
          updated_at: "2026-05-24T14:30:17.958Z",
        },
      ],
      my_entry: {
        rank: 8,
        user_id: USER_ID,
        completion_percent: 12.5,
      },
      next_cursor: "75",
      generated_at: "2026-05-24T14:30:17.958Z",
    });
  });

  it("requires a session before leaderboard can call RPC", async () => {
    requireSessionMock.mockRejectedValueOnce(
      ApiError.authSessionExpired("登录状态缺失，请重新进入应用。"),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      leaderboardHandler,
      {
        method: "GET",
      },
    );

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe("AUTH_SESSION_EXPIRED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects invalid leaderboard cursors before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      leaderboardHandler,
      {
        method: "GET",
        query: {
          cursor: "not-a-number",
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("BAD_REQUEST");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});

describe("album leaderboard refresh cron API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;
    process.env.ENABLE_CRON_API = "true";
    process.env.CRON_SECRET = "test-cron-secret-0001";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
  });

  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;
    delete process.env.CRON_SECRET;
  });

  it("calls album_refresh_weekly_leaderboard with the internal cron secret", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      board_id: BOARD_ID,
      week_key: "2026-W21",
      starts_at: "2026-05-18T00:00:00+00:00",
      ends_at: "2026-05-25T00:00:00+00:00",
      entry_count: "3",
      generated_at: "2026-05-24T14:30:17.958418+00:00",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(refreshLeaderboardCronHandler, {
      method: "POST",
      headers: {
        authorization: "Bearer test-cron-secret-0001",
        "x-request-id": "req-album-refresh-leaderboard",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "album_refresh_weekly_leaderboard",
      {
        p_week_start: null,
      },
      {
        schema: "api",
        context: {
          requestId: "req-album-refresh-leaderboard",
          source: "cron.refresh_leaderboard",
        },
      },
    );
    expect(result.body.data).toEqual({
      board_id: BOARD_ID,
      week_key: "2026-W21",
      starts_at: "2026-05-18T00:00:00.000Z",
      ends_at: "2026-05-25T00:00:00.000Z",
      entry_count: 3,
      generated_at: "2026-05-24T14:30:17.958Z",
    });
  });

  it("rejects refresh requests with an invalid cron secret", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      refreshLeaderboardCronHandler,
      {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-secret",
        },
      },
    );

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe("CRON_UNAUTHORIZED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects preview refresh requests when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "development";
    process.env.VERCEL_ENV = "preview";

    const result = await invokeApiHandler<ApiErrorResponse>(
      refreshLeaderboardCronHandler,
      {
        method: "POST",
      },
    );

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe("CRON_SECRET_MISSING");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});
