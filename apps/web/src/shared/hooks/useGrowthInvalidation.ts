import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

type QueryKey = readonly unknown[];

type UpgradeInvalidationInput = {
  itemInstanceId: string;
};

type EvolveInvalidationInput = {
  success: boolean;
  sourceItemInstanceIds: string[];
  createdItemInstanceId?: string | null;
  returnedItemInstanceId?: string | null;
  mainItemInstanceId?: string | null;
};

type DecomposeInvalidationInput = {
  itemInstanceIds: string[];
};

export function useGrowthInvalidation() {
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session.user?.id ?? null;

  const invalidateAll = useCallback(
    (queryKeyList: QueryKey[]) =>
      Promise.all(
        queryKeyList.map((queryKey) =>
          queryClient.invalidateQueries({
            queryKey,
          }),
        ),
      ).then(() => undefined),
    [queryClient],
  );

  const inventoryDetailKeys = useCallback(
    (itemIds: Array<string | null | undefined>) =>
      uniqueStrings(itemIds).map((itemId) =>
        queryKeys.inventory.detail(userId, itemId),
      ),
    [userId],
  );

  const invalidateAfterUpgrade = useCallback(
    (input: UpgradeInvalidationInput) =>
      invalidateAll([
        queryKeys.inventory.root,
        queryKeys.inventory.detail(userId, input.itemInstanceId),
        queryKeys.me.assetsRoot,
      ]),
    [invalidateAll, userId],
  );

  const invalidateAfterEvolve = useCallback(
    (input: EvolveInvalidationInput) => {
      const queryKeyList: QueryKey[] = [
        queryKeys.inventory.root,
        queryKeys.me.assetsRoot,
        ...inventoryDetailKeys([
          ...input.sourceItemInstanceIds,
          input.createdItemInstanceId,
          input.returnedItemInstanceId,
          input.mainItemInstanceId,
        ]),
      ];

      if (input.success) {
        queryKeyList.push(
          queryKeys.album.root,
          queryKeys.album.leaderboardRoot,
        );
      }

      return invalidateAll(queryKeyList);
    },
    [invalidateAll, inventoryDetailKeys],
  );

  const invalidateAfterDecompose = useCallback(
    (input: DecomposeInvalidationInput) =>
      invalidateAll([
        queryKeys.inventory.root,
        queryKeys.me.assetsRoot,
        ...inventoryDetailKeys(input.itemInstanceIds),
      ]),
    [invalidateAll, inventoryDetailKeys],
  );

  const invalidateAfterAlbumRewardClaim = useCallback(
    () => invalidateAll([queryKeys.album.root, queryKeys.me.assetsRoot]),
    [invalidateAll],
  );

  return {
    invalidateAfterAlbumRewardClaim,
    invalidateAfterDecompose,
    invalidateAfterEvolve,
    invalidateAfterUpgrade,
  };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}
