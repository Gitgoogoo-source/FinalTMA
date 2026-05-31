import {
  ChevronLeft,
  ChevronRight,
  Flag,
  RefreshCw,
  Search,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  applyUserFlag,
  clearUserFlag,
  fetchRiskEvents,
  fetchRiskUserProfile,
  resolveRiskEvent,
} from "../admin.api";
import type {
  ResolveRiskEventStatus,
  RiskEvent,
  RiskEventFilters,
  RiskEventsResponse,
  RiskEventStatus,
  RiskSeverity,
  RiskUserProfileSection,
  RiskUserProfile,
  UserFlag,
  UserFlagLevel,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";
import { ConfirmDangerDialog } from "../components/ConfirmDangerDialog";

const PAGE_LIMIT = 30;
const PROFILE_SECTION_LIMIT = 20;
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
const USER_FLAG_CODES = [
  "gacha_blocked",
  "market_buy_blocked",
  "market_sell_blocked",
  "task_reward_blocked",
  "mint_blocked",
  "kcoin_frozen",
  "fgems_frozen",
  "support_review_required",
] as const;
const TERMINAL_STATUSES = new Set([
  "resolved",
  "ignored",
  "fixed",
  "false_positive",
  "escalated",
]);
const ASSOCIATION_KEY_RE =
  /(source|order|wallet|market|payment|reconciliation|run|listing|mint|tx|charge|invoice|payload|finding)/i;

type RiskFilterDraft = {
  severity: RiskSeverity | "";
  status: RiskEventStatus | "";
  eventType: string;
  userId: string;
  sourceId: string;
  from: string;
  to: string;
};

type DangerDraft =
  | {
      kind: "resolve";
      event: RiskEvent;
      status: ResolveRiskEventStatus;
    }
  | {
      kind: "applyFlag";
      userId: string;
      flagCode: (typeof USER_FLAG_CODES)[number];
      flagLevel: UserFlagLevel;
    }
  | {
      kind: "clearFlag";
      flag: UserFlag;
    };

const EMPTY_FILTERS: RiskFilterDraft = {
  severity: "",
  status: "open",
  eventType: "",
  userId: "",
  sourceId: "",
  from: "",
  to: "",
};

export function RiskPage(props: { canWriteRisk?: boolean }) {
  const [filters, setFilters] = useState<RiskFilterDraft>(EMPTY_FILTERS);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<string[]>([]);
  const [data, setData] = useState<RiskEventsResponse | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<RiskEvent | null>(null);
  const [profile, setProfile] = useState<RiskUserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSectionLoading, setProfileSectionLoading] =
    useState<RiskUserProfileSection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [dangerDraft, setDangerDraft] = useState<DangerDraft | null>(null);
  const [selectedFlagCode, setSelectedFlagCode] =
    useState<(typeof USER_FLAG_CODES)[number]>("support_review_required");

  const events = data?.items ?? [];
  const selectedUserId = selectedEvent ? getEventUserId(selectedEvent) : null;
  const activeFlags = profile?.flags.active ?? [];
  const summary = useMemo(() => buildSummary(data), [data]);
  const canWriteRisk = props.canWriteRisk === true;

  async function loadEvents(nextCursor: string | null = cursor) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchRiskEvents({
        ...buildRiskParams(filters),
        cursor: nextCursor,
        limit: PAGE_LIMIT,
      });

      setData(response);
      setSelectedEvent((current) => {
        if (
          current &&
          response.items.some((item) => getEventId(item) === getEventId(current))
        ) {
          return current;
        }

        return response.items[0] ?? null;
      });
    } catch (loadError) {
      setError(formatError(loadError, "风险事件加载失败"));
    } finally {
      setLoading(false);
    }
  }

  async function loadProfile(userId: string) {
    setProfileLoading(true);
    setProfileError(null);

    try {
      setProfile(
        await fetchRiskUserProfile(userId, {
          limit: PROFILE_SECTION_LIMIT,
        }),
      );
    } catch (loadError) {
      setProfileError(formatError(loadError, "用户风控画像加载失败"));
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }

  async function loadProfileSection(section: RiskUserProfileSection) {
    if (!selectedUserId || !profile) {
      return;
    }

    const cursor = getProfileSectionNextCursor(profile, section);

    if (!cursor) {
      return;
    }

    setProfileSectionLoading(section);
    setProfileError(null);

    try {
      const nextProfile = await fetchRiskUserProfile(selectedUserId, {
        section,
        cursor,
        limit: PROFILE_SECTION_LIMIT,
      });
      setProfile((current) =>
        current ? mergeProfileSection(current, nextProfile, section) : nextProfile,
      );
    } catch (loadError) {
      setProfileError(formatError(loadError, "用户画像分页加载失败"));
    } finally {
      setProfileSectionLoading(null);
    }
  }

  function updateFilter<K extends keyof RiskFilterDraft>(
    key: K,
    value: RiskFilterDraft[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    setCursor(null);
    setPreviousCursors([]);
    setNotice(null);
    void loadEvents(null);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setCursor(null);
    setPreviousCursors([]);
    setNotice(null);
    void loadEventsWithFilters(EMPTY_FILTERS, null);
  }

  async function loadEventsWithFilters(
    nextFilters: RiskFilterDraft,
    nextCursor: string | null,
  ) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchRiskEvents({
        ...buildRiskParams(nextFilters),
        cursor: nextCursor,
        limit: PAGE_LIMIT,
      });

      setData(response);
      setSelectedEvent(response.items[0] ?? null);
    } catch (loadError) {
      setError(formatError(loadError, "风险事件加载失败"));
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
    void loadEvents(nextCursor);
  }

  function goPreviousPage() {
    const nextStack = previousCursors.slice(0, -1);
    const previousCursor = previousCursors.at(-1) ?? "";
    const normalizedCursor = previousCursor || null;

    setPreviousCursors(nextStack);
    setCursor(normalizedCursor);
    void loadEvents(normalizedCursor);
  }

  async function confirmDanger(reason: string) {
    if (!dangerDraft) {
      return;
    }

    setError(null);
    setNotice(null);

    if (dangerDraft.kind === "resolve") {
      await confirmResolve(dangerDraft, reason);
      return;
    }

    if (dangerDraft.kind === "applyFlag") {
      await confirmApplyFlag(dangerDraft, reason);
      return;
    }

    await confirmClearFlag(dangerDraft, reason);
  }

  async function confirmResolve(
    draft: Extract<DangerDraft, { kind: "resolve" }>,
    reason: string,
  ) {
    const eventId = getEventId(draft.event);
    setBusyTarget(eventId);

    try {
      await resolveRiskEvent({
        riskEventId: eventId,
        status: draft.status,
        reason,
        resolutionDetail: {
          source: "admin_risk_center",
          eventType: getEventType(draft.event),
          previousStatus: getEventStatus(draft.event),
        },
        ...(draft.status === "fixed"
          ? { fixMethod: "admin_risk_center" }
          : {}),
        ...(draft.status === "escalated"
          ? { escalationOwner: "risk_team" }
          : {}),
      });
      setDangerDraft(null);
      setNotice(`风险事件已更新为 ${draft.status}。`);
      await loadEvents();
      if (selectedUserId) {
        await loadProfile(selectedUserId);
      }
    } catch (resolveError) {
      setError(formatError(resolveError, "风险事件处理失败"));
    } finally {
      setBusyTarget(null);
    }
  }

  async function confirmApplyFlag(
    draft: Extract<DangerDraft, { kind: "applyFlag" }>,
    reason: string,
  ) {
    const target = `${draft.userId}:${draft.flagCode}`;
    setBusyTarget(target);

    try {
      await applyUserFlag({
        userId: draft.userId,
        flagCode: draft.flagCode,
        flagLevel: draft.flagLevel,
        reason,
        metadata: {
          source: "admin_risk_center",
          riskEventId: selectedEvent ? getEventId(selectedEvent) : null,
        },
      });
      setDangerDraft(null);
      setNotice(`已应用用户限制 ${draft.flagCode}。`);
      await loadProfile(draft.userId);
    } catch (flagError) {
      setError(formatError(flagError, "应用用户限制失败"));
    } finally {
      setBusyTarget(null);
    }
  }

  async function confirmClearFlag(
    draft: Extract<DangerDraft, { kind: "clearFlag" }>,
    reason: string,
  ) {
    const flagId = getFlagId(draft.flag);
    setBusyTarget(flagId);

    try {
      await clearUserFlag({
        userFlagId: flagId,
        userId: getFlagUserId(draft.flag),
        flagCode: getFlagCode(draft.flag),
        reason,
      });
      setDangerDraft(null);
      setNotice(`已解除用户限制 ${getFlagCode(draft.flag)}。`);
      await loadProfile(getFlagUserId(draft.flag));
    } catch (flagError) {
      setError(formatError(flagError, "解除用户限制失败"));
    } finally {
      setBusyTarget(null);
    }
  }

  useEffect(() => {
    void loadEvents(null);
  }, []);

  useEffect(() => {
    if (!selectedUserId) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    void loadProfile(selectedUserId);
  }, [selectedUserId]);

  return (
    <section className="admin-surface">
      <form
        className="toolbar audit-toolbar"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <label>
          <span>Severity</span>
          <select
            onChange={(event) =>
              updateFilter(
                "severity",
                event.target.value as RiskSeverity | "",
              )
            }
            value={filters.severity}
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
            onChange={(event) =>
              updateFilter("status", event.target.value as RiskEventStatus | "")
            }
            value={filters.status}
          >
            {STATUS_FILTERS.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Event type</span>
          <input
            onChange={(event) => updateFilter("eventType", event.target.value)}
            placeholder="payment_paid_not_fulfilled"
            value={filters.eventType}
          />
        </label>
        <label>
          <span>User ID</span>
          <input
            onChange={(event) => updateFilter("userId", event.target.value)}
            placeholder="user UUID"
            value={filters.userId}
          />
        </label>
        <label>
          <span>Source ID</span>
          <input
            onChange={(event) => updateFilter("sourceId", event.target.value)}
            placeholder="source UUID"
            value={filters.sourceId}
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
        <button className="icon-button" disabled={loading} type="submit">
          <Search aria-hidden="true" size={17} />
          <span>查询</span>
        </button>
        <button
          className="icon-button"
          disabled={loading}
          onClick={() => void loadEvents()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>刷新</span>
        </button>
        <button
          className="text-button"
          disabled={loading}
          onClick={resetFilters}
          type="button"
        >
          重置
        </button>
      </form>

      {error ? <p className="notice notice--error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {loading ? <p className="notice">加载中...</p> : null}

      <div className="metric-strip">
        <span>
          <strong>{summary.totalCount}</strong>
          <small>风险事件总数</small>
        </span>
        <span>
          <strong>{summary.pageCount}</strong>
          <small>当前页</small>
        </span>
        <span>
          <strong>{summary.criticalCount}</strong>
          <small>critical</small>
        </span>
        <span>
          <strong>{summary.openCount}</strong>
          <small>open</small>
        </span>
      </div>

      <div className="split-grid">
        <section className="detail-panel" aria-label="Risk events">
          <div className="detail-panel__header">
            <div>
              <h2>风险事件</h2>
              <p>按 severity 默认排序；点击行查看事件详情和用户画像。</p>
            </div>
            <StatusBadge status={filters.status || "all"} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Event type</th>
                  <th>User</th>
                  <th>Source</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={6}>暂无风险事件</td>
                  </tr>
                ) : (
                  events.map((event) => (
                    <RiskEventRow
                      event={event}
                      key={getEventId(event)}
                      selected={getEventId(event) === getSelectedEventId(selectedEvent)}
                      onSelect={setSelectedEvent}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="audit-pagination">
            <button
              className="icon-button"
              disabled={previousCursors.length === 0 || loading}
              onClick={goPreviousPage}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={16} />
              <span>上一页</span>
            </button>
            <button
              className="icon-button"
              disabled={!data?.nextCursor || loading}
              onClick={goNextPage}
              type="button"
            >
              <span>下一页</span>
              <ChevronRight aria-hidden="true" size={16} />
            </button>
          </div>
        </section>

        <section className="detail-panel" aria-label="Risk event detail">
        <RiskEventDetail
          busyTarget={busyTarget}
          canWriteRisk={canWriteRisk}
          event={selectedEvent}
          onResolve={(event, status) =>
            setDangerDraft({ kind: "resolve", event, status })
            }
          />
        </section>
      </div>

      <section className="detail-panel" aria-label="Risk user profile">
        <div className="detail-panel__header">
          <div>
            <h2>用户风控画像</h2>
            <p>
              {selectedUserId
                ? `用户 ${shortId(selectedUserId)}，画像只展示后端聚合摘要`
                : "当前事件没有 user_id"}
            </p>
          </div>
          {selectedUserId ? <StatusBadge status="risk-profile" /> : null}
        </div>
        {profileError ? (
          <p className="notice notice--error">{profileError}</p>
        ) : null}
        {profileLoading ? <p className="notice">用户画像加载中...</p> : null}
        {selectedUserId && profile ? (
          <RiskProfilePanel
            activeFlags={activeFlags}
            busyTarget={busyTarget}
            canWriteRisk={canWriteRisk}
            flagCode={selectedFlagCode}
            profile={profile}
            sectionLoading={profileSectionLoading}
            onApplyFlag={() =>
              setDangerDraft({
                kind: "applyFlag",
                userId: selectedUserId,
                flagCode: selectedFlagCode,
                flagLevel: "restriction",
              })
            }
            onClearFlag={(flag) => setDangerDraft({ kind: "clearFlag", flag })}
            onFlagCodeChange={setSelectedFlagCode}
            onLoadSection={(section) => void loadProfileSection(section)}
          />
        ) : !profileLoading ? (
          <p className="notice">请选择带 user_id 的风险事件查看用户画像。</p>
        ) : null}
      </section>

      <ConfirmDangerDialog
        confirmLabel={getDangerConfirmLabel(dangerDraft)}
        description={getDangerDescription(dangerDraft)}
        isOpen={dangerDraft !== null}
        pending={dangerDraft ? busyTarget === getDangerTargetValue(dangerDraft) : false}
        targetLabel={getDangerTargetLabel(dangerDraft)}
        targetValue={getDangerTargetValue(dangerDraft)}
        title={getDangerTitle(dangerDraft)}
        onCancel={() => setDangerDraft(null)}
        onConfirm={(confirmation) => void confirmDanger(confirmation.reason)}
      />
    </section>
  );
}

function RiskEventRow(props: {
  event: RiskEvent;
  selected: boolean;
  onSelect: (event: RiskEvent) => void;
}) {
  return (
    <tr
      className={props.selected ? "is-selected" : ""}
      onClick={() => props.onSelect(props.event)}
    >
      <td>
        <StatusBadge status={getEventSeverity(props.event)} />
      </td>
      <td>
        <StatusBadge status={getEventStatus(props.event)} />
      </td>
      <td>
        <strong>{getEventType(props.event)}</strong>
        <small>{shortId(getEventId(props.event))}</small>
      </td>
      <td>{formatNullableId(getEventUserId(props.event))}</td>
      <td>
        <strong>{getEventSourceType(props.event) ?? "-"}</strong>
        <small>{formatNullableId(getEventSourceId(props.event))}</small>
      </td>
      <td>{formatDate(getEventCreatedAt(props.event))}</td>
    </tr>
  );
}

function RiskEventDetail(props: {
  busyTarget: string | null;
  canWriteRisk: boolean;
  event: RiskEvent | null;
  onResolve: (event: RiskEvent, status: ResolveRiskEventStatus) => void;
}) {
  if (!props.event) {
    return <p className="notice">请选择风险事件。</p>;
  }

  const event = props.event;
  const eventId = getEventId(event);
  const canProcess =
    props.canWriteRisk && !TERMINAL_STATUSES.has(getEventStatus(event));
  const associationRows = collectAssociationRows(event);
  const associations = event.associations ?? [];

  return (
    <div className="payment-detail-section">
      <div className="detail-panel__header">
        <div>
          <h2>{getEventType(props.event)}</h2>
          <p>{eventId}</p>
        </div>
        <StatusBadge status={getEventStatus(event)} />
      </div>
      <div className="detail-grid">
        <span>
          <small>Severity</small>
          <strong>{getEventSeverity(event)}</strong>
        </span>
        <span>
          <small>User</small>
          <strong>{getEventUserId(event) ?? "-"}</strong>
        </span>
        <span>
          <small>Source type</small>
          <strong>{getEventSourceType(event) ?? "-"}</strong>
        </span>
        <span>
          <small>Source id</small>
          <strong>{getEventSourceId(event) ?? "-"}</strong>
        </span>
        <span>
          <small>Score delta</small>
          <strong>{formatValue(getEventScoreDelta(event))}</strong>
        </span>
        <span>
          <small>Created</small>
          <strong>{formatDate(getEventCreatedAt(event))}</strong>
        </span>
        <span>
          <small>Resolved at</small>
          <strong>{formatDate(getEventResolvedAt(event))}</strong>
        </span>
        <span>
          <small>Resolved by</small>
          <strong>{getEventResolvedBy(event) ?? "-"}</strong>
        </span>
      </div>

      <div className="payment-detail-section">
        <div className="payment-detail-section__title">
          <h3>关联订单 / 钱包 / 市场 / 支付 / 对账</h3>
        </div>
        {associations.length > 0 ? (
          <div className="split-grid split-grid--even">
            {associations.map((association) => (
              <section
                className="ops-card"
                key={`${association.kind}:${association.sourceId ?? association.source_id}`}
              >
                <h2>{association.label}</h2>
                <div className="detail-grid detail-grid--wide">
                  <span>
                    <small>Type</small>
                    <strong>
                      {association.sourceType ?? association.source_type}
                    </strong>
                  </span>
                  <span>
                    <small>ID</small>
                    <strong>
                      {association.sourceId ?? association.source_id}
                    </strong>
                  </span>
                  <span>
                    <small>Route</small>
                    <strong>
                      {association.routeKey ?? association.route_key ?? "-"}
                    </strong>
                  </span>
                  <span>
                    <small>Summary</small>
                    <strong>{formatAssociationSummary(association.summary)}</strong>
                  </span>
                </div>
              </section>
            ))}
          </div>
        ) : associationRows.length === 0 ? (
          <p className="notice">事件 detail/source 中暂无可展示关联字段。</p>
        ) : (
          <div className="detail-grid detail-grid--wide">
            {associationRows.map((row) => (
              <span key={`${row.path}:${row.value}`}>
                <small>{row.path}</small>
                <strong>{row.value}</strong>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="payment-detail-section">
        <div className="payment-detail-section__title">
          <h3>风险上下文 detail</h3>
        </div>
        <pre className="payment-detail-json">
          {stringifyJson(event.detail)}
        </pre>
      </div>

      {!props.canWriteRisk ? (
        <p className="notice">当前账号为风控只读权限，不能处理事件或修改限制。</p>
      ) : null}

      <div className="action-cell">
        <button
          className="text-button"
          disabled={props.busyTarget === eventId || !canProcess}
          onClick={() => props.onResolve(event, "reviewing")}
          type="button"
        >
          开始处理
        </button>
        <button
          className="text-button"
          disabled={props.busyTarget === eventId || !canProcess}
          onClick={() => props.onResolve(event, "ignored")}
          type="button"
        >
          忽略
        </button>
        <button
          className="text-button"
          disabled={props.busyTarget === eventId || !canProcess}
          onClick={() => props.onResolve(event, "fixed")}
          type="button"
        >
          标记已修复
        </button>
        <button
          className="text-button"
          disabled={props.busyTarget === eventId || !canProcess}
          onClick={() => props.onResolve(event, "escalated")}
          type="button"
        >
          升级
        </button>
      </div>
    </div>
  );
}

function RiskProfilePanel(props: {
  activeFlags: UserFlag[];
  busyTarget: string | null;
  canWriteRisk: boolean;
  flagCode: (typeof USER_FLAG_CODES)[number];
  profile: RiskUserProfile;
  sectionLoading: RiskUserProfileSection | null;
  onApplyFlag: () => void;
  onClearFlag: (flag: UserFlag) => void;
  onFlagCodeChange: (flagCode: (typeof USER_FLAG_CODES)[number]) => void;
  onLoadSection: (section: RiskUserProfileSection) => void;
}) {
  const user = props.profile.user;
  const userId = user.id;
  const riskTimeline =
    props.profile.riskEvents.items ?? props.profile.riskEvents.recent ?? [];
  const walletItems = readRecordArray(props.profile.wallets.items);
  const paymentRecent = readRecordArray(
    props.profile.payments.items ?? props.profile.payments.recent,
  );
  const marketRecent = readRecordArray(
    props.profile.market.items ?? props.profile.market.recent,
  );
  const referralRows = readRecordArray(props.profile.referrals.items);
  const referralInviterRows = readRecordArray(
    props.profile.referrals.asInviter ?? props.profile.referrals.as_inviter,
  );
  const referralInviteeRows = readRecordArray(
    props.profile.referrals.asInvitee ?? props.profile.referrals.as_invitee,
  );

  return (
    <div className="payment-detail-section">
      <div className="detail-grid">
        <span>
          <small>User status</small>
          <strong>{user.status}</strong>
        </span>
        <span>
          <small>Risk score</small>
          <strong>{formatValue(user.riskScore ?? user.risk_score)}</strong>
        </span>
        <span>
          <small>Telegram</small>
          <strong>{formatValue(user.telegramUserId ?? user.telegram_user_id)}</strong>
        </span>
        <span>
          <small>Last seen</small>
          <strong>{formatDate(user.lastSeenAt ?? user.last_seen_at ?? null)}</strong>
        </span>
      </div>

      {!props.canWriteRisk ? (
        <p className="notice">当前账号为 SUPPORT/只读风控权限，只能查看画像和事件。</p>
      ) : null}

      <div className="toolbar">
        <label>
          <span>限制类型</span>
          <select
            onChange={(event) =>
              props.onFlagCodeChange(
                event.target.value as (typeof USER_FLAG_CODES)[number],
              )
            }
            value={props.flagCode}
          >
            {USER_FLAG_CODES.map((flagCode) => (
              <option key={flagCode} value={flagCode}>
                {flagCode}
              </option>
            ))}
          </select>
        </label>
        <button
          className="icon-button icon-button--danger"
          disabled={
            !props.canWriteRisk ||
            props.busyTarget === `${userId}:${props.flagCode}`
          }
          onClick={props.onApplyFlag}
          type="button"
        >
          <Flag aria-hidden="true" size={16} />
          <span>应用用户限制</span>
        </button>
        <span className="toolbar__meta">flagLevel 默认 restriction</span>
      </div>

      <div className="ops-grid">
        <SummaryPanel
          rows={[
            ["钱包数", props.profile.wallets.count],
            [
              "复用用户数",
              props.profile.wallets.addressReuseCount ??
                props.profile.wallets.address_reuse_count,
            ],
          ]}
          title="钱包摘要"
        />
        <SummaryPanel
          rows={[
            [
              "支付总数",
              props.profile.payments.totalCount ??
                props.profile.payments.total_count,
            ],
            ["状态分布", formatCounts(readCounts(props.profile.payments))],
            [
              "成功 / 失败 / 争议",
              `${formatValue(
                props.profile.payments.successCount ??
                  props.profile.payments.success_count,
              )} / ${formatValue(
                props.profile.payments.failedCount ??
                  props.profile.payments.failed_count,
              )} / ${formatValue(
                props.profile.payments.disputedCount ??
                  props.profile.payments.disputed_count,
              )}`,
            ],
          ]}
          title="支付摘要"
        />
        <SummaryPanel
          rows={[
            [
              "买入订单",
              props.profile.market.buyerCount ?? props.profile.market.buyer_count,
            ],
            [
              "卖出订单",
              props.profile.market.sellerCount ??
                props.profile.market.seller_count,
            ],
            ["状态分布", formatCounts(readCounts(props.profile.market))],
          ]}
          title="市场摘要"
        />
        <SummaryPanel
          rows={[
            [
              "邀请人数",
              props.profile.referrals.invitedCount ??
                props.profile.referrals.invited_count,
            ],
            [
              "作为被邀请",
              props.profile.referrals.invitedByCount ??
                props.profile.referrals.invited_by_count,
            ],
            ["状态分布", formatCounts(readCounts(props.profile.referrals))],
            [
              "首开盒数",
              props.profile.referrals.firstOpenCount ??
                props.profile.referrals.first_open_count,
            ],
            [
              "首开盒转化率",
              formatPercent(
                props.profile.referrals.firstOpenConversionRate ??
                  props.profile.referrals.first_open_conversion_rate,
              ),
            ],
            [
              "已奖励数",
              props.profile.referrals.rewardedCount ??
                props.profile.referrals.rewarded_count,
            ],
          ]}
          title="邀请摘要"
        />
      </div>

      <section className="detail-panel">
        <div className="detail-panel__header">
          <div>
            <h2>Active flags</h2>
            <p>解除限制仅对 active flags 提供操作。</p>
          </div>
          <StatusBadge status={`${props.activeFlags.length}`} />
        </div>
        {props.activeFlags.length === 0 ? (
          <p className="notice">暂无 active flags</p>
        ) : (
          <div className="stack-list">
            {props.activeFlags.map((flag) => (
              <div className="list-row" key={getFlagId(flag)}>
                <span>
                  <strong>{getFlagCode(flag)}</strong>
                  <small>
                    {getFlagLevel(flag)} / ends{" "}
                    {formatDate(getFlagEndsAt(flag))}
                  </small>
                  <small>{flag.reason ?? "-"}</small>
                </span>
                <button
                  className="text-button"
                  disabled={
                    !props.canWriteRisk || props.busyTarget === getFlagId(flag)
                  }
                  onClick={() => props.onClearFlag(flag)}
                  type="button"
                >
                  解除用户限制
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="split-grid split-grid--even">
        <RecordTable
          emptyText="暂无钱包摘要"
          rows={walletItems}
          title="钱包"
          columns={["addressShort", "status", "reuseUserCount", "lastSyncAt"]}
          loading={props.sectionLoading === "wallets"}
          nextCursor={readNextCursor(props.profile.wallets)}
          onNext={() => props.onLoadSection("wallets")}
        />
        <RecordTable
          emptyText="暂无支付摘要"
          rows={paymentRecent}
          title="近期支付"
          columns={["id", "status", "xtrAmount", "createdAt"]}
          loading={props.sectionLoading === "payments"}
          nextCursor={readNextCursor(props.profile.payments)}
          onNext={() => props.onLoadSection("payments")}
        />
      </div>
      <div className="split-grid split-grid--even">
        <RecordTable
          emptyText="暂无市场摘要"
          rows={marketRecent}
          title="近期市场订单"
          columns={["id", "role", "counterpartyUserId", "status"]}
          loading={props.sectionLoading === "market"}
          nextCursor={readNextCursor(props.profile.market)}
          onNext={() => props.onLoadSection("market")}
        />
        <RecordTable
          emptyText="暂无邀请摘要"
          rows={
            referralRows.length > 0
              ? referralRows
              : [...referralInviterRows, ...referralInviteeRows]
          }
          title="近期邀请"
          columns={["id", "status", "inviteeUserId", "createdAt"]}
          loading={props.sectionLoading === "referrals"}
          nextCursor={readNextCursor(props.profile.referrals)}
          onNext={() => props.onLoadSection("referrals")}
        />
      </div>

      <section className="detail-panel">
        <div className="detail-panel__header">
          <div>
            <h2>最近风险事件时间线</h2>
            <p>来自用户画像 API 的近期 risk events。</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Status</th>
                <th>Event type</th>
                <th>Source</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {riskTimeline.length === 0 ? (
                <tr>
                  <td colSpan={5}>暂无近期风险事件</td>
                </tr>
              ) : (
                riskTimeline.map((event) => (
                  <tr key={getEventId(event)}>
                    <td>
                      <StatusBadge status={getEventSeverity(event)} />
                    </td>
                    <td>
                      <StatusBadge status={getEventStatus(event)} />
                    </td>
                    <td>{getEventType(event)}</td>
                    <td>
                      <strong>{getEventSourceType(event) ?? "-"}</strong>
                      <small>{getEventSourceId(event) ?? "-"}</small>
                    </td>
                    <td>{formatDate(getEventCreatedAt(event))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <SectionPager
          loading={props.sectionLoading === "riskEvents"}
          nextCursor={readNextCursor(props.profile.riskEvents)}
          onNext={() => props.onLoadSection("riskEvents")}
        />
      </section>
    </div>
  );
}

function SummaryPanel(props: {
  title: string;
  rows: Array<[string, unknown]>;
}) {
  return (
    <section className="ops-card">
      <h2>{props.title}</h2>
      <div className="detail-grid detail-grid--wide">
        {props.rows.map(([label, value]) => (
          <span key={label}>
            <small>{label}</small>
            <strong>{formatValue(value)}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}

function RecordTable(props: {
  title: string;
  emptyText: string;
  rows: Array<Record<string, unknown>>;
  columns: string[];
  loading?: boolean;
  nextCursor?: string | null;
  onNext?: () => void;
}) {
  return (
    <section className="detail-panel">
      <div className="detail-panel__header">
        <div>
          <h2>{props.title}</h2>
        </div>
      </div>
      <div className="table-wrap table-wrap--small">
        <table>
          <thead>
            <tr>
              {props.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.length === 0 ? (
              <tr>
                <td colSpan={props.columns.length}>{props.emptyText}</td>
              </tr>
            ) : (
              props.rows.map((row, index) => (
                <tr key={readString(row.id) ?? `${props.title}:${index}`}>
                  {props.columns.map((column) => (
                    <td key={column}>{formatRecordCell(row, column)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <SectionPager
        loading={props.loading === true}
        nextCursor={props.nextCursor ?? null}
        onNext={props.onNext}
      />
    </section>
  );
}

function SectionPager(props: {
  loading: boolean;
  nextCursor?: string | null;
  onNext?: (() => void) | undefined;
}) {
  if (!props.nextCursor || !props.onNext) {
    return null;
  }

  return (
    <div className="audit-pagination">
      <button
        className="text-button"
        disabled={props.loading}
        onClick={props.onNext}
        type="button"
      >
        {props.loading ? "加载中..." : "下一页"}
      </button>
    </div>
  );
}

function buildRiskParams(filters: RiskFilterDraft): RiskEventFilters {
  const params: RiskEventFilters = {
    sort: "severity",
  };
  const eventType = filters.eventType.trim();
  const userId = filters.userId.trim();
  const sourceId = filters.sourceId.trim();

  if (filters.severity) {
    params.severity = filters.severity;
  }

  if (filters.status) {
    params.status = filters.status;
  }

  if (eventType) {
    params.eventType = eventType;
  }

  if (userId) {
    params.userId = userId;
  }

  if (sourceId) {
    params.sourceId = sourceId;
  }

  if (filters.from) {
    params.from = filters.from;
  }

  if (filters.to) {
    params.to = filters.to;
  }

  return params;
}

function buildSummary(data: RiskEventsResponse | null) {
  const summary = data?.summary;
  const byStatus = summary?.byStatus ?? {};

  return {
    totalCount:
      readNumber(summary?.totalCount) ?? readNumber(summary?.total_count) ?? 0,
    pageCount:
      readNumber(summary?.pageCount) ??
      readNumber(summary?.page_count) ??
      data?.items.length ??
      0,
    criticalCount:
      readNumber(summary?.criticalCount) ??
      readNumber(summary?.critical_count) ??
      0,
    openCount: readNumber(byStatus.open) ?? 0,
  };
}

function getProfileSectionNextCursor(
  profile: RiskUserProfile,
  section: RiskUserProfileSection,
): string | null {
  switch (section) {
    case "flags":
      return readNextCursor(profile.flags);
    case "payments":
      return readNextCursor(profile.payments);
    case "market":
      return readNextCursor(profile.market);
    case "referrals":
      return readNextCursor(profile.referrals);
    case "wallets":
      return readNextCursor(profile.wallets);
    case "riskEvents":
      return readNextCursor(profile.riskEvents);
  }
}

function mergeProfileSection(
  current: RiskUserProfile,
  next: RiskUserProfile,
  section: RiskUserProfileSection,
): RiskUserProfile {
  switch (section) {
    case "flags":
      return { ...current, flags: next.flags };
    case "payments":
      return { ...current, payments: next.payments };
    case "market":
      return { ...current, market: next.market };
    case "referrals":
      return { ...current, referrals: next.referrals };
    case "wallets":
      return { ...current, wallets: next.wallets };
    case "riskEvents":
      return { ...current, riskEvents: next.riskEvents };
  }
}

function readNextCursor(value: {
  nextCursor?: string | null;
  next_cursor?: string | null;
}): string | null {
  return value.nextCursor ?? value.next_cursor ?? null;
}

function formatAssociationSummary(value: unknown): string {
  if (!isRecordLike(value)) {
    return "-";
  }

  const pairs = Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined && item !== "")
    .slice(0, 4)
    .map(([key, item]) => `${key}: ${formatValue(item)}`);

  return pairs.length > 0 ? pairs.join(" / ") : "-";
}

function formatPercent(value: unknown): string {
  const numeric = readNumber(value);

  if (numeric === null) {
    return "-";
  }

  return `${(numeric * 100).toFixed(1)}%`;
}

function collectAssociationRows(event: RiskEvent): Array<{
  path: string;
  value: string;
}> {
  const rows: Array<{ path: string; value: string }> = [];
  const sourceType = getEventSourceType(event);
  const sourceId = getEventSourceId(event);

  if (sourceType) {
    rows.push({ path: "source_type", value: sourceType });
  }

  if (sourceId) {
    rows.push({ path: "source_id", value: sourceId });
  }

  collectAssociationRowsFromValue(event.detail, "detail", rows, 0);

  return dedupeRows(rows).slice(0, 24);
}

function collectAssociationRowsFromValue(
  value: unknown,
  path: string,
  rows: Array<{ path: string; value: string }>,
  depth: number,
) {
  if (depth > 2 || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.slice(0, 5).forEach((item, index) => {
      collectAssociationRowsFromValue(item, `${path}[${index}]`, rows, depth + 1);
    });
    return;
  }

  if (typeof value !== "object") {
    if (ASSOCIATION_KEY_RE.test(path)) {
      rows.push({ path, value: formatValue(value) });
    }
    return;
  }

  for (const [key, childValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const nextPath = `${path}.${key}`;

    if (ASSOCIATION_KEY_RE.test(key) && !isRecordLike(childValue)) {
      rows.push({ path: nextPath, value: formatValue(childValue) });
      continue;
    }

    collectAssociationRowsFromValue(childValue, nextPath, rows, depth + 1);
  }
}

function dedupeRows(rows: Array<{ path: string; value: string }>) {
  const seen = new Set<string>();
  const result: Array<{ path: string; value: string }> = [];

  for (const row of rows) {
    const key = `${row.path}:${row.value}`;

    if (seen.has(key) || row.value === "-") {
      continue;
    }

    seen.add(key);
    result.push(row);
  }

  return result;
}

function getEventId(event: RiskEvent): string {
  return event.riskEventId ?? event.risk_event_id ?? event.id;
}

function getSelectedEventId(event: RiskEvent | null): string | null {
  return event ? getEventId(event) : null;
}

function getEventUserId(event: RiskEvent): string | null {
  return event.userId ?? event.user_id ?? null;
}

function getEventType(event: RiskEvent): string {
  return event.eventType ?? event.event_type;
}

function getEventSeverity(event: RiskEvent): string {
  return event.severity;
}

function getEventStatus(event: RiskEvent): string {
  return event.status;
}

function getEventSourceType(event: RiskEvent): string | null {
  return event.sourceType ?? event.source_type ?? null;
}

function getEventSourceId(event: RiskEvent): string | null {
  return event.sourceId ?? event.source_id ?? null;
}

function getEventScoreDelta(event: RiskEvent): number | string | null {
  return event.scoreDelta ?? event.score_delta ?? null;
}

function getEventCreatedAt(event: RiskEvent): string {
  return event.createdAt ?? event.created_at;
}

function getEventResolvedAt(event: RiskEvent): string | null {
  return event.resolvedAt ?? event.resolved_at ?? null;
}

function getEventResolvedBy(event: RiskEvent): string | null {
  return event.resolvedByAdminId ?? event.resolved_by_admin_id ?? null;
}

function getFlagId(flag: UserFlag): string {
  return flag.id;
}

function getFlagUserId(flag: UserFlag): string {
  return flag.userId ?? flag.user_id;
}

function getFlagCode(flag: UserFlag): string {
  return flag.flagCode ?? flag.flag_code;
}

function getFlagLevel(flag: UserFlag): string {
  return flag.flagLevel ?? flag.flag_level;
}

function getFlagEndsAt(flag: UserFlag): string | null {
  return flag.endsAt ?? flag.ends_at ?? null;
}

function getDangerTitle(draft: DangerDraft | null): string {
  if (!draft) {
    return "确认风控操作";
  }

  if (draft.kind === "resolve") {
    return `更新风险事件为 ${draft.status}`;
  }

  if (draft.kind === "applyFlag") {
    return `应用用户限制 ${draft.flagCode}`;
  }

  return `解除用户限制 ${getFlagCode(draft.flag)}`;
}

function getDangerDescription(draft: DangerDraft | null): string | undefined {
  if (!draft) {
    return undefined;
  }

  if (draft.kind === "resolve") {
    if (draft.status === "fixed") {
      return "将提交 fixMethod: admin_risk_center。";
    }

    if (draft.status === "escalated") {
      return "将提交 escalationOwner: risk_team。";
    }

    return `${getEventType(draft.event)} / ${getEventStatus(draft.event)}`;
  }

  if (draft.kind === "applyFlag") {
    return "写接口会携带 reason、confirm:true 和危险操作 headers。";
  }

  return draft.flag.reason ?? undefined;
}

function getDangerTargetLabel(draft: DangerDraft | null): string {
  if (!draft) {
    return "Target";
  }

  if (draft.kind === "resolve") {
    return "Risk event";
  }

  if (draft.kind === "applyFlag") {
    return "User flag";
  }

  return "Active flag";
}

function getDangerTargetValue(draft: DangerDraft | null): string {
  if (!draft) {
    return "";
  }

  if (draft.kind === "resolve") {
    return getEventId(draft.event);
  }

  if (draft.kind === "applyFlag") {
    return `${draft.userId}:${draft.flagCode}`;
  }

  return getFlagId(draft.flag);
}

function getDangerConfirmLabel(draft: DangerDraft | null): string {
  if (!draft) {
    return "确认";
  }

  if (draft.kind === "clearFlag") {
    return "确认解除";
  }

  if (draft.kind === "applyFlag") {
    return "确认限制";
  }

  return "确认处理";
}

function readCounts(value: {
  statusCounts?: Record<string, number>;
  status_counts?: Record<string, number>;
}): Record<string, number> {
  return value.statusCounts ?? value.status_counts ?? {};
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);

  if (entries.length === 0) {
    return "-";
  }

  return entries.map(([key, value]) => `${key}:${value}`).join(" / ");
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecordLike(item))
    : [];
}

function formatRecordCell(row: Record<string, unknown>, column: string): string {
  const value = row[column] ?? row[toSnakeCase(column)];

  if (column === "id" && typeof value === "string") {
    return shortId(value);
  }

  if (column.toLowerCase().endsWith("at") && typeof value === "string") {
    return formatDate(value);
  }

  return formatValue(value);
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function formatNullableId(value: string | null): string {
  return value ? shortId(value) : "-";
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return stringifyJson(value);
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

function formatError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
