import { RefreshCw } from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";

import { AlbumProgress } from "../components/AlbumProgress";
import { useAlbumProgress } from "../hooks/useAlbumProgress";

export function AlbumPage() {
  const albumProgressQuery = useAlbumProgress();
  const progress = albumProgressQuery.progress;

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
          disabled={albumProgressQuery.isFetching}
          onClick={() => void albumProgressQuery.refetch()}
          title="刷新图鉴进度"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} strokeWidth={2.4} />
        </button>
      </header>

      <AlbumProgress progress={progress} />
    </section>
  );
}
