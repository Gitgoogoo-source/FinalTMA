import { CheckCircle2, Clock, Gift, LockKeyhole } from "lucide-react";

import type { AlbumMilestone, AlbumReward } from "../album.types";
import { ClaimAlbumRewardButton } from "./ClaimAlbumRewardButton";

type MilestoneRewardRowProps = {
  milestone: AlbumMilestone;
  collectedCount: number;
  totalCount: number;
  isPending?: boolean;
  onClaim: (milestone: AlbumMilestone) => void;
};

const numberFormatter = new Intl.NumberFormat("zh-CN");

export function MilestoneRewardRow({
  milestone,
  collectedCount,
  totalCount,
  isPending = false,
  onClaim,
}: MilestoneRewardRowProps) {
  const progressPercent = calculateMilestoneProgress(
    collectedCount,
    milestone.requiredCount,
  );
  const statusLabel = getStatusLabel(milestone.status);
  const StatusIcon = getStatusIcon(milestone.status);

  return (
    <article
      className="album-milestone-row"
      data-status={milestone.status}
      aria-label={`${milestone.title ?? "图鉴里程碑"}，${statusLabel}`}
    >
      <header className="album-milestone-row__header">
        <div>
          <strong>{milestone.title ?? "图鉴里程碑奖励"}</strong>
          <span>
            收集 {numberFormatter.format(milestone.requiredCount)} /{" "}
            {numberFormatter.format(totalCount)} 解锁
          </span>
        </div>
        <span
          className="album-milestone-row__status"
          data-status={milestone.status}
        >
          <StatusIcon aria-hidden="true" size={14} strokeWidth={2.4} />
          {statusLabel}
        </span>
      </header>

      <div className="album-milestone-row__progress" aria-hidden="true">
        <span>
          <i style={{ width: `${progressPercent}%` }} />
        </span>
      </div>

      <div className="album-milestone-row__meta">
        <span>
          当前 {numberFormatter.format(collectedCount)} /{" "}
          {numberFormatter.format(milestone.requiredCount)}
        </span>
        {milestone.requiredPercent !== null ? (
          <span>目标 {formatPercent(milestone.requiredPercent)}</span>
        ) : null}
      </div>

      <div className="album-milestone-row__footer">
        <div className="album-milestone-row__rewards" aria-label="奖励内容">
          {milestone.rewards.length > 0 ? (
            milestone.rewards.map((reward, index) => (
              <RewardChip
                key={`${reward.rewardType}:${reward.templateId ?? index}`}
                reward={reward}
              />
            ))
          ) : (
            <span className="album-milestone-row__empty-reward">
              奖励配置生成中
            </span>
          )}
        </div>

        <ClaimAlbumRewardButton
          isPending={isPending}
          onClaim={() => onClaim(milestone)}
          status={milestone.status}
        />
      </div>
    </article>
  );
}

function RewardChip({ reward }: { reward: AlbumReward }) {
  return (
    <span
      className="album-milestone-reward"
      data-tone={getRewardTone(reward.rewardType)}
    >
      {reward.iconUrl ? <img src={reward.iconUrl} alt="" /> : null}
      <strong>{reward.label}</strong>
      {reward.amount !== null ? (
        <em>+{numberFormatter.format(reward.amount)}</em>
      ) : null}
    </span>
  );
}

function calculateMilestoneProgress(
  collectedCount: number,
  requiredCount: number,
): number {
  if (requiredCount <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (collectedCount / requiredCount) * 100));
}

function formatPercent(value: number): string {
  const normalized = Math.min(100, Math.max(0, value));

  return `${normalized.toFixed(normalized % 1 === 0 ? 0 : 2)}%`;
}

function getStatusLabel(status: AlbumMilestone["status"]): string {
  if (status === "claimable") {
    return "可领取";
  }

  if (status === "claimed") {
    return "已领取";
  }

  if (status === "expired") {
    return "已过期";
  }

  return "未解锁";
}

function getStatusIcon(status: AlbumMilestone["status"]) {
  if (status === "claimable") {
    return Gift;
  }

  if (status === "claimed") {
    return CheckCircle2;
  }

  if (status === "expired") {
    return Clock;
  }

  return LockKeyhole;
}

function getRewardTone(rewardType: string): string {
  const normalized = rewardType.toUpperCase();

  if (normalized === "KCOIN") {
    return "kcoin";
  }

  if (normalized === "FGEMS") {
    return "fgems";
  }

  if (normalized === "STAR_DISPLAY") {
    return "stars";
  }

  return "item";
}
