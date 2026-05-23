import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createMarketListing } from "../trade.api";
import type { CreateMarketListingInput } from "../trade.types";
import { invalidateAfterCreateListing } from "./invalidateMarketCaches";

export function useCreateListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateMarketListingInput) => createMarketListing(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async () => {
      await invalidateAfterCreateListing(queryClient);
    },
  });
}
