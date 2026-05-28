import { useMutation } from "@tanstack/react-query";

import { requestWalletChallenge } from "../wallet.api";

export function useWalletChallenge() {
  return useMutation({
    mutationFn: requestWalletChallenge,
    meta: {
      skipGlobalErrorToast: true,
    },
  });
}
