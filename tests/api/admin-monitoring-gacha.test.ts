import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ApiErrorResponse,
  type ApiSuccessResponse,
} from "../../api/_shared/handler";
import { invokeApiHandler } from "./_utils";

const { requireAdminMock, runReadRpcMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  runReadRpcMock: vi.fn(),
}));

vi.mock("../../api/_shared/requireAdmin.js", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("../../packages/server/src/db/transactions.js", () => ({
  runReadRpc: runReadRpcMock,
}));

const ADMIN_CONTEXT = {
  sessionId: "session-admin-monitoring-gacha-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-06-02T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "OPS",
  isSuperAdmin: false,
  permissions: ["gacha:read"],
};

describe("admin gacha monitoring API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    vi.resetModules();
    requireAdminMock.mockReset();
    runReadRpcMock.mockReset();
    requireAdminMock.mockResolvedValue(ADMIN_CONTEXT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns gacha aggregates through the api RPC facade", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      serverTime: "2026-06-01T00:00:00.000Z",
      window: {
        hours: 24,
        startedAt: "2026-05-31T00:00:00.000Z",
        endedAt: "2026-06-01T00:00:00.000Z",
      },
      metrics: {
        drawOrders: {
          key: "gacha_draw_order_count",
          value: 3,
        },
        drawFailures: {
          key: "gacha_draw_failure_count",
          value: 3,
          failedOrderCount: 2,
          anomalousResultCount: 1,
          status: "warning",
        },
      },
      byBox: [
        {
          boxId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          slug: "starter",
          drawResultCount: 2,
        },
      ],
      byRarity: [
        {
          rarityCode: "COMMON",
          drawResultCount: 1,
          ratio: 1 / 3,
        },
      ],
      sources: {
        drawOrders: {
          schema: "gacha",
          table: "draw_orders",
          countStrategy: "aggregate_count",
        },
      },
    });

    const { default: gachaMonitoringHandler } =
      await import("../../api/admin/monitoring/gacha");
    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(gachaMonitoringHandler, {
      method: "GET",
      url: "/api/admin/monitoring/gacha?windowHours=24",
      query: {
        windowHours: "24",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["gacha:read", "admin:read"],
        requireAll: false,
      }),
    );
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_get_gacha_monitoring",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_window_hours: 24,
        }),
      }),
    );
    expect(result.body).toMatchObject({
      ok: true,
      data: {
        metrics: {
          drawFailures: {
            value: 3,
          },
        },
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("user_id");
    expect(JSON.stringify(result.body)).not.toContain("internal stack");
  });

  it("clamps windowHours to 168 before calling the RPC", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      serverTime: "2026-06-01T00:00:00.000Z",
      window: {
        hours: 168,
        startedAt: "2026-05-25T00:00:00.000Z",
        endedAt: "2026-06-01T00:00:00.000Z",
      },
      metrics: {},
      sources: {},
    });

    const { default: gachaMonitoringHandler } =
      await import("../../api/admin/monitoring/gacha");
    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(gachaMonitoringHandler, {
      method: "GET",
      url: "/api/admin/monitoring/gacha?windowHours=999",
      query: {
        windowHours: "999",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          p_window_hours: 168,
        }),
      }),
    );
  });

  it("allows only GET before admin lookup", async () => {
    const { default: gachaMonitoringHandler } =
      await import("../../api/admin/monitoring/gacha");
    const result = await invokeApiHandler<ApiErrorResponse>(
      gachaMonitoringHandler,
      {
        method: "POST",
        url: "/api/admin/monitoring/gacha",
      },
    );

    expect(result.statusCode).toBe(405);
    expect(result.body).toMatchObject({
      error: {
        code: "METHOD_NOT_ALLOWED",
      },
    });
    expect(requireAdminMock).not.toHaveBeenCalled();
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });
});
