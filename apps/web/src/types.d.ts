interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    start_param?: string;
    user?: { first_name?: string; username?: string };
  };
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  safeAreaInset?: { top: number; right: number; bottom: number; left: number };
  contentSafeAreaInset?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  viewportStableHeight?: number;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
  ready(): void;
  expand(): void;
  close(): void;
  openInvoice(
    url: string,
    callback?: (status: "paid" | "cancelled" | "failed" | "pending") => void,
  ): void;
  openTelegramLink(url: string): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  onEvent(event: string, callback: () => void): void;
  offEvent(event: string, callback: () => void): void;
}

interface Window {
  Telegram?: { WebApp?: TelegramWebApp };
}
