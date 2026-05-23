import type { Page, Route } from "@playwright/test";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BOX_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const STAR_ORDER_ID = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_ID = "55555555-5555-4555-8555-555555555555";
const ITEM_INSTANCE_ID = "66666666-6666-4666-8666-666666666666";

export const TEST_INIT_DATA =
  "auth_date=1779321600&query_id=e2e-query&user=%7B%22id%22%3A7001%2C%22first_name%22%3A%22%E6%B5%8B%E8%AF%95%22%7D&hash=e2e";

export async function mockFirstPhaseApi(page: Page): Promise<void> {
  await page.route("**/api/auth/telegram", (route) =>
    fulfillOk(route, {
      status: "ok",
      isNewUser: false,
      user: {
        id: USER_ID,
        telegramUserId: "7001",
        username: "tester",
        firstName: "测试",
        lastName: "玩家",
        languageCode: "zh-hans",
        avatarUrl: null,
        inviteCode: "invite_e2e",
      },
      session: {
        sessionId: "session-e2e",
        expiresAt: "2026-05-28T00:00:00.000Z",
        expiresInSeconds: 604800,
        cookieBased: true,
      },
    }),
  );

  await page.route("**/api/me/bootstrap", (route) =>
    fulfillOk(route, {
      profile: {
        id: USER_ID,
        telegram_user_id: "7001",
        username: "tester",
        display_name: "测试玩家",
        avatar_url: null,
      },
      balances: {
        KCOIN: {
          available: "1200",
          locked: "0",
        },
        FGEMS: {
          available: "80",
          locked: "0",
        },
        STAR_DISPLAY: {
          available: "30",
          locked: "0",
        },
      },
      feature_flags: {
        "gacha.open_box": true,
      },
      server_time: "2026-05-21T00:00:00.000Z",
    }),
  );

  await page.route("**/api/me/assets", (route) =>
    fulfillOk(route, {
      profile: {
        id: USER_ID,
        telegram_user_id: "7001",
        username: "tester",
        display_name: "测试玩家",
        avatar_url: null,
      },
      balances: {
        KCOIN: {
          available: "1200",
          locked: "0",
        },
        FGEMS: {
          available: "80",
          locked: "0",
        },
        STAR_DISPLAY: {
          available: "30",
          locked: "0",
        },
      },
      updated_at: "2026-05-21T00:00:00.000Z",
    }),
  );

  await page.route("**/api/market/my-listing-stats", (route) =>
    fulfillOk(route, {
      active_count: 0,
      active_listing_count: 0,
      active_item_count: 0,
      total_listing_value_kcoin: 0,
      expected_net_amount_kcoin: 0,
      sold_24h_count: 0,
      sold_24h_value_kcoin: 0,
    }),
  );

  await page.route("**/api/boxes/list?*", (route) =>
    fulfillOk(route, {
      items: [boxPayload()],
      next_cursor: null,
      server_time: "2026-05-21T00:00:00.000Z",
    }),
  );

  await page.route("**/api/boxes/rewards?*", (route) =>
    fulfillOk(route, {
      box_id: BOX_ID,
      box_name: "测试盲盒",
      box_status: "active",
      pool_version_id: "77777777-7777-4777-8777-777777777777",
      pool_version: 1,
      items: [
        {
          pool_item_id: "88888888-8888-4888-8888-888888888888",
          template_id: TEMPLATE_ID,
          name: "森林幼芽",
          rarity: "common",
          rarity_label: "普通",
          item_type: "character",
          item_type_label: "角色",
          display_probability: "100%",
          probability_bps: 10000,
          is_limited: false,
          is_pity_eligible: false,
        },
      ],
      pity_rule: {
        threshold: 3,
        target_rarity: "epic",
        description: "3 抽内必出史诗",
      },
      generated_at: "2026-05-21T00:00:00.000Z",
    }),
  );

  await page.route("**/api/boxes/create-open-order", async (route) => {
    const body = route.request().postDataJSON() as
      | { draw_count?: unknown }
      | undefined;
    const drawCount = body?.draw_count === 10 ? 10 : 1;

    await fulfillOk(route, {
      order_id: ORDER_ID,
      star_order_id: STAR_ORDER_ID,
      invoice_payload: `gacha:${ORDER_ID}`,
      xtr_amount: drawCount === 10 ? 90 : 10,
      draw_count: drawCount,
      order_status: "completed",
      payment_status: "dev_paid",
      dev_payment_processed: true,
      idempotent: false,
      result_ready: true,
    });
  });

  await page.route("**/api/boxes/result?*", (route) =>
    fulfillOk(route, {
      order_id: ORDER_ID,
      status: "completed",
      order_status: "completed",
      quantity: 1,
      paid_stars: 10,
      returned_kcoin: 100,
      paid_at: "2026-05-21T00:00:00.000Z",
      completed_at: "2026-05-21T00:00:01.000Z",
      box: {
        display_name: "测试盲盒",
      },
      payment: {
        status: "dev_paid",
      },
      balances: {
        kcoin: {
          available: "1300",
        },
      },
      results: [inventoryItemResult()],
      server_time: "2026-05-21T00:00:01.000Z",
    }),
  );

  await page.route("**/api/inventory/list?*", (route) =>
    fulfillOk(route, {
      items: [inventoryItemPayload()],
      total: 1,
      limit: 40,
      offset: 0,
      next_cursor: null,
      statuses: ["available"],
      server_time: "2026-05-21T00:00:00.000Z",
    }),
  );
}

function boxPayload() {
  return {
    id: BOX_ID,
    slug: "test-box",
    display_name: "测试盲盒",
    description: "第一阶段自动化测试盲盒",
    tier: "normal",
    status: "active",
    single_star_price: 10,
    ten_draw_price: 90,
    discount_rate: 0.9,
    discount_bps: 1000,
    stock_status: "available",
    total_stock: 100,
    remaining_stock: 88,
    pity_progress: {
      rule_id: "99999999-9999-4999-8999-999999999999",
      threshold: 3,
      current_count: 1,
      total_draws: 1,
      remaining_to_guaranteed: 2,
      target_rarity: "epic",
      guaranteed_next: false,
      updated_at: "2026-05-21T00:00:00.000Z",
    },
    is_openable: true,
    disabled_reason: null,
    kcoin_return_per_draw: 100,
    sort_order: 1,
    updated_at: "2026-05-21T00:00:00.000Z",
  };
}

function inventoryItemPayload() {
  return {
    item_instance_id: ITEM_INSTANCE_ID,
    template_id: TEMPLATE_ID,
    template_slug: "forest_sproutling",
    name: "森林幼芽",
    subtitle: "测试藏品",
    description: "已进入你的库存",
    rarity: {
      code: "COMMON",
      display_name: "普通",
      sort_order: 10,
    },
    series: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      slug: "forest_guardians",
      display_name: "森林守护者",
    },
    form: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      index: 1,
      display_name: "基础形态",
    },
    type_code: "CHARACTER",
    serial_no: 1,
    level: 1,
    power: 10,
    status: "available",
    tradeable: true,
    upgradeable: true,
    evolvable: true,
    decomposable: true,
    nft_mintable: true,
    source_type: "gacha",
    source_id: ORDER_ID,
    obtained_at: "2026-05-21T00:00:01.000Z",
  };
}

function inventoryItemResult() {
  return {
    draw_index: 1,
    reward_source: "random",
    is_pity_hit: false,
    item_instance_id: ITEM_INSTANCE_ID,
    template_id: TEMPLATE_ID,
    template_slug: "forest_sproutling",
    name: "森林幼芽",
    subtitle: "测试藏品",
    description: "已进入你的库存",
    serial_number: 1,
    rarity: "common",
    rarity_label: "普通",
    item_type: "character",
    form_name: "基础形态",
    level: 1,
    power: 10,
  };
}

async function fulfillOk(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      success: true,
      data,
    }),
  });
}
