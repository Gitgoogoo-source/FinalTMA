interface TelegramWebApp {
  initData: string;
  platform: string;
  initDataUnsafe: {
    start_param?: string;
    user?: { id?: number; first_name?: string; username?: string };
  };
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  isActive?: boolean;
  isFullscreen?: boolean;
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
    selectionChanged?(): void;
  };
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  requestFullscreen?(): void;
  close(): void;
  openInvoice(
    url: string,
    callback?: (status: "paid" | "cancelled" | "failed" | "pending") => void,
  ): void;
  openTelegramLink(url: string): void;
  shareMessage?(messageId: string, callback?: (shared: boolean) => void): void;
  enableClosingConfirmation(): void;
  disableClosingConfirmation(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  onEvent(event: "activated" | "deactivated", callback: () => void): void;
  onEvent(event: "shareMessageSent", callback: () => void): void;
  onEvent(
    event: "shareMessageFailed",
    callback: (payload: {
      error:
        | "UNSUPPORTED"
        | "MESSAGE_EXPIRED"
        | "MESSAGE_SEND_FAILED"
        | "USER_DECLINED"
        | "UNKNOWN_ERROR";
    }) => void,
  ): void;
  onEvent(event: string, callback: () => void): void;
  offEvent(event: "activated" | "deactivated", callback: () => void): void;
  offEvent(event: "shareMessageSent", callback: () => void): void;
  offEvent(
    event: "shareMessageFailed",
    callback: (payload: {
      error:
        | "UNSUPPORTED"
        | "MESSAGE_EXPIRED"
        | "MESSAGE_SEND_FAILED"
        | "USER_DECLINED"
        | "UNKNOWN_ERROR";
    }) => void,
  ): void;
  offEvent(event: string, callback: () => void): void;
}

interface Window {
  Telegram?: { WebApp?: TelegramWebApp };
}
