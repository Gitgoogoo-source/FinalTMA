import {
  CancelledError,
  hashKey,
  notifyManager,
  QueryClient,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import {
  loadClientRoute,
  type RecoverableRouteId,
  type RefreshScope,
  type RouteId,
  type RouteInput,
  type RouteOutput,
} from "@pokepets/api-contracts/app-client";

import { apiRequest } from "../api/client.ts";
import {
  getSession,
  registerIdentitySummaryCacheSeeder,
  registerSessionCacheClearer,
} from "../session/store.ts";
import { usePageQueryActive } from "./pageQueryActivity.tsx";

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

export type ApiQueryRequest = {
  [Id in RouteId]: {
    routeId: Id;
    input: RouteInput<Id>;
  };
}[RouteId];

type OwnedApiQueryBatch = {
  owner: symbol;
  generation: string;
  controller: AbortController;
  queryHashes: ReadonlySet<string>;
  task: Promise<void>;
};

const apiQuerySuppressions = new Map<symbol, ApiQuerySuppression>();
const apiQuerySuppressionListeners = new Set<() => void>();
const foregroundAuthorityRefreshes = new Map<
  symbol,
  ForegroundAuthorityRefresh
>();
const ownedApiQueries = new Map<string, OwnedApiQueryBatch>();
const ownedApiQueryBatches = new Set<OwnedApiQueryBatch>();
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
  for (const batch of ownedApiQueryBatches)
    batch.controller.abort(
      new DOMException("Session query ownership ended", "AbortError"),
    );
  ownedApiQueries.clear();
  ownedApiQueryBatches.clear();
  apiQuerySuppressions.clear();
  foregroundAuthorityRefreshes.clear();
  publishApiQuerySuppressionChange();
  void queryClient.cancelQueries();
  queryClient.clear();
});
registerIdentitySummaryCacheSeeder((generation, data) => {
  assertCurrentSession(generation, true);
  queryClient.setQueryData([generation, "v1", "identity.summary", {}], data);
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
  assertCurrentSession(generation, true);
  queryClient.setQueryData([generation, "v1", routeId, input], data);
}

export function prefetchApiQuery<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id> = {} as RouteInput<Id>,
): Promise<void> {
  const generation = getSession()?.generation ?? "public";
  return queryClient.prefetchQuery({
    queryKey: [generation, "v1", routeId, input],
    queryFn: ({ signal }) =>
      executeApiQuery(generation, routeId, input, signal),
  });
}

export function fetchApiQuery<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id> = {} as RouteInput<Id>,
): Promise<RouteOutput<Id>> {
  const generation = getSession()?.generation ?? "public";
  return queryClient.fetchQuery({
    queryKey: [generation, "v1", routeId, input],
    queryFn: ({ signal }) =>
      executeApiQuery(generation, routeId, input, signal),
    staleTime: 0,
  });
}

export function fetchApiQueryBatchAsOwner(
  owner: symbol,
  requests: readonly ApiQueryRequest[],
  options: { cancelRouteIds?: readonly RouteId[] } = {},
): Promise<void> {
  if (requests.length === 0) return Promise.resolve();
  const generation = getSession()?.generation;
  if (!generation) return Promise.reject(staleSessionError());
  const queryHashes = requests.map(({ routeId, input }) =>
    apiQueryHash(generation, routeId, input),
  );
  const conflicts = [
    ...new Set(
      queryHashes
        .map((queryHash) => ownedApiQueries.get(queryHash))
        .filter((batch): batch is OwnedApiQueryBatch => Boolean(batch)),
    ),
  ];

  const controller = new AbortController();
  let resolveTask!: () => void;
  let rejectTask!: (cause: unknown) => void;
  const task = new Promise<void>((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });
  const batch: OwnedApiQueryBatch = {
    owner,
    generation,
    controller,
    queryHashes: new Set(queryHashes),
    task,
  };
  ownedApiQueryBatches.add(batch);
  for (const queryHash of queryHashes) ownedApiQueries.set(queryHash, batch);

  const cancelRouteIds = [
    ...new Set([
      ...requests.map(({ routeId }) => routeId),
      ...(options.cancelRouteIds ?? []),
    ]),
  ];
  const cancellation = cancelApiQueries(cancelRouteIds, generation);
  void (async () => {
    await cancellation;
    if (conflicts.length > 0)
      await Promise.all(
        conflicts.map((conflict) => conflict.task.catch(() => undefined)),
      );
    throwIfAborted(controller.signal);
    assertCurrentSession(generation, true);
    const results = await Promise.all(
      requests.map(({ routeId, input }) =>
        executeApiQueryRequest(generation, routeId, input, controller.signal),
      ),
    );
    throwIfAborted(controller.signal);
    assertCurrentSession(generation, true);
    notifyManager.batch(() => {
      requests.forEach(({ routeId, input }, index) => {
        queryClient.setQueryData(
          [generation, "v1", routeId, input],
          results[index],
        );
      });
    });
  })()
    .then(resolveTask, rejectTask)
    .finally(() => {
      ownedApiQueryBatches.delete(batch);
      for (const queryHash of batch.queryHashes)
        if (ownedApiQueries.get(queryHash) === batch)
          ownedApiQueries.delete(queryHash);
    });
  return task;
}

export function cancelApiQueryOwner(owner: symbol): void {
  for (const batch of ownedApiQueryBatches)
    if (batch.owner === owner)
      batch.controller.abort(
        new DOMException("Authority query superseded", "AbortError"),
      );
}

export function getApiQueryData<Id extends RouteId>(
  generation: string,
  routeId: Id,
  input: RouteInput<Id> = {} as RouteInput<Id>,
): RouteOutput<Id> | undefined {
  return queryClient.getQueryData<RouteOutput<Id>>([
    generation,
    "v1",
    routeId,
    input,
  ]);
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

export function invalidateApiQueries(
  routeIds: readonly RouteId[],
  requestedGeneration = getSession()?.generation,
): Promise<void> {
  const generation = requestedGeneration;
  if (!generation) return Promise.resolve();
  const selected = new Set<RouteId>(routeIds);
  return queryClient.invalidateQueries(
    {
      refetchType: "active",
      predicate: (query) =>
        query.queryKey[0] === generation &&
        selected.has(query.queryKey[2] as RouteId) &&
        !isApiQuerySuppressed(generation, query.queryKey[2] as RouteId),
    },
    { cancelRefetch: false },
  );
}

export function useApiQuery<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id> = {} as RouteInput<Id>,
  requestedEnabled = true,
): UseQueryResult<RouteOutput<Id>> {
  const pageQueryActive = usePageQueryActive();
  useSyncExternalStore(
    subscribeApiQuerySuppressions,
    getApiQuerySuppressionVersion,
    getApiQuerySuppressionVersion,
  );
  const session = getSession();
  const generation = session?.generation ?? "public";
  const suppressed = isApiQuerySuppressed(generation, routeId);
  const query = useQuery({
    queryKey: [generation, "v1", routeId, input],
    queryFn: ({ signal }) =>
      executeApiQuery(generation, routeId, input, signal),
    enabled: requestedEnabled && pageQueryActive && !suppressed,
    refetchOnReconnect: false,
  });
  const queryRefetch = query.refetch;
  const refetch = useCallback<typeof query.refetch>(
    (options) => queryRefetch({ ...options, cancelRefetch: false }),
    [queryRefetch],
  );
  return { ...query, refetch } as UseQueryResult<RouteOutput<Id>>;
}

export async function refreshUserState(): Promise<void> {
  const generation = getSession()?.generation;
  if (!generation) return;
  await queryClient.invalidateQueries(
    {
      refetchType: "active",
      predicate: (query) =>
        query.queryKey[0] === generation &&
        query.queryKey[2] !== "identity.initial" &&
        !isApiQuerySuppressed(generation, query.queryKey[2] as RouteId),
    },
    { cancelRefetch: false },
  );
}

const topAssetRouteIds = ["identity.summary", "vip.get"] as const;

export async function refreshTopAssetSummary(): Promise<boolean> {
  const generation = getSession()?.generation;
  if (!generation) return false;
  await queryClient.refetchQueries(
    {
      type: "active",
      predicate: (query) =>
        query.queryKey[0] === generation &&
        !isApiQuerySuppressed(generation, query.queryKey[2] as RouteId) &&
        topAssetRouteIds.includes(
          query.queryKey[2] as (typeof topAssetRouteIds)[number],
        ),
    },
    { cancelRefetch: false },
  );
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
  const routeIds = new Set<RouteId>(["identity.summary", "vip.get"]);
  const prefixes = new Set(["wallet", ...foregroundPrefixes(pathname)]);
  for (const prefix of handledPrefixes) prefixes.delete(prefix);
  await queryClient.invalidateQueries(
    {
      refetchType: "active",
      predicate: (query) => {
        if (query.queryKey[0] !== generation) return false;
        const id = query.queryKey[2];
        return (
          typeof id === "string" &&
          !isApiQuerySuppressed(generation, id as RouteId) &&
          (routeIds.has(id as RouteId) || prefixes.has(id.split(".")[0] ?? ""))
        );
      },
    },
    { cancelRefetch: false },
  );
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

type ScopeMatcher = {
  routeIds: readonly RouteId[];
  prefixes: readonly string[];
};

const scopeMatchers: Record<
  Exclude<RefreshScope, "none" | "all">,
  ScopeMatcher
> = {
  session: {
    routeIds: ["identity.summary", "vip.get"],
    prefixes: ["wallet"],
  },
  assets: {
    routeIds: ["identity.summary"],
    prefixes: ["gacha", "wheel", "vip", "tasks", "topup", "market", "album"],
  },
  inventory: {
    routeIds: ["identity.summary"],
    prefixes: ["inventory", "market", "expedition", "mint", "album"],
  },
  payments: {
    routeIds: ["identity.summary"],
    prefixes: ["topup", "vip"],
  },
  mint: {
    routeIds: ["identity.summary"],
    prefixes: ["mint", "wallet", "inventory"],
  },
  battle: { routeIds: [], prefixes: ["battle"] },
};

export async function refreshRouteScopes(
  routeId: RecoverableRouteId | "battle.heartbeat" | "battle.offline",
  options: { throwOnError?: boolean } = {},
): Promise<void> {
  const route = await loadClientRoute(routeId);
  return refreshScopes(route.refreshScopes ?? [], options);
}

export async function refreshScopes(
  scopes: readonly RefreshScope[],
  options: { throwOnError?: boolean } = {},
): Promise<void> {
  if (scopes.includes("all")) return refreshUserState();
  const matchers = scopes.flatMap((scope) =>
    scope === "none" || scope === "all" ? [] : [scopeMatchers[scope]],
  );
  const routeIds = new Set(matchers.flatMap((matcher) => matcher.routeIds));
  const prefixes = new Set(matchers.flatMap((matcher) => matcher.prefixes));
  await queryClient.invalidateQueries(
    {
      refetchType: "active",
      predicate: (query) => {
        const generation = getSession()?.generation;
        if (!generation || query.queryKey[0] !== generation) return false;
        const id = query.queryKey[2];
        return (
          typeof id === "string" &&
          !isApiQuerySuppressed(generation, id as RouteId) &&
          (routeIds.has(id as RouteId) || prefixes.has(id.split(".")[0] ?? ""))
        );
      },
    },
    { ...options, cancelRefetch: false },
  );
}

function foregroundPrefixes(pathname: string): readonly string[] {
  if (pathname === "/") return ["gacha"];
  if (pathname === "/market") return ["market"];
  if (pathname === "/inventory") return ["inventory", "catalog"];
  if (pathname === "/tasks") return ["tasks", "referral", "wheel"];
  if (pathname === "/game") return ["battle"];
  if (pathname === "/album") return ["album"];
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

function assertApiQueryAllowed(generation: string, routeId: RouteId): void {
  if (isApiQuerySuppressed(generation, routeId))
    throw new CancelledError({ revert: true });
}

function isApiQuerySuppressed(generation: string, routeId: RouteId): boolean {
  return [...apiQuerySuppressions.values()].some(
    (suppression) =>
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

async function executeApiQuery<Id extends RouteId>(
  generation: string,
  routeId: Id,
  input: RouteInput<Id>,
  signal: AbortSignal,
): Promise<RouteOutput<Id>> {
  const queryHash = apiQueryHash(generation, routeId, input);
  let owned = ownedApiQueries.get(queryHash);
  while (owned) {
    let succeeded = true;
    try {
      await owned.task;
    } catch {
      succeeded = false;
    }
    throwIfAborted(signal);
    const route = await loadClientRoute(routeId);
    assertCurrentSession(generation, route.auth);
    const successor = ownedApiQueries.get(queryHash);
    if (successor && successor !== owned) {
      owned = successor;
      continue;
    }
    if (succeeded) {
      const data = getApiQueryData(generation, routeId, input);
      if (data !== undefined) return data;
    }
    break;
  }
  assertApiQueryAllowed(generation, routeId);
  return executeApiQueryRequest(generation, routeId, input, signal);
}

async function executeApiQueryRequest<Id extends RouteId>(
  generation: string,
  routeId: Id,
  input: RouteInput<Id>,
  signal: AbortSignal,
): Promise<RouteOutput<Id>> {
  const result = await apiRequest(routeId, input, { signal });
  const route = await loadClientRoute(routeId);
  assertCurrentSession(generation, route.auth);
  return result.data;
}

function apiQueryHash<Id extends RouteId>(
  generation: string,
  routeId: Id,
  input: RouteInput<Id>,
): string {
  return hashKey([generation, "v1", routeId, input]);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? staleSessionError();
}

function staleSessionError(): DOMException {
  return new DOMException("Stale session generation", "AbortError");
}
