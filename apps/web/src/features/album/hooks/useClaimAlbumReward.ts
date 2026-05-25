import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { claimAlbumMilestoneReward } from "../album.api";
import type { AlbumClaimRewardInput } from "../album.types";

export function useClaimAlbumReward() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AlbumClaimRewardInput) =>
      claimAlbumMilestoneReward(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.album.root,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.me.assetsRoot,
        }),
      ]);
    },
  });
}
