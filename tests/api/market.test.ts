import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import refreshMarketStatsCronHandler from "../../api/cron/refresh-market-stats";
import buyListingHandler, {
  normalizeMarketBuyListingInput,
} from "../../api/market/buy";
import cancelListingHandler, {
  normalizeMarketCancelListingInput,
} from "../../api/market/cancel-listing";
import createListingHandler, {
  normalizeMarketCreateListingInput,
} from "../../api/market/create-listing";
import listingDetailHandler from "../../api/market/listing-detail";
import listingsHandler from "../../api/market/listings";
import myListingStatsHandler from "../../api/market/my-listing-stats";
import myListingsHandler from "../../api/market/my-listings";
import sellRulesHandler from "../../api/market/sell-rules";
import sellableItemsHandler from "../../api/market/sellable-items";
import statsHandler from "../../api/market/stats";
import updatePriceHandler, {
  normalizeMarketUpdateListingPriceInput,
} from "../../api/market/update-price";
import { RpcError } from "../../packages/server/src/db/rpc";
import { invokeApiHandler } from "./_utils";

const { callRpcRawMock, requireSessionMock } = vi.hoisted(() => ({
  callRpcRawMock: vi.fn(),
  requireSessionMock: vi.fn(),
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

vi.mock("../../api/_shared/requireSession.js", () => ({
  requireSession: requireSessionMock,
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "33333333-3333-4333-8333-333333333333";
const FORM_ID = "44444444-4444-4444-8444-444444444444";
const SERIES_ID = "55555555-5555-4555-8555-555555555555";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const ITEM_ID_2 = "77777777-7777-4777-8777-777777777777";
const IDEMPOTENCY_KEY = "market:create-listing-0001";
const BUY_IDEMPOTENCY_KEY = "market:buy-listing-0001";
const UPDATE_PRICE_IDEMPOTENCY_KEY = "market:update-price-0001";
const CANCEL_LISTING_IDEMPOTENCY_KEY = "market:cancel-listing-0001";

beforeEach(() => {
  process.env.FEATURE_MARKET_ENABLED = "true";
});

afterEach(() => {
  delete process.env.FEATURE_MARKET_ENABLED;
});

describe("market listings API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-listings-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("returns 401 before calling RPC when the user is not logged in", async () => {
    requireSessionMock.mockRejectedValueOnce(
      ApiError.authSessionExpired("登录状态缺失，请重新进入应用。"),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(listingsHandler, {
      method: "GET",
    });

    expect(result.statusCode).toBe(401);
    expect(result.body.error.code).toBe("AUTH_SESSION_EXPIRED");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("returns an empty list when the market is empty", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      items: [],
      next_cursor: null,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<{ items: unknown[]; next_cursor: string | null }>
    >(listingsHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-market-listings-empty",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.data).toEqual({
      items: [],
      next_cursor: null,
    });
  });

  it("validates filters, calls market_list_listings and preserves price health", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      items: [
        {
          listing_id: LISTING_ID,
          seller_user_id: USER_ID,
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          name: "测试藏品",
          rarity: "rare",
          type_code: "character",
          image_url: "https://example.test/item.png",
          unit_price_kcoin: 500,
          currency_code: "KCOIN",
          item_count: 2,
          remaining_count: 1,
          status: "active",
          seller_display_name: "卖家",
          is_own_listing: true,
          is_buyable: false,
          not_buyable_reason: "own_listing",
          price_health: "healthy",
          created_at: "2026-05-22T00:00:00.000Z",
          expires_at: null,
          rpc_extra_field: "removed",
        },
      ],
      next_cursor: "2026-05-22 00:00:00+00",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<{
        items: Array<Record<string, unknown>>;
        next_cursor: string | null;
      }>
    >(listingsHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-market-listings-filtered",
      },
      query: {
        rarities: "rare",
        type_codes: "character",
        series_ids: SERIES_ID,
        template_ids: TEMPLATE_ID,
        min_price: "100",
        max_price: "1000",
        sort: "price_low_to_high",
        limit: "10",
        cursor: "2026-05-22T01:00:00.000Z",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_list_listings",
      {
        p_user_id: USER_ID,
        p_rarities: ["rare"],
        p_type_codes: ["character"],
        p_series_ids: [SERIES_ID],
        p_template_ids: [TEMPLATE_ID],
        p_min_price: 100,
        p_max_price: 1000,
        p_sort: "price_low_to_high",
        p_limit: 10,
        p_cursor: "2026-05-22T01:00:00.000Z",
      },
      {
        schema: "api",
        context: {
          requestId: "req-market-listings-filtered",
          userId: USER_ID,
        },
      },
    );
    expect(result.body.data.items).toHaveLength(1);
    expect(result.body.data.items[0]).toMatchObject({
      listing_id: LISTING_ID,
      name: "测试藏品",
      unit_price_kcoin: 500,
      remaining_count: 1,
      is_own_listing: true,
      price_health: "healthy",
    });
    expect(result.body.data.items[0]).not.toHaveProperty("rpc_extra_field");
  });

  it("rejects invalid listing query input before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(listingsHandler, {
      method: "GET",
      query: {
        limit: "51",
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("hides invalid RPC payload details from the client", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      items: [
        {
          listing_id: LISTING_ID,
        },
      ],
      next_cursor: null,
    });

    const result = await invokeApiHandler<ApiErrorResponse>(listingsHandler, {
      method: "GET",
    });

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe("MARKET_LISTINGS_RESULT_INVALID");
    expect(result.body.error.message).toBe("Internal server error");
  });
});

describe("market listing detail API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-listing-detail-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("calls market_get_listing_detail and returns the shared detail contract", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      listing: {
        listing_id: LISTING_ID,
        seller_user_id: USER_ID,
        template_id: TEMPLATE_ID,
        form_id: FORM_ID,
        name: "测试藏品",
        description: "详情说明",
        rarity: "rare",
        type_code: "character",
        image_url: "https://example.test/item.png",
        seller: {
          user_id: USER_ID,
          display_name: "卖家",
          avatar_url: null,
        },
        seller_display_name: "卖家",
        unit_price_kcoin: 500,
        currency_code: "KCOIN",
        item_count: 2,
        remaining_count: 1,
        status: "active",
        floor_price_kcoin: 450,
        avg_price_kcoin: 480,
        last_sale_price_kcoin: 470,
        reference_price_kcoin: 450,
        active_listing_count: 3,
        sale_count_24h: 1,
        volume_24h_kcoin: 470,
        snapshot_at: "2026-05-22T00:00:00.000Z",
        price_health: "healthy",
        market_depth: [
          {
            price_kcoin: 500,
            listing_count: 1,
            item_count: 1,
          },
        ],
        item_instance_ids: [ITEM_ID],
        is_own_listing: false,
        is_buyable: true,
        not_buyable_reason: null,
        can_buy: true,
        disabled_reason: null,
        created_at: "2026-05-22T00:00:00.000Z",
        expires_at: null,
        rpc_extra_field: "removed",
      },
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<{ listing: Record<string, unknown> }>
    >(listingDetailHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-market-listing-detail",
      },
      query: {
        listing_id: LISTING_ID,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_get_listing_detail",
      {
        p_user_id: USER_ID,
        p_listing_id: LISTING_ID,
      },
      {
        schema: "api",
        context: {
          requestId: "req-market-listing-detail",
          userId: USER_ID,
          listingId: LISTING_ID,
        },
      },
    );
    expect(result.body.data.listing).toMatchObject({
      listing_id: LISTING_ID,
      seller: {
        user_id: USER_ID,
        display_name: "卖家",
        avatar_url: null,
      },
      avg_price_kcoin: 480,
      active_listing_count: 3,
      sale_count_24h: 1,
      volume_24h_kcoin: 470,
      snapshot_at: "2026-05-22T00:00:00.000Z",
      can_buy: true,
      disabled_reason: null,
    });
    expect(result.body.data.listing).not.toHaveProperty("rpc_extra_field");
  });

  it("rejects invalid listing detail query input before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      listingDetailHandler,
      {
        method: "GET",
        query: {
          listing_id: "not-a-uuid",
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("maps missing listing RPC errors to LISTING_NOT_FOUND", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_get_listing_detail",
        error: {
          message: "listing not found",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      listingDetailHandler,
      {
        method: "GET",
        query: {
          listing_id: LISTING_ID,
        },
      },
    );

    expect(result.statusCode).toBe(404);
    expect(result.body.error.code).toBe("LISTING_NOT_FOUND");
    expect(result.body.error.message).toBe("挂单不存在或已下架。");
  });
});

describe("market sellable items API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-sellable-items-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("calls market_list_sellable_items with the session user and returns grouped inventory", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      items: [
        {
          item_instance_id: ITEM_ID,
          item_instance_ids: [ITEM_ID, ITEM_ID_2],
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          serial_no: 12,
          name: "可出售藏品",
          rarity: "rare",
          type_code: "character",
          image_url: "https://example.test/sellable.png",
          level: 3,
          power: 120,
          owned_count: 2,
          available_count: 2,
          suggested_price: 500,
          min_price: 300,
          max_price: 800,
          acquired_at: "2026-05-22T06:17:21.898312+00:00",
          is_tradeable: true,
          rpc_extra_field: "removed",
        },
      ],
      next_cursor: null,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<{
        items: Array<Record<string, unknown>>;
        next_cursor: string | null;
      }>
    >(sellableItemsHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-market-sellable-items",
      },
      query: {
        rarities: "rare",
        type_codes: "character",
        series_ids: SERIES_ID,
        template_ids: TEMPLATE_ID,
        only_duplicates: "true",
        min_level: "2",
        max_level: "10",
        min_price: "300",
        max_price: "800",
        sort: "power_high_to_low",
        limit: "10",
        cursor: "50",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_list_sellable_items",
      {
        p_user_id: USER_ID,
        p_rarities: ["rare"],
        p_type_codes: ["character"],
        p_series_ids: [SERIES_ID],
        p_template_ids: [TEMPLATE_ID],
        p_only_duplicates: true,
        p_min_level: 2,
        p_max_level: 10,
        p_keyword: null,
        p_min_price_kcoin: 300,
        p_max_price_kcoin: 800,
        p_sort: "power_high_to_low",
        p_limit: 10,
        p_cursor: "50",
      },
      {
        schema: "api",
        context: {
          requestId: "req-market-sellable-items",
          userId: USER_ID,
        },
      },
    );
    expect(result.body.data.items[0]).toMatchObject({
      item_instance_id: ITEM_ID,
      item_instance_ids: [ITEM_ID, ITEM_ID_2],
      template_id: TEMPLATE_ID,
      owned_count: 2,
      suggested_price: 500,
      acquired_at: "2026-05-22T06:17:21.898312+00:00",
    });
    expect(result.body.data.items[0]).not.toHaveProperty("rpc_extra_field");
  });

  it("rejects invalid sellable item query input before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      sellableItemsHandler,
      {
        method: "GET",
        query: {
          min_level: "10",
          max_level: "2",
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});

describe("market sell rules API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-sell-rules-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("calls market_get_sell_rules with the session user and returns fee bps", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      fee_type: "market_sell",
      currency_code: "KCOIN",
      fee_bps: 500,
      source: "active_rule",
      rpc_extra_field: "removed",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(sellRulesHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-market-sell-rules",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_get_sell_rules",
      {
        p_user_id: USER_ID,
      },
      {
        schema: "api",
        context: {
          requestId: "req-market-sell-rules",
          userId: USER_ID,
        },
      },
    );
    expect(result.body.data).toEqual({
      fee_type: "market_sell",
      currency_code: "KCOIN",
      fee_bps: 500,
      source: "active_rule",
    });
  });

  it("rejects invalid sell rules RPC payload", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      fee_type: "market_sell",
      currency_code: "KCOIN",
      fee_bps: 10001,
    });

    const result = await invokeApiHandler<ApiErrorResponse>(sellRulesHandler, {
      method: "GET",
    });

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe("MARKET_SELL_RULES_RESULT_INVALID");
  });
});

describe("market my listings API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-my-listings-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("calls market_list_my_listings with the session user and returns listings", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      items: [
        {
          listing_id: LISTING_ID,
          seller_user_id: USER_ID,
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          name: "我的挂单",
          rarity: "rare",
          type_code: "character",
          image_url: "https://example.test/listing.png",
          unit_price_kcoin: 500,
          currency_code: "KCOIN",
          item_count: 2,
          remaining_count: 2,
          expected_net_amount: 950,
          status: "active",
          is_own_listing: true,
          is_buyable: false,
          not_buyable_reason: "own_listing",
          price_health: "healthy",
          last_price_changed_at: "2026-05-22T00:10:00.000Z",
          created_at: "2026-05-22T00:00:00.000Z",
          expires_at: null,
          rpc_extra_field: "removed",
        },
      ],
      next_cursor: null,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<{
        items: Array<Record<string, unknown>>;
        next_cursor: string | null;
      }>
    >(myListingsHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-market-my-listings",
      },
      query: {
        statuses: "active,partially_sold",
        rarities: "rare",
        type_codes: "character",
        template_ids: TEMPLATE_ID,
        min_price: "100",
        max_price: "1000",
        sort: "price_high_to_low",
        limit: "10",
        cursor: "2026-05-22T01:00:00.000Z",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_list_my_listings",
      {
        p_user_id: USER_ID,
        p_statuses: ["active", "partially_sold"],
        p_rarities: ["rare"],
        p_type_codes: ["character"],
        p_template_ids: [TEMPLATE_ID],
        p_min_price: 100,
        p_max_price: 1000,
        p_sort: "price_high_to_low",
        p_limit: 10,
        p_cursor: "2026-05-22T01:00:00.000Z",
      },
      {
        schema: "api",
        context: {
          requestId: "req-market-my-listings",
          userId: USER_ID,
        },
      },
    );
    expect(result.body.data.items[0]).toMatchObject({
      listing_id: LISTING_ID,
      is_own_listing: true,
      is_buyable: false,
      expected_net_amount: 950,
      last_price_changed_at: "2026-05-22T00:10:00.000Z",
    });
    expect(result.body.data.items[0]).not.toHaveProperty("rpc_extra_field");
  });
});

describe("market my listing stats API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-my-listing-stats-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("calls market_get_my_listing_stats with the session user", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      active_listing_count: 2,
      active_count: 2,
      active_item_count: 3,
      total_listing_value_kcoin: 1500,
      expected_net_amount_kcoin: 1425,
      sold_24h_count: 1,
      sold_24h_value_kcoin: 500,
      rpc_extra_field: "removed",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(myListingStatsHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-market-my-listing-stats",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_get_my_listing_stats",
      {
        p_user_id: USER_ID,
      },
      {
        schema: "api",
        context: {
          requestId: "req-market-my-listing-stats",
          userId: USER_ID,
        },
      },
    );
    expect(result.body.data).toEqual({
      active_count: 2,
      active_listing_count: 2,
      active_item_count: 3,
      total_listing_value_kcoin: 1500,
      expected_net_amount_kcoin: 1425,
      sold_24h_count: 1,
      sold_24h_value_kcoin: 500,
    });
  });
});

describe("market stats API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-stats-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("calls market_get_stats and returns price and depth snapshots", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      price: {
        template_id: TEMPLATE_ID,
        form_id: FORM_ID,
        floor_price_kcoin: 450,
        avg_price_kcoin: 480,
        last_sale_price_kcoin: 470,
        active_listing_count: 3,
        sale_count_24h: 1,
        volume_24h_kcoin: 470,
        snapshot_at: "2026-05-22T00:00:00.000Z",
        rpc_extra_field: "removed",
      },
      depth: [
        {
          price_bucket_kcoin: 500,
          listing_count: 1,
          item_count: 2,
        },
      ],
      price_health: "healthy",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(statsHandler, {
      method: "GET",
      headers: {
        "x-request-id": "req-market-stats",
      },
      query: {
        template_id: TEMPLATE_ID,
        form_id: FORM_ID,
        period: "7d",
        include_depth: "true",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_get_stats",
      {
        p_user_id: USER_ID,
        p_template_id: TEMPLATE_ID,
        p_form_id: FORM_ID,
        p_series_id: null,
        p_rarity: null,
        p_type_code: null,
        p_period: "7d",
        p_include_depth: true,
      },
      {
        schema: "api",
        context: {
          requestId: "req-market-stats",
          userId: USER_ID,
          templateId: TEMPLATE_ID,
          formId: FORM_ID,
        },
      },
    );
    expect(result.body.data).toEqual({
      price: {
        template_id: TEMPLATE_ID,
        form_id: FORM_ID,
        floor_price_kcoin: 450,
        avg_price_kcoin: 480,
        last_sale_price_kcoin: 470,
        active_listing_count: 3,
        sale_count_24h: 1,
        volume_24h_kcoin: 470,
        snapshot_at: "2026-05-22T00:00:00.000Z",
      },
      depth: [
        {
          price_kcoin: 500,
          listing_count: 1,
          item_count: 2,
        },
      ],
      price_health: "healthy",
    });
  });

  it("rejects missing stats filters before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(statsHandler, {
      method: "GET",
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });
});

describe("market stats refresh cron API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;
    process.env.ENABLE_CRON_API = "true";
    process.env.CRON_SECRET = "test-cron-secret-0001";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
  });

  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;
    delete process.env.CRON_SECRET;
  });

  it("calls market_refresh_price_stats with the internal cron secret", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      snapshot_at: "2026-05-23T16:30:44.000Z",
      price_snapshot_count: 1,
      depth_snapshot_count: 2,
      price_health_update_count: 3,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(refreshMarketStatsCronHandler, {
      method: "POST",
      headers: {
        authorization: "Bearer test-cron-secret-0001",
        "x-request-id": "req-market-stats-refresh",
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_refresh_price_stats",
      {},
      {
        schema: "api",
        context: {
          requestId: "req-market-stats-refresh",
          source: "cron.refresh_market_stats",
        },
      },
    );
    expect(result.body.data).toEqual({
      snapshot_at: "2026-05-23T16:30:44.000Z",
      price_snapshot_count: 1,
      depth_snapshot_count: 2,
      price_health_update_count: 3,
    });
  });

  it("rejects refresh requests with an invalid cron secret", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      refreshMarketStatsCronHandler,
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

  it("rejects preview refresh requests when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "development";
    process.env.VERCEL_ENV = "preview";

    const result = await invokeApiHandler<ApiErrorResponse>(
      refreshMarketStatsCronHandler,
      {
        method: "POST",
      },
    );

    expect(result.statusCode).toBe(500);
    expect(result.body.error.code).toBe("CRON_SECRET_MISSING");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("allows test refresh requests without CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockResolvedValueOnce({
      snapshot_at: "2026-05-23T16:30:44.000Z",
      price_snapshot_count: 1,
      depth_snapshot_count: 2,
      price_health_update_count: 3,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(refreshMarketStatsCronHandler, {
      method: "POST",
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });

  it("allows local refresh requests without CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    process.env.NODE_ENV = "development";
    process.env.APP_ENV = "local";
    callRpcRawMock.mockResolvedValueOnce({
      snapshot_at: "2026-05-23T16:30:44.000Z",
      price_snapshot_count: 1,
      depth_snapshot_count: 2,
      price_health_update_count: 3,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(refreshMarketStatsCronHandler, {
      method: "POST",
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledTimes(1);
  });
});

describe("market create listing API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-create-listing-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("normalizes snake_case, camelCase and header idempotency input", () => {
    expect(
      normalizeMarketCreateListingInput(
        {
          itemInstanceIds: [ITEM_ID],
          unitPriceKcoin: 500,
        },
        IDEMPOTENCY_KEY,
      ),
    ).toMatchObject({
      item_instance_ids: [ITEM_ID],
      unit_price_kcoin: 500,
      idempotency_key: IDEMPOTENCY_KEY,
    });
  });

  it("calls market_create_listing with the session user and returns listing result", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      item_count: 2,
      remaining_count: 2,
      unit_price_kcoin: 500,
      fee_bps: 500,
      expected_net_amount: 950,
      status: "active",
      price_health: "healthy",
      idempotent: false,
      rpc_extra_field: "removed",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(createListingHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-market-create-listing",
        "x-idempotency-key": IDEMPOTENCY_KEY,
      },
      body: {
        item_instance_ids: [ITEM_ID, ITEM_ID_2],
        unit_price_kcoin: 500,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_create_listing",
      {
        p_user_id: USER_ID,
        p_item_instance_ids: [ITEM_ID, ITEM_ID_2],
        p_unit_price_kcoin: 500,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
      {
        schema: "api",
        context: {
          requestId: "req-market-create-listing",
          userId: USER_ID,
          itemCount: 2,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
      },
    );
    expect(result.body.data).toMatchObject({
      listing_id: LISTING_ID,
      item_count: 2,
      remaining_count: 2,
      unit_price_kcoin: 500,
      fee_bps: 500,
      expected_net_amount: 950,
      status: "active",
      price_health: "healthy",
      idempotent: false,
    });
    expect(result.body.data).not.toHaveProperty("rpc_extra_field");
  });

  it("rejects missing idempotency key before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      createListingHandler,
      {
        method: "POST",
        body: {
          item_instance_ids: [ITEM_ID],
          unit_price_kcoin: 500,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects body user identity before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      createListingHandler,
      {
        method: "POST",
        body: {
          item_instance_ids: [ITEM_ID],
          unit_price_kcoin: 500,
          idempotency_key: IDEMPOTENCY_KEY,
          seller_user_id: USER_ID,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("returns a successful idempotent response with backend fee fields", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      item_count: 1,
      remaining_count: 1,
      unit_price_kcoin: 500,
      fee_bps: 500,
      expected_net_amount: 475,
      status: "active",
      price_health: "healthy",
      idempotent: true,
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(createListingHandler, {
      method: "POST",
      body: {
        item_instance_ids: [ITEM_ID],
        unit_price_kcoin: 500,
        idempotency_key: IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.data).toEqual({
      listing_id: LISTING_ID,
      item_count: 1,
      remaining_count: 1,
      unit_price_kcoin: 500,
      fee_bps: 500,
      expected_net_amount: 475,
      status: "active",
      price_health: "healthy",
      idempotent: true,
    });
  });

  it("maps non-sellable item RPC errors to ITEM_NOT_SELLABLE", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_create_listing",
        error: {
          message: "some items are not sellable",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      createListingHandler,
      {
        method: "POST",
        body: {
          item_instance_ids: [ITEM_ID],
          unit_price_kcoin: 500,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("ITEM_NOT_SELLABLE");
    expect(result.body.error.message).toBe("部分藏品不可出售。");
  });

  it("maps idempotency conflicts to IDEMPOTENCY_CONFLICT", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_create_listing",
        error: {
          message: "idempotency conflict",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      createListingHandler,
      {
        method: "POST",
        body: {
          item_instance_ids: [ITEM_ID],
          unit_price_kcoin: 500,
          idempotency_key: IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(result.body.error.message).toBe("幂等键已被其他挂单请求使用。");
  });
});

describe("market buy listing API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-buy-listing-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("normalizes snake_case, camelCase and header idempotency input", () => {
    expect(
      normalizeMarketBuyListingInput(
        {
          listingId: LISTING_ID,
          expectedUnitPriceKcoin: 500,
        },
        BUY_IDEMPOTENCY_KEY,
      ),
    ).toMatchObject({
      listing_id: LISTING_ID,
      expected_unit_price_kcoin: 500,
      idempotency_key: BUY_IDEMPOTENCY_KEY,
    });
  });

  it("calls market_buy_listing with the session user and returns order result", async () => {
    const ORDER_ID = "88888888-8888-4888-8888-888888888888";

    callRpcRawMock.mockResolvedValueOnce({
      order_id: ORDER_ID,
      listing_id: LISTING_ID,
      purchased_items: [
        {
          item_instance_id: ITEM_ID,
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
          rpc_extra_field: "removed",
        },
      ],
      total_price_kcoin: "500",
      fee_amount_kcoin: 25,
      seller_net_amount_kcoin: 475,
      buyer_balance_after: 1500,
      status: "completed",
      idempotent: false,
      rpc_extra_field: "removed",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(buyListingHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-market-buy-listing",
        "x-idempotency-key": BUY_IDEMPOTENCY_KEY,
      },
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_buy_listing",
      {
        p_buyer_user_id: USER_ID,
        p_listing_id: LISTING_ID,
        p_quantity: 1,
        p_expected_unit_price_kcoin: 500,
        p_idempotency_key: BUY_IDEMPOTENCY_KEY,
      },
      {
        schema: "api",
        context: {
          requestId: "req-market-buy-listing",
          userId: USER_ID,
          listingId: LISTING_ID,
          idempotencyKey: BUY_IDEMPOTENCY_KEY,
        },
      },
    );
    expect(result.body.data).toEqual({
      order_id: ORDER_ID,
      purchased_items: [
        {
          item_instance_id: ITEM_ID,
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
        },
      ],
      total_price_kcoin: 500,
      fee_amount_kcoin: 25,
      seller_net_amount_kcoin: 475,
      buyer_balance_after: 1500,
    });
  });

  it("rejects missing idempotency key before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects body user identity before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
        idempotency_key: BUY_IDEMPOTENCY_KEY,
        buyer_user_id: USER_ID,
      },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("maps insufficient balance RPC errors to KCOIN_NOT_ENOUGH", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_buy_listing",
        error: {
          message:
            "insufficient balance: currency KCOIN, available 0, required 500",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
        idempotency_key: BUY_IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("KCOIN_NOT_ENOUGH");
    expect(result.body.error.message).toBe("KCOIN 余额不足。");
  });

  it("maps stale price RPC errors to LISTING_PRICE_CHANGED", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_buy_listing",
        error: {
          message: "listing price changed",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
        idempotency_key: BUY_IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("LISTING_PRICE_CHANGED");
    expect(result.body.error.message).toBe("价格已变化，请刷新后重试。");
  });

  it("maps sold out RPC errors to LISTING_SOLD_OUT", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_buy_listing",
        error: {
          message: "listing sold out",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
        idempotency_key: BUY_IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("LISTING_SOLD_OUT");
    expect(result.body.error.message).toBe("商品已售罄。");
  });

  it("maps own listing RPC errors to CANNOT_BUY_OWN_LISTING", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_buy_listing",
        error: {
          message: "buyer cannot buy own listing",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(buyListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 500,
        idempotency_key: BUY_IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("CANNOT_BUY_OWN_LISTING");
    expect(result.body.error.message).toBe("不能购买自己的挂单。");
  });
});

describe("market update price API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-update-price-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("normalizes snake_case, camelCase and header idempotency input", () => {
    expect(
      normalizeMarketUpdateListingPriceInput(
        {
          listingId: LISTING_ID,
          newUnitPriceKcoin: 650,
        },
        UPDATE_PRICE_IDEMPOTENCY_KEY,
      ),
    ).toMatchObject({
      listing_id: LISTING_ID,
      new_unit_price_kcoin: 650,
      idempotency_key: UPDATE_PRICE_IDEMPOTENCY_KEY,
    });
  });

  it("calls market_update_listing_price with the session user and returns updated price", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      unit_price_kcoin: "650",
      expected_net_amount: 1235,
      price_health: "healthy",
      status: "active",
      idempotent: false,
      rpc_extra_field: "removed",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(updatePriceHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-market-update-price",
        "x-idempotency-key": UPDATE_PRICE_IDEMPOTENCY_KEY,
      },
      body: {
        listing_id: LISTING_ID,
        new_unit_price_kcoin: 650,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_update_listing_price",
      {
        p_user_id: USER_ID,
        p_listing_id: LISTING_ID,
        p_new_unit_price_kcoin: 650,
        p_idempotency_key: UPDATE_PRICE_IDEMPOTENCY_KEY,
      },
      {
        schema: "api",
        context: {
          requestId: "req-market-update-price",
          userId: USER_ID,
          listingId: LISTING_ID,
          idempotencyKey: UPDATE_PRICE_IDEMPOTENCY_KEY,
        },
      },
    );
    expect(result.body.data).toEqual({
      listing_id: LISTING_ID,
      unit_price_kcoin: 650,
      expected_net_amount: 1235,
      status: "active",
    });
  });

  it("rejects missing idempotency key before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      updatePriceHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          new_unit_price_kcoin: 650,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects body user identity before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      updatePriceHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          new_unit_price_kcoin: 650,
          idempotency_key: UPDATE_PRICE_IDEMPOTENCY_KEY,
          seller_user_id: USER_ID,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("maps non-owner RPC errors to FORBIDDEN", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_update_listing_price",
        error: {
          message: "not listing owner",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      updatePriceHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          new_unit_price_kcoin: 650,
          idempotency_key: UPDATE_PRICE_IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(403);
    expect(result.body.error.code).toBe("FORBIDDEN");
    expect(result.body.error.message).toBe("只有卖家可以修改挂单价格。");
  });

  it("maps sold or cancelled listing RPC errors to LISTING_NOT_ACTIVE", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_update_listing_price",
        error: {
          message: "listing is not editable",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      updatePriceHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          new_unit_price_kcoin: 650,
          idempotency_key: UPDATE_PRICE_IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("LISTING_NOT_ACTIVE");
    expect(result.body.error.message).toBe("当前挂单状态不可改价。");
  });

  it("maps idempotency conflicts to IDEMPOTENCY_CONFLICT", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_update_listing_price",
        error: {
          message: "idempotency conflict",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      updatePriceHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          new_unit_price_kcoin: 650,
          idempotency_key: UPDATE_PRICE_IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(result.body.error.message).toBe("幂等键已被其他改价请求使用。");
  });
});

describe("market cancel listing API", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    callRpcRawMock.mockReset();
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({
      sessionId: "session-market-cancel-listing-test",
      userId: USER_ID,
      telegramUserId: 7001,
      userStatus: "active",
      expiresAt: "2026-05-28T00:00:00.000Z",
      sessionTokenHash: "session-hash",
    });
  });

  it("normalizes snake_case, camelCase and header idempotency input", () => {
    expect(
      normalizeMarketCancelListingInput(
        {
          listingId: LISTING_ID,
          reason: "changed_mind",
        },
        CANCEL_LISTING_IDEMPOTENCY_KEY,
      ),
    ).toMatchObject({
      listing_id: LISTING_ID,
      reason: "changed_mind",
      idempotency_key: CANCEL_LISTING_IDEMPOTENCY_KEY,
    });
  });

  it("calls market_cancel_listing with the session user and returns released items", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      status: "cancelled",
      released_item_instance_ids: [ITEM_ID, ITEM_ID_2],
      released_item_ids: [ITEM_ID, ITEM_ID_2],
      cancelled_at: "2026-05-22T00:00:00.000Z",
      idempotent: false,
      rpc_extra_field: "removed",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(cancelListingHandler, {
      method: "POST",
      headers: {
        "x-request-id": "req-market-cancel-listing",
        "x-idempotency-key": CANCEL_LISTING_IDEMPOTENCY_KEY,
      },
      body: {
        listing_id: LISTING_ID,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(callRpcRawMock).toHaveBeenCalledWith(
      "market_cancel_listing",
      {
        p_user_id: USER_ID,
        p_listing_id: LISTING_ID,
        p_idempotency_key: CANCEL_LISTING_IDEMPOTENCY_KEY,
        p_reason: "user_cancelled",
      },
      {
        schema: "api",
        context: {
          requestId: "req-market-cancel-listing",
          userId: USER_ID,
          listingId: LISTING_ID,
          idempotencyKey: CANCEL_LISTING_IDEMPOTENCY_KEY,
        },
      },
    );
    expect(result.body.data).toEqual({
      listing_id: LISTING_ID,
      status: "cancelled",
      released_item_instance_ids: [ITEM_ID, ITEM_ID_2],
      cancelled_at: "2026-05-22T00:00:00.000Z",
    });
  });

  it("accepts the legacy released_item_ids fallback from RPC payloads", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      status: "cancelled",
      released_item_ids: [ITEM_ID],
      cancelled_at: "2026-05-22T00:00:00.000Z",
    });

    const result = await invokeApiHandler<
      ApiSuccessResponse<Record<string, unknown>>
    >(cancelListingHandler, {
      method: "POST",
      body: {
        listing_id: LISTING_ID,
        idempotency_key: CANCEL_LISTING_IDEMPOTENCY_KEY,
      },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.data).toMatchObject({
      released_item_instance_ids: [ITEM_ID],
    });
  });

  it("rejects missing idempotency key before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      cancelListingHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("rejects body user identity before calling RPC", async () => {
    const result = await invokeApiHandler<ApiErrorResponse>(
      cancelListingHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          idempotency_key: CANCEL_LISTING_IDEMPOTENCY_KEY,
          seller_user_id: USER_ID,
        },
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    expect(callRpcRawMock).not.toHaveBeenCalled();
  });

  it("maps non-owner RPC errors to FORBIDDEN", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_cancel_listing",
        error: {
          message: "not listing owner",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      cancelListingHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          idempotency_key: CANCEL_LISTING_IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(403);
    expect(result.body.error.code).toBe("FORBIDDEN");
    expect(result.body.error.message).toBe("只有卖家可以下架挂单。");
  });

  it("maps sold or cancelled listing RPC errors to LISTING_NOT_ACTIVE", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_cancel_listing",
        error: {
          message: "listing cannot be cancelled",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      cancelListingHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          idempotency_key: CANCEL_LISTING_IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("LISTING_NOT_ACTIVE");
    expect(result.body.error.message).toBe("当前挂单状态不可下架。");
  });

  it("maps idempotency conflicts to IDEMPOTENCY_CONFLICT", async () => {
    callRpcRawMock.mockRejectedValueOnce(
      new RpcError({
        rpcName: "market_cancel_listing",
        error: {
          message: "idempotency conflict",
        },
      }),
    );

    const result = await invokeApiHandler<ApiErrorResponse>(
      cancelListingHandler,
      {
        method: "POST",
        body: {
          listing_id: LISTING_ID,
          idempotency_key: CANCEL_LISTING_IDEMPOTENCY_KEY,
        },
      },
    );

    expect(result.statusCode).toBe(409);
    expect(result.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(result.body.error.message).toBe("幂等键已被其他下架请求使用。");
  });
});
