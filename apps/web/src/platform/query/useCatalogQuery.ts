import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app-client";

import { fetchApiQuery, useApiQuery } from "./index.ts";

export type CatalogSnapshot = RouteOutput<"catalog.release"> & {
  asset_revision: RouteOutput<"catalog.current">["asset_revision"];
};

type CatalogQueryResult = {
  data: CatalogSnapshot | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch(): Promise<void>;
};

let lastSuccessfulCatalogSnapshot: CatalogSnapshot | undefined;
const catalogSnapshotListeners = new Set<() => void>();

export function useCatalogQuery(requestedEnabled = true): CatalogQueryResult {
  const pointer = useApiQuery("catalog.current", {}, requestedEnabled);
  const releaseInput = pointer.data
    ? {
        product_checksum: pointer.data.product_checksum,
        release_key: pointer.data.release_key,
      }
    : { product_checksum: "", release_key: "" };
  const release = useApiQuery(
    "catalog.release",
    releaseInput,
    requestedEnabled && pointer.data !== undefined,
  );
  const previousSnapshot = useSyncExternalStore(
    subscribeCatalogSnapshots,
    getLastSuccessfulCatalogSnapshot,
    getLastSuccessfulCatalogSnapshot,
  );
  const snapshot = useMemo<CatalogSnapshot | undefined>(() => {
    if (
      !pointer.data ||
      !release.data ||
      release.data.product_checksum !== pointer.data.product_checksum ||
      release.data.release_key !== pointer.data.release_key
    )
      return undefined;
    return {
      ...release.data,
      asset_revision: pointer.data.asset_revision,
    };
  }, [pointer.data, release.data]);

  useEffect(() => {
    if (!snapshot) return;
    publishCatalogSnapshot(snapshot);
  }, [snapshot]);

  const refetch = useCallback(async () => {
    const refreshedPointer = await pointer.refetch();
    if (!refreshedPointer.isSuccess) return;
    await fetchApiQuery("catalog.release", {
      product_checksum: refreshedPointer.data.product_checksum,
      release_key: refreshedPointer.data.release_key,
    });
  }, [pointer]);

  const data = snapshot ?? previousSnapshot;
  return {
    data,
    isLoading:
      data === undefined &&
      (pointer.isLoading || (pointer.data !== undefined && release.isLoading)),
    error: data === undefined ? (pointer.error ?? release.error) : null,
    refetch,
  };
}

function subscribeCatalogSnapshots(listener: () => void): () => void {
  catalogSnapshotListeners.add(listener);
  return () => catalogSnapshotListeners.delete(listener);
}

function getLastSuccessfulCatalogSnapshot(): CatalogSnapshot | undefined {
  return lastSuccessfulCatalogSnapshot;
}

function publishCatalogSnapshot(snapshot: CatalogSnapshot): void {
  if (lastSuccessfulCatalogSnapshot === snapshot) return;
  lastSuccessfulCatalogSnapshot = snapshot;
  for (const listener of catalogSnapshotListeners) listener();
}
