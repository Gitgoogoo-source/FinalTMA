import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { shouldRetryApiError } from "./errors";

type QueryErrorHandler = (error: unknown) => void;

export function createAppQueryClient(onError?: QueryErrorHandler): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        onError?.(error);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        onError?.(error);
      },
    }),
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          failureCount < 1 && shouldRetryApiError(error),
        refetchOnWindowFocus: false,
        staleTime: 15_000,
        gcTime: 5 * 60_000,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export const queryClient = createAppQueryClient();
