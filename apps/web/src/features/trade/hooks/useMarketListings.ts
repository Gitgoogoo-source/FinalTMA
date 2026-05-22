import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchMarketListings } from "../trade.api";
import type { MarketListingsQuery } from "../trade.types";

export function useMarketListings(query: MarketListingsQuery = {}) {
  const session = useSession();
  const result = useQuery({
    queryKey: queryKeys.trade.listings(query),
    queryFn: () => fetchMarketListings(query),
    enabled: session.isAuthenticated,
  });

  return {
    ...result,
    listings: result.data?.items ?? [],
    nextCursor: result.data?.nextCursor ?? null,
  };
}
