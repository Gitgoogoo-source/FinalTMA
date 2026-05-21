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
} as const;

export type ApiEndpointKey = keyof typeof API_ENDPOINTS;
