import { useMutation } from "@tanstack/react-query";

import { useGrowthInvalidation } from "@/shared/hooks/useGrowthInvalidation";

import { evolveInventoryItems } from "../collection.api";
import type { CollectionEvolveItemInput } from "../collection.types";

export function useEvolveItem() {
  const growthInvalidation = useGrowthInvalidation();

  return useMutation({
    mutationFn: (input: CollectionEvolveItemInput) =>
      evolveInventoryItems(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: (result, input) =>
      growthInvalidation.invalidateAfterEvolve({
        success: result.success,
        sourceItemInstanceIds:
          result.sourceItemInstanceIds.length > 0
            ? result.sourceItemInstanceIds
            : input.sourceItemInstanceIds,
        createdItemInstanceId: result.createdItemInstanceId,
        returnedItemInstanceId: result.returnedItemInstanceId,
        mainItemInstanceId: result.mainItemInstanceId,
      }),
  });
}
