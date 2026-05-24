import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { evolveInventoryItems } from "../collection.api";
import type { CollectionEvolveItemInput } from "../collection.types";

export function useEvolveItem() {
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session.user?.id ?? null;

  return useMutation({
    mutationFn: (input: CollectionEvolveItemInput) =>
      evolveInventoryItems(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async (result, input) => {
      const invalidations = [
        queryClient.invalidateQueries({
          queryKey: queryKeys.inventory.root,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.me.assetsRoot,
        }),
        ...input.sourceItemInstanceIds.map((itemId) =>
          queryClient.invalidateQueries({
            queryKey: queryKeys.inventory.detail(userId, itemId),
          }),
        ),
      ];

      if (result.success) {
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: queryKeys.album.root,
          }),
        );
      }

      await Promise.all(invalidations);
    },
  });
}
