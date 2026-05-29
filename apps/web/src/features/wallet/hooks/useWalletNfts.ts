import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchWalletNfts } from "../wallet.api";

type UseWalletNftsOptions = {
  enabled?: boolean;
};

export function useWalletNfts({ enabled = true }: UseWalletNftsOptions = {}) {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const result = useQuery({
    queryKey: queryKeys.wallet.nfts(userId),
    queryFn: fetchWalletNfts,
    enabled: enabled && session.isAuthenticated,
    meta: {
      skipGlobalErrorToast: true,
    },
    retry: false,
  });

  return {
    ...result,
    items: result.data?.items ?? [],
    nextCursor: result.data?.nextCursor ?? null,
    serverTime: result.data?.serverTime ?? null,
  };
}
