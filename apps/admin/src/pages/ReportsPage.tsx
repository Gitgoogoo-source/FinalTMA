import { Download, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  exportReport,
  fetchDailyReports,
  fetchEconomyReports,
  fetchGachaReports,
  fetchMarketReports,
} from "../admin.api";
import type {
  DailyBusinessReport,
  DailyEconomyReport,
  DailyGachaReport,
  DailyMarketReport,
  DailyReferralReport,
  DailyReportsResponse,
  EconomyReportsResponse,
  GachaReportsResponse,
  MarketReportsResponse,
  ReportExportType,
  ReportFilterOptions,
  ReportFilters,
  ReportMetrics,
} from "../admin.types";

type ReportsPageProps = {
  canExportReports: boolean;
};

type ReportState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

type FilterState = {
  from: string;
  to: string;
  campaignId: string;
  boxId: string;
  seriesId: string;
  templateId: string;
  rarityCode: string;
  cohortKey: string;
  currencyCode: string;
};

const INITIAL_STATE = {
  data: null,
  loading: true,
  error: null,
};

const REPORT_EXPORT_TYPES: Array<{
  label: string;
  value: ReportExportType;
}> = [
  { label: "日报", value: "daily" },
  { label: "抽卡", value: "gacha" },
  { label: "经济", value: "economy" },
  { label: "市场", value: "market" },
];

export function ReportsPage({ canExportReports }: ReportsPageProps) {
  const [filters, setFilters] = useState<FilterState>(() =>
    buildInitialFilters(),
  );
  const [dailyState, setDailyState] =
    useState<ReportState<DailyReportsResponse>>(INITIAL_STATE);
  const [economyState, setEconomyState] =
    useState<ReportState<EconomyReportsResponse>>(INITIAL_STATE);
  const [gachaState, setGachaState] =
    useState<ReportState<GachaReportsResponse>>(INITIAL_STATE);
  const [marketState, setMarketState] =
    useState<ReportState<MarketReportsResponse>>(INITIAL_STATE);
  const [exportType, setExportType] = useState<ReportExportType>("daily");
  const [exportReason, setExportReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filterOptions = useMemo(
    () =>
      dailyState.data?.filterOptions ??
      gachaState.data?.filterOptions ??
      economyState.data?.filterOptions ??
      marketState.data?.filterOptions ??
      {},
    [
      dailyState.data?.filterOptions,
      economyState.data?.filterOptions,
      gachaState.data?.filterOptions,
      marketState.data?.filterOptions,
    ],
  );
  const loading =
    dailyState.loading ||
    economyState.loading ||
    gachaState.loading ||
    marketState.loading;
  const empty =
    !loading &&
    (dailyState.data?.items.length ?? 0) === 0 &&
    (economyState.data?.items.length ?? 0) === 0 &&
    (gachaState.data?.items.length ?? 0) === 0 &&
    (marketState.data?.items.length ?? 0) === 0;

  async function loadReports() {
    setNotice(null);
    setError(null);
    setDailyState((current) => ({ ...current, loading: true, error: null }));
    setEconomyState((current) => ({ ...current, loading: true, error: null }));
    setGachaState((current) => ({ ...current, loading: true, error: null }));
    setMarketState((current) => ({ ...current, loading: true, error: null }));

    const query = buildReportQuery(filters);

    await Promise.all([
      fetchDailyReports(query)
        .then((data) => setDailyState({ data, loading: false, error: null }))
        .catch((loadError) =>
          setDailyState({
            data: null,
            loading: false,
            error: formatError(loadError, "日报加载失败"),
          }),
        ),
      fetchEconomyReports(query)
        .then((data) => setEconomyState({ data, loading: false, error: null }))
        .catch((loadError) =>
          setEconomyState({
            data: null,
            loading: false,
            error: formatError(loadError, "经济报表加载失败"),
          }),
        ),
      fetchGachaReports(query)
        .then((data) => setGachaState({ data, loading: false, error: null }))
        .catch((loadError) =>
          setGachaState({
            data: null,
            loading: false,
            error: formatError(loadError, "抽卡报表加载失败"),
          }),
        ),
      fetchMarketReports(query)
        .then((data) => setMarketState({ data, loading: false, error: null }))
        .catch((loadError) =>
          setMarketState({
            data: null,
            loading: false,
            error: formatError(loadError, "市场报表加载失败"),
          }),
        ),
    ]);
  }

  async function handleExport() {
    const reason = exportReason.trim();

    if (!reason) {
      setError("导出报表必须填写 reason");
      return;
    }

    const confirmLargeRange =
      countInclusiveDays(filters.from, filters.to) > 31
        ? window.confirm("当前导出范围超过 31 天，确认继续导出？")
        : false;

    if (
      countInclusiveDays(filters.from, filters.to) > 31 &&
      !confirmLargeRange
    ) {
      return;
    }

    setExporting(true);
    setNotice(null);
    setError(null);

    try {
      const result = await exportReport({
        reportType: exportType,
        filters: buildReportQuery(filters),
        reason,
        confirmLargeRange,
      });

      downloadBlob(result.blob, result.filename);
      setNotice(
        result.auditLogId
          ? `导出已生成，auditLogId: ${result.auditLogId}`
          : "导出已生成。",
      );
      setExportReason("");
    } catch (exportError) {
      setError(formatError(exportError, "报表导出失败"));
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    void loadReports();
  }, []);

  return (
    <section className="admin-surface reports-page">
      <div className="toolbar reports-toolbar">
        <label className="toolbar__search">
          <span>From</span>
          <input
            max={filters.to}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                from: event.target.value,
              }))
            }
            type="date"
            value={filters.from}
          />
        </label>
        <label className="toolbar__search">
          <span>To</span>
          <input
            min={filters.from}
            onChange={(event) =>
              setFilters((current) => ({ ...current, to: event.target.value }))
            }
            type="date"
            value={filters.to}
          />
        </label>
        <FilterSelect
          label="活动"
          options={filterOptions.campaigns?.map((item) => ({
            label: item.title,
            value: item.id,
          }))}
          value={filters.campaignId ?? ""}
          onChange={(value) =>
            setFilters((current) => ({ ...current, campaignId: value }))
          }
        />
        <FilterSelect
          label="盲盒"
          options={filterOptions.blindBoxes?.map((item) => ({
            label: item.displayName,
            value: item.id,
          }))}
          value={filters.boxId ?? ""}
          onChange={(value) =>
            setFilters((current) => ({ ...current, boxId: value }))
          }
        />
        <FilterSelect
          label="系列"
          options={filterOptions.series?.map((item) => ({
            label: item.displayName,
            value: item.id,
          }))}
          value={filters.seriesId ?? ""}
          onChange={(value) =>
            setFilters((current) => ({ ...current, seriesId: value }))
          }
        />
        <FilterSelect
          label="稀有度"
          options={filterOptions.rarities?.map((item) => ({
            label: item.displayName,
            value: item.code,
          }))}
          value={filters.rarityCode ?? ""}
          onChange={(value) =>
            setFilters((current) => ({ ...current, rarityCode: value }))
          }
        />
        <FilterSelect
          label="cohort"
          options={filterOptions.cohorts?.map((item) => ({
            label: item.label,
            value: item.key,
          }))}
          value={filters.cohortKey ?? ""}
          onChange={(value) =>
            setFilters((current) => ({ ...current, cohortKey: value }))
          }
        />
        <button
          className="icon-button"
          disabled={loading}
          onClick={() => void loadReports()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>刷新</span>
        </button>
      </div>

      {canExportReports ? (
        <div className="toolbar reports-export-toolbar">
          <label className="toolbar__search">
            <span>导出</span>
            <select
              onChange={(event) =>
                setExportType(event.target.value as ReportExportType)
              }
              value={exportType}
            >
              {REPORT_EXPORT_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="toolbar__search reports-reason">
            <span>Reason</span>
            <input
              onChange={(event) => setExportReason(event.target.value)}
              placeholder="导出原因"
              value={exportReason}
            />
          </label>
          <button
            className="icon-button"
            disabled={exporting}
            onClick={() => void handleExport()}
            type="button"
          >
            <Download aria-hidden="true" size={17} />
            <span>{exporting ? "导出中" : "导出 CSV"}</span>
          </button>
        </div>
      ) : null}

      {notice ? <p className="notice notice--success">{notice}</p> : null}
      {error ? <p className="notice notice--error">{error}</p> : null}
      {loading ? <p className="notice">加载中...</p> : null}
      {empty ? (
        <p className="notice notice--warning">
          当前筛选范围暂无日报快照，请先运行 daily_reports 报表 worker。
        </p>
      ) : null}

      <ReportSection
        error={dailyState.error}
        rows={dailyState.data?.items ?? []}
        title="收入"
        metrics={[
          "starsGmv",
          "paymentOrderCount",
          "paidOrderCount",
          "paymentSuccessRate",
        ]}
      />
      <ReportSection
        error={dailyState.error}
        rows={dailyState.data?.items ?? []}
        title="增长 / 留存"
        metrics={[
          "newUserCount",
          "activeUserCount",
          "day1RetainedUserCount",
          "day1RetentionRate",
          "day7RetainedUserCount",
          "day7RetentionRate",
        ]}
      />
      <ReportSection
        error={economyState.error}
        rows={economyState.data?.items ?? []}
        title="经济系统"
        metrics={["issuedAmount", "spentAmount", "netAmount", "entryCount"]}
      />
      <ReportSection
        error={gachaState.error}
        rows={gachaState.data?.items ?? []}
        title="抽卡"
        metrics={[
          "drawResultCount",
          "pityCount",
          "rareOutputCount",
          "uniqueUserCount",
        ]}
      />
      <ReportSection
        error={marketState.error}
        rows={marketState.data?.items ?? []}
        title="市场"
        metrics={["orderCount", "itemCount", "volumeKcoin", "platformFeeKcoin"]}
      />
      <ReportSection
        error={null}
        rows={dailyState.data?.referralReports ?? []}
        title="邀请"
        metrics={[
          "invitedCount",
          "qualifiedCount",
          "rewardedCount",
          "firstOpenConversionRate",
        ]}
      />
      <ReportSection
        error={dailyState.error}
        rows={dailyState.data?.items ?? []}
        title="Mint"
        metrics={["mintedQueueCount", "nftItemCount", "albumDiscoveryCount"]}
      />
    </section>
  );
}

function FilterSelect(props: {
  label: string;
  options: Array<{ label: string; value: string }> | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="toolbar__search">
      <span>{props.label}</span>
      <select
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      >
        <option value="">All</option>
        {(props.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReportSection<T extends ReportRow>(props: {
  error: string | null;
  metrics: string[];
  rows: T[];
  title: string;
}) {
  const summary = summarizeRows(props.rows, props.metrics);

  return (
    <section className="detail-panel reports-section">
      <div className="detail-panel__header">
        <div>
          <h2>{props.title}</h2>
          <p>{props.rows.length} rows</p>
        </div>
      </div>
      {props.error ? (
        <p className="notice notice--error">{props.error}</p>
      ) : null}
      <div className="metric-grid metric-grid--compact">
        {props.metrics.map((metric) => (
          <div className="metric-card" key={metric}>
            <span>{metric}</span>
            <strong>{formatMetricValue(summary[metric])}</strong>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Scope</th>
              {props.metrics.map((metric) => (
                <th key={metric}>{metric}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.slice(0, 12).map((row) => (
              <tr key={`${row.report_date}:${row.scope_key}`}>
                <td>{row.report_date}</td>
                <td>{formatScope(row)}</td>
                {props.metrics.map((metric) => (
                  <td key={metric}>
                    {formatMetricValue(row.metrics?.[metric])}
                  </td>
                ))}
              </tr>
            ))}
            {props.rows.length === 0 ? (
              <tr>
                <td colSpan={props.metrics.length + 2}>暂无报表快照。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ReportRow =
  | DailyBusinessReport
  | DailyEconomyReport
  | DailyGachaReport
  | DailyMarketReport
  | DailyReferralReport;

function summarizeRows(rows: ReportRow[], metrics: string[]) {
  const summary: Record<string, number> = {};

  for (const metric of metrics) {
    summary[metric] = rows.reduce(
      (sum, row) => sum + readNumericMetric(row.metrics, metric),
      0,
    );
  }

  return summary;
}

function readNumericMetric(metrics: ReportMetrics | undefined, key: string) {
  const value = metrics?.[key];

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatMetricValue(value: unknown): string {
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: value < 1 && value > 0 ? 4 : 0,
    }).format(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatMetricValue(parsed) : value;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return "-";
}

function formatScope(row: ReportRow): string {
  return [
    "campaign_id" in row && row.campaign_id
      ? `campaign:${shortId(row.campaign_id)}`
      : null,
    "box_id" in row && row.box_id ? `box:${shortId(row.box_id)}` : null,
    "series_id" in row && row.series_id
      ? `series:${shortId(row.series_id)}`
      : null,
    "template_id" in row && row.template_id
      ? `template:${shortId(row.template_id)}`
      : null,
    "rarity_code" in row ? `rarity:${row.rarity_code}` : null,
    "currency_code" in row ? `currency:${row.currency_code}` : null,
    "source_type" in row ? `source:${row.source_type}` : null,
    row.cohort_key ? `cohort:${row.cohort_key}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function buildInitialFilters(): FilterState {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00.000Z`) - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  return {
    from,
    to,
    campaignId: "",
    boxId: "",
    seriesId: "",
    templateId: "",
    rarityCode: "",
    cohortKey: "",
    currencyCode: "",
  };
}

function buildReportQuery(filters: FilterState): ReportFilters {
  return Object.fromEntries(
    Object.entries({
      from: filters.from,
      to: filters.to,
      campaignId: filters.campaignId,
      boxId: filters.boxId,
      seriesId: filters.seriesId,
      templateId: filters.templateId,
      rarityCode: filters.rarityCode,
      cohortKey: filters.cohortKey,
      currencyCode: filters.currencyCode,
      limit: 100,
    }).filter(([, value]) => value !== undefined && value !== ""),
  ) as ReportFilters;
}

function countInclusiveDays(from: string, to: string): number {
  return (
    Math.floor(
      (Date.parse(`${to}T00:00:00.000Z`) -
        Date.parse(`${from}T00:00:00.000Z`)) /
        86_400_000,
    ) + 1
  );
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
