import { useEffect, useMemo, useState, type ReactNode } from "react";

import { registerSensitiveStateResetter } from "../../platform/session/store.ts";

import {
  NavigationIntentContext,
  type GachaResumeAuthorization,
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
  const [gachaResume, setGachaResume] =
    useState<GachaResumeAuthorization | null>(null);
  useEffect(
    () =>
      registerSensitiveStateResetter(() => {
        setTopupRequest(null);
        setGachaResume(null);
      }),
    [],
  );
  const value = useMemo<NavigationIntentValue>(
    () => ({
      topupRequest,
      gachaResume,
      requestTopup: (intent: NavigationIntent, estimatedGap: number) => {
        setGachaResume(null);
        setTopupRequest({
          intent,
          estimatedGap: Math.max(1, Math.ceil(estimatedGap)),
          orderId: null,
        });
      },
      bindTopupOrder: (orderId: string) =>
        setTopupRequest((request) =>
          request ? { ...request, orderId } : request,
        ),
      activateGachaResume: (resume: GachaResumeAuthorization) =>
        setGachaResume(resume),
      clearGachaResume: () => setGachaResume(null),
      clearTopupRequest: () => setTopupRequest(null),
    }),
    [gachaResume, topupRequest],
  );
  return (
    <NavigationIntentContext.Provider value={value}>
      {children}
    </NavigationIntentContext.Provider>
  );
}
