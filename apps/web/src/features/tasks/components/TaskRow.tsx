import { Coins, Gem, Gift, Star } from "lucide-react";

import type { TaskItem, TaskReward } from "../tasks.types";
import { ClaimTaskButton } from "./ClaimTaskButton";

type TaskRowProps = {
  isPending?: boolean;
  task: TaskItem;
  onClaim: (task: TaskItem) => void;
};

export function TaskRow({ isPending = false, onClaim, task }: TaskRowProps) {
  return (
    <article className="task-row" data-status={task.status}>
      <div className="task-row__main">
        <div className="task-row__copy">
          <span>{getCategoryLabel(task.category)}</span>
          <strong>{task.title}</strong>
          {task.description ? <p>{task.description}</p> : null}
        </div>
        <ClaimTaskButton isPending={isPending} onClaim={onClaim} task={task} />
      </div>

      <div className="task-row__progress" aria-label="任务进度">
        <span>
          <i style={{ width: `${task.progress.percent}%` }} />
        </span>
        <em>
          {task.progress.current}/{task.progress.target}
        </em>
      </div>

      <RewardBadges rewards={task.rewards} />
    </article>
  );
}

type RewardBadgesProps = {
  rewards: TaskReward[];
};

export function RewardBadges({ rewards }: RewardBadgesProps) {
  if (rewards.length === 0) {
    return (
      <div className="task-reward-badges task-reward-badges--empty">无奖励</div>
    );
  }

  return (
    <div className="task-reward-badges">
      {rewards.map((reward) => {
        const Icon = getRewardIcon(reward);

        return (
          <span key={reward.id}>
            <Icon aria-hidden="true" size={13} strokeWidth={2.5} />
            {formatReward(reward)}
          </span>
        );
      })}
    </div>
  );
}

function getCategoryLabel(category: TaskItem["category"]): string {
  switch (category) {
    case "daily":
      return "每日";
    case "social":
    case "referral":
      return "社交";
    case "trade":
      return "交易";
    case "onchain":
    case "wallet":
      return "链上";
    case "album":
      return "图鉴";
    default:
      return "任务";
  }
}

function getRewardIcon(reward: TaskReward) {
  if (reward.currency === "KCOIN") {
    return Coins;
  }

  if (reward.currency === "FGEMS") {
    return Gem;
  }

  if (reward.currency === "STAR_DISPLAY") {
    return Star;
  }

  return Gift;
}

function formatReward(reward: TaskReward): string {
  if (reward.amount !== null) {
    return `${reward.label} +${reward.amount.toLocaleString("zh-CN")}`;
  }

  return reward.label;
}
