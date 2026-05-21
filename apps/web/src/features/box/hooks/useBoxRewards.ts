import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchBoxRewards } from "../box.api";

export function useBoxRewards(boxId: string | null | undefined) {
  const query = useQuery({
    queryKey: queryKeys.box.rewards(boxId),
    queryFn: () => fetchBoxRewards(boxId ?? ""),
    enabled: Boolean(boxId),
  });

  return {
    ...query,
    rewards: query.data?.items ?? [],
    poolVersionId: query.data?.poolVersionId ?? null,
    pityRule: query.data?.pityRule ?? null,
  };
}
