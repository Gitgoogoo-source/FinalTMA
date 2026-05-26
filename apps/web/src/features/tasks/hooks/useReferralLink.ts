import { useMutation } from "@tanstack/react-query";

import { createReferralLink } from "../tasks.api";
import type { ReferralLinkInput } from "../tasks.types";

export function useReferralLink() {
  return useMutation({
    mutationFn: (input: ReferralLinkInput | undefined) =>
      createReferralLink(input),
    meta: {
      skipGlobalErrorToast: true,
    },
  });
}
