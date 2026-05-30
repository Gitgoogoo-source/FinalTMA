import {
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  AdminApiError,
  exportAuditLogsCsv,
  fetchAuditLogs,
} from "../admin.api";
import type {
  AdminAuditCorrection,
  AdminAuditLog,
  AuditRiskLevel,
  AuditLogFilters,
  AuditLogsResponse,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";
import { ConfirmDangerDialog } from "../components/ConfirmDangerDialog";

const PAGE_LIMIT = 30;
const SENSITIVE_KEY_RE =
  /(authorization|bot[_-]?token|cookie|initdata|password|private[_-]?key|secret|service[_-]?role|token)/i;

type AuditFilterDraft = {
  adminUserId: string;
  action: string;
  targetSchema: string;
  targetTable: string;
  targetId: string;
  from: string;
  to: string;
  riskLevel: AuditRiskLevel | "";
  q: string;
};

type PageError = {
  code: string;
  requestId: string | null;
  status: number | null;
};

type DiffRow = {
  key: string;
  status: "added" | "removed" | "changed";
};

const EMPTY_FILTERS: AuditFilterDraft = {
  adminUserId: "",
  action: "",
  targetSchema: "",
  targetTable: "",
  targetId: "",
  from: "",
  to: "",
  riskLevel: "",
  q: "",
};

const AUDIT_FILTER_QUERY_KEYS = [
  "adminUserId",
  "action",
  "targetSchema",
  "targetTable",
  "targetId",
  "from",
  "to",
  "riskLevel",
  "q",
] as const;

type AuditLogsPageProps = {
  canExport: boolean;
};

export function AuditLogsPage({ canExport }: AuditLogsPageProps) {
  const [filters, setFilters] = useState<AuditFilterDraft>(() =>
    readAuditFiltersFromLocation(),
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<string[]>([]);
  const [data, setData] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PageError | null>(null);
  const [exportError, setExportError] = useState<PageError | null>(null);
  const [exporting, setExporting] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AdminAuditLog | null>(null);

  const items = data?.items ?? [];
  const exportTargetValue = useMemo(
    () => buildExportTargetValue(filters),
    [filters],
  );
  const selectedDiff = useMemo(
    () =>
      selectedLog
        ? buildTopLevelDiff(selectedLog.before_state, selectedLog.after_state)
        : [],
    [selectedLog],
  );

  async function load(nextCursor: string | null = cursor) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchAuditLogs({
        ...buildAuditLogParams(filters),
        cursor: nextCursor,
        limit: PAGE_LIMIT,
      });

      setData(response);
      setSelectedLog((current) =>
        current && response.items.some((item) => item.id === current.id)
          ? current
          : null,
      );
    } catch (loadError) {
      setError(formatPageError(loadError));
    } finally {
      setLoading(false);
    }
  }

  function updateFilter<K extends keyof AuditFilterDraft>(
    key: K,
    value: AuditFilterDraft[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    setCursor(null);
    setPreviousCursors([]);
    setExportError(null);
    writeAuditFiltersToLocation(filters);
    void load(null);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setCursor(null);
    setPreviousCursors([]);
    setExportError(null);
    writeAuditFiltersToLocation(EMPTY_FILTERS);
    void loadWithFilters(EMPTY_FILTERS, null);
  }

  async function exportCsv(reason: string) {
    setExporting(true);
    setExportError(null);

    try {
      const result = await exportAuditLogsCsv({
        filters: buildAuditLogParams(filters),
        reason,
      });

      downloadBlob(result.blob, result.filename);
      setIsExportDialogOpen(false);
    } catch (downloadError) {
      setExportError(formatPageError(downloadError));
    } finally {
      setExporting(false);
    }
  }

  async function loadWithFilters(
    nextFilters: AuditFilterDraft,
    nextCursor: string | null,
  ) {
    setLoading(true);
    setError(null);

    try {
      setData(
        await fetchAuditLogs({
          ...buildAuditLogParams(nextFilters),
          cursor: nextCursor,
          limit: PAGE_LIMIT,
        }),
      );
      setSelectedLog(null);
    } catch (loadError) {
      setError(formatPageError(loadError));
    } finally {
      setLoading(false);
    }
  }

  function goNextPage() {
    const nextCursor = data?.nextCursor ?? null;

    if (!nextCursor) {
      return;
    }

    setPreviousCursors((current) => [...current, cursor ?? ""]);
    setCursor(nextCursor);
    void load(nextCursor);
  }

  function goPreviousPage() {
    const nextStack = previousCursors.slice(0, -1);
    const previousCursor = previousCursors.at(-1) ?? "";
    const normalizedCursor = previousCursor || null;

    setPreviousCursors(nextStack);
    setCursor(normalizedCursor);
    void load(normalizedCursor);
  }

  useEffect(() => {
    void load(null);
  }, []);

  return (
    <section className="admin-surface">
      <form
        className="toolbar audit-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <label>
          <span>管理员</span>
          <input
            onChange={(event) =>
              updateFilter("adminUserId", event.target.value)
            }
            placeholder="admin UUID"
            value={filters.adminUserId}
          />
        </label>
        <label>
          <span>Action</span>
          <input
            onChange={(event) => updateFilter("action", event.target.value)}
            placeholder="feature_flag.update"
            value={filters.action}
          />
        </label>
        <label>
          <span>Schema</span>
          <input
            onChange={(event) =>
              updateFilter("targetSchema", event.target.value)
            }
            placeholder="ops"
            value={filters.targetSchema}
          />
        </label>
        <label>
          <span>Table</span>
          <input
            onChange={(event) =>
              updateFilter("targetTable", event.target.value)
            }
            placeholder="feature_flags"
            value={filters.targetTable}
          />
        </label>
        <label>
          <span>Target ID</span>
          <input
            onChange={(event) => updateFilter("targetId", event.target.value)}
            placeholder="UUID"
            value={filters.targetId}
          />
        </label>
        <label>
          <span>From</span>
          <input
            onChange={(event) => updateFilter("from", event.target.value)}
            type="datetime-local"
            value={filters.from}
          />
        </label>
        <label>
          <span>To</span>
          <input
            onChange={(event) => updateFilter("to", event.target.value)}
            type="datetime-local"
            value={filters.to}
          />
        </label>
        <label>
          <span>风险等级</span>
          <select
            onChange={(event) =>
              updateFilter(
                "riskLevel",
                normalizeRiskLevelDraft(event.target.value),
              )
            }
            value={filters.riskLevel}
          >
            <option value="">全部</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </label>
        <label className="toolbar__search">
          <span>搜索</span>
          <input
            onChange={(event) => updateFilter("q", event.target.value)}
            placeholder="action / reason / target"
            value={filters.q}
          />
        </label>
        <button className="icon-button" disabled={loading} type="submit">
          <Search aria-hidden="true" size={17} />
          <span>查询</span>
        </button>
        <button
          className="icon-button"
          disabled={loading}
          onClick={resetFilters}
          type="button"
        >
          <X aria-hidden="true" size={17} />
          <span>重置</span>
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
        {canExport ? (
          <button
            className="icon-button"
            disabled={loading || exporting}
            onClick={() => {
              setExportError(null);
              setIsExportDialogOpen(true);
            }}
            type="button"
          >
            <Download aria-hidden="true" size={17} />
            <span>{exporting ? "导出中" : "导出 CSV"}</span>
          </button>
        ) : null}
      </form>

      {error ? <AuditErrorNotice error={error} /> : null}
      {exportError ? <AuditErrorNotice error={exportError} /> : null}
      {loading ? <p className="notice">加载中...</p> : null}

      <AuditSummary data={data} />

      {!loading && !error && items.length === 0 ? (
        <p className="notice">暂无审计日志</p>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>管理员</th>
              <th>Action</th>
              <th>目标</th>
              <th>Reason</th>
              <th>Request ID</th>
              <th>Before / After</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {items.map((log) => (
              <tr key={log.id}>
                <td>
                  <strong>{formatDate(log.created_at)}</strong>
                  <small>{shortId(log.id)}</small>
                </td>
                <td>
                  <strong>{formatAdminLabel(log)}</strong>
                  <small>
                    {log.admin_user_id ? shortId(log.admin_user_id) : "-"}
                  </small>
                </td>
                <td>
                  <StatusBadge status={log.risk_level ?? "read"} />
                  <small>{log.action}</small>
                </td>
                <td>
                  <strong>{formatTarget(log)}</strong>
                  <small>{log.target_id ? shortId(log.target_id) : "-"}</small>
                </td>
                <td>{log.reason ?? "-"}</td>
                <td>{extractRequestId(log) ?? "-"}</td>
                <td>
                  <small>{summarizeJson(log.before_state)}</small>
                  <small>{summarizeJson(log.after_state)}</small>
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => setSelectedLog(log)}
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

      <div className="audit-pagination">
        <button
          className="icon-button"
          disabled={loading || previousCursors.length === 0}
          onClick={goPreviousPage}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={17} />
          <span>上一页</span>
        </button>
        <span className="toolbar__meta">
          {items.length} 条 /{" "}
          {data?.serverTime ? formatDate(data.serverTime) : "-"}
        </span>
        <button
          className="icon-button"
          disabled={loading || !data?.nextCursor}
          onClick={goNextPage}
          type="button"
        >
          <span>下一页</span>
          <ChevronRight aria-hidden="true" size={17} />
        </button>
      </div>

      {selectedLog ? (
        <AuditLogDialog
          diff={selectedDiff}
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
        />
      ) : null}
      <ConfirmDangerDialog
        confirmLabel="导出 CSV"
        description="导出结果会写入审计日志。"
        isOpen={isExportDialogOpen}
        onCancel={() => setIsExportDialogOpen(false)}
        onConfirm={(confirmation) => void exportCsv(confirmation.reason)}
        pending={exporting}
        targetLabel="导出范围"
        targetValue={exportTargetValue}
        title="导出审计日志"
      />
    </section>
  );
}

function AuditSummary({ data }: { data: AuditLogsResponse | null }) {
  const entries = Object.entries(data?.summary ?? {});

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="metric-strip">
      {entries.map(([key, value]) => (
        <span key={key}>
          <strong>{value}</strong>
          <small>{key}</small>
        </span>
      ))}
    </div>
  );
}

function AuditErrorNotice({ error }: { error: PageError }) {
  return (
    <p className="notice notice--error">
      错误码: {error.code}
      {error.status ? ` status: ${error.status}` : ""}
      {error.requestId ? ` requestId: ${error.requestId}` : ""}
    </p>
  );
}

function AuditLogDialog(props: {
  diff: DiffRow[];
  log: AdminAuditLog;
  onClose: () => void;
}) {
  const beforeState = redactSensitiveJson(props.log.before_state);
  const afterState = redactSensitiveJson(props.log.after_state);

  return (
    <div className="danger-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="audit-log-dialog-title"
        aria-modal="true"
        className="danger-dialog audit-dialog"
        role="dialog"
      >
        <header className="audit-dialog__header">
          <div>
            <h2 id="audit-log-dialog-title">{props.log.action}</h2>
            <p>
              {formatDate(props.log.created_at)} / {formatTarget(props.log)}
            </p>
          </div>
          <button
            className="icon-only-button"
            onClick={props.onClose}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="detail-grid detail-grid--wide">
          <span>
            <small>管理员</small>
            <strong>{formatAdminLabel(props.log)}</strong>
          </span>
          <span>
            <small>Request ID</small>
            <strong>{extractRequestId(props.log) ?? "-"}</strong>
          </span>
          <span>
            <small>Reason</small>
            <strong>{props.log.reason ?? "-"}</strong>
          </span>
          <span>
            <small>Audit ID</small>
            <strong>{props.log.id}</strong>
          </span>
        </div>

        <section className="audit-diff">
          <h3>Diff</h3>
          {props.diff.length === 0 ? (
            <p className="muted">无顶层字段变化</p>
          ) : (
            <div className="permission-list">
              {props.diff.map((row) => (
                <span key={`${row.status}:${row.key}`}>
                  {row.status}:{row.key}
                </span>
              ))}
            </div>
          )}
        </section>

        <CorrectionChain corrections={props.log.corrections ?? []} />

        <div className="audit-json-grid">
          <JsonStatePanel label="before_state" value={beforeState} />
          <JsonStatePanel label="after_state" value={afterState} />
        </div>
      </section>
    </div>
  );
}

function CorrectionChain(props: { corrections: AdminAuditCorrection[] }) {
  if (props.corrections.length === 0) {
    return (
      <section className="audit-diff">
        <h3>Correction 链路</h3>
        <p className="muted">暂无 correction 记录</p>
      </section>
    );
  }

  return (
    <section className="audit-diff">
      <h3>Correction 链路</h3>
      <ol className="audit-correction-list">
        {props.corrections.map((correction) => (
          <li key={correction.id}>
            <strong>{extractCorrectionNote(correction)}</strong>
            <small>
              {formatDate(correction.created_at)} /{" "}
              {formatAdminLabel(correction)} /{" "}
              {extractRequestId(correction) ?? "-"}
            </small>
            <small>reason: {correction.reason ?? "-"}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function JsonStatePanel(props: { label: string; value: unknown }) {
  const json = toPrettyJson(props.value);
  const isLarge = json.length > 1200;

  return (
    <details className="audit-json-panel" open={!isLarge}>
      <summary>{props.label}</summary>
      <pre className="json-preview">{json}</pre>
    </details>
  );
}

function buildAuditLogParams(filters: AuditFilterDraft): AuditLogFilters {
  const params: AuditLogFilters = {};
  const adminUserId = blankToUndefined(filters.adminUserId);
  const action = blankToUndefined(filters.action);
  const targetSchema = blankToUndefined(filters.targetSchema);
  const targetTable = blankToUndefined(filters.targetTable);
  const targetId = blankToUndefined(filters.targetId);
  const from = toIsoString(filters.from);
  const to = toIsoString(filters.to);
  const riskLevel = filters.riskLevel;
  const q = blankToUndefined(filters.q);

  if (adminUserId) {
    params.adminUserId = adminUserId;
  }

  if (action) {
    params.action = action;
  }

  if (targetSchema) {
    params.targetSchema = targetSchema;
  }

  if (targetTable) {
    params.targetTable = targetTable;
  }

  if (targetId) {
    params.targetId = targetId;
  }

  if (from) {
    params.from = from;
  }

  if (to) {
    params.to = to;
  }

  if (riskLevel) {
    params.riskLevel = riskLevel;
  }

  if (q) {
    params.q = q;
  }

  return params;
}

function blankToUndefined(value: string): string | undefined {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function toIsoString(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function readAuditFiltersFromLocation(): AuditFilterDraft {
  if (typeof window === "undefined") {
    return EMPTY_FILTERS;
  }

  const search = new URLSearchParams(window.location.search);

  return {
    adminUserId: search.get("adminUserId") ?? "",
    action: search.get("action") ?? "",
    targetSchema: search.get("targetSchema") ?? "",
    targetTable: search.get("targetTable") ?? "",
    targetId: search.get("targetId") ?? "",
    from: toDateTimeLocalInput(search.get("from")),
    to: toDateTimeLocalInput(search.get("to")),
    riskLevel: normalizeRiskLevelDraft(search.get("riskLevel") ?? ""),
    q: search.get("q") ?? "",
  };
}

function writeAuditFiltersToLocation(filters: AuditFilterDraft): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);

  for (const key of AUDIT_FILTER_QUERY_KEYS) {
    url.searchParams.delete(key);
  }

  for (const [key, value] of Object.entries(filters)) {
    if (!value) {
      continue;
    }

    if (key === "from" || key === "to") {
      const isoValue = toIsoString(value);

      if (isoValue) {
        url.searchParams.set(key, isoValue);
      }

      continue;
    }

    url.searchParams.set(key, value);
  }

  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function buildExportTargetValue(filters: AuditFilterDraft): string {
  const params = buildAuditLogParams(filters);
  const serialized =
    Object.keys(params).length === 0
      ? "all"
      : JSON.stringify(
          Object.fromEntries(
            Object.entries(params).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
        );

  return `audit-export-${hashString(serialized)}`;
}

function hashString(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return (hash >>> 0).toString(36);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toDateTimeLocalInput(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function normalizeRiskLevelDraft(value: string): AuditFilterDraft["riskLevel"] {
  const normalized = value.trim().toLowerCase();

  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high"
  ) {
    return normalized;
  }

  return "";
}

function formatPageError(error: unknown): PageError {
  if (error instanceof AdminApiError) {
    return {
      code: error.code,
      requestId: error.requestId ?? null,
      status: error.status,
    };
  }

  return {
    code: "ADMIN_UI_ERROR",
    requestId: null,
    status: null,
  };
}

function formatAdminLabel(log: AdminAuditLog): string {
  if (log.admin?.display_name) {
    return log.admin.display_name;
  }

  if (log.admin?.email) {
    return log.admin.email;
  }

  if (log.admin?.telegram_user_id) {
    return `tg:${log.admin.telegram_user_id}`;
  }

  return log.admin_user_id ? shortId(log.admin_user_id) : "system";
}

function formatTarget(log: AdminAuditLog): string {
  const scope = [log.target_schema, log.target_table].filter(Boolean).join(".");
  return scope || "-";
}

function extractRequestId(log: AdminAuditLog): string | null {
  if (log.request_id) {
    return log.request_id;
  }

  if (log.requestId) {
    return log.requestId;
  }

  return (
    readStringKey(log.after_state, "request_id") ??
    readStringKey(log.before_state, "request_id") ??
    readStringKey(log.after_state, "requestId") ??
    readStringKey(log.before_state, "requestId")
  );
}

function extractCorrectionNote(correction: AdminAuditCorrection): string {
  const correctionState = readRecordKey(correction.after_state, "correction");

  return (
    readStringKey(correctionState, "note") ??
    readStringKey(correction.after_state, "note") ??
    correction.reason ??
    "-"
  );
}

function readStringKey(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const match = value[key];
  return typeof match === "string" && match.trim() ? match : null;
}

function readRecordKey(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const match = value[key];
  return isRecord(match) ? match : null;
}

function summarizeJson(value: unknown): string {
  const redacted = redactSensitiveJson(value);

  if (redacted === null || redacted === undefined) {
    return "-";
  }

  if (Array.isArray(redacted)) {
    return `array(${redacted.length})`;
  }

  if (isRecord(redacted)) {
    const keys = Object.keys(redacted);

    if (keys.length === 0) {
      return "{}";
    }

    const preview = keys.slice(0, 4).join(", ");
    return keys.length > 4
      ? `{${preview}, +${keys.length - 4}}`
      : `{${preview}}`;
  }

  const text = String(redacted);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function buildTopLevelDiff(
  beforeValue: unknown,
  afterValue: unknown,
): DiffRow[] {
  const beforeState = redactSensitiveJson(beforeValue);
  const afterState = redactSensitiveJson(afterValue);

  if (!isRecord(beforeState) || !isRecord(afterState)) {
    return stableStringify(beforeState) === stableStringify(afterState)
      ? []
      : [{ key: "root", status: "changed" }];
  }

  const keys = Array.from(
    new Set([...Object.keys(beforeState), ...Object.keys(afterState)]),
  ).sort();
  const rows: DiffRow[] = [];

  for (const key of keys) {
    if (!(key in beforeState)) {
      rows.push({ key, status: "added" });
      continue;
    }

    if (!(key in afterState)) {
      rows.push({ key, status: "removed" });
      continue;
    }

    if (
      stableStringify(beforeState[key]) !== stableStringify(afterState[key])
    ) {
      rows.push({ key, status: "changed" });
    }
  }

  return rows.slice(0, 40);
}

function redactSensitiveJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveJson(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY_RE.test(key)
        ? "[redacted]"
        : redactSensitiveJson(nestedValue),
    ]),
  );
}

function toPrettyJson(value: unknown): string {
  return stableStringify(value, 2);
}

function stableStringify(value: unknown, space?: number): string {
  try {
    return JSON.stringify(sortJsonValue(value), null, space);
  } catch {
    return String(value);
  }
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
