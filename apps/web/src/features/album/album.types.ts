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

export type AlbumMilestone = {
  milestoneId: string;
  bookId: string;
  requiredCount: number;
  requiredPercent: number | null;
  title: string | null;
  status: string;
  rewards: AlbumReward[];
  claimedAt: string | null;
  version: number;
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
