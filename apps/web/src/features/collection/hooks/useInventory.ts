import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchInventory } from "../collection.api";

export function useInventory() {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const query = useQuery({
    queryKey: queryKeys.inventory.list(userId),
    queryFn: fetchInventory,
    enabled: session.isAuthenticated,
  });

  return {
    ...query,
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    serverTime: query.data?.serverTime ?? null,
  };
}
