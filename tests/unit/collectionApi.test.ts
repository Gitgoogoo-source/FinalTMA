import { beforeEach, describe, expect, it, vi } from "vitest";

describe("collection inventory API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_APP_ENV", "test");
    vi.stubEnv("VITE_API_BASE_URL", "/api");
    vi.stubEnv("VITE_TELEGRAM_BOT_USERNAME", "test_bot");
  });

  it("normalizes inventory list payload for the collection page", async () => {
    const { normalizeInventoryResponse } =
      await import("../../apps/web/src/features/collection/collection.api");
    const response = normalizeInventoryResponse({
      items: [
        {
          item_instance_id: "11111111-1111-4111-8111-111111111111",
          template_id: "22222222-2222-4222-8222-222222222222",
          template_slug: "moon_guardian",
          name: "月冕守门人",
          description: "守护月冕边境的初阶角色。",
          rarity: {
            code: "RARE",
            display_name: "稀有",
            sort_order: 20,
          },
          series: {
            id: "33333333-3333-4333-8333-333333333333",
            slug: "moon_crown",
            display_name: "月冕系列",
          },
          form: {
            id: "44444444-4444-4444-8444-444444444444",
            index: 1,
            display_name: "初阶",
          },
          serial_no: 7,
          level: 3,
          power: 420,
          status: "available",
          image_url: "/collectibles/moon_guardian.png",
          is_tradeable: true,
          is_upgradeable: true,
        },
      ],
      total: 1,
      limit: 40,
      offset: 0,
      next_cursor: null,
      statuses: ["available"],
      server_time: "2026-05-21T00:00:00.000Z",
    });

    expect(response.items[0]).toMatchObject({
      itemInstanceId: "11111111-1111-4111-8111-111111111111",
      name: "月冕守门人",
      rarity: {
        code: "rare",
        label: "稀有",
      },
      series: {
        displayName: "月冕系列",
      },
      form: {
        displayName: "初阶",
      },
      serialNo: 7,
      level: 3,
      power: 420,
      imageUrl: "/collectibles/moon_guardian.png",
      isTradeable: true,
      isUpgradeable: true,
    });
    expect(response.total).toBe(1);
  });

  it("normalizes grouped inventory summary payload for the collection page", async () => {
    const { normalizeInventorySummaryResponse } =
      await import("../../apps/web/src/features/collection/collection.api");
    const response = normalizeInventorySummaryResponse({
      groups: [
        {
          group_key:
            "template:22222222-2222-4222-8222-222222222222:form:44444444-4444-4444-8444-444444444444",
          template_id: "22222222-2222-4222-8222-222222222222",
          form_id: "44444444-4444-4444-8444-444444444444",
          owned_count: 531,
          available_count: 520,
          listed_count: 10,
          locked_count: 1,
          minting_count: 0,
          minted_count: 0,
          max_level: 8,
          max_power: 900,
          latest_obtained_at: "2026-05-21T00:00:00.000Z",
          representative_item: {
            item_instance_id: "11111111-1111-4111-8111-111111111111",
            template_id: "22222222-2222-4222-8222-222222222222",
            template_slug: "moon_guardian",
            name: "月冕守门人",
            rarity: {
              code: "RARE",
              display_name: "稀有",
              sort_order: 20,
            },
            form: {
              id: "44444444-4444-4444-8444-444444444444",
              index: 1,
              display_name: "初阶",
            },
            level: 8,
            power: 900,
            status: "available",
            is_tradeable: true,
            is_upgradeable: true,
          },
        },
      ],
      total: 2438,
      group_total: 1,
      summary: {
        total_count: 2438,
        available_count: 2400,
        listed_count: 37,
        locked_count: 1,
        minting_count: 0,
        minted_count: 0,
        group_count: 1,
      },
      statuses: ["available", "listed"],
      server_time: "2026-05-21T00:00:00.000Z",
    });

    expect(response.total).toBe(2438);
    expect(response.summary.availableCount).toBe(2400);
    expect(response.groups).toHaveLength(1);
    expect(response.groups[0]).toMatchObject({
      availableCount: 520,
      key: "template:22222222-2222-4222-8222-222222222222:form:44444444-4444-4444-8444-444444444444",
      ownedCount: 531,
      representativeItem: {
        itemInstanceId: "11111111-1111-4111-8111-111111111111",
        name: "月冕守门人",
        rarity: {
          code: "rare",
        },
      },
    });
    expect(response.items[0]?.itemInstanceId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("normalizes inventory decompose payload for the collection page", async () => {
    const { normalizeDecomposeItemResponse } =
      await import("../../apps/web/src/features/collection/collection.api");
    const response = normalizeDecomposeItemResponse({
      decomposed_item_instance_ids: ["11111111-1111-4111-8111-111111111111"],
      gained_fgems: "150",
      total_reward_fgems: 150,
      fgems_balance_before: "80",
      fgems_balance_after: "230",
      balance_change: 150,
      ledger_id: "22222222-2222-4222-8222-222222222222",
      items: [
        {
          item_instance_id: "11111111-1111-4111-8111-111111111111",
          reward_fgems: 150,
        },
      ],
      decomposed_at: "2026-05-21T00:00:04.000Z",
      idempotent: false,
    });

    expect(response).toMatchObject({
      decomposedItemInstanceIds: ["11111111-1111-4111-8111-111111111111"],
      gainedFgems: 150,
      totalRewardFgems: 150,
      fgemsBalanceBefore: 80,
      fgemsBalanceAfter: 230,
      balanceChange: 150,
      ledgerId: "22222222-2222-4222-8222-222222222222",
      decomposedAt: "2026-05-21T00:00:04.000Z",
      idempotent: false,
    });
  });

  it("normalizes direct sell and cancel payloads for the collection page", async () => {
    const { normalizeCancelSellResponse, normalizeSellEntryResponse } =
      await import("../../apps/web/src/features/collection/collection.api");
    const sellResponse = normalizeSellEntryResponse({
      listing_id: "33333333-3333-4333-8333-333333333333",
      item_count: 1,
      remaining_count: 1,
      unit_price_kcoin: "500",
      fee_bps: 500,
      expected_net_amount: 475,
      status: "active",
      price_health: "healthy",
      idempotent: false,
    });
    const cancelResponse = normalizeCancelSellResponse({
      listing_id: "33333333-3333-4333-8333-333333333333",
      status: "cancelled",
      released_item_instance_ids: ["11111111-1111-4111-8111-111111111111"],
      cancelled_at: "2026-05-21T00:00:05.000Z",
    });

    expect(sellResponse).toMatchObject({
      listingId: "33333333-3333-4333-8333-333333333333",
      unitPriceKcoin: 500,
      expectedNetAmountKcoin: 475,
      status: "active",
    });
    expect(cancelResponse).toMatchObject({
      listingId: "33333333-3333-4333-8333-333333333333",
      status: "cancelled",
      releasedItemInstanceIds: ["11111111-1111-4111-8111-111111111111"],
      cancelledAt: "2026-05-21T00:00:05.000Z",
    });
  });
});
