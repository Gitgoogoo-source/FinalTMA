import { expect, test } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

test("查看库存中的开盒藏品", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await expect(page.getByTestId("collection-page")).toBeVisible();
  await expect(page.getByLabel("藏品网格")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /森林幼芽，普通/ }),
  ).toBeVisible();
  await expect(page.getByText("Lv.1", { exact: true }).first()).toBeVisible();
});

test("查看藏品详情和成长入口", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  const selectedPanel = page.getByLabel("当前选中藏品");
  await expect(selectedPanel).toBeVisible();
  await expect(selectedPanel.getByLabel("藏品完整信息")).toBeVisible();
  await expect(selectedPanel.getByLabel("藏品关键属性")).toBeVisible();
  await expect(
    selectedPanel.getByRole("button", { name: "升级" }),
  ).toBeVisible();
  await expect(
    selectedPanel.getByRole("button", { name: "进化" }),
  ).toBeVisible();
  await expect(
    selectedPanel.getByRole("button", { name: "出售" }),
  ).toBeVisible();
  await expect(
    selectedPanel.getByRole("button", { name: "分解" }),
  ).toBeVisible();
  await expect(
    selectedPanel.getByRole("button", { name: "Mint NFT" }),
  ).toBeVisible();
});

test("升级面板完成升级并刷新藏品展示", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await expect(page.getByLabel("Fgems 余额").getByText("80")).toBeVisible();

  await page
    .getByLabel("当前选中藏品")
    .getByRole("button", { name: "升级" })
    .click();

  const upgradeDialog = page.getByRole("dialog", { name: "森林幼芽" });
  await expect(upgradeDialog).toBeVisible();
  await expect(upgradeDialog.getByText("当前等级")).toBeVisible();
  await expect(upgradeDialog.getByText("升级后等级")).toBeVisible();
  await expect(upgradeDialog.getByText("当前战力")).toBeVisible();
  await expect(upgradeDialog.getByText("升级后战力")).toBeVisible();
  await expect(upgradeDialog.getByText("需要 Fgems")).toBeVisible();
  await expect(upgradeDialog.getByText("当前 Fgems 余额")).toBeVisible();
  await expect(upgradeDialog.getByText("余额足够")).toBeVisible();

  await upgradeDialog.getByRole("button", { name: "确认升级" }).click();

  const resultDialog = page.getByRole("dialog", { name: "升级成功" });
  await expect(resultDialog).toBeVisible();
  const resultChrome = await resultDialog.evaluate((node) => {
    const panel = node as HTMLElement;
    const root = panel.closest(".growth-result-modal");
    const backdrop = root?.querySelector(".growth-result-modal__backdrop");
    const panelStyle = window.getComputedStyle(panel);
    const backdropStyle = backdrop
      ? window.getComputedStyle(backdrop)
      : null;

    return {
      backdropBackgroundImage: backdropStyle?.backgroundImage ?? "none",
      panelBackgroundImage: panelStyle.backgroundImage,
      panelBoxShadow: panelStyle.boxShadow,
      rootHasGlass: root?.classList.contains("growth-panel--liquid-glass"),
    };
  });
  expect(resultChrome.rootHasGlass).toBe(true);
  expect(resultChrome.backdropBackgroundImage).not.toBe("none");
  expect(resultChrome.panelBackgroundImage).not.toBe("none");
  expect(resultChrome.panelBoxShadow).not.toBe("none");
  await expect(resultDialog.getByText("Lv.1 -> Lv.2")).toBeVisible();
  await expect(resultDialog.getByText("10 -> 18")).toBeVisible();
  await expect(resultDialog.getByText("80 -> 60")).toBeVisible();

  await resultDialog.getByRole("button", { name: "确认" }).click();
  await expect(page.getByText("Lv.2", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Fgems 余额").getByText("60")).toBeVisible();
});

test("进化面板选择材料并展示成功结果", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await page
    .getByLabel("当前选中藏品")
    .getByRole("button", { name: "进化" })
    .click();

  const evolveDialog = page.getByRole("dialog", { name: "森林幼芽" });
  await expect(evolveDialog).toBeVisible();
  await expect(evolveDialog.getByText("同款可用数量")).toBeVisible();
  await expect(evolveDialog.getByText("已选择材料")).toBeVisible();
  await expect(evolveDialog.getByText("目标藏品")).toBeVisible();
  await expect(evolveDialog.getByText("KCOIN 消耗")).toBeVisible();
  await expect(evolveDialog.getByText("成功率")).toBeVisible();
  await expect(evolveDialog.getByText("主藏品", { exact: true })).toBeVisible();

  await evolveDialog.getByRole("button", { name: "确认进化" }).click();

  const resultDialog = page.getByRole("dialog", { name: "进化成功" });
  await expect(resultDialog).toBeVisible();
  await expect(resultDialog.getByText("消耗 KCOIN")).toBeVisible();
  await expect(resultDialog.getByText("1,200 -> 1,000")).toBeVisible();

  await resultDialog.getByRole("button", { name: "确认" }).click();
  await expect(
    page.getByRole("button", { name: /森林游侠/ }),
  ).toBeVisible();
});

test("进化失败后返还主藏品并消耗其他材料", async ({ page }) => {
  await mockFirstPhaseApi(page, { evolveOutcome: "failed" });

  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await expect(page.getByLabel("K-coin 余额").getByText("1,200")).toBeVisible();

  await page
    .getByLabel("当前选中藏品")
    .getByRole("button", { name: "进化" })
    .click();

  const evolveDialog = page.getByRole("dialog", { name: "森林幼芽" });
  await expect(evolveDialog).toBeVisible();
  await expect(evolveDialog.getByText("成功率")).toBeVisible();
  await expect(evolveDialog.getByText("服务端确认").first()).toBeVisible();
  await expect(evolveDialog.getByText("主藏品", { exact: true })).toBeVisible();

  await evolveDialog.getByRole("button", { name: "确认进化" }).click();

  const resultDialog = page.getByRole("dialog", { name: "进化失败" });
  await expect(resultDialog).toBeVisible();
  await expect(
    resultDialog.getByText("进化失败，已返还主藏品。"),
  ).toBeVisible();
  await expect(
    resultDialog.getByText("已返还主藏品", { exact: true }),
  ).toBeVisible();
  await expect(resultDialog.getByText("消耗材料")).toBeVisible();
  await expect(resultDialog.getByText("2 件")).toBeVisible();
  await expect(resultDialog.getByText("1,200 -> 1,000")).toBeVisible();

  await resultDialog.getByRole("button", { name: "确认" }).click();
  await expect(page.getByText("Lv.3", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("K-coin 余额").getByText("1,000")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "森林游侠" }),
  ).toHaveCount(0);
});

test("分解面板二次确认后展示获得 Fgems", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
  );

  await page
    .getByLabel("当前选中藏品")
    .getByRole("button", { name: "分解" })
    .click();

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
