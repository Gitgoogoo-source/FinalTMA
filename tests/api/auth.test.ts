import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { buildTelegramInitData, invokeApiHandler } from "./_utils";

const { callRpcRawMock, getSupabaseAdminClientMock } = vi.hoisted(() => ({
  callRpcRawMock: vi.fn(),
  getSupabaseAdminClientMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
}));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

const BOT_TOKEN = "123456:test-bot-token";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

describe("auth API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T00:00:00.000Z"));
    callRpcRawMock.mockReset();
    getSupabaseAdminClientMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it("/api/auth/telegram rejects invalid Telegram initData", async () => {
    const { default: authTelegramHandler } =
      await import("../../api/auth/telegram");
    const result = await invokeApiHandler<ApiErrorResponse>(
      authTelegramHandler,
      {
        method: "POST",
        url: "/api/auth/telegram",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.11",
        },
        body: {
          initData:
            "auth_date=1779321600&user=%7B%22id%22%3A7001%2C%22first_name%22%3A%22Test%22%7D&hash=0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
    );

    expect(result.statusCode).toBe(401);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "TELEGRAM_INIT_DATA_INVALID",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("/api/auth/telegram creates a session for valid Telegram initData", async () => {
    getSupabaseAdminClientMock.mockReturnValue(createAuthSupabaseMock());
    callRpcRawMock.mockImplementation(async (rpcName: string) => {
      if (rpcName === "auth_upsert_telegram_user") {
        return {
          user_id: USER_ID,
          telegram_user_id: 7001,
          invite_code: "invite_test_7001",
        };
      }

      if (rpcName === "auth_create_session") {
        return {
          session_id: SESSION_ID,
          expires_at: "2026-05-28T00:00:00.000Z",
        };
      }

      throw new Error(`Unexpected RPC: ${rpcName}`);
    });

    const { default: authTelegramHandler } =
      await import("../../api/auth/telegram");
    const initData = buildTelegramInitData({
      botToken: BOT_TOKEN,
      authDate: 1779321600,
      user: {
        id: 7001,
        first_name: "Test",
        last_name: "User",
        username: "test_user",
        language_code: "zh-hans",
      },
    });
    const result = await invokeApiHandler<ApiSuccessResponse>(
      authTelegramHandler,
      {
        method: "POST",
        url: "/api/auth/telegram",
        headers: {
          "content-type": "application/json",
          "user-agent": "vitest",
          "x-forwarded-for": "127.0.0.12",
        },
        body: {
          initData,
          clientContext: {
            platform: "ios",
            launchSource: "direct",
          },
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.headers["set-cookie"]).toEqual(
      expect.stringContaining("tma_game_session="),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        status: "ok",
        isNewUser: true,
        user: {
          id: USER_ID,
          telegramUserId: "7001",
          username: "test_user",
          inviteCode: "invite_test_7001",
        },
        session: {
          sessionId: SESSION_ID,
          tokenType: "Bearer",
          expiresAt: "2026-05-28T00:00:00.000Z",
          cookieBased: false,
        },
      },
    });
    expect(result.body.data).toMatchObject({
      session: {
        accessToken: expect.stringMatching(/^tma_sess_v1\./),
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "auth_upsert_telegram_user",
      expect.objectContaining({
        p_telegram_user_id: 7001,
        p_username: "test_user",
      }),
      expect.any(Object),
    );
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "auth_create_session",
      expect.objectContaining({
        p_user_id: USER_ID,
      }),
      expect.any(Object),
    );
  });
});

function createAuthSupabaseMock() {
  const maybeSingleMock = vi
    .fn()
    .mockResolvedValueOnce({
      data: null,
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        status: "active",
      },
      error: null,
    });
  const eqMock = vi.fn(() => ({
    maybeSingle: maybeSingleMock,
  }));
  const selectMock = vi.fn(() => ({
    eq: eqMock,
  }));
  const fromMock = vi.fn(() => ({
    select: selectMock,
  }));
  const schemaMock = vi.fn(() => ({
    from: fromMock,
  }));

  return {
    schema: schemaMock,
  };
}
