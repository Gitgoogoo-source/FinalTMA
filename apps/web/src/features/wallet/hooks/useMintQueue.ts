import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchWalletMintQueue } from "../wallet.api";

type UseMintQueueOptions = {
  enabled?: boolean;
};

export function useMintQueue({ enabled = true }: UseMintQueueOptions = {}) {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const result = useQuery({
    queryKey: queryKeys.wallet.mintQueue(userId),
    queryFn: fetchWalletMintQueue,
    enabled: enabled && session.isAuthenticated,
    retry: false,
  });

  return {
    ...result,
    mintQueue: result.data?.summary ?? null,
    items: result.data?.items ?? [],
    nextCursor: result.data?.nextCursor ?? null,
    serverTime: result.data?.serverTime ?? null,
  };
}
