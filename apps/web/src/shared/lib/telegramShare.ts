import { getTelegramWebApp } from "@/types/telegram";

type OpenTelegramShareInput = {
  url: string;
  text: string;
};

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
