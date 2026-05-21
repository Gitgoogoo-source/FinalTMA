type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
};

type TelegramGlobal = typeof globalThis & {
  Telegram?: {
    WebApp?: TelegramWebApp;
  };
};

export function bootstrapTelegramApp(): void {
  const telegramWebApp = (globalThis as TelegramGlobal).Telegram?.WebApp;

  telegramWebApp?.ready?.();
  telegramWebApp?.expand?.();
}
