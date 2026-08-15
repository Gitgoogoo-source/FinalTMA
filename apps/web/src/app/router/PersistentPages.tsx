import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { PageQueryActivityProvider } from "../../platform/query/pageQueryActivity.tsx";
import {
  PageActivityProvider,
  type MainPagePath,
} from "../../shared/navigation/pageActivity.tsx";
import {
  getAppScrollTop,
  scrollAppTo,
} from "../../shared/navigation/appScroll.ts";
import {
  loadGachaPage,
  loadGamePage,
  loadInventoryPage,
  loadMarketPage,
  loadTasksPage,
} from "./pageRoutes.ts";
import { t } from "../../platform/i18n/index.ts";

const pages: readonly {
  path: MainPagePath;
  component: ComponentType;
}[] = [
  { path: "/", component: lazy(loadGachaPage) },
  { path: "/market", component: lazy(loadMarketPage) },
  { path: "/game", component: lazy(loadGamePage) },
  { path: "/inventory", component: lazy(loadInventoryPage) },
  { path: "/tasks", component: lazy(loadTasksPage) },
];

export function PersistentPages({
  activePath,
  search,
}: {
  activePath: MainPagePath | null;
  search: string;
}): ReactNode {
  const [visitState, setVisitState] = useState<{
    activePath: MainPagePath | null;
    visited: ReadonlySet<MainPagePath>;
  }>(() => ({
    activePath,
    visited: new Set(activePath ? [activePath] : []),
  }));
  const scrollPositions = useRef(new Map<MainPagePath, number>());
  if (visitState.activePath !== activePath) {
    setVisitState({
      activePath,
      visited:
        activePath && !visitState.visited.has(activePath)
          ? new Set([...visitState.visited, activePath])
          : visitState.visited,
    });
  }

  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    const positions = scrollPositions.current;
    const frame =
      activePath === null
        ? undefined
        : window.requestAnimationFrame(() =>
            scrollAppTo(positions.get(activePath) ?? 0),
          );
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (activePath) positions.set(activePath, getAppScrollTop());
    };
  }, [activePath]);

  return (
    <div className="persistent-pages">
      {pages.map(({ path, component: Page }) => {
        if (!visitState.visited.has(path) && path !== activePath) return null;
        const active = path === activePath;
        return (
          <div
            key={path}
            className="persistent-page"
            data-page-path={path}
            hidden={!active}
            inert={!active}
          >
            <PageQueryActivityProvider active={active}>
              <PageActivityProvider
                active={active}
                path={path}
                search={active ? search : ""}
              >
                <Suspense
                  fallback={
                    <main className="page-state">{t("正在加载页面")}</main>
                  }
                >
                  <Page />
                </Suspense>
              </PageActivityProvider>
            </PageQueryActivityProvider>
          </div>
        );
      })}
    </div>
  );
}
