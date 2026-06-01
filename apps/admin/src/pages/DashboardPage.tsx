import { RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fetchAdminAlerts,
  fetchBusinessMonitoring,
  fetchEconomyMonitoring,
  fetchGachaMonitoring,
  fetchMarketMonitoring,
  fetchMonitoring,
  updateAdminAlertStatus,
  updatePaymentSupportConfig,
} from "../admin.api";
import type {
  AdminAlertsResponse,
  BusinessMonitoringResponse,
  EconomyMonitoringResponse,
  GachaMonitoringResponse,
  MarketMonitoringResponse,
  MonitoringResponse,
  PaymentSupportConfig,
  UpdateAdminAlertStatusInput,
} from "../admin.types";
import { formatDate, StatusBadge } from "../admin.ui";
import {
  AlertPanel,
  BusinessMetricsPanel,
  EconomyMetricsPanel,
  GachaMetricsPanel,
  MarketMetricsPanel,
  type PanelState,
  PaymentMetricsPanel,
} from "./dashboard/DashboardPanels";

const WINDOW_OPTIONS = [
  { label: "1h", value: 1 },
  { label: "6h", value: 6 },
  { label: "24h", value: 24 },
  { label: "7d", value: 168 },
] as const;

type WindowHours = (typeof WINDOW_OPTIONS)[number]["value"];

const INITIAL_PANEL_STATE = {
  data: null,
  loading: true,
  error: null,
};

export function DashboardPage() {
  const [windowHours, setWindowHours] = useState<WindowHours>(24);
  const [paymentState, setPaymentState] =
    useState<PanelState<MonitoringResponse>>(INITIAL_PANEL_STATE);
  const [businessState, setBusinessState] =
    useState<PanelState<BusinessMonitoringResponse>>(INITIAL_PANEL_STATE);
  const [economyState, setEconomyState] =
    useState<PanelState<EconomyMonitoringResponse>>(INITIAL_PANEL_STATE);
  const [gachaState, setGachaState] =
    useState<PanelState<GachaMonitoringResponse>>(INITIAL_PANEL_STATE);
  const [marketState, setMarketState] =
    useState<PanelState<MarketMonitoringResponse>>(INITIAL_PANEL_STATE);
  const [alertsState, setAlertsState] =
    useState<PanelState<AdminAlertsResponse>>(INITIAL_PANEL_STATE);
  const [supportUrlDraft, setSupportUrlDraft] = useState("");
  const [supportEmailDraft, setSupportEmailDraft] = useState("");
  const [supportReason, setSupportReason] = useState("");
  const [supportSaving, setSupportSaving] = useState(false);
  const [supportMessage, setSupportMessage] = useState<string | null>(null);
  const [supportError, setSupportError] = useState<string | null>(null);

  async function loadPaymentMetrics() {
    setPaymentState((current) => ({ ...current, loading: true, error: null }));

    try {
      const response = await fetchMonitoring({ windowHours });

      setPaymentState({ data: response, loading: false, error: null });
    } catch (loadError) {
      setPaymentState((current) => ({
        ...current,
        loading: false,
        error:
          loadError instanceof Error ? loadError.message : "支付监控加载失败",
      }));
    }
  }

  async function loadBusinessMetrics() {
    setBusinessState((current) => ({ ...current, loading: true, error: null }));

    try {
      const response = await fetchBusinessMonitoring({ windowHours });

      setBusinessState({ data: response, loading: false, error: null });
    } catch (loadError) {
      setBusinessState((current) => ({
        ...current,
        loading: false,
        error:
          loadError instanceof Error ? loadError.message : "商业总览加载失败",
      }));
    }
  }

  async function loadEconomyMetrics() {
    setEconomyState((current) => ({ ...current, loading: true, error: null }));

    try {
      const response = await fetchEconomyMonitoring({ windowHours });

      setEconomyState({ data: response, loading: false, error: null });
    } catch (loadError) {
      setEconomyState((current) => ({
        ...current,
        loading: false,
        error:
          loadError instanceof Error ? loadError.message : "经济监控加载失败",
      }));
    }
  }

  async function loadGachaMetrics() {
    setGachaState((current) => ({ ...current, loading: true, error: null }));

    try {
      const response = await fetchGachaMonitoring({ windowHours });

      setGachaState({ data: response, loading: false, error: null });
    } catch (loadError) {
      setGachaState((current) => ({
        ...current,
        loading: false,
        error:
          loadError instanceof Error ? loadError.message : "开盒监控加载失败",
      }));
    }
  }

  async function loadMarketMetrics() {
    setMarketState((current) => ({ ...current, loading: true, error: null }));

    try {
      const response = await fetchMarketMonitoring({ windowHours });

      setMarketState({ data: response, loading: false, error: null });
    } catch (loadError) {
      setMarketState((current) => ({
        ...current,
        loading: false,
        error:
          loadError instanceof Error ? loadError.message : "市场监控加载失败",
      }));
    }
  }

  async function loadAlerts() {
    setAlertsState((current) => ({ ...current, loading: true, error: null }));

    try {
      const response = await fetchAdminAlerts({
        status: "open,acknowledged",
        limit: 50,
      });

      setAlertsState({ data: response, loading: false, error: null });
    } catch (loadError) {
      setAlertsState((current) => ({
        ...current,
        loading: false,
        error:
          loadError instanceof Error ? loadError.message : "告警列表加载失败",
      }));
    }
  }

  function loadAll() {
    void loadPaymentMetrics();
    void loadBusinessMetrics();
    void loadEconomyMetrics();
    void loadGachaMetrics();
    void loadMarketMetrics();
    void loadAlerts();
  }

  async function handleAlertAction(input: UpdateAdminAlertStatusInput) {
    await updateAdminAlertStatus(input);
    await loadAlerts();
  }

  useEffect(() => {
    loadAll();
  }, [windowHours]);

  useEffect(() => {
    const paymentSupport = paymentState.data?.paymentSupport;

    if (!paymentSupport) {
      return;
    }

    setSupportUrlDraft(paymentSupport.supportUrl ?? "");
    setSupportEmailDraft(paymentSupport.supportEmail ?? "");
  }, [paymentState.data?.paymentSupport]);

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

      setPaymentState((current) =>
        current.data
          ? {
              ...current,
              data: {
                ...current.data,
                paymentSupport: {
                  configured: updated.configured,
                  source: updated.source,
                  supportEmail: updated.supportEmail,
                  supportUrl: updated.supportUrl,
                  updatedAt: updated.updatedAt,
                },
                warnings: updated.configured
                  ? current.data.warnings.filter(
                      (warning) =>
                        warning.code !== "PAYMENT_SUPPORT_CONFIG_MISSING",
                    )
                  : ensurePaymentSupportWarning(current.data.warnings),
              },
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

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label>
          <span>观察窗口</span>
          <select
            value={windowHours}
            onChange={(event) =>
              setWindowHours(Number(event.target.value) as WindowHours)
            }
          >
            {WINDOW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button className="icon-button" onClick={loadAll} type="button">
          <RefreshCw aria-hidden="true" size={17} />
          <span>刷新</span>
        </button>
      </div>

      <PaymentMetricsPanel state={paymentState} />

      {paymentState.data && !paymentState.error ? (
        <PaymentSupportConfigPanel
          config={paymentState.data.paymentSupport}
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
      ) : null}

      <BusinessMetricsPanel state={businessState} />

      <div className="split-grid split-grid--even">
        <GachaMetricsPanel state={gachaState} />
        <MarketMetricsPanel state={marketState} />
      </div>

      <EconomyMetricsPanel state={economyState} />

      <AlertPanel
        alertsState={alertsState}
        onAlertAction={handleAlertAction}
        sources={[
          { label: "支付 / Webhook / Mint", state: paymentState },
          { label: "商业总览", state: businessState },
          { label: "开盒监控", state: gachaState },
          { label: "市场监控", state: marketState },
          { label: "经济监控", state: economyState },
        ]}
      />
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
