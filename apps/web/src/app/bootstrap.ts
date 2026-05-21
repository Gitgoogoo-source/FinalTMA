import { getTelegramWebApp } from "@/types/telegram";

export function bootstrapTelegramApp(): void {
  const telegramWebApp = getTelegramWebApp();

  telegramWebApp?.ready?.();
  telegramWebApp?.expand?.();
}
