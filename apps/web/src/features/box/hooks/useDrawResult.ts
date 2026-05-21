import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchDrawResult } from "../box.api";

export function useDrawResult(
  orderId: string | null | undefined,
  enabled = true,
) {
  const query = useQuery({
    queryKey: queryKeys.box.result(orderId),
    queryFn: () => fetchDrawResult(orderId ?? ""),
    enabled: Boolean(orderId) && enabled,
    refetchInterval: (queryState) =>
      queryState.state.data?.status === "pending" ? 2000 : false,
  });

  return {
    ...query,
    result: query.data ?? null,
    items: query.data?.results ?? [],
  };
}
