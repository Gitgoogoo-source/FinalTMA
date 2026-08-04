import { useEffect, useRef, useState } from "react";

export type BattleDeadlineClock = {
  remainingSeconds: number | null;
  progressPercent: number | null;
};

export function useBattleDeadline({
  serverTime,
  deadline,
  durationSeconds,
  onExpire,
}: {
  serverTime: string | null;
  deadline: string | null;
  durationSeconds: number | null;
  onExpire(): void;
}): BattleDeadlineClock {
  const onExpireRef = useRef(onExpire);
  const expiredKey = useRef<string | null>(null);
  const [clock, setClock] = useState<BattleDeadlineClock>({
    remainingSeconds: null,
    progressPercent: null,
  });

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (!serverTime || !deadline || durationSeconds === null) {
      expiredKey.current = null;
      return;
    }
    const serverAtRead = Date.parse(serverTime);
    const deadlineAt = Date.parse(deadline);
    const clientAtRead = Date.now();
    const offset = serverAtRead - clientAtRead;
    const key = deadline;
    const update = () => {
      const remainingMs = Math.max(0, deadlineAt - (Date.now() + offset));
      const remainingSeconds = Math.ceil(remainingMs / 1_000);
      const progressPercent = Math.max(
        0,
        Math.min(100, (remainingMs / (durationSeconds * 1_000)) * 100),
      );
      setClock((current) =>
        current.remainingSeconds === remainingSeconds &&
        current.progressPercent !== null &&
        Math.abs(current.progressPercent - progressPercent) < 0.25
          ? current
          : { remainingSeconds, progressPercent },
      );
      if (remainingMs === 0 && expiredKey.current !== key) {
        expiredKey.current = key;
        onExpireRef.current();
      }
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [deadline, durationSeconds, serverTime]);

  return !serverTime || !deadline || durationSeconds === null
    ? { remainingSeconds: null, progressPercent: null }
    : clock;
}
