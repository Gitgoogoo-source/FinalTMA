import { useEffect, useEffectEvent } from "react";
import {
  parseRecoverableOperationSummary,
  type RecoverableOperationSummary,
  type RouteOutput,
} from "@evomypet/api-contracts/app-client";

import { useOperationHydrator } from "./context.ts";

type BlockingOperation =
  RouteOutput<"identity.initial">["recovery"]["blocking_operations"][number];

export function useBlockingOperationRecovery(
  operations: readonly BlockingOperation[] | undefined,
): void {
  const hydrate = useOperationHydrator();
  const hydrateRecovered = useEffectEvent(hydrate);
  useEffect(() => {
    if (!operations) return;
    const parsed: RecoverableOperationSummary[] = [];
    for (const operation of operations) {
      try {
        parsed.push(parseRecoverableOperationSummary(operation));
      } catch {
        continue;
      }
    }
    hydrateRecovered(parsed);
  }, [operations]);
}
