import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

export function invalidateAfterCreateListing(
  queryClient: QueryClient,
): Promise<void> {
  return invalidateAll(queryClient, [
    queryKeys.trade.sellableItemsRoot,
    queryKeys.trade.myListingsRoot,
    queryKeys.trade.myListingStats,
    queryKeys.trade.listingsRoot,
    queryKeys.inventory.root,
  ]);
}

export function invalidateAfterBuyListing(
  queryClient: QueryClient,
  listingId: string,
): Promise<void> {
  return invalidateAll(queryClient, [
    queryKeys.me.assetsRoot,
    queryKeys.trade.listingsRoot,
    queryKeys.trade.listingDetail(listingId),
    queryKeys.inventory.root,
  ]);
}

export function invalidateAfterUpdateListingPrice(
  queryClient: QueryClient,
  listingId: string,
): Promise<void> {
  return invalidateAll(queryClient, [
    queryKeys.trade.myListingsRoot,
    queryKeys.trade.myListingStats,
    queryKeys.trade.listingsRoot,
    queryKeys.trade.listingDetail(listingId),
  ]);
}

export function invalidateAfterCancelListing(
  queryClient: QueryClient,
  listingId: string,
): Promise<void> {
  return invalidateAll(queryClient, [
    queryKeys.trade.sellableItemsRoot,
    queryKeys.trade.myListingsRoot,
    queryKeys.trade.myListingStats,
    queryKeys.trade.listingsRoot,
    queryKeys.trade.listingDetail(listingId),
    queryKeys.inventory.root,
  ]);
}

function invalidateAll(
  queryClient: QueryClient,
  queryKeyList: readonly (readonly unknown[])[],
): Promise<void> {
  return Promise.all(
    queryKeyList.map((queryKey) =>
      queryClient.invalidateQueries({
        queryKey,
      }),
    ),
  ).then(() => undefined);
}
