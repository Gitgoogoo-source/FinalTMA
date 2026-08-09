import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  type ReactNode,
} from "react";
import {
  replaceAppLocation,
  useAppLocation,
} from "../../platform/navigation/index.tsx";
import { useSession } from "../../platform/session/store.ts";
import {
  isFirstScreenReady,
  subscribeFirstScreenReady,
} from "../../shared/navigation/firstScreenReadiness.ts";
import { AppShell } from "../shell/AppShell.tsx";
import { getMainPagePath, loadAlbumPage } from "./pageRoutes.ts";

const AlbumPage = lazy(loadAlbumPage);

export function AppRouter(): ReactNode {
  const location = useAppLocation();
  useBackgroundPreload(location.pathname);
  if (getMainPagePath(location.pathname)) return <AppShell />;
  if (location.pathname === "/album")
    return <AppShell standalonePage={withPageLoading(<AlbumPage />)} />;
  return <InvalidRouteRedirect />;
}

function useBackgroundPreload(pathname: string): void {
  const generation = useSession()?.generation;
  useEffect(() => {
    if (pathname !== "/" || !generation) return;
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
  }, [generation, pathname]);
}

function InvalidRouteRedirect(): null {
  useLayoutEffect(() => replaceAppLocation("/"), []);
  return null;
}

function withPageLoading(page: ReactNode): ReactNode {
  return (
    <Suspense fallback={<main className="page-state">正在加载页面</main>}>
      {page}
    </Suspense>
  );
}
