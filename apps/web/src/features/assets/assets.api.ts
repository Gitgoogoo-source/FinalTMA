import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";
import {
  CURRENCY_CODE,
  type CurrencyCode,
} from "@/shared/constants/currencies";
import { normalizeCurrencyAmount } from "@/shared/lib/formatCurrency";

import type {
  AssetBalance,
  AssetBalanceMap,
  AssetProfile,
  AssetProfileSource,
  MyAssets,
  WalletEntryState,
} from "./assets.types";

const WALLET_PLACEHOLDER: WalletEntryState = {
  status: "placeholder",
  label: "Connect Wallet",
};

export async function fetchMyAssets(
  profileFallback?: AssetProfileSource | null,
): Promise<MyAssets> {
  const response = await apiRequest<unknown>(API_ENDPOINTS.me.assets, {
    method: "GET",
  });

  return normalizeMyAssetsResponse(response, profileFallback);
}

export function normalizeMyAssetsResponse(
  response: unknown,
  profileFallback?: AssetProfileSource | null,
): MyAssets {
  const payload = isRecord(response) ? response : {};
  const balances = normalizeBalances(payload.balances);
  const profile = normalizeAssetProfile(payload.profile, profileFallback);
  const userId =
    readString(payload.userId) ?? readString(payload.user_id) ?? profile.id;

  return buildMyAssets({
    userId,
    profile,
    balances,
    updatedAt: readString(payload.updatedAt) ?? readString(payload.updated_at),
  });
}

export function normalizeBootstrapAssets(
  bootstrap: unknown,
  profileFallback?: AssetProfileSource | null,
): MyAssets | null {
  if (!isRecord(bootstrap)) {
    return null;
  }

  const profile = normalizeAssetProfile(bootstrap.profile, profileFallback);

  return buildMyAssets({
    userId: profile.id,
    profile,
    balances: normalizeBalances(bootstrap.balances),
    updatedAt:
      readString(bootstrap.updatedAt) ??
      readString(bootstrap.updated_at) ??
      readString(bootstrap.server_time),
  });
}

export function createEmptyMyAssets(
  profileFallback?: AssetProfileSource | null,
): MyAssets {
  const profile = normalizeAssetProfile(null, profileFallback);

  return buildMyAssets({
    userId: profile.id,
    profile,
    balances: normalizeBalances(null),
    updatedAt: null,
  });
}

export function getAssetProfileDisplayName(profile: AssetProfile): string {
  return profile.displayName;
}

function buildMyAssets(input: {
  userId: string | null;
  profile: AssetProfile;
  balances: AssetBalanceMap;
  updatedAt: string | null;
}): MyAssets {
  return {
    userId: input.userId,
    profile: input.profile,
    balances: input.balances,
    assets: {
      kcoin: input.balances.KCOIN,
      fgems: input.balances.FGEMS,
      stars: input.balances.STAR_DISPLAY,
    },
    wallet: WALLET_PLACEHOLDER,
    updatedAt: input.updatedAt,
  };
}

function normalizeBalances(value: unknown): AssetBalanceMap {
  const record = isRecord(value) ? value : {};

  return {
    KCOIN: normalizeBalance(CURRENCY_CODE.KCOIN, record[CURRENCY_CODE.KCOIN]),
    FGEMS: normalizeBalance(CURRENCY_CODE.FGEMS, record[CURRENCY_CODE.FGEMS]),
    STAR_DISPLAY: normalizeBalance(
      CURRENCY_CODE.STAR_DISPLAY,
      record[CURRENCY_CODE.STAR_DISPLAY],
    ),
  };
}

function normalizeBalance(
  currencyCode: CurrencyCode,
  value: unknown,
): AssetBalance {
  const record = isRecord(value) ? value : {};

  return {
    currencyCode,
    available: normalizeCurrencyAmount(record.available),
    locked: normalizeCurrencyAmount(record.locked),
  };
}

function normalizeAssetProfile(
  value: unknown,
  fallback?: AssetProfileSource | null,
): AssetProfile {
  const record = isRecord(value) ? value : {};
  const username =
    readString(record.username) ?? normalizeOptionalString(fallback?.username);
  const firstName =
    readString(record.first_name) ??
    readString(record.firstName) ??
    normalizeOptionalString(fallback?.firstName);
  const lastName =
    readString(record.last_name) ??
    readString(record.lastName) ??
    normalizeOptionalString(fallback?.lastName);
  const displayName =
    readString(record.display_name) ??
    readString(record.displayName) ??
    normalizeOptionalString(fallback?.displayName) ??
    buildDisplayName(firstName, lastName, username);

  return {
    id: readString(record.id) ?? normalizeOptionalString(fallback?.id),
    telegramUserId:
      readString(record.telegram_user_id) ??
      readString(record.telegramUserId) ??
      normalizeOptionalString(fallback?.telegramUserId),
    username,
    firstName,
    lastName,
    displayName,
    avatarUrl:
      readString(record.avatar_url) ??
      readString(record.avatarUrl) ??
      normalizeOptionalString(fallback?.avatarUrl),
  };
}

function buildDisplayName(
  firstName: string | null,
  lastName: string | null,
  username: string | null,
): string {
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  if (fullName) {
    return fullName;
  }

  if (username) {
    return `@${username}`;
  }

  return "玩家";
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
