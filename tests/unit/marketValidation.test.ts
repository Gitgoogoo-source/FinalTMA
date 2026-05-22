import { describe, expect, it } from "vitest";

import { API_ENDPOINTS } from "../../apps/web/src/api/endpoints";
import {
  MarketBuyListingBodySchema,
  MarketCreateListingBodySchema,
  MarketListListingsQuerySchema,
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
