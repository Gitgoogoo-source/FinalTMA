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

test("升级面板完成升级并刷新藏品展示", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await page.getByRole("button", { name: "详情" }).click();
  await page.getByRole("button", { name: /升级/ }).click();

  const upgradeDialog = page.getByRole("dialog", { name: "森林幼芽" });
  await expect(upgradeDialog).toBeVisible();
  await expect(upgradeDialog.getByText("当前等级")).toBeVisible();
  await expect(upgradeDialog.getByText("升级后等级")).toBeVisible();
  await expect(upgradeDialog.getByText("需要 Fgems")).toBeVisible();
  await expect(upgradeDialog.getByText("余额足够")).toBeVisible();

  await upgradeDialog.getByRole("button", { name: "确认升级" }).click();

  const resultDialog = page.getByRole("dialog", { name: "升级成功" });
  await expect(resultDialog).toBeVisible();
  await expect(resultDialog.getByText("Lv.1 -> Lv.2")).toBeVisible();
  await expect(resultDialog.getByText("80 -> 60")).toBeVisible();

  await resultDialog.getByRole("button", { name: "确认" }).click();
  await expect(page.getByText("Lv.2", { exact: true }).first()).toBeVisible();
});

test("合成面板选择材料并展示成功结果", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await page.getByRole("button", { name: "详情" }).click();
  await page.getByRole("button", { name: /合成/ }).click();

  const evolveDialog = page.getByRole("dialog", { name: "森林幼芽" });
  await expect(evolveDialog).toBeVisible();
  await expect(evolveDialog.getByText("同款 available 数量")).toBeVisible();
  await expect(evolveDialog.getByText("已选择材料")).toBeVisible();
  await expect(evolveDialog.getByText("目标形态")).toBeVisible();
  await expect(evolveDialog.getByText("KCOIN 消耗")).toBeVisible();
  await expect(evolveDialog.getByText("成功率")).toBeVisible();
  await expect(evolveDialog.getByText("主藏品", { exact: true })).toBeVisible();

  await evolveDialog.getByRole("button", { name: "确认合成" }).click();

  const resultDialog = page.getByRole("dialog", { name: "合成成功" });
  await expect(resultDialog).toBeVisible();
  await expect(resultDialog.getByText("消耗 KCOIN")).toBeVisible();
  await expect(resultDialog.getByText("1,200 -> 1,000")).toBeVisible();

  await resultDialog.getByRole("button", { name: "确认" }).click();
  await expect(
    page.getByRole("heading", { name: "森林幼芽·进化" }),
  ).toBeVisible();
});

test("分解面板二次确认后展示获得 Fgems", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await page.getByRole("button", { name: "详情" }).click();
  await page.getByRole("button", { name: /分解/ }).click();

  const decomposeDialog = page.getByRole("dialog", { name: "森林幼芽" });
  await expect(decomposeDialog).toBeVisible();
  await expect(decomposeDialog.getByText("同款数量")).toBeVisible();
  await expect(decomposeDialog.getByText("可分解数量")).toBeVisible();
  await expect(decomposeDialog.getByText("预计获得 Fgems")).toBeVisible();
  await expect(
    decomposeDialog.getByText("分解后不可恢复", { exact: true }),
  ).toBeVisible();
  await expect(
    decomposeDialog.getByRole("button", { name: "确认分解", exact: true }),
  ).toBeDisabled();

  await decomposeDialog
    .getByRole("button", { name: "我确认分解后不可恢复" })
    .click();
  await decomposeDialog
    .getByRole("button", { name: "确认分解", exact: true })
    .click();

  const resultDialog = page.getByRole("dialog", { name: "分解成功" });
  await expect(resultDialog).toBeVisible();
  await expect(resultDialog.getByText("获得 Fgems")).toBeVisible();
  await expect(resultDialog.getByText("80 -> 230")).toBeVisible();
});
