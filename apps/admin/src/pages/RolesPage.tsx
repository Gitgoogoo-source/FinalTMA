import { RefreshCw, ShieldPlus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AdminApiError, fetchAdminRoles } from "../admin.api";
import type { AdminRole, AdminRolesResponse } from "../admin.types";
import { formatDate, shortId } from "../admin.ui";

export function RolesPage() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<AdminRolesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filteredRoles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const roles = data?.items ?? [];

    if (!normalizedQuery) {
      return roles;
    }

    return roles.filter((role) => {
      return (
        role.code.toLowerCase().includes(normalizedQuery) ||
        (role.display_name ?? "").toLowerCase().includes(normalizedQuery) ||
        role.permissions.some((permission) =>
          permission.toLowerCase().includes(normalizedQuery),
        )
      );
    });
  }, [data, query]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      setData(await fetchAdminRoles({ q: query || undefined }));
    } catch (loadError) {
      setError(formatAdminPageError(loadError, "角色列表加载失败"));
    } finally {
      setLoading(false);
    }
  }

  function prepareWriteAction(action: string, role: AdminRole) {
    const reason = window.prompt(`请输入${action} ${role.code} 的原因`);

    if (!reason?.trim()) {
      return;
    }

    if (!window.confirm(`确认提交 ${action} 占位请求？`)) {
      return;
    }

    setNotice(
      `${action} 已进入前端确认占位。第 5 步 API 接入前不会修改角色配置。`,
    );
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label className="toolbar__search">
          <span>角色 / 权限</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void load();
              }
            }}
            placeholder="role code / permission"
            value={query}
          />
        </label>
        <button
          className="icon-button"
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>刷新</span>
        </button>
      </div>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {loading ? <p className="notice">加载中...</p> : null}
      {!loading && !error && filteredRoles.length === 0 ? (
        <p className="notice">暂无角色配置</p>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>角色</th>
              <th>名称</th>
              <th>权限 JSON</th>
              <th>绑定人数</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredRoles.map((role) => (
              <tr key={role.id}>
                <td>
                  <strong>{role.code}</strong>
                  <small>{shortId(role.id)}</small>
                </td>
                <td>{role.display_name ?? "-"}</td>
                <td>
                  <pre className="json-preview">
                    {JSON.stringify(role.permissions, null, 2)}
                  </pre>
                </td>
                <td>{role.admin_user_count}</td>
                <td>{formatDate(role.updated_at ?? role.created_at)}</td>
                <td>
                  <span className="action-cell">
                    <button
                      className="icon-button"
                      onClick={() => prepareWriteAction("授予用户", role)}
                      title="授予用户"
                      type="button"
                    >
                      <Users aria-hidden="true" size={16} />
                      <span>授权</span>
                    </button>
                    <button
                      className="icon-button icon-button--danger"
                      onClick={() => prepareWriteAction("调整权限", role)}
                      title="调整权限"
                      type="button"
                    >
                      <ShieldPlus aria-hidden="true" size={16} />
                      <span>权限</span>
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatAdminPageError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) {
    return error.requestId
      ? `${error.message} requestId: ${error.requestId}`
      : error.message;
  }

  return error instanceof Error ? error.message : fallback;
}
