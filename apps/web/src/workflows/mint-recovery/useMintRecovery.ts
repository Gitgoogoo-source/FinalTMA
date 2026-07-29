import { useEffect } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { invalidateApiQueries } from "../../platform/query/index.ts";

type PendingMint = RouteOutput<"identity.bootstrap">["pending_mints"][number];

export function useMintRecovery(
  pendingMints: readonly PendingMint[] | undefined,
): void {
  useEffect(() => {
    if (!pendingMints?.length) return;
    const refresh = () =>
      invalidateApiQueries([
        "identity.bootstrap",
        "mint.list",
        "inventory.list",
      ]);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [pendingMints]);
}
