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
    result: (orderId: string | null | undefined) =>
      ["box", "result", orderId ?? "none"] as const,
  },
  inventory: {
    root: ["inventory"] as const,
    list: (userId: string | null | undefined) =>
      ["inventory", "list", userId ?? "anonymous"] as const,
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
