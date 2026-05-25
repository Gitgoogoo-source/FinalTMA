import { Medal } from "lucide-react";

import type { AlbumLeaderboardEntry } from "../album.types";

type LeaderboardRowProps = {
  entry: AlbumLeaderboardEntry;
  isCurrentUser?: boolean;
};

export function LeaderboardRow({
  entry,
  isCurrentUser = false,
}: LeaderboardRowProps) {
  const rankTier = entry.rank <= 3 ? "top" : "default";

  return (
    <article
      className="leaderboard-row"
      data-current-user={isCurrentUser ? "true" : "false"}
      data-rank-tier={rankTier}
      role="listitem"
    >
      <div className="leaderboard-row__rank" aria-label={`第 ${entry.rank} 名`}>
        {entry.rank <= 3 ? (
          <Medal aria-hidden="true" size={16} strokeWidth={2.4} />
        ) : null}
        <strong>{entry.rank}</strong>
      </div>

      <div className="leaderboard-row__player">
        <Avatar entry={entry} />
        <div>
          <strong>{entry.displayName}</strong>
          <span>
            {entry.collectedCount} / {entry.totalCount}
          </span>
        </div>
      </div>

      <div className="leaderboard-row__metrics" aria-label="排行榜数据">
        <span>
          <small>完成度</small>
          <strong>{formatPercent(entry.completionPercent)}</strong>
        </span>
        <span>
          <small>稀有</small>
          <strong>{formatInteger(entry.rareCount)}</strong>
        </span>
        <span>
          <small>Mint</small>
          <strong>{formatInteger(entry.mintCount)}</strong>
        </span>
      </div>

      <div className="leaderboard-row__score">
        <small>总分</small>
        <strong>{formatInteger(entry.score)}</strong>
      </div>
    </article>
  );
}

function Avatar({ entry }: { entry: AlbumLeaderboardEntry }) {
  const initial = getInitial(entry.displayName);

  if (entry.avatarUrl) {
    return (
      <span className="leaderboard-row__avatar" aria-hidden="true">
        <img alt="" src={entry.avatarUrl} />
      </span>
    );
  }

  return (
    <span className="leaderboard-row__avatar" aria-hidden="true">
      {initial}
    </span>
  );
}

function getInitial(name: string): string {
  const trimmed = name.trim();

  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "P";
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatPercent(value: number): string {
  const safeValue = Math.min(100, Math.max(0, value));

  return `${safeValue.toFixed(safeValue % 1 === 0 ? 0 : 2)}%`;
}
