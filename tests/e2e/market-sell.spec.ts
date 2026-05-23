import { expect, test, type Route } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

const TEMPLATE_ID = "cccccccc-3333-4333-8333-cccccccccccc";
const FORM_ID = "dddddddd-4444-4444-8444-dddddddddddd";
const FIRST_ITEM_ID = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
const SECOND_ITEM_ID = "eeeeeeee-5555-4555-8555-eeeeeeeeeeef";
const LISTING_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

test("出售页可设置价格、预览手续费并确认上架", async ({ page }) => {
  const createRequests: unknown[] = [];
  const idempotencyHeaders: Array<string | undefined> = [];
  let listingCreated = false;

  await mockFirstPhaseApi(page);
  await mockMarketSellApi(
    page,
    createRequests,
    idempotencyHeaders,
    () => listingCreated,
    () => {
      listingCreated = true;
    },
  );

  await page.goto(
    `/trade?tab=sell&mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await expect(page.getByTestId("trade-sell-panel")).toBeVisible();
  await page.locator(".sell-item-card__button").click();

  await expect(page.getByText("当前选择", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "增加出售数量" }).click();
  await page.getByLabel("出售单价").fill("300");

  await expect(page.getByText("总价", { exact: true })).toBeVisible();
  await expect(page.getByText("600 K-coin", { exact: true })).toBeVisible();
  await expect(page.getByText("30 K-coin", { exact: true })).toBeVisible();
  await expect(page.getByText("570 K-coin", { exact: true })).toBeVisible();
  await expect(page.getByText("250 K-coin - 500 K-coin")).toBeVisible();

  await page.getByRole("button", { name: "确认出售", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "星辉守门人" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("预计到手", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "确认出售", exact: true }).click();

  await expect(page.getByText("上架成功", { exact: true })).toBeVisible();
  await expect(
    page.getByText("选择要出售的藏品", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("星辉守门人", { exact: true })).toHaveCount(0);

  expect(listingCreated).toBe(true);
  expect(createRequests).toHaveLength(1);
  expect(createRequests[0]).toMatchObject({
    item_instance_ids: [FIRST_ITEM_ID, SECOND_ITEM_ID],
    unit_price_kcoin: 300,
  });
  expect(
    (createRequests[0] as { idempotency_key?: string }).idempotency_key,
  ).toEqual(idempotencyHeaders[0]);
});

async function mockMarketSellApi(
  page: Parameters<typeof mockFirstPhaseApi>[0],
  createRequests: unknown[],
  idempotencyHeaders: Array<string | undefined>,
  isCreated: () => boolean,
  onCreate: () => void,
): Promise<void> {
  await page.route("**/api/market/sellable-items?*", (route) =>
    fulfillOk(route, {
      items: isCreated() ? [] : [sellableItemPayload()],
      next_cursor: null,
    }),
  );

  await page.route("**/api/market/sell-rules", (route) =>
    fulfillOk(route, {
      fee_type: "market_sell",
      currency_code: "KCOIN",
      fee_bps: 500,
      source: "active_rule",
    }),
  );

  await page.route("**/api/market/create-listing", async (route) => {
    createRequests.push(route.request().postDataJSON());
    idempotencyHeaders.push(route.request().headers()["x-idempotency-key"]);
    onCreate();

    await fulfillOk(route, {
      listing_id: LISTING_ID,
      item_count: 2,
      remaining_count: 2,
      unit_price_kcoin: 300,
      fee_bps: 500,
      expected_net_amount: 570,
      status: "active",
      price_health: "healthy",
      idempotent: false,
    });
  });
}

function sellableItemPayload() {
  return {
    item_instance_id: FIRST_ITEM_ID,
    item_instance_ids: [FIRST_ITEM_ID, SECOND_ITEM_ID],
    template_id: TEMPLATE_ID,
    form_id: FORM_ID,
    name: "星辉守门人",
    rarity: "epic",
    rarity_label: "史诗",
    type_code: "character",
    image_url: null,
    serial_no: 21,
    level: 3,
    power: 88,
    owned_count: 2,
    available_count: 2,
    suggested_price_kcoin: 360,
    min_price_kcoin: 250,
    max_price_kcoin: 500,
    acquired_at: "2026-05-23T00:00:00.000Z",
    is_tradeable: true,
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
