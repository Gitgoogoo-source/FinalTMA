import { RefreshCw, ShieldCheck, UserCog } from "lucide-react";
import { useEffect, useState } from "react";

import { AdminApiError, fetchAdminUsers } from "../admin.api";
import type { AdminUser, AdminUsersResponse } from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";

export function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      setData(
        await fetchAdminUsers({
          q: query || undefined,
          status: status || undefined,
          limit: 30,
        }),
      );
    } catch (loadError) {
      setError(formatAdminPageError(loadError, "管理员列表加载失败"));
    } finally {
      setLoading(false);
    }
  }

  function prepareWriteAction(action: string, adminUser: AdminUser) {
    const target = adminUser.display_name ?? shortId(adminUser.id);
    const reason = window.prompt(`请输入${action} ${target} 的原因`);

    if (!reason?.trim()) {
      return;
    }

    if (!window.confirm(`确认提交 ${action} 占位请求？`)) {
      return;
    }

    setNotice(
      `${action} 已进入前端确认占位。第 5 步 API 接入前不会修改管理员状态。`,
    );
  }

  useEffect(() => {
    void load();
  }, []);

  const items = data?.items ?? [];

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label className="toolbar__search">
          <span>管理员 / Telegram ID</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void load();
              }
            }}
            placeholder="display name / UUID / telegram id"
            value={query}
          />
        </label>
        <label>
          <span>状态</span>
          <select
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="">全部</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
            <option value="locked">locked</option>
          </select>
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

      <div className="metric-strip">
        {Object.entries(data?.summary ?? {}).map(([key, value]) => (
          <span key={key}>
            <strong>{value}</strong>
            <small>{key}</small>
          </span>
        ))}
      </div>

      {!loading && !error && items.length === 0 ? (
        <p className="notice">暂无管理员用户</p>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>管理员</th>
              <th>绑定身份</th>
              <th>状态</th>
              <th>角色</th>
              <th>最后登录</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((adminUser) => (
              <tr key={adminUser.id}>
                <td>
                  <strong>
                    {adminUser.display_name ?? shortId(adminUser.id)}
                  </strong>
                  <small>{shortId(adminUser.id)}</small>
                </td>
                <td>
                  <strong>
                    {adminUser.telegram_user_id
                      ? `tg:${adminUser.telegram_user_id}`
                      : "-"}
                  </strong>
                  <small>
                    {adminUser.core_user_id
                      ? `core:${shortId(adminUser.core_user_id)}`
                      : "core:-"}
                  </small>
                </td>
                <td>
                  <StatusBadge status={adminUser.status} />
                </td>
                <td>
                  <div className="permission-list">
                    {adminUser.roles.length === 0 ? (
                      <span>未绑定角色</span>
                    ) : (
                      adminUser.roles.map((role) => (
                        <span key={`${adminUser.id}:${role.id}`}>
                          {role.code}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td>{formatDate(adminUser.last_login_at)}</td>
                <td>{formatDate(adminUser.created_at)}</td>
                <td>
                  <span className="action-cell">
                    <button
                      className="icon-button"
                      onClick={() => prepareWriteAction("授予角色", adminUser)}
                      title="授予角色"
                      type="button"
                    >
                      <ShieldCheck aria-hidden="true" size={16} />
                      <span>授权</span>
                    </button>
                    <button
                      className="icon-button icon-button--danger"
                      onClick={() => prepareWriteAction("调整状态", adminUser)}
                      title="调整管理员状态"
                      type="button"
                    >
                      <UserCog aria-hidden="true" size={16} />
                      <span>状态</span>
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
