import { Ban, Gift, LifeBuoy, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  AdminApiError,
  applyUserFlag,
  createCompensationRequest,
  createSupportTicket,
  fetchAdminUserDetail,
  fetchAdminUserInventory,
  fetchAdminUserLedger,
  fetchAdminUserPayments,
} from "../admin.api";
import type {
  AdminUserDetail,
  AdminUserInventoryResponse,
  AdminUserLedgerResponse,
  AdminUserPaymentsResponse,
  AdminUserProfile,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";
import { promptCompensationDraft } from "./supportCompensation";

type DetailTab =
  | "assets"
  | "inventory"
  | "payments"
  | "gacha"
  | "market"
  | "tasks"
  | "wallets"
  | "risk"
  | "support";

type DetailBlock = {
  dataSource?: string;
  data_source?: string;
  updatedAt?: string | null;
  updated_at?: string | null;
  count?: number;
  items?: unknown[];
  [key: string]: unknown;
};

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "assets", label: "资产" },
  { id: "inventory", label: "库存" },
  { id: "payments", label: "支付" },
  { id: "gacha", label: "开盒" },
  { id: "market", label: "市场" },
  { id: "tasks", label: "任务" },
  { id: "wallets", label: "钱包" },
  { id: "risk", label: "风险" },
  { id: "support", label: "工单" },
];

type UserDetailPageProps = {
  canCreateCompensation: boolean;
  canRestrictUser: boolean;
  canWriteSupport: boolean;
  userId: string | null;
};

export function UserDetailPage(props: UserDetailPageProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("assets");
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [ledger, setLedger] = useState<AdminUserLedgerResponse | null>(null);
  const [inventory, setInventory] = useState<AdminUserInventoryResponse | null>(
    null,
  );
  const [payments, setPayments] = useState<AdminUserPaymentsResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadDetail(userId: string) {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      setDetail(await fetchAdminUserDetail(userId));
      setLedger(null);
      setInventory(null);
      setPayments(null);
    } catch (loadError) {
      setError(formatAdminPageError(loadError, "用户详情加载失败"));
    } finally {
      setLoading(false);
    }
  }

  async function loadSection(tab: DetailTab) {
    if (!props.userId) {
      return;
    }

    setSectionLoading(true);
    setError(null);

    try {
      if (tab === "assets" && !ledger) {
        setLedger(
          await fetchAdminUserLedger({ userId: props.userId, limit: 20 }),
        );
      }

      if (tab === "inventory" && !inventory) {
        setInventory(
          await fetchAdminUserInventory({ userId: props.userId, limit: 20 }),
        );
      }

      if (tab === "payments" && !payments) {
        setPayments(
          await fetchAdminUserPayments({ userId: props.userId, limit: 20 }),
        );
      }
    } catch (loadError) {
      setError(formatAdminPageError(loadError, "分页明细加载失败"));
    } finally {
      setSectionLoading(false);
    }
  }

  async function restrictUser() {
    if (!props.userId || !props.canRestrictUser) {
      return;
    }

    const reason = window.prompt("请输入限制账号原因");
    if (!reason?.trim()) {
      return;
    }

    if (!window.confirm("确认通过风控 flag 限制该用户？")) {
      return;
    }

    try {
      await applyUserFlag({
        userId: props.userId,
        flagCode: "support_review_required",
        flagLevel: "restriction",
        reason,
        metadata: { source: "admin_user_detail" },
      });
      setNotice("已提交用户限制 flag。");
      await loadDetail(props.userId);
    } catch (actionError) {
      setError(formatAdminPageError(actionError, "用户限制失败"));
    }
  }

  async function createTicket() {
    if (!props.userId || !props.canWriteSupport) {
      return;
    }

    const subject = window.prompt("请输入工单标题");
    if (!subject?.trim()) {
      return;
    }

    const message = window.prompt("请输入工单说明，可留空") ?? "";
    const reason = window.prompt("请输入创建原因") ?? subject;

    if (!window.confirm("确认创建客服工单？")) {
      return;
    }

    try {
      await createSupportTicket({
        userId: props.userId,
        ticketType: "other",
        subject,
        message,
        reason,
        metadata: { source: "admin_user_detail" },
      });
      setNotice("已创建客服工单。");
      await loadDetail(props.userId);
    } catch (actionError) {
      setError(formatAdminPageError(actionError, "工单创建失败"));
    }
  }

  async function createCompensation() {
    if (!props.userId || !props.canCreateCompensation) {
      return;
    }

    const draft = promptCompensationDraft({
      targetUserId: props.userId,
    });
    if (!draft) {
      return;
    }

    try {
      await createCompensationRequest(draft);
      setNotice("已提交补偿请求。");
      await loadDetail(props.userId);
    } catch (actionError) {
      setError(formatAdminPageError(actionError, "补偿请求失败"));
    }
  }

  useEffect(() => {
    if (props.userId) {
      void loadDetail(props.userId);
    } else {
      setDetail(null);
    }
  }, [props.userId]);

  useEffect(() => {
    void loadSection(activeTab);
  }, [activeTab, props.userId]);

  const user = detail?.user;
  const currentRows = useMemo(() => {
    if (!detail) {
      return [];
    }

    switch (activeTab) {
      case "assets":
        return ledger?.items ?? detail.balances ?? [];
      case "inventory":
        return inventory?.items ?? detail.inventory?.items ?? [];
      case "payments":
        return payments?.items ?? detail.payments?.items ?? [];
      case "gacha":
        return buildGachaRows(detail);
      case "market":
        return detail.marketListings ?? [];
      case "tasks":
        return detail.taskProgress ?? [];
      case "wallets":
        return detail.wallets ?? [];
      case "risk":
        return [...(detail.flags ?? []), ...(detail.riskEvents ?? [])];
      case "support":
        return detail.supportTickets ?? [];
    }
  }, [activeTab, detail, inventory, ledger, payments]);
  const activeBlock = useMemo(
    () => (detail ? getActiveBlock(detail, activeTab) : null),
    [activeTab, detail],
  );

  if (!props.userId) {
    return (
      <section className="detail-panel admin-state-panel">
        <h2>选择用户</h2>
        <p>从左侧用户列表选择一名用户后查看客服详情。</p>
      </section>
    );
  }

  return (
    <section className="detail-panel" aria-label="用户详情">
      <div className="detail-panel__header">
        <div>
          <h2>{user ? getUserDisplayName(user) : "用户详情"}</h2>
          <p>{props.userId}</p>
        </div>
        {user ? <StatusBadge status={user.status} /> : null}
      </div>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {loading ? <p className="notice">详情加载中...</p> : null}

      {user ? (
        <div className="metric-strip">
          <span>
            <strong>{formatTelegramId(user)}</strong>
            <small>Telegram</small>
          </span>
          <span>
            <strong>{formatUnknown(user.riskScore ?? user.risk_score)}</strong>
            <small>risk</small>
          </span>
          <span>
            <strong>{formatDate(user.lastSeenAt ?? user.last_seen_at)}</strong>
            <small>last seen</small>
          </span>
        </div>
      ) : null}

      <div className="admin-state-actions">
        <button
          className="icon-button"
          disabled={loading}
          onClick={() => props.userId && void loadDetail(props.userId)}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
          <span>刷新</span>
        </button>
        <button
          className="icon-button"
          disabled={!props.canWriteSupport}
          onClick={() => void createTicket()}
          type="button"
        >
          <LifeBuoy aria-hidden="true" size={16} />
          <span>建工单</span>
        </button>
        <button
          className="icon-button"
          disabled={!props.canCreateCompensation}
          onClick={() => void createCompensation()}
          type="button"
        >
          <Gift aria-hidden="true" size={16} />
          <span>补偿</span>
        </button>
        <button
          className="icon-button icon-button--danger"
          disabled={!props.canRestrictUser}
          onClick={() => void restrictUser()}
          type="button"
        >
          <Ban aria-hidden="true" size={16} />
          <span>限制</span>
        </button>
      </div>

      <div className="segmented-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            className={activeTab === tab.id ? "is-active" : ""}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {sectionLoading ? <p className="notice">明细加载中...</p> : null}

      {activeBlock ? (
        <div className="metric-strip">
          <span>
            <strong>{formatBlockSource(activeBlock)}</strong>
            <small>数据来源</small>
          </span>
          <span>
            <strong>{formatDate(formatBlockUpdatedAt(activeBlock))}</strong>
            <small>更新时间</small>
          </span>
          <span>
            <strong>{formatBlockCount(activeBlock, currentRows.length)}</strong>
            <small>记录数</small>
          </span>
        </div>
      ) : null}

      <JsonTable rows={currentRows} />
    </section>
  );
}

function JsonTable({ rows }: { rows: unknown[] }) {
  if (rows.length === 0) {
    return <p className="notice">暂无数据</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>状态 / 类型</th>
            <th>摘要</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const record = isRecord(row) ? row : {};
            const id = readString(record, "id") ?? `row-${index}`;
            const status =
              readString(record, "status") ??
              readString(record, "entry_type") ??
              readString(record, "ticketType") ??
              readString(record, "ticket_type") ??
              readString(record, "record_type") ??
              "-";

            return (
              <tr key={`${id}-${index}`}>
                <td>
                  <strong>{shortId(id)}</strong>
                </td>
                <td>
                  <StatusBadge status={status} />
                </td>
                <td>
                  <small>{summarizeRecord(record)}</small>
                </td>
                <td>
                  {formatDate(
                    readString(record, "updated_at") ??
                      readString(record, "created_at"),
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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

function summarizeRecord(record: Record<string, unknown>): string {
  const preferred = [
    "currency_code",
    "amount",
    "subject",
    "business_type",
    "record_type",
    "draw_count",
    "rarity_code",
    "template_id",
    "source_type",
    "reason",
  ]
    .map((key) => {
      const value = record[key];
      return value === null || value === undefined ? null : `${key}:${value}`;
    })
    .filter(Boolean);

  return preferred.join(" / ") || Object.keys(record).slice(0, 4).join(", ");
}

function getActiveBlock(
  detail: AdminUserDetail,
  tab: DetailTab,
): DetailBlock | null {
  switch (tab) {
    case "assets":
      return detail.assets ?? null;
    case "inventory":
      return detail.inventory ?? null;
    case "payments":
      return detail.payments ?? null;
    case "gacha":
      return detail.gacha ?? null;
    case "market":
      return detail.market ?? null;
    case "tasks":
      return detail.tasks ?? null;
    case "wallets":
      return detail.walletsBlock ?? detail.wallets_block ?? null;
    case "risk":
      return detail.risk ?? null;
    case "support":
      return detail.support ?? null;
  }
}

function buildGachaRows(detail: AdminUserDetail): unknown[] {
  const block = detail.gacha;

  return [
    ...readBlockArray(block, "recentOrders", "recent_orders").map((row) =>
      withRecordType(row, "draw_order"),
    ),
    ...readBlockArray(block, "recentResults", "recent_results").map((row) =>
      withRecordType(row, "draw_result"),
    ),
  ];
}

function readBlockArray(
  block: DetailBlock | null | undefined,
  camelKey: string,
  snakeKey: string,
): Record<string, unknown>[] {
  const value = block?.[camelKey] ?? block?.[snakeKey];

  return Array.isArray(value)
    ? value.filter(isRecord)
    : Array.isArray(block?.items)
      ? block.items.filter(isRecord)
      : [];
}

function withRecordType(
  row: Record<string, unknown>,
  recordType: string,
): Record<string, unknown> {
  return {
    record_type: recordType,
    ...row,
  };
}

function formatBlockSource(block: DetailBlock): string {
  const source = block.dataSource ?? block.data_source;

  if (!source) {
    return "-";
  }

  return source.length > 42 ? `${source.slice(0, 39)}...` : source;
}

function formatBlockUpdatedAt(block: DetailBlock): string | null {
  return block.updatedAt ?? block.updated_at ?? null;
}

function formatBlockCount(block: DetailBlock, fallback: number): string {
  if (typeof block.count === "number") {
    return block.count.toLocaleString();
  }

  if (Array.isArray(block.items)) {
    return block.items.length.toLocaleString();
  }

  return fallback.toLocaleString();
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
