import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";

import { AppNavigationProvider } from "../../platform/navigation/index.tsx";
import { queryClient } from "../../platform/query/index.ts";
import { useSession } from "../../platform/session/store.ts";

export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <AppNavigationProvider>
        <CacheBoundary>{children}</CacheBoundary>
      </AppNavigationProvider>
    </QueryClientProvider>
  );
}

function CacheBoundary({ children }: { children: ReactNode }): ReactNode {
  const session = useSession();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current && previous.current !== session?.token)
      queryClient.clear();
    previous.current = session?.token ?? null;
  }, [session?.token]);
  return children;
}
