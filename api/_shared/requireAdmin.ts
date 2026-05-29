// api/shared/requireAdmin.ts

import type { VercelRequest } from "@vercel/node";
import { ApiError } from "./handler.js";
import {
  getSupabaseAdmin,
  requireSession,
  type RequireSessionOptions,
  type SessionContext,
} from "./requireSession.js";

export type AdminPermission = string;

export interface RequireAdminOptions {
  /**
   * 当前接口需要的权限。
   *
   * 示例：
   * - boxes:read
   * - boxes:write
   * - market:write
   * - payments:read
   * - users:ban
   * - admin:*
   */
  permissions?: AdminPermission | AdminPermission[];

  /**
   * true：必须拥有全部 permissions。
   * false：拥有任意一个即可。
   *
   * 默认 true。
   */
  requireAll?: boolean;

  /**
   * 是否允许 super admin 直接通过权限校验。
   *
   * 默认 true。
   */
  allowSuperAdmin?: boolean;

  /**
   * session 校验选项。
   */
  session?: RequireSessionOptions;
}

export interface AdminContext extends SessionContext {
  adminId: string;
  roleId: string | null;
  roleCode: string | null;
  isSuperAdmin: boolean;
  permissions: string[];
}

interface AdminUserRow {
  id: string;
  core_user_id: string | null;
  telegram_user_id: number | string | null;
  status: string;
  metadata: unknown;
  last_login_at?: string | null;
}

interface AdminRoleRow {
  id: string;
  code: string;
  display_name?: string | null;
  permissions: unknown;
}

/**
 * 校验后台管理员权限。
 *
 * 使用方式：
 *
 * const admin = await requireAdmin(req, {
 *   permissions: ['boxes:write'],
 * });
 *
 * 规则：
 * - 先校验普通 app session。
 * - 再根据 session.userId 查询 ops.admin_users。
 * - 再查询 ops.admin_roles。
 * - 最后校验 permissions。
 */
export async function requireAdmin(
  req: VercelRequest,
  options: RequireAdminOptions = {},
): Promise<AdminContext> {
  const session = await requireSession(req, {
    requireActiveUser: true,
    touchLastSeen: options.session?.touchLastSeen ?? true,
    ...options.session,
  });

  const db = getSupabaseAdmin();

  const adminUser = await loadAdminUser(session);

  if (!adminUser) {
    throw ApiError.forbidden("Admin permission required");
  }

  if (adminUser.status !== "active") {
    throw ApiError.forbidden("Admin account is not active", {
      status: adminUser.status,
    });
  }

  const roles = await loadAdminRoles(adminUser.id);
  const rolePermissions = roles.flatMap((role) =>
    normalizePermissions(role.permissions),
  );
  const userExtraPermissions = normalizePermissionsFromMetadata(
    adminUser.metadata,
  );
  const mergedPermissions = uniquePermissions([
    ...rolePermissions,
    ...userExtraPermissions,
  ]);

  const isSuperAdmin =
    roles.some((role) => normalizeRoleCode(role.code) === "SUPER_ADMIN") ||
    mergedPermissions.includes("*");
  const primaryRole = roles[0] ?? null;

  const adminContext: AdminContext = {
    ...session,
    adminId: adminUser.id,
    roleId: primaryRole?.id ?? null,
    roleCode: primaryRole?.code ?? null,
    isSuperAdmin,
    permissions: mergedPermissions,
  };

  assertAdminPermissions(adminContext, options);

  await touchAdminLastLogin(adminUser.id);

  return adminContext;
}

export function assertAdminPermissions(
  admin: AdminContext,
  options: RequireAdminOptions = {},
): void {
  const requiredPermissions = normalizeRequiredPermissions(options.permissions);

  if (requiredPermissions.length === 0) {
    return;
  }

  if ((options.allowSuperAdmin ?? true) && admin.isSuperAdmin) {
    return;
  }

  const requireAll = options.requireAll ?? true;

  const permissionResults = requiredPermissions.map((permission) =>
    hasAdminPermission(admin.permissions, permission),
  );

  const passed = requireAll
    ? permissionResults.every(Boolean)
    : permissionResults.some(Boolean);

  if (!passed) {
    throw ApiError.forbidden("Missing admin permission", {
      requiredPermissions,
      ownedPermissions: admin.permissions,
      requireAll,
    });
  }
}

export function hasAdminPermission(
  ownedPermissions: string[],
  requiredPermission: string,
): boolean {
  for (const ownedPermission of ownedPermissions) {
    if (permissionMatches(ownedPermission, requiredPermission)) {
      return true;
    }
  }

  return false;
}

export function permissionMatches(
  ownedPermission: string,
  requiredPermission: string,
): boolean {
  if (ownedPermission === "*") {
    return true;
  }

  if (ownedPermission === requiredPermission) {
    return true;
  }

  /**
   * 支持命名空间通配：
   *
   * ownedPermission = "boxes:*"
   * requiredPermission = "boxes:write"
   */
  if (ownedPermission.endsWith(":*")) {
    const namespace = ownedPermission.slice(0, -1);
    return requiredPermission.startsWith(namespace);
  }

  return false;
}

async function loadAdminUser(
  session: SessionContext,
): Promise<AdminUserRow | null> {
  const db = getSupabaseAdmin();

  const { data: byCoreUserId, error: byCoreUserIdError } = await db
    .schema("ops")
    .from("admin_users")
    .select("id,core_user_id,telegram_user_id,status,metadata,last_login_at")
    .eq("core_user_id", session.userId)
    .maybeSingle<AdminUserRow>();

  if (byCoreUserIdError) {
    throw new ApiError(
      500,
      "ADMIN_LOOKUP_FAILED",
      "Failed to lookup admin user",
      {
        details: byCoreUserIdError,
        expose: false,
      },
    );
  }

  if (byCoreUserId) {
    return byCoreUserId;
  }

  if (session.telegramUserId === null) {
    return null;
  }

  const { data: byTelegramUserId, error: byTelegramUserIdError } = await db
    .schema("ops")
    .from("admin_users")
    .select("id,core_user_id,telegram_user_id,status,metadata,last_login_at")
    .eq("telegram_user_id", session.telegramUserId)
    .maybeSingle<AdminUserRow>();

  if (byTelegramUserIdError) {
    throw new ApiError(
      500,
      "ADMIN_LOOKUP_FAILED",
      "Failed to lookup admin user",
      {
        details: byTelegramUserIdError,
        expose: false,
      },
    );
  }

  return byTelegramUserId ?? null;
}

async function loadAdminRoles(adminId: string): Promise<AdminRoleRow[]> {
  const db = getSupabaseAdmin();

  const { data: roleLinks, error: roleLinksError } = await db
    .schema("ops")
    .from("admin_user_roles")
    .select("role_id")
    .eq("admin_user_id", adminId);

  if (roleLinksError) {
    throw new ApiError(
      500,
      "ADMIN_ROLE_LOOKUP_FAILED",
      "Failed to lookup admin role links",
      {
        details: roleLinksError,
        expose: false,
      },
    );
  }

  const roleIds = uniquePermissions(
    (Array.isArray(roleLinks) ? roleLinks : [])
      .map((link) =>
        isRecord(link) && typeof link.role_id === "string" ? link.role_id : "",
      )
      .filter(Boolean),
  );

  if (roleIds.length === 0) {
    return [];
  }

  const { data: roles, error: rolesError } = await db
    .schema("ops")
    .from("admin_roles")
    .select("id,code,display_name,permissions")
    .in("id", roleIds);

  if (rolesError) {
    throw new ApiError(
      500,
      "ADMIN_ROLE_LOOKUP_FAILED",
      "Failed to lookup admin roles",
      {
        details: rolesError,
        expose: false,
      },
    );
  }

  return Array.isArray(roles)
    ? (roles as unknown as AdminRoleRow[]).sort((left, right) =>
        normalizeRoleCode(left.code).localeCompare(
          normalizeRoleCode(right.code),
        ),
      )
    : [];
}

async function touchAdminLastLogin(adminId: string): Promise<void> {
  const db = getSupabaseAdmin();

  const { error } = await db
    .schema("ops")
    .from("admin_users")
    .update({
      last_login_at: new Date().toISOString(),
    })
    .eq("id", adminId);

  if (error) {
    console.warn("Failed to touch admin last_login_at", {
      adminId,
      error,
    });
  }
}

function normalizeRequiredPermissions(
  permissions: AdminPermission | AdminPermission[] | undefined,
): string[] {
  if (!permissions) {
    return [];
  }

  if (Array.isArray(permissions)) {
    return permissions.map(normalizePermission).filter(Boolean);
  }

  const normalized = normalizePermission(permissions);

  return normalized ? [normalized] : [];
}

function normalizePermissions(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizePermission(String(item)))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    /**
     * 同时兼容：
     * - Postgres text[]
     * - JSON string
     * - 逗号分隔字符串
     */
    const trimmed = value.trim();

    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);

      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => normalizePermission(String(item)))
          .filter(Boolean);
      }
    } catch {
      // ignore
    }

    return trimmed
      .split(",")
      .map((item) => normalizePermission(item))
      .filter(Boolean);
  }

  return [];
}

function normalizePermissionsFromMetadata(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  return normalizePermissions(value.permissions);
}

function normalizePermission(permission: string): string {
  return permission.trim().toLowerCase();
}

function normalizeRoleCode(code: string): string {
  return code.trim().toUpperCase();
}

function uniquePermissions(permissions: string[]): string[] {
  return Array.from(new Set(permissions.filter(Boolean))).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
