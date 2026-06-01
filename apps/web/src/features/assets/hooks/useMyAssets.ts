import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import {
  createEmptyMyAssets,
  fetchMyAssets,
  normalizeBootstrapAssets,
} from "../assets.api";

export function useMyAssets() {
  const session = useSession();
  const queryClient = useQueryClient();
  const userId = session.user?.id ?? null;
  const bootstrapAssets = useMemo(
    () => normalizeBootstrapAssets(session.bootstrap, session.user),
    [session.bootstrap, session.user],
  );
  const profileFallback = bootstrapAssets?.profile ?? session.user;
  const fallbackAssets = useMemo(
    () => bootstrapAssets ?? createEmptyMyAssets(session.user),
    [bootstrapAssets, session.user],
  );
  const query = useQuery({
    queryKey: queryKeys.me.assets(userId),
    queryFn: () => fetchMyAssets(profileFallback),
    enabled: session.isAuthenticated,
    placeholderData: fallbackAssets,
  });

  const refreshAssets = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.me.assetsRoot,
    });
  }, [queryClient]);

  const data = query.data ?? fallbackAssets;

  return {
    ...query,
    data,
    profile: data.profile,
    assets: data.assets,
    wallet: data.wallet,
    refreshAssets,
  };
}
