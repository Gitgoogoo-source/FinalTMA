import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchMyListingStats, fetchMyListings } from "../trade.api";
import type { MarketMyListingsQuery } from "../trade.types";

export function useMyListings(query: MarketMyListingsQuery = {}) {
  const session = useSession();
  const result = useQuery({
    queryKey: queryKeys.trade.myListings(query),
    queryFn: () => fetchMyListings(query),
    enabled: session.isAuthenticated,
  });

  return {
    ...result,
    listings: result.data?.items ?? [],
    nextCursor: result.data?.nextCursor ?? null,
  };
}

export function useMyListingStats() {
  const session = useSession();
  const result = useQuery({
    queryKey: queryKeys.trade.myListingStats,
    queryFn: fetchMyListingStats,
    enabled: session.isAuthenticated,
  });

  return {
    ...result,
    stats: result.data ?? {
      activeCount: 0,
      activeListingCount: 0,
      activeItemCount: 0,
      totalListingValueKcoin: 0,
      expectedNetAmountKcoin: 0,
      sold24hCount: 0,
      sold24hValueKcoin: 0,
    },
  };
}
