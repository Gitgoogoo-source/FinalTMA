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

test("查看藏品详情和成长入口", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await page.getByRole("button", { name: "详情" }).click();

  const detailDialog = page.getByRole("dialog", { name: "森林幼芽" });
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByText("是否可升级")).toBeVisible();
  await expect(
    detailDialog.getByRole("button", { name: /升级/ }),
  ).toBeVisible();
  await expect(
    detailDialog.getByRole("button", { name: /合成/ }),
  ).toBeVisible();
  await expect(detailDialog.getByRole("link", { name: /出售/ })).toBeVisible();
  await expect(
    detailDialog.getByRole("button", { name: /分解/ }),
  ).toBeVisible();
});
