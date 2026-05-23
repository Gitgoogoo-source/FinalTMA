import { useMutation, useQueryClient } from "@tanstack/react-query";

import { buyMarketListing } from "../trade.api";
import type { BuyMarketListingInput } from "../trade.types";
import { invalidateAfterBuyListing } from "./invalidateMarketCaches";

export function useBuyListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: BuyMarketListingInput) => buyMarketListing(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async (_result, input) => {
      await invalidateAfterBuyListing(queryClient, input.listingId);
    },
  });
}
