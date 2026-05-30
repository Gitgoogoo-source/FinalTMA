import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import {
  buildNextCursor,
  firstQueryValue,
  normalizeStatus,
  normalizeUuid,
  parseAdminLimit,
  parseOffsetCursor,
} from "./_shared.js";

type AdminUserRow = {
  id: string;
  core_user_id: string | null;
  telegram_user_id: number | string | null;
  display_name: string | null;
  status: string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string | null;
};

type AdminRoleSummaryRow = {
  id: string;
  code: string;
  display_name: string | null;
};

type AdminUserRoleLinkRow = {
  admin_user_id: string;
  role_id: string;
};

type AdminUserResponseItem = AdminUserRow & {
  roles: AdminRoleSummaryRow[];
};

const ADMIN_USER_COLUMNS = [
  "id",
  "core_user_id",
  "telegram_user_id",
  "display_name",
  "status",
  "last_login_at",
  "created_at",
  "updated_at",
].join(",");

const ADMIN_ROLE_SUMMARY_COLUMNS = ["id", "code", "display_name"].join(",");

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["admin:read", "roles:read"],
      requireAll: false,
    });

    const db = getSupabaseAdminClient();
    const limit = parseAdminLimit(req.query.limit);
    const offset = parseOffsetCursor(req.query.cursor);
    const rows = await listAdminUsers(db, req.query, offset, limit);
    const pageRows = rows.slice(0, limit);
    const rolesByAdminId = await loadRolesByAdminId(
      db,
      pageRows.map((row) => row.id),
    );

    return {
      items: pageRows.map((row): AdminUserResponseItem => {
        return {
          ...row,
          roles: rolesByAdminId.get(row.id) ?? [],
        };
      }),
      summary: await summarizeAdminUsers(db),
      nextCursor: buildNextCursor(rows.length, limit, offset),
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

async function listAdminUsers(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
  offset: number,
  limit: number,
): Promise<AdminUserRow[]> {
  const status = normalizeStatus(queryInput.status);
  const q = firstQueryValue(queryInput.q);

  if (q) {
    return searchAdminUsers(db, q, status).then((rows) =>
      rows.slice(offset, offset + limit + 1),
    );
  }

  const { data, error } = await baseAdminUserQuery(db, status)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USERS_LOOKUP_FAILED",
      "管理员用户查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as AdminUserRow[]) : [];
}

async function searchAdminUsers(
  db: SupabaseAdminClient,
  q: string,
  status: string | undefined,
): Promise<AdminUserRow[]> {
  const normalizedUuid = normalizeUuid(q);
  const telegramUserId = normalizeTelegramUserId(q);
  const searches: Promise<AdminUserRow[]>[] = [
    queryAdminUsersWithIlike(db, status, "display_name", `%${q}%`),
  ];

  if (q.includes("@")) {
    searches.push(queryAdminUsersWithIlike(db, status, "email", `%${q}%`));
  }

  if (normalizedUuid) {
    searches.push(queryAdminUsersWithEq(db, status, "id", normalizedUuid));
    searches.push(
      queryAdminUsersWithEq(db, status, "core_user_id", normalizedUuid),
    );
  }

  if (telegramUserId) {
    searches.push(
      queryAdminUsersWithEq(db, status, "telegram_user_id", telegramUserId),
    );
  }

  const rows = (await Promise.all(searches)).flat();

  return uniqueAdminUsers(rows).sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
}

function baseAdminUserQuery(
  db: SupabaseAdminClient,
  status: string | undefined,
) {
  let query = db.schema("ops").from("admin_users").select(ADMIN_USER_COLUMNS);

  if (status) {
    query = query.eq("status", status);
  }

  return query;
}

async function queryAdminUsersWithEq(
  db: SupabaseAdminClient,
  status: string | undefined,
  column: "id" | "core_user_id" | "telegram_user_id",
  value: string,
): Promise<AdminUserRow[]> {
  const { data, error } = await baseAdminUserQuery(db, status)
    .eq(column, value)
    .limit(101);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USERS_LOOKUP_FAILED",
      "管理员用户查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as AdminUserRow[]) : [];
}

async function queryAdminUsersWithIlike(
  db: SupabaseAdminClient,
  status: string | undefined,
  column: "display_name" | "email",
  pattern: string,
): Promise<AdminUserRow[]> {
  const { data, error } = await baseAdminUserQuery(db, status)
    .ilike(column, pattern)
    .limit(101);

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USERS_LOOKUP_FAILED",
      "管理员用户查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  return Array.isArray(data) ? (data as unknown as AdminUserRow[]) : [];
}

function normalizeTelegramUserId(value: string): string | null {
  const normalized = value.trim();

  if (!/^[1-9][0-9]*$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function uniqueAdminUsers(rows: AdminUserRow[]): AdminUserRow[] {
  const byId = new Map<string, AdminUserRow>();

  for (const row of rows) {
    byId.set(row.id, row);
  }

  return [...byId.values()];
}

async function loadRolesByAdminId(
  db: SupabaseAdminClient,
  adminUserIds: string[],
): Promise<Map<string, AdminRoleSummaryRow[]>> {
  const rolesByAdminId = new Map<string, AdminRoleSummaryRow[]>();

  if (adminUserIds.length === 0) {
    return rolesByAdminId;
  }

  const { data: linksData, error: linksError } = await db
    .schema("ops")
    .from("admin_user_roles")
    .select("admin_user_id,role_id")
    .in("admin_user_id", adminUserIds);

  if (linksError) {
    throw new ApiError(
      500,
      "ADMIN_USER_ROLES_LOOKUP_FAILED",
      "管理员角色绑定查询失败。",
      {
        expose: false,
        cause: linksError,
      },
    );
  }

  const links = Array.isArray(linksData)
    ? (linksData as unknown as AdminUserRoleLinkRow[])
    : [];
  const roleIds = [...new Set(links.map((link) => link.role_id))];

  if (roleIds.length === 0) {
    return rolesByAdminId;
  }

  const { data: rolesData, error: rolesError } = await db
    .schema("ops")
    .from("admin_roles")
    .select(ADMIN_ROLE_SUMMARY_COLUMNS)
    .in("id", roleIds);

  if (rolesError) {
    throw new ApiError(
      500,
      "ADMIN_ROLES_LOOKUP_FAILED",
      "管理员角色查询失败。",
      {
        expose: false,
        cause: rolesError,
      },
    );
  }

  const rolesById = new Map(
    (Array.isArray(rolesData)
      ? (rolesData as unknown as AdminRoleSummaryRow[])
      : []
    ).map((role) => [role.id, role]),
  );

  for (const link of links) {
    const role = rolesById.get(link.role_id);

    if (!role) {
      continue;
    }

    const existingRoles = rolesByAdminId.get(link.admin_user_id) ?? [];
    existingRoles.push(role);
    rolesByAdminId.set(link.admin_user_id, existingRoles);
  }

  for (const roles of rolesByAdminId.values()) {
    roles.sort((left, right) => left.code.localeCompare(right.code));
  }

  return rolesByAdminId;
}

async function summarizeAdminUsers(
  db: SupabaseAdminClient,
): Promise<Record<string, number>> {
  const { data, error } = await db
    .schema("ops")
    .from("admin_users")
    .select("status");

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_USERS_SUMMARY_FAILED",
      "管理员用户汇总失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const summary: Record<string, number> = {};
  const rows = Array.isArray(data)
    ? (data as unknown as Array<{ status: string | null }>)
    : [];

  for (const row of rows) {
    const status = row.status ?? "unknown";
    summary[status] = (summary[status] ?? 0) + 1;
  }

  return summary;
}
