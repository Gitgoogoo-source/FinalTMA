import {
  QueryClient,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";

import { apiRequest } from "../api/client.ts";
import { getSession, registerSessionCacheClearer } from "../session/store.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 20_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
registerSessionCacheClearer(() => queryClient.clear());

export function useApiQuery<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  routeId: string,
  input: Record<string, unknown> = {},
  enabled = true,
): UseQueryResult<T> {
  return useQuery({
    queryKey: [getSession()?.userId ?? "public", routeId, input],
    queryFn: async ({ signal }) =>
      (await apiRequest<T>(routeId, input, { signal })).data,
    enabled,
  });
}

export async function refreshUserState(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: [getSession()?.userId] });
}
