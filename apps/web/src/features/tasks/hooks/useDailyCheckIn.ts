import { useMutation } from "@tanstack/react-query";

import { useGrowthInvalidation } from "@/shared/hooks/useGrowthInvalidation";

import { dailyCheckIn } from "../tasks.api";
import type { DailyCheckInInput } from "../tasks.types";

export function useDailyCheckIn() {
  const growthInvalidation = useGrowthInvalidation();

  return useMutation({
    mutationFn: (input: DailyCheckInInput | undefined) => dailyCheckIn(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: () => growthInvalidation.invalidateAfterDailyCheckIn(),
  });
}
