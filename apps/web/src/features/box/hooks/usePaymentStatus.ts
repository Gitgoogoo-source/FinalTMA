import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchPaymentStatus } from "../box.api";
import { shouldPollDrawResultStatus } from "../box.status";

type UsePaymentStatusOptions = {
  enabled?: boolean;
};

export function usePaymentStatus(
  orderId: string | null | undefined,
  options: UsePaymentStatusOptions = {},
) {
  const query = useQuery({
    queryKey: queryKeys.box.paymentStatus(orderId),
    queryFn: () => fetchPaymentStatus(orderId ?? ""),
    enabled: Boolean(orderId) && (options.enabled ?? true),
    refetchInterval: (queryState) =>
      shouldPollDrawResultStatus(queryState.state.data) ? 2000 : false,
  });

  return {
    ...query,
    result: query.data ?? null,
  };
}
