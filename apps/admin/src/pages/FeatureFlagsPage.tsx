import { PauseCircle, PlayCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchFeatureFlags, updateFeatureFlag } from "../admin.api";
import type { FeatureFlag, FeatureFlagsResponse } from "../admin.types";
import { formatDate, StatusBadge } from "../admin.ui";
import { ConfirmDangerDialog } from "../components/ConfirmDangerDialog";

const IMPORTANT_KEYS = new Set([
  "FEATURE_STARS_PAYMENT_ENABLED",
  "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
  "FEATURE_MARKET_ENABLED",
  "FEATURE_TON_MINT_ENABLED",
  "FEATURE_MINT_WORKER_ENABLED",
  "gacha.open_box",
  "market.enabled",
  "onchain.mint",
]);
const PAYMENT_FLAG_KEYS = new Set([
  "FEATURE_STARS_PAYMENT_ENABLED",
  "FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED",
  "gacha.open_box",
]);
const MARKET_FLAG_KEYS = new Set(["FEATURE_MARKET_ENABLED", "market.enabled"]);
const MINT_FLAG_KEYS = new Set([
  "FEATURE_TON_MINT_ENABLED",
  "FEATURE_MINT_WORKER_ENABLED",
  "onchain.mint",
]);
type FlagDangerDraft = {
  flag: FeatureFlag;
  nextEnabled: boolean;
};

export function FeatureFlagsPage() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<FeatureFlagsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dangerDraft, setDangerDraft] = useState<FlagDangerDraft | null>(null);

  const sortedFlags = useMemo(() => {
    return [...(data?.items ?? [])].sort((left, right) => {
      const leftWeight = IMPORTANT_KEYS.has(left.key) ? 0 : 1;
      const rightWeight = IMPORTANT_KEYS.has(right.key) ? 0 : 1;
      return leftWeight - rightWeight || left.key.localeCompare(right.key);
    });
  }, [data]);
  const paymentFlags = sortedFlags.filter((flag) =>
    PAYMENT_FLAG_KEYS.has(flag.key),
  );
  const marketFlags = sortedFlags.filter((flag) =>
    MARKET_FLAG_KEYS.has(flag.key),
  );
  const mintFlags = sortedFlags.filter((flag) => MINT_FLAG_KEYS.has(flag.key));

  async function load() {
    setLoading(true);
    setError(null);

    try {
      setData(await fetchFeatureFlags({ q: query || undefined }));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "功能开关加载失败",
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirmToggle(reason: string) {
    if (!dangerDraft) {
      return;
    }

    const { flag, nextEnabled } = dangerDraft;
    setBusyKey(flag.key);
    setError(null);

    try {
      await updateFeatureFlag({
        key: flag.key,
        enabled: nextEnabled,
        description: flag.description,
        reason,
      });
      setDangerDraft(null);
      await load();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error ? toggleError.message : "更新开关失败",
      );
    } finally {
      setBusyKey(null);
    }
  }

  function toggle(flag: FeatureFlag) {
    setDangerDraft({
      flag,
      nextEnabled: !flag.enabled,
    });
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="admin-surface">
      <div className="toolbar">
        <label className="toolbar__search">
          <span>Key</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void load();
              }
            }}
            placeholder="feature flag key"
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

      {error ? <p className="notice notice--error">{error}</p> : null}
      {loading ? <p className="notice">加载中...</p> : null}

      <div className="ops-grid">
        <FlagGroup
          busyKey={busyKey}
          emptyText="未找到支付暂停开关"
          flags={paymentFlags}
          title="支付暂停开关"
          toggle={toggle}
        />
        <FlagGroup
          busyKey={busyKey}
          emptyText="未找到 Mint 暂停开关"
          flags={mintFlags}
          title="Mint 暂停开关"
          toggle={toggle}
        />
        <FlagGroup
          busyKey={busyKey}
          emptyText="未找到 market 暂停开关"
          flags={marketFlags}
          title="Market 暂停开关"
          toggle={toggle}
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>状态</th>
              <th>说明</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedFlags.map((flag) => (
              <FlagRow
                busy={busyKey === flag.key}
                flag={flag}
                key={flag.key}
                toggle={toggle}
              />
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDangerDialog
        confirmLabel={
          dangerDraft?.nextEnabled
            ? "确认启用"
            : dangerDraft
              ? "确认暂停"
              : "确认"
        }
        description={dangerDraft?.flag.description ?? undefined}
        isOpen={dangerDraft !== null}
        pending={dangerDraft ? busyKey === dangerDraft.flag.key : false}
        targetLabel="Feature flag"
        targetValue={dangerDraft?.flag.key ?? ""}
        title={
          dangerDraft
            ? `${dangerDraft.nextEnabled ? "启用" : "暂停"} ${
                dangerDraft.flag.key
              }`
            : "确认功能开关"
        }
        onCancel={() => setDangerDraft(null)}
        onConfirm={(confirmation) => confirmToggle(confirmation.reason)}
      />
    </section>
  );
}

function FlagGroup(props: {
  busyKey: string | null;
  emptyText: string;
  flags: FeatureFlag[];
  title: string;
  toggle: (flag: FeatureFlag) => void;
}) {
  return (
    <section className="ops-card">
      <h2>{props.title}</h2>
      {props.flags.length === 0 ? (
        <p className="muted">{props.emptyText}</p>
      ) : (
        <div className="stack-list">
          {props.flags.map((flag) => (
            <FlagRow
              busy={props.busyKey === flag.key}
              compact
              flag={flag}
              key={flag.key}
              toggle={props.toggle}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FlagRow(props: {
  busy: boolean;
  compact?: boolean;
  flag: FeatureFlag;
  toggle: (flag: FeatureFlag) => void;
}) {
  const actionLabel = props.flag.enabled ? "暂停" : "启用";
  const actionTitle = props.flag.enabled ? "暂停该开关" : "启用该开关";
  const status = props.flag.enabled ? "enabled" : "paused";
  const button = (
    <button
      className={
        props.flag.enabled ? "icon-button icon-button--danger" : "icon-button"
      }
      disabled={props.busy}
      onClick={() => props.toggle(props.flag)}
      title={actionTitle}
      type="button"
    >
      {props.flag.enabled ? (
        <PauseCircle aria-hidden="true" size={16} />
      ) : (
        <PlayCircle aria-hidden="true" size={16} />
      )}
      <span>{props.busy ? "提交中" : actionLabel}</span>
    </button>
  );

  if (props.compact) {
    return (
      <div className="list-row">
        <span>
          <strong>{props.flag.key}</strong>
          <small>{props.flag.description ?? "-"}</small>
        </span>
        <span className="list-row__actions">
          <StatusBadge status={status} />
          {button}
        </span>
      </div>
    );
  }

  return (
    <tr>
      <td>
        <strong>{props.flag.key}</strong>
      </td>
      <td>
        <StatusBadge status={status} />
      </td>
      <td>{props.flag.description ?? "-"}</td>
      <td>{formatDate(props.flag.updated_at)}</td>
      <td>{button}</td>
    </tr>
  );
}
