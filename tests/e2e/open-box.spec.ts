import { expect, test } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

test("开盒后展示服务端返回的结果", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(`/box?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);
  await page.getByRole("button", { name: /开 1 次/ }).click();

  const resultDialog = page.getByRole("dialog", { name: "测试盲盒" });
  await expect(resultDialog).toBeVisible();
  await expect(resultDialog.getByText("森林幼芽")).toBeVisible();
  await expect(resultDialog.getByText("返还 100 K-coin")).toBeVisible();
  await expect(resultDialog.getByText("当前 1,300 K-coin")).toBeVisible();
});
