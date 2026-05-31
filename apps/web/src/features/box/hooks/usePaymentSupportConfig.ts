import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchPaymentSupportConfig } from "../box.api";

type UsePaymentSupportConfigOptions = {
  enabled?: boolean;
};

export function usePaymentSupportConfig(
  options: UsePaymentSupportConfigOptions = {},
) {
  const query = useQuery({
    queryKey: queryKeys.paymentSupport,
    queryFn: fetchPaymentSupportConfig,
    enabled: options.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });

  return {
    ...query,
    config: query.data ?? null,
  };
}
