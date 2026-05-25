import { useMutation } from "@tanstack/react-query";

import { useGrowthInvalidation } from "@/shared/hooks/useGrowthInvalidation";

import { decomposeInventoryItems } from "../collection.api";
import type { CollectionDecomposeItemInput } from "../collection.types";

export function useDecomposeItem() {
  const growthInvalidation = useGrowthInvalidation();

  return useMutation({
    mutationFn: (input: CollectionDecomposeItemInput) =>
      decomposeInventoryItems(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: (result, input) =>
      growthInvalidation.invalidateAfterDecompose({
        itemInstanceIds:
          result.decomposedItemInstanceIds.length > 0
            ? result.decomposedItemInstanceIds
            : input.itemInstanceIds,
      }),
  });
}
