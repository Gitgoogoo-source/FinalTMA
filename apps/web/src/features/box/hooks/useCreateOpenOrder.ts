import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { createOpenOrder } from "../box.api";
import type { CreateOpenOrderInput } from "../box.types";

export function useCreateOpenOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateOpenOrderInput) => createOpenOrder(input),
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.box.list }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.box.rewards(input.boxId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me.assetsRoot }),
      ]);
    },
  });
}
