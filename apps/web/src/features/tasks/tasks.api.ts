import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";

import type {
  CheckInStatus,
  ClaimCommissionInput,
  ClaimCommissionResult,
  ClaimTaskInput,
  ClaimTaskResult,
  CommissionHistory,
  CommissionRecord,
  CommissionStats,
  DailyCheckInInput,
  DailyCheckInResult,
  InviteShareInput,
  InviteShareResult,
  InviteStats,
  ReferralLink,
  ReferralLinkInput,
  ReferralRecord,
  SignInCampaign,
  SignInDay,
  SignInDayStatus,
  TaskCategory,
  TaskItem,
  TaskOverview,
  TaskPeriodType,
  TaskProgress,
  TaskReward,
  TaskRewardType,
  TaskStatus,
  TaskSummary,
} from "./tasks.types";

type JsonRecord = Record<string, unknown>;

export async function fetchTaskOverview(): Promise<TaskOverview> {
  const response = await apiRequest<unknown>(API_ENDPOINTS.tasks.overview, {
    method: "GET",
  });

  return normalizeTaskOverview(response);
}

export async function claimTaskReward(
  input: ClaimTaskInput,
): Promise<ClaimTaskResult> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("task:claim");
  const response = await apiRequest<unknown>(API_ENDPOINTS.tasks.claim, {
    method: "POST",
    body: compactRecord({
      task_id: input.taskId,
      period_key: input.periodKey,
      idempotency_key: idempotencyKey,
    }),
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeClaimTaskResult(response, input.taskId);
}

export async function dailyCheckIn(
  input: DailyCheckInInput = {},
): Promise<DailyCheckInResult> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("task:signin");
  const response = await apiRequest<unknown>(API_ENDPOINTS.tasks.checkIn, {
    method: "POST",
    body: compactRecord({
      campaign_id: input.campaignId,
      idempotency_key: idempotencyKey,
    }),
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeDailyCheckInResult(response);
}

export async function createReferralLink(
  input: ReferralLinkInput = {},
): Promise<ReferralLink> {
  const response = await apiRequest<unknown>(API_ENDPOINTS.tasks.referralLink, {
    method: "POST",
    body: compactRecord({
      scene: input.scene ?? "TASK_PAGE",
      source: input.source,
    }),
  });

  return normalizeReferralLink(response);
}

export async function recordInviteShare(
  input: InviteShareInput,
): Promise<InviteShareResult> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("task:share");
  const response = await apiRequest<unknown>(API_ENDPOINTS.tasks.shareEvent, {
    method: "POST",
    body: compactRecord({
      scene: input.scene,
      referral_code: input.referralCode,
      campaign_id: input.campaignId,
      idempotency_key: idempotencyKey,
    }),
    headers: {
      "X-Idempotency-Key": idempotencyKey,
    },
  });

  return normalizeInviteShareResult(response);
}

export async function claimCommission(
  input: ClaimCommissionInput = {},
): Promise<ClaimCommissionResult> {
  const idempotencyKey =
    input.idempotencyKey ?? createIdempotencyKey("task:commission");
  const response = await apiRequest<unknown>(
    API_ENDPOINTS.tasks.claimCommission,
    {
      method: "POST",
      body: compactRecord({
        commission_ids: input.commissionIds,
        idempotency_key: idempotencyKey,
      }),
      headers: {
        "X-Idempotency-Key": idempotencyKey,
      },
    },
  );

  return normalizeClaimCommissionResult(response);
}

export function normalizeTaskOverview(response: unknown): TaskOverview {
  const payload = isRecord(response) ? response : {};
  const rawTasks = Array.isArray(payload.tasks) ? payload.tasks : [];

  return {
    tasks: rawTasks.map(normalizeTaskItem).filter(isTaskItem),
    taskSummary: normalizeTaskSummary(payload.task_summary),
    checkInStatus: normalizeCheckInStatus(
      payload.signin_status ?? payload.signin,
    ),
    inviteStats: normalizeInviteStats(payload.invite_stats),
    referralRecords: normalizeReferralRecords(payload.referral_records),
    commissionHistory: normalizeCommissionHistory({
      items: payload.commission_history,
      server_time: payload.server_time,
    }),
    commissionStats: normalizeCommissionStats(payload.commission_stats),
    serverTime:
      readIsoString(payload.server_time) ?? readIsoString(payload.serverTime),
  };
}

function normalizeTaskItem(value: unknown): TaskItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const taskId = readString(value.task_id) ?? readString(value.taskId);
  const code = readString(value.code);
  const progress = normalizeTaskProgress(value.progress, value);

  if (!taskId || !code) {
    return null;
  }

  const actionType =
    readString(value.action_type) ??
    readString(value.actionType) ??
    readString(value.action);
  const category = normalizeTaskCategory(
    value.category ?? value.task_type ?? value.taskType,
  );
  const status = normalizeTaskStatus(
    value.status ?? value.task_status ?? progressStatusCandidate(value),
  );

  return {
    taskId,
    code,
    title: readString(value.title) ?? code,
    description:
      readString(value.description) ?? readString(value.subtitle) ?? null,
    category,
    actionType,
    status,
    periodType: normalizeTaskPeriodType(value.period_type ?? value.periodType),
    periodKey:
      progress.periodKey ??
      readString(value.period_key) ??
      readString(value.periodKey),
    progress,
    rewards: normalizeRewards(value.rewards ?? value.reward),
    sortOrder:
      readInteger(value.sort_order) ?? readInteger(value.sortOrder) ?? 0,
    actionRoute: normalizeTaskActionRoute(
      readString(value.action_route) ?? readString(value.action_url),
      actionType,
      category,
    ),
    metadata: isRecord(value.metadata) ? value.metadata : {},
  };
}

function normalizeTaskProgress(
  value: unknown,
  fallback: JsonRecord,
): TaskProgress {
  const payload = isRecord(value) ? value : {};
  const current =
    readInteger(payload.current) ??
    readInteger(payload.progress_count) ??
    readInteger(payload.progressCount) ??
    0;
  const target =
    readInteger(payload.target) ??
    readInteger(payload.target_count) ??
    readInteger(payload.targetCount) ??
    readInteger(fallback.target_count) ??
    readInteger(fallback.targetCount) ??
    1;
  const safeTarget = Math.max(1, target);

  return {
    progressId:
      readString(payload.progress_id) ?? readString(payload.progressId),
    periodKey: readString(payload.period_key) ?? readString(payload.periodKey),
    current,
    target: safeTarget,
    percent: clampPercent(
      readNumber(payload.percent) ?? (current / safeTarget) * 100,
    ),
    completedAt:
      readIsoString(payload.completed_at) ?? readIsoString(payload.completedAt),
    claimedAt:
      readIsoString(payload.claimed_at) ?? readIsoString(payload.claimedAt),
    updatedAt:
      readIsoString(payload.updated_at) ?? readIsoString(payload.updatedAt),
  };
}

function normalizeTaskSummary(value: unknown): TaskSummary {
  const payload = isRecord(value) ? value : {};

  return {
    totalCount:
      readInteger(payload.total_count) ?? readInteger(payload.totalCount) ?? 0,
    completedCount:
      readInteger(payload.completed_count) ??
      readInteger(payload.completedCount) ??
      0,
    claimedCount:
      readInteger(payload.claimed_count) ??
      readInteger(payload.claimedCount) ??
      0,
    claimableCount:
      readInteger(payload.claimable_count) ??
      readInteger(payload.claimableCount) ??
      0,
  };
}

function normalizeCheckInStatus(value: unknown): CheckInStatus {
  const payload = isRecord(value) ? value : {};
  const days = Array.isArray(payload.days)
    ? payload.days.map(normalizeSignInDay).filter(isSignInDay)
    : [];

  return {
    campaign: normalizeSignInCampaign(payload.campaign),
    days,
    currentStreak:
      readInteger(payload.current_streak) ??
      readInteger(payload.currentStreak) ??
      0,
    cyclePosition:
      readInteger(payload.cycle_position) ??
      readInteger(payload.cyclePosition) ??
      0,
    totalSignins:
      readInteger(payload.total_signins) ??
      readInteger(payload.totalSignins) ??
      0,
    alreadyClaimedToday:
      readBoolean(payload.already_claimed_today) ??
      readBoolean(payload.todayCheckedIn) ??
      false,
    nextDayIndex:
      readInteger(payload.next_day_index) ?? readInteger(payload.nextDayIndex),
    serverDate:
      readString(payload.server_date) ?? readString(payload.serverDate),
    serverTime:
      readIsoString(payload.server_time) ?? readIsoString(payload.serverTime),
  };
}

function normalizeSignInCampaign(value: unknown): SignInCampaign | null {
  if (!isRecord(value)) {
    return null;
  }

  const campaignId =
    readString(value.campaign_id) ?? readString(value.campaignId);

  if (!campaignId) {
    return null;
  }

  return {
    campaignId,
    code: readString(value.code),
    title: readString(value.title) ?? "7 日签到",
    description: readString(value.description),
    cycleDays:
      readInteger(value.cycle_days) ?? readInteger(value.cycleDays) ?? 7,
  };
}

function normalizeSignInDay(value: unknown): SignInDay | null {
  if (!isRecord(value)) {
    return null;
  }

  const dayIndex = readInteger(value.day_index) ?? readInteger(value.dayIndex);

  if (dayIndex === null) {
    return null;
  }

  return {
    dayIndex,
    title: readString(value.title) ?? `第 ${dayIndex} 天`,
    status: normalizeSignInDayStatus(value.status),
    rewards: normalizeRewards(value.rewards ?? value.reward),
    claimedAt:
      readIsoString(value.claimed_at) ??
      readIsoString(value.claimedAt) ??
      readIsoString(value.last_claimed_at),
    claimedDate:
      readString(value.claimed_date) ??
      readString(value.claimedDate) ??
      readString(value.last_claimed_date),
  };
}

function normalizeInviteStats(value: unknown): InviteStats {
  const payload = isRecord(value) ? value : {};
  const summary = isRecord(payload.summary) ? payload.summary : {};
  const referrals = isRecord(payload.referrals) ? payload.referrals : {};
  const rewards = isRecord(payload.rewards) ? payload.rewards : {};
  const commissions = isRecord(payload.commissions) ? payload.commissions : {};
  const shares = isRecord(payload.shares) ? payload.shares : {};
  const kcoinRewards = isRecord(rewards.KCOIN) ? rewards.KCOIN : {};
  const pendingCommissionKcoin =
    readInteger(summary.pending_commission_kcoin) ??
    readInteger(summary.pendingCommissionKcoin) ??
    readInteger(commissions.pending_amount_kcoin) ??
    0;
  const grantedCommissionKcoin =
    readInteger(summary.granted_commission_kcoin) ??
    readInteger(summary.grantedCommissionKcoin) ??
    readInteger(summary.commission_kcoin) ??
    readInteger(summary.commissionKcoin) ??
    readInteger(commissions.granted_amount_kcoin) ??
    0;
  const totalCommissionKcoin =
    readInteger(summary.total_commission_kcoin) ??
    readInteger(summary.totalCommissionKcoin) ??
    readInteger(commissions.total_amount_kcoin) ??
    pendingCommissionKcoin + grantedCommissionKcoin;
  const commissionBps =
    readInteger(summary.commission_bps) ??
    readInteger(summary.commissionBps) ??
    readInteger(commissions.current_bps) ??
    readInteger(commissions.currentBps) ??
    readInteger(commissions.commission_bps) ??
    0;
  const commissionRate =
    readNumber(summary.commission_rate) ??
    readNumber(summary.commissionRate) ??
    readNumber(commissions.current_rate) ??
    readNumber(commissions.currentRate) ??
    (commissionBps > 0 ? commissionBps / 10000 : 0);
  const validInviteCount =
    readInteger(summary.valid_invite_count) ??
    readInteger(summary.validInviteCount) ??
    readInteger(referrals.valid_count) ??
    readInteger(referrals.validCount) ??
    (readInteger(referrals.qualified_count) ?? 0) +
      (readInteger(referrals.rewarded_count) ?? 0);

  return {
    invitedCount:
      readInteger(summary.invited_count) ??
      readInteger(summary.invitedCount) ??
      readInteger(referrals.total_count) ??
      0,
    validInviteCount,
    firstOpenCount:
      readInteger(summary.first_open_count) ??
      readInteger(summary.firstOpenCount) ??
      readInteger(referrals.first_open_count) ??
      readInteger(referrals.firstOpenCount) ??
      validInviteCount,
    totalRewardKcoin:
      readInteger(summary.total_reward_kcoin) ??
      readInteger(summary.totalRewardKcoin) ??
      readInteger(kcoinRewards.amount) ??
      0,
    grantedCommissionKcoin,
    commissionKcoin: grantedCommissionKcoin,
    pendingCommissionKcoin,
    totalCommissionKcoin,
    commissionBps,
    commissionRate,
    shareCount:
      readInteger(summary.share_count) ??
      readInteger(summary.shareCount) ??
      readInteger(shares.total_count) ??
      0,
    serverTime:
      readIsoString(payload.server_time) ?? readIsoString(payload.serverTime),
  };
}

function normalizeReferralRecords(value: unknown): ReferralRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeReferralRecord).filter(isReferralRecord);
}

function normalizeReferralRecord(value: unknown): ReferralRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const referralId =
    readString(value.referral_id) ?? readString(value.referralId);
  const createdAt =
    readIsoString(value.created_at) ?? readIsoString(value.createdAt);

  if (!referralId || !createdAt) {
    return null;
  }

  return {
    referralId,
    inviteeDisplayName:
      readString(value.invitee_display_name) ??
      readString(value.inviteeDisplayName),
    inviteeUsername:
      readString(value.invitee_username) ?? readString(value.inviteeUsername),
    inviteCode: readString(value.invite_code) ?? readString(value.inviteCode),
    status: readString(value.status) ?? "pending",
    qualifiedAt:
      readIsoString(value.qualified_at) ?? readIsoString(value.qualifiedAt),
    rewardedAt:
      readIsoString(value.rewarded_at) ?? readIsoString(value.rewardedAt),
    createdAt,
    updatedAt:
      readIsoString(value.updated_at) ?? readIsoString(value.updatedAt),
  };
}

function normalizeCommissionHistory(value: unknown): CommissionHistory {
  const payload = isRecord(value) ? value : {};
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.commissions)
      ? payload.commissions
      : [];
  const items = rawItems
    .map(normalizeCommissionRecord)
    .filter(isCommissionRecord);

  return {
    items,
    count: readInteger(payload.count) ?? items.length,
    nextCursor:
      readIsoString(payload.next_cursor) ?? readIsoString(payload.nextCursor),
    serverTime:
      readIsoString(payload.server_time) ?? readIsoString(payload.serverTime),
  };
}

function normalizeCommissionRecord(value: unknown): CommissionRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const commissionId =
    readString(value.commission_id) ?? readString(value.commissionId);
  const createdAt =
    readIsoString(value.created_at) ?? readIsoString(value.createdAt);

  if (!commissionId || !createdAt) {
    return null;
  }

  return {
    commissionId,
    inviteeDisplayName:
      readString(value.invitee_display_name) ??
      readString(value.inviteeDisplayName),
    inviteeUsername:
      readString(value.invitee_username) ?? readString(value.inviteeUsername),
    sourceType: readString(value.source_type) ?? readString(value.sourceType),
    baseAmountKcoin:
      readInteger(value.base_amount_kcoin) ??
      readInteger(value.baseAmountKcoin) ??
      0,
    commissionBps:
      readInteger(value.commission_bps) ??
      readInteger(value.commissionBps) ??
      0,
    commissionAmountKcoin:
      readInteger(value.commission_amount_kcoin) ??
      readInteger(value.commissionAmountKcoin) ??
      0,
    ledgerId: readString(value.ledger_id) ?? readString(value.ledgerId),
    status: normalizeCommissionStatus(value.status),
    createdAt,
    claimedAt:
      readIsoString(value.claimed_at) ?? readIsoString(value.claimedAt),
  };
}

function normalizeCommissionStats(value: unknown): CommissionStats {
  const payload = isRecord(value) ? value : {};
  const pendingCount =
    readInteger(payload.pending_count) ??
    readInteger(payload.pendingCount) ??
    0;
  const pendingAmountKcoin =
    readInteger(payload.pending_amount_kcoin) ??
    readInteger(payload.pendingAmountKcoin) ??
    0;
  const grantedCount =
    readInteger(payload.granted_count) ??
    readInteger(payload.grantedCount) ??
    0;
  const grantedAmountKcoin =
    readInteger(payload.granted_amount_kcoin) ??
    readInteger(payload.grantedAmountKcoin) ??
    0;
  const reversedCount =
    readInteger(payload.reversed_count) ??
    readInteger(payload.reversedCount) ??
    0;
  const reversedAmountKcoin =
    readInteger(payload.reversed_amount_kcoin) ??
    readInteger(payload.reversedAmountKcoin) ??
    0;
  const totalCount =
    readInteger(payload.total_count) ??
    readInteger(payload.totalCount) ??
    pendingCount + grantedCount;
  const totalAmountKcoin =
    readInteger(payload.total_amount_kcoin) ??
    readInteger(payload.totalAmountKcoin) ??
    pendingAmountKcoin + grantedAmountKcoin;
  const commissionBps =
    readInteger(payload.current_bps) ??
    readInteger(payload.currentBps) ??
    readInteger(payload.commission_bps) ??
    readInteger(payload.commissionBps) ??
    0;
  const commissionRate =
    readNumber(payload.current_rate) ??
    readNumber(payload.currentRate) ??
    readNumber(payload.commission_rate) ??
    readNumber(payload.commissionRate) ??
    (commissionBps > 0 ? commissionBps / 10000 : 0);

  return {
    pendingCount,
    pendingAmountKcoin,
    grantedCount,
    grantedAmountKcoin,
    reversedCount,
    reversedAmountKcoin,
    totalCount,
    totalAmountKcoin,
    commissionBps,
    commissionRate,
  };
}

function normalizeClaimTaskResult(
  response: unknown,
  fallbackTaskId: string,
): ClaimTaskResult {
  const payload = assertRecord(response, "Invalid task claim response.");
  const claimedAt =
    readIsoString(payload.claimed_at) ?? readIsoString(payload.claimedAt);

  if (!claimedAt) {
    throw new Error("Invalid task claim response.");
  }

  return {
    claimId: readString(payload.claim_id) ?? readString(payload.claimId),
    taskId:
      readString(payload.task_id) ??
      readString(payload.taskId) ??
      fallbackTaskId,
    periodKey: readString(payload.period_key) ?? readString(payload.periodKey),
    status: "claimed",
    rewards: normalizeRewards(payload.rewards ?? payload.reward),
    claimedAt,
    idempotent: readBoolean(payload.idempotent) ?? false,
  };
}

function normalizeDailyCheckInResult(response: unknown): DailyCheckInResult {
  const payload = assertRecord(response, "Invalid daily check-in response.");
  const campaignId =
    readString(payload.campaign_id) ?? readString(payload.campaignId);
  const dayIndex =
    readInteger(payload.day_index) ?? readInteger(payload.dayIndex);
  const currentStreak =
    readInteger(payload.current_streak) ?? readInteger(payload.currentStreak);
  const checkedInAt =
    readIsoString(payload.checked_in_at) ?? readIsoString(payload.checkedInAt);

  if (
    !campaignId ||
    dayIndex === null ||
    currentStreak === null ||
    !checkedInAt
  ) {
    throw new Error("Invalid daily check-in response.");
  }

  return {
    signInId: readString(payload.signin_id) ?? readString(payload.signInId),
    campaignId,
    alreadyClaimed:
      readBoolean(payload.already_claimed) ??
      readBoolean(payload.alreadyClaimed) ??
      false,
    dayIndex,
    currentStreak,
    cyclePosition:
      readInteger(payload.cycle_position) ?? readInteger(payload.cyclePosition),
    totalSignins:
      readInteger(payload.total_signins) ?? readInteger(payload.totalSignins),
    rewards: normalizeRewards(payload.reward ?? payload.rewards),
    checkedInAt,
    idempotent: readBoolean(payload.idempotent) ?? false,
  };
}

function normalizeReferralLink(response: unknown): ReferralLink {
  const payload = assertRecord(response, "Invalid referral link response.");
  const referralCode =
    readString(payload.referral_code) ?? readString(payload.referralCode);
  const startPayload =
    readString(payload.start_payload) ?? readString(payload.startPayload);
  const inviteUrl =
    readString(payload.invite_url) ?? readString(payload.inviteUrl);
  const shareText =
    readString(payload.share_text) ?? readString(payload.shareText);

  if (!referralCode || !startPayload || !inviteUrl || !shareText) {
    throw new Error("Invalid referral link response.");
  }

  return {
    referralCode,
    startPayload,
    inviteUrl,
    shareText,
    scene: readString(payload.scene),
    source: readString(payload.source),
  };
}

function normalizeInviteShareResult(response: unknown): InviteShareResult {
  const payload = assertRecord(response, "Invalid invite share response.");

  return {
    accepted: readBoolean(payload.accepted) ?? false,
    eventId: readString(payload.event_id) ?? readString(payload.eventId),
    shareType: readString(payload.share_type) ?? readString(payload.shareType),
    idempotent: readBoolean(payload.idempotent) ?? false,
  };
}

function normalizeClaimCommissionResult(
  response: unknown,
): ClaimCommissionResult {
  const payload = assertRecord(response, "Invalid commission claim response.");

  return {
    processed: readBoolean(payload.processed) ?? false,
    claimed: readBoolean(payload.claimed) ?? false,
    claimedCount:
      readInteger(payload.claimed_count) ??
      readInteger(payload.claimedCount) ??
      0,
    claimedAmountKcoin:
      readInteger(payload.claimed_amount_kcoin) ??
      readInteger(payload.claimedAmountKcoin) ??
      0,
    amountKcoin:
      readInteger(payload.amount_kcoin) ??
      readInteger(payload.amountKcoin) ??
      readInteger(payload.claimed_amount_kcoin) ??
      0,
    commissionIds: Array.isArray(payload.commission_ids)
      ? payload.commission_ids
          .map((item) => readString(item))
          .filter((item): item is string => item !== null)
      : [],
    ledgerId: readString(payload.ledger_id) ?? readString(payload.ledgerId),
    status: readString(payload.status) ?? "no_pending",
    idempotent: readBoolean(payload.idempotent) ?? false,
  };
}

export function normalizeRewards(value: unknown): TaskReward[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeReward).filter(isTaskReward);
}

function normalizeReward(value: unknown, index: number): TaskReward | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = normalizeRewardType(value.type ?? value.reward_type);
  const currency = normalizeCurrency(value.currency ?? value.currency_code);
  const amount =
    readInteger(value.amount) ??
    readInteger(value.quantity) ??
    readInteger(value.count);
  const title =
    readString(value.title) ??
    readString(value.label) ??
    readString(value.reward_label);
  const label = title ?? currency ?? getRewardTypeLabel(type);

  return {
    id:
      readString(value.reward_id) ??
      readString(value.rewardId) ??
      readString(value.item_id) ??
      readString(value.itemId) ??
      `${label}:${index}`,
    type: currency ? "currency" : type,
    label,
    amount,
    currency,
    iconUrl: readString(value.icon_url) ?? readString(value.iconUrl),
    detail: readString(value.description),
  };
}

function normalizeTaskCategory(value: unknown): TaskCategory {
  const normalized = readString(value)?.toLowerCase();

  switch (normalized) {
    case "daily":
    case "social":
    case "trade":
    case "gacha":
    case "album":
    case "wallet":
    case "onchain":
    case "game":
    case "event":
    case "system":
    case "referral":
      return normalized;
    default:
      return "other";
  }
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  const normalized = readString(value)?.toLowerCase();

  switch (normalized) {
    case "locked":
      return "locked";
    case "not_started":
    case "not-started":
      return "not_started";
    case "completed":
    case "claimable":
      return "claimable";
    case "claimed":
      return "claimed";
    case "expired":
      return "expired";
    case "disabled":
      return "disabled";
    default:
      return "in_progress";
  }
}

function normalizeTaskPeriodType(value: unknown): TaskPeriodType {
  const normalized = readString(value)?.toLowerCase();

  switch (normalized) {
    case "none":
    case "once":
    case "daily":
    case "weekly":
    case "monthly":
    case "campaign":
    case "event":
      return normalized;
    default:
      return "none";
  }
}

function normalizeSignInDayStatus(value: unknown): SignInDayStatus {
  const normalized = readString(value)?.toLowerCase();

  switch (normalized) {
    case "available":
      return "available";
    case "claimed":
      return "claimed";
    case "missed":
      return "missed";
    default:
      return "locked";
  }
}

function normalizeCommissionStatus(value: unknown): CommissionRecord["status"] {
  const normalized = readString(value)?.toLowerCase();

  if (
    normalized === "pending" ||
    normalized === "granted" ||
    normalized === "reversed"
  ) {
    return normalized;
  }

  return "unknown";
}

function normalizeRewardType(value: unknown): TaskRewardType {
  const normalized = readString(value)?.toLowerCase();

  switch (normalized) {
    case "currency":
      return "currency";
    case "collectible":
      return "collectible";
    case "box_ticket":
    case "box-ticket":
      return "box_ticket";
    case "decoration":
      return "decoration";
    case "item":
      return "item";
    default:
      return "unknown";
  }
}

function normalizeCurrency(value: unknown): TaskReward["currency"] {
  const normalized = readString(value)?.toUpperCase();

  if (
    normalized === "KCOIN" ||
    normalized === "FGEMS" ||
    normalized === "STAR_DISPLAY"
  ) {
    return normalized;
  }

  return null;
}

function normalizeTaskActionRoute(
  actionRoute: string | null,
  actionType: string | null,
  category: TaskCategory,
): string | null {
  if (actionRoute?.startsWith("/")) {
    return actionRoute;
  }

  if (category === "trade") {
    return "/trade";
  }

  if (category === "onchain" || category === "wallet") {
    return "/album";
  }

  if (category === "album") {
    return "/album";
  }

  if (actionType?.includes("open") || category === "gacha") {
    return "/box";
  }

  return null;
}

function progressStatusCandidate(value: JsonRecord): unknown {
  if (!isRecord(value.progress)) {
    return undefined;
  }

  return value.progress.status;
}

function getRewardTypeLabel(type: TaskRewardType): string {
  switch (type) {
    case "collectible":
      return "藏品";
    case "box_ticket":
      return "开盒券";
    case "decoration":
      return "装饰";
    case "item":
      return "道具";
    case "currency":
      return "奖励";
    default:
      return "奖励";
  }
}

function createIdempotencyKey(scope: string): string {
  const randomValue =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return `${scope}:${randomValue}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function compactRecord(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined && item !== null,
    ),
  );
}

function assertRecord(value: unknown, message: string): JsonRecord {
  if (!isRecord(value)) {
    throw new Error(message);
  }

  return value;
}

function isTaskItem(value: TaskItem | null): value is TaskItem {
  return value !== null;
}

function isSignInDay(value: SignInDay | null): value is SignInDay {
  return value !== null;
}

function isReferralRecord(
  value: ReferralRecord | null,
): value is ReferralRecord {
  return value !== null;
}

function isCommissionRecord(
  value: CommissionRecord | null,
): value is CommissionRecord {
  return value !== null;
}

function isTaskReward(value: TaskReward | null): value is TaskReward {
  return value !== null;
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

function readInteger(value: unknown): number | null {
  const numberValue = readNumber(value);
  return numberValue === null ? null : Math.trunc(numberValue);
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }

  return null;
}

function readIsoString(value: unknown): string | null {
  const text = readString(value);

  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
