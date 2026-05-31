import { callRpcRaw } from "../../../packages/server/src/db/rpc.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  buildNextCursor,
  firstQueryValue,
  isRecord,
  parseAdminLimit,
  parseOffsetCursor,
} from "../_shared.js";
import {
  hashRiskValue,
  last4,
  normalizeRiskUserId,
  serializeRiskEvent,
  serializeUserFlag,
  shortAddress,
  sanitizeRiskDetail,
  type RiskEventRow,
  type UserFlagRow,
} from "./_shared.js";

type UserRow = {
  id: string;
  telegram_user_id: number | string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  is_premium: boolean;
  is_bot: boolean;
  invite_code: string;
  referred_by_user_id: string | null;
  status: string;
  risk_score: number;
  first_seen_at: string;
  last_seen_at: string | null;
  last_auth_at: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type StarOrderRow = {
  id: string;
  user_id: string;
  business_type: string;
  business_id: string | null;
  status: string;
  xtr_amount: number | string;
  paid_at: string | null;
  fulfilled_at: string | null;
  created_at: string;
};

type MarketOrderRow = {
  id: string;
  buyer_user_id: string;
  seller_user_id: string;
  status: string;
  item_count: number | string;
  total_price_kcoin: number | string;
  completed_at: string | null;
  created_at: string;
};

type ReferralRow = {
  id: string;
  inviter_user_id: string;
  invitee_user_id: string;
  status: string;
  first_open_order_id: string | null;
  qualified_at: string | null;
  rewarded_at: string | null;
  created_at: string;
};

type WalletRow = {
  id: string;
  user_id: string;
  chain: string;
  network: string;
  address: string;
  wallet_app_name: string | null;
  wallet_device: string | null;
  is_primary: boolean;
  status: string;
  verified_at: string | null;
  disconnected_at: string | null;
  last_sync_at: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type WalletReuseCountRow = {
  address: string;
  reuse_user_count: number | string;
};

type UserDeviceRow = {
  id: string;
  user_id: string;
  device_key: string;
  platform: string | null;
  user_agent: string | null;
  first_seen_at: string;
  last_seen_at: string | null;
  metadata: unknown;
};

type AppSessionRow = {
  id: string;
  user_id: string;
  ip_hash: string | null;
  device_id: string | null;
  platform: string | null;
  user_agent: string | null;
  expires_at: string;
  revoked_at: string | null;
  last_seen_at: string | null;
  created_at: string;
};

type ProfileSection =
  | "devices"
  | "flags"
  | "payments"
  | "market"
  | "referrals"
  | "wallets"
  | "riskEvents";

type SectionPage = {
  limit: number;
  offset: number;
};

type RiskUserProfileRpcPayload = {
  user?: unknown;
  flags?: unknown;
  payments?: unknown;
  market?: unknown;
  referrals?: unknown;
  wallets?: unknown;
  devices?: unknown;
  risk_events?: unknown;
};

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["risk:read", "admin:read"],
      requireAll: false,
    });

    const userId = normalizeRiskUserId(req.query.userId ?? req.query.user_id);
    const section = parseProfileSection(req.query.section);
    const offset = parseOffsetCursor(req.query.cursor);
    const limit = parseAdminLimit(req.query.limit);
    const sectionPage = getSectionPage(section, offset, limit);
    const payload = await loadRiskUserProfile(userId, section, limit, offset);
    const user = readUser(payload.user);

    if (!user) {
      throw new ApiError(404, "USER_NOT_FOUND", "User not found");
    }

    return {
      user: serializeUser(user),
      flags: buildUserFlags(payload.flags, sectionPage("flags")),
      payments: buildPaymentSummary(payload.payments, sectionPage("payments")),
      market: buildMarketSummary(userId, payload.market, sectionPage("market")),
      referrals: buildReferralSummary(
        userId,
        payload.referrals,
        sectionPage("referrals"),
      ),
      wallets: buildWalletSummary(payload.wallets, sectionPage("wallets")),
      devices: buildDeviceSummary(payload.devices, sectionPage("devices")),
      riskEvents: buildRiskTimeline(
        payload.risk_events,
        sectionPage("riskEvents"),
      ),
      serverTime: new Date().toISOString(),
    };
  },
  {
    methods: ["GET"],
    rateLimit: {
      action: "admin.read",
    },
  },
);

function parseProfileSection(value: unknown): ProfileSection | null {
  const raw = firstQueryValue(value)?.replace(/_([a-z])/g, (_, letter) =>
    String(letter).toUpperCase(),
  );

  if (!raw) {
    return null;
  }

  if (
    raw === "flags" ||
    raw === "devices" ||
    raw === "payments" ||
    raw === "market" ||
    raw === "referrals" ||
    raw === "wallets" ||
    raw === "riskEvents"
  ) {
    return raw;
  }

  throw new ApiError(
    400,
    "ADMIN_RISK_PROFILE_SECTION_INVALID",
    "section is not supported for risk user profile",
  );
}

function getSectionPage(
  activeSection: ProfileSection | null,
  offset: number,
  limit: number,
): (target: ProfileSection) => SectionPage {
  return (target) => ({
    limit,
    offset: activeSection === null || activeSection === target ? offset : 0,
  });
}

async function loadRiskUserProfile(
  userId: string,
  section: ProfileSection | null,
  limit: number,
  offset: number,
): Promise<RiskUserProfileRpcPayload> {
  try {
    return await callRpcRaw<RiskUserProfileRpcPayload>(
      "admin_get_risk_user_profile",
      {
        p_user_id: userId,
        p_section: section,
        p_limit: limit,
        p_offset: offset,
      },
      {
        schema: "api" as never,
        context: {
          route: "admin.risk.user-profile",
          userId,
          section,
        },
      },
    );
  } catch (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_USER_PROFILE_LOOKUP_FAILED",
      "用户风控画像查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }
}

function serializeUser(row: UserRow): Record<string, unknown> {
  return {
    id: row.id,
    telegram_user_id: row.telegram_user_id,
    telegramUserId: row.telegram_user_id,
    username: row.username,
    first_name: row.first_name,
    firstName: row.first_name,
    last_name: row.last_name,
    lastName: row.last_name,
    language_code: row.language_code,
    languageCode: row.language_code,
    is_premium: row.is_premium,
    isPremium: row.is_premium,
    is_bot: row.is_bot,
    isBot: row.is_bot,
    invite_code: row.invite_code,
    inviteCode: row.invite_code,
    referred_by_user_id: row.referred_by_user_id,
    referredByUserId: row.referred_by_user_id,
    status: row.status,
    risk_score: row.risk_score,
    riskScore: row.risk_score,
    first_seen_at: row.first_seen_at,
    firstSeenAt: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    lastSeenAt: row.last_seen_at,
    last_auth_at: row.last_auth_at,
    lastAuthAt: row.last_auth_at,
    metadata: sanitizeRiskDetail(row.metadata),
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function buildUserFlags(
  payload: unknown,
  page: SectionPage,
): Record<string, unknown> {
  const section = readRecord(payload);
  const rows = readRows<UserFlagRow>(section.rows);
  const pageRows = rows.slice(0, page.limit);
  const items = pageRows.map(serializeUserFlag);
  const totalCount = readNumber(section.total_count);
  const nextCursor = buildNextCursor(rows.length, page.limit, page.offset);

  return {
    active: items.filter((item) => item.active === true),
    recent: items,
    items,
    totalCount,
    total_count: totalCount,
    pageCount: items.length,
    page_count: items.length,
    nextCursor,
    next_cursor: nextCursor,
  };
}

function buildPaymentSummary(
  payload: unknown,
  page: SectionPage,
): Record<string, unknown> {
  const section = readRecord(payload);
  const totalCount = readNumber(section.total_count);
  const successCount = readNumber(section.success_count);
  const failedCount = readNumber(section.failed_count);
  const disputedCount = readNumber(section.disputed_count);
  const rows = readRows<StarOrderRow>(section.rows);
  const pageRows = rows.slice(0, page.limit);
  const recent = pageRows.map((row) => ({
    id: row.id,
    status: row.status,
    business_type: row.business_type,
    businessType: row.business_type,
    business_id: row.business_id,
    businessId: row.business_id,
    xtr_amount: row.xtr_amount,
    xtrAmount: row.xtr_amount,
    paid_at: row.paid_at,
    paidAt: row.paid_at,
    fulfilled_at: row.fulfilled_at,
    fulfilledAt: row.fulfilled_at,
    created_at: row.created_at,
    createdAt: row.created_at,
  }));
  const failureRate =
    totalCount > 0 ? roundRate((failedCount + disputedCount) / totalCount) : 0;
  const nextCursor = buildNextCursor(rows.length, page.limit, page.offset);

  return {
    totalCount,
    total_count: totalCount,
    successCount,
    success_count: successCount,
    failedCount,
    failed_count: failedCount,
    failureRate,
    failure_rate: failureRate,
    disputedCount,
    disputed_count: disputedCount,
    statusCounts: countBy(pageRows, (row) => row.status),
    status_counts: countBy(pageRows, (row) => row.status),
    recent,
    items: recent,
    pageCount: recent.length,
    page_count: recent.length,
    nextCursor,
    next_cursor: nextCursor,
  };
}

function buildMarketSummary(
  userId: string,
  payload: unknown,
  page: SectionPage,
): Record<string, unknown> {
  const section = readRecord(payload);
  const buyerCount = readNumber(section.buyer_count);
  const sellerCount = readNumber(section.seller_count);
  const rows = readRows<MarketOrderRow>(section.rows);
  const counterpartyRows = readRows<MarketOrderRow>(section.counterparty_rows);
  const pageRows = rows.slice(0, page.limit);
  const counterparties = summarizeCounterparties(userId, counterpartyRows);
  const recent = pageRows.map((row) => ({
    id: row.id,
    role: row.buyer_user_id === userId ? "buyer" : "seller",
    counterpartyUserId:
      row.buyer_user_id === userId ? row.seller_user_id : row.buyer_user_id,
    counterparty_user_id:
      row.buyer_user_id === userId ? row.seller_user_id : row.buyer_user_id,
    status: row.status,
    item_count: row.item_count,
    itemCount: row.item_count,
    total_price_kcoin: row.total_price_kcoin,
    totalPriceKcoin: row.total_price_kcoin,
    completed_at: row.completed_at,
    completedAt: row.completed_at,
    created_at: row.created_at,
    createdAt: row.created_at,
  }));
  const nextCursor = buildNextCursor(rows.length, page.limit, page.offset);

  return {
    buyerCount,
    buyer_count: buyerCount,
    sellerCount,
    seller_count: sellerCount,
    totalCount: buyerCount + sellerCount,
    total_count: buyerCount + sellerCount,
    statusCounts: countBy(pageRows, (row) => row.status),
    status_counts: countBy(pageRows, (row) => row.status),
    topCounterparties: counterparties,
    top_counterparties: counterparties,
    recent,
    items: recent,
    pageCount: recent.length,
    page_count: recent.length,
    nextCursor,
    next_cursor: nextCursor,
  };
}

function buildReferralSummary(
  userId: string,
  payload: unknown,
  page: SectionPage,
): Record<string, unknown> {
  const section = readRecord(payload);
  const invitedCount = readNumber(section.invited_count);
  const invitedByCount = readNumber(section.invited_by_count);
  const firstOpenCount = readNumber(section.first_open_count);
  const qualifiedCount = readNumber(section.qualified_count);
  const rewardedCount = readNumber(section.rewarded_count);
  const rows = readRows<ReferralRow>(section.rows);
  const pageRows = rows.slice(0, page.limit);
  const inviterRows = pageRows.filter((row) => row.inviter_user_id === userId);
  const inviteeRows = pageRows.filter((row) => row.invitee_user_id === userId);
  const items = pageRows.map((row) => ({
    ...serializeReferral(row),
    role: row.inviter_user_id === userId ? "inviter" : "invitee",
  }));
  const firstOpenConversionRate =
    invitedCount > 0 ? roundRate(firstOpenCount / invitedCount) : 0;
  const nextCursor = buildNextCursor(rows.length, page.limit, page.offset);

  return {
    invitedCount,
    invited_count: invitedCount,
    invitedByCount,
    invited_by_count: invitedByCount,
    totalCount: invitedCount + invitedByCount,
    total_count: invitedCount + invitedByCount,
    firstOpenCount,
    first_open_count: firstOpenCount,
    firstOpenConversionRate,
    first_open_conversion_rate: firstOpenConversionRate,
    qualifiedCount,
    qualified_count: qualifiedCount,
    rewardedCount,
    rewarded_count: rewardedCount,
    statusCounts: countBy(pageRows, (row) => row.status),
    status_counts: countBy(pageRows, (row) => row.status),
    asInviter: inviterRows.map(serializeReferral),
    as_inviter: inviterRows.map(serializeReferral),
    asInvitee: inviteeRows.map(serializeReferral),
    as_invitee: inviteeRows.map(serializeReferral),
    items,
    pageCount: items.length,
    page_count: items.length,
    nextCursor,
    next_cursor: nextCursor,
  };
}

function buildWalletSummary(
  payload: unknown,
  page: SectionPage,
): Record<string, unknown> {
  const section = readRecord(payload);
  const totalCount = readNumber(section.total_count);
  const rows = readRows<WalletRow>(section.rows);
  const wallets = rows.slice(0, page.limit);
  const reuseCounts = readWalletReuseCounts(section.reuse_counts);
  const items = wallets.map((wallet) => {
    const addressHash = hashRiskValue(wallet.address);

    return {
      id: wallet.id,
      chain: wallet.chain,
      network: wallet.network,
      addressShort: shortAddress(wallet.address),
      addressLast4: last4(wallet.address),
      addressHash,
      address_hash: addressHash,
      wallet_app_name: wallet.wallet_app_name,
      walletAppName: wallet.wallet_app_name,
      wallet_device: wallet.wallet_device,
      walletDevice: wallet.wallet_device,
      is_primary: wallet.is_primary,
      isPrimary: wallet.is_primary,
      status: wallet.status,
      verified_at: wallet.verified_at,
      verifiedAt: wallet.verified_at,
      disconnected_at: wallet.disconnected_at,
      disconnectedAt: wallet.disconnected_at,
      last_sync_at: wallet.last_sync_at,
      lastSyncAt: wallet.last_sync_at,
      metadata: sanitizeRiskDetail(wallet.metadata),
      reuseUserCount: reuseCounts.get(wallet.address) ?? 0,
      reuse_user_count: reuseCounts.get(wallet.address) ?? 0,
      created_at: wallet.created_at,
      createdAt: wallet.created_at,
      updated_at: wallet.updated_at,
      updatedAt: wallet.updated_at,
    };
  });
  const addressReuseCount = items.reduce(
    (sum, item) => sum + Number(item.reuseUserCount ?? 0),
    0,
  );
  const nextCursor = buildNextCursor(rows.length, page.limit, page.offset);

  return {
    count: totalCount,
    totalCount,
    total_count: totalCount,
    pageCount: items.length,
    page_count: items.length,
    statusCounts: countBy(wallets, (wallet) => wallet.status),
    status_counts: countBy(wallets, (wallet) => wallet.status),
    addressReuseCount,
    address_reuse_count: addressReuseCount,
    items,
    nextCursor,
    next_cursor: nextCursor,
  };
}

function buildDeviceSummary(
  payload: unknown,
  page: SectionPage,
): Record<string, unknown> {
  const section = readRecord(payload);
  const deviceCount = readNumber(section.device_count);
  const sessionCount = readNumber(section.session_count);
  const deviceRows = readRows<UserDeviceRow>(section.device_rows);
  const sessionRows = readRows<AppSessionRow>(section.session_rows);
  const devices = deviceRows.slice(0, page.limit).map((device) => ({
    id: device.id,
    deviceHash: hashRiskValue(device.device_key),
    device_hash: hashRiskValue(device.device_key),
    deviceLast4: last4(device.device_key),
    device_last4: last4(device.device_key),
    platform: device.platform,
    userAgentHash: hashRiskValue(device.user_agent),
    user_agent_hash: hashRiskValue(device.user_agent),
    first_seen_at: device.first_seen_at,
    firstSeenAt: device.first_seen_at,
    last_seen_at: device.last_seen_at,
    lastSeenAt: device.last_seen_at,
    metadata: sanitizeRiskDetail(device.metadata),
  }));
  const sessions = sessionRows.slice(0, page.limit).map((session) => ({
    ip_hash: session.ip_hash,
    ipHash: session.ip_hash,
    deviceHash: hashRiskValue(session.device_id),
    device_hash: hashRiskValue(session.device_id),
    deviceLast4: last4(session.device_id),
    device_last4: last4(session.device_id),
    platform: session.platform,
    userAgentHash: hashRiskValue(session.user_agent),
    user_agent_hash: hashRiskValue(session.user_agent),
    revoked: session.revoked_at !== null,
    expires_at: session.expires_at,
    expiresAt: session.expires_at,
    last_seen_at: session.last_seen_at,
    lastSeenAt: session.last_seen_at,
    created_at: session.created_at,
    createdAt: session.created_at,
  }));
  const recentIpHashes = uniqueStrings(
    sessionRows.map((session) => session.ip_hash),
  );
  const recentDeviceHashes = uniqueStrings([
    ...deviceRows.map((device) => hashRiskValue(device.device_key)),
    ...sessionRows.map((session) => hashRiskValue(session.device_id)),
  ]);
  const nextCursor = buildNextCursor(
    Math.max(deviceRows.length, sessionRows.length),
    page.limit,
    page.offset,
  );

  return {
    deviceCount,
    device_count: deviceCount,
    sessionCount,
    session_count: sessionCount,
    ipHashCount: recentIpHashes.length,
    ip_hash_count: recentIpHashes.length,
    recentIpHashes,
    recent_ip_hashes: recentIpHashes,
    recentDeviceHashes,
    recent_device_hashes: recentDeviceHashes,
    devices,
    sessions,
    items: devices,
    pageCount: devices.length,
    page_count: devices.length,
    nextCursor,
    next_cursor: nextCursor,
  };
}

function buildRiskTimeline(
  payload: unknown,
  page: SectionPage,
): Record<string, unknown> {
  const section = readRecord(payload);
  const totalCount = readNumber(section.total_count);
  const rows = readRows<RiskEventRow>(section.rows);
  const items = rows.slice(0, page.limit).map(serializeRiskEvent);
  const nextCursor = buildNextCursor(rows.length, page.limit, page.offset);

  return {
    items,
    recent: items,
    totalCount,
    total_count: totalCount,
    pageCount: items.length,
    page_count: items.length,
    nextCursor,
    next_cursor: nextCursor,
  };
}

function readUser(value: unknown): UserRow | null {
  return isRecord(value) ? (value as unknown as UserRow) : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readRows<TRow>(value: unknown): TRow[] {
  return Array.isArray(value) ? (value as TRow[]) : [];
}

function readNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function readWalletReuseCounts(value: unknown): Map<string, number> {
  const rows = readRows<WalletReuseCountRow>(value);
  const result = new Map<string, number>();

  for (const row of rows) {
    if (typeof row.address !== "string") {
      continue;
    }

    result.set(row.address, readNumber(row.reuse_user_count));
  }

  return result;
}

function roundRate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function countBy<T>(
  rows: T[],
  keyFn: (row: T) => string | null | undefined,
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const row of rows) {
    const key = keyFn(row);

    if (key) {
      result[key] = (result[key] ?? 0) + 1;
    }
  }

  return result;
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function summarizeCounterparties(
  userId: string,
  rows: MarketOrderRow[],
): Array<Record<string, unknown>> {
  const byUserId = new Map<
    string,
    {
      userId: string;
      buyCount: number;
      sellCount: number;
      totalCount: number;
      totalVolumeKcoin: number;
    }
  >();

  for (const row of rows) {
    const counterpartyUserId =
      row.buyer_user_id === userId ? row.seller_user_id : row.buyer_user_id;
    const current = byUserId.get(counterpartyUserId) ?? {
      userId: counterpartyUserId,
      buyCount: 0,
      sellCount: 0,
      totalCount: 0,
      totalVolumeKcoin: 0,
    };

    if (row.buyer_user_id === userId) {
      current.buyCount += 1;
    } else {
      current.sellCount += 1;
    }

    current.totalCount += 1;
    current.totalVolumeKcoin += Number(row.total_price_kcoin) || 0;
    byUserId.set(counterpartyUserId, current);
  }

  return Array.from(byUserId.values())
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, 10)
    .map((item) => ({
      userId: item.userId,
      user_id: item.userId,
      buyCount: item.buyCount,
      buy_count: item.buyCount,
      sellCount: item.sellCount,
      sell_count: item.sellCount,
      totalCount: item.totalCount,
      total_count: item.totalCount,
      totalVolumeKcoin: item.totalVolumeKcoin,
      total_volume_kcoin: item.totalVolumeKcoin,
    }));
}

function serializeReferral(row: ReferralRow): Record<string, unknown> {
  return {
    id: row.id,
    inviter_user_id: row.inviter_user_id,
    inviterUserId: row.inviter_user_id,
    invitee_user_id: row.invitee_user_id,
    inviteeUserId: row.invitee_user_id,
    status: row.status,
    first_open_order_id: row.first_open_order_id,
    firstOpenOrderId: row.first_open_order_id,
    qualified_at: row.qualified_at,
    qualifiedAt: row.qualified_at,
    rewarded_at: row.rewarded_at,
    rewardedAt: row.rewarded_at,
    created_at: row.created_at,
    createdAt: row.created_at,
  };
}
