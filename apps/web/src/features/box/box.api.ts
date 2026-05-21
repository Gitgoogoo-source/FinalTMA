import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import type {
  BlindBox,
  BoxListResponse,
  BoxPityProgress,
  BoxRewardsResponse,
  BoxRewardPreviewItem,
  BoxStatus,
  CreateOpenOrderInput,
  CreateOpenOrderResponse,
  DrawResultBalances,
  DrawResultItem,
  DrawResultResponse,
} from "./box.types";

export async function fetchBoxes(): Promise<BoxListResponse> {
  const params = new URLSearchParams({
    limit: "20",
  });
  const response = await apiRequest<unknown>(
    `${API_ENDPOINTS.boxes.list}?${params.toString()}`,
    {
      method: "GET",
    },
  );

  return normalizeBoxListResponse(response);
}

export async function fetchBoxRewards(
  boxId: string,
): Promise<BoxRewardsResponse> {
  const params = new URLSearchParams({
    boxId,
    includeSoldOut: "true",
  });
  const response = await apiRequest<unknown>(
    `${API_ENDPOINTS.boxes.rewards}?${params.toString()}`,
    {
      method: "GET",
    },
  );

  return normalizeBoxRewardsResponse(response);
}

export async function createOpenOrder(
  input: CreateOpenOrderInput,
): Promise<CreateOpenOrderResponse> {
  const idempotencyKey = createIdempotencyKey(input.drawCount);
  const body: Record<string, unknown> = {
    box_id: input.boxId,
    draw_count: input.drawCount,
    payment_provider: "telegram_stars",
    expected_price_stars: input.expectedPriceStars,
    idempotency_key: idempotencyKey,
    client_context: {
      source: "box_page",
      clientOrderNonce: idempotencyKey,
    },
  };

  if (input.expectedPoolVersionId) {
    body.expected_pool_version_id = input.expectedPoolVersionId;
  }

  const response = await apiRequest<unknown>(
    API_ENDPOINTS.boxes.createOpenOrder,
    {
      method: "POST",
      body,
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
    },
  );

  return normalizeCreateOpenOrderResponse(response, input.drawCount);
}

export async function fetchDrawResult(
  orderId: string,
): Promise<DrawResultResponse> {
  const params = new URLSearchParams({
    orderId,
    includeItems: "true",
  });
  const response = await apiRequest<unknown>(
    `${API_ENDPOINTS.boxes.result}?${params.toString()}`,
    {
      method: "GET",
    },
  );

  return normalizeDrawResultResponse(response, orderId);
}

function normalizeBoxListResponse(response: unknown): BoxListResponse {
  const payload = isRecord(response) ? response : {};
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeBlindBox).filter(isBlindBox)
    : [];

  return {
    items,
    nextCursor:
      readString(payload.nextCursor) ?? readString(payload.next_cursor),
    serverTime:
      readString(payload.serverTime) ?? readString(payload.server_time),
  };
}

function normalizeBlindBox(value: unknown): BlindBox | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id) ?? readString(value.box_id);
  const name =
    readString(value.name) ??
    readString(value.displayName) ??
    readString(value.display_name);

  if (!id || !name) {
    return null;
  }

  return {
    id,
    slug: readString(value.slug) ?? id,
    name,
    description: readString(value.description),
    tier: readString(value.tier) ?? "normal",
    status: normalizeBoxStatus(value.status),
    singleStarPrice:
      readNumber(value.singleStarPrice) ??
      readNumber(value.single_star_price) ??
      0,
    tenDrawPrice:
      readNumber(value.tenDrawPrice) ?? readNumber(value.ten_draw_price) ?? 0,
    discountRate:
      readNumber(value.discountRate) ?? readNumber(value.discount_rate) ?? 0.9,
    discountBps:
      readNumber(value.discountBps) ?? readNumber(value.discount_bps) ?? 1000,
    stockStatus: normalizeStockStatus(
      readString(value.stockStatus) ?? readString(value.stock_status),
    ),
    totalStock:
      readNullableNumber(value.totalStock) ??
      readNullableNumber(value.total_stock),
    remainingStock:
      readNullableNumber(value.remainingStock) ??
      readNullableNumber(value.remaining_stock),
    pityProgress: normalizePityProgress(
      value.pityProgress ?? value.pity_progress,
    ),
    heroImageUrl:
      readString(value.heroImageUrl) ?? readString(value.hero_image_url),
    coverImageUrl:
      readString(value.coverImageUrl) ?? readString(value.cover_image_url),
    isOpenable:
      readBoolean(value.isOpenable) ?? readBoolean(value.is_openable) ?? false,
    disabledReason:
      readString(value.disabledReason) ?? readString(value.disabled_reason),
    kcoinReturnPerDraw:
      readNumber(value.kcoinReturnPerDraw) ??
      readNumber(value.kcoin_return_per_draw) ??
      0,
    sortOrder: readNumber(value.sortOrder) ?? readNumber(value.sort_order) ?? 0,
    updatedAt: readString(value.updatedAt) ?? readString(value.updated_at),
  };
}

function normalizePityProgress(value: unknown): BoxPityProgress {
  if (!isRecord(value)) {
    return null;
  }

  const ruleId = readString(value.ruleId) ?? readString(value.rule_id);

  if (!ruleId) {
    return null;
  }

  return {
    ruleId,
    threshold: readNumber(value.threshold) ?? 0,
    currentCount:
      readNumber(value.currentCount) ?? readNumber(value.current_count) ?? 0,
    totalDraws:
      readNumber(value.totalDraws) ?? readNumber(value.total_draws) ?? 0,
    remainingToGuaranteed:
      readNumber(value.remainingToGuaranteed) ??
      readNumber(value.remaining_to_guaranteed) ??
      0,
    targetRarity:
      readString(value.targetRarity) ??
      readString(value.target_rarity) ??
      "rare",
    guaranteedNext:
      readBoolean(value.guaranteedNext) ??
      readBoolean(value.guaranteed_next) ??
      false,
    updatedAt: readString(value.updatedAt) ?? readString(value.updated_at),
  };
}

function normalizeBoxRewardsResponse(response: unknown): BoxRewardsResponse {
  const payload = isRecord(response) ? response : {};
  const boxId = readString(payload.boxId) ?? readString(payload.box_id) ?? "";
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeRewardItem).filter(isRewardItem)
    : [];

  return {
    boxId,
    boxSlug: readString(payload.boxSlug) ?? readString(payload.box_slug),
    boxName:
      readString(payload.boxName) ?? readString(payload.box_name) ?? "盲盒",
    boxStatus: normalizeBoxStatus(payload.boxStatus ?? payload.box_status),
    poolVersionId:
      readString(payload.poolVersionId) ??
      readString(payload.pool_version_id) ??
      "",
    poolVersion:
      readNumber(payload.poolVersion) ?? readNumber(payload.pool_version) ?? 0,
    items,
    pityRule: normalizePityRule(payload.pityRule ?? payload.pity_rule),
    generatedAt:
      readString(payload.generatedAt) ?? readString(payload.generated_at),
  };
}

function normalizeRewardItem(value: unknown): BoxRewardPreviewItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const poolItemId =
    readString(value.poolItemId) ?? readString(value.pool_item_id);
  const templateId =
    readString(value.templateId) ?? readString(value.template_id);
  const name = readString(value.name);

  if (!poolItemId || !templateId || !name) {
    return null;
  }

  return {
    poolItemId,
    templateId,
    formId: readString(value.formId) ?? readString(value.form_id),
    name,
    description: readString(value.description),
    rarity: readString(value.rarity) ?? "common",
    rarityLabel:
      readString(value.rarityLabel) ?? readString(value.rarity_label) ?? "普通",
    itemType: readString(value.itemType) ?? readString(value.item_type),
    itemTypeLabel:
      readString(value.itemTypeLabel) ?? readString(value.item_type_label),
    imageUrl: readString(value.imageUrl) ?? readString(value.image_url),
    displayProbability:
      readString(value.displayProbability) ??
      readString(value.display_probability) ??
      "0%",
    probabilityBps:
      readNumber(value.probabilityBps) ??
      readNumber(value.probability_bps) ??
      0,
    remainingStock:
      readNullableNumber(value.remainingStock) ??
      readNullableNumber(value.remaining_stock),
    isLimited:
      readBoolean(value.isLimited) ?? readBoolean(value.is_limited) ?? false,
    isPityEligible:
      readBoolean(value.isPityEligible) ??
      readBoolean(value.is_pity_eligible) ??
      false,
    isFeatured:
      readBoolean(value.isFeatured) ?? readBoolean(value.is_featured) ?? false,
  };
}

function normalizePityRule(value: unknown): BoxRewardsResponse["pityRule"] {
  if (!isRecord(value)) {
    return null;
  }

  const threshold = readNumber(value.threshold);
  const targetRarity =
    readString(value.targetRarity) ?? readString(value.target_rarity);
  const description = readString(value.description);

  if (threshold === null || !targetRarity || !description) {
    return null;
  }

  return {
    threshold,
    targetRarity,
    description,
  };
}

function normalizeCreateOpenOrderResponse(
  response: unknown,
  fallbackDrawCount: 1 | 10,
): CreateOpenOrderResponse {
  const payload = isRecord(response) ? response : {};

  return {
    orderId: readString(payload.orderId) ?? readString(payload.order_id) ?? "",
    starOrderId:
      readString(payload.starOrderId) ?? readString(payload.star_order_id),
    invoicePayload:
      readString(payload.invoicePayload) ?? readString(payload.invoice_payload),
    xtrAmount:
      readNumber(payload.xtrAmount) ?? readNumber(payload.xtr_amount) ?? 0,
    drawCount:
      normalizeDrawCount(payload.drawCount ?? payload.draw_count) ??
      fallbackDrawCount,
    orderStatus:
      readString(payload.orderStatus) ??
      readString(payload.order_status) ??
      "pending_payment",
    paymentStatus:
      readString(payload.paymentStatus) ??
      readString(payload.payment_status) ??
      "pending_payment",
    devPaymentProcessed:
      readBoolean(payload.devPaymentProcessed) ??
      readBoolean(payload.dev_payment_processed) ??
      false,
    idempotent: readBoolean(payload.idempotent) ?? false,
    resultReady:
      readBoolean(payload.resultReady) ??
      readBoolean(payload.result_ready) ??
      false,
  };
}

function normalizeDrawResultResponse(
  response: unknown,
  fallbackOrderId: string,
): DrawResultResponse {
  const payload = isRecord(response) ? response : {};
  const box = isRecord(payload.box) ? payload.box : {};
  const payment = isRecord(payload.payment) ? payload.payment : {};
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const status =
    readString(payload.status) === "completed" ? "completed" : "pending";

  return {
    orderId:
      readString(payload.orderId) ??
      readString(payload.order_id) ??
      fallbackOrderId,
    status,
    orderStatus:
      readString(payload.orderStatus) ??
      readString(payload.order_status) ??
      "unknown",
    quantity: readNumber(payload.quantity) ?? rawResults.length,
    paidStars:
      readNumber(payload.paidStars) ?? readNumber(payload.paid_stars) ?? 0,
    returnedKcoin:
      readNumber(payload.returnedKcoin) ??
      readNumber(payload.returned_kcoin) ??
      0,
    invoicePayload:
      readString(payload.invoicePayload) ?? readString(payload.invoice_payload),
    paidAt: readString(payload.paidAt) ?? readString(payload.paid_at),
    completedAt:
      readString(payload.completedAt) ?? readString(payload.completed_at),
    boxName:
      readString(payload.boxName) ??
      readString(payload.box_name) ??
      readString(box.displayName) ??
      readString(box.display_name),
    paymentStatus:
      readString(payload.paymentStatus) ??
      readString(payload.payment_status) ??
      readString(payment.status),
    balances: normalizeDrawResultBalances(payload.balances),
    results: rawResults.map(normalizeDrawResultItem),
    serverTime:
      readString(payload.serverTime) ?? readString(payload.server_time),
  };
}

function normalizeDrawResultBalances(
  value: unknown,
): DrawResultBalances | null {
  if (!isRecord(value)) {
    return null;
  }

  const balances = {
    kcoin: readBalanceAmount(value.kcoin ?? value.KCOIN),
    fgems: readBalanceAmount(value.fgems ?? value.FGEMS),
    stars: readBalanceAmount(value.stars ?? value.STAR_DISPLAY),
  };

  if (!balances.kcoin && !balances.fgems && !balances.stars) {
    return null;
  }

  return balances;
}

function readBalanceAmount(value: unknown): string | null {
  if (isRecord(value)) {
    return readString(value.available) ?? readNumberAsString(value.available);
  }

  return readString(value) ?? readNumberAsString(value);
}

function normalizeDrawResultItem(value: unknown): DrawResultItem {
  const item = isRecord(value) ? value : {};

  return {
    drawIndex: readNumber(item.drawIndex) ?? readNumber(item.draw_index) ?? 0,
    rewardSource:
      readString(item.rewardSource) ??
      readString(item.reward_source) ??
      "random",
    isPityHit:
      readBoolean(item.isPityHit) ?? readBoolean(item.is_pity_hit) ?? false,
    itemInstanceId:
      readString(item.itemInstanceId) ?? readString(item.item_instance_id),
    templateId: readString(item.templateId) ?? readString(item.template_id),
    templateSlug:
      readString(item.templateSlug) ?? readString(item.template_slug),
    name: readString(item.name) ?? "未知奖励",
    subtitle: readString(item.subtitle),
    description: readString(item.description),
    serialNumber:
      readNullableNumber(item.serialNumber) ??
      readNullableNumber(item.serial_number),
    rarity: readString(item.rarity),
    rarityLabel: readString(item.rarityLabel) ?? readString(item.rarity_label),
    itemType: readString(item.itemType) ?? readString(item.item_type),
    formId: readString(item.formId) ?? readString(item.form_id),
    formIndex:
      readNullableNumber(item.formIndex) ?? readNullableNumber(item.form_index),
    formName: readString(item.formName) ?? readString(item.form_name),
    imageUrl: readString(item.imageUrl) ?? readString(item.image_url),
    thumbnailUrl:
      readString(item.thumbnailUrl) ?? readString(item.thumbnail_url),
    level: readNumber(item.level) ?? 0,
    power: readNumber(item.power) ?? 0,
  };
}

function normalizeBoxStatus(value: unknown): BoxStatus {
  const normalized = readString(value);

  if (
    normalized === "not_started" ||
    normalized === "active" ||
    normalized === "paused" ||
    normalized === "ended" ||
    normalized === "sold_out" ||
    normalized === "hidden"
  ) {
    return normalized;
  }

  return "paused";
}

function normalizeStockStatus(value: string | null) {
  if (
    value === "available" ||
    value === "low_stock" ||
    value === "sold_out" ||
    value === "unlimited"
  ) {
    return value;
  }

  return "available";
}

function normalizeDrawCount(value: unknown): 1 | 10 | null {
  const numberValue = readNumber(value);

  if (numberValue === 1 || numberValue === 10) {
    return numberValue;
  }

  return null;
}

function createIdempotencyKey(drawCount: 1 | 10): string {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `box:${drawCount}:${randomPart}`;
}

function isBlindBox(value: BlindBox | null): value is BlindBox {
  return value !== null;
}

function isRewardItem(
  value: BoxRewardPreviewItem | null,
): value is BoxRewardPreviewItem {
  return value !== null;
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
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

function readNumberAsString(value: unknown): string | null {
  const numberValue = readNumber(value);

  if (numberValue === null) {
    return null;
  }

  return String(numberValue);
}

function readNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return readNumber(value);
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
