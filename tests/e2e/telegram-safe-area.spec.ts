import { expect, test, type Page } from "@playwright/test";

import { TEST_INIT_DATA, mockFirstPhaseApi } from "./_firstPhaseApi";

const MOBILE_TELEGRAM_CONTENT_SAFE_AREA_TOP = 68;
const APP_SHELL_TOP_GAP = 12;

test("keeps the top asset bar below mobile Telegram overlay controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMobileTelegramShell(page, {
    contentSafeAreaTop: MOBILE_TELEGRAM_CONTENT_SAFE_AREA_TOP,
  });
  await mockFirstPhaseApi(page);

  await page.goto("/box");

  const assetBar = page.locator(".asset-bar");

  await expect(assetBar).toBeVisible();
  await expect(
    readCssVariable(page, "--tg-content-safe-area-inset-top"),
  ).resolves.toBe(`${MOBILE_TELEGRAM_CONTENT_SAFE_AREA_TOP}px`);

  const box = await assetBar.boundingBox();

  if (!box) {
    throw new Error("Expected the asset bar to have a browser layout box.");
  }

  expect(Math.round(box.y)).toBeGreaterThanOrEqual(
    MOBILE_TELEGRAM_CONTENT_SAFE_AREA_TOP + APP_SHELL_TOP_GAP,
  );
});

async function installMobileTelegramShell(
  page: Page,
  options: { contentSafeAreaTop: number },
): Promise<void> {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.Telegram = window.Telegram || {};",
    }),
  );

  await page.addInitScript(
    ({ contentSafeAreaTop, initData }) => {
      type TestTelegramWindow = Window & {
        Telegram?: {
          WebApp?: Record<string, unknown>;
        };
      };

      const noop = () => undefined;
      const target = window as TestTelegramWindow;

      target.Telegram = {
        WebApp: {
          colorScheme: "light",
          contentSafeAreaInset: {
            top: contentSafeAreaTop,
            right: 0,
            bottom: 0,
            left: 0,
          },
          disableVerticalSwipes: noop,
          expand: noop,
          initData,
          initDataUnsafe: {
            query_id: "e2e-query",
            user: {
              id: 7001,
              first_name: "测试",
            },
          },
          isExpanded: false,
          isFullscreen: false,
          isVersionAtLeast: () => true,
          offEvent: noop,
          onEvent: noop,
          platform: "ios",
          ready: noop,
          requestFullscreen: noop,
          safeAreaInset: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          },
          setBackgroundColor: noop,
          setBottomBarColor: noop,
          setHeaderColor: noop,
          themeParams: {},
          version: "8.0",
          viewportHeight: 844,
          viewportStableHeight: 844,
        },
      };
    },
    {
      contentSafeAreaTop: options.contentSafeAreaTop,
      initData: TEST_INIT_DATA,
    },
  );
}

async function readCssVariable(
  page: Page,
  propertyName: string,
): Promise<string> {
  return page.evaluate(
    (name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    propertyName,
  );
}
