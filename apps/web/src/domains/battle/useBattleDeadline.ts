import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type BattleDeadlineClock = {
  remainingMilliseconds: number | null;
  remainingSeconds: number | null;
  progressPercent: number | null;
  expired: boolean;
  isOpenNow(): boolean;
  synchronize(): void;
};

type DeadlineAnchor = {
  deadlineAt: number;
  serverAtRead: number;
  monotonicAtRead: number;
  wallAtRead: number;
};

type DeadlineState = Pick<
  BattleDeadlineClock,
  "remainingMilliseconds" | "remainingSeconds" | "progressPercent"
>;

const emptyDeadlineState: DeadlineState = {
  remainingMilliseconds: null,
  remainingSeconds: null,
  progressPercent: null,
};

function remainingMilliseconds(anchor: DeadlineAnchor): number {
  const elapsed = Math.max(
    performance.now() - anchor.monotonicAtRead,
    Date.now() - anchor.wallAtRead,
  );
  const serverNow = anchor.serverAtRead + Math.max(0, elapsed);
  return Math.max(0, anchor.deadlineAt - serverNow);
}

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
  const anchorRef = useRef<DeadlineAnchor | null>(null);
  const updateRef = useRef<() => void>(() => undefined);
  const [clock, setClock] = useState<DeadlineState>(emptyDeadlineState);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useLayoutEffect(() => {
    const serverAtRead = serverTime ? Date.parse(serverTime) : Number.NaN;
    const deadlineAt = deadline ? Date.parse(deadline) : Number.NaN;
    if (
      !serverTime ||
      !deadline ||
      durationSeconds === null ||
      durationSeconds <= 0 ||
      !Number.isFinite(serverAtRead) ||
      !Number.isFinite(deadlineAt)
    ) {
      anchorRef.current = null;
      updateRef.current = () => undefined;
      expiredKey.current = null;
      return;
    }

    const anchor: DeadlineAnchor = {
      deadlineAt,
      serverAtRead,
      monotonicAtRead: performance.now(),
      wallAtRead: Date.now(),
    };
    const key = deadline;
    anchorRef.current = anchor;

    const update = () => {
      if (anchorRef.current !== anchor) return;
      const remainingMs = remainingMilliseconds(anchor);
      const progressPercent = Math.max(
        0,
        Math.min(100, (remainingMs / (durationSeconds * 1_000)) * 100),
      );
      const next: DeadlineState = {
        remainingMilliseconds: remainingMs,
        remainingSeconds: Math.ceil(remainingMs / 1_000),
        progressPercent,
      };
      setClock((current) =>
        current.remainingSeconds === next.remainingSeconds &&
        current.remainingMilliseconds !== null &&
        Math.abs(current.remainingMilliseconds - remainingMs) < 50 &&
        current.progressPercent !== null &&
        Math.abs(current.progressPercent - progressPercent) < 0.25
          ? current
          : next,
      );
      if (remainingMs === 0 && expiredKey.current !== key) {
        expiredKey.current = key;
        onExpireRef.current();
      }
    };

    updateRef.current = update;
    update();
    const interval = window.setInterval(update, 250);
    const initialRemaining = remainingMilliseconds(anchor);
    const deadlineTimer =
      initialRemaining > 0
        ? window.setTimeout(update, Math.ceil(initialRemaining))
        : null;
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("pageshow", update);
    return () => {
      window.clearInterval(interval);
      if (deadlineTimer !== null) window.clearTimeout(deadlineTimer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("pageshow", update);
      if (anchorRef.current === anchor) anchorRef.current = null;
      if (updateRef.current === update) updateRef.current = () => undefined;
    };
  }, [deadline, durationSeconds, serverTime]);

  const isOpenNow = useCallback(() => {
    const anchor = anchorRef.current;
    return anchor !== null && remainingMilliseconds(anchor) > 0;
  }, []);
  const synchronize = useCallback(() => updateRef.current(), []);
  const configured =
    serverTime !== null &&
    deadline !== null &&
    durationSeconds !== null &&
    durationSeconds > 0 &&
    Number.isFinite(Date.parse(serverTime)) &&
    Number.isFinite(Date.parse(deadline));
  const visibleClock = configured ? clock : emptyDeadlineState;

  return {
    ...visibleClock,
    expired: configured && visibleClock.remainingMilliseconds === 0,
    isOpenNow,
    synchronize,
  };
}
