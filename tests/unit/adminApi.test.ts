import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STAR_ORDER_ID = "11111111-1111-4111-8111-111111111111";

describe("admin api client", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls retry-payment-fulfillment with confirmation and idempotency", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            success: true,
            data: {
              audit_log_id: "22222222-2222-4222-8222-222222222222",
              serverTime: "2026-05-31T00:00:00.000Z",
            },
          }),
          {
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { retryPaymentFulfillment } =
      await import("../../apps/admin/src/admin.api");

    await retryPaymentFulfillment({
      starOrderId: STAR_ORDER_ID,
      reason: "manual retry after webhook fulfillment failure",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls.at(0);
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("Expected retryPaymentFulfillment to call fetch.");
    }

    const [path, init] = call;
    expect(path).toBe("/api/admin/retry-payment-fulfillment");
    expect(init).toBeDefined();
    if (!init) {
      throw new Error("Expected retryPaymentFulfillment to pass init.");
    }

    const headers = readHeaders(init);
    const idempotencyKey = headers.get("X-Idempotency-Key") ?? "";

    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Admin-Confirm")).toBe("true");
    expect(idempotencyKey).toContain("admin-retry-payment");
    expect(idempotencyKey).toContain(STAR_ORDER_ID);
    expect(readJsonBody(init)).toEqual({
      starOrderId: STAR_ORDER_ID,
      reason: "manual retry after webhook fulfillment failure",
      confirm: true,
    });
  });

  it("preserves admin api errors for retry failures", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: false,
            success: false,
            error: {
              code: "PAYMENT_NOT_RETRYABLE",
              message: "Payment order cannot be retried.",
            },
            requestId: "req_retry_payment_test",
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 409,
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { AdminApiError, retryPaymentFulfillment } =
      await import("../../apps/admin/src/admin.api");

    try {
      await retryPaymentFulfillment({
        starOrderId: STAR_ORDER_ID,
        reason: "manual retry after webhook fulfillment failure",
      });
      throw new Error("Expected retryPaymentFulfillment to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminApiError);
      expect(error).toMatchObject({
        code: "PAYMENT_NOT_RETRYABLE",
        message: "Payment order cannot be retried.",
        requestId: "req_retry_payment_test",
        status: 409,
      });
    }
  });
});

function readHeaders(init: RequestInit): Headers {
  if (!(init.headers instanceof Headers)) {
    throw new Error("Expected adminRequest to pass a Headers instance.");
  }

  return init.headers;
}

function readJsonBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== "string") {
    throw new Error("Expected adminRequest to serialize JSON body.");
  }

  return JSON.parse(init.body) as Record<string, unknown>;
}
