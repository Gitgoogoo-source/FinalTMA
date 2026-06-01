import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ExternalLink,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import type {
  BusinessMonitoringResponse,
  EconomyMonitoringResponse,
  GachaMonitoringResponse,
  MarketMonitoringResponse,
  MonitoringAlert,
  MonitoringCountMetric,
  MonitoringDomainResponse,
  MonitoringException,
  MonitoringGenericMetric,
  MonitoringLatencyMetric,
  MonitoringMetricCollection,
  MonitoringRateMetric,
  MonitoringResponse,
  MonitoringStatus,
  UpdateAdminAlertStatusInput,
} from "../../admin.types";
import { formatDate, shortId, StatusBadge } from "../../admin.ui";

export type PanelState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

type LegacyMetric =
  | MonitoringRateMetric
  | MonitoringLatencyMetric
  | MonitoringCountMetric;
type Metric = LegacyMetric | MonitoringGenericMetric;
type AlertSource = {
  label: string;
  state: PanelState<unknown>;
};
type AlertListResponse = {
  items?: MonitoringAlert[];
};
type AlertActionMode = "acknowledged" | "resolved" | "ignored";

const ACTIVE_ALERT_STATUSES = new Set(["open", "acknowledged"]);

export function PaymentMetricsPanel({
  state,
}: {
  state: PanelState<MonitoringResponse>;
}) {
  const data = state.data;
  const metrics: LegacyMetric[] = data
    ? [
        data.metrics.paymentFailureRate,
        data.metrics.fulfillmentFailureRate,
        data.metrics.webhookLatency,
        data.metrics.mintStuckCount,
      ]
    : [];

  return (
    <section
      className="dashboard-panel"
      aria-label="支付 / Webhook / Mint 监控"
    >
      <PanelHeader
        description="保留 Phase 5 支付失败率、发货失败率、webhook 延迟和 Mint 卡住数量。"
        status={metrics.length > 0 ? overallStatus(metrics) : undefined}
        title="支付 / Webhook / Mint"
      />
      <PanelStateNotice
        empty={!data || metrics.length === 0}
        emptyText="暂无支付、webhook 或 Mint 监控指标。"
        error={state.error}
        loading={state.loading}
      />
      {data && !state.error ? (
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
                value={String(data.sources.limitPerQuery ?? "-")}
              />
            </div>
          </section>

          <div className="split-grid split-grid--even">
            <ExceptionList
              defaultSourceType="star_order"
              items={data.recentExceptions.paymentOrders}
              title="支付 / 发货异常"
            />
            <ExceptionList
              items={data.recentExceptions.webhookEvents}
              title="Webhook 异常"
            />
          </div>
          <ExceptionList
            defaultSourceType="mint_queue"
            items={data.recentExceptions.mintQueue}
            title="Mint 队列异常"
          />
        </>
      ) : null}
    </section>
  );
}

export function GachaMetricsPanel({
  state,
}: {
  state: PanelState<GachaMonitoringResponse>;
}) {
  return (
    <DomainMetricsPanel
      description="开盒订单、抽卡失败、库存消耗和稀有度维度聚合。"
      emptyText="暂无开盒监控指标。"
      state={state}
      title="开盒监控"
    />
  );
}

export function MarketMetricsPanel({
  state,
}: {
  state: PanelState<MarketMonitoringResponse>;
}) {
  return (
    <DomainMetricsPanel
      defaultSourceType="market_listing"
      description="市场成交、活跃挂单和价格健康摘要。"
      emptyText="暂无市场监控指标。"
      state={state}
      title="市场监控"
    />
  );
}

export function EconomyMetricsPanel({
  state,
}: {
  state: PanelState<EconomyMonitoringResponse>;
}) {
  return (
    <DomainMetricsPanel
      description="K-coin、Fgems、任务奖励和账本对账聚合，不展示用户级 ledger 明细。"
      emptyText="暂无经济监控指标。"
      state={state}
      title="经济监控"
    />
  );
}

export function BusinessMetricsPanel({
  state,
}: {
  state: PanelState<BusinessMonitoringResponse>;
}) {
  return (
    <DomainMetricsPanel
      description="GMV、支付成功率、邀请转化、Mint 成功率和 API 错误聚合。"
      emptyText="暂无商业总览指标。"
      state={state}
      title="商业总览"
    />
  );
}

export function AlertPanel({
  alertsState,
  onAlertAction,
  sources,
}: {
  alertsState: PanelState<AlertListResponse>;
  onAlertAction?: (input: UpdateAdminAlertStatusInput) => Promise<void>;
  sources: AlertSource[];
}) {
  const explicitAlerts = alertsState.data?.items?.filter(isActiveAlert) ?? [];
  const embeddedAlerts = sources.flatMap(({ state }) =>
    readActiveAlerts(state.data),
  );
  const alerts = explicitAlerts.length > 0 ? explicitAlerts : embeddedAlerts;
  const loading =
    alertsState.loading || sources.some(({ state }) => state.loading);
  const errors = [
    ...(alertsState.error
      ? [{ label: "告警列表", state: alertsState as PanelState<unknown> }]
      : []),
    ...sources.filter(({ state }) => state.error),
  ];
  const allFailed =
    !alertsState.loading &&
    Boolean(alertsState.error) &&
    sources.every(({ state }) => !state.loading && Boolean(state.error));

  return (
    <section className="dashboard-panel" aria-label="业务告警">
      <PanelHeader
        description="Dashboard 只展示 open / acknowledged 未关闭告警。"
        status={alerts.length > 0 ? overallAlertStatus(alerts) : undefined}
        title="告警"
      />
      {loading ? <p className="notice">告警加载中...</p> : null}
      {allFailed ? (
        <p className="notice notice--error">告警来源全部加载失败。</p>
      ) : null}
      {!allFailed && errors.length > 0 ? (
        <div className="stack-list">
          {errors.map(({ label, state }) => (
            <p className="notice notice--warning" key={label}>
              {label} 告警来源加载失败：{state.error}
            </p>
          ))}
        </div>
      ) : null}
      {!loading && !allFailed && alerts.length === 0 ? (
        <p className="notice">暂无 open / acknowledged 告警。</p>
      ) : null}
      {alerts.length > 0 ? (
        <div className="stack-list stack-list--spaced">
          {alerts.map((alert) => (
            <AlertRow
              alert={alert}
              key={alert.id}
              {...(onAlertAction ? { onAlertAction } : {})}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DomainMetricsPanel({
  defaultSourceType,
  description,
  emptyText,
  state,
  title,
}: {
  defaultSourceType?: string | undefined;
  description: string;
  emptyText: string;
  state: PanelState<MonitoringDomainResponse>;
  title: string;
}) {
  const data = state.data;
  const metrics = metricsFromResponse(data);
  const exceptions = data ? exceptionsFromResponse(data) : [];
  const summary = data?.summary ? Object.entries(data.summary) : [];

  return (
    <section className="dashboard-panel" aria-label={title}>
      <PanelHeader
        description={description}
        status={metrics.length > 0 ? overallStatus(metrics) : undefined}
        title={title}
      />
      <PanelStateNotice
        empty={!data || (metrics.length === 0 && exceptions.length === 0)}
        emptyText={emptyText}
        error={state.error}
        loading={state.loading}
      />
      {data && !state.error ? (
        <>
          {data.warnings?.map((warning) => (
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
          {metrics.length > 0 ? (
            <div className="ops-grid ops-grid--monitoring">
              {metrics.map((metric) => (
                <MetricCard key={metric.key} metric={metric} />
              ))}
            </div>
          ) : null}
          {summary.length > 0 ? (
            <section className="detail-panel" aria-label={`${title}摘要`}>
              <div className="detail-panel__header">
                <div>
                  <h2>摘要</h2>
                  <p>
                    {formatDate(data.window.startedAt)} 至{" "}
                    {formatDate(data.window.endedAt)}
                  </p>
                </div>
                <StatusBadge status={overallStatus(metrics)} />
              </div>
              <div className="detail-grid">
                {summary.slice(0, 8).map(([key, value]) => (
                  <DetailItem
                    key={key}
                    label={formatMetricLabel(key)}
                    value={formatUnknownValue(value)}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {exceptions.length > 0 ? (
            <ExceptionList
              defaultSourceType={defaultSourceType}
              items={exceptions}
              title={`${title}异常项`}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function PanelHeader({
  description,
  status,
  title,
}: {
  description: string;
  status: MonitoringStatus | undefined;
  title: string;
}) {
  return (
    <div className="dashboard-panel__header">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {status ? <StatusBadge status={status} /> : null}
    </div>
  );
}

function PanelStateNotice({
  empty,
  emptyText,
  error,
  loading,
}: {
  empty: boolean;
  emptyText: string;
  error: string | null;
  loading: boolean;
}) {
  if (loading) {
    return <p className="notice">加载中...</p>;
  }

  if (error) {
    return <p className="notice notice--error">{error}</p>;
  }

  if (empty) {
    return <p className="notice">{emptyText}</p>;
  }

  return null;
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
      <p>{metric.description ?? "-"}</p>
      <div className="metric-card__meta">{renderMetricMeta(metric)}</div>
    </section>
  );
}

function ExceptionList(props: {
  defaultSourceType?: string | undefined;
  items: MonitoringException[];
  title: string;
}) {
  return (
    <section className="ops-card">
      <h2>{props.title}</h2>
      <div className="stack-list stack-list--spaced">
        {props.items.length === 0 ? (
          <p className="muted">暂无异常</p>
        ) : (
          props.items.map((item) => (
            <ExceptionRow
              defaultSourceType={props.defaultSourceType}
              item={item}
              key={`${props.title}:${item.id}`}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ExceptionRow({
  defaultSourceType,
  item,
}: {
  defaultSourceType?: string | undefined;
  item: MonitoringException;
}) {
  const sourceType = item.sourceType ?? item.source_type ?? defaultSourceType;
  const sourceId = item.sourceId ?? item.source_id ?? item.id;
  const link = buildMonitoringSourceLink(sourceType, sourceId);

  return (
    <div className="list-row">
      <span>
        <strong>{item.title ?? item.message ?? shortId(item.id)}</strong>
        <small>{buildExceptionSummary(item)}</small>
      </span>
      <span className="list-row__actions">
        {link ? (
          <a className="text-button text-button--with-icon" href={link.href}>
            <span>{link.label}</span>
            <ExternalLink aria-hidden="true" size={14} />
          </a>
        ) : (
          <small>{sourceType ? `${sourceType}:${sourceId}` : "无跳转"}</small>
        )}
        <StatusBadge status={item.status ?? item.processStatus ?? "unknown"} />
      </span>
    </div>
  );
}

function AlertRow({
  alert,
  onAlertAction,
}: {
  alert: MonitoringAlert;
  onAlertAction?: (input: UpdateAdminAlertStatusInput) => Promise<void>;
}) {
  const sourceType = alert.sourceType ?? alert.source_type;
  const sourceId = alert.sourceId ?? alert.source_id;
  const link = buildMonitoringSourceLink(sourceType, sourceId);
  const [actionMode, setActionMode] = useState<AlertActionMode | null>(null);
  const [reason, setReason] = useState("");
  const [resolutionResult, setResolutionResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAcknowledge = alert.status === "open";
  const canClose = ACTIVE_ALERT_STATUSES.has(alert.status);

  async function submitAction() {
    if (!actionMode || !onAlertAction) {
      return;
    }

    const normalizedReason = reason.trim();
    const normalizedResult = resolutionResult.trim();

    if (!normalizedReason) {
      setError("需要填写 reason");
      return;
    }

    if (actionMode === "resolved" && !normalizedResult) {
      setError("resolve 需要填写处理结果");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const input: UpdateAdminAlertStatusInput = {
        alertId: alert.alertId ?? alert.alert_id ?? alert.id,
        action: actionMode,
        reason: normalizedReason,
      };

      if (actionMode === "resolved") {
        input.resolutionResult = normalizedResult;
      }

      await onAlertAction(input);
      setActionMode(null);
      setReason("");
      setResolutionResult("");
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "告警状态更新失败",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="alert-row">
      <div className="list-row">
        <span>
          <strong>{alert.title ?? alert.message ?? shortId(alert.id)}</strong>
          <small>
            {[
              sourceType,
              sourceId,
              formatDate(alert.createdAt ?? alert.created_at ?? null),
            ]
              .filter(Boolean)
              .join(" / ")}
          </small>
        </span>
        <span className="list-row__actions">
          {link ? (
            <a className="text-button text-button--with-icon" href={link.href}>
              <span>{link.label}</span>
              <ExternalLink aria-hidden="true" size={14} />
            </a>
          ) : (
            <small>
              {sourceType ? `${sourceType}:${sourceId ?? "-"}` : "-"}
            </small>
          )}
          <StatusBadge status={alert.status} />
          {onAlertAction ? (
            <>
              <button
                className="icon-button icon-button--compact"
                disabled={busy || !canAcknowledge}
                onClick={() => setActionMode("acknowledged")}
                title="Acknowledge alert"
                type="button"
              >
                <CheckCircle2 aria-hidden="true" size={15} />
                <span>Ack</span>
              </button>
              <button
                className="icon-button icon-button--compact"
                disabled={busy || !canClose}
                onClick={() => setActionMode("resolved")}
                title="Resolve alert"
                type="button"
              >
                <XCircle aria-hidden="true" size={15} />
                <span>Resolve</span>
              </button>
              <button
                className="icon-button icon-button--compact"
                disabled={busy || !canClose}
                onClick={() => setActionMode("ignored")}
                title="Ignore alert"
                type="button"
              >
                <Archive aria-hidden="true" size={15} />
                <span>Ignore</span>
              </button>
            </>
          ) : null}
        </span>
      </div>
      {actionMode ? (
        <div className="alert-action-form">
          <label>
            <span>Reason</span>
            <input
              disabled={busy}
              placeholder="说明本次告警处理原因"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {actionMode === "resolved" ? (
            <label>
              <span>处理结果</span>
              <input
                disabled={busy}
                placeholder="记录修复、补偿或排查结果"
                value={resolutionResult}
                onChange={(event) => setResolutionResult(event.target.value)}
              />
            </label>
          ) : null}
          <div className="button-row">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setActionMode(null);
                setError(null);
              }}
              type="button"
            >
              取消
            </button>
            <button
              className="icon-button"
              disabled={busy}
              onClick={() => void submitAction()}
              type="button"
            >
              <CheckCircle2 aria-hidden="true" size={16} />
              <span>{busy ? "提交中" : "提交"}</span>
            </button>
          </div>
          {error ? <p className="notice notice--error">{error}</p> : null}
        </div>
      ) : null}
    </div>
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

function metricsFromCollection(
  collection: MonitoringMetricCollection | undefined,
): MonitoringGenericMetric[] {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection.filter(isMonitoringMetric);
  }

  return Object.entries(collection).flatMap(([key, value]) =>
    normalizeMetricEntry(key, value),
  );
}

function metricsFromResponse(
  response: MonitoringDomainResponse | null,
): MonitoringGenericMetric[] {
  if (!response) {
    return [];
  }

  const directMetrics = metricsFromCollection(response.metrics);

  if (directMetrics.length > 0) {
    return directMetrics;
  }

  return fallbackMetricsFromRecord(response).slice(0, 12);
}

function normalizeMetricEntry(
  key: string,
  value: MonitoringGenericMetric | number | string | boolean | null | undefined,
): MonitoringGenericMetric[] {
  if (isMonitoringMetric(value)) {
    return [
      {
        ...value,
        key: value.key || key,
        label: value.label || formatMetricLabel(key),
        status: coerceStatus(value.status),
      },
    ];
  }

  if (value === undefined || typeof value === "boolean") {
    return [];
  }

  return [
    {
      key,
      label: formatMetricLabel(key),
      value,
      unit: "count",
      status: "ok",
    },
  ];
}

function fallbackMetricsFromRecord(
  value: unknown,
  prefix: string[] = [],
): MonitoringGenericMetric[] {
  if (!isRecord(value)) {
    return [];
  }

  const reservedTopLevelKeys = new Set([
    "alerts",
    "exceptions",
    "recentExceptions",
    "serverTime",
    "sources",
    "warnings",
    "window",
  ]);

  return Object.entries(value).flatMap(([key, entryValue]) => {
    if (prefix.length === 0 && reservedTopLevelKeys.has(key)) {
      return [];
    }

    const metricKey = [...prefix, key].join("_");

    if (isMonitoringMetric(entryValue)) {
      return normalizeMetricEntry(metricKey, entryValue);
    }

    if (
      typeof entryValue === "number" ||
      typeof entryValue === "string" ||
      entryValue === null
    ) {
      return normalizeMetricEntry(metricKey, entryValue);
    }

    if (isRecord(entryValue)) {
      return fallbackMetricsFromRecord(entryValue, [...prefix, key]);
    }

    return [];
  });
}

function exceptionsFromResponse(
  response: MonitoringDomainResponse,
): MonitoringException[] {
  const direct = response.exceptions ?? [];
  const recent = response.recentExceptions;

  if (!recent) {
    return direct;
  }

  if (Array.isArray(recent)) {
    return [...direct, ...recent];
  }

  return [...direct, ...Object.values(recent).flat()];
}

function readActiveAlerts(data: unknown): MonitoringAlert[] {
  if (!isRecord(data) || !Array.isArray(data.alerts)) {
    return [];
  }

  return data.alerts.filter(isActiveAlert);
}

function isActiveAlert(alert: unknown): alert is MonitoringAlert {
  if (!isRecord(alert) || typeof alert.id !== "string") {
    return false;
  }

  const status = typeof alert.status === "string" ? alert.status : "";

  return ACTIVE_ALERT_STATUSES.has(status);
}

function buildMonitoringSourceLink(
  sourceType: string | null | undefined,
  sourceId: string | null | undefined,
): { href: string; label: string } | null {
  if (!sourceType || !sourceId) {
    return null;
  }

  const normalized = sourceType.trim().toLowerCase();
  const encodedId = encodeURIComponent(sourceId);

  if (normalized === "star_order" || normalized.includes("star_order")) {
    return {
      href: `#payments?starOrderId=${encodedId}`,
      label: "支付详情",
    };
  }

  if (normalized === "mint_queue" || normalized.includes("mint_queue")) {
    return {
      href: `#mint?mintQueueId=${encodedId}`,
      label: "Mint 队列",
    };
  }

  if (normalized.includes("webhook_event")) {
    return {
      href: "#payments",
      label: "支付列表",
    };
  }

  if (normalized === "risk_event" || normalized.includes("risk_event")) {
    return {
      href: `#risk?sourceId=${encodedId}`,
      label: "风控中心",
    };
  }

  if (
    normalized === "reconciliation_run" ||
    normalized.includes("reconciliation_run")
  ) {
    return {
      href: `#reconciliation?runId=${encodedId}`,
      label: "对账中心",
    };
  }

  if (
    normalized === "user" ||
    normalized === "core_user" ||
    normalized.endsWith(".user")
  ) {
    return {
      href: `#risk?userId=${encodedId}`,
      label: "用户详情",
    };
  }

  if (
    normalized === "market_listing" ||
    normalized === "listing" ||
    normalized.includes("market_listing") ||
    normalized.includes("listing")
  ) {
    return {
      href: `#market-ops?listingId=${encodedId}`,
      label: "市场挂单",
    };
  }

  return null;
}

function formatMetricValue(metric: Metric): string {
  if (metric.unit === "percent") {
    const value =
      typeof metric.value === "number" && Math.abs(metric.value) <= 1
        ? metric.value * 100
        : Number(metric.value);

    return Number.isFinite(value) ? `${value.toFixed(2)}%` : "-";
  }

  if (metric.unit === "milliseconds") {
    return typeof metric.value === "number"
      ? formatMilliseconds(metric.value)
      : "-";
  }

  return formatUnknownValue(metric.value);
}

function renderMetricMeta(metric: Metric) {
  if (metric.unit === "percent" && "numerator" in metric) {
    return (
      <>
        <MetricMeta label="异常数" value={metric.numerator} />
        <MetricMeta label="样本数" value={metric.denominator} />
        {"stuckCount" in metric && metric.stuckCount !== undefined ? (
          <MetricMeta label="卡住" value={metric.stuckCount} />
        ) : null}
      </>
    );
  }

  if (metric.unit === "milliseconds" && "averageMs" in metric) {
    return (
      <>
        <MetricMeta
          label="平均"
          value={formatNullableMilliseconds(metric.averageMs)}
        />
        <MetricMeta
          label="最大"
          value={formatNullableMilliseconds(metric.maxMs)}
        />
        <MetricMeta label="未完成" value={metric.pendingCount} />
        <MetricMeta label="卡住" value={metric.stuckCount} />
      </>
    );
  }

  if ("activeCount" in metric) {
    return (
      <>
        <MetricMeta label="活跃队列" value={metric.activeCount} />
        <MetricMeta label="卡住" value={metric.stuckCount} />
      </>
    );
  }

  if (
    "breakdown" in metric &&
    Array.isArray(metric.breakdown) &&
    metric.breakdown.length > 0
  ) {
    return metric.breakdown
      .slice(0, 4)
      .map((item) => (
        <MetricMeta
          key={item.key}
          label={item.label ?? formatMetricLabel(item.key)}
          value={formatUnknownValue(item.value)}
        />
      ));
  }

  if ("numerator" in metric || "denominator" in metric) {
    return (
      <>
        <MetricMeta label="分子" value={metric.numerator ?? "-"} />
        <MetricMeta label="分母" value={metric.denominator ?? "-"} />
      </>
    );
  }

  if ("meta" in metric && metric.meta) {
    return Object.entries(metric.meta)
      .slice(0, 4)
      .map(([key, value]) => (
        <MetricMeta
          key={key}
          label={formatMetricLabel(key)}
          value={formatUnknownValue(value)}
        />
      ));
  }

  return <MetricMeta label="状态" value={metric.status} />;
}

function MetricMeta({
  label,
  value,
}: {
  label: string;
  value: number | string | null | undefined;
}) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value ?? "-"}</strong>
    </span>
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

function overallStatus(metrics: Metric[]): MonitoringStatus {
  if (metrics.some((metric) => metric.status === "critical")) {
    return "critical";
  }

  if (metrics.some((metric) => metric.status === "warning")) {
    return "warning";
  }

  return "ok";
}

function overallAlertStatus(alerts: MonitoringAlert[]): MonitoringStatus {
  if (alerts.some((alert) => alert.severity === "critical")) {
    return "critical";
  }

  if (alerts.length > 0) {
    return "warning";
  }

  return "ok";
}

function coerceStatus(value: string): MonitoringStatus {
  if (value === "warning" || value === "critical") {
    return value;
  }

  return "ok";
}

function isMonitoringMetric(value: unknown): value is MonitoringGenericMetric {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.label === "string" &&
    "value" in value &&
    typeof value.unit === "string" &&
    typeof value.status === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatMetricLabel(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatUnknownValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return JSON.stringify(value);
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
