export const queryKeys = {
  me: {
    bootstrap: ["me", "bootstrap"] as const,
    assetsRoot: ["me", "assets"] as const,
    assets: (userId: string | null | undefined) =>
      ["me", "assets", userId ?? "anonymous"] as const,
  },
  box: {
    root: ["box"] as const,
    list: ["box", "list"] as const,
    rewards: (boxId: string | null | undefined) =>
      ["box", "rewards", boxId ?? "none"] as const,
    paymentStatus: (orderId: string | null | undefined) =>
      ["box", "payment-status", orderId ?? "none"] as const,
    pendingDrawOrder: (orderId: string | null | undefined) =>
      ["box", "pending-draw-order", orderId ?? "none"] as const,
    result: (orderId: string | null | undefined) =>
      ["box", "result", orderId ?? "none"] as const,
  },
  inventory: {
    root: ["inventory"] as const,
    list: (userId: string | null | undefined) =>
      ["inventory", "list", userId ?? "anonymous"] as const,
    detail: (
      userId: string | null | undefined,
      itemId: string | null | undefined,
    ) =>
      ["inventory", "detail", userId ?? "anonymous", itemId ?? "none"] as const,
    activity: (userId: string | null | undefined, query: unknown = {}) =>
      ["inventory", "activity", userId ?? "anonymous", query] as const,
  },
  album: {
    root: ["album"] as const,
    progress: (userId: string | null | undefined, query: unknown = {}) =>
      ["album", "progress", userId ?? "anonymous", query] as const,
    series: (userId: string | null | undefined, query: unknown = {}) =>
      ["album", "series", userId ?? "anonymous", query] as const,
    items: (userId: string | null | undefined, query: unknown = {}) =>
      ["album", "items", userId ?? "anonymous", query] as const,
    leaderboardRoot: ["album", "leaderboard"] as const,
    leaderboard: (userId: string | null | undefined, query: unknown = {}) =>
      ["album", "leaderboard", userId ?? "anonymous", query] as const,
  },
  tasks: {
    root: ["tasks"] as const,
    overview: (userId: string | null | undefined) =>
      ["tasks", "overview", userId ?? "anonymous"] as const,
    listRoot: (userId: string | null | undefined) =>
      ["tasks", "list", userId ?? "anonymous"] as const,
    list: (userId: string | null | undefined, query: unknown = {}) =>
      ["tasks", "list", userId ?? "anonymous", query] as const,
    checkInStatus: (userId: string | null | undefined) =>
      ["tasks", "check-in-status", userId ?? "anonymous"] as const,
    inviteStats: (userId: string | null | undefined) =>
      ["tasks", "invite-stats", userId ?? "anonymous"] as const,
    referralRecordsRoot: (userId: string | null | undefined) =>
      ["tasks", "referral-records", userId ?? "anonymous"] as const,
    referralRecords: (userId: string | null | undefined, query: unknown = {}) =>
      ["tasks", "referral-records", userId ?? "anonymous", query] as const,
    commissionHistoryRoot: (userId: string | null | undefined) =>
      ["tasks", "commission-history", userId ?? "anonymous"] as const,
    commissionHistory: (
      userId: string | null | undefined,
      query: unknown = {},
    ) => ["tasks", "commission-history", userId ?? "anonymous", query] as const,
    rewardHistoryRoot: (userId: string | null | undefined) =>
      ["tasks", "reward-history", userId ?? "anonymous"] as const,
    rewardHistory: (userId: string | null | undefined, query: unknown = {}) =>
      ["tasks", "reward-history", userId ?? "anonymous", query] as const,
  },
  wallet: {
    root: ["wallet"] as const,
    status: (userId: string | null | undefined) =>
      ["wallet", "status", userId ?? "anonymous"] as const,
    mintQueue: (userId: string | null | undefined) =>
      ["wallet", "mint-queue", userId ?? "anonymous"] as const,
  },
  trade: {
    root: ["trade"] as const,
    listingsRoot: ["trade", "listings"] as const,
    listings: (query: unknown = {}) => ["trade", "listings", query] as const,
    listingDetailRoot: ["trade", "listing-detail"] as const,
    listingDetail: (listingId: string | null | undefined) =>
      ["trade", "listing-detail", listingId ?? "none"] as const,
    sellableItemsRoot: ["trade", "sellable-items"] as const,
    sellableItems: (query: unknown = {}) =>
      ["trade", "sellable-items", query] as const,
    sellRules: ["trade", "sell-rules"] as const,
    myListingsRoot: ["trade", "my-listings"] as const,
    myListings: (query: unknown = {}) =>
      ["trade", "my-listings", query] as const,
    myListingStats: ["trade", "my-listing-stats"] as const,
    stats: (query: unknown = {}) => ["trade", "stats", query] as const,
  },
} as const;
