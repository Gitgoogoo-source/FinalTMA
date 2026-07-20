import { useEffect } from "react";
import {
  parseRecoverableOperationSummary,
  type RecoverableOperationSummary,
} from "@pokepets/api-contracts/app";

import { apiRequest } from "../../platform/api/client.ts";
import { getSession, useSession } from "../../platform/session/store.ts";
import { useOperationRegistry } from "./context.ts";

const discoveryDelays = [1_000, 2_000, 3_000, 5_000, 30_000] as const;

export function useGachaResultRecovery(): void {
  useResultRecovery("gacha.recovery");
}

export function useWheelResultRecovery(): void {
  useResultRecovery("wheel.recovery");
}

function useResultRecovery(routeId: "gacha.recovery" | "wheel.recovery"): void {
  const session = useSession();
  const { hydrate } = useOperationRegistry();
  useEffect(() => {
    const generation = session?.generation;
    if (
      !generation ||
      session.accountStatus !== "normal" ||
      session.entryHandoffState !== "complete"
    )
      return;
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;
    const discover = async () => {
      if (cancelled || getSession()?.generation !== generation) return;
      try {
        const response = await apiRequest(routeId, {});
        if (cancelled || getSession()?.generation !== generation) return;
        const recovered: RecoverableOperationSummary[] = [];
        for (const operation of response.data.operations) {
          try {
            recovered.push(parseRecoverableOperationSummary(operation));
          } catch {
            continue;
          }
        }
        hydrate(recovered);
        if (recovered.length > 0) return;
      } catch {
        if (cancelled || getSession()?.generation !== generation) return;
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
    };
  }, [hydrate, routeId, session]);
}
