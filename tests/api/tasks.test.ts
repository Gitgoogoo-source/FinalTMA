import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import checkInHandler from "../../api/tasks/check-in";
import overviewHandler from "../../api/tasks/overview";
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
const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
const SIGNIN_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "task:check-in:0001";

describe("tasks API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-tasks-api-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("overview calls get_user_task_center with the verified session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      tasks: [{ code: "DAILY_CHECK_IN" }],
      signin: {
        campaign_id: CAMPAIGN_ID,
        current_streak: 0,
      },
      invite_stats: {
        referrals: {
          total_count: 0,
        },
        commissions: {
          pending_amount_kcoin: 0,
        },
      },
      server_time: "2026-05-26T00:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(overviewHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-tasks-overview",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "get_user_task_center",
      {
        p_user_id: USER_ID,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-tasks-overview",
          userId: USER_ID,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      tasks: [{ code: "DAILY_CHECK_IN" }],
      signin_status: {
        campaign_id: CAMPAIGN_ID,
        current_streak: 0,
      },
      commission_stats: {
        pending_amount_kcoin: 0,
      },
      server_time: "2026-05-26T00:00:00.000Z",
    });
  });

  it("overview requires a valid session before calling RPC", async () => {
    requireSessionMock.mockRejectedValueOnce(
      ApiError.authSessionExpired("登录状态缺失，请重新进入应用。"),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(overviewHandler, {
      method: "GET",
    });

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe("AUTH_SESSION_EXPIRED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("check-in calls task_daily_check_in with header idempotency and session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      signin_id: SIGNIN_ID,
      campaign_id: CAMPAIGN_ID,
      already_claimed: false,
      day_index: 1,
      current_streak: 1,
      cycle_position: 1,
      total_signins: 1,
      reward: [{ currency: "FGEMS", amount: 10 }],
      ledger_results: [{ ledger_id: "ledger-1" }],
      progress_result: { status: "completed" },
      checked_in_at: "2026-05-26T01:00:00.000Z",
      idempotent: false,
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(checkInHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-tasks-check-in",
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        campaign_id: CAMPAIGN_ID,
        local_date: "2026-05-26",
        timezone_offset_minutes: 480,
        idempotencyKey: "task:body-ignored:0001",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "task_daily_check_in",
      {
        p_user_id: USER_ID,
        p_campaign_id: CAMPAIGN_ID,
        p_local_date: "2026-05-26",
        p_timezone_offset_minutes: 480,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-tasks-check-in",
          userId: USER_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          campaignId: CAMPAIGN_ID,
          localDate: "2026-05-26",
          timezoneOffsetMinutes: 480,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      signin_id: SIGNIN_ID,
      campaign_id: CAMPAIGN_ID,
      day_index: 1,
      current_streak: 1,
      reward: [{ currency: "FGEMS", amount: 10 }],
      checked_in_at: "2026-05-26T01:00:00.000Z",
      idempotent: false,
    });
  });

  it("check-in rejects forged user identity before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(checkInHandler, {
      method: "POST",
      body: {
        user_id: FORGED_USER_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("check-in maps idempotency conflicts to a stable public error", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "task_daily_check_in",
        error: {
          message: "idempotency conflict",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(checkInHandler, {
      method: "POST",
      body: {
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
