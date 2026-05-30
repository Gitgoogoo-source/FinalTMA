import {
  getSupabaseAdminClient,
  type SupabaseAdminClient,
} from "../../packages/server/src/db/supabaseAdmin.js";
import { ApiError, withApiHandler } from "../_shared/handler.js";
import { requireAdmin } from "../_shared/requireAdmin.js";
import { firstQueryValue } from "./_shared.js";

type AdminRoleRow = {
  id: string;
  code: string;
  display_name: string | null;
  permissions: unknown;
  created_at: string;
  updated_at: string | null;
};

type AdminUserRoleLinkRow = {
  role_id: string;
};

type AdminRoleResponseItem = Omit<AdminRoleRow, "permissions"> & {
  permissions: string[];
  admin_user_count: number;
};

const ADMIN_ROLE_COLUMNS = [
  "id",
  "code",
  "display_name",
  "permissions",
  "created_at",
  "updated_at",
].join(",");

export default withApiHandler(
  async (req) => {
    await requireAdmin(req, {
      permissions: ["admin:read", "roles:read"],
      requireAll: false,
    });

    const db = getSupabaseAdminClient();
    const roles = await listAdminRoles(db, req.query);
    const countsByRoleId = await countAdminUsersByRoleId(db);

    return {
      items: roles.map(
        (role): AdminRoleResponseItem => ({
          ...role,
          permissions: normalizePermissions(role.permissions),
          admin_user_count: countsByRoleId.get(role.id) ?? 0,
        }),
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

async function listAdminRoles(
  db: SupabaseAdminClient,
  queryInput: Record<string, unknown>,
): Promise<AdminRoleRow[]> {
  const q = firstQueryValue(queryInput.q)?.toLowerCase();
  const { data, error } = await db
    .schema("ops")
    .from("admin_roles")
    .select(ADMIN_ROLE_COLUMNS)
    .order("code", { ascending: true });

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_ROLES_LOOKUP_FAILED",
      "管理员角色查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const rows = Array.isArray(data) ? (data as unknown as AdminRoleRow[]) : [];

  if (!q) {
    return rows;
  }

  return rows.filter((role) => {
    const permissions = normalizePermissions(role.permissions);

    return (
      role.code.toLowerCase().includes(q) ||
      (role.display_name ?? "").toLowerCase().includes(q) ||
      permissions.some((permission) => permission.toLowerCase().includes(q))
    );
  });
}

async function countAdminUsersByRoleId(
  db: SupabaseAdminClient,
): Promise<Map<string, number>> {
  const { data, error } = await db
    .schema("ops")
    .from("admin_user_roles")
    .select("role_id");

  if (error) {
    throw new ApiError(
      500,
      "ADMIN_ROLE_COUNTS_FAILED",
      "管理员角色绑定数查询失败。",
      {
        expose: false,
        cause: error,
      },
    );
  }

  const countsByRoleId = new Map<string, number>();
  const rows = Array.isArray(data)
    ? (data as unknown as AdminUserRoleLinkRow[])
    : [];

  for (const row of rows) {
    countsByRoleId.set(row.role_id, (countsByRoleId.get(row.role_id) ?? 0) + 1);
  }

  return countsByRoleId;
}

function normalizePermissions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);

      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      return trimmed
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [];
}
