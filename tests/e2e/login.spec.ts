import { expect, test } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

test("登录后进入开盒首页", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(`/box?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);

  await expect(page.getByTestId("box-page")).toBeVisible();
  await expect(page.getByText("测试玩家")).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试盲盒" })).toBeVisible();
});
