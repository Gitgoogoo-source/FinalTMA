import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import {
  createEmptyMyAssets,
  normalizeBootstrapAssets,
} from "@/features/assets/assets.api";
import type { MyAssets } from "@/features/assets/assets.types";
import { queryKeys } from "@/shared/constants/queryKeys";

import { buyMarketListing } from "../trade.api";
import type {
  BuyMarketListingInput,
  BuyMarketListingResponse,
} from "../trade.types";
import { invalidateAfterBuyListing } from "./invalidateMarketCaches";

export function useBuyListing() {
  const queryClient = useQueryClient();
  const session = useSession();

  return useMutation({
    mutationFn: (input: BuyMarketListingInput) => buyMarketListing(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async (result, input) => {
      applyBuyerBalanceAfter(queryClient, result, {
        fallbackAssets: buildFallbackAssets(session),
        userId: session.user?.id ?? null,
      });
      await invalidateAfterBuyListing(queryClient, input.listingId);
      applyBuyerBalanceAfter(queryClient, result, {
        fallbackAssets: buildFallbackAssets(session),
        userId: session.user?.id ?? null,
      });
    },
  });
}

function applyBuyerBalanceAfter(
  queryClient: QueryClient,
  result: BuyMarketListingResponse,
  options: {
    fallbackAssets: MyAssets;
    userId: string | null;
  },
): void {
  const updateAssets = (current: MyAssets | undefined): MyAssets => {
    const base = current ?? options.fallbackAssets;
    const kcoin = {
      ...base.balances.KCOIN,
      available: String(Math.max(Math.trunc(result.buyerBalanceAfter), 0)),
    };
    const balances = {
      ...base.balances,
      KCOIN: kcoin,
    };

    return {
      ...base,
      balances,
      assets: {
        ...base.assets,
        kcoin,
      },
    };
  };

  queryClient.setQueryData<MyAssets>(
    queryKeys.me.assets(options.userId),
    updateAssets,
  );
  queryClient.setQueriesData<MyAssets>(
    {
      queryKey: queryKeys.me.assetsRoot,
    },
    updateAssets,
  );
}

function buildFallbackAssets(session: ReturnType<typeof useSession>): MyAssets {
  return (
    normalizeBootstrapAssets(session.bootstrap, session.user) ??
    createEmptyMyAssets(session.user)
  );
}
