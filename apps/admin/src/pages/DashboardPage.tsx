import { AlertTriangle, RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchMonitoring, updatePaymentSupportConfig } from "../admin.api";
import type {
  MonitoringCountMetric,
  MonitoringException,
  MonitoringLatencyMetric,
  MonitoringRateMetric,
  MonitoringResponse,
  PaymentSupportConfig,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";

type Metric =
  | MonitoringRateMetric
  | MonitoringLatencyMetric
  | MonitoringCountMetric;

export function DashboardPage() {
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [windowHours, setWindowHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [supportUrlDraft, setSupportUrlDraft] = useState("");
  const [supportEmailDraft, setSupportEmailDraft] = useState("");
  const [supportReason, setSupportReason] = useState("");
  const [supportSaving, setSupportSaving] = useState(false);
  const [supportMessage, setSupportMessage] = useState<string | null>(null);
  const [supportError, setSupportError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchMonitoring({
        windowHours,
      });

      setData(response);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "监控数据加载失败",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [windowHours]);

  useEffect(() => {
    if (!data?.paymentSupport) {
      return;
    }

    setSupportUrlDraft(data.paymentSupport.supportUrl ?? "");
    setSupportEmailDraft(data.paymentSupport.supportEmail ?? "");
  }, [data?.paymentSupport]);

  async function savePaymentSupportConfig() {
    const reason = supportReason.trim();

    if (!reason) {
      setSupportError("保存支付客服入口必须填写 reason");
      return;
    }

    setSupportSaving(true);
    setSupportError(null);
    setSupportMessage(null);

    try {
      const updated = await updatePaymentSupportConfig({
        supportUrl: normalizeDraftValue(supportUrlDraft),
        supportEmail: normalizeDraftValue(supportEmailDraft),
        reason,
      });

      setData((current) =>
        current
          ? {
              ...current,
              paymentSupport: {
                configured: updated.configured,
                source: updated.source,
                supportEmail: updated.supportEmail,
                supportUrl: updated.supportUrl,
                updatedAt: updated.updatedAt,
              },
              warnings: updated.configured
                ? current.warnings.filter(
                    (warning) =>
                      warning.code !== "PAYMENT_SUPPORT_CONFIG_MISSING",
                  )
                : ensurePaymentSupportWarning(current.warnings),
            }
          : current,
      );
      setSupportReason("");
      setSupportMessage(
        updated.audit_log_id
          ? `已保存，audit ${updated.audit_log_id}`
          : "已保存",
      );
    } catch (saveError) {
      setSupportError(
        saveError instanceof Error ? saveError.message : "支付客服入口保存失败",
      );
    } finally {
      setSupportSaving(false);
    }
  }

  const metrics = data
    ? [
        data.metrics.paymentFailureRate,
        data.metrics.fulfillmentFailureRate,
        data.metrics.webhookLatency,
        data.metrics.mintStuckCount,
      ]
    : [];

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label>
          <span>观察窗口</span>
          <select
            value={windowHours}
            onChange={(event) => setWindowHours(Number(event.target.value))}
          >
            <option value={1}>1 小时</option>
            <option value={6}>6 小时</option>
            <option value={24}>24 小时</option>
            <option value={72}>72 小时</option>
            <option value={168}>7 天</option>
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
      {loading ? <p className="notice">加载中...</p> : null}

      {data ? (
        <>
          {data.warnings.map((warning) => (
            <p
              className="notice notice--warning admin-warning"
              key={warning.code}
            >
              <AlertTriangle aria-hidden="true" size={16} />
              <span>
                <strong>{warning.message}</strong>
                <small>{warning.suggestedAction}</small>
              </span>
            </p>
          ))}

          <div className="ops-grid ops-grid--monitoring">
            {metrics.map((metric) => (
              <MetricCard key={metric.key} metric={metric} />
            ))}
          </div>

          <section className="detail-panel" aria-label="监控窗口">
            <div className="detail-panel__header">
              <div>
                <h2>监控窗口</h2>
                <p>
                  {formatDate(data.window.startedAt)} 至{" "}
                  {formatDate(data.window.endedAt)}
                </p>
              </div>
              <StatusBadge status={overallStatus(metrics)} />
            </div>
            <div className="detail-grid">
              <DetailItem
                label="Webhook 卡住阈值"
                value={`${data.thresholds.webhookStuckMinutes} 分钟`}
              />
              <DetailItem
                label="发货卡住阈值"
                value={`${data.thresholds.fulfillmentStuckMinutes} 分钟`}
              />
              <DetailItem
                label="Mint 卡住阈值"
                value={`${data.thresholds.mintStuckMinutes} 分钟`}
              />
              <DetailItem
                label="单次查询上限"
                value={String(data.sources.limitPerQuery)}
              />
            </div>
          </section>

          <PaymentSupportConfigPanel
            config={data.paymentSupport}
            emailDraft={supportEmailDraft}
            error={supportError}
            isSaving={supportSaving}
            message={supportMessage}
            reason={supportReason}
            urlDraft={supportUrlDraft}
            onEmailChange={setSupportEmailDraft}
            onReasonChange={setSupportReason}
            onSave={() => void savePaymentSupportConfig()}
            onUrlChange={setSupportUrlDraft}
          />

          <div className="split-grid split-grid--even">
            <ExceptionList
              items={data.recentExceptions.paymentOrders}
              title="支付 / 发货异常"
            />
            <ExceptionList
              items={data.recentExceptions.webhookEvents}
              title="Webhook 异常"
            />
          </div>
          <ExceptionList
            items={data.recentExceptions.mintQueue}
            title="Mint 队列异常"
          />
        </>
      ) : null}
    </section>
  );
}

function PaymentSupportConfigPanel(props: {
  config: PaymentSupportConfig;
  emailDraft: string;
  error: string | null;
  isSaving: boolean;
  message: string | null;
  reason: string;
  urlDraft: string;
  onEmailChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onSave: () => void;
  onUrlChange: (value: string) => void;
}) {
  return (
    <section className="detail-panel" aria-label="支付客服入口">
      <div className="detail-panel__header">
        <div>
          <h2>支付客服入口</h2>
          <p>
            PAYMENT_SUPPORT_CONFIG
            控制用户支付失败和发货补偿页面展示的客服入口。
          </p>
        </div>
        <StatusBadge status={props.config.configured ? "ok" : "warning"} />
      </div>
      <div className="detail-grid">
        <DetailItem
          label="当前状态"
          value={props.config.configured ? "已配置" : "未配置"}
        />
        <DetailItem label="来源" value={props.config.source} />
        <DetailItem
          label="更新时间"
          value={formatDate(props.config.updatedAt)}
        />
        <DetailItem
          label="展示入口"
          value={formatSupportPreview(props.config)}
        />
      </div>
      <div className="form-grid form-grid--compact payment-support-form">
        <label className="form-grid__wide">
          <span>客服 URL</span>
          <input
            placeholder="https://t.me/support_username"
            type="url"
            value={props.urlDraft}
            onChange={(event) => props.onUrlChange(event.target.value)}
          />
        </label>
        <label className="form-grid__wide">
          <span>客服 email</span>
          <input
            placeholder="support@example.com"
            type="email"
            value={props.emailDraft}
            onChange={(event) => props.onEmailChange(event.target.value)}
          />
        </label>
        <label className="form-grid__wide">
          <span>Reason</span>
          <textarea
            placeholder="说明本次支付客服入口配置变更原因"
            value={props.reason}
            onChange={(event) => props.onReasonChange(event.target.value)}
          />
        </label>
      </div>
      {props.error ? (
        <p className="notice notice--error">{props.error}</p>
      ) : null}
      {props.message ? <p className="notice">{props.message}</p> : null}
      <div className="button-row">
        <button
          className="icon-button"
          disabled={props.isSaving}
          onClick={props.onSave}
          type="button"
        >
          <Save aria-hidden="true" size={16} />
          <span>{props.isSaving ? "保存中" : "保存客服入口"}</span>
        </button>
      </div>
    </section>
  );
}

function MetricCard({ metric }: { metric: Metric }) {
  return (
    <section className="ops-card metric-card">
      <div className="metric-card__header">
        <h2>{metric.label}</h2>
        <StatusBadge status={metric.status} />
      </div>
      <strong className="metric-card__value">
        {formatMetricValue(metric)}
      </strong>
      <p>{metric.description}</p>
      <div className="metric-card__meta">{renderMetricMeta(metric)}</div>
    </section>
  );
}

function ExceptionList(props: { items: MonitoringException[]; title: string }) {
  return (
    <section className="ops-card">
      <h2>{props.title}</h2>
      <div className="stack-list stack-list--spaced">
        {props.items.length === 0 ? (
          <p className="muted">暂无异常</p>
        ) : (
          props.items.map((item) => (
            <div className="list-row" key={`${props.title}:${item.id}`}>
              <span>
                <strong>{shortId(item.id)}</strong>
                <small>{buildExceptionSummary(item)}</small>
              </span>
              <StatusBadge
                status={item.status ?? item.processStatus ?? "unknown"}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function DetailItem(props: { label: string; value: string }) {
  return (
    <span>
      <small>{props.label}</small>
      <strong>{props.value}</strong>
    </span>
  );
}

function normalizeDraftValue(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function formatSupportPreview(config: PaymentSupportConfig): string {
  if (!config.configured) {
    return "-";
  }

  return [config.supportUrl, config.supportEmail].filter(Boolean).join(" / ");
}

function ensurePaymentSupportWarning(
  warnings: MonitoringResponse["warnings"],
): MonitoringResponse["warnings"] {
  if (
    warnings.some(
      (warning) => warning.code === "PAYMENT_SUPPORT_CONFIG_MISSING",
    )
  ) {
    return warnings;
  }

  return [
    ...warnings,
    {
      code: "PAYMENT_SUPPORT_CONFIG_MISSING",
      severity: "warning",
      message: "支付客服入口未配置，支付失败页不会展示客服入口。",
      suggestedAction: "在监控页配置 PAYMENT_SUPPORT_CONFIG 的 URL 或 email。",
    },
  ];
}

function formatMetricValue(metric: Metric): string {
  if (metric.unit === "percent") {
    return `${(metric.value * 100).toFixed(2)}%`;
  }

  if (metric.unit === "milliseconds") {
    return metric.value === null ? "-" : `${formatMilliseconds(metric.value)}`;
  }

  return String(metric.value);
}

function renderMetricMeta(metric: Metric) {
  if (metric.unit === "percent") {
    return (
      <>
        <span>
          <small>异常数</small>
          <strong>{metric.numerator}</strong>
        </span>
        <span>
          <small>样本数</small>
          <strong>{metric.denominator}</strong>
        </span>
        {metric.stuckCount !== undefined ? (
          <span>
            <small>卡住</small>
            <strong>{metric.stuckCount}</strong>
          </span>
        ) : null}
      </>
    );
  }

  if (metric.unit === "milliseconds") {
    return (
      <>
        <span>
          <small>平均</small>
          <strong>{formatNullableMilliseconds(metric.averageMs)}</strong>
        </span>
        <span>
          <small>最大</small>
          <strong>{formatNullableMilliseconds(metric.maxMs)}</strong>
        </span>
        <span>
          <small>未完成</small>
          <strong>{metric.pendingCount}</strong>
        </span>
        <span>
          <small>卡住</small>
          <strong>{metric.stuckCount}</strong>
        </span>
      </>
    );
  }

  return (
    <>
      <span>
        <small>活跃队列</small>
        <strong>{metric.activeCount}</strong>
      </span>
      <span>
        <small>卡住</small>
        <strong>{metric.stuckCount}</strong>
      </span>
    </>
  );
}

function buildExceptionSummary(item: MonitoringException): string {
  const status = item.status ?? item.processStatus ?? item.eventType ?? "-";
  const created = formatDate(item.createdAt);
  const error = item.errorMessage ? ` / ${item.errorMessage}` : "";
  const attempts =
    item.attemptCount !== undefined && item.maxAttempts !== undefined
      ? ` / ${item.attemptCount}/${item.maxAttempts}`
      : "";

  return `${status}${attempts} / ${created}${error}`;
}

function overallStatus(metrics: Metric[]): "ok" | "warning" | "critical" {
  if (metrics.some((metric) => metric.status === "critical")) {
    return "critical";
  }

  if (metrics.some((metric) => metric.status === "warning")) {
    return "warning";
  }

  return "ok";
}

function formatNullableMilliseconds(value: number | null): string {
  return value === null ? "-" : formatMilliseconds(value);
}

function formatMilliseconds(value: number): string {
  if (value >= 60_000) {
    return `${(value / 60_000).toFixed(1)}m`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }

  return `${value}ms`;
}
