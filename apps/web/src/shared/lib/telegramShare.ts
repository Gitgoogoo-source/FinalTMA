import { getTelegramWebApp, getTelegramWebView } from "@/types/telegram";

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
  const shareUrl = createTelegramShareUrl({ text, url });
  const webApp = getTelegramWebApp();

  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(shareUrl);
    return {
      method: "share_url",
      sent: null,
    };
  }

  const webView = getTelegramWebView();

  if (webView?.postEvent) {
    webView.postEvent("web_app_open_tg_link", false, {
      path_full: createTelegramSharePath(shareUrl),
    });
    return {
      method: "share_url",
      sent: null,
    };
  }

  throw new Error("当前 Telegram 客户端不支持原生分享弹窗。");
}

function createTelegramShareUrl({ text, url }: OpenTelegramShareInput): string {
  return `https://t.me/share/url?url=${encodeURIComponent(
    url,
  )}&text=${encodeURIComponent(text)}`;
}

function createTelegramSharePath(shareUrl: string): string {
  const parsed = new URL(shareUrl);
  return `${parsed.pathname}${parsed.search}`;
}
