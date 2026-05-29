import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchMonitoring } from "../admin.api";
import type {
  MonitoringCountMetric,
  MonitoringException,
  MonitoringLatencyMetric,
  MonitoringRateMetric,
  MonitoringResponse,
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
