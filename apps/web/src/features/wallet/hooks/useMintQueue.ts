import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchWalletMintQueue } from "../wallet.api";
import type {
  WalletMintQueueResponse,
  WalletMintQueueStatus,
} from "../wallet.types";

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
    refetchInterval: (queryState) =>
      shouldPollMintQueue(queryState.state.data) ? 4000 : false,
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

const ACTIVE_MINT_STATUSES = new Set<WalletMintQueueStatus>([
  "queued",
  "processing",
  "submitted",
  "confirming",
  "retrying",
]);

function shouldPollMintQueue(
  response: WalletMintQueueResponse | undefined,
): boolean {
  if (!response) {
    return false;
  }

  if (response.items.some((item) => ACTIVE_MINT_STATUSES.has(item.status))) {
    return true;
  }

  const summary = response.summary;

  return (
    (summary.queued ?? 0) +
      (summary.processing ?? 0) +
      (summary.submitted ?? 0) +
      (summary.confirming ?? 0) +
      (summary.retrying ?? 0) >
    0
  );
}
