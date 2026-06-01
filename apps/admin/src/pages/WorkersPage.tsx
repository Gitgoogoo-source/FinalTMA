import { PauseCircle, PlayCircle, RefreshCw, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { fetchWorkerRuns, runWorkerNow, toggleWorker } from "../admin.api";
import type {
  WorkerJob,
  WorkerJobName,
  WorkerRun,
  WorkerRunResponse,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";
import { ConfirmDangerDialog } from "../components/ConfirmDangerDialog";

type WorkerActionDraft =
  | {
      type: "run";
      job: WorkerJob;
    }
  | {
      type: "toggle";
      job: WorkerJob;
      enabled: boolean;
    };

export function WorkersPage() {
  const [data, setData] = useState<WorkerRunResponse | null>(null);
  const [selectedJob, setSelectedJob] = useState<WorkerJobName | "">("");
  const [loading, setLoading] = useState(true);
  const [busyJob, setBusyJob] = useState<WorkerJobName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkerActionDraft | null>(null);

  const jobs = data?.jobs ?? [];
  const pageEnabled = data?.pageEnabled ?? data?.page_enabled ?? true;
  const pageDisabledReason =
    data?.disabledReason ?? data?.disabled_reason ?? "Workers page disabled";
  const pageDisabled = !pageEnabled;
  const selectedRuns = useMemo(() => {
    const runs = data?.runs ?? [];

    return selectedJob
      ? runs.filter((run) => normalizeJobName(run) === selectedJob)
      : runs;
  }, [data, selectedJob]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      setData(await fetchWorkerRuns({ limit: 50, jobName: selectedJob }));
    } catch (loadError) {
      setError(formatError(loadError, "Worker 运行历史加载失败"));
    } finally {
      setLoading(false);
    }
  }

  async function confirmAction(confirmation: { reason: string }) {
    if (!draft) {
      return;
    }

    const jobName = normalizeJobName(draft.job);
    setBusyJob(jobName);
    setError(null);
    setNotice(null);

    try {
      if (draft.type === "run") {
        const result = await runWorkerNow({
          jobName,
          reason: confirmation.reason,
          params: {},
        });
        setNotice(`Worker 已完成：${String(result.status ?? "submitted")}`);
      } else {
        await toggleWorker({
          jobName,
          enabled: draft.enabled,
          reason: confirmation.reason,
        });
        setNotice(draft.enabled ? "Worker 已启用。" : "Worker 已暂停。");
      }

      setDraft(null);
      await load();
    } catch (actionError) {
      setError(formatError(actionError, "Worker 操作失败"));
    } finally {
      setBusyJob(null);
    }
  }

  useEffect(() => {
    void load();
  }, [selectedJob]);

  return (
    <section className="admin-surface workers-page">
      <div className="toolbar">
        <label className="toolbar__search">
          <span>Job</span>
          <select
            onChange={(event) =>
              setSelectedJob(event.target.value as WorkerJobName | "")
            }
            value={selectedJob}
          >
            <option value="">All jobs</option>
            {jobs.map((job) => (
              <option key={normalizeJobName(job)} value={normalizeJobName(job)}>
                {job.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon-button"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>刷新</span>
        </button>
      </div>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {notice ? <p className="notice notice--success">{notice}</p> : null}
      {pageDisabled ? (
        <p className="notice notice--warning">{pageDisabledReason}</p>
      ) : null}
      {loading ? <p className="notice">加载中...</p> : null}

      <div className="worker-grid">
        {jobs.map((job) => (
          <WorkerJobPanel
            busy={busyJob === normalizeJobName(job)}
            job={job}
            key={normalizeJobName(job)}
            pageDisabled={pageDisabled}
            onRun={() => setDraft({ type: "run", job })}
            onToggle={() =>
              setDraft({
                type: "toggle",
                job,
                enabled: !job.enabled,
              })
            }
          />
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>状态</th>
              <th>触发</th>
              <th>开始</th>
              <th>完成</th>
              <th>处理</th>
              <th>失败</th>
              <th>错误摘要</th>
              <th>日志</th>
            </tr>
          </thead>
          <tbody>
            {selectedRuns.map((run) => (
              <WorkerRunRow key={run.id ?? run.request_id} run={run} />
            ))}
            {selectedRuns.length === 0 && !loading ? (
              <tr>
                <td colSpan={9}>暂无 Worker run。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ConfirmDangerDialog
        confirmLabel={draft?.type === "toggle" ? "确认变更" : "确认运行"}
        description={draft ? buildDraftDescription(draft) : undefined}
        isOpen={draft !== null}
        pending={draft ? busyJob === normalizeJobName(draft.job) : false}
        targetLabel="Worker"
        targetValue={draft ? normalizeJobName(draft.job) : ""}
        title={draft ? buildDraftTitle(draft) : "Worker 操作确认"}
        onCancel={() => setDraft(null)}
        onConfirm={confirmAction}
      />
    </section>
  );
}

function WorkerJobPanel(props: {
  busy: boolean;
  job: WorkerJob;
  pageDisabled: boolean;
  onRun: () => void;
  onToggle: () => void;
}) {
  const lastRun = props.job.lastRun ?? props.job.last_run;

  return (
    <section className="detail-panel worker-panel">
      <div className="worker-panel__header">
        <div>
          <h2>{props.job.label}</h2>
          <p>{props.job.description}</p>
        </div>
        <StatusBadge status={props.job.enabled ? "enabled" : "disabled"} />
      </div>
      <div className="metric-grid metric-grid--compact">
        <Metric
          label="Last run"
          value={formatDate(lastRun?.started_at ?? null)}
        />
        <Metric
          label="Last status"
          value={lastRun ? <StatusBadge status={lastRun.status} /> : "-"}
        />
        <Metric
          label="Processed"
          value={String(lastRun?.processed_count ?? 0)}
        />
        <Metric label="Failed" value={String(lastRun?.failed_count ?? 0)} />
      </div>
      <dl className="worker-meta">
        <div>
          <dt>Schedule</dt>
          <dd>{props.job.schedule}</dd>
        </div>
        <div>
          <dt>Next</dt>
          <dd>{props.job.nextRunHint ?? props.job.next_run_hint}</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>{props.job.cronPath ?? props.job.cron_path}</dd>
        </div>
      </dl>
      {!props.job.enabled ? (
        <p className="notice notice--warning">
          {props.job.disabledReason ?? props.job.disabled_reason}
        </p>
      ) : null}
      <div className="button-row">
        <button
          className="icon-button"
          disabled={props.busy || !props.job.enabled || props.pageDisabled}
          onClick={props.onRun}
          type="button"
        >
          <PlayCircle aria-hidden="true" size={16} />
          <span>{props.busy ? "运行中" : "立即运行"}</span>
        </button>
        <button
          className="icon-button"
          disabled={props.busy || props.pageDisabled}
          onClick={props.onToggle}
          type="button"
        >
          {props.job.enabled ? (
            <PauseCircle aria-hidden="true" size={16} />
          ) : (
            <RotateCw aria-hidden="true" size={16} />
          )}
          <span>{props.job.enabled ? "暂停" : "启用"}</span>
        </button>
      </div>
    </section>
  );
}

function WorkerRunRow({ run }: { run: WorkerRun }) {
  return (
    <tr>
      <td>
        <strong>{run.label ?? normalizeJobName(run)}</strong>
        <small>{shortId(run.request_id)}</small>
      </td>
      <td>
        <StatusBadge status={run.status} />
      </td>
      <td>{run.triggered_by}</td>
      <td>{formatDate(run.started_at)}</td>
      <td>{formatDate(run.finished_at)}</td>
      <td>{run.processed_count}</td>
      <td>{run.failed_count}</td>
      <td>{run.error_message ?? "-"}</td>
      <td>
        <details>
          <summary>JSON</summary>
          <pre className="json-preview">
            {JSON.stringify(run.result ?? {}, null, 2)}
          </pre>
        </details>
      </td>
    </tr>
  );
}

function Metric(props: { label: string; value: ReactNode }) {
  return (
    <div className="metric-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function normalizeJobName(value: WorkerJob | WorkerRun): WorkerJobName {
  return (value.jobName ?? value.job_name) as WorkerJobName;
}

function buildDraftTitle(draft: WorkerActionDraft): string {
  if (draft.type === "run") {
    return `立即运行 ${draft.job.label}`;
  }

  return `${draft.enabled ? "启用" : "暂停"} ${draft.job.label}`;
}

function buildDraftDescription(draft: WorkerActionDraft): string {
  if (draft.type === "run") {
    return "手动运行会写入 job run 和管理员审计。";
  }

  return "开关变更会通过 feature flag 审计 RPC 写入管理员审计。";
}

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
