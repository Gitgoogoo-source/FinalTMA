import { ExternalLink, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AdminApiError, fetchPaymentDetail } from "../admin.api";
import type {
  PaymentDetailDiagnostic,
  PaymentDetailDrawOrder,
  PaymentDetailErrorContext,
  PaymentDetailItemInstance,
  PaymentDetailLedgerEntry,
  PaymentDetailOrder,
  PaymentDetailPayment,
  PaymentDetailResponse,
  PaymentDetailWebhookEvent,
  PaymentOrder,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";

type PaymentDetailSheetProps = {
  canViewDebug: boolean;
  fallbackOrder: PaymentOrder | null;
  starOrderId: string | null;
  onClose: () => void;
};

type PaymentDetailLoadError = {
  code: string;
  message: string;
  requestId: string | null;
  status: number | null;
};

type PaymentOrderRecord = PaymentDetailOrder | PaymentOrder;
type PaymentRecord =
  | PaymentDetailPayment
  | NonNullable<PaymentOrder["payment"]>;

export function PaymentDetailSheet(props: PaymentDetailSheetProps) {
  const [data, setData] = useState<PaymentDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PaymentDetailLoadError | null>(null);

  const loadDetail = useCallback(async () => {
    if (!props.starOrderId) {
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await fetchPaymentDetail(props.starOrderId);

      setData(response);
    } catch (loadError) {
      setError(normalizeLoadError(loadError));
    } finally {
      setLoading(false);
    }
  }, [props.starOrderId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (!props.starOrderId) {
    return null;
  }

  const order = data?.order ?? props.fallbackOrder;
  const payment = data?.payment ?? props.fallbackOrder?.payment ?? null;

  return (
    <div className="payment-detail-sheet-backdrop" role="presentation">
      <section
        aria-labelledby="payment-detail-title"
        aria-modal="true"
        className="payment-detail-sheet"
        role="dialog"
      >
        <header className="payment-detail-sheet__header">
          <div>
            <h2 id="payment-detail-title">支付详情</h2>
            <p>{order?.telegram_invoice_payload ?? props.starOrderId}</p>
          </div>
          <div className="payment-detail-sheet__actions">
            <button
              className="icon-button"
              disabled={loading}
              onClick={() => void loadDetail()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} />
              <span>{loading ? "加载中" : "刷新"}</span>
            </button>
            <button
              className="icon-only-button"
              onClick={props.onClose}
              title="关闭"
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
        </header>

        {loading ? <p className="notice">详情加载中...</p> : null}
        {error ? <LoadErrorNotice error={error} /> : null}

        {data ? <DiagnosticsSection diagnostics={data.diagnostics} /> : null}
        {order ? <OrderSection order={order} /> : null}
        <PaymentRecordSection payment={payment} />
        <UserSection user={data?.user ?? null} />
        <DrawOrderSection drawOrder={data?.drawOrder ?? null} />
        <DrawResultsTable items={data?.drawResults ?? []} />
        <ItemInstancesTable items={data?.itemInstances ?? []} />
        <LedgerTable items={data?.ledgerEntries ?? []} />
        <WebhookTimeline events={data?.webhookEvents ?? []} />
        <ErrorContextSection
          canViewDebug={props.canViewDebug}
          context={data?.errorContext ?? null}
          orderError={order?.error_message ?? null}
        />
      </section>
    </div>
  );
}

function DiagnosticsSection({
  diagnostics,
}: {
  diagnostics: PaymentDetailDiagnostic[];
}) {
  const sortedDiagnostics = [...diagnostics].sort(compareDiagnostics);

  return (
    <section className="payment-detail-section">
      <div className="payment-detail-section__title">
        <h3>异常诊断</h3>
        <span className="status-badge">{diagnostics.length}</span>
      </div>
      <div className="payment-detail-section__links">
        <a className="icon-button" href="#monitoring">
          <ExternalLink aria-hidden="true" size={14} />
          <span>对账 / 监控</span>
        </a>
        <a className="icon-button" href="#danger">
          <ExternalLink aria-hidden="true" size={14} />
          <span>风控处理</span>
        </a>
      </div>
      {sortedDiagnostics.length === 0 ? (
        <p className="muted">暂无异常诊断</p>
      ) : (
        <div className="table-wrap table-wrap--small">
          <table className="payment-diagnostics-table">
            <thead>
              <tr>
                <th>级别</th>
                <th>异常</th>
                <th>关联</th>
                <th>建议</th>
              </tr>
            </thead>
            <tbody>
              {sortedDiagnostics.map((diagnostic) => (
                <tr
                  className={`payment-diagnostics-row payment-diagnostics-row--${diagnostic.severity}`}
                  key={`${diagnostic.code}:${diagnostic.related_id ?? "none"}`}
                >
                  <td>
                    <StatusBadge status={diagnostic.severity} />
                  </td>
                  <td>
                    <strong>{diagnostic.code}</strong>
                    <small>{diagnostic.message}</small>
                  </td>
                  <td>
                    {diagnostic.related_id
                      ? shortId(diagnostic.related_id)
                      : "-"}
                  </td>
                  <td>{diagnostic.suggested_action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OrderSection({ order }: { order: PaymentOrderRecord }) {
  return (
    <section className="payment-detail-section">
      <div className="payment-detail-section__title">
        <h3>订单</h3>
        <StatusBadge status={order.status} />
      </div>
      <div className="detail-grid">
        <DetailItem label="订单 ID" value={order.id} />
        <DetailItem label="用户 ID" value={order.user_id} />
        <DetailItem label="业务" value={order.business_type} />
        <DetailItem label="业务 ID" value={order.business_id} />
        <DetailItem label="Stars" value={order.xtr_amount} />
        <DetailItem label="幂等键" value={readOrderIdempotencyKey(order)} />
        <DetailItem label="创建时间" value={formatDate(order.created_at)} />
        <DetailItem label="更新时间" value={formatDate(order.updated_at)} />
        <DetailItem label="过期时间" value={formatDate(order.expires_at)} />
        <DetailItem
          label="Pre-checkout"
          value={formatDate(order.precheckout_at)}
        />
        <DetailItem label="支付时间" value={formatDate(order.paid_at)} />
        <DetailItem label="发货时间" value={formatDate(order.fulfilled_at)} />
      </div>
      <div className="detail-grid detail-grid--wide">
        <DetailItem label="标题" value={order.title} />
        <DetailItem label="描述" value={order.description} />
        <DetailItem
          label="Invoice payload"
          value={order.telegram_invoice_payload}
        />
        <DetailItem label="错误" value={order.error_message} />
      </div>
    </section>
  );
}

function PaymentRecordSection({ payment }: { payment: PaymentRecord | null }) {
  return (
    <section className="payment-detail-section">
      <div className="payment-detail-section__title">
        <h3>Star 支付</h3>
      </div>
      {payment ? (
        <div className="detail-grid">
          <DetailItem label="支付 ID" value={payment.id} />
          <DetailItem label="订单 ID" value={payment.star_order_id ?? null} />
          <DetailItem label="用户 ID" value={payment.user_id ?? null} />
          <DetailItem
            label="金额"
            value={`${payment.currency} ${payment.xtr_amount}`}
          />
          <DetailItem
            label="Invoice payload"
            value={payment.invoice_payload ?? null}
          />
          <DetailItem
            label="Telegram charge"
            value={readPaymentField(payment, "telegram_payment_charge_id")}
          />
          <DetailItem
            label="Provider charge"
            value={readPaymentField(payment, "provider_payment_charge_id")}
          />
          <DetailItem label="支付时间" value={formatDate(payment.paid_at)} />
        </div>
      ) : (
        <p className="muted">未记录 Star 支付流水</p>
      )}
    </section>
  );
}

function UserSection({ user }: { user: PaymentDetailResponse["user"] | null }) {
  return (
    <section className="payment-detail-section">
      <div className="payment-detail-section__title">
        <h3>用户</h3>
      </div>
      {user ? (
        <div className="detail-grid">
          <DetailItem label="用户 ID" value={user.id} />
          <DetailItem label="Telegram ID" value={user.telegram_user_id} />
          <DetailItem label="Username" value={user.username} />
          <DetailItem label="状态" value={user.status} />
          <DetailItem label="风险分" value={user.risk_score} />
          <DetailItem
            label="姓名"
            value={[user.first_name, user.last_name].filter(Boolean).join(" ")}
          />
          <DetailItem label="最后活跃" value={formatDate(user.last_seen_at)} />
          <DetailItem label="最后认证" value={formatDate(user.last_auth_at)} />
        </div>
      ) : (
        <p className="muted">未返回用户记录</p>
      )}
    </section>
  );
}

function DrawOrderSection({
  drawOrder,
}: {
  drawOrder: PaymentDetailDrawOrder | null;
}) {
  return (
    <section className="payment-detail-section">
      <div className="payment-detail-section__title">
        <h3>Draw order</h3>
        {drawOrder ? <StatusBadge status={drawOrder.status} /> : null}
      </div>
      {drawOrder ? (
        <>
          <div className="detail-grid">
            <DetailItem label="Draw order ID" value={drawOrder.id} />
            <DetailItem label="Box ID" value={drawOrder.box_id} />
            <DetailItem
              label="Pool version"
              value={drawOrder.pool_version_id}
            />
            <DetailItem label="数量" value={drawOrder.quantity} />
            <DetailItem label="抽取次数" value={drawOrder.draw_count} />
            <DetailItem label="单价" value={drawOrder.unit_price_stars} />
            <DetailItem label="折扣 bps" value={drawOrder.discount_bps} />
            <DetailItem label="总价" value={drawOrder.total_price_stars} />
            <DetailItem label="支付渠道" value={drawOrder.payment_provider} />
            <DetailItem label="支付状态" value={drawOrder.payment_status} />
            <DetailItem
              label="支付时间"
              value={formatDate(drawOrder.paid_at)}
            />
            <DetailItem
              label="开盒时间"
              value={formatDate(drawOrder.opened_at)}
            />
          </div>
          <div className="detail-grid detail-grid--wide">
            <DetailItem
              label="Invoice payload"
              value={drawOrder.invoice_payload}
            />
            <DetailItem
              label="Telegram charge"
              value={drawOrder.telegram_payment_charge_id}
            />
            <DetailItem
              label="KCOIN 返还"
              value={drawOrder.open_reward_kcoin}
            />
            <DetailItem label="错误" value={drawOrder.error_message} />
          </div>
        </>
      ) : (
        <p className="muted">未返回 draw_order</p>
      )}
    </section>
  );
}

function DrawResultsTable({
  items,
}: {
  items: PaymentDetailResponse["drawResults"];
}) {
  return (
    <section className="payment-detail-section">
      <div className="payment-detail-section__title">
        <h3>Draw results</h3>
        <span className="status-badge">{items.length}</span>
      </div>
      <div className="table-wrap table-wrap--small">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>结果</th>
              <th>藏品</th>
              <th>随机</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <EmptyTableRow colSpan={5} label="暂无 draw_results" />
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>{item.draw_index}</td>
                  <td>
                    <strong>{item.rarity_code}</strong>
                    <small>{item.was_pity ? "pity" : "normal"}</small>
                  </td>
                  <td>
                    <strong>{shortId(item.template_id)}</strong>
                    <small>
                      {item.item_instance_id
                        ? shortId(item.item_instance_id)
                        : "-"}
                    </small>
                  </td>
                  <td>
                    {formatNullable(item.random_roll)}
                    <small>
                      {item.drop_pool_item_id
                        ? shortId(item.drop_pool_item_id)
                        : "-"}
                    </small>
                  </td>
                  <td>{formatDate(item.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ItemInstancesTable({ items }: { items: PaymentDetailItemInstance[] }) {
  return (
    <section className="payment-detail-section">
      <div className="payment-detail-section__title">
        <h3>库存摘要</h3>
        <span className="status-badge">{items.length}</span>
      </div>
      <div className="table-wrap table-wrap--small">
        <table>
          <thead>
            <tr>
              <th>实例</th>
              <th>状态</th>
              <th>属性</th>
              <th>来源</th>
              <th>Mint</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <EmptyTableRow colSpan={5} label="暂无 item_instances" />
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{shortId(item.id)}</strong>
                    <small>#{item.serial_no}</small>
                  </td>
                  <td>
                    <StatusBadge status={item.status} />
                    <small>{formatDate(item.acquired_at)}</small>
                  </td>
                  <td>
                    Lv.{item.level} / Power {item.power}
                    <small>{shortId(item.template_id)}</small>
                  </td>
                  <td>
                    {item.source_type}
                    <small>
                      {item.source_id ? shortId(item.source_id) : "-"}
                    </small>
                  </td>
                  <td>
                    <StatusBadge status={item.nft_mint_status} />
                    <small>
                      {item.minted_nft_item_id
                        ? shortId(item.minted_nft_item_id)
                        : "-"}
                    </small>
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

function LedgerTable({ items }: { items: PaymentDetailLedgerEntry[] }) {
  return (
    <section className="payment-detail-section">
      <div className="payment-detail-section__title">
        <h3>Ledger</h3>
        <span className="status-badge">{items.length}</span>
      </div>
      <div className="table-wrap table-wrap--small">
        <table>
          <thead>
            <tr>
              <th>流水</th>
              <th>类型</th>
              <th>金额</th>
              <th>余额</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <EmptyTableRow colSpan={5} label="暂无 ledger" />
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{shortId(item.id)}</strong>
                    <small>{formatDate(item.created_at)}</small>
                  </td>
                  <td>
                    <StatusBadge status={item.entry_type} />
                    <small>{item.currency_code}</small>
                  </td>
                  <td>{formatNullable(item.amount)}</td>
                  <td>
                    {formatNullable(item.available_before)} {"->"}{" "}
                    {formatNullable(item.available_after)}
                    <small>
                      locked {formatNullable(item.locked_before)} {"->"}{" "}
                      {formatNullable(item.locked_after)}
                    </small>
                  </td>
                  <td>
                    {item.source_type}
                    <small>
                      {item.source_id
                        ? shortId(item.source_id)
                        : (item.source_ref ?? "-")}
                    </small>
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

function WebhookTimeline({ events }: { events: PaymentDetailWebhookEvent[] }) {
  return (
    <section className="payment-detail-section">
      <div className="payment-detail-section__title">
        <h3>Webhook events</h3>
        <span className="status-badge">{events.length}</span>
      </div>
      <div className="table-wrap table-wrap--small">
        <table>
          <thead>
            <tr>
              <th>Update</th>
              <th>类型</th>
              <th>状态</th>
              <th>重试</th>
              <th>校验</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <EmptyTableRow colSpan={6} label="暂无 webhook events" />
            ) : (
              events.map((event) => (
                <tr key={event.id}>
                  <td>
                    <strong>{event.update_id ?? "-"}</strong>
                    <small>{formatDate(event.created_at)}</small>
                  </td>
                  <td>
                    {event.event_type}
                    <small>{event.invoice_payload ?? "-"}</small>
                  </td>
                  <td>
                    <StatusBadge status={event.process_status} />
                    <small>{formatDate(event.processed_at)}</small>
                  </td>
                  <td>
                    {event.retry_count}
                    <small>{formatDate(event.next_retry_at)}</small>
                  </td>
                  <td>
                    <StatusBadge
                      status={
                        event.webhook_secret_verified
                          ? "verified"
                          : "unverified"
                      }
                    />
                  </td>
                  <td>{event.error_message ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ErrorContextSection(props: {
  canViewDebug: boolean;
  context: PaymentDetailErrorContext | null;
  orderError: string | null;
}) {
  const stack = props.context?.errorStack ?? props.context?.stack ?? null;

  if (!props.context && !props.orderError) {
    return null;
  }

  return (
    <section className="payment-detail-section">
      <div className="payment-detail-section__title">
        <h3>错误上下文</h3>
      </div>
      <div className="detail-grid detail-grid--wide">
        <DetailItem label="错误码" value={props.context?.code} />
        <DetailItem label="Request ID" value={props.context?.requestId} />
        <DetailItem
          label="错误信息"
          value={props.context?.message ?? props.orderError}
        />
        <DetailItem label="订单错误" value={props.orderError} />
      </div>
      {props.canViewDebug && stack ? (
        <pre className="payment-detail-json">{stack}</pre>
      ) : null}
      {props.canViewDebug && props.context?.raw ? (
        <pre className="payment-detail-json">
          {stringifyJson(props.context.raw)}
        </pre>
      ) : null}
    </section>
  );
}

function LoadErrorNotice({ error }: { error: PaymentDetailLoadError }) {
  return (
    <p className="notice notice--error">
      {error.message} ({error.code}
      {error.requestId ? ` / requestId: ${error.requestId}` : ""})
    </p>
  );
}

function DetailItem(props: {
  label: string;
  value: boolean | number | string | null | undefined;
}) {
  return (
    <span>
      <small>{props.label}</small>
      <strong>{formatNullable(props.value)}</strong>
    </span>
  );
}

function EmptyTableRow(props: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={props.colSpan}>{props.label}</td>
    </tr>
  );
}

function normalizeLoadError(error: unknown): PaymentDetailLoadError {
  if (error instanceof AdminApiError) {
    return {
      code: error.code,
      message: error.message,
      requestId: error.requestId ?? null,
      status: error.status,
    };
  }

  return {
    code: "ADMIN_PAYMENT_DETAIL_LOAD_FAILED",
    message: error instanceof Error ? error.message : "支付详情加载失败",
    requestId: null,
    status: null,
  };
}

function readOrderIdempotencyKey(order: PaymentOrderRecord): string | null {
  return "idempotency_key" in order ? order.idempotency_key : null;
}

function readPaymentField(
  payment: PaymentRecord,
  field: "provider_payment_charge_id" | "telegram_payment_charge_id",
): string | null {
  if (
    field === "telegram_payment_charge_id" &&
    "telegram_payment_charge_id" in payment
  ) {
    return payment.telegram_payment_charge_id;
  }

  if (
    field === "provider_payment_charge_id" &&
    "provider_payment_charge_id" in payment
  ) {
    return payment.provider_payment_charge_id;
  }

  return null;
}

function formatNullable(
  value: boolean | number | string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

const DIAGNOSTIC_SEVERITY_ORDER: Record<
  PaymentDetailDiagnostic["severity"],
  number
> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function compareDiagnostics(
  left: PaymentDetailDiagnostic,
  right: PaymentDetailDiagnostic,
): number {
  const severityDelta =
    DIAGNOSTIC_SEVERITY_ORDER[left.severity] -
    DIAGNOSTIC_SEVERITY_ORDER[right.severity];

  if (severityDelta !== 0) {
    return severityDelta;
  }

  return left.code.localeCompare(right.code);
}
