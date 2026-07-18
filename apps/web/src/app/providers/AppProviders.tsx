import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";

import { queryClient } from "../../platform/query/index.ts";
import { useSession } from "../../platform/session/store.ts";
import { OperationProvider } from "../../shared/feedback/OperationProvider.tsx";

const TonProvider = lazy(() => import("../../platform/ton/TonProvider.tsx"));

export function AppProviders({ children }: { children: ReactNode }): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<main className="startup">正在准备钱包能力</main>}>
        <TonProvider>
          <OperationProvider>
            <BrowserRouter>
              <CacheBoundary>{children}</CacheBoundary>
            </BrowserRouter>
          </OperationProvider>
        </TonProvider>
      </Suspense>
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
