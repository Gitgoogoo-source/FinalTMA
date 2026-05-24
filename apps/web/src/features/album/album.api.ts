import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import type {
  AlbumBook,
  AlbumProgress,
  AlbumProgressQuery,
  AlbumRaritySummaryItem,
  AlbumSeriesSummaryItem,
} from "./album.types";

export async function fetchAlbumProgress(
  query: AlbumProgressQuery = {},
): Promise<AlbumProgress> {
  const params = buildAlbumProgressParams(query);
  const queryString = params.toString();
  const response = await apiRequest<unknown>(
    queryString
      ? `${API_ENDPOINTS.album.progress}?${queryString}`
      : API_ENDPOINTS.album.progress,
    {
      method: "GET",
    },
  );

  return normalizeAlbumProgress(response);
}

export function normalizeAlbumProgress(response: unknown): AlbumProgress {
  const payload = isRecord(response) ? response : {};
  const book = normalizeAlbumBook(payload.book);

  return {
    book,
    raritySummary: Array.isArray(payload.rarity_summary)
      ? payload.rarity_summary
          .map(normalizeRaritySummaryItem)
          .filter(isRaritySummaryItem)
      : [],
    seriesSummary: Array.isArray(payload.series_summary)
      ? payload.series_summary
          .map(normalizeSeriesSummaryItem)
          .filter(isSeriesSummaryItem)
      : [],
    empty: readBoolean(payload.empty) ?? book === null,
    serverTime:
      readString(payload.serverTime) ?? readString(payload.server_time),
  };
}

function buildAlbumProgressParams(query: AlbumProgressQuery): URLSearchParams {
  const params = new URLSearchParams();

  appendStringParam(params, "book_id", query.bookId);
  appendStringParam(params, "book_type", query.bookType);
  appendStringParam(params, "series_id", query.seriesId);
  appendStringParam(params, "faction_id", query.factionId);
  appendStringParam(params, "rarity", query.rarity);
  appendBooleanParam(params, "include_items", query.includeItems);
  appendBooleanParam(params, "include_milestones", query.includeMilestones);
  appendBooleanParam(params, "include_rewards", query.includeRewards);
  appendBooleanParam(params, "include_locked_items", query.includeLockedItems);

  return params;
}

function appendStringParam(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
): void {
  if (value) {
    params.set(key, value);
  }
}

function appendBooleanParam(
  params: URLSearchParams,
  key: string,
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    params.set(key, String(value));
  }
}

function normalizeAlbumBook(value: unknown): AlbumBook | null {
  if (!isRecord(value)) {
    return null;
  }

  const bookId = readString(value.book_id) ?? readString(value.bookId);
  const bookType = readString(value.book_type) ?? readString(value.bookType);
  const name = readString(value.name);

  if (!bookId || !bookType || !name) {
    return null;
  }

  const totalCount =
    readNumber(value.total_count) ?? readNumber(value.totalCount);
  const collectedCount =
    readNumber(value.collected_count) ?? readNumber(value.collectedCount);
  const completionPercent =
    readNumber(value.completion_percent) ??
    readNumber(value.completionPercent) ??
    calculateCompletionPercent(collectedCount ?? 0, totalCount ?? 0);

  return {
    bookId,
    code: readString(value.code),
    bookType,
    name,
    description: readString(value.description),
    coverUrl: readString(value.cover_url) ?? readString(value.coverUrl),
    totalCount: totalCount ?? 0,
    collectedCount: collectedCount ?? 0,
    completionPercent,
    isEventLimited:
      readBoolean(value.is_event_limited) ??
      readBoolean(value.isEventLimited) ??
      bookType === "event",
    startsAt: readString(value.starts_at) ?? readString(value.startsAt),
    endsAt: readString(value.ends_at) ?? readString(value.endsAt),
  };
}

function normalizeRaritySummaryItem(
  value: unknown,
): AlbumRaritySummaryItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const rarity = readString(value.rarity);

  if (!rarity) {
    return null;
  }

  return {
    rarity,
    totalCount:
      readNumber(value.total_count) ?? readNumber(value.totalCount) ?? 0,
    collectedCount:
      readNumber(value.collected_count) ??
      readNumber(value.collectedCount) ??
      0,
  };
}

function normalizeSeriesSummaryItem(
  value: unknown,
): AlbumSeriesSummaryItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const seriesName =
    readString(value.series_name) ?? readString(value.seriesName);

  if (!seriesName) {
    return null;
  }

  return {
    seriesId: readString(value.series_id) ?? readString(value.seriesId),
    seriesName,
    totalCount:
      readNumber(value.total_count) ?? readNumber(value.totalCount) ?? 0,
    collectedCount:
      readNumber(value.collected_count) ??
      readNumber(value.collectedCount) ??
      0,
  };
}

function isRaritySummaryItem(
  value: AlbumRaritySummaryItem | null,
): value is AlbumRaritySummaryItem {
  return value !== null;
}

function isSeriesSummaryItem(
  value: AlbumSeriesSummaryItem | null,
): value is AlbumSeriesSummaryItem {
  return value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function calculateCompletionPercent(
  collectedCount: number,
  totalCount: number,
): number {
  if (totalCount <= 0) {
    return 0;
  }

  return Math.round((collectedCount / totalCount) * 10000) / 100;
}
