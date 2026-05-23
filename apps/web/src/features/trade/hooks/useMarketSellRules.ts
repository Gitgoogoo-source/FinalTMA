import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchMarketSellRules } from "../trade.api";

export function useMarketSellRules() {
  const session = useSession();
  const result = useQuery({
    queryKey: queryKeys.trade.sellRules,
    queryFn: fetchMarketSellRules,
    enabled: session.isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  return {
    ...result,
    rules: result.data ?? null,
  };
}
