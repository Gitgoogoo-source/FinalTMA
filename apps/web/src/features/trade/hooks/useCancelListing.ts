import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { cancelMarketListing } from "../trade.api";
import type { CancelMarketListingInput } from "../trade.types";

export function useCancelListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CancelMarketListingInput) => cancelMarketListing(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.trade.root }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.trade.listingDetail(input.listingId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.root }),
      ]);
    },
  });
}
