import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STAR_ORDER_ID = "11111111-1111-4111-8111-111111111111";
const STAR_PAYMENT_ID = "33333333-3333-4333-8333-333333333333";
const ALERT_ID = "55555555-5555-4555-8555-555555555555";

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

  it("calls business monitoring endpoints with the selected window", async () => {
    const responseData = {
      window: {
        hours: 6,
        startedAt: "2026-06-01T00:00:00.000Z",
        endedAt: "2026-06-01T06:00:00.000Z",
      },
      metrics: [],
      sources: {
        limitPerQuery: 1000,
      },
      serverTime: "2026-06-01T06:00:00.000Z",
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            success: true,
            data: responseData,
          }),
          {
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const {
      fetchAdminAlerts,
      fetchBusinessMonitoring,
      fetchEconomyMonitoring,
      fetchGachaMonitoring,
      fetchMarketMonitoring,
    } = await import("../../apps/admin/src/admin.api");

    await fetchBusinessMonitoring({ windowHours: 6 });
    await fetchEconomyMonitoring({ windowHours: 6 });
    await fetchGachaMonitoring({ windowHours: 6 });
    await fetchMarketMonitoring({ windowHours: 6 });
    await fetchAdminAlerts({ status: "open,acknowledged", limit: 50 });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/admin/monitoring/business?windowHours=6",
      "/api/admin/monitoring/economy?windowHours=6",
      "/api/admin/monitoring/gacha?windowHours=6",
      "/api/admin/monitoring/market?windowHours=6",
      "/api/admin/alerts?status=open%2Cacknowledged&limit=50",
    ]);
  });

  it("calls alert lifecycle updates with reason, result, and idempotency", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            success: true,
            data: {
              alert_id: ALERT_ID,
              status: "resolved",
              audit_log_id: "66666666-6666-4666-8666-666666666666",
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

    const { updateAdminAlertStatus } =
      await import("../../apps/admin/src/admin.api");

    await updateAdminAlertStatus({
      alertId: ALERT_ID,
      action: "resolved",
      reason: "queue drained after retry",
      resolutionResult: "order fulfilled",
    });

    const call = fetchMock.mock.calls.at(0);
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("Expected updateAdminAlertStatus to call fetch.");
    }

    const [path, init] = call;
    expect(path).toBe("/api/admin/alerts");
    expect(init).toBeDefined();
    if (!init) {
      throw new Error("Expected updateAdminAlertStatus to pass init.");
    }

    const headers = readHeaders(init);
    const idempotencyKey = headers.get("X-Idempotency-Key") ?? "";

    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("include");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Admin-Confirm")).toBe("true");
    expect(idempotencyKey).toContain("admin-update-alert-status");
    expect(idempotencyKey).toContain(ALERT_ID);
    expect(readJsonBody(init)).toEqual({
      alertId: ALERT_ID,
      action: "resolved",
      reason: "queue drained after retry",
      resolutionResult: "order fulfilled",
      confirm: true,
    });
  });

  it("reports AdminApiError through sanitized admin observability", async () => {
    const captureException = vi.fn();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: false,
            success: false,
            error: {
              code: "ADMIN_MONITORING_FAILED",
              message: "Monitoring query failed.",
              details: {
                service_role_key: "must-not-be-reported",
              },
            },
            requestId: "req_monitoring_test",
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 500,
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Sentry", { captureException });

    const { AdminApiError, fetchMonitoring } =
      await import("../../apps/admin/src/admin.api");

    try {
      await fetchMonitoring({ windowHours: 24 });
      throw new Error("Expected fetchMonitoring to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(AdminApiError);
    }

    expect(captureException).toHaveBeenCalledTimes(1);
    const [, context] = captureException.mock.calls[0] ?? [];

    expect(context).toMatchObject({
      tags: {
        area: "admin",
        type: "admin_api_error",
      },
      extra: {
        requestId: "req_monitoring_test",
      },
    });
    expect(JSON.stringify(context)).not.toContain("must-not-be-reported");
    expect(JSON.stringify(context)).not.toContain("/api/admin/monitoring");
    expect(JSON.stringify(context)).not.toContain("ADMIN_MONITORING_FAILED");
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

  it("calls create-refund-record with refund context and without external completion", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            ok: true,
            success: true,
            data: {
              star_order_id: STAR_ORDER_ID,
              star_payment_id: STAR_PAYMENT_ID,
              star_refund_id: "44444444-4444-4444-8444-444444444444",
              status: "processing",
              external_refund_completed: false,
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

    const { createRefundRecord } =
      await import("../../apps/admin/src/admin.api");

    await createRefundRecord({
      starPaymentId: STAR_PAYMENT_ID,
      starOrderId: STAR_ORDER_ID,
      reason: "open Telegram Stars support refund",
      xtrAmount: 10,
      status: "processing",
      externalTicketId: "TG-STARS-TICKET-123",
      assetHandlingStrategy: "freeze",
      assetHandlingNote: "freeze delivered items until support completes",
      riskRestrictionRequired: true,
      riskRestrictionReason: "refund pending external support",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls.at(0);
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("Expected createRefundRecord to call fetch.");
    }

    const [path, init] = call;
    expect(path).toBe("/api/admin/create-refund-record");
    expect(init).toBeDefined();
    if (!init) {
      throw new Error("Expected createRefundRecord to pass init.");
    }

    const headers = readHeaders(init);
    const idempotencyKey = headers.get("X-Idempotency-Key") ?? "";

    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Admin-Confirm")).toBe("true");
    expect(idempotencyKey).toContain("admin-create-refund-record");
    expect(idempotencyKey).toContain(STAR_ORDER_ID);
    expect(readJsonBody(init)).toEqual({
      starPaymentId: STAR_PAYMENT_ID,
      starOrderId: STAR_ORDER_ID,
      reason: "open Telegram Stars support refund",
      xtrAmount: 10,
      status: "processing",
      refundContext: {
        externalTicketId: "TG-STARS-TICKET-123",
        assetHandlingStrategy: "freeze",
        assetHandlingNote: "freeze delivered items until support completes",
        riskRestrictionRequired: true,
        riskRestrictionReason: "refund pending external support",
        externalRefundCompleted: false,
      },
      confirm: true,
    });
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
