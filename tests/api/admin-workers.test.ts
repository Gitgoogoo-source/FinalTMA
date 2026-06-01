import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import runWorkerNowHandler from "../../api/admin/workers/run-now";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock, requireAdminMock, runWriteRpcMock } = vi.hoisted(
  () => ({
    callRpcRawMock: vi.fn(),
    requireAdminMock: vi.fn(),
    runWriteRpcMock: vi.fn(),
  }),
);

vi.mock("../../api/_shared/requireAdmin.js", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
}));

vi.mock("../../packages/server/src/db/transactions.js", () => ({
  runWriteRpc: runWriteRpcMock,
}));

const ADMIN_CONTEXT = {
  sessionId: "session-admin-workers-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-06-01T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "SUPER_ADMIN",
  isSuperAdmin: true,
  permissions: ["*"],
};

const JOB_RUN_ID = "44444444-4444-4444-8444-444444444444";
const AUDIT_LOG_ID = "55555555-5555-4555-8555-555555555555";
const STARTED_AT = "2026-06-01T00:00:00.000Z";
const FINISHED_AT = "2026-06-01T00:00:02.000Z";

describe("admin workers API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.FEATURE_WORKERS_MANUAL_RUN_ENABLED = "true";
    process.env.FEATURE_MARKET_STATS_WORKER_ENABLED = "true";
    process.env.FEATURE_MARKET_ENABLED = "true";
    requireAdminMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
    callRpcRawMock.mockReset();
    runWriteRpcMock.mockReset();
    runWriteRpcMock.mockResolvedValue({
      audit_log_id: AUDIT_LOG_ID,
    });
  });

  afterEach(() => {
    delete process.env.FEATURE_WORKERS_MANUAL_RUN_ENABLED;
    delete process.env.FEATURE_MARKET_STATS_WORKER_ENABLED;
    delete process.env.FEATURE_MARKET_ENABLED;
  });

  it("requires confirmation before manually running a worker", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      runWorkerNowHandler,
      {
        method: "POST",
        headers: {
          "x-idempotency-key": "worker-run-now-test-001",
        },
        body: {
          jobName: "market_stats",
          reason: "manual run from test",
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("ADMIN_CONFIRMATION_REQUIRED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
    expect(runWriteRpcMock).not.toHaveBeenCalled();
  });

  it("runs the worker and writes an admin audit log", async () => {
    mockMarketStatsWorker({
      status: "success",
      price_snapshot_count: 2,
      depth_snapshot_count: 3,
      price_health_update_count: 4,
      error: null,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(runWorkerNowHandler, {
      method: "POST",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "worker-run-now-test-002",
        "x-request-id": "req-worker-run-now",
        "x-forwarded-for": "127.0.0.55",
        "user-agent": "vitest-admin-workers",
      },
      body: {
        jobName: "market_stats",
        params: {
          limit: 5,
        },
        reason: "refresh stats after deployment",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.data).toMatchObject({
      job_run_id: JOB_RUN_ID,
      job_name: "market_stats",
      status: "success",
      processed_count: 9,
      failed_count: 0,
      audit_log_id: AUDIT_LOG_ID,
    });
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["ops:write"],
      }),
    );
    expect(getRpcCall("market_refresh_price_stats")).toBeDefined();
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_write_audit_log",
        traceId: "req-worker-run-now",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_action: "worker.run_now",
          p_target_schema: "ops",
          p_target_table: "job_runs",
          p_target_id: JOB_RUN_ID,
          p_reason: "refresh stats after deployment",
          p_after_state: expect.objectContaining({
            job_name: "market_stats",
            request_id: "req-worker-run-now",
            status: "success",
            processed_count: 9,
            failed_count: 0,
            idempotency_key: "worker-run-now-test-002",
          }),
          p_ip_hash: expect.any(String),
          p_user_agent: "vitest-admin-workers",
        }),
      }),
    );
  });

  it("records skipped runs without executing business RPCs when the worker flag is disabled", async () => {
    process.env.FEATURE_MARKET_STATS_WORKER_ENABLED = "false";
    mockSkippedWorker();

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(runWorkerNowHandler, {
      method: "POST",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "worker-run-now-test-003",
      },
      body: {
        jobName: "market_stats",
        reason: "verify disabled flag",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.data).toMatchObject({
      job_name: "market_stats",
      status: "skipped",
      processed_count: 0,
      failed_count: 0,
      error_message: "FEATURE_MARKET_STATS_WORKER_ENABLED disabled",
      audit_log_id: AUDIT_LOG_ID,
    });
    expect(
      callRpcRawMock.mock.calls.some(([rpcName]) => {
        return rpcName === "market_refresh_price_stats";
      }),
    ).toBe(false);
    expect(runWriteRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "admin_write_audit_log",
        args: expect.objectContaining({
          p_action: "worker.run_now",
          p_after_state: expect.objectContaining({
            status: "skipped",
          }),
        }),
      }),
    );
  });

  it("does not execute the worker task again for the same job idempotency key", async () => {
    callRpcRawMock.mockImplementation(async (rpcName: string) => {
      if (rpcName === "worker_start_run") {
        return {
          id: JOB_RUN_ID,
          job_name: "market_stats",
          request_id: "req-original-worker-run",
          started_at: STARTED_AT,
          finished_at: FINISHED_AT,
          status: "success",
          processed_count: 9,
          failed_count: 0,
          error_message: null,
          result: {
            price_snapshot_count: 2,
            depth_snapshot_count: 3,
            price_health_update_count: 4,
          },
          idempotent: true,
        };
      }

      throw new Error(`Unexpected RPC call: ${rpcName}`);
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(runWorkerNowHandler, {
      method: "POST",
      headers: {
        "x-admin-confirm": "true",
        "x-idempotency-key": "worker-run-now-test-004",
        "x-request-id": "req-worker-run-now-replay",
      },
      body: {
        jobName: "market_stats",
        reason: "retry same request after timeout",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.data).toMatchObject({
      job_run_id: JOB_RUN_ID,
      job_name: "market_stats",
      request_id: "req-original-worker-run",
      status: "success",
      processed_count: 9,
      failed_count: 0,
      idempotent: true,
    });
    expect(getRpcCall("worker_start_run")).toBeDefined();
    expect(
      callRpcRawMock.mock.calls.some(([rpcName]) => {
        return rpcName === "worker_try_acquire_lock";
      }),
    ).toBe(false);
    expect(
      callRpcRawMock.mock.calls.some(([rpcName]) => {
        return rpcName === "market_refresh_price_stats";
      }),
    ).toBe(false);
    expect(
      callRpcRawMock.mock.calls.some(([rpcName]) => {
        return rpcName === "worker_finish_run";
      }),
    ).toBe(false);
  });
});

function mockMarketStatsWorker(payload: Record<string, unknown>): void {
  callRpcRawMock.mockImplementation(
    async (rpcName: string, params: Record<string, unknown>) => {
      if (rpcName === "worker_start_run") {
        return {
          id: JOB_RUN_ID,
          started_at: STARTED_AT,
        };
      }

      if (rpcName === "worker_try_acquire_lock") {
        return {
          acquired: true,
          expires_at: "2026-06-01T00:10:00.000Z",
        };
      }

      if (rpcName === "market_refresh_price_stats") {
        return payload;
      }

      if (rpcName === "worker_finish_run") {
        return {
          id: params.p_job_run_id,
          finished_at: FINISHED_AT,
        };
      }

      if (rpcName === "worker_release_lock") {
        return {
          released: true,
        };
      }

      throw new Error(`Unexpected RPC call: ${rpcName}`);
    },
  );
}

function mockSkippedWorker(): void {
  callRpcRawMock.mockImplementation(
    async (rpcName: string, params: Record<string, unknown>) => {
      if (rpcName === "worker_start_run") {
        return {
          id: JOB_RUN_ID,
          started_at: STARTED_AT,
        };
      }

      if (rpcName === "worker_finish_run") {
        return {
          id: params.p_job_run_id,
          finished_at: FINISHED_AT,
        };
      }

      throw new Error(`Unexpected RPC call: ${rpcName}`);
    },
  );
}

function getRpcCall(
  rpcName: string,
): [string, Record<string, unknown>, Record<string, unknown>] {
  const call = callRpcRawMock.mock.calls.find(([name]) => name === rpcName);

  if (!call) {
    throw new Error(`Missing RPC call: ${rpcName}`);
  }

  return call as [string, Record<string, unknown>, Record<string, unknown>];
}
