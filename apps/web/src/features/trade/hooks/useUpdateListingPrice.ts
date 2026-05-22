import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { updateMarketListingPrice } from "../trade.api";
import type { UpdateMarketListingPriceInput } from "../trade.types";

export function useUpdateListingPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateMarketListingPriceInput) =>
      updateMarketListingPrice(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.trade.root }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.trade.listingDetail(input.listingId),
        }),
      ]);
    },
  });
}
