import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchAlbumSeries } from "../album.api";
import type { AlbumSeriesQuery } from "../album.types";

const DEFAULT_ALBUM_SERIES_QUERY: AlbumSeriesQuery = {
  limit: 50,
};

export function useAlbumSeries(
  query: AlbumSeriesQuery = DEFAULT_ALBUM_SERIES_QUERY,
) {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const result = useQuery({
    queryKey: queryKeys.album.series(userId, query),
    queryFn: () => fetchAlbumSeries(query),
    enabled: session.isAuthenticated,
  });

  return {
    ...result,
    books: result.data?.books ?? [],
    total: result.data?.total ?? 0,
    nextCursor: result.data?.nextCursor ?? null,
    serverTime: result.data?.serverTime ?? null,
  };
}
