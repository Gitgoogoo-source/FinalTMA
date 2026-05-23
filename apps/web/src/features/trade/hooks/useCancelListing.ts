import { useMutation, useQueryClient } from "@tanstack/react-query";

import { cancelMarketListing } from "../trade.api";
import type { CancelMarketListingInput } from "../trade.types";
import { invalidateAfterCancelListing } from "./invalidateMarketCaches";

export function useCancelListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CancelMarketListingInput) => cancelMarketListing(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async (_result, input) => {
      await invalidateAfterCancelListing(queryClient, input.listingId);
    },
  });
}
