import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchInventoryDetail } from "../collection.api";

export function useItemDetail(
  itemInstanceId: string | null | undefined,
  options: { enabled?: boolean } = {},
) {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const enabled =
    options.enabled !== false &&
    session.isAuthenticated &&
    Boolean(itemInstanceId);

  const query = useQuery({
    queryKey: queryKeys.inventory.detail(userId, itemInstanceId),
    queryFn: () => fetchInventoryDetail(itemInstanceId as string),
    enabled,
  });

  return {
    ...query,
    item: query.data ?? null,
  };
}
