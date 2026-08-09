import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "../../platform/session/store.ts";
import {
  isFirstScreenReady,
  subscribeFirstScreenReady,
} from "../../shared/navigation/firstScreenReadiness.ts";
import { AppShell } from "../shell/AppShell.tsx";
import { loadAlbumPage } from "./pageRoutes.ts";

const AlbumPage = lazy(loadAlbumPage);

export function AppRouter(): ReactNode {
  useBackgroundPreload();
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<PersistentPageLeaf />} />
        <Route path="market" element={<PersistentPageLeaf />} />
        <Route path="game" element={<PersistentPageLeaf />} />
        <Route path="inventory" element={<PersistentPageLeaf />} />
        <Route path="tasks" element={<PersistentPageLeaf />} />
        <Route path="album" element={withPageLoading(<AlbumPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function PersistentPageLeaf(): null {
  return null;
}

function useBackgroundPreload(): void {
  const location = useLocation();
  const generation = useSession()?.generation;
  useEffect(() => {
    if (location.pathname !== "/" || !generation) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    let loading = false;
    const start = () => {
      if (cancelled || loading) return;
      loading = true;
      void import("./deferredPageWarmup.ts")
        .then((module) => {
          if (!cancelled) dispose = module.startAdaptivePageWarmup();
        })
        .catch(() => undefined);
    };
    const unsubscribe = subscribeFirstScreenReady((readyGeneration) => {
      if (readyGeneration === generation) start();
    });
    if (isFirstScreenReady(generation)) start();
    return () => {
      cancelled = true;
      unsubscribe();
      dispose?.();
    };
  }, [generation, location.pathname]);
}

function withPageLoading(page: ReactNode): ReactNode {
  return (
    <Suspense fallback={<main className="page-state">正在加载页面</main>}>
      {page}
    </Suspense>
  );
}
