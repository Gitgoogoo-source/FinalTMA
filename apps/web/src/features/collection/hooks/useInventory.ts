import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchInventory } from "../collection.api";

const INVENTORY_PAGE_LIMIT = 100;

export function useInventory() {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const query = useInfiniteQuery({
    queryKey: queryKeys.inventory.list(userId),
    queryFn: ({ pageParam }) =>
      fetchInventory({
        cursor: pageParam,
        includeLocked: true,
        limit: INVENTORY_PAGE_LIMIT,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: session.isAuthenticated,
  });
  const pages = query.data?.pages ?? [];
  const lastPage = pages.at(-1) ?? null;
  const { fetchNextPage, hasNextPage, isFetching } = query;

  useEffect(() => {
    if (!hasNextPage || isFetching) {
      return;
    }

    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetching]);

  return {
    ...query,
    items: pages.flatMap((page) => page.items),
    total: lastPage?.total ?? 0,
    serverTime: lastPage?.serverTime ?? null,
  };
}
