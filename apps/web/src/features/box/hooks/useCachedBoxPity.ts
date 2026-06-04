import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchBoxes } from "../box.api";
import {
  createBoxPitySnapshot,
  hasCachedBoxIdsForSlugs,
  readCachedBoxPitySnapshot,
  writeCachedBoxPitySnapshot,
  type CachedBoxPitySnapshot,
} from "../box.pityCache";
import { STATIC_BOX_SLUGS } from "../staticBoxes";

type CachedBoxPityState = {
  error: Error | null;
  hasUsableCache: boolean;
  isInitialSyncing: boolean;
  isSyncing: boolean;
  refresh: () => Promise<CachedBoxPitySnapshot | null>;
  snapshot: CachedBoxPitySnapshot | null;
};

export function useCachedBoxPity(): CachedBoxPityState {
  const [snapshot, setSnapshot] = useState<CachedBoxPitySnapshot | null>(() =>
    readCachedBoxPitySnapshot(),
  );
  const [error, setError] = useState<Error | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const hasUsableCache = useMemo(
    () => hasCachedBoxIdsForSlugs(snapshot, STATIC_BOX_SLUGS),
    [snapshot],
  );

  const refresh = useCallback(async () => {
    setIsSyncing(true);
    setError(null);

    try {
      const response = await fetchBoxes();
      const nextSnapshot = createBoxPitySnapshot(response);
      writeCachedBoxPitySnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      return nextSnapshot;
    } catch (caught) {
      const nextError =
        caught instanceof Error ? caught : new Error("保底信息同步失败。");
      setError(nextError);
      return null;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!hasUsableCache) {
      void refresh();
    }
  }, [hasUsableCache, refresh]);

  return {
    error,
    hasUsableCache,
    isInitialSyncing: isSyncing && !hasUsableCache,
    isSyncing,
    refresh,
    snapshot,
  };
}
