import { describe, expect, it } from "vitest";

import { API_ENDPOINTS } from "../../apps/web/src/api/endpoints";
import {
  MarketBuyListingBodySchema,
  MarketCreateListingBodySchema,
  MarketCreateListingResponseSchema,
  MarketListingDetailResponseSchema,
  MarketListingsResponseSchema,
  MarketListListingsQuerySchema,
  MarketSellRulesResponseSchema,
  MarketSellableItemsResponseSchema,
  MarketSellableItemsQuerySchema,
  MarketUpdateListingPriceBodySchema,
} from "../../packages/validation/src/market.schemas";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "market-test-key-0001";

describe("market API contract schemas", () => {
  it("defines the stage 4 market endpoint group", () => {
    expect(API_ENDPOINTS.market).toEqual({
      listings: "/market/listings",
      listingDetail: "/market/listing-detail",
      buy: "/market/buy",
      sellableItems: "/market/sellable-items",
      sellRules: "/market/sell-rules",
      createListing: "/market/create-listing",
      myListings: "/market/my-listings",
      myListingStats: "/market/my-listing-stats",
      updatePrice: "/market/update-price",
      cancelListing: "/market/cancel-listing",
      stats: "/market/stats",
    });
  });

  it("accepts the documented listings query shape", () => {
    const result = MarketListListingsQuerySchema.parse({
      rarities: "rare,epic",
      type_codes: ["character", "pet"],
      series_ids: USER_ID,
      template_ids: [ITEM_ID],
      min_price: "100",
      max_price: 500,
      sort: "price_low_to_high",
      limit: "50",
      cursor: "cursor-1",
    });

    expect(result).toMatchObject({
      rarities: ["rare", "epic"],
      type_codes: ["character", "pet"],
      min_price: 100,
      max_price: 500,
      sort: "price_low_to_high",
      limit: 50,
    });
  });

  it("rejects invalid listings amounts and page sizes", () => {
    expect(() =>
      MarketListListingsQuerySchema.parse({
        min_price: "Infinity",
      }),
    ).toThrow();

    expect(() =>
      MarketListListingsQuerySchema.parse({
        min_price: "",
      }),
    ).toThrow();

    expect(() =>
      MarketListListingsQuerySchema.parse({
        limit: 51,
      }),
    ).toThrow();
  });

  it("accepts sellable item query filters", () => {
    const result = MarketSellableItemsQuerySchema.parse({
      rarities: "rare",
      type_codes: "character",
      min_price: "100",
      max_price: "500",
      sort: "power_high_to_low",
      limit: "50",
      cursor: "50",
    });

    expect(result).toMatchObject({
      rarities: ["rare"],
      type_codes: ["character"],
      min_price: 100,
      max_price: 500,
      sort: "power_high_to_low",
      limit: 50,
    });

    expect(() =>
      MarketSellableItemsQuerySchema.parse({
        min_price: "600",
        max_price: "500",
      }),
    ).toThrow();
  });

  it("accepts Postgres offset timestamps in sellable item responses", () => {
    const result = MarketSellableItemsResponseSchema.parse({
      items: [
        {
          item_instance_id: ITEM_ID,
          item_instance_ids: [ITEM_ID],
          template_id: USER_ID,
          form_id: null,
          serial_no: 12,
          name: "可出售藏品",
          rarity: "rare",
          type_code: "character",
          image_url: null,
          level: 3,
          power: 120,
          owned_count: 1,
          available_count: 1,
          suggested_price: 500,
          min_price: 300,
          max_price: 800,
          acquired_at: "2026-05-22T06:17:21.898312+00:00",
          is_tradeable: true,
        },
      ],
      next_cursor: null,
    });

    expect(result.items[0]?.acquired_at).toBe(
      "2026-05-22T06:17:21.898312+00:00",
    );
  });

  it("accepts price health in listing card responses", () => {
    const result = MarketListingsResponseSchema.parse({
      items: [
        {
          listing_id: LISTING_ID,
          seller_user_id: USER_ID,
          template_id: ITEM_ID,
          form_id: null,
          name: "测试藏品",
          rarity: "rare",
          type_code: "character",
          image_url: null,
          unit_price_kcoin: 300,
          currency_code: "KCOIN",
          item_count: 1,
          remaining_count: 1,
          status: "active",
          seller_display_name: "卖家",
          is_own_listing: false,
          is_buyable: true,
          not_buyable_reason: null,
          price_health: "healthy",
          created_at: "2026-05-22T00:00:00.000Z",
          expires_at: null,
        },
      ],
      next_cursor: null,
    });

    expect(result.items[0]?.price_health).toBe("healthy");
  });

  it("requires idempotency and server-owned user identity for create listing", () => {
    const result = MarketCreateListingBodySchema.parse({
      item_instance_ids: [ITEM_ID],
      unit_price_kcoin: 250,
      idempotency_key: IDEMPOTENCY_KEY,
      client_context: {
        source: "trade_sell_tab",
        client_nonce: IDEMPOTENCY_KEY,
      },
    });

    expect(result.unit_price_kcoin).toBe(250);

    expect(() =>
      MarketCreateListingBodySchema.parse({
        item_instance_ids: [ITEM_ID],
        unit_price_kcoin: 250,
        idempotency_key: IDEMPOTENCY_KEY,
        seller_user_id: USER_ID,
      }),
    ).toThrow();

    expect(() =>
      MarketCreateListingBodySchema.parse({
        item_instance_ids: [ITEM_ID],
        unit_price_kcoin: 0,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
    ).toThrow();
  });

  it("accepts create listing response and duplicate idempotent response", () => {
    expect(
      MarketCreateListingResponseSchema.parse({
        listing_id: LISTING_ID,
        item_count: 1,
        remaining_count: 1,
        unit_price_kcoin: 300,
        fee_bps: 500,
        expected_net_amount: 285,
        status: "active",
        price_health: "healthy",
        idempotent: false,
      }),
    ).toMatchObject({
      listing_id: LISTING_ID,
      expected_net_amount: 285,
      price_health: "healthy",
    });

    expect(
      MarketCreateListingResponseSchema.parse({
        listing_id: LISTING_ID,
        item_count: 1,
        remaining_count: 1,
        unit_price_kcoin: 300,
        fee_bps: 500,
        expected_net_amount: 285,
        status: "active",
        price_health: "healthy",
        idempotent: true,
      }),
    ).toEqual({
      listing_id: LISTING_ID,
      item_count: 1,
      remaining_count: 1,
      unit_price_kcoin: 300,
      fee_bps: 500,
      expected_net_amount: 285,
      status: "active",
      price_health: "healthy",
      idempotent: true,
    });
  });

  it("accepts sell rules response", () => {
    expect(
      MarketSellRulesResponseSchema.parse({
        fee_type: "market_sell",
        currency_code: "KCOIN",
        fee_bps: 500,
        source: "active_rule",
      }),
    ).toEqual({
      fee_type: "market_sell",
      currency_code: "KCOIN",
      fee_bps: 500,
      source: "active_rule",
    });
  });

  it("requires quantity 1 and expected price for buy listing", () => {
    expect(
      MarketBuyListingBodySchema.parse({
        listing_id: LISTING_ID,
        expected_unit_price_kcoin: 300,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
    ).toMatchObject({
      listing_id: LISTING_ID,
      quantity: 1,
      expected_unit_price_kcoin: 300,
    });

    expect(() =>
      MarketBuyListingBodySchema.parse({
        listing_id: LISTING_ID,
        quantity: 2,
        expected_unit_price_kcoin: 300,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
    ).toThrow();

    expect(() =>
      MarketBuyListingBodySchema.parse({
        listing_id: LISTING_ID,
        quantity: 1,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
    ).toThrow();
  });

  it("accepts the documented listing detail response fields", () => {
    const result = MarketListingDetailResponseSchema.parse({
      listing: {
        listing_id: LISTING_ID,
        seller_user_id: USER_ID,
        template_id: ITEM_ID,
        form_id: null,
        name: "测试藏品",
        description: "详情说明",
        rarity: "rare",
        type_code: "character",
        image_url: null,
        seller: {
          user_id: USER_ID,
          display_name: "卖家",
          avatar_url: null,
        },
        seller_display_name: "卖家",
        unit_price_kcoin: 300,
        currency_code: "KCOIN",
        item_count: 1,
        remaining_count: 1,
        status: "active",
        floor_price_kcoin: 280,
        avg_price_kcoin: 290,
        last_sale_price_kcoin: 300,
        reference_price_kcoin: 280,
        active_listing_count: 3,
        sale_count_24h: 1,
        volume_24h_kcoin: 300,
        snapshot_at: "2026-05-22T00:00:00.000Z",
        price_health: "healthy",
        market_depth: [
          {
            price_kcoin: 300,
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
      },
    });

    expect(result.listing).toMatchObject({
      seller: {
        user_id: USER_ID,
        display_name: "卖家",
      },
      avg_price_kcoin: 290,
      active_listing_count: 3,
      can_buy: true,
      disabled_reason: null,
    });
  });

  it("uses new_unit_price_kcoin for update price and rejects body user_id", () => {
    expect(
      MarketUpdateListingPriceBodySchema.parse({
        listing_id: LISTING_ID,
        new_unit_price_kcoin: 400,
        idempotency_key: IDEMPOTENCY_KEY,
      }).new_unit_price_kcoin,
    ).toBe(400);

    expect(() =>
      MarketUpdateListingPriceBodySchema.parse({
        listing_id: LISTING_ID,
        new_unit_price_kcoin: 400,
        idempotency_key: IDEMPOTENCY_KEY,
        user_id: USER_ID,
      }),
    ).toThrow();
  });
});
