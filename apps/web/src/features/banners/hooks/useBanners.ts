import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchBanners } from "../banners.api";
import type { BannerPlacement } from "../banners.types";

export function useBanners(placement: BannerPlacement) {
  const session = useSession();
  const query = useQuery({
    queryKey: queryKeys.banners.placement(placement),
    queryFn: () => fetchBanners(placement),
    enabled: session.isAuthenticated,
  });

  return {
    ...query,
    banners: query.data?.items ?? [],
    primaryBanner: query.data?.items[0] ?? null,
    serverTime: query.data?.serverTime ?? null,
  };
}
