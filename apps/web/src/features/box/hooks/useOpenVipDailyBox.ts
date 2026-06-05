import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { openVipDailyBox } from "../box.api";

export function useOpenVipDailyBox() {
  const queryClient = useQueryClient();
  const session = useSession();
  const userId = session.user?.id ?? null;

  return useMutation({
    mutationFn: openVipDailyBox,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.box.list }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.box.rewards("premium_egg"),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me.assetsRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory.root }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.vip.status(userId),
        }),
      ]);
    },
  });
}
