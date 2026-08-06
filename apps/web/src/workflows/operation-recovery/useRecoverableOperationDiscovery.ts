import { useEffect, useState } from "react";
import {
  parseRecoveredOperation,
  type TypedOperationSummary,
} from "@pokepets/api-contracts/app";

import { apiRequest } from "../../platform/api/client.ts";
import { getSession, useSession } from "../../platform/session/store.ts";
import {
  subscribeTelegramActivity,
  telegram,
} from "../../platform/telegram/index.ts";
import { useOperationRegistry } from "./context.ts";

const discoveryDelays = [1_000, 2_000, 3_000, 5_000, 30_000] as const;

export function useRecoverableOperationDiscovery(): void {
  const session = useSession();
  const surfaceActive = useRecoverySurfaceActive();
  const { hydrate, resultRecoveryActive } = useOperationRegistry();
  const generation = session?.generation;
  const enabled = Boolean(
    generation &&
    session.accountStatus === "normal" &&
    session.entryHandoffState === "complete" &&
    surfaceActive &&
    !resultRecoveryActive,
  );

  useEffect(() => {
    if (!enabled || !generation) return;
    let cancelled = false;
    let timer: number | undefined;
    let inFlight: AbortController | undefined;
    let attempt = 0;

    const discover = async () => {
      if (cancelled || getSession()?.generation !== generation) return;
      const controller = new AbortController();
      inFlight = controller;
      try {
        const response = await apiRequest(
          "operations.recoverable",
          {},
          { signal: controller.signal },
        );
        if (cancelled || getSession()?.generation !== generation) return;
        const recovered: TypedOperationSummary[] = [];
        for (const operation of response.data.operations) {
          try {
            recovered.push(parseRecoveredOperation(operation));
          } catch {
            continue;
          }
        }
        hydrate(recovered);
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
  }, [enabled, generation, hydrate]);
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
