import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import type {
  AlbumBook,
  AlbumItem,
  AlbumMilestone,
  AlbumProgress,
  AlbumProgressQuery,
  AlbumRaritySummaryItem,
  AlbumReward,
  AlbumSeriesQuery,
  AlbumSeriesResponse,
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

export async function fetchAlbumSeries(
  query: AlbumSeriesQuery = {},
): Promise<AlbumSeriesResponse> {
  const params = buildAlbumSeriesParams(query);
  const queryString = params.toString();
  const response = await apiRequest<unknown>(
    queryString
      ? `${API_ENDPOINTS.album.series}?${queryString}`
      : API_ENDPOINTS.album.series,
    {
      method: "GET",
    },
  );

  return normalizeAlbumSeriesResponse(response);
}

export function normalizeAlbumProgress(response: unknown): AlbumProgress {
  const payload = isRecord(response) ? response : {};
  const book = normalizeAlbumBook(payload.book);

  return {
    book,
    items: Array.isArray(payload.items)
      ? payload.items.map(normalizeAlbumItem).filter(isAlbumItem)
      : [],
    milestones: Array.isArray(payload.milestones)
      ? payload.milestones.map(normalizeAlbumMilestone).filter(isAlbumMilestone)
      : [],
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

export function normalizeAlbumSeriesResponse(
  response: unknown,
): AlbumSeriesResponse {
  const payload = isRecord(response) ? response : {};

  return {
    books: Array.isArray(payload.books)
      ? payload.books.map(normalizeAlbumBook).filter(isAlbumBook)
      : [],
    total: readNumber(payload.total) ?? 0,
    limit: readNumber(payload.limit) ?? 0,
    offset: readNumber(payload.offset) ?? 0,
    nextCursor:
      readString(payload.nextCursor) ?? readString(payload.next_cursor),
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

function buildAlbumSeriesParams(query: AlbumSeriesQuery): URLSearchParams {
  const params = new URLSearchParams();

  appendStringParam(params, "book_type", query.bookType);
  appendArrayParam(params, "series_ids", query.seriesIds);
  appendArrayParam(params, "faction_ids", query.factionIds);
  appendArrayParam(params, "rarities", query.rarities);
  appendStringParam(params, "cursor", query.cursor);
  appendNumberParam(params, "limit", query.limit);

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

function appendArrayParam(
  params: URLSearchParams,
  key: string,
  value: string[] | undefined,
): void {
  const items = value?.map((item) => item.trim()).filter(Boolean) ?? [];

  if (items.length > 0) {
    params.set(key, items.join(","));
  }
}

function appendNumberParam(
  params: URLSearchParams,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isFinite(value)) {
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

function normalizeAlbumItem(value: unknown): AlbumItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const templateId =
    readString(value.template_id) ?? readString(value.templateId);
  const name = readString(value.name);
  const rarity = readString(value.rarity);
  const type = readString(value.type);

  if (!templateId || !name || !rarity || !type) {
    return null;
  }

  return {
    templateId,
    formId: readString(value.form_id) ?? readString(value.formId),
    name,
    description: readString(value.description),
    rarity,
    type,
    seriesId: readString(value.series_id) ?? readString(value.seriesId),
    seriesName: readString(value.series_name) ?? readString(value.seriesName),
    factionId: readString(value.faction_id) ?? readString(value.factionId),
    factionName:
      readString(value.faction_name) ?? readString(value.factionName),
    imageUrl: readString(value.image_url) ?? readString(value.imageUrl),
    thumbUrl: readString(value.thumb_url) ?? readString(value.thumbUrl),
    isCollected:
      readBoolean(value.is_collected) ??
      readBoolean(value.isCollected) ??
      false,
    firstCollectedAt:
      readString(value.first_collected_at) ??
      readString(value.firstCollectedAt),
    collectedCount:
      readNumber(value.collected_count) ??
      readNumber(value.collectedCount) ??
      0,
    albumOrder: readNumber(value.album_order) ?? readNumber(value.albumOrder),
  };
}

function normalizeAlbumMilestone(value: unknown): AlbumMilestone | null {
  if (!isRecord(value)) {
    return null;
  }

  const milestoneId =
    readString(value.milestone_id) ?? readString(value.milestoneId);
  const bookId = readString(value.book_id) ?? readString(value.bookId);
  const status = readString(value.status);

  if (!milestoneId || !bookId || !status) {
    return null;
  }

  return {
    milestoneId,
    bookId,
    requiredCount:
      readNumber(value.required_count) ?? readNumber(value.requiredCount) ?? 0,
    requiredPercent:
      readNumber(value.required_percent) ?? readNumber(value.requiredPercent),
    title: readString(value.title),
    status,
    rewards: Array.isArray(value.rewards)
      ? value.rewards.map(normalizeAlbumReward).filter(isAlbumReward)
      : [],
    claimedAt: readString(value.claimed_at) ?? readString(value.claimedAt),
    version: readNumber(value.version) ?? 0,
  };
}

function normalizeAlbumReward(value: unknown): AlbumReward | null {
  if (!isRecord(value)) {
    return null;
  }

  const rewardType =
    readString(value.reward_type) ?? readString(value.rewardType);
  const label = readString(value.label);

  if (!rewardType || !label) {
    return null;
  }

  return {
    rewardType,
    amount: readNumber(value.amount),
    templateId: readString(value.template_id) ?? readString(value.templateId),
    label,
    iconUrl: readString(value.icon_url) ?? readString(value.iconUrl),
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

function isAlbumBook(value: AlbumBook | null): value is AlbumBook {
  return value !== null;
}

function isAlbumItem(value: AlbumItem | null): value is AlbumItem {
  return value !== null;
}

function isAlbumMilestone(
  value: AlbumMilestone | null,
): value is AlbumMilestone {
  return value !== null;
}

function isAlbumReward(value: AlbumReward | null): value is AlbumReward {
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
