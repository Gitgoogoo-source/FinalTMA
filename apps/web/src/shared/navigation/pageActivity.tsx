import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

export type MainPagePath = "/" | "/market" | "/game" | "/inventory" | "/tasks";

type SearchParamsInit =
  | string
  | URLSearchParams
  | Record<string, string>
  | string[][];
type SearchParamsOptions = {
  replace?: boolean;
  state?: unknown;
  preventScrollReset?: boolean;
};
type PageActivityValue = {
  active: boolean;
  params: URLSearchParams;
  setParams(next: SearchParamsInit, options?: SearchParamsOptions): void;
};

const PageActivityContext = createContext<PageActivityValue | null>(null);

export function PageActivityProvider({
  active,
  path,
  search,
  children,
}: {
  active: boolean;
  path: MainPagePath;
  search: string;
  children: ReactNode;
}): ReactNode {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState(() => ({
    active,
    search: active ? search : "",
  }));
  if (snapshot.active !== active || (active && snapshot.search !== search))
    setSnapshot({
      active,
      search: active ? search : snapshot.search,
    });
  const params = useMemo(
    () => new URLSearchParams(active ? search : snapshot.search),
    [active, search, snapshot.search],
  );
  const setParams = useCallback(
    (next: SearchParamsInit, options?: SearchParamsOptions) => {
      const query = new URLSearchParams(next);
      navigate(
        { pathname: path, search: query.size > 0 ? `?${query}` : "" },
        options,
      );
    },
    [navigate, path],
  );
  const value = useMemo(
    () => ({ active, params, setParams }),
    [active, params, setParams],
  );
  return (
    <PageActivityContext.Provider value={value}>
      {children}
    </PageActivityContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePageActive(): boolean {
  return usePageActivityValue().active;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePageSearchParams(): readonly [
  URLSearchParams,
  PageActivityValue["setParams"],
] {
  const { params, setParams } = usePageActivityValue();
  return [params, setParams] as const;
}

function usePageActivityValue(): PageActivityValue {
  const value = useContext(PageActivityContext);
  if (!value)
    throw new Error("Page activity hooks require PageActivityProvider");
  return value;
}
