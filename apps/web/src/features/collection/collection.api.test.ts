import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  apiRequest: mocks.apiRequest,
}));

describe("collection api", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
  });

  it("passes inventory pagination cursor through the list API", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      items: [],
      total: 60,
      limit: 20,
      offset: 40,
      next_cursor: null,
    });

    const { fetchInventory } = await import("./collection.api");
    const result = await fetchInventory({ cursor: "40", limit: 20 });
    const [url, requestOptions] = mocks.apiRequest.mock.calls[0] ?? [];
    const params = new URLSearchParams(String(url).split("?")[1] ?? "");

    expect(String(url).startsWith("/inventory/list?")).toBe(true);
    expect(params.get("cursor")).toBe("40");
    expect(params.get("limit")).toBe("20");
    expect(requestOptions).toMatchObject({
      method: "GET",
    });
    expect(result.nextCursor).toBeNull();
  });

  it("passes include_locked through the inventory list API", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
      next_cursor: null,
      statuses: ["available", "locked", "listed", "minting", "minted"],
    });

    const { fetchInventory } = await import("./collection.api");
    await fetchInventory({ includeLocked: true, limit: 100 });
    const [url] = mocks.apiRequest.mock.calls[0] ?? [];
    const params = new URLSearchParams(String(url).split("?")[1] ?? "");

    expect(String(url).startsWith("/inventory/list?")).toBe(true);
    expect(params.get("include_locked")).toBe("true");
    expect(params.get("limit")).toBe("100");
  });

  it("requests onchain status for inventory detail so Mint state is server-backed", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      item_instance_id: "66666666-6666-4666-8666-666666666666",
      template_id: "55555555-5555-4555-8555-555555555555",
      name: "森林幼芽",
      status: "available",
      nft_mint_status: "queued",
      is_mintable: true,
      onchain_status: {
        is_minted: false,
        mint_status: "queued",
      },
    });

    const { fetchInventoryDetail } = await import("./collection.api");
    const result = await fetchInventoryDetail(
      "66666666-6666-4666-8666-666666666666",
    );
    const [url, requestOptions] = mocks.apiRequest.mock.calls[0] ?? [];
    const params = new URLSearchParams(String(url).split("?")[1] ?? "");

    expect(String(url).startsWith("/inventory/detail?")).toBe(true);
    expect(params.get("item_instance_id")).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
    expect(params.get("include_market_status")).toBe("true");
    expect(params.get("include_upgrade_preview")).toBe("true");
    expect(params.get("include_evolution_preview")).toBe("false");
    expect(params.get("include_decompose_preview")).toBe("true");
    expect(params.get("include_onchain_status")).toBe("true");
    expect(requestOptions).toMatchObject({
      method: "GET",
    });
    expect(result.onchainStatus).toMatchObject({
      isMinted: false,
      mintStatus: "queued",
    });
  });

  it("normalizes minted inventory rows and full Mint queue statuses", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      items: [
        {
          item_instance_id: "66666666-6666-4666-8666-666666666666",
          template_id: "55555555-5555-4555-8555-555555555555",
          name: "链上森林幼芽",
          status: "minted",
          nft_mint_status: "minted",
          is_mintable: true,
        },
      ],
      total: 1,
      limit: 40,
      offset: 0,
      statuses: ["available", "listed", "minting", "minted"],
    });

    const { fetchInventory, normalizeInventoryDetail } =
      await import("./collection.api");
    const inventory = await fetchInventory();
    const [url] = mocks.apiRequest.mock.calls[0] ?? [];
    const params = new URLSearchParams(String(url).split("?")[1] ?? "");

    expect(String(url).startsWith("/inventory/list?")).toBe(true);
    expect(params.get("limit")).toBe("40");
    expect(params.has("statuses")).toBe(false);
    expect(inventory.items[0]).toMatchObject({
      itemInstanceId: "66666666-6666-4666-8666-666666666666",
      status: "minted",
      nftMintStatus: "minted",
    });
    expect(inventory.statuses).toEqual([
      "available",
      "listed",
      "minting",
      "minted",
    ]);

    const detail = normalizeInventoryDetail({
      item_instance_id: "77777777-7777-4777-8777-777777777777",
      template_id: "55555555-5555-4555-8555-555555555555",
      name: "确认中的森林幼芽",
      status: "minting",
      nft_mint_status: "queued",
      item_version: 7,
      onchain_status: {
        is_minted: false,
        mint_status: "confirming",
      },
    });

    expect(detail.onchainStatus).toMatchObject({
      isMinted: false,
      mintStatus: "confirming",
    });
    expect(detail.itemVersion).toBe(7);
  });

  it("sends expected item version with upgrade requests", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      item_instance_id: "66666666-6666-4666-8666-666666666666",
      from_level: 1,
      to_level: 2,
      from_power: 10,
      to_power: 20,
      cost_fgems: 25,
      idempotent: false,
    });

    const { upgradeInventoryItem } = await import("./collection.api");
    const result = await upgradeInventoryItem({
      itemInstanceId: "66666666-6666-4666-8666-666666666666",
      expectedFgemsCost: 25,
      expectedItemVersion: 7,
      targetLevel: 2,
      idempotencyKey: "inventory:upgrade:test",
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith("/inventory/upgrade", {
      method: "POST",
      body: {
        item_instance_id: "66666666-6666-4666-8666-666666666666",
        idempotency_key: "inventory:upgrade:test",
        expected_fgems_cost: 25,
        expected_item_version: 7,
        target_level: 2,
      },
      headers: {
        "X-Idempotency-Key": "inventory:upgrade:test",
      },
    });
    expect(result).toMatchObject({
      itemInstanceId: "66666666-6666-4666-8666-666666666666",
      toLevel: 2,
    });
  });

  it("creates direct sell entries through the inventory endpoint", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      listing_id: "33333333-3333-4333-8333-333333333333",
      item_count: 1,
      remaining_count: 1,
      unit_price_kcoin: 500,
      fee_bps: 500,
      expected_net_amount: 475,
      status: "active",
      price_health: "healthy",
      idempotent: false,
    });

    const { sellInventoryItem } = await import("./collection.api");
    const result = await sellInventoryItem({
      itemInstanceId: "66666666-6666-4666-8666-666666666666",
      unitPriceKcoin: 500,
      idempotencyKey: "inventory:sell:test",
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith("/inventory/sell-entry", {
      method: "POST",
      body: {
        item_instance_ids: ["66666666-6666-4666-8666-666666666666"],
        unit_price: 500,
        currency: "KCOIN",
        idempotency_key: "inventory:sell:test",
      },
      headers: {
        "X-Idempotency-Key": "inventory:sell:test",
      },
    });
    expect(result).toMatchObject({
      listingId: "33333333-3333-4333-8333-333333333333",
      expectedNetAmountKcoin: 475,
    });
  });

  it("cancels direct sell entries through the inventory endpoint", async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      listing_id: "33333333-3333-4333-8333-333333333333",
      status: "cancelled",
      released_item_instance_ids: ["66666666-6666-4666-8666-666666666666"],
    });

    const { cancelInventorySell } = await import("./collection.api");
    const result = await cancelInventorySell({
      itemInstanceId: "66666666-6666-4666-8666-666666666666",
      listingId: "33333333-3333-4333-8333-333333333333",
      idempotencyKey: "inventory:cancel-sell:test",
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith("/inventory/cancel-sell", {
      method: "POST",
      body: {
        item_instance_id: "66666666-6666-4666-8666-666666666666",
        listing_id: "33333333-3333-4333-8333-333333333333",
        idempotency_key: "inventory:cancel-sell:test",
      },
      headers: {
        "X-Idempotency-Key": "inventory:cancel-sell:test",
      },
    });
    expect(result).toMatchObject({
      listingId: "33333333-3333-4333-8333-333333333333",
      releasedItemInstanceIds: ["66666666-6666-4666-8666-666666666666"],
    });
  });
});
