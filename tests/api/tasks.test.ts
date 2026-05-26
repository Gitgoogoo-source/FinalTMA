import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import bindReferralHandler from "../../api/tasks/bind-referral";
import checkInStatusHandler from "../../api/tasks/check-in-status";
import checkInHandler from "../../api/tasks/check-in";
import claimCommissionHandler from "../../api/tasks/claim-commission";
import claimTaskHandler from "../../api/tasks/claim";
import commissionHistoryHandler from "../../api/tasks/commission-history";
import inviteStatsHandler from "../../api/tasks/invite-stats";
import listHandler from "../../api/tasks/list";
import overviewHandler from "../../api/tasks/overview";
import referralLinkHandler from "../../api/tasks/referral-link";
import referralRecordsHandler from "../../api/tasks/referral-records";
import rewardHistoryHandler from "../../api/tasks/reward-history";
import shareEventHandler from "../../api/tasks/share-event";
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
const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
const SIGNIN_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const CLAIM_ID = "55555555-5555-4555-8555-555555555555";
const REFERRAL_ID = "66666666-6666-4666-8666-666666666666";
const SHARE_EVENT_ID = "77777777-7777-4777-8777-777777777777";
const COMMISSION_ID = "88888888-8888-4888-8888-888888888888";
const LEDGER_ID = "99999999-9999-4999-8999-999999999999";
const IDEMPOTENCY_KEY = "task:check-in:0001";
const CLAIM_IDEMPOTENCY_KEY = "task:claim:0001";
const CLAIM_PERIOD_KEY = "2026-05-26";
const BIND_IDEMPOTENCY_KEY = "task:bind-referral:0001";
const SHARE_IDEMPOTENCY_KEY = "task:share-event:0001";
const CLAIM_COMMISSION_IDEMPOTENCY_KEY = "task:claim-commission:0001";

describe("tasks API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.TELEGRAM_BOT_USERNAME = "test_bot";
    delete process.env.TELEGRAM_MINI_APP_SHORT_NAME;
    delete process.env.TELEGRAM_SHARE_TEXT;
    callRpcRawMock.mockReset();
    getSupabaseAdminMock.mockReset();
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

  it("list calls task_get_list with the verified session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      tasks: [
        {
          task_id: TASK_ID,
          code: "DAILY_CHECK_IN",
          task_type: "daily",
          title: "Daily check-in",
          description: "Check in once today.",
          period_type: "daily",
          target_count: 1,
          reward: [{ currency: "KCOIN", amount: 10 }],
          action_type: "none",
          active: true,
          sort_order: 10,
          metadata: {
            phase: "fourth_stage",
          },
          progress: {
            progress_id: null,
            period_key: null,
            progress_count: 0,
            target_count: 1,
            status: "in_progress",
            updated_at: "2026-05-26T00:00:00.000Z",
          },
        },
      ],
      count: 1,
      filters: {
        limit: 20,
      },
      server_time: "2026-05-26T00:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(listHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-tasks-list",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "task_get_list",
      {
        p_user_id: USER_ID,
        p_filters: {
          limit: 20,
        },
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-tasks-list",
          userId: USER_ID,
          filters: {
            limit: 20,
          },
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      items: [
        {
          task_id: TASK_ID,
          code: "DAILY_CHECK_IN",
          task_type: "daily",
          status: "in_progress",
          progress: {
            progress_count: 0,
            target_count: 1,
            status: "in_progress",
          },
        },
      ],
      tasks: [
        {
          task_id: TASK_ID,
          code: "DAILY_CHECK_IN",
        },
      ],
      count: 1,
      next_cursor: null,
      server_time: "2026-05-26T00:00:00.000Z",
    });
  });

  it("list includes referral task_type when SOCIAL category is requested", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      tasks: [
        {
          task_id: TASK_ID,
          code: "JOIN_COMMUNITY",
          task_type: "social",
          title: "Join community",
        },
        {
          task_id: REFERRAL_ID,
          code: "REFERRAL_FIRST_OPEN",
          task_type: "referral",
          title: "Invite a friend to open a box",
        },
        {
          task_id: SIGNIN_ID,
          code: "DAILY_CHECK_IN",
          task_type: "daily",
          title: "Daily check-in",
        },
      ],
      count: 3,
      filters: {
        limit: 200,
      },
      server_time: "2026-05-26T00:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(listHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-tasks-list-social",
      },
      query: {
        categories: "SOCIAL",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "task_get_list",
      {
        p_user_id: USER_ID,
        p_filters: {
          limit: 200,
        },
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-tasks-list-social",
          userId: USER_ID,
          filters: {
            limit: 200,
          },
        }),
      }),
    );

    const data = result.body.data as { items: Record<string, unknown>[] };
    expect(data.items.map((item) => item.code)).toEqual([
      "JOIN_COMMUNITY",
      "REFERRAL_FIRST_OPEN",
    ]);
    expect(data.items.map((item) => item.task_type)).toEqual([
      "social",
      "referral",
    ]);
  });

  it("list requires a valid session before calling RPC", async () => {
    requireSessionMock.mockRejectedValueOnce(
      ApiError.authSessionExpired("登录状态缺失，请重新进入应用。"),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(listHandler, {
      method: "GET",
    });

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe("AUTH_SESSION_EXPIRED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("check-in status returns seven-day config for the verified session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      campaign: {
        campaign_id: CAMPAIGN_ID,
        code: "SIGNIN_7_DAY_DEFAULT",
        title: "7 Day Sign-In",
        description: "Default active 7-day sign-in campaign.",
        cycle_days: 7,
        active: true,
      },
      days: Array.from({ length: 7 }, (_item, index) => ({
        day_index: index + 1,
        title: `Day ${index + 1}`,
        reward: [{ currency: "KCOIN", amount: 100 + index }],
        status: index === 0 ? "available" : "locked",
        claimed: false,
        available: index === 0,
      })),
      current_streak: 0,
      cycle_position: 0,
      total_signins: 0,
      already_claimed_today: false,
      next_day_index: 1,
      server_date: "2026-05-26",
      server_time: "2026-05-26T00:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      checkInStatusHandler,
      {
        method: "GET",
        headers: {
          "x-request-id": "req-tasks-check-in-status",
        },
        query: {
          campaign_id: CAMPAIGN_ID,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "signin_get_status",
      {
        p_user_id: USER_ID,
        p_campaign_id: CAMPAIGN_ID,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-tasks-check-in-status",
          userId: USER_ID,
          campaignId: CAMPAIGN_ID,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      campaign: {
        campaign_id: CAMPAIGN_ID,
        code: "SIGNIN_7_DAY_DEFAULT",
        cycle_days: 7,
      },
      current_streak: 0,
      already_claimed_today: false,
      next_day_index: 1,
    });
    expect((result.body.data as { days: unknown[] }).days).toHaveLength(7);
  });

  it("check-in status rejects forged user identity before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      checkInStatusHandler,
      {
        method: "GET",
        query: {
          user_id: FORGED_USER_ID,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("overview hides sensitive referral and commission UUIDs from RPC payloads", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      tasks: [],
      signin: null,
      invite_stats: {},
      referral_records: [
        {
          referral_id: REFERRAL_ID,
          inviter_user_id: USER_ID,
          invitee_user_id: FORGED_USER_ID,
          invitee_username: "friend_user",
          invitee_display_name: "Friend",
          invite_code: "INVITE7001",
          status: "qualified",
          first_open_order_id: "88888888-8888-4888-8888-888888888888",
          qualified_at: "2026-05-26T05:00:00.000Z",
          created_at: "2026-05-26T04:30:00.000Z",
          updated_at: "2026-05-26T05:00:00.000Z",
        },
      ],
      commission_history: [
        {
          commission_id: COMMISSION_ID,
          referral_id: REFERRAL_ID,
          inviter_user_id: USER_ID,
          invitee_user_id: FORGED_USER_ID,
          invitee_username: "friend_user",
          invitee_display_name: "Friend",
          source_type: "gacha_open",
          source_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          base_amount_kcoin: "100",
          commission_bps: 1000,
          commission_amount_kcoin: "10",
          ledger_id: LEDGER_ID,
          status: "pending",
          created_at: "2026-05-26T06:00:00.000Z",
        },
      ],
      server_time: "2026-05-26T00:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(overviewHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-tasks-overview-sensitive-fields",
      },
    });

    expect(result.statusCode).toBe(200);
    const overviewData = result.body.data as {
      referral_records: Record<string, unknown>[];
      commission_history: Record<string, unknown>[];
    };

    expect(overviewData.referral_records).toHaveLength(1);
    expect(overviewData.commission_history).toHaveLength(1);
    expect(overviewData.referral_records[0]).not.toHaveProperty(
      "inviter_user_id",
    );
    expect(overviewData.referral_records[0]).not.toHaveProperty(
      "invitee_user_id",
    );
    expect(overviewData.referral_records[0]).not.toHaveProperty(
      "first_open_order_id",
    );
    expect(overviewData.commission_history[0]).not.toHaveProperty(
      "inviter_user_id",
    );
    expect(overviewData.commission_history[0]).not.toHaveProperty(
      "invitee_user_id",
    );
  });

  it("check-in calls task_daily_check_in with session user and ignores client date fields", async () => {
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
        p_local_date: null,
        p_timezone_offset_minutes: null,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-tasks-check-in",
          userId: USER_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          campaignId: CAMPAIGN_ID,
        }),
      }),
    );
    const rpcOptions = callRpcRawMock.mock.calls[0]?.[2] as
      | { context?: Record<string, unknown> }
      | undefined;
    expect(rpcOptions?.context).not.toHaveProperty("localDate");
    expect(rpcOptions?.context).not.toHaveProperty("timezoneOffsetMinutes");
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

  it("check-in rejects a missing idempotency key with the stable task error code", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(checkInHandler, {
      method: "POST",
      body: {
        campaign_id: CAMPAIGN_ID,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
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

  it("claim calls task_claim_reward with the verified session user, DB period key and header idempotency", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      claim_id: CLAIM_ID,
      task_id: TASK_ID,
      period_key: CLAIM_PERIOD_KEY,
      status: "claimed",
      reward: [{ type: "CURRENCY", currency: "KCOIN", amount: 100 }],
      ledger_results: [{ ledger_id: "ledger-task-claim" }],
      claimed_at: "2026-05-26T02:00:00.000Z",
      idempotent: false,
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      claimTaskHandler,
      {
        method: "POST",
        headers: {
          "x-request-id": "req-tasks-claim",
          "x-idempotency-key": CLAIM_IDEMPOTENCY_KEY,
        },
        body: {
          task_id: TASK_ID,
          period_key: CLAIM_PERIOD_KEY,
          idempotencyKey: "task:claim-body-ignored",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "task_claim_reward",
      {
        p_user_id: USER_ID,
        p_task_id: TASK_ID,
        p_period_key: CLAIM_PERIOD_KEY,
        p_idempotency_key: CLAIM_IDEMPOTENCY_KEY,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-tasks-claim",
          userId: USER_ID,
          idempotencyKey: CLAIM_IDEMPOTENCY_KEY,
          taskId: TASK_ID,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      claim_id: CLAIM_ID,
      task_id: TASK_ID,
      status: "claimed",
      rewards: [{ type: "CURRENCY", currency: "KCOIN", amount: 100 }],
      claimed_at: "2026-05-26T02:00:00.000Z",
      idempotent: false,
    });
  });

  it("claim rejects unsupported period keys before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(claimTaskHandler, {
      method: "POST",
      body: {
        taskId: TASK_ID,
        periodKey: "../bad-period-key",
        idempotencyKey: CLAIM_IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("claim rejects forged progress or user fields before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(claimTaskHandler, {
      method: "POST",
      body: {
        taskId: TASK_ID,
        progress: { status: "completed" },
        user_id: FORGED_USER_ID,
        idempotencyKey: CLAIM_IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("referral-link reads the session user's invite_code without calling RPC", async () => {
    mockInviteCodeQuery("INVITE7001");

    const result = await invokeApiHandler<ApiSuccessResponse>(
      referralLinkHandler,
      {
        method: "POST",
        body: {
          scene: "TASK_PAGE",
          source: "task-center",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(getSupabaseAdminMock).toHaveBeenCalledTimes(1);
    expect(result.body.data).toMatchObject({
      referral_code: "INVITE7001",
      start_payload: "INVITE7001",
      invite_url: "https://t.me/test_bot?start=INVITE7001",
      share_text: "来一起开盲盒 task-center，完成首次开盒还能获得奖励。",
      scene: "TASK_PAGE",
      source: "task-center",
    });
  });

  it("referral-link builds a Mini App startapp link when the short name is configured", async () => {
    process.env.TELEGRAM_MINI_APP_SHORT_NAME = "blindbox_app";
    mockInviteCodeQuery("INVITE7001");

    const result = await invokeApiHandler<ApiSuccessResponse>(
      referralLinkHandler,
      {
        method: "POST",
        body: {
          scene: "INVITE_CARD",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.data).toMatchObject({
      referral_code: "INVITE7001",
      start_payload: "INVITE7001",
      invite_url: "https://t.me/test_bot/blindbox_app?startapp=INVITE7001",
      share_text: "来一起开盲盒，完成首次开盒还能获得奖励。",
      scene: "INVITE_CARD",
    });
  });

  it("referral-link rejects forged user fields before reading invite_code", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      referralLinkHandler,
      {
        method: "POST",
        body: {
          scene: "TASK_PAGE",
          user_id: FORGED_USER_ID,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(getSupabaseAdminMock).not.toHaveBeenCalled();
  });

  it("referral-link fails closed when the session user has no invite_code", async () => {
    mockInviteCodeQuery(null);

    const result = await invokeApiHandler<ApiErrorResponse>(
      referralLinkHandler,
      {
        method: "POST",
        body: {
          scene: "TASK_PAGE",
        },
      },
    );

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe("REFERRAL_INVITE_CODE_MISSING");
  });

  it("bind-referral calls referral_bind_inviter for the current session user only", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      bound: true,
      status: "pending",
      referral_id: REFERRAL_ID,
      inviter_user_id: FORGED_USER_ID,
      invitee_user_id: USER_ID,
      invite_code: "INVITE7001",
      created_at: "2026-05-26T03:00:00.000Z",
      idempotent: false,
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      bindReferralHandler,
      {
        method: "POST",
        headers: {
          "x-request-id": "req-bind-referral",
          "x-idempotency-key": BIND_IDEMPOTENCY_KEY,
        },
        body: {
          start_payload: "invite_invite7001",
          metadata: {
            surface: "login_start_param",
          },
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "referral_bind_inviter",
      {
        p_invitee_user_id: USER_ID,
        p_invite_code: "INVITE7001",
        p_idempotency_key: BIND_IDEMPOTENCY_KEY,
        p_metadata: {
          surface: "login_start_param",
        },
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-bind-referral",
          userId: USER_ID,
          idempotencyKey: BIND_IDEMPOTENCY_KEY,
          inviteCode: "INVITE7001",
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      bound: true,
      status: "pending",
      referral_id: REFERRAL_ID,
      invite_code: "INVITE7001",
      created_at: "2026-05-26T03:00:00.000Z",
    });
    expect(result.body.data).not.toHaveProperty("inviter_user_id");
    expect(result.body.data).not.toHaveProperty("invitee_user_id");
  });

  it("bind-referral maps invalid invite code RPC result to a stable API error", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      bound: false,
      status: "rejected",
      reason: "invite_code_not_found",
      invite_code: "MISSING7001",
      idempotent: false,
    });

    const result = await invokeApiHandler<ApiErrorResponse>(
      bindReferralHandler,
      {
        method: "POST",
        headers: {
          "x-idempotency-key": BIND_IDEMPOTENCY_KEY,
        },
        body: {
          start_payload: "MISSING7001",
        },
      },
    );

    expect(result.statusCode).toBe(404);
    expect(result.body.error.code).toBe("REFERRAL_INVITER_NOT_FOUND");
    expect(result.body.error.details).toMatchObject({
      status: "rejected",
      reason: "invite_code_not_found",
    });
  });

  it("bind-referral maps self invite RPC result to a stable API error", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      bound: false,
      status: "rejected",
      reason: "self_invite_not_allowed",
      invite_code: "INVITE7001",
      idempotent: false,
    });

    const result = await invokeApiHandler<ApiErrorResponse>(
      bindReferralHandler,
      {
        method: "POST",
        headers: {
          "x-idempotency-key": BIND_IDEMPOTENCY_KEY,
        },
        body: {
          start_payload: "INVITE7001",
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("REFERRAL_SELF_INVITE_NOT_ALLOWED");
    expect(result.body.error.details).toMatchObject({
      status: "rejected",
      reason: "self_invite_not_allowed",
    });
  });

  it("bind-referral maps different inviter rebind RPC result to a stable API error", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      bound: false,
      status: "conflict",
      reason: "referral_already_bound",
      referral_id: REFERRAL_ID,
      idempotent: false,
    });

    const result = await invokeApiHandler<ApiErrorResponse>(
      bindReferralHandler,
      {
        method: "POST",
        headers: {
          "x-idempotency-key": BIND_IDEMPOTENCY_KEY,
        },
        body: {
          start_payload: "OTHER7001",
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("REFERRAL_ALREADY_BOUND");
    expect(result.body.error.details).toMatchObject({
      status: "conflict",
      reason: "referral_already_bound",
    });
  });

  it("invite-stats calls referral_get_invite_stats and returns nested stats plus summary", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      referrals: {
        total_count: 3,
        qualified_count: 1,
        rewarded_count: 1,
        first_open_count: 2,
        valid_count: 2,
      },
      rewards: {
        KCOIN: {
          amount: "1000",
          count: 2,
        },
      },
      commissions: {
        pending_amount_kcoin: "25",
        granted_amount_kcoin: "75",
        total_amount_kcoin: "100",
        current_bps: 1000,
        current_rate: "0.1",
      },
      shares: {
        total_count: 4,
      },
      server_time: "2026-05-26T04:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      inviteStatsHandler,
      {
        method: "GET",
        headers: {
          "x-request-id": "req-invite-stats",
        },
        query: {
          from: "2026-05-01",
          to: "2026-05-26",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "referral_get_invite_stats",
      {
        p_user_id: USER_ID,
        p_from: "2026-05-01T00:00:00.000Z",
        p_to: "2026-05-27T00:00:00.000Z",
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-invite-stats",
          userId: USER_ID,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      summary: {
        invited_count: 3,
        valid_invite_count: 2,
        first_open_count: 2,
        total_reward_kcoin: 1000,
        commission_kcoin: 75,
        granted_commission_kcoin: 75,
        pending_commission_kcoin: 25,
        total_commission_kcoin: 100,
        commission_bps: 1000,
        commission_rate: 0.1,
        share_count: 4,
      },
    });
  });

  it("referral-records hides sensitive user UUIDs from RPC payloads", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      records: [
        {
          referral_id: REFERRAL_ID,
          inviter_user_id: USER_ID,
          invitee_user_id: FORGED_USER_ID,
          invitee_username: "friend_user",
          invitee_display_name: "Friend",
          invite_code: "INVITE7001",
          status: "qualified",
          first_open_order_id: "88888888-8888-4888-8888-888888888888",
          qualified_at: "2026-05-26T05:00:00.000Z",
          created_at: "2026-05-26T04:30:00.000Z",
          updated_at: "2026-05-26T05:00:00.000Z",
        },
      ],
      next_cursor: "2026-05-26T04:30:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      referralRecordsHandler,
      {
        method: "GET",
        headers: {
          "x-request-id": "req-referral-records",
        },
        query: {
          status: "qualified",
          limit: "10",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "referral_get_records",
      {
        p_user_id: USER_ID,
        p_cursor: null,
        p_status: "qualified",
        p_limit: 10,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-referral-records",
          userId: USER_ID,
          status: "qualified",
          limit: 10,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      items: [
        {
          referral_id: REFERRAL_ID,
          invitee_username: "friend_user",
          invitee_display_name: "Friend",
          status: "qualified",
        },
      ],
      next_cursor: "2026-05-26T04:30:00.000Z",
    });
    const referralRecordsData = result.body.data as {
      items: Record<string, unknown>[];
    };
    expect(referralRecordsData.items[0]).not.toHaveProperty("inviter_user_id");
    expect(referralRecordsData.items[0]).not.toHaveProperty("invitee_user_id");
    expect(referralRecordsData.items[0]).not.toHaveProperty(
      "first_open_order_id",
    );
  });

  it("commission-history calls referral_get_commission_history and hides user UUIDs", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      commissions: [
        {
          commission_id: COMMISSION_ID,
          referral_id: REFERRAL_ID,
          inviter_user_id: USER_ID,
          invitee_user_id: FORGED_USER_ID,
          invitee_username: "friend_user",
          invitee_display_name: "Friend",
          source_type: "gacha_open",
          source_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          base_amount_kcoin: "100",
          commission_bps: 1000,
          commission_amount_kcoin: "10",
          ledger_id: LEDGER_ID,
          status: "granted",
          created_at: "2026-05-26T06:00:00.000Z",
          claimed_at: "2026-05-26T06:05:00.000Z",
        },
      ],
      count: 1,
      next_cursor: "2026-05-26T06:00:00.000Z",
      server_time: "2026-05-26T06:10:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      commissionHistoryHandler,
      {
        method: "GET",
        headers: {
          "x-request-id": "req-commission-history",
        },
        query: {
          status: "GRANTED",
          cursor: "2026-05-26T07:00:00.000Z",
          limit: "10",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "referral_get_commission_history",
      {
        p_user_id: USER_ID,
        p_cursor: "2026-05-26T07:00:00.000Z",
        p_status: "granted",
        p_limit: 10,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-commission-history",
          userId: USER_ID,
          status: "granted",
          limit: 10,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      items: [
        {
          commission_id: COMMISSION_ID,
          invitee_username: "friend_user",
          invitee_display_name: "Friend",
          source_type: "gacha_open",
          base_amount_kcoin: 100,
          commission_bps: 1000,
          commission_amount_kcoin: 10,
          ledger_id: LEDGER_ID,
          status: "granted",
          claimed_at: "2026-05-26T06:05:00.000Z",
        },
      ],
      count: 1,
      next_cursor: "2026-05-26T06:00:00.000Z",
    });
    const commissionHistoryData = result.body.data as {
      items: Record<string, unknown>[];
    };
    expect(commissionHistoryData.items[0]).not.toHaveProperty(
      "inviter_user_id",
    );
    expect(commissionHistoryData.items[0]).not.toHaveProperty(
      "invitee_user_id",
    );
  });

  it("reward-history reads reward ledger rows for the verified session user only", async () => {
    const ledgerQuery = mockRewardHistoryQuery([
      {
        id: LEDGER_ID,
        user_id: USER_ID,
        currency_code: "KCOIN",
        entry_type: "credit",
        amount: "100",
        available_after: "100",
        source_type: "daily_check_in",
        source_id: SIGNIN_ID,
        source_ref: "internal-ref",
        idempotency_key: IDEMPOTENCY_KEY,
        metadata: {
          private_note: "do-not-expose",
        },
        created_at: "2026-05-26T06:30:00.000Z",
      },
    ]);

    const result = await invokeApiHandler<ApiSuccessResponse>(
      rewardHistoryHandler,
      {
        method: "GET",
        headers: {
          "x-request-id": "req-reward-history",
        },
        query: {
          source: "DAILY_CHECK_IN",
          cursor: "2026-05-27T00:00:00.000Z",
          limit: "10",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(getSupabaseAdminMock).toHaveBeenCalledTimes(1);
    expect(ledgerQuery.schema).toHaveBeenCalledWith("economy");
    expect(ledgerQuery.from).toHaveBeenCalledWith("currency_ledger");
    expect(ledgerQuery.builder.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(ledgerQuery.builder.eq).toHaveBeenCalledWith("entry_type", "credit");
    expect(ledgerQuery.builder.in).toHaveBeenCalledWith("source_type", [
      "daily_check_in",
    ]);
    expect(ledgerQuery.builder.lt).toHaveBeenCalledWith(
      "created_at",
      "2026-05-27T00:00:00.000Z",
    );
    expect(ledgerQuery.builder.limit).toHaveBeenCalledWith(11);
    expect(result.body.data).toMatchObject({
      items: [
        {
          reward_id: LEDGER_ID,
          source_type: "daily_check_in",
          source_label: "签到奖励",
          source_id: SIGNIN_ID,
          currency_code: "KCOIN",
          entry_type: "credit",
          amount: 100,
          created_at: "2026-05-26T06:30:00.000Z",
        },
      ],
      count: 1,
      next_cursor: null,
    });

    const rewardHistoryData = result.body.data as {
      items: Record<string, unknown>[];
    };
    expect(rewardHistoryData.items[0]).not.toHaveProperty("user_id");
    expect(rewardHistoryData.items[0]).not.toHaveProperty("idempotency_key");
    expect(rewardHistoryData.items[0]).not.toHaveProperty("source_ref");
    expect(rewardHistoryData.items[0]).not.toHaveProperty("metadata");
  });

  it("reward-history rejects forged user identity before reading ledger rows", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      rewardHistoryHandler,
      {
        method: "GET",
        query: {
          user_id: FORGED_USER_ID,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(getSupabaseAdminMock).not.toHaveBeenCalled();
  });

  it("claim-commission calls referral_claim_commission with header idempotency and session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      processed: true,
      claimed: true,
      claimed_count: 1,
      claimed_amount_kcoin: "10",
      amount_kcoin: "10",
      commission_ids: [COMMISSION_ID],
      ledger_id: LEDGER_ID,
      kcoin_balance_before: "500",
      kcoin_balance_after: "510",
      kcoin_locked_after: "0",
      balance_change: "10",
      status: "granted",
      idempotent: false,
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      claimCommissionHandler,
      {
        method: "POST",
        headers: {
          "x-request-id": "req-claim-commission",
          "x-idempotency-key": CLAIM_COMMISSION_IDEMPOTENCY_KEY,
        },
        body: {
          commission_ids: [COMMISSION_ID],
          idempotencyKey: "task:claim-commission-body-ignored",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "referral_claim_commission",
      {
        p_user_id: USER_ID,
        p_commission_ids: [COMMISSION_ID],
        p_idempotency_key: CLAIM_COMMISSION_IDEMPOTENCY_KEY,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-claim-commission",
          userId: USER_ID,
          idempotencyKey: CLAIM_COMMISSION_IDEMPOTENCY_KEY,
          commissionCount: 1,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      processed: true,
      claimed: true,
      claimed_count: 1,
      claimed_amount_kcoin: 10,
      amount_kcoin: 10,
      commission_ids: [COMMISSION_ID],
      ledger_id: LEDGER_ID,
      kcoin_balance_before: 500,
      kcoin_balance_after: 510,
      kcoin_locked_after: 0,
      balance_change: 10,
      status: "granted",
      idempotent: false,
    });
  });

  it("claim-commission without commission ids claims all pending rows", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      processed: true,
      claimed: false,
      claimed_count: 0,
      claimed_amount_kcoin: 0,
      amount_kcoin: 0,
      commission_ids: [],
      ledger_id: null,
      status: "no_pending",
      idempotent: false,
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      claimCommissionHandler,
      {
        method: "POST",
        body: {
          idempotencyKey: CLAIM_COMMISSION_IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "referral_claim_commission",
      expect.objectContaining({
        p_user_id: USER_ID,
        p_commission_ids: null,
        p_idempotency_key: CLAIM_COMMISSION_IDEMPOTENCY_KEY,
      }),
      expect.objectContaining({
        schema: "api",
      }),
    );
    expect(result.body.data).toMatchObject({
      claimed: false,
      claimed_count: 0,
      claimed_amount_kcoin: 0,
      status: "no_pending",
    });
  });

  it("claim-commission rejects forged commission facts before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      claimCommissionHandler,
      {
        method: "POST",
        body: {
          commissionIds: [COMMISSION_ID],
          user_id: FORGED_USER_ID,
          commission_amount_kcoin: 10,
          status: "pending",
          idempotencyKey: CLAIM_COMMISSION_IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("share-event records a Telegram share without exposing raw chat ids", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      processed: true,
      event_id: SHARE_EVENT_ID,
      share_type: "telegram_group",
      progress: {
        updated_count: 1,
      },
      idempotent: false,
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      shareEventHandler,
      {
        method: "POST",
        headers: {
          "x-request-id": "req-share-event",
          "x-idempotency-key": SHARE_IDEMPOTENCY_KEY,
        },
        body: {
          scene: "TASK_PAGE",
          referral_code: "INVITE7001",
          target_chat_type: "SUPERGROUP",
          target_chat_id_hash: "hash_telegram_group_001",
          message_id: 101,
          metadata: {
            surface: "invite-card",
          },
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "referral_record_share_event",
      {
        p_user_id: USER_ID,
        p_share_type: "telegram_group",
        p_payload: {
          scene: "TASK_PAGE",
          referral_code: "INVITE7001",
          target_chat_type: "SUPERGROUP",
          target_chat_id_hash: "hash_telegram_group_001",
          message_id: 101,
          target: "telegram",
          metadata: {
            surface: "invite-card",
          },
        },
        p_idempotency_key: SHARE_IDEMPOTENCY_KEY,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-share-event",
          userId: USER_ID,
          idempotencyKey: SHARE_IDEMPOTENCY_KEY,
          shareType: "telegram_group",
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      accepted: true,
      event_id: SHARE_EVENT_ID,
      share_type: "telegram_group",
    });
  });

  it("share-event rejects raw chat ids before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(shareEventHandler, {
      method: "POST",
      body: {
        scene: "TASK_PAGE",
        target_chat_id: "-100123",
        idempotencyKey: SHARE_IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});

function mockInviteCodeQuery(inviteCode: string | null): void {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: {
      invite_code: inviteCode,
    },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const schema = vi.fn().mockReturnValue({ from });

  getSupabaseAdminMock.mockReturnValue({ schema });
}

function mockRewardHistoryQuery(rows: Record<string, unknown>[]): {
  schema: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  builder: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    lt: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  };
} {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    lt: vi.fn(),
    order: vi.fn(),
    limit: vi.fn().mockResolvedValue({
      data: rows,
      error: null,
    }),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.lt.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);

  const from = vi.fn().mockReturnValue(builder);
  const schema = vi.fn().mockReturnValue({ from });

  getSupabaseAdminMock.mockReturnValue({ schema });

  return {
    schema,
    from,
    builder,
  };
}
