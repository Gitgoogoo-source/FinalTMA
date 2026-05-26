import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchTaskOverview } from "../tasks.api";

export function useCommissionHistory() {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const result = useQuery({
    queryKey: queryKeys.tasks.overview(userId),
    queryFn: fetchTaskOverview,
    enabled: session.isAuthenticated,
  });

  return {
    ...result,
    commissionHistory: result.data?.commissionHistory ?? null,
    commissionStats: result.data?.commissionStats ?? null,
  };
}
