import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchAlbumLeaderboard } from "../album.api";
import type { AlbumLeaderboardQuery } from "../album.types";

const DEFAULT_LEADERBOARD_QUERY: AlbumLeaderboardQuery = {
  period: "current_week",
  scope: "global",
  sort: "score_desc",
  limit: 50,
};

export function useLeaderboard(
  query: AlbumLeaderboardQuery = DEFAULT_LEADERBOARD_QUERY,
) {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const result = useQuery({
    queryKey: queryKeys.album.leaderboard(userId, query),
    queryFn: () => fetchAlbumLeaderboard(query),
    enabled: session.isAuthenticated,
  });

  return {
    ...result,
    leaderboard: result.data ?? null,
    entries: result.data?.entries ?? [],
    myEntry: result.data?.myEntry ?? null,
    generatedAt: result.data?.generatedAt ?? null,
    nextCursor: result.data?.nextCursor ?? null,
  };
}
