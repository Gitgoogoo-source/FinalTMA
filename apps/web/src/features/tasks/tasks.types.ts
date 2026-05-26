export type TaskCategory =
  | "daily"
  | "social"
  | "trade"
  | "gacha"
  | "album"
  | "wallet"
  | "onchain"
  | "game"
  | "event"
  | "system"
  | "referral"
  | "other";

export type TaskCategoryFilter =
  | "all"
  | "daily"
  | "social"
  | "trade"
  | "onchain";

export type TaskStatus =
  | "locked"
  | "not_started"
  | "in_progress"
  | "claimable"
  | "claimed"
  | "expired"
  | "disabled";

export type TaskPeriodType =
  | "none"
  | "once"
  | "daily"
  | "weekly"
  | "monthly"
  | "campaign"
  | "event";

export type TaskRewardType =
  | "currency"
  | "collectible"
  | "box_ticket"
  | "decoration"
  | "item"
  | "unknown";

export type TaskReward = {
  id: string;
  type: TaskRewardType;
  label: string;
  amount: number | null;
  currency: "KCOIN" | "FGEMS" | "STAR_DISPLAY" | null;
  iconUrl: string | null;
  detail: string | null;
};

export type TaskProgress = {
  progressId: string | null;
  periodKey: string | null;
  current: number;
  target: number;
  percent: number;
  completedAt: string | null;
  claimedAt: string | null;
  updatedAt: string | null;
};

export type TaskItem = {
  taskId: string;
  code: string;
  title: string;
  description: string | null;
  category: TaskCategory;
  actionType: string | null;
  status: TaskStatus;
  periodType: TaskPeriodType;
  periodKey: string | null;
  progress: TaskProgress;
  rewards: TaskReward[];
  sortOrder: number;
  actionRoute: string | null;
  metadata: Record<string, unknown>;
};

export type TaskListQuery = {
  category?: TaskCategoryFilter;
  includeClaimed?: boolean;
};

export type TaskSummary = {
  totalCount: number;
  completedCount: number;
  claimedCount: number;
  claimableCount: number;
};

export type SignInDayStatus = "locked" | "available" | "claimed" | "missed";

export type SignInCampaign = {
  campaignId: string;
  code: string | null;
  title: string;
  description: string | null;
  cycleDays: number;
};

export type SignInDay = {
  dayIndex: number;
  title: string;
  status: SignInDayStatus;
  rewards: TaskReward[];
  claimedAt: string | null;
  claimedDate: string | null;
};

export type CheckInStatus = {
  campaign: SignInCampaign | null;
  days: SignInDay[];
  currentStreak: number;
  cyclePosition: number;
  totalSignins: number;
  alreadyClaimedToday: boolean;
  nextDayIndex: number | null;
  serverDate: string | null;
  serverTime: string | null;
};

export type InviteStats = {
  invitedCount: number;
  validInviteCount: number;
  firstOpenCount: number;
  totalRewardKcoin: number;
  commissionKcoin: number;
  pendingCommissionKcoin: number;
  shareCount: number;
  serverTime: string | null;
};

export type ReferralRecord = {
  referralId: string;
  inviteeDisplayName: string | null;
  inviteeUsername: string | null;
  inviteCode: string | null;
  status: string;
  qualifiedAt: string | null;
  rewardedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type CommissionStatus = "pending" | "granted" | "reversed" | "unknown";

export type CommissionRecord = {
  commissionId: string;
  inviteeDisplayName: string | null;
  inviteeUsername: string | null;
  sourceType: string | null;
  baseAmountKcoin: number;
  commissionBps: number;
  commissionAmountKcoin: number;
  ledgerId: string | null;
  status: CommissionStatus;
  createdAt: string;
  claimedAt: string | null;
};

export type CommissionStats = {
  pendingCount: number;
  pendingAmountKcoin: number;
  grantedCount: number;
  grantedAmountKcoin: number;
  reversedCount: number;
  reversedAmountKcoin: number;
};

export type CommissionHistory = {
  items: CommissionRecord[];
  count: number;
  nextCursor: string | null;
  serverTime: string | null;
};

export type TaskOverview = {
  tasks: TaskItem[];
  taskSummary: TaskSummary;
  checkInStatus: CheckInStatus;
  inviteStats: InviteStats;
  referralRecords: ReferralRecord[];
  commissionHistory: CommissionHistory;
  commissionStats: CommissionStats;
  serverTime: string | null;
};

export type ClaimTaskInput = {
  taskId: string;
  periodKey?: string | null;
  idempotencyKey?: string | null;
};

export type ClaimTaskResult = {
  claimId: string | null;
  taskId: string;
  periodKey: string | null;
  status: "claimed";
  rewards: TaskReward[];
  claimedAt: string;
  idempotent: boolean;
};

export type DailyCheckInInput = {
  campaignId?: string | null;
  localDate?: string | null;
  timezoneOffsetMinutes?: number | null;
  idempotencyKey?: string | null;
};

export type DailyCheckInResult = {
  signInId: string | null;
  campaignId: string;
  alreadyClaimed: boolean;
  dayIndex: number;
  currentStreak: number;
  cyclePosition: number | null;
  totalSignins: number | null;
  rewards: TaskReward[];
  checkedInAt: string;
  idempotent: boolean;
};

export type ReferralLinkInput = {
  scene?: "TASK_PAGE" | "INVITE_CARD";
  source?: string;
};

export type ReferralLink = {
  referralCode: string;
  startPayload: string;
  inviteUrl: string;
  shareText: string;
  scene: string | null;
  source: string | null;
};

export type InviteShareInput = {
  scene: "TASK_PAGE" | "INVITE_CARD";
  referralCode?: string | null;
  campaignId?: string | null;
  idempotencyKey?: string | null;
};

export type InviteShareResult = {
  accepted: boolean;
  eventId: string | null;
  shareType: string | null;
  idempotent: boolean;
};

export type ClaimCommissionInput = {
  commissionIds?: string[] | null;
  idempotencyKey?: string | null;
};

export type ClaimCommissionResult = {
  processed: boolean;
  claimed: boolean;
  claimedCount: number;
  claimedAmountKcoin: number;
  amountKcoin: number;
  commissionIds: string[];
  ledgerId: string | null;
  status: string;
  idempotent: boolean;
};
