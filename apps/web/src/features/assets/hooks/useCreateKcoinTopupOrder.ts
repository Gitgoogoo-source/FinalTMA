import { useMutation } from "@tanstack/react-query";

import { createKcoinTopupOrder } from "../kcoinTopup.api";
import type { CreateKcoinTopupOrderInput } from "../assets.types";

export function useCreateKcoinTopupOrder() {
  return useMutation({
    mutationFn: (input: CreateKcoinTopupOrderInput) =>
      createKcoinTopupOrder(input),
  });
}
