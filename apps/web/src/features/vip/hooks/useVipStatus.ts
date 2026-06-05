import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchVipStatus } from "../vip.api";

export function useVipStatus() {
  const session = useSession();

  return useQuery({
    queryKey: queryKeys.vip.status(session.user?.id ?? null),
    queryFn: fetchVipStatus,
    enabled: session.isAuthenticated,
  });
}
