import { expect, test } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

const placeholderRoutes = [
  {
    path: "/game",
    testId: "game-page",
    title: "游戏功能后续开放",
  },
  {
    path: "/tasks",
    testId: "tasks-page",
    title: "任务功能后续开放",
  },
] as const;

test("根路径进入第一阶段默认开盒页", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(`/?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);

  await expect(page).toHaveURL(/\/box\?mockInitData=/);
  await expect(page.getByTestId("box-page")).toBeVisible();
});

test("/trade 默认进入购买 Tab，并可用 query 参数切换", async ({ page }) => {
  await mockFirstPhaseApi(page);

  await page.goto(`/trade?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);

  await expect(page.getByTestId("trade-page")).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "购买", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("trade-buy-panel")).toBeVisible();
  await expect(page.getByText("交易功能后续开放", { exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "出售", exact: true }).click();

  await expect(page).toHaveURL(/tab=sell/);
  await expect(page.getByTestId("trade-sell-panel")).toBeVisible();

  await page.getByRole("tab", { name: "报价 / 管理", exact: true }).click();

  await expect(page).toHaveURL(/tab=manage/);
  await expect(page.getByTestId("trade-manage-panel")).toBeVisible();
});

for (const route of placeholderRoutes) {
  test(`${route.path} 显示第一阶段占位页`, async ({ page }) => {
    await mockFirstPhaseApi(page);

    await page.goto(
      `${route.path}?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
    );

    await expect(page.getByTestId(route.testId)).toBeVisible();
    await expect(page.getByText(route.title, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "返回开盒", exact: true }),
    ).toBeVisible();
  });
}
