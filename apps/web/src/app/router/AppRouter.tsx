import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "../shell/AppShell.tsx";

const loadAlbumPage = () =>
  import("../../pages/album/AlbumPage.tsx").then((module) => ({
    default: module.AlbumPage,
  }));
const loadGamePage = () =>
  import("../../pages/game/GamePage.tsx").then((module) => ({
    default: module.GamePage,
  }));
const loadGachaPage = () =>
  import("../../pages/gacha/GachaPage.tsx").then((module) => ({
    default: module.GachaPage,
  }));
const loadInventoryPage = () =>
  import("../../pages/inventory/InventoryPage.tsx").then((module) => ({
    default: module.InventoryPage,
  }));
const loadMarketPage = () =>
  import("../../pages/market/MarketPage.tsx").then((module) => ({
    default: module.MarketPage,
  }));
const loadMintPage = () =>
  import("../../pages/mint/MintPage.tsx").then((module) => ({
    default: module.MintPage,
  }));
const loadTasksPage = () =>
  import("../../pages/tasks/TasksPage.tsx").then((module) => ({
    default: module.TasksPage,
  }));

const AlbumPage = lazy(loadAlbumPage);
const GamePage = lazy(loadGamePage);
const GachaPage = lazy(loadGachaPage);
const InventoryPage = lazy(loadInventoryPage);
const MarketPage = lazy(loadMarketPage);
const MintPage = lazy(loadMintPage);
const TasksPage = lazy(loadTasksPage);

let backgroundPreloadStarted = false;

export function AppRouter(): ReactNode {
  useBackgroundPreload();
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={withPageLoading(<GachaPage />)} />
        <Route path="market" element={withPageLoading(<MarketPage />)} />
        <Route path="game" element={withGameLoading(<GamePage />)} />
        <Route path="inventory" element={withPageLoading(<InventoryPage />)} />
        <Route path="tasks" element={withPageLoading(<TasksPage />)} />
      </Route>
      <Route path="album" element={withPageLoading(<AlbumPage />)} />
      <Route path="mint/:templateId" element={withPageLoading(<MintPage />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
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
        loadGamePage(),
        import("./backgroundPreload.ts").then(({ preloadMonsterTamer }) =>
          preloadMonsterTamer(),
        ),
      ]).then(() =>
        Promise.allSettled([
          loadMarketPage(),
          loadInventoryPage(),
          loadTasksPage(),
          loadAlbumPage(),
        ]),
      );
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

function withGameLoading(page: ReactNode): ReactNode {
  return (
    <Suspense
      fallback={
        <main
          className="page game-page monster-home-page"
          aria-label="水上家园"
        />
      }
    >
      {page}
    </Suspense>
  );
}
