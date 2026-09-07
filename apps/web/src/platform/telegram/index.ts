export function telegram(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

function attemptTelegramMethod(action: () => void): void {
  try {
    action();
  } catch {
    // Telegram exposes unsupported methods on older clients and throws when called.
  }
}

export function setTelegramBackButtonVisible(visible: boolean): void {
  const button = telegram()?.BackButton;
  if (!button) return;
  attemptTelegramMethod(() => (visible ? button.show() : button.hide()));
}

export function subscribeTelegramBackButton(callback: () => void): () => void {
  const button = telegram()?.BackButton;
  if (!button) return () => undefined;
  attemptTelegramMethod(() => button.onClick(callback));
  return () => attemptTelegramMethod(() => button.offClick(callback));
}

export function haptic(
  type: "error" | "success" | "warning" = "success",
): void {
  telegram()?.HapticFeedback?.notificationOccurred(type);
}

export function selectionHaptic(): void {
  const feedback = telegram()?.HapticFeedback;
  if (feedback?.selectionChanged)
    attemptTelegramMethod(() => feedback.selectionChanged?.());
}

export function impactHaptic(style: "light" | "medium" | "heavy"): void {
  const feedback = telegram()?.HapticFeedback;
  if (feedback?.impactOccurred)
    attemptTelegramMethod(() => feedback.impactOccurred(style));
}

export function sharePreparedMessage(
  messageId: string,
  callback?: (shared: boolean) => void,
): boolean {
  const app = telegram();
  if (!app?.shareMessage || !messageId) return false;
  try {
    app.shareMessage(messageId, callback);
    return true;
  } catch {
    return false;
  }
}

export type TelegramShareFailure =
  | "UNSUPPORTED"
  | "MESSAGE_EXPIRED"
  | "MESSAGE_SEND_FAILED"
  | "USER_DECLINED"
  | "UNKNOWN_ERROR";

export function supportsPreparedMessageSharing(): boolean {
  return typeof telegram()?.shareMessage === "function";
}

export function subscribeTelegramActivity(
  activated: () => void,
  deactivated: () => void,
): () => void {
  const app = telegram();
  if (!app) return () => undefined;
  app.onEvent("activated", activated);
  app.onEvent("deactivated", deactivated);
  return () => {
    app.offEvent("activated", activated);
    app.offEvent("deactivated", deactivated);
  };
}

export function subscribePreparedMessageShareEvents(
  sent: () => void,
  failed: (error: TelegramShareFailure) => void,
): () => void {
  const app = telegram();
  if (!app) return () => undefined;
  const onFailure = (payload: { error: TelegramShareFailure }) =>
    failed(payload.error);
  app.onEvent("shareMessageSent", sent);
  app.onEvent("shareMessageFailed", onFailure);
  return () => {
    app.offEvent("shareMessageSent", sent);
    app.offEvent("shareMessageFailed", onFailure);
  };
}
