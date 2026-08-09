import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type AppLocation = {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
};

export type AppNavigationTarget =
  | string
  | number
  | {
      pathname?: string;
      search?: string;
      hash?: string;
    };

export type AppNavigationOptions = {
  replace?: boolean;
  state?: unknown;
  preventScrollReset?: boolean;
};

export type AppSearchParamsInit =
  | string
  | URLSearchParams
  | Record<string, string>
  | string[][];

type AppNavigate = (
  target: AppNavigationTarget,
  options?: AppNavigationOptions,
) => void;

const NavigationContext = createContext(false);
const subscribers = new Set<() => void>();
let popstateListening = false;
let cachedHref = "";
let cachedState: unknown;
let cachedSnapshot: AppLocation | null = null;

export function AppNavigationProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <NavigationContext.Provider value>{children}</NavigationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppLocation(): AppLocation {
  useNavigationScope();
  return useSyncExternalStore(
    subscribeNavigation,
    getNavigationSnapshot,
    getNavigationSnapshot,
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppNavigate(): AppNavigate {
  useNavigationScope();
  return navigateApp;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppSearchParams(): readonly [
  URLSearchParams,
  (next: AppSearchParamsInit, options?: AppNavigationOptions) => void,
] {
  const location = useAppLocation();
  const navigate = useAppNavigate();
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const setParams = useCallback(
    (next: AppSearchParamsInit, options?: AppNavigationOptions) => {
      const query = new URLSearchParams(next);
      navigate(
        {
          pathname: location.pathname,
          search: query.size > 0 ? `?${query.toString()}` : "",
          hash: location.hash,
        },
        options,
      );
    },
    [location.hash, location.pathname, navigate],
  );
  return [params, setParams] as const;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppParams(
  pattern: string,
): Readonly<Record<string, string>> {
  const { pathname } = useAppLocation();
  return useMemo(() => matchPathParams(pattern, pathname), [pattern, pathname]);
}

// eslint-disable-next-line react-refresh/only-export-components
export function replaceAppLocation(target: string, state: unknown = {}): void {
  navigateApp(target, { replace: true, state });
}

function navigateApp(
  target: AppNavigationTarget,
  options: AppNavigationOptions = {},
): void {
  if (typeof target === "number") {
    window.history.go(target);
    return;
  }
  const url = resolveTarget(target);
  if (options.replace)
    window.history.replaceState(options.state ?? null, "", url);
  else window.history.pushState(options.state ?? null, "", url);
  publishNavigation();
}

function resolveTarget(target: Exclude<AppNavigationTarget, number>): string {
  const current = window.location;
  const candidate =
    typeof target === "string"
      ? new URL(target, current.href)
      : new URL(
          `${target.pathname ?? current.pathname}${normalizeSearch(target.search ?? current.search)}${normalizeHash(target.hash ?? current.hash)}`,
          current.origin,
        );
  if (candidate.origin !== current.origin)
    throw new Error("APP_NAVIGATION_CROSS_ORIGIN_FORBIDDEN");
  return `${candidate.pathname}${candidate.search}${candidate.hash}`;
}

function normalizeSearch(search: string): string {
  return search.length === 0 || search.startsWith("?") ? search : `?${search}`;
}

function normalizeHash(hash: string): string {
  return hash.length === 0 || hash.startsWith("#") ? hash : `#${hash}`;
}

function subscribeNavigation(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  if (!popstateListening) {
    window.addEventListener("popstate", publishNavigation);
    popstateListening = true;
  }
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && popstateListening) {
      window.removeEventListener("popstate", publishNavigation);
      popstateListening = false;
    }
  };
}

function publishNavigation(): void {
  cachedHref = "";
  cachedSnapshot = null;
  for (const subscriber of subscribers) subscriber();
}

function getNavigationSnapshot(): AppLocation {
  const href = window.location.href;
  const state = window.history.state as unknown;
  if (cachedSnapshot && cachedHref === href && cachedState === state)
    return cachedSnapshot;
  cachedHref = href;
  cachedState = state;
  cachedSnapshot = {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    state,
  };
  return cachedSnapshot;
}

function matchPathParams(
  pattern: string,
  pathname: string,
): Readonly<Record<string, string>> {
  const patternSegments = pathSegments(pattern);
  const path = pathSegments(pathname);
  if (patternSegments.length !== path.length) return {};
  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index] ?? "";
    const actual = path[index] ?? "";
    if (!expected.startsWith(":")) {
      if (expected !== actual) return {};
      continue;
    }
    try {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } catch {
      return {};
    }
  }
  return params;
}

function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function useNavigationScope(): void {
  if (!useContext(NavigationContext))
    throw new Error("App navigation hooks require AppNavigationProvider");
}
