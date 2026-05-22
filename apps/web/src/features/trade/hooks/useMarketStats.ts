import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchMarketStats } from "../trade.api";
import type { MarketStatsQuery } from "../trade.types";

export function useMarketStats(query: MarketStatsQuery | null | undefined) {
  const session = useSession();
  const hasScope = Boolean(
    query?.templateId || query?.seriesId || query?.rarity || query?.typeCode,
  );
  const result = useQuery({
    queryKey: queryKeys.trade.stats(query ?? {}),
    queryFn: () => fetchMarketStats(query ?? {}),
    enabled: session.isAuthenticated && hasScope,
  });

  return {
    ...result,
    price: result.data?.price ?? null,
    depth: result.data?.depth ?? [],
    priceHealth: result.data?.priceHealth ?? "unknown",
  };
}
