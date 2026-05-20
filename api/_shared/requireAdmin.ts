// api/shared/requireAdmin.ts

import type { VercelRequest } from '@vercel/node';
import { ApiError } from './handler';
import {
  getSupabaseAdmin,
  requireSession,
  type RequireSessionOptions,
  type SessionContext,
} from './requireSession';

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
  user_id: string;
  role_id: string | null;
  status: string;
  permissions: unknown;
  revoked_at: string | null;
  last_seen_at?: string | null;
}

interface AdminRoleRow {
  id: string;
  code: string;
  name?: string | null;
  status: string;
  permissions: unknown;
  is_super_admin: boolean | null;
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

  const { data: adminUser, error: adminUserError } = await db
    .schema('ops')
    .from('admin_users')
    .select('id,user_id,role_id,status,permissions,revoked_at,last_seen_at')
    .eq('user_id', session.userId)
    .maybeSingle<AdminUserRow>();

  if (adminUserError) {
    throw new ApiError(500, 'ADMIN_LOOKUP_FAILED', 'Failed to lookup admin user', {
      details: adminUserError,
      expose: false,
    });
  }

  if (!adminUser) {
    throw ApiError.forbidden('Admin permission required');
  }

  if (adminUser.revoked_at) {
    throw ApiError.forbidden('Admin access has been revoked');
  }

  if (adminUser.status !== 'active') {
    throw ApiError.forbidden('Admin account is not active', {
      status: adminUser.status,
    });
  }

  const role = adminUser.role_id
    ? await loadAdminRole(adminUser.role_id)
    : null;

  if (role && role.status !== 'active') {
    throw ApiError.forbidden('Admin role is not active', {
      roleStatus: role.status,
    });
  }

  const rolePermissions = normalizePermissions(role?.permissions);
  const userExtraPermissions = normalizePermissions(adminUser.permissions);
  const mergedPermissions = uniquePermissions([...rolePermissions, ...userExtraPermissions]);

  const isSuperAdmin = Boolean(role?.is_super_admin) || mergedPermissions.includes('*');

  const adminContext: AdminContext = {
    ...session,
    adminId: adminUser.id,
    roleId: adminUser.role_id,
    roleCode: role?.code ?? null,
    isSuperAdmin,
    permissions: mergedPermissions,
  };

  assertAdminPermissions(adminContext, options);

  await touchAdminLastSeen(adminUser.id);

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
    throw ApiError.forbidden('Missing admin permission', {
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
  if (ownedPermission === '*') {
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
  if (ownedPermission.endsWith(':*')) {
    const namespace = ownedPermission.slice(0, -1);
    return requiredPermission.startsWith(namespace);
  }

  return false;
}

async function loadAdminRole(roleId: string): Promise<AdminRoleRow | null> {
  const db = getSupabaseAdmin();

  const { data: role, error } = await db
    .schema('ops')
    .from('admin_roles')
    .select('id,code,name,status,permissions,is_super_admin')
    .eq('id', roleId)
    .maybeSingle<AdminRoleRow>();

  if (error) {
    throw new ApiError(500, 'ADMIN_ROLE_LOOKUP_FAILED', 'Failed to lookup admin role', {
      details: error,
      expose: false,
    });
  }

  return role;
}

async function touchAdminLastSeen(adminId: string): Promise<void> {
  const db = getSupabaseAdmin();

  const { error } = await db
    .schema('ops')
    .from('admin_users')
    .update({
      last_seen_at: new Date().toISOString(),
    })
    .eq('id', adminId);

  if (error) {
    console.warn('Failed to touch admin last_seen_at', {
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
    return value.map((item) => normalizePermission(String(item))).filter(Boolean);
  }

  if (typeof value === 'string') {
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
        return parsed.map((item) => normalizePermission(String(item))).filter(Boolean);
      }
    } catch {
      // ignore
    }

    return trimmed
      .split(',')
      .map((item) => normalizePermission(item))
      .filter(Boolean);
  }

  return [];
}

function normalizePermission(permission: string): string {
  return permission.trim().toLowerCase();
}

function uniquePermissions(permissions: string[]): string[] {
  return Array.from(new Set(permissions.filter(Boolean))).sort();
}   