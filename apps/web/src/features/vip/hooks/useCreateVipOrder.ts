import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { createVipOrder } from "../vip.api";
import type { CreateVipOrderInput } from "../vip.types";

export function useCreateVipOrder() {
  const queryClient = useQueryClient();
  const session = useSession();

  return useMutation({
    mutationFn: (input: CreateVipOrderInput) => createVipOrder(input),
    meta: {
      skipGlobalErrorToast: true,
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.vip.status(session.user?.id ?? null),
      });
    },
  });
}
