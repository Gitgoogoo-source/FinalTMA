import { useMutation } from "@tanstack/react-query";

import { createPreparedShareMessage } from "../tasks.api";
import type { PreparedShareMessageInput } from "../tasks.types";

export function usePreparedShareMessage() {
  return useMutation({
    mutationFn: (input: PreparedShareMessageInput) =>
      createPreparedShareMessage(input),
    meta: {
      skipGlobalErrorToast: true,
    },
  });
}
