import { useMutation } from "@tanstack/react-query";

import { useGrowthInvalidation } from "@/shared/hooks/useGrowthInvalidation";

import { claimAlbumMilestoneReward } from "../album.api";
import type { AlbumClaimRewardInput } from "../album.types";

export function useClaimAlbumReward() {
  const growthInvalidation = useGrowthInvalidation();

  return useMutation({
    mutationFn: (input: AlbumClaimRewardInput) =>
      claimAlbumMilestoneReward(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: () => growthInvalidation.invalidateAfterAlbumRewardClaim(),
  });
}
