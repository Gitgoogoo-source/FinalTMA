import { useEffect } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { queryClient } from "../../platform/query/index.ts";
import { getSession } from "../../platform/session/store.ts";

type PendingMint = RouteOutput<"identity.bootstrap">["pending_mints"][number];

export function useMintRecovery(
  pendingMints: readonly PendingMint[] | undefined,
): void {
  useEffect(() => {
    if (!pendingMints?.length) return;
    const refresh = () =>
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === getSession()?.generation &&
          ["identity.bootstrap", "mint.list", "inventory.list"].includes(
            String(query.queryKey[2]),
          ),
      });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [pendingMints]);
}
