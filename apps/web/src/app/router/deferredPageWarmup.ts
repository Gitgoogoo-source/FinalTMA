import { preparePageModule, type PreloadablePagePath } from "./pageRoutes.ts";
import {
  subscribeTelegramActivity,
  telegram,
} from "../../platform/telegram/index.ts";

type NetworkInformationSignal = EventTarget & {
  effectiveType?: string;
  saveData?: boolean;
};

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const AUTOMATIC_PAGE_ORDER: readonly PreloadablePagePath[] = [
  "/inventory",
  "/tasks",
  "/market",
  "/album",
];

let automaticPageIndex = 0;
let automaticWarmupStopped = false;

export function startAdaptivePageWarmup(): () => void {
  if (
    automaticWarmupStopped ||
    automaticPageIndex >= AUTOMATIC_PAGE_ORDER.length
  )
    return () => undefined;

  const idleWindow = window as IdleWindow;
  const connection = (
    navigator as Navigator & { connection?: NetworkInformationSignal }
  ).connection;
  let telegramActive = telegram()?.isActive !== false;
  let disposed = false;
  let moduleLoading = false;
  let idleHandle: number | undefined;
  let timerHandle: number | undefined;

  const cancelScheduled = () => {
    if (idleHandle !== undefined) {
      idleWindow.cancelIdleCallback?.(idleHandle);
      idleHandle = undefined;
    }
    if (timerHandle !== undefined) {
      window.clearTimeout(timerHandle);
      timerHandle = undefined;
    }
  };

  const networkAllowsAutomaticWarmup = () =>
    connection?.saveData === false && connection.effectiveType === "4g";

  const canWarmUp = () =>
    !disposed &&
    !automaticWarmupStopped &&
    automaticPageIndex < AUTOMATIC_PAGE_ORDER.length &&
    document.readyState === "complete" &&
    document.visibilityState === "visible" &&
    navigator.onLine !== false &&
    telegramActive &&
    networkAllowsAutomaticWarmup();

  const scheduleNext = () => {
    if (!canWarmUp()) {
      cancelScheduled();
      return;
    }
    if (moduleLoading || idleHandle !== undefined || timerHandle !== undefined)
      return;
    const loadNext = () => {
      idleHandle = undefined;
      timerHandle = undefined;
      if (!canWarmUp()) return;
      const path = AUTOMATIC_PAGE_ORDER[automaticPageIndex];
      if (!path) return;
      moduleLoading = true;
      void preparePageModule(path)
        .then(() => {
          moduleLoading = false;
          automaticPageIndex += 1;
          scheduleNext();
        })
        .catch(() => {
          moduleLoading = false;
          automaticWarmupStopped = true;
          cancelScheduled();
        });
    };
    if (idleWindow.requestIdleCallback)
      idleHandle = idleWindow.requestIdleCallback(loadNext, { timeout: 5_000 });
    else timerHandle = window.setTimeout(loadNext, 1_000);
  };

  const synchronize = () => {
    if (canWarmUp()) scheduleNext();
    else cancelScheduled();
  };
  const activate = () => {
    telegramActive = true;
    synchronize();
  };
  const deactivate = () => {
    telegramActive = false;
    synchronize();
  };

  window.addEventListener("load", synchronize);
  window.addEventListener("online", synchronize);
  window.addEventListener("offline", synchronize);
  document.addEventListener("visibilitychange", synchronize);
  connection?.addEventListener("change", synchronize);
  const unsubscribeTelegram = subscribeTelegramActivity(activate, deactivate);
  synchronize();

  return () => {
    disposed = true;
    cancelScheduled();
    window.removeEventListener("load", synchronize);
    window.removeEventListener("online", synchronize);
    window.removeEventListener("offline", synchronize);
    document.removeEventListener("visibilitychange", synchronize);
    connection?.removeEventListener("change", synchronize);
    unsubscribeTelegram();
  };
}
