import { useInfiniteQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchSellableItems } from "../trade.api";
import type { MarketSellableItemsQuery } from "../trade.types";

export function useSellableItems(query: MarketSellableItemsQuery = {}) {
  const session = useSession();
  const result = useInfiniteQuery({
    queryKey: queryKeys.trade.sellableItems(query),
    queryFn: ({ pageParam }) =>
      fetchSellableItems({
        ...query,
        cursor: pageParam ?? undefined,
      }),
    enabled: session.isAuthenticated,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const pages = result.data?.pages ?? [];

  return {
    ...result,
    items: pages.flatMap((page) => page.items),
    nextCursor: pages.at(-1)?.nextCursor ?? null,
  };
}
