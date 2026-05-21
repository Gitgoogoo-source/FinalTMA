import { describe, expect, it } from "vitest";
import { buildInventoryListResponse } from "../../api/inventory/list";

describe("inventory API helpers", () => {
  it("maps inventory_list_user_items RPC payload into first-phase API data", () => {
    const response = buildInventoryListResponse(
      {
        items: [
          {
            item_instance_id: "11111111-1111-4111-8111-111111111111",
            template_id: "22222222-2222-4222-8222-222222222222",
            template_slug: "forest_sproutling",
            name: "Forest Sproutling",
            rarity: {
              code: "COMMON",
              display_name: "Common",
              sort_order: 10,
            },
            series: {
              id: "33333333-3333-4333-8333-333333333333",
              slug: "forest_guardians",
              display_name: "Forest Guardians",
            },
            form: {
              id: "44444444-4444-4444-8444-444444444444",
              index: 1,
              display_name: "Forest Sproutling",
            },
            type_code: "CHARACTER",
            serial_no: 7,
            level: 3,
            power: 42,
            status: "available",
            image_url:
              "/storage/v1/object/public/collectibles/forest_sproutling_hero.png",
            tradeable: true,
            upgradeable: true,
            evolvable: true,
            decomposable: true,
            nft_mintable: true,
            obtained_at: "2026-05-21T00:00:00.000Z",
          },
        ],
        total: 3,
        limit: 1,
        offset: 0,
        statuses: ["available"],
        server_time: "2026-05-21T00:00:01.000Z",
      },
      0,
      1,
    );

    expect(response.next_cursor).toBe("1");
    expect(response.items[0]).toMatchObject({
      name: "Forest Sproutling",
      rarity: {
        code: "COMMON",
      },
      level: 3,
      power: 42,
      is_tradeable: true,
    });
  });
});
