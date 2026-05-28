import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchDrawResult } from "../box.api";
import { shouldPollDrawResultStatus } from "../box.status";
import type { DrawResultResponse } from "../box.types";

type UseDrawResultOptions = {
  enabled?: boolean;
  onCompleted?: (result: DrawResultResponse) => void;
};

export function useDrawResult(
  orderId: string | null | undefined,
  options: boolean | UseDrawResultOptions = true,
) {
  const queryClient = useQueryClient();
  const completedOrderRef = useRef<string | null>(null);
  const enabled = typeof options === "boolean" ? options : options.enabled;
  const onCompleted =
    typeof options === "boolean" ? undefined : options.onCompleted;
  const query = useQuery({
    queryKey: queryKeys.box.result(orderId),
    queryFn: () => fetchDrawResult(orderId ?? ""),
    enabled: Boolean(orderId) && (enabled ?? true),
    refetchInterval: (queryState) =>
      shouldPollDrawResultStatus(queryState.state.data) ? 2000 : false,
  });

  useEffect(() => {
    if (!orderId) {
      completedOrderRef.current = null;
    }
  }, [orderId]);

  useEffect(() => {
    const result = query.data;

    if (!result || result.status !== "completed") {
      return;
    }

    if (completedOrderRef.current === result.orderId) {
      return;
    }

    completedOrderRef.current = result.orderId;
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.assetsRoot });
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.root });
    void queryClient.invalidateQueries({ queryKey: queryKeys.box.root });
    onCompleted?.(result);
  }, [onCompleted, query.data, queryClient]);

  return {
    ...query,
    result: query.data ?? null,
    items: query.data?.results ?? [],
  };
}
