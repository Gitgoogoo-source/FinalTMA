import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { claimVipDailyBenefit } from "../vip.api";
import type { ClaimVipDailyBenefitInput } from "../vip.types";

export function useClaimVipDailyBenefit() {
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session.user?.id ?? null;

  return useMutation({
    mutationFn: (input?: ClaimVipDailyBenefitInput) =>
      claimVipDailyBenefit(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.vip.status(userId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me.assetsRoot }),
      ]);
    },
  });
}
