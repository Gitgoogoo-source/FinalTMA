import { CheckCircle2, Gift, LockKeyhole } from "lucide-react";

import type { SignInDay } from "../tasks.types";
import { RewardBadges } from "./TaskRow";

type CheckInRewardCardProps = {
  canCheckIn: boolean;
  day: SignInDay;
  isPending: boolean;
  onCheckIn: () => void;
};

export function CheckInRewardCard({
  canCheckIn,
  day,
  isPending,
  onCheckIn,
}: CheckInRewardCardProps) {
  const meta = getDayMeta(day.status);
  const Icon = meta.icon;
  const isAvailable = day.status === "available";

  return (
    <article className="check-in-reward-card" data-status={day.status}>
      <header>
        <span>Day {day.dayIndex}</span>
        <Icon aria-hidden="true" size={16} strokeWidth={2.5} />
      </header>
      <strong>{day.title}</strong>
      <RewardBadges rewards={day.rewards} />
      {isAvailable ? (
        <button
          aria-label={`签到 Day ${day.dayIndex}`}
          className="check-in-reward-card__action"
          disabled={!canCheckIn || isPending}
          onClick={onCheckIn}
          type="button"
        >
          {isPending ? "签到中" : meta.label}
        </button>
      ) : (
        <em>{meta.label}</em>
      )}
    </article>
  );
}

function getDayMeta(status: SignInDay["status"]) {
  if (status === "available") {
    return {
      icon: Gift,
      label: "可签到",
    };
  }

  if (status === "claimed") {
    return {
      icon: CheckCircle2,
      label: "已领取",
    };
  }

  return {
    icon: LockKeyhole,
    label: status === "missed" ? "已错过" : "未解锁",
  };
}
