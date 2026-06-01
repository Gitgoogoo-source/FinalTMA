import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ApiSuccessResponse } from "../../api/_shared/handler";
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
  sessionId: "session-admin-market-ops-test",
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

const TEMPLATE_ID = "44444444-4444-4444-8444-444444444444";
const FORM_ID = "55555555-5555-4555-8555-555555555555";
const LOW_PRICE_LISTING_ID = "66666666-6666-4666-8666-666666666666";
const HIGH_PRICE_LISTING_ID = "77777777-7777-4777-8777-777777777777";
const RECENT_ORDER_ID = "88888888-8888-4888-8888-888888888888";
const RECENT_LISTING_ID = "99999999-9999-4999-8999-999999999999";
const BUYER_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SELLER_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FULL_ADMIN_IP = "203.0.113.10";
const FULL_USER_AGENT = "TMA-AdminStatsUserAgent/1.0";
const FULL_WALLET_ADDRESS =
  "EQDfull-wallet-address-that-must-not-be-returned-to-admin-stats";
const MASKED_WALLET_ADDRESS = "EQDf...stats";

type MarketPriceScope = {
  templateId: string;
  formId: string | null;
  templateName?: string | null;
  formName?: string | null;
  rarityCode?: string | null;
};

type MarketFloorPrice = MarketPriceScope & {
  floorPriceKcoin: string;
  activeListingCount: number;
  source: string;
};

type MarketAveragePrice = MarketPriceScope & {
  averagePriceKcoin: string;
  sampleCount: number;
  source: string;
  windowHours?: number;
};

type MarketRecentSale = MarketPriceScope & {
  orderId: string;
  listingId: string;
  itemCount: number;
  unitPriceKcoin: string;
  totalPriceKcoin: string;
  soldAt: string;
  source: string;
};

type MarketPriceHealthWarning = MarketPriceScope & {
  listingId: string;
  priceHealth: "too_low" | "too_high";
  unitPriceKcoin: string;
  floorPriceKcoin: string;
  rule: {
    lowBps: number;
    highBps: number;
    source: string;
  };
};

type MarketSelfTradeWarning = {
  warningId: string;
  severity: "low" | "medium" | "high";
  buyerUserId: string;
  sellerUserId: string;
  orderCount: number;
  volumeKcoin: string;
  reasons: string[];
  sharedSignals: {
    deviceHash?: string;
    walletHash?: string;
    walletAddressMasked?: string;
    ipHash?: string;
  };
  latestOrderAt: string;
  source: string;
};

type MarketOpsStatsResponse = {
  activeListingCount: number;
  activeListingValueKcoin: string;
  totalListingValueKcoin?: string;
  volume24hKcoin: string;
  feeRevenueKcoin: string;
  abnormalListingCount: number;
  statusCounts: Record<string, number>;
  priceHealthCounts: Record<string, number>;
  floorPrices: MarketFloorPrice[];
  averagePrices: {
    activeListings: MarketAveragePrice[];
    completedSales: MarketAveragePrice[];
  };
  recentSales: MarketRecentSale[];
  priceHealthWarnings: MarketPriceHealthWarning[];
  selfTradeWarnings: MarketSelfTradeWarning[];
  window: {
    hours: number;
    startedAt: string;
    endedAt: string;
  };
  sources: Record<string, unknown>;
  serverTime: string;
};

describe("admin market ops stats API", () => {
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
    const { default: handler } = await import("../../api/admin/market/stats");
    const result = await invokeApiHandler(handler, {
      method: "POST",
      url: "/api/admin/market/stats",
    });

    expect(result.statusCode).toBe(405);
    expect(requireAdminMock).not.toHaveBeenCalled();
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });

  it("returns the complete market ops stats display contract through the planned api RPC facade", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      activeListingCount: 12,
      activeListingValueKcoin: "3400",
      totalListingValueKcoin: "3400",
      soldListingCount: 3,
      cancelledListingCount: 1,
      expiredListingCount: 0,
      volume24hKcoin: "900",
      feeRevenueKcoin: "45",
      abnormalListingCount: 2,
      statusCounts: {
        active: 12,
        sold: 3,
        cancelled: 1,
        expired: 0,
      },
      priceHealthCounts: {
        normal: 10,
        too_low: 1,
        too_high: 1,
      },
      floorPrices: [
        {
          templateId: TEMPLATE_ID,
          formId: FORM_ID,
          templateName: "Moon Crown",
          formName: "Ascended",
          rarityCode: "RARE",
          floorPriceKcoin: "250",
          activeListingCount: 4,
          source: "market.listings.active",
        },
      ],
      averagePrices: {
        activeListings: [
          {
            templateId: TEMPLATE_ID,
            formId: FORM_ID,
            rarityCode: "RARE",
            averagePriceKcoin: "425",
            sampleCount: 4,
            source: "market.listings.active",
          },
        ],
        completedSales: [
          {
            templateId: TEMPLATE_ID,
            formId: FORM_ID,
            rarityCode: "RARE",
            averagePriceKcoin: "300",
            sampleCount: 3,
            windowHours: 24,
            source: "market.orders.completed",
          },
        ],
      },
      recentSales: [
        {
          orderId: RECENT_ORDER_ID,
          listingId: RECENT_LISTING_ID,
          templateId: TEMPLATE_ID,
          formId: FORM_ID,
          rarityCode: "RARE",
          itemCount: 2,
          unitPriceKcoin: "450",
          totalPriceKcoin: "900",
          soldAt: "2026-06-01T11:55:00.000Z",
          source: "market.orders.created_at_desc",
        },
      ],
      priceHealthWarnings: [
        {
          listingId: LOW_PRICE_LISTING_ID,
          templateId: TEMPLATE_ID,
          formId: FORM_ID,
          rarityCode: "RARE",
          priceHealth: "too_low",
          unitPriceKcoin: "120",
          floorPriceKcoin: "250",
          rule: {
            lowBps: 7000,
            highBps: 13000,
            source: "market.price_health_rules",
          },
        },
        {
          listingId: HIGH_PRICE_LISTING_ID,
          templateId: TEMPLATE_ID,
          formId: FORM_ID,
          rarityCode: "RARE",
          priceHealth: "too_high",
          unitPriceKcoin: "900",
          floorPriceKcoin: "250",
          rule: {
            lowBps: 7000,
            highBps: 13000,
            source: "market.price_health_rules",
          },
        },
      ],
      selfTradeWarnings: [
        {
          warningId: "self-trade-warning-001",
          severity: "high",
          buyerUserId: BUYER_USER_ID,
          sellerUserId: SELLER_USER_ID,
          orderCount: 3,
          volumeKcoin: "1200",
          reasons: [
            "buyer_seller_pair",
            "shared_device_hash",
            "shared_wallet_hash",
            "shared_ip_hash",
          ],
          sharedSignals: {
            deviceHash:
              "3d7f6f3a2e3c8e2b8f0ed8ea23cbbadf2f52d641d98df1f89cae60f768f4037f",
            walletHash:
              "64ad4d0ad3f3bf0b75f7266d8a2099af5a3a87b5972d6f7d0ac55f1ebf5f43e1",
            walletAddressMasked: MASKED_WALLET_ADDRESS,
            ipHash:
              "f2cdb3a66fe3d2b9c3f5718077557e6a7d4f09be4583a9df6c5c82f09109d51a",
          },
          latestOrderAt: "2026-06-01T11:58:00.000Z",
          source: "ops.risk_events.market_self_trade",
        },
      ],
      window: {
        hours: 168,
        startedAt: "2026-05-25T12:00:00.000Z",
        endedAt: "2026-06-01T12:00:00.000Z",
      },
      sources: {
        marketListings: {
          schema: "market",
          table: "listings",
          filters: {
            status: "active",
          },
          aggregation: "active count, active value, floor and active average",
        },
        marketPriceSnapshots: {
          schema: "market",
          table: "price_snapshots",
        },
        marketDepthSnapshots: {
          schema: "market",
          table: "depth_snapshots",
        },
        marketOrders: {
          schema: "market",
          table: "orders",
          windowColumn: "created_at",
          aggregation: "24h volume, completed average and recent sale",
        },
        marketFeeSettlements: {
          schema: "market",
          table: "fee_settlements",
          aggregation: "platform fee revenue",
        },
        riskCorrelation: {
          schema: "ops",
          table: "risk_events",
          signals: [
            "buyer_seller_pair",
            "device_hash",
            "wallet_hash",
            "ip_hash",
          ],
          redaction: "hashed-or-masked",
        },
      },
      serverTime: "2026-06-01T12:00:00.000Z",
    });

    const { default: handler } = await import("../../api/admin/market/stats");
    const result = await invokeApiHandler<
      ApiSuccessResponse<MarketOpsStatsResponse>
    >(handler, {
      method: "GET",
      url: "/api/admin/market/stats?windowHours=999",
      headers: {
        "x-request-id": "req-admin-market-ops-stats",
        "x-forwarded-for": FULL_ADMIN_IP,
        "user-agent": FULL_USER_AGENT,
      },
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
        functionName: "admin_get_market_ops_stats",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_window_hours: 168,
          p_request_context: expect.objectContaining({
            request_id: "req-admin-market-ops-stats",
            admin_user_id: ADMIN_CONTEXT.adminId,
            session_id: ADMIN_CONTEXT.sessionId,
            ip_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
            user_agent_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        }),
        traceId: "req-admin-market-ops-stats",
        label: "admin_get_market_ops_stats",
      }),
    );
    const statsRpcInput = runReadRpcMock.mock.calls[0]?.[0];
    const statsRpcInputJson = JSON.stringify(statsRpcInput);
    expect(statsRpcInputJson).not.toContain(ADMIN_CONTEXT.sessionTokenHash);
    expect(statsRpcInputJson).not.toContain(FULL_ADMIN_IP);
    expect(statsRpcInputJson).not.toContain(FULL_USER_AGENT);

    expect(result.body.data).toMatchObject({
      activeListingCount: 12,
      activeListingValueKcoin: "3400",
      totalListingValueKcoin: "3400",
      volume24hKcoin: "900",
      feeRevenueKcoin: "45",
      abnormalListingCount: 2,
    });
    expect(result.body.data.floorPrices).toEqual([
      expect.objectContaining({
        templateId: TEMPLATE_ID,
        formId: FORM_ID,
        floorPriceKcoin: "250",
        activeListingCount: 4,
        source: "market.listings.active",
      }),
    ]);
    expect(result.body.data.averagePrices).toMatchObject({
      activeListings: [
        {
          templateId: TEMPLATE_ID,
          formId: FORM_ID,
          averagePriceKcoin: "425",
          sampleCount: 4,
          source: "market.listings.active",
        },
      ],
      completedSales: [
        {
          templateId: TEMPLATE_ID,
          formId: FORM_ID,
          averagePriceKcoin: "300",
          sampleCount: 3,
          windowHours: 24,
          source: "market.orders.completed",
        },
      ],
    });
    expect(result.body.data).not.toHaveProperty("averagePriceKcoin");
    expect(result.body.data.recentSales).toEqual([
      expect.objectContaining({
        orderId: RECENT_ORDER_ID,
        listingId: RECENT_LISTING_ID,
        unitPriceKcoin: "450",
        totalPriceKcoin: "900",
        source: "market.orders.created_at_desc",
      }),
    ]);
    expect(result.body.data.priceHealthWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          listingId: LOW_PRICE_LISTING_ID,
          priceHealth: "too_low",
          rule: expect.objectContaining({
            lowBps: 7000,
            highBps: 13000,
            source: "market.price_health_rules",
          }),
        }),
        expect.objectContaining({
          listingId: HIGH_PRICE_LISTING_ID,
          priceHealth: "too_high",
        }),
      ]),
    );
    expect(result.body.data.selfTradeWarnings).toEqual([
      expect.objectContaining({
        buyerUserId: BUYER_USER_ID,
        sellerUserId: SELLER_USER_ID,
        reasons: [
          "buyer_seller_pair",
          "shared_device_hash",
          "shared_wallet_hash",
          "shared_ip_hash",
        ],
        sharedSignals: expect.objectContaining({
          deviceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          walletHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          walletAddressMasked: MASKED_WALLET_ADDRESS,
          ipHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    ]);
    expect(JSON.stringify(result.body.data.sources)).toContain(
      "price_snapshots",
    );
    expect(JSON.stringify(result.body.data.sources)).toContain(
      "depth_snapshots",
    );
    expect(JSON.stringify(result.body.data.sources)).toContain("orders");
    expect(JSON.stringify(result.body.data.sources)).toContain("listings");
    expect(JSON.stringify(result.body.data.sources)).toContain(
      "fee_settlements",
    );
    expect(JSON.stringify(result.body.data.sources)).toContain("risk_events");

    const responseJson = JSON.stringify(result.body);
    expect(responseJson).not.toContain("session-hash");
    expect(responseJson).not.toContain("service_role_key");
    expect(responseJson).not.toContain(FULL_ADMIN_IP);
    expect(responseJson).not.toContain(FULL_WALLET_ADDRESS);
    expect(responseJson).toContain(MASKED_WALLET_ADDRESS);
  });

  it("uses the default stats window when the query window is invalid", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      activeListingCount: 0,
      volume24hKcoin: "0",
      feeRevenueKcoin: "0",
      abnormalListingCount: 0,
      sources: {},
      serverTime: "2026-06-01T12:00:00.000Z",
    });

    const { default: handler } = await import("../../api/admin/market/stats");
    const result = await invokeApiHandler(handler, {
      method: "GET",
      url: "/api/admin/market/stats?windowHours=bad",
      query: {
        windowHours: "bad",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          p_window_hours: 24,
        }),
      }),
    );
  });

  it("maps admin RPC failures without exposing internal details", async () => {
    runReadRpcMock.mockRejectedValueOnce(
      new Error("connection failed: service_role_key=should-not-leak"),
    );

    const { default: handler } = await import("../../api/admin/market/stats");
    const result = await invokeApiHandler(handler, {
      method: "GET",
      url: "/api/admin/market/stats",
    });

    expect(result.statusCode).toBe(500);
    expect(result.body).toMatchObject({
      error: {
        code: "ADMIN_MARKET_OPS_STATS_LOOKUP_FAILED",
        message: "Internal server error",
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("service_role_key");
  });

  it("does not call the stats RPC when admin permissions are missing", async () => {
    requireAdminMock.mockRejectedValueOnce(
      new ApiError(403, "FORBIDDEN", "Missing admin permission"),
    );

    const { default: handler } = await import("../../api/admin/market/stats");
    const result = await invokeApiHandler(handler, {
      method: "GET",
      url: "/api/admin/market/stats",
    });

    expect(result.statusCode).toBe(403);
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });
});
