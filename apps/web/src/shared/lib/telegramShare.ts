import {
  openTelegramLink as sdkOpenTelegramLink,
  shareURL as sdkShareURL,
} from "@tma.js/sdk-react";

import { getTelegramWebApp } from "@/types/telegram";

type OpenTelegramShareInput = {
  url: string;
  text: string;
};

type OpenTelegramPreparedShareInput = OpenTelegramShareInput & {
  preparedMessageId: string;
};

export type TelegramShareResult =
  | {
      method: "prepared";
      sent: true;
    }
  | {
      method: "prepared";
      sent: false;
    }
  | {
      method: "share_url";
      sent: null;
    };

export function canUseTelegramPreparedShare(): boolean {
  const webApp = getTelegramWebApp();
  return typeof webApp?.shareMessage === "function";
}

export async function openTelegramPreparedShare({
  preparedMessageId,
  text,
  url,
}: OpenTelegramPreparedShareInput): Promise<TelegramShareResult> {
  const webApp = getTelegramWebApp();

  if (typeof webApp?.shareMessage !== "function") {
    return openTelegramShareLink({ text, url });
  }

  const sent = await new Promise<boolean>((resolve) => {
    webApp.shareMessage?.(preparedMessageId, (result) => {
      resolve(Boolean(result));
    });
  });

  return {
    method: "prepared",
    sent,
  };
}

export function openTelegramShareLink({
  text,
  url,
}: OpenTelegramShareInput): TelegramShareResult {
  if (openWithSdkShareURL({ text, url })) {
    return {
      method: "share_url",
      sent: null,
    };
  }

  const shareUrl = createTelegramShareUrl({ text, url });

  if (openWithSdkTelegramLink(shareUrl)) {
    return {
      method: "share_url",
      sent: null,
    };
  }

  const webApp = getTelegramWebApp();

  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(shareUrl);
    return {
      method: "share_url",
      sent: null,
    };
  }

  if (webApp?.openLink) {
    webApp.openLink(shareUrl);
    return {
      method: "share_url",
      sent: null,
    };
  }

  globalThis.open(shareUrl, "_blank", "noopener,noreferrer");
  return {
    method: "share_url",
    sent: null,
  };
}

function openWithSdkShareURL(input: OpenTelegramShareInput): boolean {
  try {
    return sdkShareURL.ifAvailable(input.url, input.text).ok;
  } catch {
    return false;
  }
}

function openWithSdkTelegramLink(url: string): boolean {
  try {
    return sdkOpenTelegramLink.ifAvailable(url).ok;
  } catch {
    return false;
  }
}

function createTelegramShareUrl({ text, url }: OpenTelegramShareInput): string {
  return `https://t.me/share/url?url=${encodeURIComponent(
    url,
  )}&text=${encodeURIComponent(text)}`;
}
