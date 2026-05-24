import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "../../api/_shared/handler";
import claimRewardHandler from "../../api/album/claim-reward";
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
const MILESTONE_ID = "22222222-2222-4222-8222-222222222222";
const BOOK_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "album:claim-reward-focused-0001";
const BODY_IDEMPOTENCY_KEY = "album:claim-reward-body";

describe("album claim reward API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-album-claim-reward-test",
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
      claimRewardHandler,
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
      claimRewardHandler,
      {
        method: "POST",
        body: {
          milestone_id: MILESTONE_ID,
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
      claimRewardHandler,
      {
        method: "POST",
        body: {
          milestone_id: MILESTONE_ID,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("passes only trusted request fields to album_claim_milestone", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      milestone_id: MILESTONE_ID,
      book_id: BOOK_ID,
      status: "claimed",
      reward: [{ currency: "FGEMS", amount: 33 }],
      ledger_results: [
        {
          currency_code: "FGEMS",
          available_before: 10,
          available_after: 43,
        },
      ],
      claimed_at: "2026-05-24T15:00:00.000Z",
    });

    const result = await invokeApiHandler<ApiSuccessResponse>(
      claimRewardHandler,
      {
        method: "POST",
        headers: {
          "x-request-id": "req-album-claim-reward-test",
          "x-idempotency-key": IDEMPOTENCY_KEY,
        },
        body: {
          milestone_id: MILESTONE_ID,
          expected_milestone_version: 3,
          idempotency_key: BODY_IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "album_claim_milestone",
      {
        p_user_id: USER_ID,
        p_milestone_id: MILESTONE_ID,
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_expected_milestone_version: 3,
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-album-claim-reward-test",
          userId: USER_ID,
          milestoneId: MILESTONE_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          expectedMilestoneVersion: 3,
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      milestone_id: MILESTONE_ID,
      book_id: BOOK_ID,
      status: "claimed",
      rewards: [
        {
          reward_type: "FGEMS",
          amount: 33,
          label: "FGEMS",
        },
      ],
      balance_changes: [
        {
          currency: "FGEMS",
          delta: 33,
          balance_after: 43,
        },
      ],
      claimed_at: "2026-05-24T15:00:00.000Z",
    });
  });

  it("maps unreached milestones to a stable conflict", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "album_claim_milestone",
        error: {
          message: "milestone not reached: collected 0, required 1",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      claimRewardHandler,
      {
        method: "POST",
        body: {
          milestone_id: MILESTONE_ID,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("MILESTONE_NOT_REACHED");
  });

  it("maps stale milestone versions to a stable conflict", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "album_claim_milestone",
        error: {
          message: "milestone version mismatch: expected 2, current 3",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      claimRewardHandler,
      {
        method: "POST",
        body: {
          milestone_id: MILESTONE_ID,
          expected_milestone_version: 2,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("MILESTONE_VERSION_MISMATCH");
  });
});
