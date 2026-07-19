import { useMemo, useState, type ReactNode } from "react";

import {
  NavigationIntentContext,
  type NavigationIntent,
  type NavigationIntentValue,
  type TopupRequest,
} from "./context.ts";

export function NavigationIntentProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [topupRequest, setTopupRequest] = useState<TopupRequest | null>(null);
  const value = useMemo<NavigationIntentValue>(
    () => ({
      topupRequest,
      requestTopup: (intent: NavigationIntent, estimatedGap: number) =>
        setTopupRequest({
          intent,
          estimatedGap: Math.max(1, Math.ceil(estimatedGap)),
        }),
      clearTopupRequest: () => setTopupRequest(null),
    }),
    [topupRequest],
  );
  return (
    <NavigationIntentContext.Provider value={value}>
      {children}
    </NavigationIntentContext.Provider>
  );
}
