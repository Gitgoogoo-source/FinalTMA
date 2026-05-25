import { useMutation } from "@tanstack/react-query";

import { useGrowthInvalidation } from "@/shared/hooks/useGrowthInvalidation";

import { upgradeInventoryItem } from "../collection.api";
import type { CollectionUpgradeItemInput } from "../collection.types";

export function useUpgradeItem() {
  const growthInvalidation = useGrowthInvalidation();

  return useMutation({
    mutationFn: (input: CollectionUpgradeItemInput) =>
      upgradeInventoryItem(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: (_result, input) =>
      growthInvalidation.invalidateAfterUpgrade({
        itemInstanceId: input.itemInstanceId,
      }),
  });
}
