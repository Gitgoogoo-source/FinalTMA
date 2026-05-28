import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { createWalletMint } from "../wallet.api";
import type { CreateMintInput } from "../wallet.types";

export function useCreateMint() {
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session.user?.id ?? null;

  return useMutation({
    mutationFn: (input: CreateMintInput) => createWalletMint(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: (result, input) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.wallet.mintQueue(userId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.wallet.status(userId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.inventory.root,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.inventory.detail(userId, input.itemInstanceId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.inventory.detail(userId, result.itemInstanceId),
        }),
      ]).then(() => undefined),
  });
}
