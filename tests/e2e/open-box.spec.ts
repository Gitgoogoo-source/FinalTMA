import { expect, type Page, test } from "@playwright/test";

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
  await installTelegramInvoiceMock(page, "cancelled");
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

test("Stars 支付 paid 回调但 webhook 延迟时继续等待服务端确认", async ({
  page,
}) => {
  await mockFirstPhaseApi(page, {
    boxPaymentFlow: "stars_pending",
    boxPaymentStatus: "invoice_created",
  });

  await page.goto(`/box?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);
  await installTelegramInvoiceMock(page, "paid");
  await page.getByRole("button", { name: /开 1 次/ }).click();

  await expect
    .poll(() => readOpenedInvoiceUrl(page))
    .toBe("https://t.me/invoice/e2e-open-order");
  await expect(page.getByText("支付已返回，等待服务端确认")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "等待 Stars 支付" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "测试盲盒" }),
  ).not.toBeVisible();
});

test("Stars 支付成功后展示服务端发货结果", async ({ page }) => {
  await mockFirstPhaseApi(page, {
    boxPaymentFlow: "stars_pending",
    boxPaymentStatus: "fulfilled",
  });

  await page.goto(`/box?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);
  await installTelegramInvoiceMock(page, "paid");
  await page.getByRole("button", { name: /开 1 次/ }).click();

  await expect
    .poll(() => readOpenedInvoiceUrl(page))
    .toBe("https://t.me/invoice/e2e-open-order");

  const resultDialog = page.getByRole("dialog", { name: "测试盲盒" });
  await expect(resultDialog).toBeVisible();
  await expect(resultDialog.getByText("森林幼芽")).toBeVisible();
  await expect(resultDialog.getByText("返还 100 K-coin")).toBeVisible();
  await expect(resultDialog.getByText("当前 1,300 K-coin")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "等待 Stars 支付" }),
  ).not.toBeVisible();
});

test("Stars 支付已成功但发货处理中时展示发货状态且不能重试支付", async ({
  page,
}) => {
  await mockFirstPhaseApi(page, {
    boxPaymentFlow: "stars_pending",
    boxPaymentStatus: "fulfilling",
  });

  await page.goto(`/box?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);
  await installTelegramInvoiceMock(page, "paid");
  await page.getByRole("button", { name: /开 1 次/ }).click();

  await expect(page.getByRole("dialog", { name: "发货处理中" })).toBeVisible();
  await expect(
    page.getByText("服务端正在生成抽卡结果、库存和账本记录。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重试支付" }),
  ).not.toBeVisible();
});

test("十连支付金额展示与后端创建订单返回一致", async ({ page }) => {
  await mockFirstPhaseApi(page, {
    boxPaymentFlow: "stars_pending",
  });

  await page.goto(`/box?mockInitData=${encodeURIComponent(TEST_INIT_DATA)}`);
  await installTelegramInvoiceMock(page, "pending");
  await page.getByRole("button", { name: "开 10 次，90 Stars，9 折" }).click();

  await expect
    .poll(() => readOpenedInvoiceUrl(page))
    .toBe("https://t.me/invoice/e2e-open-order");
  await expect(page.getByText("90 Stars · 10 次")).toBeVisible();
});

async function installTelegramInvoiceMock(
  page: Page,
  status: "paid" | "cancelled" | "failed" | "pending",
): Promise<void> {
  await page.evaluate((invoiceStatus) => {
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
        callback?.(invoiceStatus);
      },
    };
  }, status);
}

async function readOpenedInvoiceUrl(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (window as Window & { __openedInvoiceUrl?: string }).__openedInvoiceUrl,
  );
}
