import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  firstQueryValue,
  normalizeStatus,
  parseAdminLimit,
  parseOffsetCursor,
} from "./_shared.js";
import {
  getAdminDb,
  loadProfilesByUserId,
  nextCursorFor,
  rows,
  serializeUserProfile,
  USER_COLUMNS,
  type UserRow,
} from "./users/_shared.js";
import type { SupabaseAdminClient } from "../../packages/server/src/db/supabaseAdmin.js";

type SearchUserTextColumn = "username" | "first_name" | "last_name";

type UserListSummary = {
  walletAddress: string | null;
  latestWalletAddress: string | null;
  latestPaymentOrderId: string | null;
  balanceSummary: Record<string, string | number | null>;
};

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["users:read", "admin:read"],
      requireAll: false,
    });

    const db = getAdminDb();
    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const status = normalizeStatus(req.query.status);
    const query = firstQueryValue(req.query.q ?? req.query.query);
    const rowsResult = query
      ? await searchUsers(query, status)
      : await listUsers(status, offset, limit);
    const page = query
      ? nextCursorFor(
          rowsResult.slice(offset, offset + limit + 1),
          limit,
          offset,
        )
      : nextCursorFor(rowsResult, limit, offset);
    const pageUserIds = page.pageRows.map((row) => row.id);
    const [profilesByUserId, summariesByUserId] = await Promise.all([
      loadProfilesByUserId(db, pageUserIds),
      loadUserListSummaries(db, pageUserIds),
    ]);

    return {
      items: page.pageRows.map((row) => ({
        ...serializeUserProfile(row, profilesByUserId.get(row.id) ?? null),
        ...(summariesByUserId.get(row.id) ?? {}),
      })),
      summary: await summarizeUsers(status),
      nextCursor: page.nextCursor,
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

async function listUsers(
  status: string | undefined,
  offset: number,
  limit: number,
): Promise<UserRow[]> {
  const db = getAdminDb();
  let query = db.schema("core").from("users").select(USER_COLUMNS);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(500, "ADMIN_USERS_LOOKUP_FAILED", "用户查询失败。", {
      expose: false,
      cause: error,
    });
  }

  return rows<UserRow>(data);
}

async function searchUsers(
  rawQuery: string,
  status: string | undefined,
): Promise<UserRow[]> {
  const q = rawQuery.trim();
  const userIds = new Set<string>();
  const directRows: UserRow[] = [];
  const uuid = normalizeUuidLike(q);
  const telegramUserId = normalizeTelegramUserId(q);

  if (uuid) {
    userIds.add(uuid);
    for (const id of await findUserIdsByOrderId(uuid)) {
      userIds.add(id);
    }
  }

  if (telegramUserId) {
    directRows.push(...(await searchUserByTelegramId(telegramUserId, status)));
  }

  const textPattern = `%${escapeIlike(q)}%`;
  for (const column of ["username", "first_name", "last_name"] as const) {
    directRows.push(
      ...(await searchUsersByTextColumn(column, textPattern, status)),
    );
  }

  for (const id of await findUserIdsByProfile(q)) {
    userIds.add(id);
  }

  for (const id of await findUserIdsByWallet(q)) {
    userIds.add(id);
  }

  if (userIds.size > 0) {
    directRows.push(...(await loadUsersByIds([...userIds], status)));
  }

  return uniqueUsers(directRows).sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
}

async function searchUsersByTextColumn(
  column: SearchUserTextColumn,
  pattern: string,
  status: string | undefined,
): Promise<UserRow[]> {
  const db = getAdminDb();
  let query = db.schema("core").from("users").select(USER_COLUMNS);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query.ilike(column, pattern).limit(101);

  if (error) {
    throw new ApiError(500, "ADMIN_USERS_SEARCH_FAILED", "用户搜索失败。", {
      expose: false,
      cause: error,
    });
  }

  return rows<UserRow>(data);
}

async function searchUserByTelegramId(
  telegramUserId: string,
  status: string | undefined,
): Promise<UserRow[]> {
  const db = getAdminDb();
  let query = db
    .schema("core")
    .from("users")
    .select(USER_COLUMNS)
    .eq("telegram_user_id", telegramUserId);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query.limit(101);

  if (error) {
    throw new ApiError(500, "ADMIN_USERS_SEARCH_FAILED", "用户搜索失败。", {
      expose: false,
      cause: error,
    });
  }

  return rows<UserRow>(data);
}

async function loadUsersByIds(
  userIds: string[],
  status: string | undefined,
): Promise<UserRow[]> {
  if (userIds.length === 0) {
    return [];
  }

  const db = getAdminDb();
  let query = db
    .schema("core")
    .from("users")
    .select(USER_COLUMNS)
    .in("id", userIds);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query.limit(101);

  if (error) {
    throw new ApiError(500, "ADMIN_USERS_SEARCH_FAILED", "用户搜索失败。", {
      expose: false,
      cause: error,
    });
  }

  return rows<UserRow>(data);
}

async function findUserIdsByProfile(q: string): Promise<string[]> {
  const db = getAdminDb();
  const { data, error } = await db
    .schema("core")
    .from("user_profiles")
    .select("user_id")
    .ilike("display_name", `%${escapeIlike(q)}%`)
    .limit(101);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USER_PROFILE_SEARCH_FAILED",
      "用户资料搜索失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return rows<{ user_id: string }>(data).map((row) => row.user_id);
}

async function findUserIdsByWallet(q: string): Promise<string[]> {
  const db = getAdminDb();
  const pattern = `%${escapeIlike(q)}%`;
  const [byAddress, byRawAddress] = await Promise.all([
    db
      .schema("core")
      .from("user_wallets")
      .select("user_id")
      .ilike("address", pattern)
      .limit(101),
    db
      .schema("core")
      .from("user_wallets")
      .select("user_id")
      .ilike("address_raw", pattern)
      .limit(101),
  ]);

  if (byAddress.error || byRawAddress.error) {
    throw new ApiError(
      500,
      "ADMIN_USER_WALLET_SEARCH_FAILED",
      "钱包搜索失败。",
      {
        expose: false,
        cause: byAddress.error ?? byRawAddress.error,
      },
    );
  }

  return [
    ...rows<{ user_id: string }>(byAddress.data),
    ...rows<{ user_id: string }>(byRawAddress.data),
  ].map((row) => row.user_id);
}

async function findUserIdsByOrderId(orderId: string): Promise<string[]> {
  const db = getAdminDb();
  const [starOrders, drawOrders] = await Promise.all([
    db
      .schema("payments")
      .from("star_orders")
      .select("user_id")
      .or(`id.eq.${orderId},business_id.eq.${orderId}`)
      .limit(101),
    db
      .schema("gacha")
      .from("draw_orders")
      .select("user_id")
      .or(`id.eq.${orderId},payment_star_order_id.eq.${orderId}`)
      .limit(101),
  ]);

  if (starOrders.error || drawOrders.error) {
    throw new ApiError(
      500,
      "ADMIN_USER_ORDER_SEARCH_FAILED",
      "订单搜索失败。",
      {
        expose: false,
        cause: starOrders.error ?? drawOrders.error,
      },
    );
  }

  return [
    ...rows<{ user_id: string }>(starOrders.data),
    ...rows<{ user_id: string }>(drawOrders.data),
  ].map((row) => row.user_id);
}

async function summarizeUsers(
  status: string | undefined,
): Promise<Record<string, number>> {
  const db = getAdminDb();
  let query = db
    .schema("core")
    .from("users")
    .select("id", { count: "exact", head: true });

  if (status) {
    query = query.eq("status", status);
  }

  const { count, error } = await query;

  if (error) {
    return {};
  }

  return {
    totalCount: count ?? 0,
    total_count: count ?? 0,
  };
}

function uniqueUsers(input: UserRow[]): UserRow[] {
  const byId = new Map<string, UserRow>();

  for (const row of input) {
    byId.set(row.id, row);
  }

  return [...byId.values()];
}

async function loadUserListSummaries(
  db: SupabaseAdminClient,
  userIds: string[],
): Promise<Map<string, UserListSummary>> {
  const summaries = new Map<string, UserListSummary>();

  for (const userId of userIds) {
    summaries.set(userId, {
      walletAddress: null,
      latestWalletAddress: null,
      latestPaymentOrderId: null,
      balanceSummary: {},
    });
  }

  if (userIds.length === 0) {
    return summaries;
  }

  const [wallets, payments, balances] = await Promise.all([
    db
      .schema("core")
      .from("user_wallets")
      .select("user_id,address,updated_at,created_at")
      .in("user_id", userIds)
      .order("updated_at", { ascending: false })
      .limit(userIds.length * 3),
    db
      .schema("payments")
      .from("star_orders")
      .select("id,user_id,created_at")
      .in("user_id", userIds)
      .order("created_at", { ascending: false })
      .limit(userIds.length * 3),
    db
      .schema("economy")
      .from("user_balances")
      .select("user_id,currency_code,available_amount")
      .in("user_id", userIds)
      .limit(userIds.length * 4),
  ]);

  if (wallets.error || payments.error || balances.error) {
    throw new ApiError(
      500,
      "ADMIN_USER_SUMMARY_LOOKUP_FAILED",
      "用户摘要查询失败。",
      {
        expose: false,
        cause: wallets.error ?? payments.error ?? balances.error,
      },
    );
  }

  for (const row of rows<{
    user_id: string;
    address: string | null;
  }>(wallets.data)) {
    const summary = summaries.get(row.user_id);

    if (summary && !summary.latestWalletAddress) {
      summary.latestWalletAddress = redactAddress(row.address);
      summary.walletAddress = summary.latestWalletAddress;
    }
  }

  for (const row of rows<{ user_id: string; id: string }>(payments.data)) {
    const summary = summaries.get(row.user_id);

    if (summary && !summary.latestPaymentOrderId) {
      summary.latestPaymentOrderId = row.id;
    }
  }

  for (const row of rows<{
    user_id: string;
    currency_code: string;
    available_amount: string | number | null;
  }>(balances.data)) {
    const summary = summaries.get(row.user_id);

    if (summary) {
      summary.balanceSummary[row.currency_code] = row.available_amount;
    }
  }

  return summaries;
}

function redactAddress(address: string | null): string | null {
  if (!address) {
    return null;
  }

  if (address.length <= 16) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function normalizeUuidLike(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : null;
}

function normalizeTelegramUserId(value: string): string | null {
  return /^\d{5,20}$/.test(value) ? value : null;
}

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
