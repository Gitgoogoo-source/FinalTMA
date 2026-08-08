import {
  loadInventoryPage,
  loadMarketPage,
  loadTasksPage,
} from "./pageRoutes.ts";

let started = false;

export function startDeferredPageWarmup(): () => void {
  if (started) return () => undefined;
  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  let idleHandle: number | undefined;
  let timerHandle: number | undefined;
  const preload = () => {
    if (started) return;
    started = true;
    void Promise.allSettled([
      loadMarketPage(),
      loadInventoryPage(),
      loadTasksPage(),
      import("../../pages/album/AlbumPage.tsx"),
    ]);
  };
  const schedule = () => {
    if (idleWindow.requestIdleCallback)
      idleHandle = idleWindow.requestIdleCallback(preload, { timeout: 1_500 });
    else timerHandle = window.setTimeout(preload, 250);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
  return () => {
    window.removeEventListener("load", schedule);
    if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
    if (timerHandle !== undefined) window.clearTimeout(timerHandle);
  };
}
