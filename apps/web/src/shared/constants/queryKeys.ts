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
  },
} as const;
