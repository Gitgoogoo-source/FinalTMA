import { expect, test } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

test("查看库存中的开盒藏品", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await expect(page.getByTestId("collection-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "森林幼芽" })).toBeVisible();
  await expect(page.getByText("我的藏品")).toBeVisible();
  await expect(page.getByText("Lv.1", { exact: true }).first()).toBeVisible();
});
