export type AlbumProgressQuery = {
  bookId?: string;
  bookType?: "all" | "series" | "faction" | "rarity" | "event";
  seriesId?: string;
  factionId?: string;
  rarity?: string;
  includeItems?: boolean;
  includeMilestones?: boolean;
  includeRewards?: boolean;
  includeLockedItems?: boolean;
};

export type AlbumSeriesQuery = {
  bookType?: AlbumProgressQuery["bookType"];
  seriesIds?: string[];
  factionIds?: string[];
  rarities?: string[];
  cursor?: string;
  limit?: number;
};

export type AlbumBook = {
  bookId: string;
  code: string | null;
  bookType: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  totalCount: number;
  collectedCount: number;
  completionPercent: number;
  isEventLimited: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

export type AlbumItem = {
  templateId: string;
  formId: string | null;
  name: string;
  description: string | null;
  rarity: string;
  type: string;
  seriesId: string | null;
  seriesName: string | null;
  factionId: string | null;
  factionName: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  isCollected: boolean;
  firstCollectedAt: string | null;
  collectedCount: number;
  albumOrder: number | null;
};

export type AlbumReward = {
  rewardType: string;
  amount: number | null;
  templateId: string | null;
  label: string;
  iconUrl: string | null;
};

export type AlbumMilestoneStatus =
  | "locked"
  | "claimable"
  | "claimed"
  | "expired";

export type AlbumMilestone = {
  milestoneId: string;
  bookId: string;
  requiredCount: number;
  requiredPercent: number | null;
  title: string | null;
  status: AlbumMilestoneStatus;
  rewards: AlbumReward[];
  claimedAt: string | null;
  version: number;
};

export type AlbumClaimRewardInput = {
  milestoneId: string;
  bookId?: string | null;
  expectedMilestoneVersion?: number | null;
  idempotencyKey?: string | null;
};

export type AlbumBalanceChange = {
  currency: "KCOIN" | "FGEMS";
  delta: number;
  balanceAfter: number;
};

export type AlbumClaimRewardResponse = {
  milestoneId: string;
  bookId: string;
  status: "claimed";
  rewards: AlbumReward[];
  balanceChanges: AlbumBalanceChange[];
  claimedAt: string;
};

export type AlbumRaritySummaryItem = {
  rarity: string;
  totalCount: number;
  collectedCount: number;
};

export type AlbumSeriesSummaryItem = {
  seriesId: string | null;
  seriesName: string;
  totalCount: number;
  collectedCount: number;
};

export type AlbumProgress = {
  book: AlbumBook | null;
  items: AlbumItem[];
  milestones: AlbumMilestone[];
  raritySummary: AlbumRaritySummaryItem[];
  seriesSummary: AlbumSeriesSummaryItem[];
  empty: boolean;
  serverTime: string | null;
};

export type AlbumSeriesResponse = {
  books: AlbumBook[];
  total: number;
  limit: number;
  offset: number;
  nextCursor: string | null;
  serverTime: string | null;
};

export type AlbumLeaderboardPeriod = "current_week" | "last_week";

export type AlbumLeaderboardScope = "global";

export type AlbumLeaderboardSort =
  | "score_desc"
  | "completion_desc"
  | "rare_count_desc"
  | "mint_count_desc";

export type AlbumLeaderboardQuery = {
  boardId?: string;
  period?: AlbumLeaderboardPeriod;
  scope?: AlbumLeaderboardScope;
  sort?: AlbumLeaderboardSort;
  cursor?: string;
  limit?: number;
};

export type AlbumLeaderboardEntry = {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  completionPercent: number;
  collectedCount: number;
  totalCount: number;
  rareCount: number;
  epicCount: number;
  legendaryCount: number;
  mintCount: number;
  updatedAt: string;
};

export type AlbumLeaderboardResponse = {
  boardId: string | null;
  period: AlbumLeaderboardPeriod;
  scope: AlbumLeaderboardScope;
  entries: AlbumLeaderboardEntry[];
  myEntry: AlbumLeaderboardEntry | null;
  nextCursor: string | null;
  generatedAt: string | null;
  empty: boolean;
};
