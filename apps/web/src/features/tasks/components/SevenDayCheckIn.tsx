import { CalendarCheck, Clock } from "lucide-react";

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
    status?.campaign && !status.alreadyClaimedToday && status.nextDayIndex,
  );

  return (
    <section className="seven-day-check-in" aria-labelledby="check-in-title">
      <header className="seven-day-check-in__header">
        <div>
          <span>连续签到</span>
          <h2 id="check-in-title">{status?.campaign?.title ?? "7 日签到"}</h2>
        </div>
        <button
          disabled={!canCheckIn || isPending}
          onClick={onCheckIn}
          type="button"
        >
          {isPending ? (
            <Clock aria-hidden="true" size={15} strokeWidth={2.5} />
          ) : (
            <CalendarCheck aria-hidden="true" size={15} strokeWidth={2.5} />
          )}
          {status?.alreadyClaimedToday
            ? "今日已签"
            : isPending
              ? "签到中"
              : "签到"}
        </button>
      </header>

      <div className="seven-day-check-in__meta">
        <span>连续 {status?.currentStreak ?? 0} 天</span>
        <span>累计 {status?.totalSignins ?? 0} 次</span>
      </div>

      {status?.days.length ? (
        <div className="seven-day-check-in__days">
          {status.days.map((day) => (
            <CheckInRewardCard day={day} key={day.dayIndex} />
          ))}
        </div>
      ) : (
        <div className="seven-day-check-in__empty">
          <strong>签到活动未开放</strong>
          <span>活动配置生效后会自动展示签到奖励。</span>
        </div>
      )}
    </section>
  );
}
