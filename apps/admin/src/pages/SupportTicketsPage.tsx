import { CheckCircle2, Gift, Plus, RefreshCw, Search } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import {
  AdminApiError,
  createCompensationRequest,
  createSupportTicket,
  fetchSupportTickets,
  updateSupportTicket,
} from "../admin.api";
import type {
  SupportTicket,
  SupportTicketStatus,
  SupportTicketsResponse,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";
import { promptCompensationDraft } from "./supportCompensation";

const PAGE_LIMIT = 30;
const SUPPORT_STATUSES = [
  "",
  "open",
  "pending_user",
  "pending_ops",
  "resolved",
  "rejected",
  "escalated",
] as const;
const WRITABLE_STATUSES = SUPPORT_STATUSES.filter(
  (status) => status !== "",
) as SupportTicketStatus[];

type SupportTicketsPageProps = {
  canCreateCompensation: boolean;
  canWriteSupport: boolean;
};

export function SupportTicketsPage(props: SupportTicketsPageProps) {
  const [status, setStatus] = useState<SupportTicketStatus | "">("open");
  const [userId, setUserId] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [data, setData] = useState<SupportTicketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(nextCursor: string | null = cursor) {
    setLoading(true);
    setError(null);

    try {
      setData(
        await fetchSupportTickets({
          status: status || undefined,
          userId: userId.trim() || undefined,
          cursor: nextCursor,
          limit: PAGE_LIMIT,
        }),
      );
    } catch (loadError) {
      setError(formatAdminPageError(loadError, "工单加载失败"));
    } finally {
      setLoading(false);
    }
  }

  function applySearch() {
    setCursor(null);
    void load(null);
  }

  function goNextPage() {
    const nextCursor = data?.nextCursor ?? null;

    if (!nextCursor) {
      return;
    }

    setCursor(nextCursor);
    void load(nextCursor);
  }

  async function createManualTicket() {
    if (!props.canWriteSupport) {
      return;
    }

    const targetUserId = window.prompt("用户 ID，可留空")?.trim() ?? "";
    const subject = window.prompt("工单标题");
    if (!subject?.trim()) {
      return;
    }

    const message = window.prompt("工单说明，可留空") ?? "";
    const reason = window.prompt("创建原因") ?? subject;

    if (!window.confirm("确认创建客服工单？")) {
      return;
    }

    try {
      await createSupportTicket({
        userId: targetUserId || null,
        ticketType: "other",
        subject,
        message,
        reason,
        metadata: { source: "support_tickets_page" },
      });
      setNotice("已创建客服工单。");
      await load(null);
    } catch (actionError) {
      setError(formatAdminPageError(actionError, "工单创建失败"));
    }
  }

  async function updateTicketStatus(ticket: SupportTicket) {
    if (!props.canWriteSupport) {
      return;
    }

    const nextStatus = window.prompt(
      `请输入状态：${WRITABLE_STATUSES.join(" / ")}`,
      ticket.status,
    ) as SupportTicketStatus | null;

    if (!nextStatus || !WRITABLE_STATUSES.includes(nextStatus)) {
      return;
    }

    const reason = window.prompt("请输入处理原因");
    if (!reason?.trim()) {
      return;
    }

    const resolution =
      nextStatus === "resolved"
        ? window.prompt("请输入解决结论")?.trim() || null
        : null;
    const rejectionReason =
      nextStatus === "rejected"
        ? window.prompt("请输入拒绝原因")?.trim() || null
        : null;
    const escalationOwner =
      nextStatus === "escalated"
        ? window.prompt("请输入升级负责人或队列")?.trim() || null
        : null;

    if (
      (nextStatus === "resolved" && !resolution) ||
      (nextStatus === "rejected" && !rejectionReason) ||
      (nextStatus === "escalated" && !escalationOwner)
    ) {
      setError("终态/升级状态必须填写对应处理说明。");
      return;
    }

    if (!window.confirm(`确认将工单状态更新为 ${nextStatus}？`)) {
      return;
    }

    try {
      await updateSupportTicket({
        ticketId: ticket.id,
        status: nextStatus,
        resolution,
        rejectionReason,
        escalationOwner,
        reason,
        result: {
          source: "support_tickets_page",
          previousStatus: ticket.status,
        },
      });
      setNotice("工单状态已更新。");
      await load(null);
    } catch (actionError) {
      setError(formatAdminPageError(actionError, "工单更新失败"));
    }
  }

  async function createTicketCompensation(ticket: SupportTicket) {
    if (!props.canCreateCompensation || !ticket.userId) {
      return;
    }

    const draft = promptCompensationDraft({
      targetUserId: ticket.userId,
      ticketId: ticket.id,
    });
    if (!draft) {
      return;
    }

    try {
      await createCompensationRequest(draft);
      setNotice("已提交补偿请求。");
      await load(null);
    } catch (actionError) {
      setError(formatAdminPageError(actionError, "补偿请求失败"));
    }
  }

  useEffect(() => {
    void load(null);
  }, []);

  const tickets = data?.items ?? [];

  return (
    <section className="admin-surface">
      <form
        className="toolbar"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          applySearch();
        }}
      >
        <label>
          <span>状态</span>
          <select
            onChange={(event) =>
              setStatus(event.target.value as SupportTicketStatus | "")
            }
            value={status}
          >
            {SUPPORT_STATUSES.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__search">
          <span>用户 ID</span>
          <input
            onChange={(event) => setUserId(event.target.value)}
            placeholder="user id"
            value={userId}
          />
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
        <button
          className="icon-button"
          disabled={!props.canWriteSupport}
          onClick={() => void createManualTicket()}
          type="button"
        >
          <Plus aria-hidden="true" size={17} />
          <span>新工单</span>
        </button>
      </form>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {loading ? <p className="notice">加载中...</p> : null}

      <div className="metric-strip">
        {Object.entries(data?.summary ?? {}).map(([key, value]) => (
          <span key={key}>
            <strong>{formatMetricValue(value)}</strong>
            <small>{key}</small>
          </span>
        ))}
      </div>

      <section className="detail-panel" aria-label="客服工单">
        <div className="detail-panel__header">
          <div>
            <h2>客服工单</h2>
            <p>状态流转、补偿请求和审计写入走服务端权限控制。</p>
          </div>
          <StatusBadge status={status || "all"} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>工单</th>
                <th>用户</th>
                <th>状态</th>
                <th>关联</th>
                <th>处理</th>
                <th>补偿</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 ? (
                <tr>
                  <td colSpan={8}>暂无工单</td>
                </tr>
              ) : (
                tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <strong>{ticket.subject}</strong>
                      <small>{shortId(ticket.id)}</small>
                    </td>
                    <td>
                      {ticket.userId ? (
                        <button
                          className="text-button"
                          onClick={() => openUser(ticket.userId)}
                          type="button"
                        >
                          {shortId(ticket.userId)}
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td>
                      <strong>{ticket.relatedType ?? "-"}</strong>
                      <small>
                        {ticket.relatedId ? shortId(ticket.relatedId) : "-"}
                      </small>
                    </td>
                    <td>
                      <strong>{ticket.assignedAdminName ?? "-"}</strong>
                      <small>
                        {ticket.lastHandledAt
                          ? formatDate(ticket.lastHandledAt)
                          : "-"}
                      </small>
                    </td>
                    <td>
                      <strong>
                        {(ticket.compensationRequests ?? []).length}
                      </strong>
                      <small>requests</small>
                    </td>
                    <td>{formatDate(ticket.updatedAt ?? ticket.updated_at)}</td>
                    <td>
                      <div className="admin-state-actions">
                        <button
                          className="icon-button"
                          disabled={!props.canWriteSupport}
                          onClick={() => void updateTicketStatus(ticket)}
                          type="button"
                        >
                          <CheckCircle2 aria-hidden="true" size={15} />
                          <span>处理</span>
                        </button>
                        <button
                          className="icon-button"
                          disabled={
                            !props.canCreateCompensation || !ticket.userId
                          }
                          onClick={() => void createTicketCompensation(ticket)}
                          type="button"
                        >
                          <Gift aria-hidden="true" size={15} />
                          <span>补偿</span>
                        </button>
                      </div>
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
    </section>
  );
}

function openUser(userId: string | null | undefined) {
  if (!userId) {
    return;
  }

  window.location.hash = `users?userId=${encodeURIComponent(userId)}`;
}

function formatMetricValue(value: unknown): string {
  if (typeof value === "number") {
    return value.toLocaleString();
  }

  return value === null || value === undefined ? "-" : String(value);
}

function formatAdminPageError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) {
    return error.requestId
      ? `${error.message} requestId: ${error.requestId}`
      : error.message;
  }

  return error instanceof Error ? error.message : fallback;
}
