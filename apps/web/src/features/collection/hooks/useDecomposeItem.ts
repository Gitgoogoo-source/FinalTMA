import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { decomposeInventoryItems } from "../collection.api";
import type { CollectionDecomposeItemInput } from "../collection.types";

export function useDecomposeItem() {
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session.user?.id ?? null;

  return useMutation({
    mutationFn: (input: CollectionDecomposeItemInput) =>
      decomposeInventoryItems(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.inventory.root,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.me.assetsRoot,
        }),
        ...input.itemInstanceIds.map((itemId) =>
          queryClient.invalidateQueries({
            queryKey: queryKeys.inventory.detail(userId, itemId),
          }),
        ),
      ]);
    },
  });
}
