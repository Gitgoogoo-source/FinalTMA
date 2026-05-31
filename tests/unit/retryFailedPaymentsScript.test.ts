import { describe, expect, it, vi } from "vitest";

import {
  buildPaymentRetryIdempotencyKey,
  normalizePaymentRetryCandidatesPayload,
  parsePaymentRetryLimit,
  parsePaymentRetryRuntime,
  runRetryFailedPayments,
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
    ...overrides,
  };
}

describe("scripts/retry-failed-payments", () => {
  it("parses retry env without requiring admin id for dry runs", () => {
    expect(
      parsePaymentRetryRuntime({
        PAYMENT_RETRY_DRY_RUN: "true",
        PAYMENT_RETRY_LIMIT: "3",
      }),
    ).toEqual({
      dryRun: true,
      limit: 3,
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
      },
    ]);

    expect(() =>
      normalizePaymentRetryCandidatesPayload({ orders: [{}] }),
    ).toThrow("Candidate star order id must be a UUID");
  });

  it("calls admin_retry_payment_fulfillment with a stable idempotency key", async () => {
    const candidate = createCandidate();
    const retryFulfillment = vi.fn(async () => ({
      star_order_id: ORDER_ID,
      status: "fulfilled",
      previous_status: "paid",
      fulfilled: true,
      idempotent: false,
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
        requestId: "test-request",
        systemAdminUserId: ADMIN_ID,
      },
      deps,
    );

    expect(retryFulfillment).toHaveBeenCalledWith({
      candidate,
      idempotencyKey: buildPaymentRetryIdempotencyKey(ORDER_ID),
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
      idempotencyKey: "script-retry-payment:22222222-2222-4222-8222-222222222222",
      status: "fulfilled",
      previousStatus: "paid",
      fulfilled: true,
      idempotent: false,
    });
  });
});
