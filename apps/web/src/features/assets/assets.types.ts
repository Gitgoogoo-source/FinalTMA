import type { CurrencyCode } from "@/shared/constants/currencies";

export type AssetBalance = {
  currencyCode: CurrencyCode;
  available: string;
  locked: string;
};

export type AssetBalanceMap = {
  KCOIN: AssetBalance;
  FGEMS: AssetBalance;
  STAR_DISPLAY: AssetBalance;
};

export type AssetSummary = {
  kcoin: AssetBalance;
  fgems: AssetBalance;
  stars: AssetBalance;
};

export type AssetProfile = {
  id: string | null;
  telegramUserId: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type WalletEntryState = {
  status: "placeholder";
  label: "Connect Wallet";
};

export type MyAssets = {
  userId: string | null;
  profile: AssetProfile;
  balances: AssetBalanceMap;
  assets: AssetSummary;
  wallet: WalletEntryState;
  updatedAt: string | null;
};

export type AssetProfileSource = {
  id?: string | null;
  telegramUserId?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};
