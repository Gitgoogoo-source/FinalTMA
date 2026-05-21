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
} as const;

export type ApiEndpointKey = keyof typeof API_ENDPOINTS;
