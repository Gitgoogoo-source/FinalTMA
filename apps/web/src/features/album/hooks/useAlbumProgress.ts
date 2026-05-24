import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchAlbumProgress } from "../album.api";
import type { AlbumProgressQuery } from "../album.types";

const DEFAULT_ALBUM_PROGRESS_QUERY: AlbumProgressQuery = {
  includeItems: true,
  includeMilestones: true,
  includeRewards: true,
  includeLockedItems: true,
};

export function useAlbumProgress(
  query: AlbumProgressQuery = DEFAULT_ALBUM_PROGRESS_QUERY,
) {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const result = useQuery({
    queryKey: queryKeys.album.progress(userId, query),
    queryFn: () => fetchAlbumProgress(query),
    enabled: session.isAuthenticated,
  });

  return {
    ...result,
    progress: result.data ?? null,
  };
}
