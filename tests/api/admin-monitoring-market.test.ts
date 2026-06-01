import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiSuccessResponse } from "../../api/_shared/handler";
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
  sessionId: "session-admin-market-monitoring-test",
  userId: "11111111-1111-4111-8111-111111111111",
  telegramUserId: 7001,
  userStatus: "active",
  expiresAt: "2026-06-01T00:00:00.000Z",
  sessionTokenHash: "session-hash",
  adminId: "22222222-2222-4222-8222-222222222222",
  roleId: "33333333-3333-4333-8333-333333333333",
  roleCode: "OPS",
  isSuperAdmin: false,
  permissions: ["market:read"],
};

type MarketMonitoringResponse = {
  serverTime: string;
  window: {
    hours: number;
    startedAt: string;
    endedAt: string;
  };
  market: {
    trades: Record<string, unknown>;
    listings: Record<string, unknown>;
    priceHealth: Record<string, unknown>;
  };
  sources: Record<string, Record<string, unknown>>;
};

type MarketListingDetailResponse = {
  id: string;
  status: string;
  templateId: string;
  rarityCode: string;
  itemCount: number;
  remainingCount: number;
  items: Array<{
    itemInstanceId: string;
    status: string;
  }>;
  orders: unknown[];
  events: unknown[];
  sources: Record<string, unknown>;
  serverTime: string;
};

describe("admin market monitoring API", () => {
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

  it("rejects non-GET requests before admin or database access", async () => {
    const { default: handler } =
      await import("../../api/admin/monitoring/market");
    const result = await invokeApiHandler(handler, {
      method: "POST",
      url: "/api/admin/monitoring/market",
    });

    expect(result.statusCode).toBe(405);
    expect(requireAdminMock).not.toHaveBeenCalled();
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });

  it("returns market summaries through the api RPC facade", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      serverTime: "2026-06-01T12:00:00.000Z",
      window: {
        hours: 168,
        startedAt: "2026-05-25T12:00:00.000Z",
        endedAt: "2026-06-01T12:00:00.000Z",
      },
      metrics: {
        trades: {
          status: "warning",
        },
      },
      market: {
        trades: {
          orderCount: 2,
          completedOrderCount: 1,
          totalVolumeKcoin: 300,
          status: "warning",
        },
        listings: {
          activeListingCount: 2,
          status: "ok",
        },
        priceHealth: {
          activeRuleCount: 1,
          priceSnapshotCount: 1,
          status: "warning",
          recentSnapshots: [
            {
              templateId: "44444444-4444-4444-8444-444444444444",
              rarityCode: "rare",
            },
          ],
        },
      },
      sources: {
        marketOrders: {
          schema: "market",
          table: "orders",
          aggregation: "status + completed totals",
        },
      },
    });

    const { default: handler } =
      await import("../../api/admin/monitoring/market");
    const result = await invokeApiHandler<
      ApiSuccessResponse<MarketMonitoringResponse>
    >(handler, {
      method: "GET",
      url: "/api/admin/monitoring/market",
      query: {
        windowHours: "999",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["market:read", "admin:read"],
        requireAll: false,
      }),
    );
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_get_market_monitoring",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_window_hours: 168,
        }),
      }),
    );
    expect(result.body.data.market.trades).toMatchObject({
      orderCount: 2,
      totalVolumeKcoin: 300,
      status: "warning",
    });
    expect(JSON.stringify(result.body.data)).not.toContain("should-not-leak");
  });
});

describe("admin market listing detail API", () => {
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

  it("returns a market listing detail through the api RPC facade", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      id: "44444444-4444-4444-8444-444444444444",
      status: "active",
      templateId: "55555555-5555-4555-8555-555555555555",
      rarityCode: "rare",
      itemCount: 1,
      remainingCount: 1,
      items: [
        {
          itemInstanceId: "66666666-6666-4666-8666-666666666666",
          status: "reserved",
        },
      ],
      orders: [],
      events: [],
      sources: {
        marketListings: {
          table: "listings",
        },
      },
      serverTime: "2026-06-01T12:00:00.000Z",
    });

    const { default: handler } = await import("../../api/admin/market");
    const result = await invokeApiHandler<
      ApiSuccessResponse<MarketListingDetailResponse>
    >(handler, {
      method: "GET",
      url: "/api/admin/market?listingId=44444444-4444-4444-8444-444444444444",
      query: {
        listingId: "44444444-4444-4444-8444-444444444444",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(requireAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        permissions: ["market:read", "admin:read"],
        requireAll: false,
      }),
    );
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "api",
        functionName: "admin_get_market_listing_detail",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_listing_id: "44444444-4444-4444-8444-444444444444",
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
          }),
        }),
      }),
    );
    expect(result.body.data).toMatchObject({
      id: "44444444-4444-4444-8444-444444444444",
      items: [
        {
          itemInstanceId: "66666666-6666-4666-8666-666666666666",
        },
      ],
    });
    expect(JSON.stringify(result.body.data)).not.toContain("seller_user_id");
  });

  it("rejects invalid listing ids before reading listing details", async () => {
    const { default: handler } = await import("../../api/admin/market");
    const result = await invokeApiHandler(handler, {
      method: "GET",
      url: "/api/admin/market?listingId=not-a-uuid",
      query: {
        listingId: "not-a-uuid",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(requireAdminMock).toHaveBeenCalled();
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });
});
