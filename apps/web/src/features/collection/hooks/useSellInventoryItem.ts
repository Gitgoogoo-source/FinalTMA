import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { sellInventoryItem } from "../collection.api";
import type { CollectionSellEntryInput } from "../collection.types";

export function useSellInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CollectionSellEntryInput) => sellInventoryItem(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async () => {
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
      ]);
    },
  });
}
