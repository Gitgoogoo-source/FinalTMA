import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../../_shared/handler.js";
import { requireAdmin } from "../../_shared/requireAdmin.js";
import {
  buildNextCursor,
  firstQueryValue,
  parseAdminLimit,
  parseOffsetCursor,
} from "../_shared.js";
import {
  hashRiskValue,
  last4,
  normalizeRiskUserId,
  RISK_EVENT_COLUMNS,
  serializeRiskEvent,
  serializeUserFlag,
  shortAddress,
  sanitizeRiskDetail,
  USER_FLAG_COLUMNS,
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

type WalletReuseRow = {
  user_id: string;
  address: string;
};

type ProfileSection =
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

const USER_COLUMNS = [
  "id",
  "telegram_user_id",
  "username",
  "first_name",
  "last_name",
  "language_code",
  "is_premium",
  "is_bot",
  "invite_code",
  "referred_by_user_id",
  "status",
  "risk_score",
  "first_seen_at",
  "last_seen_at",
  "last_auth_at",
  "metadata",
  "created_at",
  "updated_at",
].join(",");
const STAR_ORDER_COLUMNS = [
  "id",
  "user_id",
  "business_type",
  "business_id",
  "status",
  "xtr_amount",
  "paid_at",
  "fulfilled_at",
  "created_at",
].join(",");
const MARKET_ORDER_COLUMNS = [
  "id",
  "buyer_user_id",
  "seller_user_id",
  "status",
  "item_count",
  "total_price_kcoin",
  "completed_at",
  "created_at",
].join(",");
const REFERRAL_COLUMNS = [
  "id",
  "inviter_user_id",
  "invitee_user_id",
  "status",
  "first_open_order_id",
  "qualified_at",
  "rewarded_at",
  "created_at",
].join(",");
const WALLET_COLUMNS = [
  "id",
  "user_id",
  "chain",
  "network",
  "address",
  "wallet_app_name",
  "wallet_device",
  "is_primary",
  "status",
  "verified_at",
  "disconnected_at",
  "last_sync_at",
  "metadata",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["risk:read", "admin:read"],
      requireAll: false,
    });

    const db = getSupabaseAdminClient();
    const userId = normalizeRiskUserId(req.query.userId ?? req.query.user_id);
    const section = parseProfileSection(req.query.section);
    const sectionPage = getSectionPage(
      section,
      parseOffsetCursor(req.query.cursor),
      parseAdminLimit(req.query.limit),
    );
    const [
      user,
      flags,
      payments,
      market,
      referrals,
      wallets,
      riskEvents,
    ] = await Promise.all([
      loadUser(db, userId),
      loadUserFlags(db, userId, sectionPage("flags")),
      loadPaymentSummary(db, userId, sectionPage("payments")),
      loadMarketSummary(db, userId, sectionPage("market")),
      loadReferralSummary(db, userId, sectionPage("referrals")),
      loadWalletSummary(db, userId, sectionPage("wallets")),
      loadRiskTimeline(db, userId, sectionPage("riskEvents")),
    ]);

    return {
      user,
      flags,
      payments,
      market,
      referrals,
      wallets,
      riskEvents,
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

async function loadUser(
  db: SupabaseAdminClient,
  userId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await db
    .schema("core")
    .from("users")
    .select(USER_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "ADMIN_RISK_USER_LOOKUP_FAILED", "用户查询失败。", {
      expose: false,
      cause: error,
    });
  }

  if (!data) {
    throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  }

  const row = data as unknown as UserRow;

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

async function loadUserFlags(
  db: SupabaseAdminClient,
  userId: string,
  page: SectionPage,
): Promise<Record<string, unknown>> {
  const totalCount = await countRows(db, "core", "user_flags", "user_id", userId);
  const { data, error } = await db
    .schema("core")
    .from("user_flags")
    .select(USER_FLAG_COLUMNS)
    .eq("user_id", userId)
    .order("active", { ascending: false })
    .order("created_at", { ascending: false })
    .range(page.offset, page.offset + page.limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_USER_FLAGS_LOOKUP_FAILED",
      "用户风控标签查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const rows = Array.isArray(data) ? (data as unknown as UserFlagRow[]) : [];
  const pageRows = rows.slice(0, page.limit);
  const items = pageRows.map(serializeUserFlag);

  return {
    active: items.filter((item) => item.active === true),
    recent: items,
    items,
    totalCount,
    total_count: totalCount,
    pageCount: items.length,
    page_count: items.length,
    nextCursor: buildNextCursor(rows.length, page.limit, page.offset),
    next_cursor: buildNextCursor(rows.length, page.limit, page.offset),
  };
}

async function loadPaymentSummary(
  db: SupabaseAdminClient,
  userId: string,
  page: SectionPage,
): Promise<Record<string, unknown>> {
  const [totalCount, successCount, failedCount, disputedCount, recentRows] =
    await Promise.all([
      countRows(db, "payments", "star_orders", "user_id", userId),
      countPaymentStatuses(db, userId, ["paid", "fulfilled", "completed"]),
      countPaymentStatuses(db, userId, ["failed", "expired", "cancelled"]),
      countPaymentStatuses(db, userId, ["disputed", "refunded", "chargeback"]),
      loadStarOrders(db, userId, page),
    ]);
  const pageRows = recentRows.slice(0, page.limit);
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

  return {
    totalCount,
    total_count: totalCount,
    successCount,
    success_count: successCount,
    failedCount,
    failed_count: failedCount,
    disputedCount,
    disputed_count: disputedCount,
    statusCounts: countBy(pageRows, (row) => row.status),
    status_counts: countBy(pageRows, (row) => row.status),
    recent,
    items: recent,
    pageCount: recent.length,
    page_count: recent.length,
    nextCursor: buildNextCursor(recentRows.length, page.limit, page.offset),
    next_cursor: buildNextCursor(recentRows.length, page.limit, page.offset),
  };
}

async function loadMarketSummary(
  db: SupabaseAdminClient,
  userId: string,
  page: SectionPage,
): Promise<Record<string, unknown>> {
  const [buyerCount, sellerCount, marketRows] = await Promise.all([
    countRows(db, "market", "orders", "buyer_user_id", userId),
    countRows(db, "market", "orders", "seller_user_id", userId),
    loadMarketOrders(db, userId, page),
  ]);
  const pageRows = marketRows.slice(0, page.limit);
  const counterparties = summarizeCounterparties(userId, pageRows);
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
    nextCursor: buildNextCursor(marketRows.length, page.limit, page.offset),
    next_cursor: buildNextCursor(marketRows.length, page.limit, page.offset),
  };
}

async function loadReferralSummary(
  db: SupabaseAdminClient,
  userId: string,
  page: SectionPage,
): Promise<Record<string, unknown>> {
  const [
    invitedCount,
    invitedByCount,
    firstOpenCount,
    qualifiedCount,
    rewardedCount,
    referralRows,
  ] = await Promise.all([
    countRows(db, "tasks", "referrals", "inviter_user_id", userId),
    countRows(db, "tasks", "referrals", "invitee_user_id", userId),
    countReferralsWithValue(db, userId, "first_open_order_id"),
    countReferralsWithValue(db, userId, "qualified_at"),
    countReferralsWithValue(db, userId, "rewarded_at"),
    loadReferrals(db, userId, page),
  ]);
  const pageRows = referralRows.slice(0, page.limit);
  const inviterRows = pageRows.filter((row) => row.inviter_user_id === userId);
  const inviteeRows = pageRows.filter((row) => row.invitee_user_id === userId);
  const firstOpenConversionRate =
    invitedCount > 0 ? roundRate(firstOpenCount / invitedCount) : 0;
  const items = pageRows.map((row) => ({
    ...serializeReferral(row),
    role: row.inviter_user_id === userId ? "inviter" : "invitee",
  }));

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
    nextCursor: buildNextCursor(referralRows.length, page.limit, page.offset),
    next_cursor: buildNextCursor(referralRows.length, page.limit, page.offset),
  };
}

async function loadWalletSummary(
  db: SupabaseAdminClient,
  userId: string,
  page: SectionPage,
): Promise<Record<string, unknown>> {
  const totalCount = await countRows(
    db,
    "core",
    "user_wallets",
    "user_id",
    userId,
  );
  const { data, error } = await db
    .schema("core")
    .from("user_wallets")
    .select(WALLET_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(page.offset, page.offset + page.limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_USER_WALLETS_LOOKUP_FAILED",
      "用户钱包摘要查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const rows = Array.isArray(data) ? (data as unknown as WalletRow[]) : [];
  const wallets = rows.slice(0, page.limit);
  const reuseCounts = await loadWalletReuseCounts(db, userId, wallets);
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

  return {
    count: totalCount,
    totalCount,
    total_count: totalCount,
    pageCount: items.length,
    page_count: items.length,
    statusCounts: countBy(wallets, (wallet) => wallet.status),
    status_counts: countBy(wallets, (wallet) => wallet.status),
    addressReuseCount: items.reduce(
      (sum, item) => sum + Number(item.reuseUserCount ?? 0),
      0,
    ),
    address_reuse_count: items.reduce(
      (sum, item) => sum + Number(item.reuseUserCount ?? 0),
      0,
    ),
    items,
    nextCursor: buildNextCursor(rows.length, page.limit, page.offset),
    next_cursor: buildNextCursor(rows.length, page.limit, page.offset),
  };
}

async function loadRiskTimeline(
  db: SupabaseAdminClient,
  userId: string,
  page: SectionPage,
): Promise<Record<string, unknown>> {
  const totalCount = await countRows(
    db,
    "ops",
    "risk_events",
    "user_id",
    userId,
  );
  const { data, error } = await db
    .schema("ops")
    .from("risk_events")
    .select(RISK_EVENT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(page.offset, page.offset + page.limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_USER_TIMELINE_LOOKUP_FAILED",
      "用户风险时间线查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const rows = Array.isArray(data)
    ? (data as unknown as RiskEventRow[]).slice(0, page.limit)
    : [];
  const items = rows.map(serializeRiskEvent);

  return {
    items,
    recent: items,
    totalCount,
    total_count: totalCount,
    pageCount: items.length,
    page_count: items.length,
    nextCursor: buildNextCursor(
      Array.isArray(data) ? data.length : 0,
      page.limit,
      page.offset,
    ),
    next_cursor: buildNextCursor(
      Array.isArray(data) ? data.length : 0,
      page.limit,
      page.offset,
    ),
  };
}

async function loadStarOrders(
  db: SupabaseAdminClient,
  userId: string,
  page: SectionPage,
): Promise<StarOrderRow[]> {
  const { data, error } = await db
    .schema("payments")
    .from("star_orders")
    .select(STAR_ORDER_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(page.offset, page.offset + page.limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_USER_PAYMENTS_LOOKUP_FAILED",
      "用户支付摘要查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as StarOrderRow[]) : [];
}

async function loadMarketOrders(
  db: SupabaseAdminClient,
  userId: string,
  page: SectionPage,
): Promise<MarketOrderRow[]> {
  const { data, error } = await db
    .schema("market")
    .from("orders")
    .select(MARKET_ORDER_COLUMNS)
    .or(`buyer_user_id.eq.${userId},seller_user_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .range(page.offset, page.offset + page.limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_USER_MARKET_LOOKUP_FAILED",
      "用户市场摘要查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as MarketOrderRow[]) : [];
}

async function loadReferrals(
  db: SupabaseAdminClient,
  userId: string,
  page: SectionPage,
): Promise<ReferralRow[]> {
  const { data, error } = await db
    .schema("tasks")
    .from("referrals")
    .select(REFERRAL_COLUMNS)
    .or(`inviter_user_id.eq.${userId},invitee_user_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .range(page.offset, page.offset + page.limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_USER_REFERRALS_LOOKUP_FAILED",
      "用户邀请摘要查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as ReferralRow[]) : [];
}

async function loadWalletReuseCounts(
  db: SupabaseAdminClient,
  userId: string,
  wallets: WalletRow[],
): Promise<Map<string, number>> {
  const addresses = [...new Set(wallets.map((wallet) => wallet.address))];

  if (addresses.length === 0) {
    return new Map();
  }

  const { data, error } = await db
    .schema("core")
    .from("user_wallets")
    .select("user_id,address")
    .in("address", addresses)
    .neq("user_id", userId)
    .limit(500);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_WALLET_REUSE_LOOKUP_FAILED",
      "钱包复用摘要查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const reuseRows = Array.isArray(data)
    ? (data as unknown as WalletReuseRow[])
    : [];
  const usersByAddress = new Map<string, Set<string>>();

  for (const row of reuseRows) {
    const users = usersByAddress.get(row.address) ?? new Set<string>();
    users.add(row.user_id);
    usersByAddress.set(row.address, users);
  }

  return new Map(
    Array.from(usersByAddress.entries()).map(([address, users]) => [
      address,
      users.size,
    ]),
  );
}

async function countPaymentStatuses(
  db: SupabaseAdminClient,
  userId: string,
  statuses: string[],
): Promise<number> {
  const { count, error } = await db
    .schema("payments")
    .from("star_orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", statuses);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_PAYMENT_STATUS_COUNT_FAILED",
      "用户支付状态数量查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return count ?? 0;
}

async function countReferralsWithValue(
  db: SupabaseAdminClient,
  userId: string,
  column: "first_open_order_id" | "qualified_at" | "rewarded_at",
): Promise<number> {
  const { count, error } = await db
    .schema("tasks")
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("inviter_user_id", userId)
    .not(column, "is", null);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_REFERRAL_COUNT_FAILED",
      "用户邀请转化数量查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return count ?? 0;
}

async function countRows(
  db: SupabaseAdminClient,
  schema: "core" | "market" | "ops" | "payments" | "tasks",
  table:
    | "orders"
    | "referrals"
    | "risk_events"
    | "star_orders"
    | "user_flags"
    | "user_wallets",
  column: string,
  userId: string,
): Promise<number> {
  const { count, error } = await db
    .schema(schema)
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, userId);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_RISK_USER_COUNT_LOOKUP_FAILED",
      "用户画像数量查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return count ?? 0;
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
    const current =
      byUserId.get(counterpartyUserId) ??
      {
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
