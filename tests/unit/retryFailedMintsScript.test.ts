import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callRpcRawMock, getSupabaseAdminClientMock, runMintQueueWorkerMock } =
  vi.hoisted(() => ({
    callRpcRawMock: vi.fn(),
    getSupabaseAdminClientMock: vi.fn(),
    runMintQueueWorkerMock: vi.fn(),
  }));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
}));

vi.mock("../../packages/server/src/db/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: getSupabaseAdminClientMock,
}));

vi.mock("../../packages/server/src/ton/nft.js", () => ({
  createTonNftService: vi.fn(() => ({
    provider: "test-ton-provider",
  })),
}));

vi.mock("../../api/cron/retry-mint-queue.js", () => ({
  runMintQueueWorker: runMintQueueWorkerMock,
}));

import {
  parseMintRetryRuntime,
  runRetryFailedMints,
  runRetryFailedMintsManaged,
} from "../../scripts/retry-failed-mints";

const MINT_QUEUE_ID = "11111111-1111-4111-8111-111111111111";

describe("scripts/retry-failed-mints", () => {
  beforeEach(() => {
    callRpcRawMock.mockReset();
    getSupabaseAdminClientMock.mockReset();
    runMintQueueWorkerMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses generic retry env aliases", () => {
    expect(
      parseMintRetryRuntime({
        DRY_RUN: "true",
        LIMIT: "3",
        ONLY_STATUS: "retrying",
      }),
    ).toEqual({
      dryRun: true,
      limit: 3,
      onlyStatus: ["retrying"],
    });
  });

  it("passes ONLY_STATUS through to the actual Mint worker run", async () => {
    const mintQueueDb = createMintQueueDb([
      {
        id: MINT_QUEUE_ID,
        status: "retrying",
        attempt_count: 2,
        max_attempts: 5,
        next_attempt_at: null,
        priority: 0,
        error_message: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(mintQueueDb.db);
    runMintQueueWorkerMock.mockResolvedValue({
      scanned: 1,
      claimed: 1,
      submitted: 1,
      confirming: 0,
      minted: 0,
      retrying: 0,
      manualReview: 0,
      skipped: 0,
      errors: [],
      serverTime: "2026-06-01T00:00:00.000Z",
    });

    const output = await runRetryFailedMints({
      dryRun: false,
      limit: 5,
      onlyStatus: ["retrying"],
      requestId: "req-retry-mints-test",
    });

    expect(output).toMatchObject({
      ok: true,
      processed: 1,
      retried: 1,
      failed: 0,
    });
    expect(mintQueueDb.state.statuses).toEqual(["retrying"]);
    expect(runMintQueueWorkerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-retry-mints-test",
        statusFilter: ["retrying"],
        env: expect.objectContaining({
          TON_MINT_BATCH_SIZE: "5",
        }),
      }),
    );
  });

  it("wraps shell script runs in the managed worker runtime", async () => {
    mockSuccessfulWorkerRuntimeRpc();
    vi.stubEnv("FEATURE_RETRY_MINTS_WORKER_ENABLED", "true");
    vi.stubEnv("FEATURE_MINT_WORKER_ENABLED", "true");
    vi.stubEnv("FEATURE_TON_MINT_ENABLED", "true");

    const mintQueueDb = createMintQueueDb([
      {
        id: MINT_QUEUE_ID,
        status: "queued",
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: null,
        priority: 0,
        error_message: null,
      },
    ]);
    getSupabaseAdminClientMock.mockReturnValue(mintQueueDb.db);
    runMintQueueWorkerMock.mockResolvedValue({
      scanned: 1,
      claimed: 1,
      submitted: 1,
      confirming: 0,
      minted: 0,
      retrying: 0,
      manualReview: 0,
      skipped: 0,
      errors: [],
      serverTime: "2026-06-01T00:00:00.000Z",
    });

    const summary = await runRetryFailedMintsManaged({
      dryRun: false,
      limit: 1,
      onlyStatus: null,
      requestId: "test-managed-mints",
    });

    expect(summary).toMatchObject({
      job_name: "retry_mints",
      request_id: "test-managed-mints",
      status: "success",
      processed_count: 1,
      failed_count: 0,
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "worker_start_run",
      expect.objectContaining({
        p_job_name: "retry_mints",
        p_triggered_by: "script",
      }),
      expect.any(Object),
    );
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "worker_finish_run",
      expect.objectContaining({
        p_status: "success",
        p_processed_count: 1,
        p_failed_count: 0,
      }),
      expect.any(Object),
    );
  });
});

function createMintQueueDb(rows: Array<Record<string, unknown>>) {
  const state: { statuses: string[] | null } = {
    statuses: null,
  };
  const builder = {
    select: vi.fn(() => builder),
    in: vi.fn((_column: string, statuses: string[]) => {
      state.statuses = statuses;
      return builder;
    }),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  const db = {
    schema: vi.fn(() => ({
      from: vi.fn(() => builder),
    })),
  };

  return {
    db,
    state,
  };
}

function mockSuccessfulWorkerRuntimeRpc(): void {
  callRpcRawMock.mockImplementation(
    async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "worker_start_run") {
        return {
          id: "22222222-2222-4222-8222-222222222222",
          job_name: args.p_job_name,
          request_id: args.p_request_id,
          triggered_by: args.p_triggered_by,
          status: "running",
          started_at: "2026-06-01T00:00:00.000Z",
          finished_at: null,
          processed_count: 0,
          failed_count: 0,
          error_message: null,
          result: {},
          idempotent: false,
        };
      }

      if (functionName === "worker_try_acquire_lock") {
        return {
          acquired: true,
          expires_at: "2026-06-01T00:10:00.000Z",
        };
      }

      if (functionName === "worker_finish_run") {
        return {
          finished_at: "2026-06-01T00:00:01.000Z",
        };
      }

      if (functionName === "worker_release_lock") {
        return {};
      }

      throw new Error(`Unexpected RPC ${functionName}`);
    },
  );
}
