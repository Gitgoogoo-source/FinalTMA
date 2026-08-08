import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "../shell/AppShell.tsx";

const loadAlbumPage = () =>
  import("../../pages/album/AlbumPage.tsx").then((module) => ({
    default: module.AlbumPage,
  }));
const AlbumPage = lazy(loadAlbumPage);

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
    if (location.pathname !== "/") return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void import("./deferredPageWarmup.ts")
      .then((module) => {
        if (!cancelled) dispose = module.startDeferredPageWarmup();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      dispose?.();
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
