import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchInventoryGroupItems } from "../collection.api";

type UseInventoryGroupItemsInput = {
  enabled: boolean;
  formId: string | null;
  templateId: string | null;
};

const GROUP_ITEMS_PAGE_SIZE = 100;

export function useInventoryGroupItems(input: UseInventoryGroupItemsInput) {
  const session = useSession();
  const queryIdentity = {
    formId: input.formId,
    includeLocked: true,
    limit: GROUP_ITEMS_PAGE_SIZE,
    templateId: input.templateId,
  };
  const enabled =
    session.isAuthenticated && input.enabled && Boolean(input.templateId);
  const result = useInfiniteQuery({
    queryKey: queryKeys.inventory.groupItems(session.user?.id, queryIdentity),
    queryFn: ({ pageParam }) => {
      if (!input.templateId) {
        throw new Error("templateId is required for inventory group items.");
      }

      return fetchInventoryGroupItems({
        ...(pageParam ? { cursor: pageParam } : {}),
        formId: input.formId,
        includeLocked: true,
        limit: GROUP_ITEMS_PAGE_SIZE,
        templateId: input.templateId,
      });
    },
    enabled,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const pages = result.data?.pages ?? [];
  const nextCursor = pages.at(-1)?.nextCursor ?? null;

  useEffect(() => {
    if (!enabled || !result.hasNextPage || result.isFetchingNextPage) {
      return;
    }

    void result.fetchNextPage();
  }, [
    enabled,
    pages.length,
    result.fetchNextPage,
    result.hasNextPage,
    result.isFetchingNextPage,
  ]);

  return {
    ...result,
    items: pages.flatMap((page) => page.items),
    nextCursor,
    total: pages.at(0)?.total ?? 0,
  };
}
