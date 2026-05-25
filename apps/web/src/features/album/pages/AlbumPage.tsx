import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";

import { AlbumGrid } from "../components/AlbumGrid";
import { AlbumProgress } from "../components/AlbumProgress";
import { AlbumSeriesTabs } from "../components/AlbumSeriesTabs";
import { useAlbumProgress } from "../hooks/useAlbumProgress";
import { useAlbumSeries } from "../hooks/useAlbumSeries";
import type { AlbumProgressQuery } from "../album.types";

export function AlbumPage() {
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const albumSeriesQuery = useAlbumSeries();
  const progressQuery = useMemo(() => {
    const query: AlbumProgressQuery = {
      includeItems: true,
      includeMilestones: true,
      includeRewards: true,
      includeLockedItems: true,
    };

    if (selectedBookId) {
      query.bookId = selectedBookId;
    }

    return query;
  }, [selectedBookId]);
  const albumProgressQuery = useAlbumProgress(progressQuery);
  const progress = albumProgressQuery.progress;
  const isRefreshing =
    albumProgressQuery.isFetching || albumSeriesQuery.isFetching;

  function handleRefresh() {
    void albumSeriesQuery.refetch();
    void albumProgressQuery.refetch();
  }

  if (albumProgressQuery.isLoading && !progress) {
    return (
      <section className="album-page album-page--state" aria-busy="true">
        <div className="album-state">
          <span className="album-state__spinner" />
          <strong>图鉴加载中</strong>
        </div>
      </section>
    );
  }

  if (albumProgressQuery.isError && !progress) {
    return (
      <section className="album-page album-page--state">
        <div className="album-state" role="alert">
          <strong>图鉴读取失败</strong>
          <span>{getApiErrorMessage(albumProgressQuery.error)}</span>
          <button
            onClick={() => void albumProgressQuery.refetch()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={15} strokeWidth={2.4} />
            重试
          </button>
        </div>
      </section>
    );
  }

  if (!progress) {
    return (
      <section className="album-page album-page--state">
        <div className="album-state">
          <strong>图鉴暂不可用</strong>
          <span>登录完成后会自动读取图鉴进度。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="album-page" data-testid="album-page">
      <header className="album-page__header">
        <div>
          <span>成长系统</span>
          <h1>图鉴</h1>
        </div>
        <button
          aria-label="刷新图鉴进度"
          disabled={isRefreshing}
          onClick={handleRefresh}
          title="刷新图鉴进度"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} strokeWidth={2.4} />
        </button>
      </header>

      <AlbumSeriesTabs
        books={albumSeriesQuery.books}
        error={albumSeriesQuery.error}
        isError={albumSeriesQuery.isError}
        isLoading={albumSeriesQuery.isLoading}
        onRetry={() => void albumSeriesQuery.refetch()}
        onSelectBook={setSelectedBookId}
        selectedBookId={selectedBookId}
      />

      <AlbumProgress progress={progress} />

      <AlbumGrid items={progress.items} />
    </section>
  );
}
