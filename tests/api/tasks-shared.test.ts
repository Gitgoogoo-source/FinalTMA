import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import {
  callTaskUserRpcRaw,
  getTaskIdempotencyKey,
  mapTaskRpcError,
  parseTaskJsonBodyInput,
  withTaskApiHandler,
} from "../../api/tasks/_shared";
import {
  CheckInBodySchema,
  ShareEventBodySchema,
} from "../../packages/validation/src/task.schemas";
import { RpcError } from "../../packages/server/src/db/rpc.js";
import { invokeApiHandler, type ApiInvokeResult } from "./_utils";

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
const RATE_LIMIT_USER_IDS = {
  "tasks.claim": "22222222-2222-4222-8222-222222222222",
  "tasks.check_in": "33333333-3333-4333-8333-333333333333",
  "tasks.referral_link": "44444444-4444-4444-8444-444444444444",
} as const;

describe("task API shared rules", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-task-shared-rules-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("wraps task handlers with the shared API envelope and verified session", async () => {
    const handler = withTaskApiHandler(
      async (_req, _res, ctx) => ({
        requestId: ctx.requestId,
        userId: ctx.session.userId,
      }),
      {
        methods: ["GET"],
      },
    );

    const result = await invokeApiHandler<
      ApiSuccessResponse<{ requestId: string; userId: string }>
    >(handler, {
      method: "GET",
      headers: {
        "x-request-id": "req-task-shared-handler",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.success).toBe(true);
    expect(result.body.data).toEqual({
      requestId: "req-task-shared-handler",
      userId: USER_ID,
    });
    expect(requireSessionMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["tasks.claim", 30],
    ["tasks.check_in", 10],
    ["tasks.referral_link", 20],
  ] as const)(
    "applies the post-session user rate limit for %s",
    async (action, maxRequests) => {
      const routeHandler = vi.fn(async () => ({
        accepted: true,
      }));
      const handler = withTaskApiHandler(routeHandler, {
        methods: ["POST"],
        rateLimit: {
          action,
        },
      });
      requireSessionMock.mockResolvedValue({
        sessionId: `session-rate-limit-${action}`,
        userId: RATE_LIMIT_USER_IDS[action],
        telegramUserId: 9001,
        userStatus: "active",
        expiresAt: "2026-05-28T00:00:00.000Z",
        sessionTokenHash: `session-hash-${action}`,
      });

      let result: ApiInvokeResult<
        ApiSuccessResponse | ApiErrorResponse
      > | null = null;

      for (let attempt = 0; attempt <= maxRequests; attempt += 1) {
        result = await invokeApiHandler<ApiSuccessResponse | ApiErrorResponse>(
          handler,
          {
            method: "POST",
            headers: {
              "x-forwarded-for": `203.0.113.${attempt}`,
            },
          },
        );
      }

      expect(result?.statusCode).toBe(429);
      expect((result?.body as ApiErrorResponse).error.code).toBe(
        "RATE_LIMITED",
      );
      expect((result?.body as ApiErrorResponse).error.details).toMatchObject({
        action,
        rejected: {
          scope: "user",
        },
      });
      expect(routeHandler).toHaveBeenCalledTimes(maxRequests);
      expect(requireSessionMock).toHaveBeenCalledTimes(maxRequests + 1);
    },
  );

  it("reads idempotency from the header before falling back to the body", async () => {
    const handler = withTaskApiHandler(
      async (req) =>
        await parseTaskJsonBodyInput(req, CheckInBodySchema, {
          maxBytes: 4 * 1024,
        }),
      {
        methods: ["POST"],
      },
    );

    const result = await invokeApiHandler<ApiSuccessResponse<unknown>>(
      handler,
      {
        method: "POST",
        headers: {
          "x-idempotency-key": "task:header:0001",
        },
        body: {
          idempotencyKey: "task:body:0001",
        },
      },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.data).toMatchObject({
      idempotencyKey: "task:header:0001",
    });
  });

  it("preserves body idempotency validation when the header is absent", async () => {
    const handler = withTaskApiHandler(
      async (req) => await parseTaskJsonBodyInput(req, ShareEventBodySchema),
      {
        methods: ["POST"],
      },
    );

    const result = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "POST",
      body: {
        scene: "TASK_PAGE",
        idempotency_key: 123,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("uses only the session user id when calling task RPCs", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      ok: true,
    });

    const result = await callTaskUserRpcRaw(
      "task_daily_check_in",
      { userId: USER_ID },
      {
        p_user_id: FORGED_USER_ID,
        p_idempotency_key: "task:signin:0001",
      },
      {
        requestId: "req-task-session-user",
        idempotencyKey: "task:signin:0001",
      },
    );

    expect(result).toEqual({ ok: true });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "task_daily_check_in",
      {
        p_user_id: USER_ID,
        p_idempotency_key: "task:signin:0001",
      },
      expect.objectContaining({
        schema: "api",
        context: expect.objectContaining({
          requestId: "req-task-session-user",
          userId: USER_ID,
          idempotencyKey: "task:signin:0001",
        }),
      }),
    );
  });

  it("maps task RPC errors to stable public error codes", () => {
    const idempotencyConflict = mapTaskRpcError(
      new RpcError({
        rpcName: "task_claim_reward",
        error: { message: "idempotency conflict" },
      }),
      "TASK_RPC_FAILED",
      "任务接口失败。",
    );
    const notCompleted = mapTaskRpcError(
      new RpcError({
        rpcName: "task_claim_reward",
        error: { message: "task is not completed" },
      }),
      "TASK_RPC_FAILED",
      "任务接口失败。",
    );

    expect(idempotencyConflict.statusCode).toBe(409);
    expect(idempotencyConflict.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(notCompleted.statusCode).toBe(400);
    expect(notCompleted.code).toBe("TASK_NOT_COMPLETED");
  });

  it("exposes the same header plus body idempotency helper for custom normalizers", () => {
    const req = {
      headers: {},
    } as Parameters<typeof getTaskIdempotencyKey>[0];

    expect(
      getTaskIdempotencyKey(req, {
        idempotency_key: "task:body-fallback:0001",
      }),
    ).toBe("task:body-fallback:0001");
  });
});
