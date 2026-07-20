import { useEffect } from "react";
import {
  parseRecoverableOperationSummary,
  type RecoverableOperationSummary,
  type RouteOutput,
} from "@pokepets/api-contracts/app";

import { useOperationRegistry } from "./context.ts";

type BlockingOperation =
  RouteOutput<"identity.bootstrap">["blocking_operations"][number];

export function useBlockingOperationRecovery(
  operations: readonly BlockingOperation[] | undefined,
): void {
  const { hydrate } = useOperationRegistry();
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
    hydrate(parsed);
  }, [hydrate, operations]);
}
