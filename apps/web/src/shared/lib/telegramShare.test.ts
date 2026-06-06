import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  TelegramGlobal,
  TelegramWebApp,
  TelegramWebView,
} from "@/types/telegram";

import { openTelegramShareLink } from "./telegramShare";

const INVITE_URL = "https://t.me/test_bot/app?startapp=ref_TEST";
const SHARE_TEXT = "来开盒，完成首抽我们都拿奖励。";

describe("telegramShare", () => {
  afterEach(() => {
    delete (globalThis as TelegramGlobal).Telegram;
    vi.unstubAllGlobals();
  });

  it("uses WebApp.openTelegramLink for the native Telegram share dialog", () => {
    const openTelegramLink = vi.fn();
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openTelegramLink,
      } as TelegramWebApp,
    };

    const result = openTelegramShareLink({
      text: SHARE_TEXT,
      url: INVITE_URL,
    });

    expect(result).toEqual({
      method: "share_url",
      sent: null,
    });
    expect(openTelegramLink).toHaveBeenCalledOnce();
    expectTelegramShareLink(openTelegramLink.mock.calls[0]?.[0]);
  });

  it("falls back to Telegram WebView postEvent without navigating to a web page", () => {
    const postEvent = vi.fn();
    (globalThis as TelegramGlobal).Telegram = {
      WebView: {
        postEvent,
      } as TelegramWebView,
    };

    openTelegramShareLink({
      text: SHARE_TEXT,
      url: INVITE_URL,
    });

    expect(postEvent).toHaveBeenCalledWith("web_app_open_tg_link", false, {
      path_full: expect.any(String),
    });
    expectTelegramSharePath(postEvent.mock.calls[0]?.[2]?.path_full);
  });

  it("does not open the share URL as a normal web page when native sharing is unavailable", () => {
    const openLink = vi.fn();
    const browserOpen = vi.fn();
    vi.stubGlobal("open", browserOpen);
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openLink,
      } as TelegramWebApp,
    };

    expect(() =>
      openTelegramShareLink({
        text: SHARE_TEXT,
        url: INVITE_URL,
      }),
    ).toThrow("当前 Telegram 客户端不支持原生分享弹窗。");

    expect(openLink).not.toHaveBeenCalled();
    expect(browserOpen).not.toHaveBeenCalled();
  });
});

function expectTelegramShareLink(value: unknown): void {
  expect(typeof value).toBe("string");

  const parsed = new URL(String(value));
  expect(`${parsed.origin}${parsed.pathname}`).toBe("https://t.me/share/url");
  expect(parsed.searchParams.get("url")).toBe(INVITE_URL);
  expect(parsed.searchParams.get("text")).toBe(SHARE_TEXT);
}

function expectTelegramSharePath(value: unknown): void {
  expect(typeof value).toBe("string");
  expectTelegramShareLink(`https://t.me${String(value)}`);
}
