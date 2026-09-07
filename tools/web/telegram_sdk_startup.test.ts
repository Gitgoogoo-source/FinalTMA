import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { afterEach, beforeEach, mock, test } from "node:test";

import {
  TELEGRAM_SDK_TIMEOUT_MS,
  waitForTelegramSdk,
} from "../../apps/web/src/platform/telegram/sdk-ready.ts";

let script: EventTarget | null;
const browser: { Telegram?: { WebApp: object } } = {};
const webApp = { initData: "" };

beforeEach(() => {
  script = new EventTarget();
  delete browser.Telegram;
  Object.defineProperty(globalThis, "window", {
    value: browser,
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: { getElementById: () => script },
    configurable: true,
  });
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
});

test("an SDK that finished before the app module can start immediately", async () => {
  browser.Telegram = { WebApp: webApp };
  assert.equal(await waitForTelegramSdk(), webApp);
});

test("delayed SDK blocks continuation until load and then cleans up listeners", async () => {
  let continued = false;
  const task = waitForTelegramSdk().then((app) => {
    continued = true;
    return app;
  });
  mock.timers.tick(TELEGRAM_SDK_TIMEOUT_MS - 1);
  await Promise.resolve();
  assert.equal(continued, false);
  browser.Telegram = { WebApp: webApp };
  script!.dispatchEvent(new Event("load"));
  assert.equal(await task, webApp);
  assert.equal(getEventListeners(script!, "load").length, 0);
  assert.equal(getEventListeners(script!, "error").length, 0);
  mock.timers.tick(TELEGRAM_SDK_TIMEOUT_MS);
});

test("a hanging request times out and a late SDK cannot start authentication", async () => {
  let continued = false;
  const task = waitForTelegramSdk().then(() => {
    continued = true;
  });
  const rejected = assert.rejects(task, /TELEGRAM_SDK_TIMEOUT/);
  mock.timers.tick(TELEGRAM_SDK_TIMEOUT_MS);
  await rejected;
  browser.Telegram = { WebApp: webApp };
  script!.dispatchEvent(new Event("load"));
  await Promise.resolve();
  assert.equal(continued, false);
  assert.equal(getEventListeners(script!, "load").length, 0);
});

test("SRI, CORS and network errors fail closed without waiting for timeout", async () => {
  const rejected = assert.rejects(
    waitForTelegramSdk(),
    /TELEGRAM_SDK_LOAD_FAILED/,
  );
  script!.dispatchEvent(new Event("error"));
  await rejected;
  assert.equal(getEventListeners(script!, "error").length, 0);
});

test("load without WebApp and a missing script are not treated as success", async () => {
  const rejected = assert.rejects(
    waitForTelegramSdk(),
    /TELEGRAM_SDK_UNAVAILABLE/,
  );
  script!.dispatchEvent(new Event("load"));
  await rejected;
  script = null;
  await assert.rejects(waitForTelegramSdk(), /TELEGRAM_SDK_MISSING/);
});

test("an error before the observer attaches still ends in a bounded failure", async () => {
  script!.dispatchEvent(new Event("error"));
  const rejected = assert.rejects(waitForTelegramSdk(), /TELEGRAM_SDK_TIMEOUT/);
  mock.timers.tick(TELEGRAM_SDK_TIMEOUT_MS);
  await rejected;
});

test("cancelling an observer cleans up and cannot continue later", async () => {
  const controller = new AbortController();
  const rejected = assert.rejects(
    waitForTelegramSdk(controller.signal),
    /TELEGRAM_SDK_ABORTED/,
  );
  controller.abort();
  await rejected;
  assert.equal(getEventListeners(script!, "load").length, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await assert.rejects(
    waitForTelegramSdk(controller.signal),
    /TELEGRAM_SDK_ABORTED/,
  );
});
