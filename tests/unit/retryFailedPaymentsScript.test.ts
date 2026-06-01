import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callRpcRawMock } = vi.hoisted(() => ({
  callRpcRawMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
}));

import {
  buildPaymentRetryIdempotencyKey,
  normalizePaymentRetryCandidatesPayload,
  parsePaymentRetryLimit,
  parsePaymentRetryRuntime,
  runRetryFailedPayments,
  runRetryFailedPaymentsManaged,
  type PaymentRetryCandidate,
  type RetryFailedPaymentsDeps,
} from "../../scripts/retry-failed-payments";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";

function createCandidate(
  overrides: Partial<PaymentRetryCandidate> = {},
): PaymentRetryCandidate {
  return {
    starOrderId: ORDER_ID,
    status: "paid",
    xtrAmount: 10,
    paidAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:01:00.000Z",
    fulfilledAt: null,
    retryCount: 0,
    maxRetryCount: 5,
    nextRetryAt: null,
    retryExhaustedAt: null,
    ...overrides,
  };
}

describe("scripts/retry-failed-payments", () => {
  beforeEach(() => {
    callRpcRawMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses retry env without requiring admin id for dry runs", () => {
    expect(
      parsePaymentRetryRuntime({
        PAYMENT_RETRY_DRY_RUN: "true",
        PAYMENT_RETRY_LIMIT: "3",
      }),
    ).toEqual({
      dryRun: true,
      limit: 3,
      onlyStatus: null,
      systemAdminUserId: null,
    });

    expect(parsePaymentRetryLimit(undefined)).toBe(10);
    expect(() => parsePaymentRetryLimit("0")).toThrow(
      "PAYMENT_RETRY_LIMIT must be a positive integer",
    );
  });

  it("requires a valid system admin id before non dry-run retries", async () => {
    const deps: RetryFailedPaymentsDeps = {
      listCandidates: vi.fn(async () => [createCandidate()]),
      retryFulfillment: vi.fn(),
    };

    await expect(
      runRetryFailedPayments(
        {
          dryRun: false,
          limit: 1,
          onlyStatus: null,
          requestId: "test-request",
          systemAdminUserId: null,
        },
        deps,
      ),
    ).rejects.toThrow("SYSTEM_ADMIN_USER_ID is required");

    expect(deps.retryFulfillment).not.toHaveBeenCalled();
  });

  it("prints dry-run candidates without calling the fulfillment RPC", async () => {
    const candidate = createCandidate();
    const deps: RetryFailedPaymentsDeps = {
      listCandidates: vi.fn(async () => [candidate]),
      retryFulfillment: vi.fn(),
    };

    const output = await runRetryFailedPayments(
      {
        dryRun: true,
        limit: 1,
        onlyStatus: null,
        requestId: "test-request",
        systemAdminUserId: null,
      },
      deps,
    );

    expect(output).toMatchObject({
      ok: true,
      dryRun: true,
      candidateCount: 1,
      processed: 0,
      retried: 0,
      skipped: 0,
      failed: 0,
      candidates: [candidate],
    });
    expect(deps.retryFulfillment).not.toHaveBeenCalled();
  });

  it("normalizes retry candidate rows returned by the api RPC", () => {
    expect(
      normalizePaymentRetryCandidatesPayload({
        orders: [
          {
            star_order_id: ORDER_ID,
            status: "paid",
            xtr_amount: "10",
            paid_at: "2026-05-31T00:00:00Z",
            updated_at: "2026-05-31T00:01:00Z",
            fulfilled_at: null,
            retry_count: "2",
            max_retry_count: "5",
            next_retry_at: "2026-05-31T00:06:00Z",
            retry_exhausted_at: null,
          },
        ],
      }),
    ).toEqual([
      {
        starOrderId: ORDER_ID,
        status: "paid",
        xtrAmount: 10,
        paidAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:01:00.000Z",
        fulfilledAt: null,
        retryCount: 2,
        maxRetryCount: 5,
        nextRetryAt: "2026-05-31T00:06:00.000Z",
        retryExhaustedAt: null,
      },
    ]);

    expect(() =>
      normalizePaymentRetryCandidatesPayload({ orders: [{}] }),
    ).toThrow("Candidate star order id must be a UUID");
  });

  it("calls admin_retry_payment_fulfillment with an attempt-scoped idempotency key", async () => {
    const candidate = createCandidate();
    const retryFulfillment = vi.fn(async () => ({
      star_order_id: ORDER_ID,
      status: "fulfilled",
      previous_status: "paid",
      fulfilled: true,
      idempotent: false,
      retry_count: 0,
      max_retry_count: 5,
      next_retry_at: null,
      retry_exhausted_at: null,
      audit_log_id: "33333333-3333-4333-8333-333333333333",
    }));
    const deps: RetryFailedPaymentsDeps = {
      listCandidates: vi.fn(async () => [candidate]),
      retryFulfillment,
    };

    const output = await runRetryFailedPayments(
      {
        dryRun: false,
        limit: 1,
        onlyStatus: null,
        requestId: "test-request",
        systemAdminUserId: ADMIN_ID,
      },
      deps,
    );

    expect(retryFulfillment).toHaveBeenCalledWith({
      candidate,
      idempotencyKey: buildPaymentRetryIdempotencyKey(ORDER_ID, 1),
      requestId: "test-request",
      systemAdminUserId: ADMIN_ID,
    });
    expect(output).toMatchObject({
      ok: true,
      processed: 1,
      retried: 1,
      skipped: 0,
      failed: 0,
      errors: [],
    });
    expect(output.results[0]).toMatchObject({
      starOrderId: ORDER_ID,
      action: "retried",
      idempotencyKey:
        "script-retry-payment:22222222-2222-4222-8222-222222222222:attempt-1",
      status: "fulfilled",
      previousStatus: "paid",
      fulfilled: true,
      idempotent: false,
      retryCount: 0,
      maxRetryCount: 5,
      nextRetryAt: null,
      retryExhaustedAt: null,
    });
  });

  it("wraps shell script runs in the managed worker runtime", async () => {
    mockSuccessfulWorkerRuntimeRpc();
    vi.stubEnv("FEATURE_RETRY_PAYMENTS_WORKER_ENABLED", "true");
    vi.stubEnv("FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED", "true");

    const candidate = createCandidate({ retryCount: 1 });
    const deps: RetryFailedPaymentsDeps = {
      listCandidates: vi.fn(async () => [candidate]),
      retryFulfillment: vi.fn(async () => ({
        star_order_id: ORDER_ID,
        status: "failed",
        previous_status: "paid",
        fulfilled: false,
        retryable: true,
        idempotent: false,
        retry_count: 2,
        max_retry_count: 5,
        next_retry_at: "2026-05-31T00:11:00Z",
        retry_exhausted_at: null,
      })),
    };

    const summary = await runRetryFailedPaymentsManaged(
      {
        dryRun: false,
        limit: 1,
        onlyStatus: null,
        requestId: "test-managed-payments",
        systemAdminUserId: ADMIN_ID,
      },
      deps,
    );

    expect(summary).toMatchObject({
      job_name: "retry_payments",
      request_id: "test-managed-payments",
      status: "success",
      processed_count: 1,
      failed_count: 0,
    });
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "worker_start_run",
      expect.objectContaining({
        p_job_name: "retry_payments",
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
    expect(deps.retryFulfillment).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          "script-retry-payment:22222222-2222-4222-8222-222222222222:attempt-2",
      }),
    );
  });
});

function mockSuccessfulWorkerRuntimeRpc(): void {
  callRpcRawMock.mockImplementation(
    async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "worker_start_run") {
        return {
          id: "44444444-4444-4444-8444-444444444444",
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
