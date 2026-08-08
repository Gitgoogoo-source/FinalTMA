import { useEffect } from "react";
import { invalidateDormantApiQueries } from "../../dormant/api.ts";
import { invalidateApiQueries } from "../../platform/query/index.ts";

export function useMintRecovery(
  pendingMints: readonly unknown[] | undefined,
): void {
  useEffect(() => {
    if (!pendingMints?.length) return;
    const refresh = () =>
      Promise.all([
        invalidateApiQueries(["identity.bootstrap", "inventory.list"]),
        invalidateDormantApiQueries(["mint.list"]),
      ]);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [pendingMints]);
}
