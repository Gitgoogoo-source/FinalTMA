import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { syncWalletNfts } from "../wallet.api";

export function useSyncWalletNfts() {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: syncWalletNfts,
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.wallet.status(userId),
      });
    },
  });
}
