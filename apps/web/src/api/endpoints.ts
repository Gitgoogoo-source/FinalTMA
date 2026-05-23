export const API_ENDPOINTS = {
  health: "/health",
  auth: {
    telegram: "/auth/telegram",
    refresh: "/auth/refresh",
    logout: "/auth/logout",
  },
  me: {
    bootstrap: "/me/bootstrap",
    assets: "/me/assets",
    profile: "/me/profile",
    notifications: "/me/notifications",
  },
  boxes: {
    list: "/boxes/list",
    rewards: "/boxes/rewards",
    createOpenOrder: "/boxes/create-open-order",
    result: "/boxes/result",
  },
  inventory: {
    list: "/inventory/list",
  },
  market: {
    listings: "/market/listings",
    listingDetail: "/market/listing-detail",
    buy: "/market/buy",
    sellableItems: "/market/sellable-items",
    sellRules: "/market/sell-rules",
    createListing: "/market/create-listing",
    myListings: "/market/my-listings",
    myListingStats: "/market/my-listing-stats",
    updatePrice: "/market/update-price",
    cancelListing: "/market/cancel-listing",
    stats: "/market/stats",
  },
} as const;

export type ApiEndpointKey = keyof typeof API_ENDPOINTS;
