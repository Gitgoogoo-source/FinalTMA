import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { useEffect, useRef, type ReactNode } from "react";

import { queryClient } from "../../platform/query/index.ts";
import { useSession } from "../../platform/session/store.ts";
import { NavigationIntentProvider } from "../../workflows/navigation-intent-resume/index.ts";
import { OperationRegistryProvider } from "../../workflows/operation-recovery/index.ts";

export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <OperationRegistryProvider>
        <NavigationIntentProvider>
          <BrowserRouter>
            <CacheBoundary>{children}</CacheBoundary>
          </BrowserRouter>
        </NavigationIntentProvider>
      </OperationRegistryProvider>
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
