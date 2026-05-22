import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchSellableItems } from "../trade.api";
import type { MarketSellableItemsQuery } from "../trade.types";

export function useSellableItems(query: MarketSellableItemsQuery = {}) {
  const session = useSession();
  const result = useQuery({
    queryKey: queryKeys.trade.sellableItems(query),
    queryFn: () => fetchSellableItems(query),
    enabled: session.isAuthenticated,
  });

  return {
    ...result,
    items: result.data?.items ?? [],
    nextCursor: result.data?.nextCursor ?? null,
  };
}
