import { useMutation } from "@tanstack/react-query";

import { useGrowthInvalidation } from "@/shared/hooks/useGrowthInvalidation";

import { claimCommission } from "../tasks.api";
import type { ClaimCommissionInput } from "../tasks.types";

export function useClaimCommission() {
  const growthInvalidation = useGrowthInvalidation();

  return useMutation({
    mutationFn: (input: ClaimCommissionInput | undefined) =>
      claimCommission(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: () => growthInvalidation.invalidateAfterCommissionClaim(),
  });
}
