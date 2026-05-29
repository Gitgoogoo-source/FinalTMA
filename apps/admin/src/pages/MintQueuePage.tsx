import { RefreshCw, RotateCcw, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { fetchMintQueue, retryMintQueue } from "../admin.api";
import type { MintQueueItem, MintQueueResponse } from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";

const MINT_STATUSES = [
  "",
  "queued",
  "processing",
  "submitted",
  "confirming",
  "retrying",
  "manual_review",
  "minted",
  "failed",
  "cancelled",
];
const RETRYABLE_STATUSES = new Set(["failed", "manual_review"]);
const RETRY_PRIORITIES = ["HIGH", "NORMAL", "LOW"] as const;
type RetryPriority = (typeof RETRY_PRIORITIES)[number];

type RetryDraft = {
  item: MintQueueItem;
  reason: string;
  priority: RetryPriority;
  confirmed: boolean;
};

export function MintQueuePage() {
  const [status, setStatus] = useState("failed");
  const [query, setQuery] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [data, setData] = useState<MintQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [retryDraft, setRetryDraft] = useState<RetryDraft | null>(null);
  const selectedItem =
    data?.items.find((item) => item.id === selectedItemId) ??
    data?.items[0] ??
    null;

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchMintQueue({
        status: status || undefined,
        q: query || undefined,
        limit: 30,
      });

      setData(response);
      setSelectedItemId((current) =>
        current && response.items.some((item) => item.id === current)
          ? current
          : (response.items[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Mint 队列加载失败",
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitRetry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!retryDraft) {
      return;
    }

    const reason = retryDraft.reason.trim();

    if (!reason) {
      setError("重试原因不能为空");
      return;
    }

    if (!retryDraft.confirmed) {
      setError("请先完成二次确认");
      return;
    }

    setBusyId(retryDraft.item.id);
    setError(null);

    try {
      await retryMintQueue({
        mintQueueId: retryDraft.item.id,
        priority: retryDraft.priority,
        reason,
      });
      setRetryDraft(null);
      await load();
    } catch (retryError) {
      setError(
        retryError instanceof Error ? retryError.message : "Mint 重试失败",
      );
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    void load();
  }, [status]);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label>
          <span>状态</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {MINT_STATUSES.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__search">
          <span>队列 / 藏品</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void load();
              }
            }}
            placeholder="Mint queue ID 或 item instance ID"
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
      {loading ? <p className="notice">加载中...</p> : null}

      <div className="metric-strip">
        {Object.entries(data?.summary ?? {}).map(([key, value]) => (
          <span key={key}>
            <strong>{value}</strong>
            <small>{key}</small>
          </span>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>队列</th>
              <th>状态</th>
              <th>尝试</th>
              <th>钱包</th>
              <th>链上交易</th>
              <th>错误</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item) => (
              <tr
                className={selectedItem?.id === item.id ? "is-selected" : ""}
                key={item.id}
              >
                <td>
                  <strong>{shortId(item.id)}</strong>
                  <small>{shortId(item.item_instance_id)}</small>
                </td>
                <td>
                  <StatusBadge status={item.status} />
                </td>
                <td>
                  {item.attempt_count}/{item.max_attempts}
                  <small>{formatDate(item.next_attempt_at)}</small>
                </td>
                <td>
                  {item.wallet ? (
                    <>
                      <strong>
                        {item.wallet.wallet_app_name ?? item.wallet.network}
                      </strong>
                      <small>{item.wallet.address}</small>
                    </>
                  ) : (
                    "-"
                  )}
                </td>
                <td>
                  {item.transaction ? (
                    <>
                      <StatusBadge status={item.transaction.status} />
                      <small>
                        {item.transaction.tx_hash ?? item.transaction.query_id}
                      </small>
                    </>
                  ) : (
                    "-"
                  )}
                </td>
                <td>{item.error_message ?? "-"}</td>
                <td className="action-cell">
                  <button
                    className="text-button"
                    onClick={() => setSelectedItemId(item.id)}
                    type="button"
                  >
                    详情
                  </button>
                  <button
                    className="icon-button"
                    disabled={
                      busyId === item.id || !RETRYABLE_STATUSES.has(item.status)
                    }
                    onClick={() =>
                      setRetryDraft({
                        item,
                        priority: "HIGH",
                        reason: "",
                        confirmed: false,
                      })
                    }
                    title="重试 Mint"
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" size={16} />
                    <span>{busyId === item.id ? "提交中" : "重试"}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MintFailureDetail item={selectedItem} />

      {retryDraft ? (
        <form className="danger-panel" onSubmit={submitRetry}>
          <div className="detail-panel__header">
            <div>
              <h2>手动重试 Mint</h2>
              <p>{retryDraft.item.id}</p>
            </div>
            <button
              className="icon-only-button"
              onClick={() => setRetryDraft(null)}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
          <div className="form-grid">
            <label>
              <span>优先级</span>
              <select
                value={retryDraft.priority}
                onChange={(event) =>
                  setRetryDraft({
                    ...retryDraft,
                    priority: event.target.value as RetryPriority,
                  })
                }
              >
                {RETRY_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-grid__wide">
              <span>重试原因</span>
              <textarea
                onChange={(event) =>
                  setRetryDraft({ ...retryDraft, reason: event.target.value })
                }
                placeholder="说明为什么需要人工重试"
                rows={3}
                value={retryDraft.reason}
              />
            </label>
            <label className="checkbox-row form-grid__wide">
              <input
                checked={retryDraft.confirmed}
                onChange={(event) =>
                  setRetryDraft({
                    ...retryDraft,
                    confirmed: event.target.checked,
                  })
                }
                type="checkbox"
              />
              <span>确认该操作会写入后台 audit，并且不会绕过 Mint RPC</span>
            </label>
          </div>
          <div className="button-row">
            <button
              className="icon-button icon-button--danger"
              disabled={busyId === retryDraft.item.id}
              type="submit"
            >
              <RotateCcw aria-hidden="true" size={16} />
              <span>
                {busyId === retryDraft.item.id ? "提交中" : "确认重试"}
              </span>
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function MintFailureDetail({ item }: { item: MintQueueItem | null }) {
  if (!item) {
    return <p className="notice">暂无可查看的 Mint 详情</p>;
  }

  return (
    <section className="detail-panel" aria-label="Mint 失败详情">
      <div className="detail-panel__header">
        <div>
          <h2>Mint 失败详情</h2>
          <p>{item.error_message ?? item.status}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>
      <div className="detail-grid">
        <DetailItem label="队列 ID" value={item.id} />
        <DetailItem label="用户 ID" value={item.user_id} />
        <DetailItem label="钱包 ID" value={item.wallet_id} />
        <DetailItem label="Collection" value={item.collection_id} />
        <DetailItem label="藏品实例" value={item.item_instance_id} />
        <DetailItem label="模板" value={item.template_id ?? null} />
        <DetailItem label="形态" value={item.form_id ?? null} />
        <DetailItem
          label="尝试次数"
          value={`${item.attempt_count}/${item.max_attempts}`}
        />
        <DetailItem
          label="下一次尝试"
          value={formatDate(item.next_attempt_at)}
        />
        <DetailItem label="NFT item" value={item.nft_item_id ?? null} />
        <DetailItem label="队列 tx" value={item.tx_hash} />
        <DetailItem
          label="完成时间"
          value={formatDate(item.completed_at ?? null)}
        />
      </div>
      <div className="detail-grid detail-grid--wide">
        <DetailItem label="错误" value={item.error_message} />
        <DetailItem
          label="钱包地址"
          value={item.wallet?.address ?? "未绑定队列钱包"}
        />
        <DetailItem
          label="链上交易"
          value={
            item.transaction
              ? `${item.transaction.status} / ${item.transaction.tx_hash ?? item.transaction.query_id ?? "-"}`
              : "未记录"
          }
        />
      </div>
    </section>
  );
}

function DetailItem(props: { label: string; value: string | null }) {
  return (
    <span>
      <small>{props.label}</small>
      <strong>{props.value ?? "-"}</strong>
    </span>
  );
}
