import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { disconnectWallet } from "../wallet.api";

type UseDisconnectWalletOptions = {
  userId?: string | null | undefined;
};

export function useDisconnectWallet({
  userId,
}: UseDisconnectWalletOptions = {}) {
  const session = useSession();
  const queryClient = useQueryClient();
  const resolvedUserId = userId ?? session.user?.id ?? null;

  return useMutation({
    mutationFn: disconnectWallet,
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
