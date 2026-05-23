import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateMarketListingPrice } from "../trade.api";
import type { UpdateMarketListingPriceInput } from "../trade.types";
import { invalidateAfterUpdateListingPrice } from "./invalidateMarketCaches";

export function useUpdateListingPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateMarketListingPriceInput) =>
      updateMarketListingPrice(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async (_result, input) => {
      await invalidateAfterUpdateListingPrice(queryClient, input.listingId);
    },
  });
}
