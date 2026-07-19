import { useEffect } from "react";
import {
  parseRecoveredOperation,
  type RouteOutput,
  type TypedOperationSummary,
} from "@pokepets/api-contracts";

import { useOperationRegistry } from "./context.ts";

type BlockingOperation =
  RouteOutput<"identity.bootstrap">["blocking_operations"][number];

export function useBlockingOperationRecovery(
  operations: readonly BlockingOperation[] | undefined,
): void {
  const { hydrate } = useOperationRegistry();
  useEffect(() => {
    if (!operations) return;
    const parsed: TypedOperationSummary[] = [];
    for (const operation of operations) {
      try {
        parsed.push(parseRecoveredOperation(operation));
      } catch {
        continue;
      }
    }
    hydrate(parsed);
  }, [hydrate, operations]);
}
