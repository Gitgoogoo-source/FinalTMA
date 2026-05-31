import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  fetchReconciliationFindings,
  fetchReconciliationRuns,
  resolveReconciliationFinding,
  runReconciliationNow,
} from "../admin.api";
import type {
  ReconciliationFindingsResponse,
  ReconciliationFinding,
  ReconciliationRun,
  ReconciliationRunType,
  ReconciliationRunsResponse,
  ResolveReconciliationFindingStatus,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";
import { buildDangerTargetCode } from "../components/ConfirmDangerDialog";

const RUN_TYPE_OPTIONS: ReconciliationRunType[] = [
  "payment",
  "ledger",
  "market",
  "inventory",
  "gacha",
  "referral",
  "mint",
  "wallet",
];
const SEVERITY_FILTERS = ["", "critical", "high", "medium", "low"] as const;
const STATUS_FILTERS = [
  "",
  "open",
  "reviewing",
  "resolved",
  "ignored",
  "fixed",
  "false_positive",
  "escalated",
] as const;
const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
const MIN_REASON_LENGTH = 5;

type ResolveDraft = {
  finding: ReconciliationFinding;
  status: ResolveReconciliationFindingStatus;
};

type ResolveConfirmation = {
  reason: string;
  resolutionDetail: Record<string, unknown>;
  fixMethod?: string;
  escalationOwner?: string;
  confirmationTarget: string;
  confirmationCode: string;
};

type RunNowConfirmation = {
  reason: string;
  confirmationTarget: string;
  confirmationCode: string;
};

export function ReconciliationPage() {
  const [runType, setRunType] = useState<ReconciliationRunType>("payment");
  const [severity, setSeverity] =
    useState<(typeof SEVERITY_FILTERS)[number]>("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("open");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runsData, setRunsData] = useState<ReconciliationRunsResponse | null>(
    null,
  );
  const [findingsData, setFindingsData] =
    useState<ReconciliationFindingsResponse | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingFindings, setLoadingFindings] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [resolveDraft, setResolveDraft] = useState<ResolveDraft | null>(null);
  const [busyFindingId, setBusyFindingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const runs = useMemo(() => readRuns(runsData), [runsData]);
  const findings = useMemo(() => readFindings(findingsData), [findingsData]);
  const visibleFindings = useMemo(() => {
    const sorted = [...findings].sort(compareFindings);

    return sorted.filter((finding) => {
      if (selectedRunId && getFindingRunId(finding) !== selectedRunId) {
        return false;
      }

      if (severity && getFindingSeverity(finding) !== severity) {
        return false;
      }

      if (status && getFindingRawStatus(finding) !== status) {
        return false;
      }

      return true;
    });
  }, [findings, selectedRunId, severity, status]);
  const latestRun = readLatestRun(runsData, runs);
  const summary = buildSummary(runsData, findingsData, runs, findings);

  async function loadRuns() {
    setLoadingRuns(true);
    setError(null);

    try {
      const response = await fetchReconciliationRuns({ limit: 30, runType });

      setRunsData(response);
      setSelectedRunId((current) => {
        const nextRuns = readRuns(response);

        return current && nextRuns.some((run) => getRunId(run) === current)
          ? current
          : (getRunId(nextRuns[0]) ?? null);
      });
    } catch (loadError) {
      setError(formatError(loadError, "对账 run history 加载失败"));
    } finally {
      setLoadingRuns(false);
    }
  }

  async function loadFindings() {
    setLoadingFindings(true);
    setError(null);

    try {
      setFindingsData(
        await fetchReconciliationFindings({
          severity: severity || undefined,
          status: status || undefined,
          runType,
          runId: selectedRunId || undefined,
          limit: 50,
        }),
      );
    } catch (loadError) {
      setError(formatError(loadError, "对账 findings 加载失败"));
    } finally {
      setLoadingFindings(false);
    }
  }

  async function loadAll() {
    await Promise.all([loadRuns(), loadFindings()]);
  }

  async function confirmRunNow(confirmation: RunNowConfirmation) {
    setRunning(true);
    setError(null);
    setNotice(null);

    try {
      await runReconciliationNow({
        runTypes: [runType],
        dryRun,
        reason: confirmation.reason,
        confirmationTarget: confirmation.confirmationTarget,
        confirmationCode: confirmation.confirmationCode,
      });
      setRunDialogOpen(false);
      setNotice(
        dryRun
          ? "dry-run 已完成，结果不会写入风险中心。"
          : "对账已提交，异常将按后端结果写入风险中心。",
      );
      await loadAll();
    } catch (runError) {
      setError(formatError(runError, "立即对账失败"));
    } finally {
      setRunning(false);
    }
  }

  async function confirmResolve(confirmation: ResolveConfirmation) {
    if (!resolveDraft) {
      return;
    }

    const findingId = getFindingRiskEventId(resolveDraft.finding);

    if (!findingId) {
      setError("该 finding 没有关联 risk event id，无法执行状态处理。");
      return;
    }

    setBusyFindingId(findingId);
    setError(null);
    setNotice(null);

    try {
      const input = {
        findingId,
        status: resolveDraft.status,
        reason: confirmation.reason,
        resolutionDetail: confirmation.resolutionDetail,
        confirmationTarget: confirmation.confirmationTarget,
        confirmationCode: confirmation.confirmationCode,
      };

      await resolveReconciliationFinding({
        ...input,
        ...(confirmation.fixMethod
          ? { fixMethod: confirmation.fixMethod }
          : {}),
        ...(confirmation.escalationOwner
          ? { escalationOwner: confirmation.escalationOwner }
          : {}),
      });
      setResolveDraft(null);
      setNotice(`已更新 finding 状态为 ${resolveDraft.status}。`);
      await loadFindings();
      await loadRuns();
    } catch (resolveError) {
      setError(formatError(resolveError, "处理对账异常失败"));
    } finally {
      setBusyFindingId(null);
    }
  }

  useEffect(() => {
    void loadRuns();
  }, [runType]);

  useEffect(() => {
    void loadFindings();
  }, [severity, status, selectedRunId, runType]);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label>
          <span>Run type</span>
          <select
            value={runType}
            onChange={(event) => {
              setSelectedRunId(null);
              setRunType(event.target.value as ReconciliationRunType);
            }}
          >
            {RUN_TYPE_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon-button"
          onClick={() => setRunDialogOpen(true)}
          type="button"
        >
          <PlayCircle aria-hidden="true" size={17} />
          <span>立即对账</span>
        </button>
        <button
          className="icon-button"
          onClick={() => void loadAll()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>刷新</span>
        </button>
        <span className="toolbar__meta">
          dry-run 默认开启，dry-run 不进入风险中心
        </span>
      </div>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {loadingRuns || loadingFindings ? (
        <p className="notice">加载中...</p>
      ) : null}

      <div className="metric-strip">
        <span>
          <strong>{latestRun ? getRunStatus(latestRun) : "-"}</strong>
          <small>最近一次状态</small>
        </span>
        <span>
          <strong>{summary.findingCount}</strong>
          <small>异常总数</small>
        </span>
        <span>
          <strong>{summary.criticalCount}</strong>
          <small>critical</small>
        </span>
        <span>
          <strong>{summary.riskEventCount}</strong>
          <small>risk event</small>
        </span>
        <span>
          <strong>{summary.checkedCount}</strong>
          <small>checked</small>
        </span>
      </div>

      <section className="detail-panel" aria-label="Run history">
        <div className="detail-panel__header">
          <div>
            <h2>Run history</h2>
            <p>
              {latestRun
                ? `${formatRunType(getRunType(latestRun))} / ${formatDate(
                    latestRun.started_at,
                  )}`
                : "暂无对账记录"}
            </p>
          </div>
          {latestRun ? <StatusBadge status={getRunStatus(latestRun)} /> : null}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run id</th>
                <th>Run type</th>
                <th>Status</th>
                <th>Finding count</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Elapsed</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={7}>暂无 run history</td>
                </tr>
              ) : (
                runs.map((run) => {
                  const runId = getRunId(run);

                  return (
                    <tr
                      className={selectedRunId === runId ? "is-selected" : ""}
                      key={runId}
                      onClick={() => setSelectedRunId(runId)}
                    >
                      <td>
                        <strong>{runId ? shortId(runId) : "-"}</strong>
                        <small>{run.created_by ?? "-"}</small>
                      </td>
                      <td>{formatRunType(getRunType(run))}</td>
                      <td>
                        <StatusBadge status={getRunStatus(run)} />
                      </td>
                      <td>{getRunFindingCount(run)}</td>
                      <td>{formatDate(run.started_at)}</td>
                      <td>{formatDate(run.finished_at)}</td>
                      <td>{formatElapsed(getRunElapsedMs(run))}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="detail-panel" aria-label="Findings">
        <div className="detail-panel__header">
          <div>
            <h2>Findings</h2>
            <p>
              {selectedRunId
                ? `当前 run ${shortId(selectedRunId)}，critical 默认置顶`
                : "critical 默认置顶"}
            </p>
          </div>
          <StatusBadge status={status || "all"} />
        </div>
        <div className="toolbar">
          <label>
            <span>Severity</span>
            <select
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as typeof severity)
              }
            >
              {SEVERITY_FILTERS.map((item) => (
                <option key={item || "all"} value={item}>
                  {item || "全部"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as typeof status)
              }
            >
              {STATUS_FILTERS.map((item) => (
                <option key={item || "all"} value={item}>
                  {item || "全部"}
                </option>
              ))}
            </select>
          </label>
          <button
            className="icon-button"
            onClick={() => void loadFindings()}
            type="button"
          >
            <Search aria-hidden="true" size={17} />
            <span>查询</span>
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Finding</th>
                <th>Status</th>
                <th>Source</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleFindings.length === 0 ? (
                <tr>
                  <td colSpan={6}>暂无 findings</td>
                </tr>
              ) : (
                visibleFindings.map((finding) => (
                  <FindingRow
                    busy={busyFindingId === getFindingRiskEventId(finding)}
                    finding={finding}
                    key={buildFindingKey(finding)}
                    onResolve={(nextStatus) =>
                      setResolveDraft({ finding, status: nextStatus })
                    }
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <RunNowDialog
        dryRun={dryRun}
        isOpen={runDialogOpen}
        pending={running}
        runType={runType}
        onCancel={() => setRunDialogOpen(false)}
        onConfirm={(reason) => void confirmRunNow(reason)}
        onDryRunChange={setDryRun}
      />

      <ResolveFindingDialog
        draft={resolveDraft}
        isOpen={resolveDraft !== null}
        pending={
          resolveDraft
            ? busyFindingId === getFindingRiskEventId(resolveDraft.finding)
            : false
        }
        onCancel={() => setResolveDraft(null)}
        onConfirm={(confirmation) => void confirmResolve(confirmation)}
      />
    </section>
  );
}

function FindingRow(props: {
  busy: boolean;
  finding: ReconciliationFinding;
  onResolve: (status: ResolveReconciliationFindingStatus) => void;
}) {
  const status = getFindingStatus(props.finding);
  const canResolve = canResolveFinding(props.finding);

  return (
    <tr
      className={`payment-diagnostics-row--${getFindingSeverity(props.finding)}`}
    >
      <td>
        <StatusBadge status={getFindingSeverity(props.finding)} />
      </td>
      <td>
        <strong>{getFindingCode(props.finding)}</strong>
        <small>{getFindingMessage(props.finding)}</small>
        <small>{getSuggestedAction(props.finding)}</small>
      </td>
      <td>
        <StatusBadge status={status} />
      </td>
      <td>
        <strong>{getFindingSourceType(props.finding)}</strong>
        <small>{getFindingSourceId(props.finding) ?? "-"}</small>
      </td>
      <td>{formatDate(getFindingCreatedAt(props.finding))}</td>
      <td className="action-cell">
        <button
          className="text-button"
          disabled={props.busy || !canResolve}
          onClick={() => props.onResolve("ignored")}
          type="button"
        >
          忽略
        </button>
        <button
          className="text-button"
          disabled={props.busy || !canResolve}
          onClick={() => props.onResolve("fixed")}
          type="button"
        >
          标记已修复
        </button>
        <button
          className="text-button"
          disabled={props.busy || !canResolve}
          onClick={() => props.onResolve("escalated")}
          type="button"
        >
          升级处理
        </button>
        <button
          className="text-button"
          disabled={props.busy || !canResolve}
          onClick={() => props.onResolve("reviewing")}
          type="button"
        >
          复核中
        </button>
        <button
          className="text-button"
          disabled={props.busy || !canResolve}
          onClick={() => props.onResolve("false_positive")}
          type="button"
        >
          误报
        </button>
        <a
          className="text-button text-button--with-icon"
          href={buildDetailHref(props.finding)}
        >
          <ExternalLink aria-hidden="true" size={14} />
          <span>跳转详情</span>
        </a>
      </td>
    </tr>
  );
}

function RunNowDialog(props: {
  dryRun: boolean;
  isOpen: boolean;
  pending: boolean;
  runType: ReconciliationRunType;
  onCancel: () => void;
  onConfirm: (confirmation: RunNowConfirmation) => void | Promise<void>;
  onDryRunChange: (value: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [targetCode, setTargetCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const expectedCode = buildDangerTargetCode(props.runType);

  useEffect(() => {
    if (!props.isOpen) {
      setReason("");
      setTargetCode("");
      setLocalError(null);
      props.onDryRunChange(true);
    }
  }, [props.isOpen, props.onDryRunChange]);

  if (!props.isOpen) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (reason.trim().length < MIN_REASON_LENGTH) {
      setLocalError(`操作原因至少 ${MIN_REASON_LENGTH} 个字符`);
      return;
    }

    if (targetCode.trim() !== expectedCode) {
      setLocalError("目标确认码不匹配");
      return;
    }

    setLocalError(null);
    await props.onConfirm({
      reason: reason.trim(),
      confirmationTarget: props.runType,
      confirmationCode: targetCode.trim(),
    });
  }

  return (
    <div className="danger-dialog-backdrop" role="presentation">
      <form
        aria-modal="true"
        className="danger-dialog"
        onSubmit={(event) => void submit(event)}
        role="dialog"
      >
        <div className="danger-dialog__header">
          <span className="danger-dialog__icon">
            {props.dryRun ? (
              <ShieldAlert aria-hidden="true" size={20} />
            ) : (
              <AlertTriangle aria-hidden="true" size={20} />
            )}
          </span>
          <div>
            <h2>立即对账</h2>
            <p>
              run type {props.runType}，
              {props.dryRun ? "dry-run 不进入风险中心" : "异常会写入风险中心"}
            </p>
          </div>
        </div>

        <div className="danger-dialog__target">
          <span>
            <small>Run type</small>
            <strong>{props.runType}</strong>
          </span>
          <span>
            <small>确认码</small>
            <strong>{expectedCode}</strong>
          </span>
        </div>

        <label className="checkbox-row">
          <input
            checked={props.dryRun}
            disabled={props.pending}
            onChange={(event) => props.onDryRunChange(event.target.checked)}
            type="checkbox"
          />
          <span>Dry-run</span>
        </label>
        <label>
          <span>原因</span>
          <textarea
            disabled={props.pending}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            value={reason}
          />
        </label>
        <label>
          <span>输入确认码</span>
          <input
            disabled={props.pending}
            onChange={(event) => setTargetCode(event.target.value)}
            value={targetCode}
          />
        </label>

        {localError ? (
          <p className="notice notice--error">{localError}</p>
        ) : null}

        <div className="button-row">
          <button
            className="text-button"
            disabled={props.pending}
            onClick={props.onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className={
              props.dryRun ? "icon-button" : "icon-button icon-button--danger"
            }
            disabled={props.pending}
            type="submit"
          >
            {props.dryRun ? (
              <CheckCircle2 aria-hidden="true" size={16} />
            ) : (
              <AlertTriangle aria-hidden="true" size={16} />
            )}
            <span>{props.pending ? "提交中" : "确认对账"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function ResolveFindingDialog(props: {
  draft: ResolveDraft | null;
  isOpen: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (confirmation: ResolveConfirmation) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [targetCode, setTargetCode] = useState("");
  const [extraValue, setExtraValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const findingId = props.draft
    ? (getFindingRiskEventId(props.draft.finding) ?? "")
    : "";
  const expectedCode = buildDangerTargetCode(findingId);
  const extraConfig = props.draft
    ? getResolutionExtraConfig(props.draft.status)
    : null;

  useEffect(() => {
    if (!props.isOpen) {
      setReason("");
      setTargetCode("");
      setExtraValue("");
      setLocalError(null);
    }
  }, [props.isOpen]);

  if (!props.isOpen || !props.draft) {
    return null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = props.draft;

    if (!draft) {
      return;
    }

    if (reason.trim().length < MIN_REASON_LENGTH) {
      setLocalError(`操作原因至少 ${MIN_REASON_LENGTH} 个字符`);
      return;
    }

    if (targetCode.trim() !== expectedCode) {
      setLocalError("目标确认码不匹配");
      return;
    }

    if (extraConfig?.required && extraValue.trim().length === 0) {
      setLocalError(`${extraConfig.label}不能为空`);
      return;
    }

    setLocalError(null);
    await props.onConfirm(
      buildResolveConfirmation(draft.status, reason, extraValue, {
        confirmationTarget: findingId,
        confirmationCode: targetCode.trim(),
      }),
    );
  }

  return (
    <div className="danger-dialog-backdrop" role="presentation">
      <form
        aria-modal="true"
        className="danger-dialog"
        onSubmit={(event) => void submit(event)}
        role="dialog"
      >
        <div className="danger-dialog__header">
          <span className="danger-dialog__icon">
            <AlertTriangle aria-hidden="true" size={20} />
          </span>
          <div>
            <h2>更新 finding 状态为 {props.draft.status}</h2>
            <p>
              {getFindingCode(props.draft.finding)} /{" "}
              {getFindingMessage(props.draft.finding)}
            </p>
          </div>
        </div>

        <div className="danger-dialog__target">
          <span>
            <small>Finding</small>
            <strong>{shortId(findingId)}</strong>
          </span>
          <span>
            <small>确认码</small>
            <strong>{expectedCode}</strong>
          </span>
        </div>

        {extraConfig ? (
          <label>
            <span>{extraConfig.label}</span>
            <input
              disabled={props.pending}
              onChange={(event) => setExtraValue(event.target.value)}
              placeholder={extraConfig.placeholder}
              value={extraValue}
            />
          </label>
        ) : null}
        <label>
          <span>原因</span>
          <textarea
            disabled={props.pending}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            value={reason}
          />
        </label>
        <label>
          <span>输入确认码</span>
          <input
            disabled={props.pending}
            onChange={(event) => setTargetCode(event.target.value)}
            value={targetCode}
          />
        </label>

        {localError ? (
          <p className="notice notice--error">{localError}</p>
        ) : null}

        <div className="button-row">
          <button
            className="text-button"
            disabled={props.pending}
            onClick={props.onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="icon-button icon-button--danger"
            disabled={props.pending}
            type="submit"
          >
            <AlertTriangle aria-hidden="true" size={16} />
            <span>
              {props.pending
                ? "提交中"
                : getResolveConfirmLabel(props.draft.status)}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}

function readRuns(
  response: ReconciliationRunsResponse | null,
): ReconciliationRun[] {
  return response?.items ?? response?.runs ?? [];
}

function readFindings(
  response: ReconciliationFindingsResponse | null,
): ReconciliationFinding[] {
  return response?.items ?? response?.findings ?? [];
}

function readLatestRun(
  response: ReconciliationRunsResponse | null,
  runs: ReconciliationRun[],
): ReconciliationRun | null {
  return (
    response?.summary?.latestRun ??
    response?.summary?.latest_run ??
    runs[0] ??
    null
  );
}

function buildSummary(
  runsData: ReconciliationRunsResponse | null,
  findingsData: ReconciliationFindingsResponse | null,
  runs: ReconciliationRun[],
  findings: ReconciliationFinding[],
) {
  const summary = runsData?.summary ?? findingsData?.summary;
  const latestRun = readLatestRun(runsData, runs);

  return {
    findingCount:
      readNumber(summary?.findingCount) ??
      readNumber(summary?.finding_count) ??
      readNumber(findingsData?.findingCount) ??
      (latestRun ? getRunFindingCount(latestRun) : findings.length),
    criticalCount:
      readNumber(summary?.criticalCount) ??
      readNumber(summary?.critical_count) ??
      readNumber(findingsData?.criticalCount) ??
      findings.filter((finding) => getFindingSeverity(finding) === "critical")
        .length,
    riskEventCount:
      readNumber(summary?.riskEventCount) ??
      readNumber(summary?.risk_event_count) ??
      readNumber(findingsData?.riskEventCount) ??
      (latestRun
        ? getRunRiskEventCount(latestRun)
        : findings.filter((finding) => getFindingRiskEventId(finding)).length),
    checkedCount:
      readNumber(summary?.checkedCount) ??
      readNumber(summary?.checked_count) ??
      readNumber(runsData?.checkedCount) ??
      (latestRun ? getRunCheckedCount(latestRun) : 0),
  };
}

function compareFindings(
  left: ReconciliationFinding,
  right: ReconciliationFinding,
): number {
  const leftWeight = SEVERITY_WEIGHT[getFindingSeverity(left)] ?? 9;
  const rightWeight = SEVERITY_WEIGHT[getFindingSeverity(right)] ?? 9;

  if (leftWeight !== rightWeight) {
    return leftWeight - rightWeight;
  }

  return getFindingCreatedAt(right).localeCompare(getFindingCreatedAt(left));
}

function getRunId(run: ReconciliationRun | undefined): string | null {
  return run?.id ?? run?.runId ?? null;
}

function getRunType(run: ReconciliationRun): string {
  return run.run_type ?? run.runType ?? "-";
}

function getRunStatus(run: ReconciliationRun): string {
  return run.status || "unknown";
}

function getRunFindingCount(run: ReconciliationRun): number {
  return (
    readNumber(run.findingCount) ??
    readNumber(run.finding_count) ??
    readResultNumber(run, "finding_count") ??
    0
  );
}

function getRunRiskEventCount(run: ReconciliationRun): number {
  return (
    readNumber(run.riskEventCount) ??
    readNumber(run.risk_event_count) ??
    readNumber(run.riskEventInsertedCount) ??
    readNumber(run.risk_event_inserted_count) ??
    readResultNumber(run, "risk_event_count") ??
    readResultNumber(run, "risk_event_inserted_count") ??
    0
  );
}

function getRunCheckedCount(run: ReconciliationRun): number {
  return (
    readNumber(run.checkedCount) ??
    readNumber(run.checked_count) ??
    readResultNumber(run, "checked_count") ??
    0
  );
}

function getRunElapsedMs(run: ReconciliationRun): number | null {
  return (
    readNumber(run.elapsedMs) ??
    readNumber(run.elapsed_ms) ??
    readResultNumber(run, "elapsed_ms")
  );
}

function readResultNumber(run: ReconciliationRun, key: string): number | null {
  const result = asRecord(run.result);
  return readNumber(result?.[key]);
}

function getFindingRiskEventId(finding: ReconciliationFinding): string | null {
  return finding.risk_event_id ?? finding.riskEventId ?? null;
}

function getFindingDisplayId(finding: ReconciliationFinding): string | null {
  return (
    getFindingRiskEventId(finding) ??
    finding.id ??
    `${getFindingRunId(finding) ?? "run"}:${getFindingCode(finding)}`
  );
}

function getFindingCode(finding: ReconciliationFinding): string {
  return finding.code ?? finding.event_type ?? "-";
}

function getFindingMessage(finding: ReconciliationFinding): string {
  return (
    finding.message ??
    readString(asRecord(finding.detail)?.message) ??
    "对账异常"
  );
}

function getFindingSeverity(finding: ReconciliationFinding): string {
  return String(finding.severity || "unknown");
}

function getFindingStatus(finding: ReconciliationFinding): string {
  if (isDryRunFinding(finding)) {
    return "dry_run";
  }

  return getFindingRawStatus(finding);
}

function getFindingRawStatus(finding: ReconciliationFinding): string {
  return String(finding.status || "open");
}

function getFindingSourceType(finding: ReconciliationFinding): string {
  return finding.source_type ?? finding.sourceType ?? "-";
}

function getFindingSourceId(finding: ReconciliationFinding): string | null {
  return finding.source_id ?? finding.sourceId ?? null;
}

function getFindingCreatedAt(finding: ReconciliationFinding): string {
  return finding.created_at ?? finding.createdAt ?? "";
}

function getFindingRunId(finding: ReconciliationFinding): string | null {
  const detail = asRecord(finding.detail);

  return (
    finding.reconciliation_run_id ??
    finding.reconciliationRunId ??
    readString(detail?.reconciliation_run_id)
  );
}

function getSuggestedAction(finding: ReconciliationFinding): string {
  return (
    finding.suggestedAction ??
    finding.suggested_action ??
    readString(asRecord(finding.detail)?.suggested_action) ??
    "-"
  );
}

function buildFindingKey(finding: ReconciliationFinding): string {
  return [
    getFindingDisplayId(finding),
    getFindingCode(finding),
    getFindingSourceType(finding),
    getFindingSourceId(finding),
  ]
    .filter(Boolean)
    .join(":");
}

function canResolveFinding(finding: ReconciliationFinding): boolean {
  const status = getFindingStatus(finding);

  return (
    Boolean(getFindingRiskEventId(finding)) &&
    !isDryRunFinding(finding) &&
    ["open", "reviewing"].includes(status)
  );
}

function isDryRunFinding(finding: ReconciliationFinding): boolean {
  return finding.dryRun === true || finding.dry_run === true;
}

function buildDetailHref(finding: ReconciliationFinding): string {
  const sourceType = getFindingSourceType(finding);
  const detail = asRecord(finding.detail);
  const starOrderId = readString(
    finding.star_order_id ?? finding.starOrderId ?? detail?.star_order_id,
  );
  const mintQueueId = readString(
    finding.mint_queue_id ?? finding.mintQueueId ?? detail?.mint_queue_id,
  );
  const drawOrderId = readString(
    finding.draw_order_id ?? finding.drawOrderId ?? detail?.draw_order_id,
  );
  const sourceId = getFindingSourceId(finding);

  if (starOrderId) {
    return `#payments?starOrderId=${encodeURIComponent(starOrderId)}`;
  }

  if (mintQueueId) {
    return `#mint?mintQueueId=${encodeURIComponent(mintQueueId)}`;
  }

  if (sourceType.includes("market") && sourceId) {
    return `#audit?targetSchema=market&targetTable=orders&targetId=${encodeURIComponent(sourceId)}`;
  }

  if (drawOrderId) {
    return `#payments?drawOrderId=${encodeURIComponent(drawOrderId)}`;
  }

  if (sourceType.includes("wallet")) {
    return "#wallets";
  }

  if (sourceType.includes("gacha")) {
    return "#gacha-pools";
  }

  return "#danger";
}

function getResolveConfirmLabel(status: ResolveReconciliationFindingStatus) {
  if (status === "ignored") {
    return "确认忽略";
  }

  if (status === "fixed") {
    return "确认已修复";
  }

  if (status === "escalated") {
    return "确认升级";
  }

  if (status === "false_positive") {
    return "确认误报";
  }

  return "确认复核";
}

function getResolutionExtraConfig(status: ResolveReconciliationFindingStatus):
  | {
      label: string;
      placeholder: string;
      required: boolean;
    }
  | null {
  if (status === "fixed") {
    return {
      label: "修复方式",
      placeholder: "例如：已通过后台重试发货并核对 ledger",
      required: true,
    };
  }

  if (status === "escalated") {
    return {
      label: "工单或负责人",
      placeholder: "例如：OPS-123 或 @ops-owner",
      required: true,
    };
  }

  return null;
}

function buildResolveConfirmation(
  status: ResolveReconciliationFindingStatus,
  reason: string,
  extraValue: string,
  confirmation: {
    confirmationTarget: string;
    confirmationCode: string;
  },
): ResolveConfirmation {
  const trimmedExtra = extraValue.trim();

  if (status === "fixed") {
    return {
      reason: reason.trim(),
      resolutionDetail: {
        fix_method: trimmedExtra,
      },
      fixMethod: trimmedExtra,
      ...confirmation,
    };
  }

  if (status === "escalated") {
    return {
      reason: reason.trim(),
      resolutionDetail: {
        escalation_owner: trimmedExtra,
      },
      escalationOwner: trimmedExtra,
      ...confirmation,
    };
  }

  return {
    reason: reason.trim(),
    resolutionDetail: {},
    ...confirmation,
  };
}

function formatRunType(runType: string): string {
  const shortName = mapJobTypeToShortName(runType);
  return shortName === runType ? runType : `${shortName} / ${runType}`;
}

function mapJobTypeToShortName(runType: string): string {
  const mapping: Record<string, ReconciliationRunType> = {
    payment_fulfillment: "payment",
    ledger_balance: "ledger",
    market_settlement: "market",
    inventory_lock: "inventory",
    gacha_stock: "gacha",
    referral_commission: "referral",
    mint_queue: "mint",
    wallet_sync: "wallet",
  };

  return mapping[runType] ?? runType;
}

function formatElapsed(value: number | null): string {
  if (value === null) {
    return "-";
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  return `${(value / 1000).toFixed(1)} s`;
}

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
