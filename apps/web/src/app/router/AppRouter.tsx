import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "../shell/AppShell.tsx";
import {
  loadInventoryPage,
  loadMarketPage,
  loadTasksPage,
} from "./pageRoutes.ts";

const loadAlbumPage = () =>
  import("../../pages/album/AlbumPage.tsx").then((module) => ({
    default: module.AlbumPage,
  }));
const AlbumPage = lazy(loadAlbumPage);

let backgroundPreloadStarted = false;

export function AppRouter(): ReactNode {
  useBackgroundPreload();
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index />
        <Route path="market" />
        <Route path="game" />
        <Route path="inventory" />
        <Route path="tasks" />
        <Route path="album" element={withPageLoading(<AlbumPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function useBackgroundPreload(): void {
  const location = useLocation();
  useEffect(() => {
    if (location.pathname !== "/" || backgroundPreloadStarted) return;
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
      if (backgroundPreloadStarted) return;
      backgroundPreloadStarted = true;
      void Promise.allSettled([
        loadMarketPage(),
        loadInventoryPage(),
        loadTasksPage(),
        loadAlbumPage(),
      ]);
    };
    const schedule = () => {
      if (idleWindow.requestIdleCallback)
        idleHandle = idleWindow.requestIdleCallback(preload, {
          timeout: 1_500,
        });
      else timerHandle = window.setTimeout(preload, 250);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => {
      window.removeEventListener("load", schedule);
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timerHandle !== undefined) window.clearTimeout(timerHandle);
    };
  }, [location.pathname]);
}

function withPageLoading(page: ReactNode): ReactNode {
  return (
    <Suspense fallback={<main className="page-state">正在加载页面</main>}>
      {page}
    </Suspense>
  );
}
