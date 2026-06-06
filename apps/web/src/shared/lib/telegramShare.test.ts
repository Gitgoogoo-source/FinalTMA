import { afterEach, describe, expect, it, vi } from "vitest";

import type { TelegramGlobal, TelegramWebApp } from "@/types/telegram";

const sdkMocks = vi.hoisted(() => ({
  openTelegramLink: {
    ifAvailable: vi.fn(),
  },
  shareURL: {
    ifAvailable: vi.fn(),
  },
}));

vi.mock("@tma.js/sdk-react", () => ({
  openTelegramLink: sdkMocks.openTelegramLink,
  shareURL: sdkMocks.shareURL,
}));

import { openTelegramShareLink } from "./telegramShare";

const INVITE_URL = "https://t.me/test_bot/app?startapp=ref_TEST";
const SHARE_TEXT = "来开盒，完成首抽我们都拿奖励。";

describe("telegramShare", () => {
  afterEach(() => {
    delete (globalThis as TelegramGlobal).Telegram;
    vi.unstubAllGlobals();
  });

  it("uses SDK shareURL first", () => {
    sdkMocks.shareURL.ifAvailable.mockReturnValue({
      ok: true,
      data: undefined,
    });

    const result = openTelegramShareLink({
      text: SHARE_TEXT,
      url: INVITE_URL,
    });

    expect(result).toEqual({
      method: "share_url",
      sent: null,
    });
    expect(sdkMocks.shareURL.ifAvailable).toHaveBeenCalledWith(
      INVITE_URL,
      SHARE_TEXT,
    );
    expect(sdkMocks.openTelegramLink.ifAvailable).not.toHaveBeenCalled();
  });

  it("falls back to SDK openTelegramLink with a Telegram share link", () => {
    sdkMocks.shareURL.ifAvailable.mockReturnValue({
      ok: false,
    });
    sdkMocks.openTelegramLink.ifAvailable.mockReturnValue({
      ok: true,
      data: undefined,
    });

    openTelegramShareLink({
      text: SHARE_TEXT,
      url: INVITE_URL,
    });

    expect(sdkMocks.openTelegramLink.ifAvailable).toHaveBeenCalledOnce();
    expectTelegramShareLink(
      sdkMocks.openTelegramLink.ifAvailable.mock.calls[0]?.[0],
    );
  });

  it("keeps the WebApp openTelegramLink fallback for test shells and old clients", () => {
    const openTelegramLink = vi.fn();
    sdkMocks.shareURL.ifAvailable.mockReturnValue({
      ok: false,
    });
    sdkMocks.openTelegramLink.ifAvailable.mockReturnValue({
      ok: false,
    });
    (globalThis as TelegramGlobal).Telegram = {
      WebApp: {
        openTelegramLink,
      } as TelegramWebApp,
    };

    openTelegramShareLink({
      text: SHARE_TEXT,
      url: INVITE_URL,
    });

    expect(openTelegramLink).toHaveBeenCalledOnce();
    expectTelegramShareLink(openTelegramLink.mock.calls[0]?.[0]);
  });
});

function expectTelegramShareLink(value: unknown): void {
  expect(typeof value).toBe("string");

  const parsed = new URL(String(value));
  expect(`${parsed.origin}${parsed.pathname}`).toBe("https://t.me/share/url");
  expect(parsed.searchParams.get("url")).toBe(INVITE_URL);
  expect(parsed.searchParams.get("text")).toBe(SHARE_TEXT);
}
