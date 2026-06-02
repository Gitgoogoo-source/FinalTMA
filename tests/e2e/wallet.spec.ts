import { expect, test } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

test("已验证钱包和 Mint 队列状态可在刷新后恢复", async ({ page }) => {
  await mockFirstPhaseApi(page, {
    mintQueueStatus: "queued",
    walletStatus: "verified",
  });

  await gotoCollection(page);

  const walletButton = page.getByRole("button", {
    name: /EQE2\.\.\.0001.*verified/,
  });
  await expect(walletButton).toBeVisible();

  await walletButton.click();

  const walletDialog = page.getByRole("dialog", { name: "钱包状态" });
  await expect(walletDialog).toBeVisible();
  await expect(walletDialog.getByText("钱包验证已通过")).toBeVisible();
  await expect(walletDialog.getByText("Tonkeeper")).toBeVisible();
  await expect(walletDialog.getByText("1 个进行中")).toBeVisible();

  await walletDialog.getByRole("button", { name: "Mint 队列" }).click();

  const queueDialog = page.getByRole("dialog", { name: "Mint 队列" });
  await expect(queueDialog).toBeVisible();
  await expect(queueDialog.getByText("排队中")).toBeVisible();
  await expect(queueDialog.getByText("testnet")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(walletButton).toBeVisible();
  await walletButton.click();
  await expect(
    page.getByRole("dialog", { name: "钱包状态" }).getByText("1 个进行中"),
  ).toBeVisible();
});

test("可 Mint 藏品入队后展示队列并可刷新恢复", async ({ page }) => {
  await mockFirstPhaseApi(page, {
    walletStatus: "verified",
  });

  await gotoCollection(page);

  const mintButton = page
    .getByLabel("当前选中藏品")
    .getByRole("button", { name: "Mint NFT" });

  await expect(mintButton).toBeEnabled();
  await mintButton.click();

  const queueDialog = page.getByRole("dialog", { name: "Mint 队列" });
  await expect(queueDialog).toBeVisible();
  await expect(queueDialog.getByText("排队中")).toBeVisible();
  await expect(queueDialog.getByText("藏品 66666666...6666")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });

  const walletButton = page.getByRole("button", {
    name: /EQE2\.\.\.0001.*verified/,
  });
  await expect(walletButton).toBeVisible();
  await walletButton.click();

  const walletDialog = page.getByRole("dialog", { name: "钱包状态" });
  await expect(walletDialog.getByText("1 个进行中")).toBeVisible();
  await walletDialog.getByRole("button", { name: "Mint 队列" }).click();
  await expect(
    page.getByRole("dialog", { name: "Mint 队列" }).getByText("排队中"),
  ).toBeVisible();
});

async function gotoCollection(page: Parameters<typeof mockFirstPhaseApi>[0]) {
  await page.goto(
    `/collection?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.getByTestId("collection-page")).toBeVisible();
}
