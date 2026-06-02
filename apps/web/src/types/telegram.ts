export type TelegramColorScheme = "light" | "dark";

export type TelegramThemeParams = {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  bottom_bar_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
};

export type TelegramSafeAreaInset = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type TelegramWebAppUser = {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
  added_to_attachment_menu?: boolean;
  photo_url?: string;
};

export type TelegramWebAppChat = {
  id: number;
  type: "sender" | "private" | "group" | "supergroup" | "channel" | string;
  title?: string;
  username?: string;
  photo_url?: string;
};

export type TelegramInitDataUnsafe = {
  query_id?: string;
  user?: TelegramWebAppUser;
  receiver?: TelegramWebAppUser;
  chat?: TelegramWebAppChat;
  chat_type?:
    | "sender"
    | "private"
    | "group"
    | "supergroup"
    | "channel"
    | string;
  chat_instance?: string;
  start_param?: string;
  can_send_after?: number;
  auth_date?: number;
  hash?: string;
  signature?: string;
  [key: string]: unknown;
};

export type TelegramBackButton = {
  isVisible?: boolean;
  show?: () => void;
  hide?: () => void;
  onClick?: (callback: () => void) => void;
  offClick?: (callback: () => void) => void;
};

export type TelegramEventName =
  | "themeChanged"
  | "viewportChanged"
  | "safeAreaChanged"
  | "contentSafeAreaChanged"
  | "fullscreenChanged"
  | "fullscreenFailed"
  | "backButtonClicked";

export type TelegramEventHandler = (eventData?: unknown) => void;

export type TelegramInvoiceStatus = "paid" | "cancelled" | "failed" | "pending";

export type TelegramWebView = {
  postEvent?: (
    eventType: string,
    callback?: boolean,
    eventData?: Record<string, unknown>,
  ) => void;
};

export type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: TelegramInitDataUnsafe;
  version?: string;
  platform?: string;
  isExpanded?: boolean;
  isFullscreen?: boolean;
  isVerticalSwipesEnabled?: boolean;
  colorScheme?: TelegramColorScheme;
  themeParams?: TelegramThemeParams;
  viewportHeight?: number;
  viewportStableHeight?: number;
  safeAreaInset?: TelegramSafeAreaInset;
  contentSafeAreaInset?: TelegramSafeAreaInset;
  BackButton?: TelegramBackButton;
  isVersionAtLeast?: (version: string) => boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  openInvoice?: (
    url: string,
    callback?: (status: TelegramInvoiceStatus | string) => void,
  ) => void;
  openTelegramLink?: (url: string) => void;
  ready?: () => void;
  expand?: () => void;
  enableVerticalSwipes?: () => void;
  disableVerticalSwipes?: () => void;
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  onEvent?: (
    eventType: TelegramEventName,
    eventHandler: TelegramEventHandler,
  ) => void;
  offEvent?: (
    eventType: TelegramEventName,
    eventHandler: TelegramEventHandler,
  ) => void;
};

export type TelegramGlobal = typeof globalThis & {
  Telegram?: {
    WebView?: TelegramWebView;
    WebApp?: TelegramWebApp;
  };
};

export function getTelegramWebApp(): TelegramWebApp | null {
  return (globalThis as TelegramGlobal).Telegram?.WebApp ?? null;
}

export function getTelegramWebView(): TelegramWebView | null {
  return (globalThis as TelegramGlobal).Telegram?.WebView ?? null;
}
