import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { buyMarketListing } from "../trade.api";
import type { BuyMarketListingInput } from "../trade.types";

export function useBuyListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: BuyMarketListingInput) => buyMarketListing(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.trade.root }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.trade.listingDetail(input.listingId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me.assetsRoot }),
      ]);
    },
  });
}
