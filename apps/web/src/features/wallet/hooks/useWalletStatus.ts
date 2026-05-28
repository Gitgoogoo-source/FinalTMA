import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchWalletStatus } from "../wallet.api";

type UseWalletStatusOptions = {
  enabled?: boolean;
  userId?: string | null | undefined;
};

export function useWalletStatus({
  enabled = true,
  userId,
}: UseWalletStatusOptions = {}) {
  const session = useSession();
  const resolvedUserId = userId ?? session.user?.id ?? null;

  return useQuery({
    queryKey: queryKeys.wallet.status(resolvedUserId),
    queryFn: fetchWalletStatus,
    enabled: enabled && session.isAuthenticated,
    meta: {
      skipGlobalErrorToast: true,
    },
    retry: false,
  });
}
