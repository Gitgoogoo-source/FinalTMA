export const TELEGRAM_SDK_TIMEOUT_MS = 12_000;

/** Observe the one integrity-pinned script; never insert a fallback script. */
export function waitForTelegramSdk(
  signal?: AbortSignal,
): Promise<TelegramWebApp> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("TELEGRAM_SDK_ABORTED"));
      return;
    }
    const existing = window.Telegram?.WebApp;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.getElementById("telegram-sdk");
    if (!script) {
      reject(new Error("TELEGRAM_SDK_MISSING"));
      return;
    }

    const cleanup = () => {
      clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (code: string) => {
      cleanup();
      reject(new Error(code));
    };
    const onLoad = () => {
      const app = window.Telegram?.WebApp;
      if (!app) {
        fail("TELEGRAM_SDK_UNAVAILABLE");
        return;
      }
      cleanup();
      resolve(app);
    };
    const onError = () => fail("TELEGRAM_SDK_LOAD_FAILED");
    const onAbort = () => fail("TELEGRAM_SDK_ABORTED");
    const timeout = setTimeout(
      () => fail("TELEGRAM_SDK_TIMEOUT"),
      TELEGRAM_SDK_TIMEOUT_MS,
    );
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
