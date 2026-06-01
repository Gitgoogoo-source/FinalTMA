import { apiRequest } from "@/api/client";
import { API_ENDPOINTS } from "@/api/endpoints";
import { CURRENCY_CODE } from "@/shared/constants/currencies";

import type {
  AssetBalance,
  AssetBalanceMap,
  AssetProfile,
  AssetProfileSource,
  MyAssets,
  TopAssetCurrencyCode,
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
  const payload = readRecord(response, "/me/assets response");
  const balances = normalizeRequiredBalances(
    payload.balances,
    "/me/assets.balances",
    { requireCurrencyCode: true },
  );
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

  const balances = normalizeOptionalBalances(bootstrap.balances);

  if (!balances) {
    return null;
  }

  const profile = normalizeAssetProfile(bootstrap.profile, profileFallback);

  return buildMyAssets({
    userId: profile.id,
    profile,
    balances,
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
    balances: createEmptyBalances(),
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
    },
    wallet: WALLET_PLACEHOLDER,
    updatedAt: input.updatedAt,
  };
}

function normalizeRequiredBalances(
  value: unknown,
  path: string,
  options: {
    requireCurrencyCode: boolean;
  },
): AssetBalanceMap {
  const record = readRecord(value, path);

  return {
    KCOIN: normalizeRequiredBalance(
      CURRENCY_CODE.KCOIN,
      record[CURRENCY_CODE.KCOIN],
      `${path}.KCOIN`,
      options,
    ),
    FGEMS: normalizeRequiredBalance(
      CURRENCY_CODE.FGEMS,
      record[CURRENCY_CODE.FGEMS],
      `${path}.FGEMS`,
      options,
    ),
  };
}

function normalizeOptionalBalances(value: unknown): AssetBalanceMap | null {
  try {
    return normalizeRequiredBalances(value, "bootstrap.balances", {
      requireCurrencyCode: false,
    });
  } catch {
    return null;
  }
}

function createEmptyBalances(): AssetBalanceMap {
  return {
    KCOIN: createZeroBalance(CURRENCY_CODE.KCOIN),
    FGEMS: createZeroBalance(CURRENCY_CODE.FGEMS),
  };
}

function createZeroBalance(currencyCode: TopAssetCurrencyCode): AssetBalance {
  return {
    currencyCode,
    available: "0",
    locked: "0",
  };
}

function normalizeRequiredBalance(
  currencyCode: TopAssetCurrencyCode,
  value: unknown,
  path: string,
  options: {
    requireCurrencyCode: boolean;
  },
): AssetBalance {
  const record = readRecord(value, path);
  const responseCurrencyCode = readString(record.currencyCode);

  if (options.requireCurrencyCode && responseCurrencyCode !== currencyCode) {
    throw new Error(
      `Invalid asset response: ${path}.currencyCode must be ${currencyCode}.`,
    );
  }

  return {
    currencyCode,
    available: readRequiredCurrencyAmount(
      record.available,
      `${path}.available`,
    ),
    locked: readRequiredCurrencyAmount(record.locked, `${path}.locked`),
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

function readRequiredCurrencyAmount(value: unknown, path: string): string {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }
  }

  throw new Error(
    `Invalid asset response: ${path} must be a non-negative integer amount.`,
  );
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  throw new Error(`Invalid asset response: ${path} must be an object.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
