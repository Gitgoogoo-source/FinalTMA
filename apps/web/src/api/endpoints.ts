export const API_ENDPOINTS = {
  health: "/health",
} as const;

export type ApiEndpointKey = keyof typeof API_ENDPOINTS;
