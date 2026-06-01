export type TopAssetCurrencyCode = "KCOIN" | "FGEMS";

export type AssetBalance = {
  currencyCode: TopAssetCurrencyCode;
  available: string;
  locked: string;
};

export type AssetBalanceMap = {
  KCOIN: AssetBalance;
  FGEMS: AssetBalance;
};

export type AssetSummary = {
  kcoin: AssetBalance;
  fgems: AssetBalance;
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
