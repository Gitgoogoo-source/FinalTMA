import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../shell/AppShell.tsx";

const AlbumPage = lazy(() =>
  import("../../pages/album/index.ts").then((module) => ({
    default: module.AlbumPage,
  })),
);
const GamePage = lazy(() =>
  import("../../pages/game/index.ts").then((module) => ({
    default: module.GamePage,
  })),
);
const GachaPage = lazy(() =>
  import("../../pages/gacha/index.ts").then((module) => ({
    default: module.GachaPage,
  })),
);
const InventoryPage = lazy(() =>
  import("../../pages/inventory/index.ts").then((module) => ({
    default: module.InventoryPage,
  })),
);
const MarketPage = lazy(() =>
  import("../../pages/market/index.ts").then((module) => ({
    default: module.MarketPage,
  })),
);
const MintPage = lazy(() =>
  import("../../pages/mint/index.ts").then((module) => ({
    default: module.MintPage,
  })),
);
const TasksPage = lazy(() =>
  import("../../pages/tasks/index.ts").then((module) => ({
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
