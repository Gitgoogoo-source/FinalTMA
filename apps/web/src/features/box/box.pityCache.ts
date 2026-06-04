import type { BoxListResponse, BoxPityProgress } from "./box.types";

export const BOX_PITY_CACHE_STORAGE_KEY = "tma:box:pity-cache:v1";

const BOX_PITY_CACHE_VERSION = 1;

export type CachedBoxPityItem = {
  slug: string;
  boxId: string;
  pityProgress: BoxPityProgress;
  updatedAt: string | null;
};

export type CachedBoxPitySnapshot = {
  version: typeof BOX_PITY_CACHE_VERSION;
  items: CachedBoxPityItem[];
  serverTime: string | null;
  syncedAt: string;
};

type CacheStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export function createBoxPitySnapshot(
  response: BoxListResponse,
  now: Date = new Date(),
): CachedBoxPitySnapshot {
  return {
    version: BOX_PITY_CACHE_VERSION,
    items: response.items.map((box) => ({
      boxId: box.id,
      pityProgress: box.pityProgress,
      slug: box.slug,
      updatedAt: box.updatedAt,
    })),
    serverTime: response.serverTime,
    syncedAt: now.toISOString(),
  };
}

export function readCachedBoxPitySnapshot(
  storage: CacheStorage | null = resolveStorage(),
): CachedBoxPitySnapshot | null {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(BOX_PITY_CACHE_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const snapshot = normalizeCachedBoxPitySnapshot(JSON.parse(raw) as unknown);

    if (!snapshot) {
      storage.removeItem(BOX_PITY_CACHE_STORAGE_KEY);
    }

    return snapshot;
  } catch {
    storage.removeItem(BOX_PITY_CACHE_STORAGE_KEY);
    return null;
  }
}

export function writeCachedBoxPitySnapshot(
  snapshot: CachedBoxPitySnapshot,
  storage: CacheStorage | null = resolveStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(BOX_PITY_CACHE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Cache writes are best-effort; opening boxes still goes through the server.
  }
}

export function getCachedBoxIdBySlug(
  snapshot: CachedBoxPitySnapshot | null,
  slug: string,
): string | null {
  return snapshot?.items.find((item) => item.slug === slug)?.boxId ?? null;
}

export function getCachedPityBySlug(
  snapshot: CachedBoxPitySnapshot | null,
  slug: string,
): BoxPityProgress {
  return snapshot?.items.find((item) => item.slug === slug)?.pityProgress ?? null;
}

export function hasCachedBoxIdsForSlugs(
  snapshot: CachedBoxPitySnapshot | null,
  slugs: readonly string[],
): boolean {
  if (!snapshot) {
    return false;
  }

  return slugs.every((slug) => getCachedBoxIdBySlug(snapshot, slug) !== null);
}

function normalizeCachedBoxPitySnapshot(
  value: unknown,
): CachedBoxPitySnapshot | null {
  if (!isRecord(value) || value.version !== BOX_PITY_CACHE_VERSION) {
    return null;
  }

  const syncedAt = readString(value.syncedAt);

  if (!syncedAt || !Array.isArray(value.items)) {
    return null;
  }

  const items = value.items.map(normalizeCachedBoxPityItem).filter(isCachedItem);

  return {
    version: BOX_PITY_CACHE_VERSION,
    items,
    serverTime: readString(value.serverTime),
    syncedAt,
  };
}

function normalizeCachedBoxPityItem(value: unknown): CachedBoxPityItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const slug = readString(value.slug);
  const boxId = readString(value.boxId);

  if (!slug || !boxId) {
    return null;
  }

  return {
    boxId,
    pityProgress: normalizePityProgress(value.pityProgress),
    slug,
    updatedAt: readString(value.updatedAt),
  };
}

function normalizePityProgress(value: unknown): BoxPityProgress {
  if (!isRecord(value)) {
    return null;
  }

  const ruleId = readString(value.ruleId);

  if (!ruleId) {
    return null;
  }

  return {
    ruleId,
    threshold: readNumber(value.threshold),
    currentCount: readNumber(value.currentCount),
    totalDraws: readNumber(value.totalDraws),
    remainingToGuaranteed: readNumber(value.remainingToGuaranteed),
    targetRarity: readString(value.targetRarity) ?? "rare",
    guaranteedNext: value.guaranteedNext === true,
    updatedAt: readString(value.updatedAt),
  };
}

function resolveStorage(): CacheStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isCachedItem(value: CachedBoxPityItem | null): value is CachedBoxPityItem {
  return value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return Math.trunc(Number(value));
  }

  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
