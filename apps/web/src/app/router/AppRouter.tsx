import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../shell/AppShell.tsx";

const AlbumPage = lazy(() =>
  import("../../features/album/index.ts").then((module) => ({
    default: module.AlbumPage,
  })),
);
const GamePage = lazy(() =>
  import("../../features/game/index.ts").then((module) => ({
    default: module.GamePage,
  })),
);
const GachaPage = lazy(() =>
  import("../../features/gacha/index.ts").then((module) => ({
    default: module.GachaPage,
  })),
);
const InventoryPage = lazy(() =>
  import("../../features/inventory/index.ts").then((module) => ({
    default: module.InventoryPage,
  })),
);
const MarketPage = lazy(() =>
  import("../../features/market/index.ts").then((module) => ({
    default: module.MarketPage,
  })),
);
const MintPage = lazy(() =>
  import("../../features/mint/index.ts").then((module) => ({
    default: module.MintPage,
  })),
);
const TasksPage = lazy(() =>
  import("../../features/tasks/index.ts").then((module) => ({
    default: module.TasksPage,
  })),
);

export function AppRouter(): ReactNode {
  return (
    <Suspense fallback={<main className="page-state">正在加载页面</main>}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<GachaPage />} />
          <Route path="market" element={<MarketPage />} />
          <Route path="game" element={<GamePage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="tasks" element={<TasksPage />} />
        </Route>
        <Route path="album" element={<AlbumPage />} />
        <Route path="mint/:templateId" element={<MintPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
