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
  PaymentSupportConfig,
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
        "X-Idempotency-Key": idempotencyKey,
      },
    },
  );

  return normalizeCreateOpenOrderResponse(response, input.drawCount);
}

export async function fetchDrawResult(
  orderId: string,
): Promise<DrawResultResponse> {
  return fetchBoxOrderResult(orderId, true);
}

export async function fetchPaymentStatus(
  orderId: string,
): Promise<DrawResultResponse> {
  const params = new URLSearchParams({
    orderId,
  });
  const response = await apiRequest<unknown>(
    `${API_ENDPOINTS.boxes.paymentStatus}?${params.toString()}`,
    {
      method: "GET",
    },
  );

  return normalizePaymentStatusResponse(response, orderId);
}

export async function fetchPaymentSupportConfig(): Promise<PaymentSupportConfig> {
  const response = await apiRequest<unknown>(
    API_ENDPOINTS.telegram.paymentSupport,
    {
      method: "GET",
    },
  );

  return normalizePaymentSupportConfig(response);
}

async function fetchBoxOrderResult(
  orderId: string,
  includeItems: boolean,
): Promise<DrawResultResponse> {
  const params = new URLSearchParams({
    orderId,
    includeItems: includeItems ? "true" : "false",
  });
  const response = await apiRequest<unknown>(
    `${API_ENDPOINTS.boxes.paymentStatus}?${params.toString()}`,
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

function normalizePaymentSupportConfig(
  response: unknown,
): PaymentSupportConfig {
  const payload = isRecord(response) ? response : {};
  const supportUrl =
    readString(payload.supportUrl) ?? readString(payload.support_url);
  const supportEmail =
    readString(payload.supportEmail) ?? readString(payload.support_email);
  const configured =
    readBoolean(payload.configured) === true &&
    (supportUrl !== null || supportEmail !== null);

  return {
    configured,
    supportEmail: configured ? supportEmail : null,
    supportUrl: configured ? supportUrl : null,
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
    stockStatus: "unlimited",
    totalStock: null,
    remainingStock: null,
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
  const orderStatus =
    readString(payload.orderStatus) ??
    readString(payload.order_status) ??
    "pending_payment";
  const paymentOrderStatus =
    readPaymentOrderStatus(payload, orderStatus) ?? "created";
  const paymentStatus =
    normalizePaymentOrderStatus(
      payload.paymentStatus ?? payload.payment_status,
    ) ?? paymentOrderStatus;

  return {
    orderId: readString(payload.orderId) ?? readString(payload.order_id) ?? "",
    starOrderId:
      readString(payload.starOrderId) ?? readString(payload.star_order_id),
    invoicePayload:
      readString(payload.invoicePayload) ?? readString(payload.invoice_payload),
    invoiceLink:
      readString(payload.invoiceLink) ?? readString(payload.invoice_link),
    invoiceOpenMode:
      readString(payload.invoiceOpenMode) ??
      readString(payload.invoice_open_mode),
    xtrAmount:
      readNumber(payload.xtrAmount) ?? readNumber(payload.xtr_amount) ?? 0,
    drawCount:
      normalizeDrawCount(payload.drawCount ?? payload.draw_count) ??
      fallbackDrawCount,
    orderStatus,
    paymentStatus,
    paymentOrderStatus,
    expiresAt: readString(payload.expiresAt) ?? readString(payload.expires_at),
    paidAt: readString(payload.paidAt) ?? readString(payload.paid_at),
    fulfilledAt:
      readString(payload.fulfilledAt) ?? readString(payload.fulfilled_at),
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
  const orderStatus =
    readString(payload.orderStatus) ??
    readString(payload.order_status) ??
    "unknown";
  const paidAt =
    readString(payload.paidAt) ??
    readString(payload.paid_at) ??
    readString(payment.paidAt) ??
    readString(payment.paid_at);
  const paymentOrderStatus = readPaymentOrderStatus(
    payload,
    orderStatus,
    payment,
  );

  return {
    orderId:
      readString(payload.orderId) ??
      readString(payload.order_id) ??
      fallbackOrderId,
    status,
    orderStatus,
    quantity:
      readNumber(payload.drawCount) ??
      readNumber(payload.draw_count) ??
      readNumber(payload.quantity) ??
      rawResults.length,
    paidStars:
      readNumber(payload.paidStars) ?? readNumber(payload.paid_stars) ?? 0,
    returnedKcoin:
      readNumber(payload.returnedKcoin) ??
      readNumber(payload.returned_kcoin) ??
      0,
    invoicePayload:
      readString(payload.invoicePayload) ?? readString(payload.invoice_payload),
    paidAt,
    completedAt:
      readString(payload.completedAt) ?? readString(payload.completed_at),
    boxName:
      readString(payload.boxName) ??
      readString(payload.box_name) ??
      readString(box.displayName) ??
      readString(box.display_name),
    paymentStatus: toPaymentDisplayStatus(paymentOrderStatus, paidAt),
    paymentOrderStatus,
    balances: normalizeDrawResultBalances(payload.balances),
    results: rawResults.map(normalizeDrawResultItem),
    serverTime:
      readString(payload.serverTime) ?? readString(payload.server_time),
  };
}

function normalizePaymentStatusResponse(
  response: unknown,
  fallbackOrderId: string,
): DrawResultResponse {
  const payload = isRecord(response) ? response : {};
  const drawOrder = isRecord(payload.drawOrder)
    ? payload.drawOrder
    : isRecord(payload.draw_order)
      ? payload.draw_order
      : {};
  const payment = isRecord(payload.payment) ? payload.payment : {};
  const starOrder = isRecord(payload.starOrder)
    ? payload.starOrder
    : isRecord(payload.star_order)
      ? payload.star_order
      : {};
  const fulfillment = isRecord(payload.fulfillment) ? payload.fulfillment : {};
  const orderStatus =
    readString(drawOrder.status) ??
    readString(payload.orderStatus) ??
    readString(payload.order_status) ??
    "unknown";
  const paidAt =
    readString(payment.paidAt) ??
    readString(payment.paid_at) ??
    readString(starOrder.paidAt) ??
    readString(starOrder.paid_at) ??
    readString(drawOrder.paidAt) ??
    readString(drawOrder.paid_at);
  const completedAt =
    readString(fulfillment.completedAt) ??
    readString(fulfillment.completed_at) ??
    readString(starOrder.fulfilledAt) ??
    readString(starOrder.fulfilled_at) ??
    readString(drawOrder.completedAt) ??
    readString(drawOrder.completed_at);
  const paymentOrderStatus =
    readPaymentOrderStatus(payload, orderStatus, payment) ??
    normalizePaymentOrderStatus(starOrder.paymentOrderStatus) ??
    normalizePaymentOrderStatus(starOrder.payment_order_status) ??
    normalizePaymentOrderStatus(starOrder.status) ??
    normalizePaymentOrderStatus(fulfillment.status);

  return {
    orderId:
      readString(payload.orderId) ??
      readString(payload.order_id) ??
      readString(drawOrder.id) ??
      fallbackOrderId,
    status:
      readBoolean(payload.resultReady) === true ||
      readBoolean(payload.result_ready) === true
        ? "completed"
        : "pending",
    orderStatus,
    quantity:
      readNumber(drawOrder.drawCount) ??
      readNumber(drawOrder.draw_count) ??
      readNumber(drawOrder.quantity) ??
      0,
    paidStars:
      readNumber(drawOrder.totalPriceStars) ??
      readNumber(drawOrder.total_price_stars) ??
      readNumber(payment.xtrAmount) ??
      readNumber(payment.xtr_amount) ??
      readNumber(starOrder.xtrAmount) ??
      readNumber(starOrder.xtr_amount) ??
      0,
    returnedKcoin:
      readNumber(drawOrder.returnedKcoin) ??
      readNumber(drawOrder.returned_kcoin) ??
      0,
    invoicePayload:
      readString(payload.invoicePayload) ?? readString(payload.invoice_payload),
    paidAt,
    completedAt,
    boxName: null,
    paymentStatus: toPaymentDisplayStatus(paymentOrderStatus, paidAt),
    paymentOrderStatus,
    balances: null,
    results: [],
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
    normalized === "draft" ||
    normalized === "not_started" ||
    normalized === "active" ||
    normalized === "paused" ||
    normalized === "sold_out" ||
    normalized === "ended" ||
    normalized === "archived"
  ) {
    return normalized;
  }

  return "paused";
}

function normalizeDrawCount(value: unknown): 1 | 10 | null {
  const numberValue = readNumber(value);

  if (numberValue === 1 || numberValue === 10) {
    return numberValue;
  }

  return null;
}

const PAYMENT_ORDER_STATUS_ALIASES: Readonly<Record<string, string>> = {
  canceled: "cancelled",
  completed: "fulfilled",
  dev_paid: "fulfilled",
  opened: "fulfilled",
  opening: "fulfilling",
  paid_and_fulfilled: "fulfilled",
  paid_waiting: "paid_waiting_fulfillment",
  pending: "created",
  pending_payment: "invoice_created",
  precheckout_ok: "precheckout_checked",
  processing: "fulfilling",
};

function readPaymentOrderStatus(
  payload: Record<string, unknown>,
  orderStatus: string | null | undefined,
  payment?: Record<string, unknown>,
): string | null {
  return (
    normalizePaymentOrderStatus(
      payload.paymentOrderStatus ?? payload.payment_order_status,
    ) ??
    normalizePaymentOrderStatus(
      payload.paymentStatus ?? payload.payment_status,
    ) ??
    normalizePaymentOrderStatus(
      payment?.paymentOrderStatus ?? payment?.payment_order_status,
    ) ??
    normalizePaymentOrderStatus(payment?.status) ??
    inferPaymentOrderStatusFromOrderStatus(orderStatus)
  );
}

function normalizePaymentOrderStatus(value: unknown): string | null {
  const normalized = readString(value)?.toLowerCase();

  if (!normalized) {
    return null;
  }

  return PAYMENT_ORDER_STATUS_ALIASES[normalized] ?? normalized;
}

function inferPaymentOrderStatusFromOrderStatus(value: unknown): string | null {
  const normalized = normalizePaymentOrderStatus(value);

  switch (normalized) {
    case "invoice_created":
    case "created":
      return "created";
    case "paid":
      return "paid";
    case "fulfilling":
      return "fulfilling";
    case "fulfilled":
      return "fulfilled";
    case "failed":
    case "expired":
    case "cancelled":
      return normalized;
    default:
      return null;
  }
}

function toPaymentDisplayStatus(
  paymentOrderStatus: string | null,
  paidAt: string | null,
): string | null {
  if (paymentOrderStatus === "failed" && paidAt) {
    return "fulfillment_failed_retrying";
  }

  return paymentOrderStatus;
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
