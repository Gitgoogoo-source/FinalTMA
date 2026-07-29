import {
  QueryClient,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
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

type ApiQuerySuppression = {
  generation: string;
  routeIds: ReadonlySet<RouteId>;
};

type ForegroundAuthorityRefresh = {
  generation: string;
  pathname: string;
  handledPrefixes: readonly string[];
  refresh(): Promise<boolean>;
};

const apiQuerySuppressions = new Map<symbol, ApiQuerySuppression>();
const apiQuerySuppressionListeners = new Set<() => void>();
const foregroundAuthorityRefreshes = new Map<
  symbol,
  ForegroundAuthorityRefresh
>();
let apiQuerySuppressionVersion = 0;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: { retry: false },
  },
});
registerSessionCacheClearer(() => {
  void queryClient.cancelQueries();
  queryClient.clear();
});
registerBootstrapCacheSeeder((generation, data) => {
  assertCurrentSession(generation, true);
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
  const generation = getSession()?.generation ?? "public";
  assertCurrentSession(generation, routeById(routeId).auth);
  queryClient.setQueryData([generation, "v1", routeId, input], data);
}

export function prefetchApiQuery<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id> = {} as RouteInput<Id>,
): Promise<void> {
  const generation = getSession()?.generation ?? "public";
  return queryClient.prefetchQuery({
    queryKey: [generation, "v1", routeId, input],
    queryFn: async ({ signal }) => {
      assertApiQueryAllowed(generation, routeId);
      const result = await apiRequest(routeId, input, { signal });
      assertCurrentSession(generation, routeById(routeId).auth);
      return result.data;
    },
  });
}

export function fetchApiQuery<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id> = {} as RouteInput<Id>,
  suppressionOwner?: symbol,
): Promise<RouteOutput<Id>> {
  const generation = getSession()?.generation ?? "public";
  return queryClient.fetchQuery({
    queryKey: [generation, "v1", routeId, input],
    queryFn: async ({ signal }) => {
      assertApiQueryAllowed(generation, routeId, suppressionOwner);
      const result = await apiRequest(routeId, input, { signal });
      assertCurrentSession(generation, routeById(routeId).auth);
      return result.data;
    },
    staleTime: 0,
  });
}

export function cancelApiQueries(
  routeIds: readonly RouteId[],
  requestedGeneration = getSession()?.generation,
): Promise<void> {
  const generation = requestedGeneration;
  if (!generation) return Promise.resolve();
  const selected = new Set<RouteId>(routeIds);
  return queryClient.cancelQueries({
    predicate: (query) =>
      query.queryKey[0] === generation &&
      selected.has(query.queryKey[2] as RouteId),
  });
}

export function useApiQuery<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id> = {} as RouteInput<Id>,
  enabled = true,
): UseQueryResult<RouteOutput<Id>> {
  useSyncExternalStore(
    subscribeApiQuerySuppressions,
    getApiQuerySuppressionVersion,
    getApiQuerySuppressionVersion,
  );
  const session = getSession();
  const generation = session?.generation ?? "public";
  const suppressed = isApiQuerySuppressed(generation, routeId);
  return useQuery({
    queryKey: [generation, "v1", routeId, input],
    queryFn: async ({ signal }) => {
      assertApiQueryAllowed(generation, routeId);
      const result = await apiRequest(routeId, input, { signal });
      assertCurrentSession(generation, routeById(routeId).auth);
      return result.data;
    },
    enabled: enabled && !suppressed,
    refetchOnReconnect: false,
  });
}

export async function refreshUserState(): Promise<void> {
  const generation = getSession()?.generation;
  if (!generation) return;
  await queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === generation &&
      !isApiQuerySuppressed(generation, query.queryKey[2] as RouteId),
  });
}

const topAssetRouteIds = [
  "identity.bootstrap",
  "vip.get",
  "wallet.get",
] as const;

export async function refreshTopAssetSummary(): Promise<boolean> {
  const generation = getSession()?.generation;
  if (!generation) return false;
  await queryClient.refetchQueries({
    type: "active",
    predicate: (query) =>
      query.queryKey[0] === generation &&
      !isApiQuerySuppressed(generation, query.queryKey[2] as RouteId) &&
      topAssetRouteIds.includes(
        query.queryKey[2] as (typeof topAssetRouteIds)[number],
      ),
  });
  return topAssetRouteIds.every(
    (routeId) =>
      queryClient.getQueryState([generation, "v1", routeId, {}])?.status ===
      "success",
  );
}

export async function refreshForegroundState(pathname: string): Promise<void> {
  const generation = getSession()?.generation;
  if (!generation) return;
  const authority = [...foregroundAuthorityRefreshes.values()].find(
    (candidate) =>
      candidate.generation === generation && candidate.pathname === pathname,
  );
  let handledPrefixes: readonly string[] = [];
  if (authority) {
    const proceed = await authority.refresh().catch(() => false);
    if (
      !proceed ||
      getSession()?.generation !== generation ||
      hasApiQuerySuppression(generation)
    )
      return;
    handledPrefixes = authority.handledPrefixes;
  }
  const prefixes = new Set([
    "identity",
    "vip",
    "wallet",
    ...foregroundPrefixes(pathname),
  ]);
  for (const prefix of handledPrefixes) prefixes.delete(prefix);
  await queryClient.invalidateQueries({
    refetchType: "active",
    predicate: (query) => {
      if (query.queryKey[0] !== generation) return false;
      const id = query.queryKey[2];
      return (
        typeof id === "string" &&
        !isApiQuerySuppressed(generation, id as RouteId) &&
        prefixes.has(id.split(".")[0] ?? "")
      );
    },
  });
}

export function suppressApiQueries(
  owner: symbol,
  generation: string,
  routeIds: readonly RouteId[],
): void {
  apiQuerySuppressions.set(owner, {
    generation,
    routeIds: new Set(routeIds),
  });
  publishApiQuerySuppressionChange();
}

export function releaseApiQuerySuppression(owner: symbol): void {
  if (!apiQuerySuppressions.delete(owner)) return;
  publishApiQuerySuppressionChange();
}

export function registerForegroundAuthorityRefresh(
  owner: symbol,
  authority: ForegroundAuthorityRefresh,
): () => void {
  foregroundAuthorityRefreshes.set(owner, authority);
  return () => {
    if (foregroundAuthorityRefreshes.get(owner) === authority)
      foregroundAuthorityRefreshes.delete(owner);
  };
}

const scopePrefixes: Record<
  Exclude<RefreshScope, "none" | "all">,
  readonly string[]
> = {
  session: ["identity", "vip", "wallet"],
  assets: [
    "identity",
    "gacha",
    "wheel",
    "vip",
    "tasks",
    "topup",
    "market",
    "album",
  ],
  inventory: ["identity", "inventory", "market", "expedition", "mint", "album"],
  payments: ["identity", "topup", "vip"],
  mint: ["identity", "mint", "wallet", "inventory"],
  battle: ["battle"],
};

export async function refreshRouteScopes(
  routeId: RecoverableRouteId | "battle.heartbeat" | "battle.offline",
): Promise<void> {
  return refreshScopes(routeById(routeId).refreshScopes);
}

export async function refreshScopes(
  scopes: readonly RefreshScope[],
  options: { throwOnError?: boolean } = {},
): Promise<void> {
  if (scopes.includes("all")) return refreshUserState();
  const prefixes = new Set(
    scopes.flatMap((scope) =>
      scope === "none" || scope === "all" ? [] : scopePrefixes[scope],
    ),
  );
  await queryClient.invalidateQueries(
    {
      predicate: (query) => {
        const generation = getSession()?.generation;
        if (!generation || query.queryKey[0] !== generation) return false;
        const id = query.queryKey[2];
        return (
          typeof id === "string" &&
          !isApiQuerySuppressed(generation, id as RouteId) &&
          prefixes.has(id.split(".")[0] ?? "")
        );
      },
    },
    options,
  );
}

function foregroundPrefixes(pathname: string): readonly string[] {
  if (pathname === "/") return ["gacha"];
  if (pathname === "/market") return ["market"];
  if (pathname === "/inventory") return ["inventory", "catalog"];
  if (pathname === "/tasks") return ["tasks", "referral", "wheel"];
  if (pathname === "/game") return ["battle"];
  if (pathname === "/album") return ["album"];
  if (pathname.startsWith("/mint/")) return ["inventory", "mint"];
  return [];
}

function assertCurrentSession(expected: string, authenticated: boolean): void {
  const session = getSession();
  if (
    (session?.generation ?? "public") !== expected ||
    (authenticated &&
      (session?.accountStatus !== "normal" ||
        session.entryHandoffState !== "complete"))
  )
    throw new DOMException("Stale session generation", "AbortError");
}

function assertApiQueryAllowed(
  generation: string,
  routeId: RouteId,
  suppressionOwner?: symbol,
): void {
  if (isApiQuerySuppressed(generation, routeId, suppressionOwner))
    throw new DOMException(
      "Query suppressed by authority coordinator",
      "AbortError",
    );
}

function isApiQuerySuppressed(
  generation: string,
  routeId: RouteId,
  suppressionOwner?: symbol,
): boolean {
  return [...apiQuerySuppressions].some(
    ([owner, suppression]) =>
      owner !== suppressionOwner &&
      suppression.generation === generation &&
      suppression.routeIds.has(routeId),
  );
}

function hasApiQuerySuppression(generation: string): boolean {
  return [...apiQuerySuppressions.values()].some(
    (suppression) => suppression.generation === generation,
  );
}

function subscribeApiQuerySuppressions(listener: () => void): () => void {
  apiQuerySuppressionListeners.add(listener);
  return () => apiQuerySuppressionListeners.delete(listener);
}

function getApiQuerySuppressionVersion(): number {
  return apiQuerySuppressionVersion;
}

function publishApiQuerySuppressionChange(): void {
  apiQuerySuppressionVersion += 1;
  for (const listener of apiQuerySuppressionListeners) listener();
}
