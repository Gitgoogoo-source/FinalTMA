import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import monitoringAlertScanCronHandler from "../../api/cron/monitoring-alert-scan";
import { RpcError } from "../../packages/server/src/db/rpc";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock } = vi.hoisted(() => ({
  callRpcRawMock: vi.fn(),
}));

vi.mock("../../packages/server/src/db/rpc.js", () => ({
  callRpcRaw: callRpcRawMock,
  RpcError: class RpcError extends Error {
    public readonly rpcName: string;

    constructor(params: { rpcName: string; error?: { message?: string } }) {
      super(params.error?.message ?? "RPC error");
      this.name = "RpcError";
      this.rpcName = params.rpcName;
    }
  },
}));

describe("monitoring alert scan cron API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.ENABLE_CRON_API = "true";
    process.env.CRON_SECRET = "test-cron-secret-0001";
    callRpcRawMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.CRON_SECRET;
  });

  it("calls monitoring_scan_alerts with cron auth and request context", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      server_time: "2026-06-01T05:35:00+00:00",
      idempotent: false,
      recorded_count: "3",
      app_event_id: "65000000-0000-4000-8000-000000009101",
      checks: {
        payment_total: 10,
      },
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(monitoringAlertScanCronHandler, {
      method: "POST",
      headers: {
        authorization: "Bearer test-cron-secret-0001",
        "x-request-id": "req-monitoring-alert-scan",
        "x-idempotency-key": "monitoring-alert-scan:test-001",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "monitoring_scan_alerts",
      {
        p_idempotency_key: "monitoring-alert-scan:test-001",
        p_request_context: {
          request_id: "req-monitoring-alert-scan",
          method: "POST",
          source: "vercel.cron",
          route: "monitoring-alert-scan",
        },
        p_now: null,
      },
      {
        schema: "api",
        context: {
          requestId: "req-monitoring-alert-scan",
          source: "cron.monitoring_alert_scan",
          idempotencyKey: "monitoring-alert-scan:test-001",
        },
      },
    );
    expect(result.body.data).toEqual({
      server_time: "2026-06-01T05:35:00.000Z",
      idempotent: false,
      recorded_count: 3,
      app_event_id: "65000000-0000-4000-8000-000000009101",
      checks: {
        payment_total: 10,
      },
    });
  });

  it("builds a minute bucket idempotency key when the header is absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T05:36:12.000Z"));
    callRpcRawMock.mockResolvedValueOnce({
      server_time: "2026-06-01T05:36:12+00:00",
      idempotent: false,
      recorded_count: 0,
      app_event_id: null,
      checks: {},
    });

    await invokeApiHandler(monitoringAlertScanCronHandler, {
      method: "GET",
      headers: {
        authorization: "Bearer test-cron-secret-0001",
      },
    });

    expect(callRpcRawMock).toHaveBeenCalledWith(
      "monitoring_scan_alerts",
      expect.objectContaining({
        p_idempotency_key: "monitoring-alert-scan:2026-06-01T05:36",
      }),
      expect.objectContaining({
        context: expect.objectContaining({
          idempotencyKey: "monitoring-alert-scan:2026-06-01T05:36",
        }),
      }),
    );
  });

  it("rejects invalid cron secrets before scanning", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      monitoringAlertScanCronHandler,
      {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-secret",
        },
      },
    );

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe("CRON_UNAUTHORIZED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("maps RPC failures to a stable cron error code", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "monitoring_scan_alerts",
        error: {
          message: "database unavailable",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      monitoringAlertScanCronHandler,
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-cron-secret-0001",
        },
      },
    );

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe("MONITORING_ALERT_SCAN_RPC_FAILED");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "cron.monitoring_alert_scan failed",
      expect.objectContaining({
        message: "database unavailable",
      }),
    );

    consoleErrorSpy.mockRestore();
  });
});
