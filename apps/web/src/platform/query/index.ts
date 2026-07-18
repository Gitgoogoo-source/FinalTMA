import { QueryClient, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RouteId, RouteInput, RouteOutput } from "@pokepets/contracts";

import { apiRequest } from "../api/client.ts";
import { getSession, registerSessionCacheClearer } from "../session/store.ts";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 20_000, refetchOnWindowFocus: false }, mutations: { retry: false } },
});
registerSessionCacheClearer(() => queryClient.clear());

export function useApiQuery<Id extends RouteId>(
  routeId: Id,
  input: RouteInput<Id> = {} as RouteInput<Id>,
  enabled = true,
): UseQueryResult<RouteOutput<Id>> {
  const session = getSession();
  return useQuery({
    queryKey: [session?.generation ?? "public", "v1", routeId, input],
    queryFn: async ({ signal }) => (await apiRequest(routeId, input, { signal })).data,
    enabled,
  });
}

export async function refreshUserState(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: [getSession()?.generation] });
}
