import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchBoxes } from "../box.api";

export function useBoxes() {
  const query = useQuery({
    queryKey: queryKeys.box.list,
    queryFn: fetchBoxes,
  });

  return {
    ...query,
    boxes: query.data?.items ?? [],
    serverTime: query.data?.serverTime ?? null,
  };
}
