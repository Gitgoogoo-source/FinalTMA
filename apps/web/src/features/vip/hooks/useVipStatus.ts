import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchVipStatus } from "../vip.api";
import type { VipStatus } from "../vip.types";

const VIP_STATUS_CACHE_GC_TIME_MS = 25 * 60 * 60_000;

export function useVipStatus() {
  const session = useSession();

  return useQuery({
    queryKey: queryKeys.vip.status(session.user?.id ?? null),
    queryFn: fetchVipStatus,
    enabled: session.isAuthenticated,
    staleTime: (query) => getVipStatusStaleTime(query.state.data),
    refetchInterval: (query) => {
      const staleTime = getVipStatusStaleTime(query.state.data);

      return staleTime > 0 ? staleTime : false;
    },
    gcTime: VIP_STATUS_CACHE_GC_TIME_MS,
  });
}

export function getVipStatusStaleTime(
  status: VipStatus | undefined,
  nowMs = Date.now(),
): number {
  if (!status) {
    return 0;
  }

  const serverNowMs = parseTimestamp(status.serverTime) ?? nowMs;
  const dayEndMs =
    parseBusinessDateEndUtc(status.today?.businessDateUtc) ??
    getNextUtcDayStartMs(serverNowMs);
  const currentPeriodEndMs = status.isVip
    ? parseTimestamp(status.currentPeriodEnd)
    : null;
  const staleAtMs =
    currentPeriodEndMs !== null
      ? Math.min(dayEndMs, currentPeriodEndMs)
      : dayEndMs;

  return Math.max(staleAtMs - serverNowMs, 0);
}

function parseBusinessDateEndUtc(
  value: string | null | undefined,
): number | null {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }

  return Date.UTC(year, month - 1, day + 1);
}

function getNextUtcDayStartMs(timestampMs: number): number {
  const date = new Date(timestampMs);

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}
