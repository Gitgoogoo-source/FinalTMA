import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchInventorySummary } from "../collection.api";

export function useInventory() {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const query = useQuery({
    queryKey: queryKeys.inventory.summary(userId),
    queryFn: () =>
      fetchInventorySummary({
        includeLocked: true,
      }),
    enabled: session.isAuthenticated,
  });
  const groups = query.data?.groups ?? [];

  return {
    ...query,
    groups,
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    groupTotal: query.data?.groupTotal ?? groups.length,
    summary: query.data?.summary ?? null,
    serverTime: query.data?.serverTime ?? null,
  };
}
