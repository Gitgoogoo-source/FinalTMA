import { useMutation } from "@tanstack/react-query";

import { useGrowthInvalidation } from "@/shared/hooks/useGrowthInvalidation";

import { recordInviteShare } from "../tasks.api";
import type { InviteShareInput } from "../tasks.types";

export function useInviteShare() {
  const growthInvalidation = useGrowthInvalidation();

  return useMutation({
    mutationFn: (input: InviteShareInput) => recordInviteShare(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: () => growthInvalidation.invalidateAfterInviteShare(),
  });
}
