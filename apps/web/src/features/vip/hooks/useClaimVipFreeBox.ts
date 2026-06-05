import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { claimVipFreeBox } from "../vip.api";
import type { ClaimVipFreeBoxInput } from "../vip.types";

export function useClaimVipFreeBox() {
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session.user?.id ?? null;

  return useMutation({
    mutationFn: (input?: ClaimVipFreeBoxInput) => claimVipFreeBox(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.vip.status(userId),
      });
    },
  });
}
