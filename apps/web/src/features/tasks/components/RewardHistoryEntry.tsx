import { CalendarCheck, CheckCircle2, Gift, HandCoins } from "lucide-react";

import type {
  CheckInStatus,
  CommissionHistory,
  SignInDay,
  TaskItem,
  TaskReward,
} from "../tasks.types";
import { RewardBadges } from "./TaskRow";

type RewardHistoryPanelProps = {
  checkInStatus: CheckInStatus | null;
  commissionHistory: CommissionHistory | null;
  isLoading: boolean;
  tasks: TaskItem[];
};

type RewardHistoryTone = "task" | "signin" | "commission";

type RewardHistoryItem = {
  id: string;
  title: string;
  subtitle: string;
  claimedAt: string;
  rewards: TaskReward[];
  tone: RewardHistoryTone;
};

const historyDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function RewardHistoryPanel({
  checkInStatus,
  commissionHistory,
  isLoading,
  tasks,
}: RewardHistoryPanelProps) {
  const items = buildRewardHistoryItems({
    checkInStatus,
    commissionHistory,
    tasks,
  });

  return (
    <section
      className="reward-history-panel"
      aria-labelledby="reward-history-title"
    >
      <header className="reward-history-panel__header">
        <div>
          <span>奖励记录</span>
          <h2 id="reward-history-title">近期奖励</h2>
        </div>
        <strong>{items.length}</strong>
      </header>

      {isLoading ? (
        <div className="reward-history-panel__state" aria-busy="true">
          <span className="task-list-state__spinner" />
          <strong>奖励记录加载中</strong>
        </div>
      ) : items.length > 0 ? (
        <div className="reward-history-panel__list">
          {items.map((item) => (
            <RewardHistoryEntry item={item} key={item.id} />
          ))}
        </div>
      ) : (
        <div className="reward-history-panel__state">
          <Gift aria-hidden="true" size={18} strokeWidth={2.5} />
          <strong>暂无奖励记录</strong>
        </div>
      )}
    </section>
  );
}

export function RewardHistoryEntry({ item }: { item: RewardHistoryItem }) {
  const Icon = getHistoryIcon(item.tone);

  return (
    <article className="reward-history-entry" data-tone={item.tone}>
      <span className="reward-history-entry__icon">
        <Icon aria-hidden="true" size={15} strokeWidth={2.5} />
      </span>
      <div className="reward-history-entry__copy">
        <strong>{item.title}</strong>
        <span>{item.subtitle}</span>
        <time dateTime={item.claimedAt}>
          {formatHistoryTime(item.claimedAt)}
        </time>
      </div>
      <RewardBadges rewards={item.rewards} />
    </article>
  );
}

function buildRewardHistoryItems({
  checkInStatus,
  commissionHistory,
  tasks,
}: Omit<RewardHistoryPanelProps, "isLoading">): RewardHistoryItem[] {
  const taskItems = tasks.flatMap(buildTaskRewardHistoryItems);
  const checkInItems = buildCheckInRewardHistoryItems(checkInStatus);
  const commissionItems = buildCommissionRewardHistoryItems(commissionHistory);

  return [...taskItems, ...checkInItems, ...commissionItems]
    .sort((left, right) => compareHistoryTime(right.claimedAt, left.claimedAt))
    .slice(0, 6);
}

function buildTaskRewardHistoryItems(task: TaskItem): RewardHistoryItem[] {
  if (!task.progress.claimedAt || task.rewards.length === 0) {
    return [];
  }

  return [
    {
      id: `task:${task.taskId}:${task.periodKey ?? task.progress.claimedAt}`,
      title: task.title,
      subtitle: getTaskCategoryLabel(task.category),
      claimedAt: task.progress.claimedAt,
      rewards: task.rewards,
      tone: "task",
    },
  ];
}

function buildCheckInRewardHistoryItems(
  status: CheckInStatus | null,
): RewardHistoryItem[] {
  if (!status) {
    return [];
  }

  return status.days.flatMap((day) => {
    const claimedAt = getSignInClaimedAt(day);

    if (!claimedAt || day.rewards.length === 0) {
      return [];
    }

    return [
      {
        id: `signin:${status.campaign?.campaignId ?? "default"}:${day.dayIndex}:${claimedAt}`,
        title: day.title,
        subtitle: status.campaign?.title ?? "连续签到",
        claimedAt,
        rewards: day.rewards,
        tone: "signin" as const,
      },
    ];
  });
}

function buildCommissionRewardHistoryItems(
  history: CommissionHistory | null,
): RewardHistoryItem[] {
  if (!history) {
    return [];
  }

  return history.items.flatMap((item) => {
    if (
      item.status !== "granted" ||
      !item.claimedAt ||
      item.commissionAmountKcoin <= 0
    ) {
      return [];
    }

    return [
      {
        id: `commission:${item.commissionId}`,
        title: item.inviteeDisplayName ?? item.inviteeUsername ?? "邀请分红",
        subtitle: "邀请分红",
        claimedAt: item.claimedAt,
        rewards: [
          {
            id: `commission:${item.commissionId}:kcoin`,
            type: "currency",
            label: "KCOIN",
            amount: item.commissionAmountKcoin,
            currency: "KCOIN",
            iconUrl: null,
            detail: null,
          },
        ],
        tone: "commission" as const,
      },
    ];
  });
}

function getSignInClaimedAt(day: SignInDay): string | null {
  if (day.claimedAt) {
    return day.claimedAt;
  }

  if (!day.claimedDate) {
    return null;
  }

  const parsed = new Date(day.claimedDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function compareHistoryTime(left: string, right: string): number {
  return getTime(left) - getTime(right);
}

function getTime(value: string): number {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatHistoryTime(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "已领取";
  }

  return historyDateFormatter.format(parsed);
}

function getHistoryIcon(tone: RewardHistoryTone) {
  switch (tone) {
    case "signin":
      return CalendarCheck;
    case "commission":
      return HandCoins;
    default:
      return CheckCircle2;
  }
}

function getTaskCategoryLabel(category: TaskItem["category"]): string {
  switch (category) {
    case "daily":
      return "每日任务";
    case "social":
    case "referral":
      return "社交任务";
    case "trade":
      return "交易任务";
    case "onchain":
    case "wallet":
      return "链上任务";
    case "album":
      return "图鉴任务";
    default:
      return "任务奖励";
  }
}
