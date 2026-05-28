import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { verifyWalletProof } from "../wallet.api";

type UseVerifyTonProofOptions = {
  userId?: string | null | undefined;
};

export function useVerifyTonProof({ userId }: UseVerifyTonProofOptions = {}) {
  const session = useSession();
  const queryClient = useQueryClient();
  const resolvedUserId = userId ?? session.user?.id ?? null;

  return useMutation({
    mutationFn: verifyWalletProof,
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.wallet.status(resolvedUserId),
      });
    },
  });
}
