export const queryKeys = {
  me: {
    bootstrap: ["me", "bootstrap"] as const,
    assetsRoot: ["me", "assets"] as const,
    assets: (userId: string | null | undefined) =>
      ["me", "assets", userId ?? "anonymous"] as const,
  },
} as const;
