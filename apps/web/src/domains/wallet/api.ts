export const walletRouteIds = [
  "wallet.get",
  "wallet.challenge",
  "wallet.verify",
  "wallet.disconnect",
] as const;

export type WalletRouteId = (typeof walletRouteIds)[number];
