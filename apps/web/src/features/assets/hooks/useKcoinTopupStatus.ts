import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchKcoinTopupStatus } from "../kcoinTopup.api";
import type { KcoinTopupPaymentStatus } from "../assets.types";

type UseKcoinTopupStatusOptions = {
  enabled?: boolean;
};

const TERMINAL_TOPUP_STATUSES = new Set<KcoinTopupPaymentStatus>([
  "fulfilled",
  "failed",
  "refunded",
  "disputed",
  "expired",
]);

export function useKcoinTopupStatus(
  orderId: string | null,
  options: UseKcoinTopupStatusOptions = {},
) {
  const session = useSession();
  const enabled =
    session.isAuthenticated && Boolean(orderId) && (options.enabled ?? true);
  const query = useQuery({
    queryKey: queryKeys.payments.kcoinTopupStatus(orderId),
    queryFn: () => fetchKcoinTopupStatus(orderId ?? ""),
    enabled,
    refetchInterval: (queryState) => {
      const status = queryState.state.data?.paymentOrderStatus;

      if (!status || TERMINAL_TOPUP_STATUSES.has(status)) {
        return false;
      }

      return 1800;
    },
  });

  return {
    ...query,
    statusSnapshot: query.data ?? null,
  };
}
