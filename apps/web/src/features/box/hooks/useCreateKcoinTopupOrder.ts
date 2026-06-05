import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/shared/constants/queryKeys";

import { createKcoinTopupOrder } from "../box.api";
import type { CreateKcoinTopupOrderInput } from "../box.types";

export function useCreateKcoinTopupOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateKcoinTopupOrderInput) =>
      createKcoinTopupOrder(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.me.assetsRoot,
      });
    },
  });
}
