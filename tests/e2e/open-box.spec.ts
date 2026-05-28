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

test("Stars 支付取消后不展示结果并可刷新恢复订单", async ({ page }) => {
  await mockFirstPhaseApi(page, {
    boxPaymentFlow: "stars_pending",
  });

  await page.goto(`/box?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);
  await page.evaluate(() => {
    type TestWindow = Window & {
      Telegram?: {
        WebApp?: {
          version?: string;
          openInvoice?: (
            url: string,
            callback?: (status: string) => void,
          ) => void;
        };
      };
      __openedInvoiceUrl?: string;
    };

    const target = window as TestWindow;
    target.Telegram ??= {};
    target.Telegram.WebApp = {
      ...target.Telegram.WebApp,
      version: "8.0",
      openInvoice: (url, callback) => {
        target.__openedInvoiceUrl = url;
        callback?.("cancelled");
      },
    };
  });
  await page.getByRole("button", { name: /开 1 次/ }).click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __openedInvoiceUrl?: string })
            .__openedInvoiceUrl,
      ),
    )
    .toBe("https://t.me/invoice/e2e-open-order");
  await expect(page.getByText("支付已取消，可重试支付")).toBeVisible();
  await expect(page.getByRole("button", { name: "重试支付" })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "测试盲盒" }),
  ).not.toBeVisible();

  await page.reload();

  await expect(
    page.getByText("已恢复上次未完成订单，正在向服务端确认支付状态。"),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "等待 Stars 支付" }),
  ).toBeVisible();
});
