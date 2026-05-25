import { RefreshCw, Trophy } from "lucide-react";

import { getApiErrorMessage } from "@/api/errors";

import type {
  AlbumLeaderboardEntry,
  AlbumLeaderboardResponse,
} from "../album.types";
import { LeaderboardRow } from "./LeaderboardRow";

type LeaderboardPanelProps = {
  leaderboard: AlbumLeaderboardResponse | null;
  isLoading?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  error?: unknown;
  onRefresh?: () => void;
};

export function LeaderboardPanel({
  leaderboard,
  isLoading = false,
  isFetching = false,
  isError = false,
  error,
  onRefresh,
}: LeaderboardPanelProps) {
  const entries = leaderboard?.entries ?? [];
  const myEntry = leaderboard?.myEntry ?? null;
  const hasEntries = entries.length > 0;
  const isEmpty = leaderboard?.empty ?? !hasEntries;

  if (isLoading && !leaderboard) {
    return (
      <section
        className="leaderboard-panel"
        aria-busy="true"
        aria-labelledby="leaderboard-title"
      >
        <PanelHeader
          generatedAt={null}
          isFetching={isFetching}
          onRefresh={onRefresh}
        />
        <div className="leaderboard-panel__state">
          <span className="leaderboard-panel__spinner" />
          <strong>排行榜加载中</strong>
        </div>
      </section>
    );
  }

  if (isError && !leaderboard) {
    return (
      <section
        className="leaderboard-panel"
        aria-labelledby="leaderboard-title"
      >
        <PanelHeader
          generatedAt={null}
          isFetching={isFetching}
          onRefresh={onRefresh}
        />
        <div className="leaderboard-panel__state" role="alert">
          <Trophy aria-hidden="true" size={28} strokeWidth={2.1} />
          <strong>排行榜读取失败</strong>
          <span>{getApiErrorMessage(error)}</span>
          {onRefresh ? (
            <button onClick={onRefresh} type="button">
              重试
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="leaderboard-panel" aria-labelledby="leaderboard-title">
      <PanelHeader
        generatedAt={hasEntries ? (leaderboard?.generatedAt ?? null) : null}
        isFetching={isFetching}
        onRefresh={onRefresh}
      />

      {myEntry ? <MyRankCard entry={myEntry} /> : null}

      {isEmpty || !hasEntries ? (
        <div className="leaderboard-panel__state">
          <Trophy aria-hidden="true" size={30} strokeWidth={2.1} />
          <strong>榜单生成中</strong>
        </div>
      ) : (
        <div className="leaderboard-panel__list" role="list">
          {entries.map((entry) => (
            <LeaderboardRow
              entry={entry}
              isCurrentUser={myEntry?.userId === entry.userId}
              key={`${entry.rank}:${entry.userId}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

type PanelHeaderProps = {
  generatedAt: string | null;
  isFetching: boolean;
  onRefresh?: (() => void) | undefined;
};

function PanelHeader({ generatedAt, isFetching, onRefresh }: PanelHeaderProps) {
  return (
    <header className="leaderboard-panel__header">
      <div>
        <span>排行榜</span>
        <h2 id="leaderboard-title">每周图鉴榜</h2>
        {generatedAt ? <em>更新于 {formatDateTime(generatedAt)}</em> : null}
      </div>
      {onRefresh ? (
        <button
          aria-label="刷新排行榜"
          disabled={isFetching}
          onClick={onRefresh}
          title="刷新排行榜"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={15} strokeWidth={2.4} />
        </button>
      ) : null}
    </header>
  );
}

function MyRankCard({ entry }: { entry: AlbumLeaderboardEntry }) {
  return (
    <div className="leaderboard-my-rank" aria-label="我的排名">
      <div>
        <span>我的排名</span>
        <strong>#{entry.rank}</strong>
      </div>
      <div>
        <span>完成度</span>
        <strong>{formatPercent(entry.completionPercent)}</strong>
      </div>
      <div>
        <span>总分</span>
        <strong>{formatInteger(entry.score)}</strong>
      </div>
    </div>
  );
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatPercent(value: number): string {
  const safeValue = Math.min(100, Math.max(0, value));

  return `${safeValue.toFixed(safeValue % 1 === 0 ? 0 : 2)}%`;
}
