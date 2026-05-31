import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import syncCampaignBoxStatusesCronHandler from "../../api/cron/sync-campaign-box-statuses";
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

function expectStandardSuccessEnvelope(body: ApiSuccessResponse): void {
  expect(body).toMatchObject({
    ok: true,
    success: true,
    data: expect.any(Object),
  });
}

function expectStandardErrorEnvelope(body: ApiErrorResponse): void {
  expect(body).toMatchObject({
    ok: false,
    success: false,
    error: {
      code: expect.any(String),
      message: expect.any(String),
    },
  });
}

describe("campaign and blind box status sync cron API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;
    process.env.ENABLE_CRON_API = "true";
    process.env.CRON_SECRET = "test-cron-secret-0001";
    callRpcRawMock.mockReset();
  });

  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;
    delete process.env.CRON_SECRET;
  });

  it("calls sync_campaign_box_statuses with the internal cron secret", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      campaigns_ended_count: "1",
      boxes_activated_count: 2,
      boxes_ended_count: 3,
      boxes_sold_out_count: 4,
      box_activation_blocked_count: 5,
      app_event_id: "65000000-0000-4000-8000-000000009001",
      server_time: "2026-05-31T02:30:00+00:00",
      duration_ms: "17",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(syncCampaignBoxStatusesCronHandler, {
      method: "POST",
      headers: {
        authorization: "Bearer test-cron-secret-0001",
        "x-request-id": "req-campaign-box-status-sync",
      },
    });

    expect(result.statusCode).toBe(200);
    expectStandardSuccessEnvelope(result.body);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "sync_campaign_box_statuses",
      {
        p_request_context: {
          request_id: "req-campaign-box-status-sync",
          method: "POST",
          source: "vercel.cron",
        },
        p_now: null,
      },
      {
        schema: "api",
        context: {
          requestId: "req-campaign-box-status-sync",
          source: "cron.sync_campaign_box_statuses",
        },
      },
    );
    expect(result.body.data).toEqual({
      campaigns_ended_count: 1,
      boxes_activated_count: 2,
      boxes_ended_count: 3,
      boxes_sold_out_count: 4,
      box_activation_blocked_count: 5,
      app_event_id: "65000000-0000-4000-8000-000000009001",
      server_time: "2026-05-31T02:30:00.000Z",
      duration_ms: 17,
    });
  });

  it("rejects refresh requests with an invalid cron secret", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      syncCampaignBoxStatusesCronHandler,
      {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-secret",
        },
      },
    );

    expect(result.statusCode).toBe(401);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("CRON_UNAUTHORIZED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects preview requests when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "development";
    process.env.VERCEL_ENV = "preview";

    const result = await invokeApiHandler<ApiErrorResponse>(
      syncCampaignBoxStatusesCronHandler,
      {
        method: "POST",
      },
    );

    expect(result.statusCode).toBe(500);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("CRON_SECRET_MISSING");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects invalid RPC result payloads", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      campaigns_ended_count: 1,
    });

    const result = await invokeApiHandler<ApiErrorResponse>(
      syncCampaignBoxStatusesCronHandler,
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-cron-secret-0001",
        },
      },
    );

    expect(result.statusCode).toBe(500);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe(
      "CAMPAIGN_BOX_STATUS_SYNC_RESULT_INVALID",
    );
  });

  it("maps RPC failures to a stable cron error code", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "sync_campaign_box_statuses",
        error: {
          message: "database unavailable",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      syncCampaignBoxStatusesCronHandler,
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-cron-secret-0001",
        },
      },
    );

    expect(result.statusCode).toBe(500);
    expectStandardErrorEnvelope(result.body);
    expect(result.body.error.code).toBe("CAMPAIGN_BOX_STATUS_SYNC_RPC_FAILED");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "cron.sync_campaign_box_statuses failed",
      expect.objectContaining({
        message: "database unavailable",
      }),
    );

    consoleErrorSpy.mockRestore();
  });
});
