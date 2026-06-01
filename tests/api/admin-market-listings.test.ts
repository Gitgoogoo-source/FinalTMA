import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
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
  sessionId: "session-admin-market-listings-test",
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
const SELLER_USER_ID = "66666666-6666-4666-8666-666666666666";
const LISTING_ID = "77777777-7777-4777-8777-777777777777";

type MarketAdminListingsResponse = {
  items: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
  nextCursor: string | null;
  serverTime: string;
};

describe("admin market listings API", () => {
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
      await import("../../api/admin/market/listings");
    const result = await invokeApiHandler(handler, {
      method: "POST",
      url: "/api/admin/market/listings",
    });

    expect(result.statusCode).toBe(405);
    expect(requireAdminMock).not.toHaveBeenCalled();
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });

  it("uses market/admin read permission and maps paginated filters to the planned RPC", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      rows: [
        {
          id: LISTING_ID,
          seller_user_id: SELLER_USER_ID,
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          rarity_code: "RARE",
          status: "active",
          item_count: 2,
          remaining_count: 2,
          unit_price_kcoin: "500",
          fee_bps: 500,
          expected_net_amount: "950",
          price_health: "too_low",
          metadata: {
            private_token: "must-not-leak",
          },
          created_at: "2026-06-01T01:00:00.000Z",
          updated_at: "2026-06-01T01:05:00.000Z",
        },
        {
          id: "88888888-8888-4888-8888-888888888888",
          seller_user_id: SELLER_USER_ID,
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          rarity_code: "RARE",
          status: "active",
          item_count: 1,
          remaining_count: 1,
          unit_price_kcoin: "600",
          fee_bps: 500,
          expected_net_amount: "570",
          price_health: "healthy",
          created_at: "2026-06-01T02:00:00.000Z",
          updated_at: "2026-06-01T02:05:00.000Z",
        },
        {
          id: "99999999-9999-4999-8999-999999999999",
          seller_user_id: SELLER_USER_ID,
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          rarity_code: "RARE",
          status: "active",
          item_count: 1,
          remaining_count: 1,
          unit_price_kcoin: "700",
          fee_bps: 500,
          expected_net_amount: "665",
          price_health: "healthy",
          created_at: "2026-06-01T03:00:00.000Z",
          updated_at: "2026-06-01T03:05:00.000Z",
        },
      ],
      summary: {
        totalCount: 3,
      },
      server_time: "2026-06-01T04:00:00.000Z",
    });

    const { default: handler } =
      await import("../../api/admin/market/listings");
    const result = await invokeApiHandler<
      ApiSuccessResponse<MarketAdminListingsResponse>
    >(handler, {
      method: "GET",
      url: "/api/admin/market/listings",
      headers: {
        "x-request-id": "req-admin-market-listings",
      },
      query: {
        status: "ACTIVE",
        rarityCode: "rare",
        templateId: TEMPLATE_ID,
        formId: FORM_ID,
        minPriceKcoin: "100",
        maxPriceKcoin: "900",
        sellerUserId: SELLER_USER_ID,
        priceHealth: "too_low",
        limit: "2",
        cursor: "20",
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
        functionName: "admin_list_market_listings",
        args: expect.objectContaining({
          p_admin_user_id: ADMIN_CONTEXT.adminId,
          p_status: "active",
          p_rarity_code: "RARE",
          p_template_id: TEMPLATE_ID,
          p_form_id: FORM_ID,
          p_min_price_kcoin: 100,
          p_max_price_kcoin: 900,
          p_seller_user_id: SELLER_USER_ID,
          p_price_health: "too_low",
          p_limit: 2,
          p_cursor: 20,
          p_request_context: expect.objectContaining({
            admin_user_id: ADMIN_CONTEXT.adminId,
            request_id: "req-admin-market-listings",
          }),
        }),
        traceId: "req-admin-market-listings",
        label: "admin_list_market_listings",
      }),
    );
    expect(result.body.data.items).toHaveLength(2);
    expect(result.body.data.items[0]).toMatchObject({
      id: LISTING_ID,
      sellerUserId: SELLER_USER_ID,
      templateId: TEMPLATE_ID,
      formId: FORM_ID,
      rarityCode: "RARE",
      status: "active",
      priceHealth: "too_low",
      unitPriceKcoin: "500",
      expectedNetAmount: "950",
    });
    expect(result.body.data.nextCursor).toBe("22");
    expect(result.body.data.serverTime).toBe("2026-06-01T04:00:00.000Z");
    expect(JSON.stringify(result.body.data)).not.toContain("private_token");
    expect(JSON.stringify(result.body.data)).not.toContain("metadata");
  });

  it("accepts current admin UI template and user aliases when they are UUIDs", async () => {
    runReadRpcMock.mockResolvedValueOnce({
      items: [],
      next_cursor: null,
      serverTime: "2026-06-01T04:00:00.000Z",
    });

    const { default: handler } =
      await import("../../api/admin/market/listings");
    const result = await invokeApiHandler<ApiSuccessResponse>(handler, {
      method: "GET",
      url: "/api/admin/market/listings",
      query: {
        template: TEMPLATE_ID,
        user: SELLER_USER_ID,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(runReadRpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({
          p_template_id: TEMPLATE_ID,
          p_seller_user_id: SELLER_USER_ID,
          p_limit: 20,
          p_cursor: 0,
        }),
      }),
    );
  });

  it("rejects invalid filters before calling the listings RPC", async () => {
    const { default: handler } =
      await import("../../api/admin/market/listings");
    const result = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "GET",
      url: "/api/admin/market/listings",
      query: {
        template: "not-a-uuid",
        limit: "500",
        cursor: "next-page",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_FAILED");
    expect(requireAdminMock).toHaveBeenCalled();
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });

  it("rejects inverted price ranges before calling the listings RPC", async () => {
    const { default: handler } =
      await import("../../api/admin/market/listings");
    const result = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "GET",
      url: "/api/admin/market/listings",
      query: {
        minPriceKcoin: "900",
        maxPriceKcoin: "100",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_FAILED");
    expect(runReadRpcMock).not.toHaveBeenCalled();
  });

  it("maps unexpected RPC failures without exposing internals", async () => {
    runReadRpcMock.mockRejectedValueOnce(
      new Error("database secret detail should not leak"),
    );

    const { default: handler } =
      await import("../../api/admin/market/listings");
    const result = await invokeApiHandler<ApiErrorResponse>(handler, {
      method: "GET",
      url: "/api/admin/market/listings",
    });

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe("ADMIN_MARKET_LISTINGS_LOOKUP_FAILED");
    expect(JSON.stringify(result.body)).not.toContain("database secret detail");
  });
});
