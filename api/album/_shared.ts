import { RpcError } from "../../packages/server/src/db/rpc.js";
import { ApiError } from "../_shared/handler.js";
import { normalizePublicStorageUrl } from "../_shared/publicStorageUrl.js";

export type JsonRecord = Record<string, unknown>;

export function assertRecordPayload(
  payload: unknown,
  code: string,
  message: string,
): JsonRecord {
  if (!isRecord(payload)) {
    throw new ApiError(500, code, message, {
      expose: false,
      details: { payloadType: typeof payload },
    });
  }

  return payload;
}

export function invalidAlbumResult(
  code: string,
  message: string,
  details?: unknown,
): ApiError {
  return new ApiError(500, code, message, {
    details,
    expose: false,
  });
}

export function getRpcErrorText(error: RpcError): string {
  return [error.message, error.details, error.hint, error.code]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function readInteger(value: unknown): number | null {
  const parsed = readNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

export function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }

  return null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(readString).filter((item): item is string => item !== null);
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeAlbumBook(value: unknown, code: string) {
  const book = isRecord(value) ? value : null;

  if (!book) {
    return null;
  }

  const bookId = readString(book.book_id);
  const bookType = readString(book.book_type);
  const name = readString(book.name);

  if (!bookId || !bookType || !name) {
    throw invalidAlbumResult(code, "图鉴册结果缺少必要字段。", {
      book_id: book.book_id,
      book_type: book.book_type,
      name: book.name,
    });
  }

  const totalCount = readInteger(book.total_count) ?? 0;
  const collectedCount = readInteger(book.collected_count) ?? 0;

  return {
    book_id: bookId,
    book_type: bookType,
    name,
    description: readString(book.description),
    cover_url: normalizePublicStorageUrl(book.cover_url),
    total_count: totalCount,
    collected_count: collectedCount,
    completion_percent:
      readNumber(book.completion_percent) ??
      calculateCompletionPercent(collectedCount, totalCount),
    is_event_limited:
      readBoolean(book.is_event_limited) ?? bookType === "event",
    starts_at: readString(book.starts_at),
    ends_at: readString(book.ends_at),
    code: readString(book.code),
    series_id: readString(book.series_id),
    faction_id: readString(book.faction_id),
    rarity: normalizeCode(book.rarity ?? book.rarity_code),
  };
}

export function normalizeAlbumItem(value: unknown, code: string) {
  const item = isRecord(value) ? value : {};
  const templateId = readString(item.template_id);
  const name = readString(item.name);
  const rarity = normalizeCode(item.rarity);
  const type = normalizeCode(item.type);

  if (!templateId || !name || !rarity || !type) {
    throw invalidAlbumResult(code, "图鉴物品结果缺少必要字段。", {
      template_id: item.template_id,
      name: item.name,
      rarity: item.rarity,
      type: item.type,
    });
  }

  const isCollected = readBoolean(item.is_collected) ?? false;

  return {
    template_id: templateId,
    form_id: readString(item.form_id),
    name,
    description: readString(item.description),
    rarity,
    type,
    series_id: readString(item.series_id),
    series_name: readString(item.series_name),
    faction_id: readString(item.faction_id),
    faction_name: readString(item.faction_name),
    image_url: normalizePublicStorageUrl(item.image_url),
    thumb_url: normalizePublicStorageUrl(item.thumb_url),
    is_collected: isCollected,
    first_collected_at: readString(item.first_collected_at),
    collected_count: readInteger(item.collected_count) ?? (isCollected ? 1 : 0),
    album_order: readInteger(item.album_order),
  };
}

export function normalizeAlbumMilestone(value: unknown, code: string) {
  const milestone = isRecord(value) ? value : {};
  const milestoneId = readString(milestone.milestone_id);
  const bookId = readString(milestone.book_id);
  const status = normalizeCode(milestone.status);

  if (!milestoneId || !bookId || !status) {
    throw invalidAlbumResult(code, "图鉴里程碑结果缺少必要字段。", {
      milestone_id: milestone.milestone_id,
      book_id: milestone.book_id,
      status: milestone.status,
    });
  }

  return {
    milestone_id: milestoneId,
    book_id: bookId,
    required_count: readInteger(milestone.required_count) ?? 0,
    required_percent: readNumber(milestone.required_percent),
    title: readString(milestone.title),
    status,
    rewards: Array.isArray(milestone.rewards)
      ? milestone.rewards.map((reward) => normalizeAlbumReward(reward, code))
      : [],
    claimed_at: readString(milestone.claimed_at),
    version: readInteger(milestone.version) ?? 0,
  };
}

export function normalizeAlbumReward(value: unknown, code: string) {
  const reward = isRecord(value) ? value : {};
  const rewardType = readString(reward.reward_type);
  const label = readString(reward.label);

  if (!rewardType || !label) {
    throw invalidAlbumResult(code, "图鉴奖励结果缺少必要字段。", {
      reward_type: reward.reward_type,
      label: reward.label,
    });
  }

  return {
    reward_type: rewardType,
    amount: readInteger(reward.amount),
    template_id: readString(reward.template_id),
    label,
    icon_url: readString(reward.icon_url),
  };
}

export function normalizeRaritySummaryItem(value: unknown, code: string) {
  const item = isRecord(value) ? value : {};
  const rarity = normalizeCode(item.rarity);

  if (!rarity) {
    throw invalidAlbumResult(code, "图鉴稀有度汇总结果缺少必要字段。", {
      rarity: item.rarity,
    });
  }

  return {
    rarity,
    total_count: readInteger(item.total_count) ?? 0,
    collected_count: readInteger(item.collected_count) ?? 0,
  };
}

export function normalizeSeriesSummaryItem(value: unknown) {
  const item = isRecord(value) ? value : {};

  return {
    series_id: readString(item.series_id),
    series_name: readString(item.series_name) ?? "Unknown",
    total_count: readInteger(item.total_count) ?? 0,
    collected_count: readInteger(item.collected_count) ?? 0,
  };
}

export function parseOffsetCursor(
  cursor: string | undefined,
  message: string,
): number {
  if (!cursor) {
    return 0;
  }

  const parsed = Number.parseInt(cursor, 10);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    String(parsed) !== cursor.trim()
  ) {
    throw ApiError.badRequest(message);
  }

  return parsed;
}

function normalizeCode(value: unknown): string | null {
  return readString(value)?.toLowerCase() ?? null;
}

function calculateCompletionPercent(
  collectedCount: number,
  totalCount: number,
): number {
  if (totalCount <= 0) {
    return 0;
  }

  return Math.round((collectedCount / totalCount) * 10_000) / 100;
}
