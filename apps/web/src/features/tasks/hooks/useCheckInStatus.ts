import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchTaskOverview } from "../tasks.api";

export function useCheckInStatus() {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const result = useQuery({
    queryKey: queryKeys.tasks.overview(userId),
    queryFn: fetchTaskOverview,
    enabled: session.isAuthenticated,
  });

  return {
    ...result,
    checkInStatus: result.data?.checkInStatus ?? null,
  };
}
