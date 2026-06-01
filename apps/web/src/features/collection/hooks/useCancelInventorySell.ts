import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { cancelInventorySell } from "../collection.api";
import type { CollectionCancelSellInput } from "../collection.types";

export function useCancelInventorySell() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CollectionCancelSellInput) =>
      cancelInventorySell(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.root }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.trade.sellableItemsRoot,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.trade.myListingsRoot,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.trade.myListingStats,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.trade.listingsRoot,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.trade.listingDetail(result.listingId),
        }),
      ]);
    },
  });
}
