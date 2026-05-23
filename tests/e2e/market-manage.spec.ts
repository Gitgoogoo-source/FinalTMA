import { expect, test, type Route } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

const ACTIVE_LISTING_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const CANCELLED_LISTING_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaab";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "cccccccc-3333-4333-8333-cccccccccccc";
const FORM_ID = "dddddddd-4444-4444-8444-dddddddddddd";

test("出售管理页展示我的挂单并按筛选查询", async ({ page }) => {
  const myListingsRequests: URL[] = [];

  await mockFirstPhaseApi(page);
  await mockMarketManageApi(page, myListingsRequests);

  await page.goto(
    `/trade?tab=manage&mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await expect(page.getByTestId("trade-manage-panel")).toBeVisible();
  await expect(page.getByTestId("my-listing-row")).toHaveCount(2);
  await expect(page.getByText("月冕守门人", { exact: true })).toBeVisible();
  await expect(page.getByText("旧挂单", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "改价 月冕守门人" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "下架 月冕守门人" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "改价 旧挂单" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "下架 旧挂单" }),
  ).toBeDisabled();

  const filters = page.locator(".my-listing-filters");
  await filters.getByLabel("最低价").fill("300");
  await filters.getByLabel("稀有度").selectOption("epic");
  await filters.getByLabel("类型").selectOption("character");
  await filters.getByLabel("排序").selectOption("price_high_to_low");

  await expect
    .poll(() => myListingsRequests.at(-1)?.searchParams.get("sort"))
    .toBe("price_high_to_low");

  const lastRequest = myListingsRequests.at(-1);
  expect(lastRequest?.searchParams.get("min_price")).toBe("300");
  expect(lastRequest?.searchParams.get("rarities")).toBe("epic");
  expect(lastRequest?.searchParams.get("type_codes")).toBe("character");
  expect(lastRequest?.searchParams.get("limit")).toBe("50");
});

async function mockMarketManageApi(
  page: Parameters<typeof mockFirstPhaseApi>[0],
  myListingsRequests: URL[],
): Promise<void> {
  await page.route("**/api/market/my-listing-stats", (route) =>
    fulfillOk(route, {
      active_count: 1,
      active_listing_count: 1,
      active_item_count: 2,
      total_listing_value_kcoin: 600,
      expected_net_amount_kcoin: 570,
      sold_24h_count: 1,
      sold_24h_value_kcoin: 300,
    }),
  );

  await page.route("**/api/market/my-listings?*", (route) => {
    myListingsRequests.push(new URL(route.request().url()));

    return fulfillOk(route, {
      items: [myActiveListingPayload(), myCancelledListingPayload()],
      next_cursor: null,
    });
  });
}

function myActiveListingPayload() {
  return {
    listing_id: ACTIVE_LISTING_ID,
    seller_user_id: USER_ID,
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
    item_count: 2,
    remaining_count: 2,
    expected_net_amount: 570,
    status: "active",
    seller_display_name: "测试玩家",
    price_health: "healthy",
    is_own_listing: true,
    is_buyable: false,
    not_buyable_reason: "own_listing",
    last_price_changed_at: "2026-05-23T00:20:00.000Z",
    created_at: "2026-05-23T00:00:00.000Z",
    expires_at: null,
  };
}

function myCancelledListingPayload() {
  return {
    ...myActiveListingPayload(),
    listing_id: CANCELLED_LISTING_ID,
    name: "旧挂单",
    remaining_count: 0,
    expected_net_amount: null,
    status: "cancelled",
    created_at: "2026-05-22T00:00:00.000Z",
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
