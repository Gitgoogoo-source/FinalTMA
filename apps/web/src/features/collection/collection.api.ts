import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import type {
  CollectionActiveLock,
  CollectionDecomposePreview,
  CollectionEvolutionPreview,
  CollectionForm,
  CollectionInventoryDetail,
  CollectionInventoryItem,
  CollectionInventoryResponse,
  CollectionMarketStatus,
  CollectionNamedObject,
  CollectionOnchainStatus,
  CollectionRarity,
  CollectionSeries,
  CollectionUpgradePreview,
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

export async function fetchInventoryDetail(
  itemInstanceId: string,
): Promise<CollectionInventoryDetail> {
  const params = new URLSearchParams({
    item_instance_id: itemInstanceId,
    include_market_status: "true",
    include_upgrade_preview: "true",
    include_evolution_preview: "true",
    include_decompose_preview: "true",
    include_onchain_status: "true",
  });
  const response = await apiRequest<unknown>(
    `${API_ENDPOINTS.inventory.detail}?${params.toString()}`,
    {
      method: "GET",
    },
  );

  return normalizeInventoryDetail(response);
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
      readBoolean(value.tradeable) ??
      false,
    isUpgradeable:
      readBoolean(value.isUpgradeable) ??
      readBoolean(value.is_upgradeable) ??
      readBoolean(value.upgradeable) ??
      false,
    isEvolvable:
      readBoolean(value.isEvolvable) ??
      readBoolean(value.is_evolvable) ??
      readBoolean(value.evolvable) ??
      false,
    isDecomposable:
      readBoolean(value.isDecomposable) ??
      readBoolean(value.is_decomposable) ??
      readBoolean(value.decomposable) ??
      false,
    isMintable:
      readBoolean(value.isMintable) ??
      readBoolean(value.is_mintable) ??
      readBoolean(value.nft_mintable) ??
      false,
    sourceType: readString(value.sourceType) ?? readString(value.source_type),
    sourceId: readString(value.sourceId) ?? readString(value.source_id),
    obtainedAt: readString(value.obtainedAt) ?? readString(value.obtained_at),
  };
}

export function normalizeInventoryDetail(
  response: unknown,
): CollectionInventoryDetail {
  const item = normalizeInventoryItem(response);

  if (!item || !isRecord(response)) {
    throw new Error("Invalid inventory detail payload.");
  }

  return {
    ...item,
    formId: readString(response.formId) ?? readString(response.form_id),
    basePower:
      readNullableNumber(response.basePower) ??
      readNullableNumber(response.base_power),
    faction: normalizeNamedObject(response.faction),
    attributes: isRecord(response.attributes) ? response.attributes : {},
    activeLock: normalizeActiveLock(
      response.activeLock ?? response.active_lock,
    ),
    marketStatus: normalizeMarketStatus(
      response.marketStatus ?? response.market_status,
    ),
    onchainStatus: normalizeOnchainStatus(
      response.onchainStatus ?? response.onchain_status,
    ),
    upgradePreview: normalizeUpgradePreview(
      response.upgradePreview ?? response.upgrade_preview,
    ),
    evolutionPreview: normalizeEvolutionPreview(
      response.evolutionPreview ?? response.evolution_preview,
    ),
    decomposePreview: normalizeDecomposePreview(
      response.decomposePreview ?? response.decompose_preview,
    ),
    sameItemCount:
      readNumber(response.sameItemCount) ??
      readNumber(response.same_item_count) ??
      0,
    availableSameItemCount:
      readNumber(response.availableSameItemCount) ??
      readNumber(response.available_same_item_count) ??
      0,
    updatedAt:
      readString(response.updatedAt) ?? readString(response.updated_at),
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
    description: readString(value.description),
  };
}

function normalizeNamedObject(value: unknown): CollectionNamedObject | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    id: readString(value.id),
    code: readString(value.code),
    slug: readString(value.slug),
    displayName:
      readString(value.displayName) ?? readString(value.display_name),
    sortOrder:
      readNullableNumber(value.sortOrder) ??
      readNullableNumber(value.sort_order),
  };
}

function normalizeActiveLock(value: unknown): CollectionActiveLock | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    lockId: readString(value.lockId) ?? readString(value.lock_id),
    reason: readString(value.reason),
    sourceType: readString(value.sourceType) ?? readString(value.source_type),
    sourceId: readString(value.sourceId) ?? readString(value.source_id),
    lockedAt: readString(value.lockedAt) ?? readString(value.locked_at),
    expiresAt: readString(value.expiresAt) ?? readString(value.expires_at),
  };
}

function normalizeMarketStatus(value: unknown): CollectionMarketStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    isListed:
      readBoolean(value.isListed) ?? readBoolean(value.is_listed) ?? false,
    listingId: readString(value.listingId) ?? readString(value.listing_id),
    unitPrice:
      readNullableNumber(value.unitPrice) ??
      readNullableNumber(value.unit_price),
    currency: readString(value.currency),
  };
}

function normalizeOnchainStatus(
  value: unknown,
): CollectionOnchainStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    isMinted:
      readBoolean(value.isMinted) ?? readBoolean(value.is_minted) ?? false,
    mintStatus: readString(value.mintStatus) ?? readString(value.mint_status),
    nftItemAddress:
      readString(value.nftItemAddress) ?? readString(value.nft_item_address),
    ownerWalletAddress:
      readString(value.ownerWalletAddress) ??
      readString(value.owner_wallet_address),
  };
}

function normalizeUpgradePreview(
  value: unknown,
): CollectionUpgradePreview | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    canUpgrade:
      readBoolean(value.canUpgrade) ?? readBoolean(value.can_upgrade) ?? false,
    reason: readString(value.reason),
    currentLevel:
      readNullableNumber(value.currentLevel) ??
      readNullableNumber(value.current_level),
    nextLevel:
      readNullableNumber(value.nextLevel) ??
      readNullableNumber(value.next_level),
    targetLevel:
      readNullableNumber(value.targetLevel) ??
      readNullableNumber(value.target_level),
    currentPower:
      readNullableNumber(value.currentPower) ??
      readNullableNumber(value.current_power),
    powerAfter:
      readNullableNumber(value.powerAfter) ??
      readNullableNumber(value.power_after),
    fgemsCost:
      readNullableNumber(value.fgemsCost) ??
      readNullableNumber(value.fgems_cost),
    userFgemsBalance:
      readNullableNumber(value.userFgemsBalance) ??
      readNullableNumber(value.user_fgems_balance),
    isBalanceEnough:
      readBoolean(value.isBalanceEnough) ??
      readBoolean(value.is_balance_enough),
  };
}

function normalizeEvolutionPreview(
  value: unknown,
): CollectionEvolutionPreview | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    canEvolve:
      readBoolean(value.canEvolve) ?? readBoolean(value.can_evolve) ?? false,
    reason: readString(value.reason),
    requiredCount:
      readNumber(value.requiredCount) ?? readNumber(value.required_count) ?? 3,
    availableSameItems:
      readNullableNumber(value.availableSameItems) ??
      readNullableNumber(value.available_same_items),
    kcoinCost:
      readNullableNumber(value.kcoinCost) ??
      readNullableNumber(value.kcoin_cost),
    userKcoinBalance:
      readNullableNumber(value.userKcoinBalance) ??
      readNullableNumber(value.user_kcoin_balance),
    isBalanceEnough:
      readBoolean(value.isBalanceEnough) ??
      readBoolean(value.is_balance_enough),
    successRateBps:
      readNullableNumber(value.successRateBps) ??
      readNullableNumber(value.success_rate_bps),
    targetTemplateId:
      readString(value.targetTemplateId) ??
      readString(value.target_template_id),
    targetFormId:
      readString(value.targetFormId) ?? readString(value.target_form_id),
    targetName: readString(value.targetName) ?? readString(value.target_name),
    targetImageUrl:
      readString(value.targetImageUrl) ?? readString(value.target_image_url),
    selectedItemIds: readStringArray(
      value.selectedItemIds ?? value.selected_item_ids,
    ),
    mainReturnItemId:
      readString(value.mainReturnItemId) ??
      readString(value.main_return_item_id),
  };
}

function normalizeDecomposePreview(
  value: unknown,
): CollectionDecomposePreview | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    canDecompose:
      readBoolean(value.canDecompose) ??
      readBoolean(value.can_decompose) ??
      false,
    reason: readString(value.reason),
    fgemsReward:
      readNullableNumber(value.fgemsReward) ??
      readNullableNumber(value.fgems_reward),
    totalRewardFgems:
      readNullableNumber(value.totalRewardFgems) ??
      readNullableNumber(value.total_reward_fgems),
    duplicateCount:
      readNullableNumber(value.duplicateCount) ??
      readNullableNumber(value.duplicate_count),
    itemStatus: readString(value.itemStatus) ?? readString(value.item_status),
    itemInstanceIds: readStringArray(
      value.itemInstanceIds ?? value.item_instance_ids,
    ),
    items: Array.isArray(value.items) ? value.items : [],
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(readString).filter((item): item is string => item !== null);
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
