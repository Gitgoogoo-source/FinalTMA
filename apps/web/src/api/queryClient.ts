import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { shouldRetryApiError } from "./errors";

type QueryErrorSource = {
  kind: "query" | "mutation";
  meta?: Record<string, unknown>;
};

type QueryErrorHandler = (error: unknown, source: QueryErrorSource) => void;

export function createAppQueryClient(onError?: QueryErrorHandler): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        const meta = normalizeMutationMeta(query.meta);

        if (meta?.skipGlobalErrorToast === true) {
          return;
        }

        onError?.(error, {
          kind: "query",
          ...(meta ? { meta } : {}),
        });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const meta = normalizeMutationMeta(mutation.meta);

        if (meta?.skipGlobalErrorToast === true) {
          return;
        }

        onError?.(error, {
          kind: "mutation",
          ...(meta ? { meta } : {}),
        });
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

function normalizeMutationMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }

  return meta;
}
