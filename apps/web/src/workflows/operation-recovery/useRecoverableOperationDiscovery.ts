import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  isRecoverableRouteId,
  loadClientRoute,
  parseRecoveredOperation,
  type RecoverableRouteId,
  type TypedOperationSummary,
} from "@evomypet/api-contracts/app-client";

import { apiRequest } from "../../platform/api/client.ts";
import { refreshScopes } from "../../platform/query/index.ts";
import { getSession, useSession } from "../../platform/session/store.ts";
import {
  subscribeTelegramActivity,
  telegram,
} from "../../platform/telegram/index.ts";
import {
  useOperationHydrator,
  useOperationRecoveryQueueActive,
} from "./context.ts";

const discoveryDelays = [1_000, 2_000, 3_000, 5_000, 30_000] as const;

export function useRecoverableOperationDiscovery(
  initialAuthorityCursor: string | undefined,
): void {
  const session = useSession();
  const surfaceActive = useRecoverySurfaceActive();
  const hydrate = useOperationHydrator();
  const recoveryQueueActive = useOperationRecoveryQueueActive();
  const hydrateRecovered = useEffectEvent(hydrate);
  const generation = session?.generation;
  const authorityCursor = useRef<{
    generation: string;
    value: string;
  } | null>(null);
  const enabled = Boolean(
    generation &&
    initialAuthorityCursor !== undefined &&
    session.accountStatus === "normal" &&
    session.entryHandoffState === "complete" &&
    surfaceActive &&
    !recoveryQueueActive,
  );

  useEffect(() => {
    if (!enabled || !generation || initialAuthorityCursor === undefined) return;
    if (authorityCursor.current?.generation !== generation)
      authorityCursor.current = {
        generation,
        value: initialAuthorityCursor,
      };
    let cancelled = false;
    let timer: number | undefined;
    let inFlight: AbortController | undefined;
    let attempt = 0;

    const discover = async () => {
      if (cancelled || getSession()?.generation !== generation) return;
      const currentAuthority = authorityCursor.current;
      if (!currentAuthority || currentAuthority.generation !== generation)
        return;
      const controller = new AbortController();
      inFlight = controller;
      try {
        const response = await apiRequest(
          "operations.recoverable",
          { after_authority_cursor: currentAuthority.value },
          { signal: controller.signal },
        );
        if (cancelled || getSession()?.generation !== generation) return;
        const recovered: TypedOperationSummary[] = [];
        for (const operation of response.data.operations) {
          try {
            recovered.push(await parseRecoveredOperation(operation));
          } catch {
            continue;
          }
        }
        hydrateRecovered(recovered);
        const authorityRoutes: RecoverableRouteId[] = [];
        for (const routeId of response.data.authority_refresh_routes) {
          if (!isRecoverableRouteId(routeId))
            throw new Error("Unsupported authority refresh route");
          if (!authorityRoutes.includes(routeId)) authorityRoutes.push(routeId);
        }
        if (authorityRoutes.length > 0) {
          attempt = 0;
          const routes = await Promise.all(
            authorityRoutes.map((routeId) => loadClientRoute(routeId)),
          );
          const scopes = [
            ...new Set(routes.flatMap((route) => route.refreshScopes ?? [])),
          ];
          await refreshScopes(scopes, { throwOnError: true });
        }
        if (cancelled || getSession()?.generation !== generation) return;
        const latestAuthority = authorityCursor.current;
        if (!latestAuthority || latestAuthority.generation !== generation)
          return;
        latestAuthority.value = response.data.next_authority_cursor;
        if (recovered.length > 0) return;
      } catch {
        if (
          cancelled ||
          controller.signal.aborted ||
          getSession()?.generation !== generation
        )
          return;
      } finally {
        if (inFlight === controller) inFlight = undefined;
      }
      const delay =
        discoveryDelays[Math.min(attempt, discoveryDelays.length - 1)] ??
        30_000;
      attempt += 1;
      timer = window.setTimeout(() => void discover(), delay);
    };

    void discover();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      inFlight?.abort();
    };
  }, [enabled, generation, initialAuthorityCursor]);
}

function useRecoverySurfaceActive(): boolean {
  const [active, setActive] = useState(
    () =>
      document.visibilityState === "visible" &&
      telegram()?.isActive !== false &&
      navigator.onLine !== false,
  );

  useEffect(() => {
    let telegramActive = telegram()?.isActive !== false;
    let online = navigator.onLine !== false;
    const publish = () =>
      setActive(
        document.visibilityState === "visible" && telegramActive && online,
      );
    const activated = () => {
      telegramActive = true;
      publish();
    };
    const deactivated = () => {
      telegramActive = false;
      publish();
    };
    const connected = () => {
      online = true;
      publish();
    };
    const disconnected = () => {
      online = false;
      publish();
    };

    document.addEventListener("visibilitychange", publish);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    const unsubscribe = subscribeTelegramActivity(activated, deactivated);
    return () => {
      document.removeEventListener("visibilitychange", publish);
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
      unsubscribe();
    };
  }, []);

  return active;
}
