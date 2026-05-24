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
  raritySummary: AlbumRaritySummaryItem[];
  seriesSummary: AlbumSeriesSummaryItem[];
  empty: boolean;
  serverTime: string | null;
};
