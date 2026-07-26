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

import {
  PageActivityProvider,
  type MainPagePath,
} from "../../shared/navigation/pageActivity.tsx";
import {
  loadGachaPage,
  loadGamePage,
  loadInventoryPage,
  loadMarketPage,
  loadTasksPage,
} from "./pageRoutes.ts";

const pages: readonly {
  path: MainPagePath;
  component: ComponentType;
  game?: boolean;
}[] = [
  { path: "/", component: lazy(loadGachaPage) },
  { path: "/market", component: lazy(loadMarketPage) },
  { path: "/game", component: lazy(loadGamePage), game: true },
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
            window.scrollTo({
              top: positions.get(activePath) ?? 0,
              left: 0,
              behavior: "auto",
            }),
          );
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (activePath) positions.set(activePath, Math.max(0, window.scrollY));
    };
  }, [activePath]);

  return (
    <div className="persistent-pages">
      {pages.map(({ path, component: Page, game }) => {
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
            <PageActivityProvider
              active={active}
              path={path}
              search={active ? search : ""}
            >
              <Suspense
                fallback={
                  game ? (
                    <main
                      className="page game-page monster-home-page"
                      aria-label="水上家园"
                    />
                  ) : (
                    <main className="page-state">正在加载页面</main>
                  )
                }
              >
                <Page />
              </Suspense>
            </PageActivityProvider>
          </div>
        );
      })}
    </div>
  );
}
