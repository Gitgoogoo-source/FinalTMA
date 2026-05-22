import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from "../../api/_shared/handler";
import { ApiError } from "../../api/_shared/handler";
import createListingHandler, {
  normalizeMarketCreateListingInput,
} from "../../api/market/create-listing";
import listingDetailHandler from "../../api/market/listing-detail";
import listingsHandler from "../../api/market/listings";
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

  it("returns a successful idempotent response without requiring first-create fields", async () => {
    callRpcRawMock.mockResolvedValueOnce({
      listing_id: LISTING_ID,
      status: "active",
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
      status: "active",
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
