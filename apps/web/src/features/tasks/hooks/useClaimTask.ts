import { useMutation } from "@tanstack/react-query";

import { useGrowthInvalidation } from "@/shared/hooks/useGrowthInvalidation";

import { claimTaskReward } from "../tasks.api";
import type { ClaimTaskInput } from "../tasks.types";

export function useClaimTask() {
  const growthInvalidation = useGrowthInvalidation();

  return useMutation({
    mutationFn: (input: ClaimTaskInput) => claimTaskReward(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: () => growthInvalidation.invalidateAfterTaskRewardClaim(),
  });
}
