import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import type {
  CollectionForm,
  CollectionInventoryItem,
  CollectionInventoryResponse,
  CollectionRarity,
  CollectionSeries,
} from "./collection.types";

const RARITY_LABELS: Record<string, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};

export async function fetchInventory(): Promise<CollectionInventoryResponse> {
  const params = new URLSearchParams({
    limit: "40",
  });
  const response = await apiRequest<unknown>(
    `${API_ENDPOINTS.inventory.list}?${params.toString()}`,
    {
      method: "GET",
    },
  );

  return normalizeInventoryResponse(response);
}

export function normalizeInventoryResponse(
  response: unknown,
): CollectionInventoryResponse {
  const payload = isRecord(response) ? response : {};
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeInventoryItem).filter(isInventoryItem)
    : [];

  return {
    items,
    total: readNumber(payload.total) ?? items.length,
    limit: readNumber(payload.limit) ?? 40,
    offset: readNumber(payload.offset) ?? 0,
    nextCursor:
      readString(payload.nextCursor) ?? readString(payload.next_cursor),
    statuses: Array.isArray(payload.statuses)
      ? payload.statuses.map(readString).filter(isString)
      : [],
    serverTime:
      readString(payload.serverTime) ?? readString(payload.server_time),
  };
}

function normalizeInventoryItem(
  value: unknown,
): CollectionInventoryItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const itemInstanceId =
    readString(value.itemInstanceId) ?? readString(value.item_instance_id);

  if (!itemInstanceId) {
    return null;
  }

  const rarity = normalizeRarity(value.rarity);

  return {
    itemInstanceId,
    templateId: readString(value.templateId) ?? readString(value.template_id),
    templateSlug:
      readString(value.templateSlug) ?? readString(value.template_slug),
    name: readString(value.name) ?? "未命名藏品",
    subtitle: readString(value.subtitle),
    description: readString(value.description),
    rarity,
    series: normalizeSeries(value.series),
    form: normalizeForm(value.form),
    typeCode: readString(value.typeCode) ?? readString(value.type_code),
    serialNo:
      readNullableNumber(value.serialNo) ?? readNullableNumber(value.serial_no),
    level: readNumber(value.level) ?? 1,
    power: readNumber(value.power) ?? 0,
    status: readString(value.status),
    nftMintStatus:
      readString(value.nftMintStatus) ?? readString(value.nft_mint_status),
    imageUrl: readString(value.imageUrl) ?? readString(value.image_url),
    thumbnailUrl:
      readString(value.thumbnailUrl) ?? readString(value.thumbnail_url),
    avatarUrl: readString(value.avatarUrl) ?? readString(value.avatar_url),
    isTradeable:
      readBoolean(value.isTradeable) ??
      readBoolean(value.is_tradeable) ??
      false,
    isUpgradeable:
      readBoolean(value.isUpgradeable) ??
      readBoolean(value.is_upgradeable) ??
      false,
    isEvolvable:
      readBoolean(value.isEvolvable) ??
      readBoolean(value.is_evolvable) ??
      false,
    isDecomposable:
      readBoolean(value.isDecomposable) ??
      readBoolean(value.is_decomposable) ??
      false,
    isMintable:
      readBoolean(value.isMintable) ?? readBoolean(value.is_mintable) ?? false,
    sourceType: readString(value.sourceType) ?? readString(value.source_type),
    sourceId: readString(value.sourceId) ?? readString(value.source_id),
    obtainedAt: readString(value.obtainedAt) ?? readString(value.obtained_at),
  };
}

function normalizeRarity(value: unknown): CollectionRarity {
  const record = isRecord(value) ? value : {};
  const rawCode = readString(record.code) ?? readString(value);
  const code = rawCode ? rawCode.toLowerCase() : "common";
  const displayName =
    readString(record.displayName) ??
    readString(record.display_name) ??
    readString(record.label);

  return {
    code,
    label: displayName ?? RARITY_LABELS[code] ?? code,
    sortOrder:
      readNullableNumber(record.sortOrder) ??
      readNullableNumber(record.sort_order),
  };
}

function normalizeSeries(value: unknown): CollectionSeries | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    id: readString(value.id),
    slug: readString(value.slug),
    displayName:
      readString(value.displayName) ?? readString(value.display_name),
  };
}

function normalizeForm(value: unknown): CollectionForm | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    id: readString(value.id),
    index: readNullableNumber(value.index),
    displayName:
      readString(value.displayName) ?? readString(value.display_name),
  };
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

function readNullableNumber(value: unknown): number | null {
  return value === null ? null : readNumber(value);
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: string | null): value is string {
  return value !== null;
}

function isInventoryItem(
  item: CollectionInventoryItem | null,
): item is CollectionInventoryItem {
  return item !== null;
}
