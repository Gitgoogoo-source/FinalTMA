import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { upgradeInventoryItem } from "../collection.api";
import type { CollectionUpgradeItemInput } from "../collection.types";

export function useUpgradeItem() {
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session.user?.id ?? null;

  return useMutation({
    mutationFn: (input: CollectionUpgradeItemInput) =>
      upgradeInventoryItem(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.inventory.root,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.inventory.detail(userId, input.itemInstanceId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.me.assetsRoot,
        }),
      ]);
    },
  });
}
