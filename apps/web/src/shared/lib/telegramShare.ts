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
      method: "link";
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
    openTelegramShareLink({ text, url });
    return {
      method: "link",
      sent: null,
    };
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
}: OpenTelegramShareInput): void {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(
    url,
  )}&text=${encodeURIComponent(text)}`;
  const webApp = getTelegramWebApp();

  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(shareUrl);
    return;
  }

  if (webApp?.openLink) {
    webApp.openLink(shareUrl);
    return;
  }

  globalThis.open(shareUrl, "_blank", "noopener,noreferrer");
}
