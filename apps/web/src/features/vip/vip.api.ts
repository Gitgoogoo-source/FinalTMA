import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import type {
  ClaimVipDailyBenefitInput,
  ClaimVipDailyBenefitResponse,
  ClaimVipFreeBoxInput,
  ClaimVipFreeBoxResponse,
  CreateVipOrderInput,
  CreateVipOrderResponse,
  VipPlan,
  VipStatus,
  VipTodayStatus,
} from "./vip.types";

type JsonRecord = Record<string, unknown>;

export async function fetchVipStatus(): Promise<VipStatus> {
  const response = await apiRequest<unknown>(API_ENDPOINTS.vip.status, {
    method: "GET",
  });

  return normalizeVipStatus(response);
}

export async function createVipOrder(
  input: CreateVipOrderInput,
): Promise<CreateVipOrderResponse> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("vip:create-order");
  const response = await apiRequest<unknown>(API_ENDPOINTS.vip.createOrder, {
    method: "POST",
    body: {
      plan_id: input.planId,
      idempotency_key: idempotencyKey,
    },
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeCreateVipOrderResponse(response);
}

export async function claimVipDailyBenefit(
  input: ClaimVipDailyBenefitInput = {},
): Promise<ClaimVipDailyBenefitResponse> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("vip:claim-daily");
  const response = await apiRequest<unknown>(API_ENDPOINTS.vip.claimDaily, {
    method: "POST",
    body: {
      idempotency_key: idempotencyKey,
    },
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeClaimVipDailyBenefitResponse(response);
}

export async function claimVipFreeBox(
  input: ClaimVipFreeBoxInput = {},
): Promise<ClaimVipFreeBoxResponse> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("vip:claim-free-box");
  const response = await apiRequest<unknown>(API_ENDPOINTS.vip.claimFreeBox, {
    method: "POST",
    body: {
      idempotency_key: idempotencyKey,
    },
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeClaimVipFreeBoxResponse(response);
}

export function normalizeVipStatus(response: unknown): VipStatus {
  const payload = isRecord(response) ? response : {};
  const today = normalizeVipTodayStatus(payload.today);

  return {
    isVip:
      readBoolean(payload.isVip) ??
      readBoolean(payload.is_vip) ??
      readBoolean(payload.active) ??
      false,
    subscriptionId:
      readString(payload.subscriptionId) ?? readString(payload.subscription_id),
    currentPeriodEnd:
      readString(payload.currentPeriodEnd) ??
      readString(payload.current_period_end),
    todayClaimed:
      readBoolean(payload.todayClaimed) ??
      readBoolean(payload.today_claimed) ??
      today?.claimed ??
      false,
    today,
    plan: normalizeVipPlan(
      payload.plan ?? payload.current_plan ?? payload.active_plan,
    ),
    serverTime:
      readString(payload.serverTime) ?? readString(payload.server_time),
  };
}

export function normalizeClaimVipDailyBenefitResponse(
  response: unknown,
): ClaimVipDailyBenefitResponse {
  const payload = isRecord(response) ? response : {};
  const freeBoxCount =
    readNumber(payload.freeBoxCount) ?? readNumber(payload.free_box_count) ?? 0;
  const freeBoxUsedCount =
    readNumber(payload.freeBoxUsedCount) ??
    readNumber(payload.free_box_used_count) ??
    0;
  const remainingFreeBoxCount =
    readNumber(payload.remainingFreeBoxCount) ??
    readNumber(payload.remaining_free_box_count) ??
    Math.max(freeBoxCount - freeBoxUsedCount, 0);
  const fgemsClaimed =
    readBoolean(payload.fgemsClaimed) ??
    readBoolean(payload.fgems_claimed) ??
    true;
  const freeBoxClaimed =
    readBoolean(payload.freeBoxClaimed) ??
    readBoolean(payload.free_box_claimed) ??
    false;

  return {
    claimId: readString(payload.claimId) ?? readString(payload.claim_id) ?? "",
    subscriptionId:
      readString(payload.subscriptionId) ?? readString(payload.subscription_id),
    claimDate: readString(payload.claimDate) ?? readString(payload.claim_date),
    fgemsAmount:
      readNumber(payload.fgemsAmount) ?? readNumber(payload.fgems_amount) ?? 0,
    fgemsLedgerId:
      readString(payload.fgemsLedgerId) ?? readString(payload.fgems_ledger_id),
    fgemsClaimed,
    fgemsClaimedAt:
      readString(payload.fgemsClaimedAt) ??
      readString(payload.fgems_claimed_at),
    freeBoxCount,
    freeBoxUsedCount,
    remainingFreeBoxCount,
    freeBoxAvailable:
      readBoolean(payload.freeBoxAvailable) ??
      readBoolean(payload.free_box_available) ??
      (freeBoxClaimed && remainingFreeBoxCount > 0),
    freeBoxClaimed,
    freeBoxClaimedAt:
      readString(payload.freeBoxClaimedAt) ??
      readString(payload.free_box_claimed_at),
    alreadyClaimed:
      readBoolean(payload.alreadyClaimed) ??
      readBoolean(payload.already_claimed) ??
      false,
    idempotent: readBoolean(payload.idempotent) ?? false,
  };
}

export function normalizeClaimVipFreeBoxResponse(
  response: unknown,
): ClaimVipFreeBoxResponse {
  const payload = isRecord(response) ? response : {};
  const freeBoxCount =
    readNumber(payload.freeBoxCount) ?? readNumber(payload.free_box_count) ?? 0;
  const freeBoxUsedCount =
    readNumber(payload.freeBoxUsedCount) ??
    readNumber(payload.free_box_used_count) ??
    0;
  const remainingFreeBoxCount =
    readNumber(payload.remainingFreeBoxCount) ??
    readNumber(payload.remaining_free_box_count) ??
    Math.max(freeBoxCount - freeBoxUsedCount, 0);
  const freeBoxClaimed =
    readBoolean(payload.freeBoxClaimed) ??
    readBoolean(payload.free_box_claimed) ??
    true;

  return {
    claimId: readString(payload.claimId) ?? readString(payload.claim_id) ?? "",
    subscriptionId:
      readString(payload.subscriptionId) ?? readString(payload.subscription_id),
    claimDate: readString(payload.claimDate) ?? readString(payload.claim_date),
    freeBoxCount,
    freeBoxUsedCount,
    remainingFreeBoxCount,
    freeBoxAvailable:
      readBoolean(payload.freeBoxAvailable) ??
      readBoolean(payload.free_box_available) ??
      (freeBoxClaimed && remainingFreeBoxCount > 0),
    freeBoxClaimed,
    freeBoxClaimedAt:
      readString(payload.freeBoxClaimedAt) ??
      readString(payload.free_box_claimed_at),
    fgemsClaimed:
      readBoolean(payload.fgemsClaimed) ??
      readBoolean(payload.fgems_claimed) ??
      false,
    alreadyClaimed:
      readBoolean(payload.alreadyClaimed) ??
      readBoolean(payload.already_claimed) ??
      false,
    idempotent: readBoolean(payload.idempotent) ?? false,
  };
}

export function normalizeCreateVipOrderResponse(
  response: unknown,
): CreateVipOrderResponse {
  const payload = isRecord(response) ? response : {};
  const orderStatus =
    readString(payload.orderStatus) ??
    readString(payload.order_status) ??
    "created";
  const paymentOrderStatus =
    readString(payload.paymentOrderStatus) ??
    readString(payload.payment_order_status) ??
    readString(payload.starOrderStatus) ??
    readString(payload.star_order_status) ??
    orderStatus;

  return {
    orderId:
      readString(payload.orderId) ??
      readString(payload.order_id) ??
      readString(payload.vipOrderId) ??
      readString(payload.vip_order_id) ??
      "",
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
    orderStatus,
    paymentStatus:
      readString(payload.paymentStatus) ??
      readString(payload.payment_status) ??
      paymentOrderStatus,
    paymentOrderStatus,
    expiresAt: readString(payload.expiresAt) ?? readString(payload.expires_at),
    paidAt: readString(payload.paidAt) ?? readString(payload.paid_at),
    fulfilledAt:
      readString(payload.fulfilledAt) ?? readString(payload.fulfilled_at),
    idempotent: readBoolean(payload.idempotent) ?? false,
  };
}

function normalizeVipPlan(value: unknown): VipPlan | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id) ?? readString(value.plan_id);

  if (!id) {
    return null;
  }

  return {
    id,
    code: readString(value.code) ?? readString(value.plan_code),
    displayName:
      readString(value.displayName) ??
      readString(value.display_name) ??
      readString(value.name) ??
      "VIP 月卡",
    priceXtr:
      readNumber(value.priceXtr) ??
      readNumber(value.price_xtr) ??
      readNumber(value.xtrAmount) ??
      readNumber(value.xtr_amount) ??
      0,
    durationDays:
      readNumber(value.durationDays) ?? readNumber(value.duration_days),
    dailyFgems:
      readNumber(value.dailyFgems) ?? readNumber(value.daily_fgems) ?? 0,
    dailyFreeBoxCount:
      readNumber(value.dailyFreeBoxCount) ??
      readNumber(value.daily_free_box_count) ??
      0,
    feeRebateBps:
      readNumber(value.feeRebateBps) ?? readNumber(value.fee_rebate_bps) ?? 0,
  };
}

function normalizeVipTodayStatus(value: unknown): VipTodayStatus | null {
  if (!isRecord(value)) {
    return null;
  }

  const freeBoxCount =
    readNumber(value.freeBoxCount) ?? readNumber(value.free_box_count) ?? 0;
  const freeBoxUsedCount =
    readNumber(value.freeBoxUsedCount) ??
    readNumber(value.free_box_used_count) ??
    0;
  const fgemsClaimed =
    readBoolean(value.fgemsClaimed) ??
    readBoolean(value.fgems_claimed) ??
    readBoolean(value.claimed) ??
    false;
  const fgemsClaimedAt =
    readString(value.fgemsClaimedAt) ?? readString(value.fgems_claimed_at);
  const canClaimFgems =
    readBoolean(value.canClaimFgems) ??
    readBoolean(value.can_claim_fgems) ??
    readBoolean(value.canClaim) ??
    readBoolean(value.can_claim) ??
    false;
  const freeBoxClaimed =
    readBoolean(value.freeBoxClaimed) ??
    readBoolean(value.free_box_claimed) ??
    false;
  const freeBoxClaimedAt =
    readString(value.freeBoxClaimedAt) ?? readString(value.free_box_claimed_at);
  const canClaimFreeBox =
    readBoolean(value.canClaimFreeBox) ??
    readBoolean(value.can_claim_free_box) ??
    false;
  const remainingFreeBoxCount =
    readNumber(value.remainingFreeBoxCount) ??
    readNumber(value.remaining_free_box_count) ??
    Math.max(freeBoxCount - freeBoxUsedCount, 0);

  return {
    businessDateUtc:
      readString(value.businessDateUtc) ?? readString(value.business_date_utc),
    claimId: readString(value.claimId) ?? readString(value.claim_id),
    claimed: fgemsClaimed,
    canClaim: canClaimFgems,
    fgemsAmount:
      readNumber(value.fgemsAmount) ?? readNumber(value.fgems_amount) ?? 0,
    fgemsClaimed,
    fgemsClaimedAt,
    canClaimFgems,
    freeBoxCount,
    freeBoxUsedCount,
    remainingFreeBoxCount,
    freeBoxAvailable:
      readBoolean(value.freeBoxAvailable) ??
      readBoolean(value.free_box_available) ??
      (freeBoxClaimed && remainingFreeBoxCount > 0),
    freeBoxClaimed,
    freeBoxClaimedAt,
    canClaimFreeBox,
  };
}

function createIdempotencyKey(scope: string): string {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${scope}:${randomPart}`;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
