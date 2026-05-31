import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest } from "@vercel/node";

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
const INVITER_USER_ID = "11111111-1111-4111-8111-222222222222";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const REFERRAL_ID = "33333333-3333-4333-8333-333333333333";

describe("auth API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.SESSION_COOKIE_NAME = "tma_game_session";
    process.env.SESSION_COOKIE_SECURE = "false";
    process.env.SESSION_COOKIE_SAMESITE = "lax";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T00:00:00.000Z"));
    callRpcRawMock.mockReset();
    getSupabaseAdminClientMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.SESSION_COOKIE_NAME;
    delete process.env.SESSION_COOKIE_SECURE;
    delete process.env.SESSION_COOKIE_SAMESITE;
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
        code: "AUTH_INIT_DATA_INVALID",
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
      startParam: "INVITE7001",
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
    expect(result.headers["set-cookie"]).toEqual(
      expect.stringContaining("HttpOnly"),
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
          expiresAt: "2026-05-28T00:00:00.000Z",
          cookieBased: true,
        },
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "auth_upsert_telegram_user",
      expect.objectContaining({
        p_telegram_user_id: 7001,
        p_username: "test_user",
        p_start_param: "INVITE7001",
      }),
      expect.any(Object),
    );
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "auth_create_session",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_device_id: expect.any(String),
        p_ip_hash: expect.any(String),
        p_user_agent: expect.any(String),
      }),
      expect.any(Object),
    );
  });

  it("/api/auth/telegram records same-device referral multi-account risk", async () => {
    let createSessionParams: Record<string, unknown> | null = null;
    getSupabaseAdminClientMock.mockReturnValue(
      createAuthReferralRiskSupabaseMock(() => createSessionParams),
    );
    callRpcRawMock.mockImplementation(
      async (rpcName: string, params: Record<string, unknown>) => {
        if (rpcName === "auth_upsert_telegram_user") {
          return {
            user_id: USER_ID,
            telegram_user_id: 7002,
            invite_code: "invite_test_7002",
          };
        }

        if (rpcName === "auth_create_session") {
          createSessionParams = params;
          return {
            session_id: SESSION_ID,
            expires_at: "2026-05-28T00:00:00.000Z",
          };
        }

        if (rpcName === "risk_record_event") {
          return {
            risk_event_id: "44444444-4444-4444-8444-444444444444",
            status: "open",
          };
        }

        throw new Error(`Unexpected RPC: ${rpcName}`);
      },
    );

    const { default: authTelegramHandler } =
      await import("../../api/auth/telegram");
    const initData = buildTelegramInitData({
      botToken: BOT_TOKEN,
      authDate: 1779321600,
      startParam: "INVITER7002",
      user: {
        id: 7002,
        first_name: "Invitee",
      },
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      authTelegramHandler,
      {
        method: "POST",
        url: "/api/auth/telegram",
        headers: {
          "content-type": "application/json",
          "user-agent": "same-device-agent",
          "x-forwarded-for": "127.0.0.22",
        },
        body: {
          initData,
          clientContext: {
            platform: "ios",
          },
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "risk_record_event",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_event_type: "referral_multi_account",
        p_source_type: "referral",
        p_source_id: REFERRAL_ID,
        p_detail: expect.objectContaining({
          action: "auth.telegram",
          reason: "same_server_device_fingerprint",
          referral_id: REFERRAL_ID,
          inviter_user_id: INVITER_USER_ID,
          matched_signals: expect.arrayContaining(["device_id"]),
        }),
      }),
      expect.objectContaining({
        schema: "api",
      }),
    );
  });

  it("reads session tokens from the HttpOnly cookie", async () => {
    const { extractSessionToken } =
      await import("../../api/_shared/requireSession");
    const { extractSessionTokenFromHeaders } =
      await import("../../packages/server/src/auth/verifySession");
    const token = extractSessionToken({
      headers: {
        cookie: "other=value; tma_game_session=cookie-session-token",
      },
    } as unknown as VercelRequest);

    expect(token).toBe("cookie-session-token");
    expect(
      extractSessionTokenFromHeaders({
        cookie: "other=value; tma_game_session=cookie-session-token",
      }),
    ).toBe("cookie-session-token");
  });

  it("/api/auth/telegram rejects initDataUnsafe in the login body", async () => {
    const { default: authTelegramHandler } =
      await import("../../api/auth/telegram");
    const initData = buildTelegramInitData({
      botToken: BOT_TOKEN,
      authDate: 1779321600,
      user: {
        id: 7003,
        first_name: "Unsafe",
      },
    });
    const result = await invokeApiHandler<ApiErrorResponse>(
      authTelegramHandler,
      {
        method: "POST",
        url: "/api/auth/telegram",
        headers: {
          "content-type": "application/json",
        },
        body: {
          initData,
          initDataUnsafe: {
            user: {
              id: 7003,
              first_name: "Unsafe",
            },
          },
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
      },
    });
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("/api/auth/telegram returns USER_BLOCKED for inactive users", async () => {
    getSupabaseAdminClientMock.mockReturnValue(
      createAuthSupabaseMock("blocked"),
    );
    callRpcRawMock.mockResolvedValueOnce({
      user_id: USER_ID,
      telegram_user_id: 7001,
      invite_code: "invite_test_7001",
    });

    const { default: authTelegramHandler } =
      await import("../../api/auth/telegram");
    const initData = buildTelegramInitData({
      botToken: BOT_TOKEN,
      authDate: 1779321600,
      user: {
        id: 7001,
        first_name: "Test",
      },
    });
    const result = await invokeApiHandler<ApiErrorResponse>(
      authTelegramHandler,
      {
        method: "POST",
        url: "/api/auth/telegram",
        headers: {
          "content-type": "application/json",
          "user-agent": "vitest",
          "x-forwarded-for": "127.0.0.13",
        },
        body: {
          initData,
        },
      },
    );

    expect(result.statusCode).toBe(403);
    expect(result.body).toMatchObject({
      ok: false,
      error: {
        code: "USER_BLOCKED",
        message: "当前账号已被限制使用。",
      },
    });
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });
});

function createAuthSupabaseMock(status = "active") {
  const maybeSingleMock = vi
    .fn()
    .mockResolvedValueOnce({
      data: null,
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        status,
      },
      error: null,
    })
    .mockResolvedValue({
      data: null,
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

function createAuthReferralRiskSupabaseMock(
  readCreateSessionParams: () => Record<string, unknown> | null,
) {
  let maybeSingleCount = 0;

  function resolveMaybeSingle() {
    maybeSingleCount += 1;

    if (maybeSingleCount === 1) {
      return Promise.resolve({
        data: null,
        error: null,
      });
    }

    if (maybeSingleCount === 2) {
      return Promise.resolve({
        data: {
          status: "active",
        },
        error: null,
      });
    }

    if (maybeSingleCount === 3) {
      return Promise.resolve({
        data: {
          id: INVITER_USER_ID,
          invite_code: "INVITER7002",
        },
        error: null,
      });
    }

    if (maybeSingleCount === 4) {
      return Promise.resolve({
        data: {
          id: REFERRAL_ID,
          inviter_user_id: INVITER_USER_ID,
          invitee_user_id: USER_ID,
          invite_code: "INVITER7002",
          status: "pending",
        },
        error: null,
      });
    }

    return Promise.resolve({
      data: null,
      error: null,
    });
  }

  function resolveSessionList() {
    const params = readCreateSessionParams();

    return Promise.resolve({
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          ip_hash: params?.p_ip_hash ?? null,
          user_agent: params?.p_user_agent ?? null,
          device_id: params?.p_device_id ?? null,
          platform: "ios",
          created_at: "2026-05-20T00:00:00.000Z",
        },
      ],
      error: null,
    });
  }

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(resolveMaybeSingle),
    then: vi.fn((resolve, reject) =>
      resolveSessionList().then(resolve, reject),
    ),
  };

  return {
    schema: vi.fn(() => ({
      from: vi.fn(() => builder),
    })),
  };
}
