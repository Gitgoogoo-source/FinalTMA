import {
  QueryClient,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  routeById,
  type RecoverableRouteId,
  type RefreshScope,
  type RouteId,
  type RouteInput,
  type RouteOutput,
} from "@pokepets/api-contracts/app";

import { apiRequest } from "../api/client.ts";
import {
  getSession,
  registerBootstrapCacheSeeder,
  registerSessionCacheClearer,
} from "../session/store.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 20_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
registerSessionCacheClearer(() => {
  void queryClient.cancelQueries();
  queryClient.clear();
});
registerBootstrapCacheSeeder((generation, data) => {
  queryClient.setQueryData([generation, "v1", "identity.bootstrap", {}], data);
});

export function routeQueryKey<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id> = {} as RouteInput<Id>,
): readonly unknown[] {
  return [getSession()?.generation ?? "public", "v1", routeId, input];
}

export function seedApiQuery<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id>,
  data: RouteOutput<Id>,
): void {
  queryClient.setQueryData(routeQueryKey(routeId, input), data);
}

export function prefetchApiQuery<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id> = {} as RouteInput<Id>,
): Promise<void> {
  const generation = getSession()?.generation ?? "public";
  return queryClient.prefetchQuery({
    queryKey: [generation, "v1", routeId, input],
    queryFn: async ({ signal }) => {
      const result = await apiRequest(routeId, input, { signal });
      assertCurrentGeneration(generation);
      return result.data;
    },
  });
}

export function useApiQuery<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id> = {} as RouteInput<Id>,
  enabled = true,
): UseQueryResult<RouteOutput<Id>> {
  const session = getSession();
  const generation = session?.generation ?? "public";
  return useQuery({
    queryKey: [generation, "v1", routeId, input],
    queryFn: async ({ signal }) => {
      const result = await apiRequest(routeId, input, { signal });
      assertCurrentGeneration(generation);
      return result.data;
    },
    enabled,
  });
}

export async function refreshUserState(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: [getSession()?.generation] });
}

const scopePrefixes: Record<
  Exclude<RefreshScope, "none" | "all">,
  readonly string[]
> = {
  session: ["identity", "vip", "wallet"],
  assets: ["identity", "gacha", "wheel", "vip", "tasks", "topup", "market"],
  inventory: ["identity", "inventory", "market", "expedition", "mint", "album"],
  payments: ["identity", "topup", "vip"],
  mint: ["identity", "mint", "wallet", "inventory"],
};

export async function refreshRouteScopes(
  routeId: RecoverableRouteId,
): Promise<void> {
  const route = routeById(routeId);
  const scopes: readonly RefreshScope[] = route.refreshScopes;
  if (scopes.includes("all")) return refreshUserState();
  const prefixes = new Set(
    scopes.flatMap((scope) =>
      scope === "none" || scope === "all" ? [] : scopePrefixes[scope],
    ),
  );
  await queryClient.invalidateQueries({
    predicate: (query) => {
      if (query.queryKey[0] !== getSession()?.generation) return false;
      const id = query.queryKey[2];
      return typeof id === "string" && prefixes.has(id.split(".")[0] ?? "");
    },
  });
}

function assertCurrentGeneration(expected: string): void {
  if ((getSession()?.generation ?? "public") !== expected)
    throw new DOMException("Stale session generation", "AbortError");
}
