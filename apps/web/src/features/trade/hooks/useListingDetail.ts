import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchMarketListingDetail } from "../trade.api";

export function useListingDetail(listingId: string | null | undefined) {
  const session = useSession();
  const result = useQuery({
    queryKey: queryKeys.trade.listingDetail(listingId),
    queryFn: () => fetchMarketListingDetail(listingId ?? ""),
    enabled: session.isAuthenticated && Boolean(listingId),
  });

  return {
    ...result,
    listing: result.data?.listing ?? null,
  };
}
