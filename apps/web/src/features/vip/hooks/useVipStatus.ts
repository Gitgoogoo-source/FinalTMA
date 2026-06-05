import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useSession } from "@/app/providers/SessionProvider";
import { queryKeys } from "@/shared/constants/queryKeys";

import { fetchVipStatus, normalizeVipStatus } from "../vip.api";
import type { VipStatus } from "../vip.types";

export const VIP_STATUS_CACHE_STORAGE_KEY = "tma:vip:status-cache:v1";

const VIP_STATUS_CACHE_GC_TIME_MS = 25 * 60 * 60_000;
const VIP_STATUS_CACHE_VERSION = 1;

type VipStatusStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type CachedVipStatusRecord = {
  version: typeof VIP_STATUS_CACHE_VERSION;
  userId: string;
  status: VipStatus;
  cachedAt: string;
  cachedAtMs: number;
};

export function useVipStatus() {
  const session = useSession();
  const userId = session.user?.id ?? null;
  const cachedStatusRecord = useMemo(
    () => readCachedVipStatusRecord(userId),
    [userId],
  );

  return useQuery<VipStatus>({
    queryKey: queryKeys.vip.status(userId),
    queryFn: () => fetchAndCacheVipStatus(userId),
    enabled: session.isAuthenticated && userId !== null,
    ...(cachedStatusRecord
      ? {
          initialData: cachedStatusRecord.status,
          initialDataUpdatedAt: cachedStatusRecord.cachedAtMs,
        }
      : {}),
    staleTime: (query) => getVipStatusStaleTime(query.state.data),
    refetchInterval: (query) => {
      const staleTime = getVipStatusStaleTime(query.state.data);

      return staleTime > 0 ? staleTime : false;
    },
    gcTime: VIP_STATUS_CACHE_GC_TIME_MS,
  });
}

async function fetchAndCacheVipStatus(userId: string | null): Promise<VipStatus> {
  const status = await fetchVipStatus();

  if (userId) {
    writeCachedVipStatus(userId, status);
  }

  return status;
}

export function readCachedVipStatusRecord(
  userId: string | null | undefined,
  storage: VipStatusStorage | null = resolveStorage(),
  nowMs = Date.now(),
): CachedVipStatusRecord | null {
  if (!userId || !storage) {
    return null;
  }

  try {
    const raw = storage.getItem(VIP_STATUS_CACHE_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const record = normalizeCachedVipStatusRecord(JSON.parse(raw) as unknown);

    if (!record || record.userId !== userId) {
      storage.removeItem(VIP_STATUS_CACHE_STORAGE_KEY);
      return null;
    }

    if (!isVipStatusFresh(record.status, nowMs)) {
      storage.removeItem(VIP_STATUS_CACHE_STORAGE_KEY);
      return null;
    }

    return record;
  } catch {
    storage.removeItem(VIP_STATUS_CACHE_STORAGE_KEY);
    return null;
  }
}

export function writeCachedVipStatus(
  userId: string | null | undefined,
  status: VipStatus,
  storage: VipStatusStorage | null = resolveStorage(),
  now: Date = new Date(),
): void {
  if (!userId || !storage) {
    return;
  }

  const record = {
    version: VIP_STATUS_CACHE_VERSION,
    userId,
    status,
    cachedAt: now.toISOString(),
  };

  try {
    storage.setItem(VIP_STATUS_CACHE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Local VIP status is only a UI cache; the server still decides every claim.
  }
}

export function getVipStatusStaleTime(
  status: VipStatus | undefined,
  nowMs = Date.now(),
): number {
  if (!status) {
    return 0;
  }

  const serverNowMs = getVipStatusReferenceNowMs(status, nowMs);
  const staleAtMs = getVipStatusStaleAtMs(status, nowMs);

  return Math.max(staleAtMs - serverNowMs, 0);
}

export function isVipStatusFresh(
  status: VipStatus | undefined,
  nowMs = Date.now(),
): boolean {
  if (!status) {
    return false;
  }

  return getVipStatusStaleAtMs(status, nowMs) > nowMs;
}

function normalizeCachedVipStatusRecord(
  value: unknown,
): CachedVipStatusRecord | null {
  if (!isRecord(value) || value.version !== VIP_STATUS_CACHE_VERSION) {
    return null;
  }

  const userId = readString(value.userId);
  const cachedAt = readString(value.cachedAt);
  const cachedAtMs = parseTimestamp(cachedAt);

  if (!userId || !cachedAt || cachedAtMs === null || !isRecord(value.status)) {
    return null;
  }

  return {
    version: VIP_STATUS_CACHE_VERSION,
    userId,
    status: normalizeVipStatus(value.status),
    cachedAt,
    cachedAtMs,
  };
}

function getVipStatusStaleAtMs(status: VipStatus, nowMs: number): number {
  const serverNowMs = getVipStatusReferenceNowMs(status, nowMs);
  const dayEndMs =
    parseBusinessDateEndUtc(status.today?.businessDateUtc) ??
    getNextUtcDayStartMs(serverNowMs);
  const currentPeriodEndMs = status.isVip
    ? parseTimestamp(status.currentPeriodEnd)
    : null;

  return currentPeriodEndMs !== null
    ? Math.min(dayEndMs, currentPeriodEndMs)
    : dayEndMs;
}

function getVipStatusReferenceNowMs(
  status: VipStatus,
  fallbackNowMs: number,
): number {
  return parseTimestamp(status.serverTime) ?? fallbackNowMs;
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

function resolveStorage(): VipStatusStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
