import { expect, test, type Route } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

const LISTING_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SELLER_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const TEMPLATE_ID = "cccccccc-3333-4333-8333-cccccccccccc";
const FORM_ID = "dddddddd-4444-4444-8444-dddddddddddd";
const ITEM_INSTANCE_ID = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
const ORDER_ID = "ffffffff-6666-4666-8666-ffffffffffff";

test("购买页可打开商品详情并完成购买确认", async ({ page }) => {
  const buyRequests: unknown[] = [];
  let purchaseCompleted = false;

  await mockFirstPhaseApi(page);
  await mockMarketBuyApi(
    page,
    buyRequests,
    () => purchaseCompleted,
    () => {
      purchaseCompleted = true;
    },
  );

  await page.goto(`/trade?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);

  await expect(page.getByTestId("trade-buy-panel")).toBeVisible();
  await expect(page.getByLabel("K-coin 余额").getByText("1,200")).toBeVisible();
  await page.locator(`[data-listing-id="${LISTING_ID}"]`).click();

  await expect(page.getByRole("dialog", { name: "月冕守门人" })).toBeVisible();
  await expect(page.getByText("市场参考价", { exact: true })).toBeVisible();
  await expect(
    page.locator(".listing-detail-price").getByText("暂无参考", {
      exact: true,
    }),
  ).toHaveCount(3);
  await expect(
    page.locator(".listing-detail-depth__empty").getByText("暂无深度", {
      exact: true,
    }),
  ).toBeVisible();

  await page
    .locator(".listing-detail-sheet__panel")
    .getByRole("button", { name: "购买", exact: true })
    .click();

  await expect(page.getByText("购买确认", { exact: true })).toBeVisible();
  await expect(page.getByText("需支付", { exact: true })).toBeVisible();
  await expect(page.getByText("当前余额", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "确认购买", exact: true }).click();

  await expect(page.getByText("购买成功", { exact: true })).toBeVisible();
  await expect(page.locator(".buy-confirm-dialog__panel")).toHaveCount(0);
  await expect(page.getByLabel("K-coin 余额").getByText("900")).toBeVisible();

  const detailDialog = page.getByRole("dialog", { name: "月冕守门人" });
  await detailDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(detailDialog).toBeHidden();

  await page.getByRole("link", { name: "藏品" }).click();
  await expect(page.getByTestId("collection-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "月冕守门人" })).toBeVisible();

  expect(buyRequests).toHaveLength(1);
  expect(buyRequests[0]).toMatchObject({
    listing_id: LISTING_ID,
    quantity: 1,
    expected_unit_price_kcoin: 300,
  });
});

async function mockMarketBuyApi(
  page: Parameters<typeof mockFirstPhaseApi>[0],
  buyRequests: unknown[],
  isPurchaseCompleted: () => boolean,
  onPurchaseCompleted: () => void,
): Promise<void> {
  await page.route("**/api/me/assets", (route) =>
    fulfillOk(route, buyerAssetsPayload(isPurchaseCompleted())),
  );

  await page.route("**/api/inventory/list?*", (route) =>
    fulfillOk(route, {
      items: isPurchaseCompleted() ? [purchasedInventoryItemPayload()] : [],
      total: isPurchaseCompleted() ? 1 : 0,
      limit: 40,
      offset: 0,
      next_cursor: null,
      statuses: ["available"],
      server_time: "2026-05-23T00:01:00.000Z",
    }),
  );

  await page.route("**/api/market/listings?*", (route) =>
    fulfillOk(route, {
      items: isPurchaseCompleted() ? [] : [listingCardPayload()],
      next_cursor: null,
    }),
  );

  await page.route("**/api/market/listing-detail?*", (route) =>
    fulfillOk(route, {
      listing: listingDetailPayload(),
    }),
  );

  await page.route("**/api/market/buy", async (route) => {
    buyRequests.push(route.request().postDataJSON());
    onPurchaseCompleted();

    await fulfillOk(route, {
      order_id: ORDER_ID,
      purchased_items: [
        {
          item_instance_id: ITEM_INSTANCE_ID,
          template_id: TEMPLATE_ID,
          form_id: FORM_ID,
        },
      ],
      total_price_kcoin: 300,
      fee_amount_kcoin: 15,
      seller_net_amount_kcoin: 285,
      buyer_balance_after: 900,
    });
  });
}

function listingCardPayload() {
  return {
    listing_id: LISTING_ID,
    seller_user_id: SELLER_ID,
    template_id: TEMPLATE_ID,
    form_id: FORM_ID,
    name: "月冕守门人",
    rarity: "epic",
    rarity_label: "史诗",
    type_code: "character",
    image_url: null,
    serial_no: 12,
    unit_price_kcoin: 300,
    currency_code: "KCOIN",
    item_count: 1,
    remaining_count: 1,
    status: "active",
    seller_display_name: "市场卖家",
    price_health: "unknown",
    is_own_listing: false,
    is_buyable: true,
    can_buy: true,
    not_buyable_reason: null,
    created_at: "2026-05-23T00:00:00.000Z",
    expires_at: null,
  };
}

function listingDetailPayload() {
  return {
    ...listingCardPayload(),
    description: "守护月光林地的限定角色。",
    seller: {
      user_id: SELLER_ID,
      display_name: "市场卖家",
      avatar_url: null,
    },
    floor_price_kcoin: null,
    avg_price_kcoin: null,
    last_sale_price_kcoin: null,
    reference_price_kcoin: null,
    active_listing_count: 0,
    sale_count_24h: 0,
    volume_24h_kcoin: 0,
    snapshot_at: null,
    market_depth: [],
    item_instance_ids: [ITEM_INSTANCE_ID],
    disabled_reason: null,
  };
}

function buyerAssetsPayload(isPurchaseCompleted: boolean) {
  return {
    profile: {
      id: "11111111-1111-4111-8111-111111111111",
      telegram_user_id: "7001",
      username: "tester",
      display_name: "测试玩家",
      avatar_url: null,
    },
    balances: {
      KCOIN: {
        available: isPurchaseCompleted ? "900" : "1200",
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
    updated_at: isPurchaseCompleted
      ? "2026-05-23T00:01:00.000Z"
      : "2026-05-23T00:00:00.000Z",
  };
}

function purchasedInventoryItemPayload() {
  return {
    item_instance_id: ITEM_INSTANCE_ID,
    template_id: TEMPLATE_ID,
    template_slug: "moon_crown_guardian",
    name: "月冕守门人",
    subtitle: "市场购入藏品",
    description: "守护月光林地的限定角色。",
    rarity: {
      code: "EPIC",
      display_name: "史诗",
      sort_order: 30,
    },
    series: {
      id: "99999999-9999-4999-8999-999999999999",
      slug: "moon_guardians",
      display_name: "月光守护者",
    },
    form: {
      id: FORM_ID,
      index: 1,
      display_name: "基础形态",
    },
    type_code: "CHARACTER",
    serial_no: 12,
    level: 1,
    power: 88,
    status: "available",
    tradeable: true,
    upgradeable: true,
    evolvable: true,
    decomposable: true,
    nft_mintable: true,
    source_type: "market_purchase",
    source_id: ORDER_ID,
    obtained_at: "2026-05-23T00:01:00.000Z",
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
