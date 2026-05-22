import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { createMarketListing } from "../trade.api";
import type { CreateMarketListingInput } from "../trade.types";

export function useCreateListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateMarketListingInput) => createMarketListing(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.trade.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.root }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me.assetsRoot }),
      ]);
    },
  });
}
