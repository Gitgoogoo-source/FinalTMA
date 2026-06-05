import type { CSSProperties } from "react";

import type { CheckInStatus } from "../tasks.types";
import { CheckInRewardCard } from "./CheckInRewardCard";

type SevenDayCheckInProps = {
  isPending: boolean;
  status: CheckInStatus | null;
  onCheckIn: () => void;
};

export function SevenDayCheckIn({
  isPending,
  onCheckIn,
  status,
}: SevenDayCheckInProps) {
  const canCheckIn = Boolean(
    status?.campaign &&
      !status.alreadyClaimedToday &&
      status.nextDayIndex !== null,
  );
  const days = status?.days ?? [];
  const claimedCount = days.filter((day) => day.status === "claimed").length;
  const activeIndex = days.findIndex((day) => day.status === "available");
  const progressIndex = activeIndex >= 0 ? activeIndex : claimedCount;
  const progressPercent =
    days.length > 1
      ? Math.min(100, (progressIndex / (days.length - 1)) * 100)
      : 0;
  const trackStyle = {
    "--check-in-progress": `${progressPercent}%`,
  } as CSSProperties;

  return (
    <section className="seven-day-check-in" aria-labelledby="check-in-title">
      <header className="seven-day-check-in__header">
        <div>
          <span>连续签到</span>
          <h2 id="check-in-title">{status?.campaign?.title ?? "7 日签到"}</h2>
        </div>
      </header>

      <div className="seven-day-check-in__meta">
        <span>连续 {status?.currentStreak ?? 0} 天</span>
        <span>累计 {status?.totalSignins ?? 0} 次</span>
      </div>

      {days.length ? (
        <>
          <div className="seven-day-check-in__track" style={trackStyle}>
            {days.map((day) => (
              <span data-status={day.status} key={day.dayIndex}>
                {day.dayIndex}
              </span>
            ))}
          </div>
          <div className="seven-day-check-in__days">
            {days.map((day) => (
              <CheckInRewardCard
                canCheckIn={canCheckIn}
                day={day}
                isPending={isPending}
                key={day.dayIndex}
                onCheckIn={onCheckIn}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="seven-day-check-in__empty">
          <strong>签到活动未开放</strong>
          <span>活动配置生效后会自动展示签到奖励。</span>
        </div>
      )}
    </section>
  );
}
