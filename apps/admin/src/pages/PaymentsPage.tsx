import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchPayments } from "../admin.api";
import type {
  PaymentAdminResponse,
  PaymentDispute,
  PaymentOrder,
  PaymentRefund,
  WebhookEvent,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";

const PAYMENT_STATUSES = [
  "",
  "created",
  "invoice_created",
  "precheckout_checked",
  "paid",
  "fulfilling",
  "fulfilled",
  "failed",
  "refunded",
  "disputed",
];
const EVENT_STATUSES = ["", "pending", "processing", "processed", "failed"];
const REFUND_STATUSES = ["", "created", "pending", "processed", "failed"];
const DISPUTE_STATUSES = ["", "open", "reviewing", "resolved", "rejected"];

export function PaymentsPage() {
  const [status, setStatus] = useState("");
  const [eventStatus, setEventStatus] = useState("");
  const [refundStatus, setRefundStatus] = useState("");
  const [disputeStatus, setDisputeStatus] = useState("");
  const [query, setQuery] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [data, setData] = useState<PaymentAdminResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedOrder =
    data?.orders.find((order) => order.id === selectedOrderId) ??
    data?.orders[0] ??
    null;

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchPayments({
        status: status || undefined,
        eventStatus: eventStatus || undefined,
        refundStatus: refundStatus || undefined,
        disputeStatus: disputeStatus || undefined,
        q: query || undefined,
        limit: 30,
      });

      setData(response);
      setSelectedOrderId((current) =>
        current && response.orders.some((order) => order.id === current)
          ? current
          : (response.orders[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "支付数据加载失败",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [status, eventStatus, refundStatus, disputeStatus]);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label>
          <span>状态</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {PAYMENT_STATUSES.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Webhook</span>
          <select
            value={eventStatus}
            onChange={(event) => setEventStatus(event.target.value)}
          >
            {EVENT_STATUSES.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>退款</span>
          <select
            value={refundStatus}
            onChange={(event) => setRefundStatus(event.target.value)}
          >
            {REFUND_STATUSES.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>争议</span>
          <select
            value={disputeStatus}
            onChange={(event) => setDisputeStatus(event.target.value)}
          >
            {DISPUTE_STATUSES.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__search">
          <span>订单 / payload</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void load();
              }
            }}
            placeholder="UUID 或 invoice payload"
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

      <StatusStrip
        empty={!data}
        error={error}
        loading={loading}
        summary={data?.summary ?? {}}
      />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>订单</th>
              <th>状态</th>
              <th>Stars</th>
              <th>支付</th>
              <th>错误</th>
              <th>创建时间</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {(data?.orders ?? []).map((order) => (
              <tr
                className={selectedOrder?.id === order.id ? "is-selected" : ""}
                key={order.id}
              >
                <td>
                  <strong>{shortId(order.id)}</strong>
                  <small>{order.telegram_invoice_payload}</small>
                </td>
                <td>
                  <StatusBadge status={order.status} />
                </td>
                <td>{order.xtr_amount}</td>
                <td>{order.payment ? "已记录" : "未记录"}</td>
                <td>{order.error_message ?? "-"}</td>
                <td>{formatDate(order.created_at)}</td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => setSelectedOrderId(order.id)}
                    type="button"
                  >
                    查看
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaymentDetail order={selectedOrder} />

      <div className="split-grid">
        <section>
          <h2>Webhook 事件</h2>
          <div className="table-wrap table-wrap--small">
            <table>
              <thead>
                <tr>
                  <th>Update</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>payload</th>
                  <th>重试</th>
                  <th>校验</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {(data?.events ?? []).map((event) => (
                  <WebhookEventRow event={event} key={event.id} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2>异常支付</h2>
          <div className="stack-list">
            {(data?.exceptions ?? []).length === 0 ? (
              <p className="muted">暂无异常订单</p>
            ) : (
              data?.exceptions.map((order) => (
                <button
                  className="list-row list-row--button"
                  key={order.id}
                  onClick={() => setSelectedOrderId(order.id)}
                  type="button"
                >
                  <span>
                    <strong>{shortId(order.id)}</strong>
                    <small>{order.error_message ?? order.status}</small>
                  </span>
                  <StatusBadge status={order.status} />
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="split-grid split-grid--even">
        <PaymentsRefunds refunds={data?.refunds ?? []} />
        <PaymentsDisputes disputes={data?.disputes ?? []} />
      </div>
    </section>
  );
}

function PaymentDetail({ order }: { order: PaymentOrder | null }) {
  if (!order) {
    return <p className="notice">暂无可查看的支付详情</p>;
  }

  return (
    <section className="detail-panel" aria-label="支付详情">
      <div className="detail-panel__header">
        <div>
          <h2>支付详情</h2>
          <p>{order.telegram_invoice_payload}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="detail-grid">
        <DetailItem label="订单 ID" value={order.id} />
        <DetailItem label="用户 ID" value={order.user_id} />
        <DetailItem label="业务" value={order.business_type} />
        <DetailItem label="业务 ID" value={order.business_id} />
        <DetailItem label="Stars" value={String(order.xtr_amount)} />
        <DetailItem label="过期时间" value={formatDate(order.expires_at)} />
        <DetailItem
          label="Pre-checkout"
          value={formatDate(order.precheckout_at)}
        />
        <DetailItem label="支付时间" value={formatDate(order.paid_at)} />
        <DetailItem label="发货时间" value={formatDate(order.fulfilled_at)} />
        <DetailItem label="更新时间" value={formatDate(order.updated_at)} />
      </div>
      <div className="detail-grid detail-grid--wide">
        <DetailItem label="标题" value={order.title} />
        <DetailItem label="描述" value={order.description} />
        <DetailItem label="错误" value={order.error_message} />
        <DetailItem
          label="支付流水"
          value={
            order.payment
              ? `${shortId(order.payment.id)} / ${order.payment.currency} ${order.payment.xtr_amount}`
              : "未记录"
          }
        />
      </div>
    </section>
  );
}

function WebhookEventRow({ event }: { event: WebhookEvent }) {
  return (
    <tr>
      <td>
        <strong>{event.update_id ?? "-"}</strong>
        <small>{formatDate(event.created_at)}</small>
      </td>
      <td>{event.event_type}</td>
      <td>
        <StatusBadge status={event.process_status} />
        <small>{formatDate(event.processed_at)}</small>
      </td>
      <td>{event.invoice_payload ?? "-"}</td>
      <td>
        {event.retry_count}
        <small>{formatDate(event.next_retry_at)}</small>
      </td>
      <td>
        <StatusBadge
          status={event.webhook_secret_verified ? "verified" : "unverified"}
        />
      </td>
      <td>{event.error_message ?? "-"}</td>
    </tr>
  );
}

function PaymentsRefunds({ refunds }: { refunds: PaymentRefund[] }) {
  return (
    <section>
      <h2>退款列表</h2>
      <div className="table-wrap table-wrap--small">
        <table>
          <thead>
            <tr>
              <th>退款</th>
              <th>状态</th>
              <th>Stars</th>
              <th>处理时间</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            {refunds.length === 0 ? (
              <tr>
                <td colSpan={5}>暂无退款记录</td>
              </tr>
            ) : (
              refunds.map((refund) => (
                <tr key={refund.id}>
                  <td>
                    <strong>{shortId(refund.id)}</strong>
                    <small>{shortId(refund.star_order_id)}</small>
                  </td>
                  <td>
                    <StatusBadge status={refund.status} />
                  </td>
                  <td>{Number(refund.xtr_amount)}</td>
                  <td>{formatDate(refund.processed_at)}</td>
                  <td>{refund.reason ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PaymentsDisputes({ disputes }: { disputes: PaymentDispute[] }) {
  return (
    <section>
      <h2>Dispute 列表</h2>
      <div className="table-wrap table-wrap--small">
        <table>
          <thead>
            <tr>
              <th>争议</th>
              <th>状态</th>
              <th>订单</th>
              <th>主题</th>
              <th>处理</th>
            </tr>
          </thead>
          <tbody>
            {disputes.length === 0 ? (
              <tr>
                <td colSpan={5}>暂无支付争议</td>
              </tr>
            ) : (
              disputes.map((dispute) => (
                <tr key={dispute.id}>
                  <td>
                    <strong>{shortId(dispute.id)}</strong>
                    <small>{formatDate(dispute.created_at)}</small>
                  </td>
                  <td>
                    <StatusBadge status={dispute.status} />
                  </td>
                  <td>
                    {dispute.star_order_id
                      ? shortId(dispute.star_order_id)
                      : "-"}
                  </td>
                  <td>
                    <strong>{dispute.subject}</strong>
                    <small>{dispute.message ?? "-"}</small>
                  </td>
                  <td>
                    {dispute.resolution ?? "-"}
                    <small>{formatDate(dispute.resolved_at)}</small>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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

function StatusStrip(props: {
  empty: boolean;
  error: string | null;
  loading: boolean;
  summary: Record<string, number>;
}) {
  if (props.error) {
    return <p className="notice notice--error">{props.error}</p>;
  }

  if (props.loading) {
    return <p className="notice">加载中...</p>;
  }

  if (props.empty) {
    return <p className="notice">暂无数据</p>;
  }

  return (
    <div className="metric-strip">
      {Object.entries(props.summary).map(([key, value]) => (
        <span key={key}>
          <strong>{value}</strong>
          <small>{key}</small>
        </span>
      ))}
    </div>
  );
}
