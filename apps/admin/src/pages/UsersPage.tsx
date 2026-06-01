import { RefreshCw, Search } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { AdminApiError, fetchAppUsers } from "../admin.api";
import type {
  AdminUserProfile,
  AdminUserProfilesResponse,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";
import { UserDetailPage } from "./UserDetailPage";

const PAGE_LIMIT = 30;
const USER_STATUSES = [
  "",
  "active",
  "restricted",
  "banned",
  "deleted",
  "suspended",
] as const;

type UsersPageProps = {
  canCreateCompensation: boolean;
  canRestrictUser: boolean;
  canWriteSupport: boolean;
};

export function UsersPage(props: UsersPageProps) {
  const initialUserId = readUsersHashUserId();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    initialUserId,
  );
  const [data, setData] = useState<AdminUserProfilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(nextCursor: string | null = cursor) {
    setLoading(true);
    setError(null);

    try {
      setData(
        await fetchAppUsers({
          q: query || undefined,
          status: status || undefined,
          cursor: nextCursor,
          limit: PAGE_LIMIT,
        }),
      );
    } catch (loadError) {
      setError(formatAdminPageError(loadError, "用户列表加载失败"));
    } finally {
      setLoading(false);
    }
  }

  function applySearch() {
    setCursor(null);
    void load(null);
  }

  function selectUser(userId: string) {
    setSelectedUserId(userId);
    window.history.replaceState(
      null,
      "",
      `#users?userId=${encodeURIComponent(userId)}`,
    );
  }

  function goNextPage() {
    const nextCursor = data?.nextCursor ?? null;

    if (!nextCursor) {
      return;
    }

    setCursor(nextCursor);
    void load(nextCursor);
  }

  useEffect(() => {
    void load(null);

    function handleHashChange() {
      const nextUserId = readUsersHashUserId();

      if (nextUserId) {
        setSelectedUserId(nextUserId);
      }
    }

    window.addEventListener("hashchange", handleHashChange);

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const users = data?.items ?? [];

  return (
    <section className="admin-surface">
      <form
        className="toolbar"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          applySearch();
        }}
      >
        <label className="toolbar__search">
          <span>搜索用户</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Telegram ID / user id / 昵称 / 钱包地址 / 订单 id"
            value={query}
          />
        </label>
        <label>
          <span>状态</span>
          <select
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            {USER_STATUSES.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <button className="icon-button" disabled={loading} type="submit">
          <Search aria-hidden="true" size={17} />
          <span>查询</span>
        </button>
        <button
          className="icon-button"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>刷新</span>
        </button>
      </form>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {loading ? <p className="notice">加载中...</p> : null}

      <div className="metric-strip">
        {Object.entries(data?.summary ?? {}).map(([key, value]) => (
          <span key={key}>
            <strong>{formatMetricValue(value)}</strong>
            <small>{key}</small>
          </span>
        ))}
      </div>

      {!loading && !error && users.length === 0 ? (
        <p className="notice">暂无匹配用户</p>
      ) : null}

      <div className="split-grid">
        <section className="detail-panel" aria-label="用户搜索结果">
          <div className="detail-panel__header">
            <div>
              <h2>用户列表</h2>
              <p>点击用户进入只读详情；写操作由详情页单独按钮和权限控制。</p>
            </div>
            <StatusBadge status={status || "all"} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>Telegram</th>
                  <th>状态</th>
                  <th>钱包 / 支付</th>
                  <th>风险</th>
                  <th>最近活跃</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6}>暂无用户</td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr
                      className={
                        selectedUserId === user.id ? "is-selected" : ""
                      }
                      key={user.id}
                      onClick={() => selectUser(user.id)}
                    >
                      <td>
                        <strong>{getUserDisplayName(user)}</strong>
                        <small>{shortId(user.id)}</small>
                      </td>
                      <td>
                        <strong>{formatTelegramId(user)}</strong>
                        <small>
                          {user.username ? `@${user.username}` : "-"}
                        </small>
                      </td>
                      <td>
                        <StatusBadge status={user.status} />
                      </td>
                      <td>
                        <strong>
                          {shortenAddress(getUserWalletAddress(user))}
                        </strong>
                        <small>
                          {user.latestPaymentOrderId
                            ? `order:${shortId(user.latestPaymentOrderId)}`
                            : "order:-"}
                        </small>
                      </td>
                      <td>
                        {formatUnknown(user.riskScore ?? user.risk_score)}
                      </td>
                      <td>
                        {formatDate(user.lastSeenAt ?? user.last_seen_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="audit-pagination">
            <button
              className="icon-button"
              disabled={!data?.nextCursor || loading}
              onClick={goNextPage}
              type="button"
            >
              <span>下一页</span>
            </button>
          </div>
        </section>

        <UserDetailPage
          canCreateCompensation={props.canCreateCompensation}
          canRestrictUser={props.canRestrictUser}
          canWriteSupport={props.canWriteSupport}
          userId={selectedUserId}
        />
      </div>
    </section>
  );
}

function readUsersHashUserId(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  const [tab, query = ""] = hash.split("?");

  if (tab !== "users") {
    return null;
  }

  const value = new URLSearchParams(query).get("userId");
  return value?.trim() || null;
}

function getUserDisplayName(user: AdminUserProfile): string {
  const fullName = [
    user.firstName ?? user.first_name,
    user.lastName ?? user.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return user.displayName || fullName || user.username || shortId(user.id);
}

function formatTelegramId(user: AdminUserProfile): string {
  const telegramId = user.telegramUserId ?? user.telegram_user_id;

  return telegramId ? `tg:${telegramId}` : "-";
}

function getUserWalletAddress(user: AdminUserProfile): string | null {
  return user.walletAddress ?? user.latestWalletAddress ?? null;
}

function shortenAddress(value: string | null): string {
  if (!value) {
    return "-";
  }

  if (value.length <= 16) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function formatMetricValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }

  return "-";
}

function formatUnknown(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function formatAdminPageError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) {
    return error.requestId
      ? `${error.message} requestId: ${error.requestId}`
      : error.message;
  }

  return error instanceof Error ? error.message : fallback;
}
