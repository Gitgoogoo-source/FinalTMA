import {
  AlertTriangle,
  Ban,
  ExternalLink,
  Eye,
  RefreshCw,
  Save,
  Search,
  Settings2,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  fetchMarketAdminListings,
  fetchMarketFeeRules,
  fetchMarketHealthRules,
  fetchMarketListingDetail,
  fetchMarketOpsStats,
  fetchMarketPriceRules,
  forceCancelMarketListing,
  rebuildMarketStats,
  upsertMarketFeeRule,
  upsertMarketHealthRule,
  upsertMarketPriceRule,
} from "../admin.api";
import type {
  MarketAdminListingsResponse,
  MarketFeeRule,
  MarketHealthRule,
  MarketListingAdminDetail,
  MarketListingAdminItem,
  MarketOpsStats,
  MarketPriceRule,
} from "../admin.types";
import { formatDate, shortId, StatusBadge } from "../admin.ui";
import { ConfirmDangerDialog } from "../components/ConfirmDangerDialog";

type MarketListingStatus = "active" | "sold" | "cancelled" | "expired";
type MarketAnomalyGroup = "low_price" | "high_price" | "self_trade" | "lock";

type MarketAdminListingFilters = {
  status: string;
  rarityCode: string;
  template: string;
  minPrice: string;
  maxPrice: string;
  user: string;
};

type DetailState = {
  data: MarketListingAdminDetail | null;
  error: string | null;
  loading: boolean;
};

type MarketRulesState = {
  feeRules: MarketFeeRule[];
  healthRules: MarketHealthRule[];
  priceRules: MarketPriceRule[];
  error: string | null;
  loading: boolean;
};

type PriceRuleDraft = {
  id: string;
  templateId: string;
  rarityCode: string;
  formIndex: string;
  minPriceKcoin: string;
  maxPriceKcoin: string;
  suggestedPriceKcoin: string;
  active: boolean;
  metadata: string;
};

type HealthRuleDraft = {
  id: string;
  templateId: string;
  formId: string;
  rarityCode: string;
  lowBps: string;
  highBps: string;
  active: boolean;
  metadata: string;
};

type FeeRuleDraft = {
  id: string;
  code: string;
  feeBps: string;
  minFee: string;
  maxFee: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  metadata: string;
};

type MarketRuleAction =
  | { kind: "price"; targetValue: string }
  | { kind: "health"; targetValue: string }
  | { kind: "fee"; targetValue: string }
  | { kind: "rebuild"; targetValue: string };

type MarketOpsPriceReferenceItem = NonNullable<
  MarketOpsStats["priceReferences"]
>[number];
type MarketOpsPriceHealthFindingItem = NonNullable<
  MarketOpsStats["priceHealthFindings"]
>[number];
type MarketOpsSuspiciousTradeGroupItem = NonNullable<
  MarketOpsStats["suspiciousTradeGroups"]
>[number];
type MarketOpsFeeRevenueSourceItem = NonNullable<
  MarketOpsStats["feeRevenueSources"]
>[number];
type MarketOpsCatalogRef = {
  templateId?: string | null;
  templateName?: string | null;
  templateSlug?: string | null;
  formId?: string | null;
  formName?: string | null;
  rarityCode?: string | null;
};

const LISTING_STATUSES: Array<"" | MarketListingStatus> = [
  "",
  "active",
  "sold",
  "cancelled",
  "expired",
];

const EMPTY_FILTERS: MarketAdminListingFilters = {
  status: "active",
  rarityCode: "",
  template: "",
  minPrice: "",
  maxPrice: "",
  user: "",
};

const EMPTY_PRICE_RULE_DRAFT: PriceRuleDraft = {
  id: "",
  templateId: "",
  rarityCode: "",
  formIndex: "",
  minPriceKcoin: "",
  maxPriceKcoin: "",
  suggestedPriceKcoin: "",
  active: true,
  metadata: "{}",
};

const EMPTY_HEALTH_RULE_DRAFT: HealthRuleDraft = {
  id: "",
  templateId: "",
  formId: "",
  rarityCode: "",
  lowBps: "7000",
  highBps: "13000",
  active: true,
  metadata: "{}",
};

const EMPTY_FEE_RULE_DRAFT: FeeRuleDraft = {
  id: "",
  code: "",
  feeBps: "500",
  minFee: "0",
  maxFee: "",
  startsAt: "",
  endsAt: "",
  active: true,
  metadata: "{}",
};

export function MarketOpsPage({
  canWriteMarket = false,
}: {
  canWriteMarket?: boolean;
}) {
  const [filters, setFilters] =
    useState<MarketAdminListingFilters>(EMPTY_FILTERS);
  const [stats, setStats] = useState<MarketOpsStats | null>(null);
  const [listings, setListings] = useState<MarketListingAdminItem[]>([]);
  const [listingId, setListingId] = useState(readListingIdFromHash);
  const [statsLoading, setStatsLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState>({
    data: null,
    error: null,
    loading: Boolean(listingId),
  });
  const [rules, setRules] = useState<MarketRulesState>({
    feeRules: [],
    healthRules: [],
    priceRules: [],
    error: null,
    loading: false,
  });
  const [nextListingCursor, setNextListingCursor] = useState<string | null>(
    null,
  );
  const [priceRuleDraft, setPriceRuleDraft] = useState<PriceRuleDraft>(
    EMPTY_PRICE_RULE_DRAFT,
  );
  const [healthRuleDraft, setHealthRuleDraft] = useState<HealthRuleDraft>(
    EMPTY_HEALTH_RULE_DRAFT,
  );
  const [feeRuleDraft, setFeeRuleDraft] =
    useState<FeeRuleDraft>(EMPTY_FEE_RULE_DRAFT);
  const [pendingRuleAction, setPendingRuleAction] =
    useState<MarketRuleAction | null>(null);
  const [rulesBusy, setRulesBusy] = useState(false);
  const [cancelDraft, setCancelDraft] = useState<MarketListingAdminItem | null>(
    null,
  );
  const [busyListingId, setBusyListingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const anomalyGroups = useMemo(() => groupAnomalies(listings), [listings]);

  async function loadStats() {
    setStatsLoading(true);
    setStatsError(null);

    try {
      setStats(await fetchMarketOpsStats({ windowHours: 24 }));
    } catch (loadError) {
      setStats(null);
      setStatsError(formatAdminLoadError(loadError, "市场概览加载失败"));
    } finally {
      setStatsLoading(false);
    }
  }

  async function loadListings(nextFilters = filters) {
    setListLoading(true);
    setListError(null);

    try {
      const response = await fetchMarketAdminListings(
        compactFilters(nextFilters),
      );
      setListings(readListingItems(response));
      setNextListingCursor(response.nextCursor);
    } catch (loadError) {
      setListings([]);
      setNextListingCursor(null);
      setListError(formatAdminLoadError(loadError, "市场挂单列表加载失败"));
    } finally {
      setListLoading(false);
    }
  }

  async function loadNextListings() {
    if (!nextListingCursor) {
      return;
    }

    setListLoading(true);
    setListError(null);

    try {
      const response = await fetchMarketAdminListings({
        ...compactFilters(filters),
        cursor: nextListingCursor,
      });
      setListings((current) => [...current, ...readListingItems(response)]);
      setNextListingCursor(response.nextCursor);
    } catch (loadError) {
      setListError(formatAdminLoadError(loadError, "市场挂单下一页加载失败"));
    } finally {
      setListLoading(false);
    }
  }

  async function loadRules() {
    setRules((current) => ({ ...current, error: null, loading: true }));

    try {
      const [priceRules, healthRules, feeRules] = await Promise.all([
        fetchMarketPriceRules({ active: true, limit: 50 }),
        fetchMarketHealthRules({ active: true, limit: 50 }),
        fetchMarketFeeRules({ active: true, limit: 50 }),
      ]);
      setRules({
        feeRules: feeRules.items,
        healthRules: healthRules.items,
        priceRules: priceRules.items,
        error: null,
        loading: false,
      });
    } catch (loadError) {
      setRules((current) => ({
        ...current,
        error: formatAdminLoadError(loadError, "市场规则加载失败"),
        loading: false,
      }));
    }
  }

  async function loadDetail(nextListingId = listingId) {
    if (!nextListingId) {
      setDetail({ data: null, error: null, loading: false });
      return;
    }

    setDetail((current) => ({ ...current, error: null, loading: true }));

    try {
      setDetail({
        data: await fetchMarketListingDetail(nextListingId),
        error: null,
        loading: false,
      });
    } catch (loadError) {
      setDetail({
        data: null,
        error: formatAdminLoadError(loadError, "市场挂单详情加载失败"),
        loading: false,
      });
    }
  }

  async function reloadAll() {
    setNotice(null);
    await Promise.all([loadStats(), loadListings(), loadRules()]);
  }

  async function confirmForceCancel(reason: string) {
    if (!cancelDraft || cancelDraft.status !== "active") {
      setCancelDraft(null);
      return;
    }

    setBusyListingId(cancelDraft.id);
    setNotice(null);

    try {
      await forceCancelMarketListing({
        listingId: cancelDraft.id,
        reason,
      });
      setNotice(`挂单 ${shortId(cancelDraft.id)} 已提交强制下架`);
      setCancelDraft(null);
      await Promise.all([
        loadStats(),
        loadListings(),
        loadRules(),
        loadDetail(listingId),
      ]);
    } catch (cancelError) {
      setListError(formatAdminLoadError(cancelError, "强制下架失败"));
    } finally {
      setBusyListingId(null);
    }
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    void loadListings(filters);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setNotice(null);
    void loadListings(EMPTY_FILTERS);
  }

  function submitPriceRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingRuleAction({
      kind: "price",
      targetValue: buildPriceRuleTarget(priceRuleDraft),
    });
  }

  function submitHealthRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingRuleAction({
      kind: "health",
      targetValue: buildHealthRuleTarget(healthRuleDraft),
    });
  }

  function submitFeeRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingRuleAction({
      kind: "fee",
      targetValue: buildFeeRuleTarget(feeRuleDraft),
    });
  }

  async function confirmRuleAction(reason: string) {
    if (!pendingRuleAction) {
      return;
    }

    setRulesBusy(true);
    setRules((current) => ({ ...current, error: null }));
    setNotice(null);

    try {
      if (pendingRuleAction.kind === "price") {
        await upsertMarketPriceRule(
          buildPriceRuleInput(priceRuleDraft, reason),
        );
        setPriceRuleDraft(EMPTY_PRICE_RULE_DRAFT);
        setNotice("价格规则已保存并触发后台审计");
      } else if (pendingRuleAction.kind === "health") {
        await upsertMarketHealthRule(
          buildHealthRuleInput(healthRuleDraft, reason),
        );
        setHealthRuleDraft(EMPTY_HEALTH_RULE_DRAFT);
        setNotice("价格健康规则已保存并刷新市场健康状态");
      } else if (pendingRuleAction.kind === "fee") {
        await upsertMarketFeeRule(buildFeeRuleInput(feeRuleDraft, reason));
        setFeeRuleDraft(EMPTY_FEE_RULE_DRAFT);
        setNotice("手续费规则已保存，新订单会使用生效规则快照");
      } else {
        await rebuildMarketStats({ reason });
        setNotice("市场统计重建任务已完成");
      }

      setPendingRuleAction(null);
      await Promise.all([loadStats(), loadListings(), loadRules()]);
    } catch (error) {
      setRules((current) => ({
        ...current,
        error: formatAdminLoadError(error, "市场规则写入失败"),
      }));
    } finally {
      setRulesBusy(false);
    }
  }

  function selectListing(nextListingId: string) {
    const nextHash = `#market-ops?listingId=${encodeURIComponent(
      nextListingId,
    )}`;

    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
      return;
    }

    setListingId(nextListingId);
    void loadDetail(nextListingId);
  }

  useEffect(() => {
    void reloadAll();
  }, []);

  useEffect(() => {
    void loadDetail(listingId);
  }, [listingId]);

  useEffect(() => {
    function syncListingIdFromHash() {
      setListingId(readListingIdFromHash());
    }

    window.addEventListener("hashchange", syncListingIdFromHash);

    return () =>
      window.removeEventListener("hashchange", syncListingIdFromHash);
  }, []);

  return (
    <section className="admin-surface">
      <form className="toolbar" onSubmit={submitFilters}>
        <label>
          <span>状态</span>
          <select
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                status: event.target.value,
              }))
            }
            value={filters.status}
          >
            {LISTING_STATUSES.map((status) => (
              <option key={status || "all"} value={status}>
                {status || "全部"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>稀有度</span>
          <input
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                rarityCode: event.target.value.trim(),
              }))
            }
            placeholder="SSR / SR"
            value={filters.rarityCode}
          />
        </label>
        <label className="toolbar__search">
          <span>模板</span>
          <input
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                template: event.target.value.trim(),
              }))
            }
            placeholder="template UUID"
            value={filters.template}
          />
        </label>
        <label>
          <span>最低价</span>
          <input
            inputMode="numeric"
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                minPrice: event.target.value.trim(),
              }))
            }
            placeholder="Kcoin"
            value={filters.minPrice}
          />
        </label>
        <label>
          <span>最高价</span>
          <input
            inputMode="numeric"
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                maxPrice: event.target.value.trim(),
              }))
            }
            placeholder="Kcoin"
            value={filters.maxPrice}
          />
        </label>
        <label className="toolbar__search">
          <span>用户</span>
          <input
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                user: event.target.value.trim(),
              }))
            }
            placeholder="seller user UUID"
            value={filters.user}
          />
        </label>
        <button className="icon-button" disabled={listLoading} type="submit">
          <Search aria-hidden="true" size={17} />
          <span>查询</span>
        </button>
        <button
          className="icon-button"
          disabled={statsLoading || listLoading}
          onClick={() => void reloadAll()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          <span>刷新</span>
        </button>
        <button
          className="icon-button"
          disabled={!canWriteMarket || rulesBusy || statsLoading}
          onClick={() =>
            setPendingRuleAction({
              kind: "rebuild",
              targetValue: "market-stats",
            })
          }
          title={
            canWriteMarket
              ? "手动重建市场统计"
              : "需要 market:write 或 admin:write"
          }
          type="button"
        >
          <Settings2 aria-hidden="true" size={17} />
          <span>重建统计</span>
        </button>
        <button
          className="text-button"
          disabled={listLoading}
          onClick={resetFilters}
          type="button"
        >
          重置
        </button>
      </form>

      {statsError ? <p className="notice notice--error">{statsError}</p> : null}
      {listError ? <p className="notice notice--error">{listError}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}
      {statsLoading || listLoading ? (
        <p className="notice">市场运营数据加载中...</p>
      ) : null}

      <MarketStatsStrip stats={stats} />
      <MarketOpsStatsPanels stats={stats} />
      <MarketRulesPanel
        canWriteMarket={canWriteMarket}
        feeRuleDraft={feeRuleDraft}
        healthRuleDraft={healthRuleDraft}
        priceRuleDraft={priceRuleDraft}
        rules={rules}
        rulesBusy={rulesBusy}
        onFeeRuleDraftChange={setFeeRuleDraft}
        onHealthRuleDraftChange={setHealthRuleDraft}
        onPriceRuleDraftChange={setPriceRuleDraft}
        onReloadRules={() => void loadRules()}
        onSubmitFeeRule={submitFeeRule}
        onSubmitHealthRule={submitHealthRule}
        onSubmitPriceRule={submitPriceRule}
      />

      <div className="split-grid">
        <section className="detail-panel" aria-label="Market listings">
          <div className="detail-panel__header">
            <div>
              <h2>市场挂单</h2>
              <p>
                展示 active / sold / cancelled / expired
                挂单；筛选由后端返回结果决定。
              </p>
            </div>
            <StatusBadge status={filters.status || "all"} />
          </div>
          <MarketListingsTable
            busyListingId={busyListingId}
            canWriteMarket={canWriteMarket}
            listings={listings}
            selectedListingId={listingId}
            onForceCancel={setCancelDraft}
            onSelect={selectListing}
          />
          {nextListingCursor ? (
            <div className="button-row">
              <button
                className="text-button"
                disabled={listLoading}
                onClick={() => void loadNextListings()}
                type="button"
              >
                加载下一页
              </button>
            </div>
          ) : null}
        </section>

        <section className="detail-panel" aria-label="Market listing detail">
          <div className="detail-panel__header">
            <div>
              <h2>挂单详情</h2>
              <p>
                {listingId
                  ? `当前挂单 ${shortId(listingId)}`
                  : "选择列表行或使用 #market-ops?listingId= 深链查看详情。"}
              </p>
            </div>
            {detail.data ? <StatusBadge status={detail.data.status} /> : null}
          </div>
          {detail.error ? (
            <p className="notice notice--error">{detail.error}</p>
          ) : null}
          {detail.loading ? (
            <p className="notice">正在加载市场挂单...</p>
          ) : null}
          {!listingId && !detail.loading ? (
            <p className="notice">暂无挂单 ID。</p>
          ) : null}
          {detail.data ? <MarketListingDetail detail={detail.data} /> : null}
        </section>
      </div>

      <MarketAnomalyGroups
        canWriteMarket={canWriteMarket}
        groups={anomalyGroups}
        onForceCancel={setCancelDraft}
        onSelect={selectListing}
      />

      <ConfirmDangerDialog
        confirmLabel="确认强制下架"
        description="只允许 active 挂单强制下架；原因会提交给后端用于审计、释放锁和后续风控处理。"
        isOpen={cancelDraft !== null}
        pending={cancelDraft ? busyListingId === cancelDraft.id : false}
        targetLabel="市场挂单"
        targetValue={cancelDraft?.id ?? ""}
        title="强制下架挂单"
        onCancel={() => setCancelDraft(null)}
        onConfirm={(confirmation) =>
          void confirmForceCancel(confirmation.reason)
        }
      />
      <ConfirmDangerDialog
        confirmLabel={formatRuleActionConfirmLabel(pendingRuleAction)}
        description="该操作会写入后台审计，并通过服务端 RPC 执行；确认后不要重复提交。"
        isOpen={pendingRuleAction !== null}
        pending={rulesBusy}
        targetLabel={formatRuleActionTargetLabel(pendingRuleAction)}
        targetValue={pendingRuleAction?.targetValue ?? ""}
        title={formatRuleActionTitle(pendingRuleAction)}
        onCancel={() => setPendingRuleAction(null)}
        onConfirm={(confirmation) =>
          void confirmRuleAction(confirmation.reason)
        }
      />
    </section>
  );
}

function MarketStatsStrip({ stats }: { stats: MarketOpsStats | null }) {
  return (
    <div className="metric-strip">
      <span>
        <strong>{formatMetric(stats?.activeListingCount)}</strong>
        <small>活跃挂单数</small>
      </span>
      <span>
        <strong>{formatKcoin(readActiveListingValue(stats))}</strong>
        <small>Active 挂单总价值</small>
      </span>
      <span>
        <strong>{formatKcoin(stats?.volume24hKcoin)}</strong>
        <small>24h 成交额</small>
      </span>
      <span>
        <strong>{formatKcoin(stats?.feeRevenueKcoin)}</strong>
        <small>平台手续费收入</small>
      </span>
      <span>
        <strong>{formatMetric(stats?.abnormalListingCount)}</strong>
        <small>异常挂单</small>
      </span>
      <span>
        <strong>{formatStatsWindow(stats?.window)}</strong>
        <small>统计窗口</small>
      </span>
    </div>
  );
}

function MarketOpsStatsPanels({ stats }: { stats: MarketOpsStats | null }) {
  return (
    <div className="split-grid split-grid--even">
      <MarketPriceReferencePanel stats={stats} />
      <MarketRiskRevenuePanel stats={stats} />
    </div>
  );
}

function MarketRulesPanel(props: {
  canWriteMarket: boolean;
  feeRuleDraft: FeeRuleDraft;
  healthRuleDraft: HealthRuleDraft;
  priceRuleDraft: PriceRuleDraft;
  rules: MarketRulesState;
  rulesBusy: boolean;
  onFeeRuleDraftChange: (draft: FeeRuleDraft) => void;
  onHealthRuleDraftChange: (draft: HealthRuleDraft) => void;
  onPriceRuleDraftChange: (draft: PriceRuleDraft) => void;
  onReloadRules: () => void;
  onSubmitFeeRule: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitHealthRule: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitPriceRule: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const formDisabled =
    !props.canWriteMarket || props.rulesBusy || props.rules.loading;

  return (
    <section className="detail-panel" aria-label="Market rule operations">
      <div className="detail-panel__header">
        <div>
          <h2>市场规则</h2>
          <p>价格边界、健康阈值和手续费规则均由服务端 RPC 审计写入。</p>
        </div>
        <button
          className="icon-button"
          disabled={props.rules.loading}
          onClick={props.onReloadRules}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
          <span>{props.rules.loading ? "加载中" : "刷新规则"}</span>
        </button>
      </div>
      {props.rules.error ? (
        <p className="notice notice--error">{props.rules.error}</p>
      ) : null}
      {!props.canWriteMarket ? (
        <p className="notice">当前管理员只有读取权限，写操作已禁用。</p>
      ) : null}
      <div className="split-grid split-grid--even">
        <form className="ops-card" onSubmit={props.onSubmitPriceRule}>
          <header>
            <div>
              <p>Price</p>
              <h2>价格规则</h2>
            </div>
            <StatusBadge status={`${props.rules.priceRules.length}`} />
          </header>
          <div className="detail-grid">
            <label>
              <span>规则 ID</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onPriceRuleDraftChange({
                    ...props.priceRuleDraft,
                    id: event.target.value.trim(),
                  })
                }
                placeholder="PATCH 时填写 UUID"
                value={props.priceRuleDraft.id}
              />
            </label>
            <label>
              <span>模板 UUID</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onPriceRuleDraftChange({
                    ...props.priceRuleDraft,
                    templateId: event.target.value.trim(),
                  })
                }
                placeholder="可为空"
                value={props.priceRuleDraft.templateId}
              />
            </label>
            <label>
              <span>稀有度</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onPriceRuleDraftChange({
                    ...props.priceRuleDraft,
                    rarityCode: event.target.value.trim().toUpperCase(),
                  })
                }
                placeholder="RARE"
                value={props.priceRuleDraft.rarityCode}
              />
            </label>
            <label>
              <span>形态序号</span>
              <input
                disabled={formDisabled}
                inputMode="numeric"
                onChange={(event) =>
                  props.onPriceRuleDraftChange({
                    ...props.priceRuleDraft,
                    formIndex: event.target.value.trim(),
                  })
                }
                placeholder="可为空"
                value={props.priceRuleDraft.formIndex}
              />
            </label>
            <label>
              <span>最低价</span>
              <input
                disabled={formDisabled}
                inputMode="decimal"
                onChange={(event) =>
                  props.onPriceRuleDraftChange({
                    ...props.priceRuleDraft,
                    minPriceKcoin: event.target.value.trim(),
                  })
                }
                required
                value={props.priceRuleDraft.minPriceKcoin}
              />
            </label>
            <label>
              <span>最高价</span>
              <input
                disabled={formDisabled}
                inputMode="decimal"
                onChange={(event) =>
                  props.onPriceRuleDraftChange({
                    ...props.priceRuleDraft,
                    maxPriceKcoin: event.target.value.trim(),
                  })
                }
                value={props.priceRuleDraft.maxPriceKcoin}
              />
            </label>
            <label>
              <span>建议价</span>
              <input
                disabled={formDisabled}
                inputMode="decimal"
                onChange={(event) =>
                  props.onPriceRuleDraftChange({
                    ...props.priceRuleDraft,
                    suggestedPriceKcoin: event.target.value.trim(),
                  })
                }
                value={props.priceRuleDraft.suggestedPriceKcoin}
              />
            </label>
            <label>
              <span>Metadata JSON</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onPriceRuleDraftChange({
                    ...props.priceRuleDraft,
                    metadata: event.target.value,
                  })
                }
                value={props.priceRuleDraft.metadata}
              />
            </label>
          </div>
          <label className="inline-check">
            <input
              checked={props.priceRuleDraft.active}
              disabled={formDisabled}
              onChange={(event) =>
                props.onPriceRuleDraftChange({
                  ...props.priceRuleDraft,
                  active: event.target.checked,
                })
              }
              type="checkbox"
            />
            <span>启用</span>
          </label>
          <button className="icon-button" disabled={formDisabled} type="submit">
            <Save aria-hidden="true" size={16} />
            <span>保存价格规则</span>
          </button>
          <RuleSummaryList
            emptyText="暂无价格规则"
            rows={props.rules.priceRules.map(formatPriceRuleSummary)}
          />
        </form>

        <form className="ops-card" onSubmit={props.onSubmitHealthRule}>
          <header>
            <div>
              <p>Health</p>
              <h2>健康阈值</h2>
            </div>
            <StatusBadge status={`${props.rules.healthRules.length}`} />
          </header>
          <div className="detail-grid">
            <label>
              <span>规则 ID</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onHealthRuleDraftChange({
                    ...props.healthRuleDraft,
                    id: event.target.value.trim(),
                  })
                }
                placeholder="PATCH 时填写 UUID"
                value={props.healthRuleDraft.id}
              />
            </label>
            <label>
              <span>模板 UUID</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onHealthRuleDraftChange({
                    ...props.healthRuleDraft,
                    templateId: event.target.value.trim(),
                  })
                }
                placeholder="可为空"
                value={props.healthRuleDraft.templateId}
              />
            </label>
            <label>
              <span>形态 UUID</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onHealthRuleDraftChange({
                    ...props.healthRuleDraft,
                    formId: event.target.value.trim(),
                  })
                }
                placeholder="可为空"
                value={props.healthRuleDraft.formId}
              />
            </label>
            <label>
              <span>稀有度</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onHealthRuleDraftChange({
                    ...props.healthRuleDraft,
                    rarityCode: event.target.value.trim().toUpperCase(),
                  })
                }
                placeholder="RARE"
                value={props.healthRuleDraft.rarityCode}
              />
            </label>
            <label>
              <span>低价 bps</span>
              <input
                disabled={formDisabled}
                inputMode="numeric"
                onChange={(event) =>
                  props.onHealthRuleDraftChange({
                    ...props.healthRuleDraft,
                    lowBps: event.target.value.trim(),
                  })
                }
                required
                value={props.healthRuleDraft.lowBps}
              />
            </label>
            <label>
              <span>高价 bps</span>
              <input
                disabled={formDisabled}
                inputMode="numeric"
                onChange={(event) =>
                  props.onHealthRuleDraftChange({
                    ...props.healthRuleDraft,
                    highBps: event.target.value.trim(),
                  })
                }
                required
                value={props.healthRuleDraft.highBps}
              />
            </label>
            <label>
              <span>Metadata JSON</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onHealthRuleDraftChange({
                    ...props.healthRuleDraft,
                    metadata: event.target.value,
                  })
                }
                value={props.healthRuleDraft.metadata}
              />
            </label>
          </div>
          <label className="inline-check">
            <input
              checked={props.healthRuleDraft.active}
              disabled={formDisabled}
              onChange={(event) =>
                props.onHealthRuleDraftChange({
                  ...props.healthRuleDraft,
                  active: event.target.checked,
                })
              }
              type="checkbox"
            />
            <span>启用</span>
          </label>
          <button className="icon-button" disabled={formDisabled} type="submit">
            <Save aria-hidden="true" size={16} />
            <span>保存健康规则</span>
          </button>
          <RuleSummaryList
            emptyText="暂无健康规则"
            rows={props.rules.healthRules.map(formatHealthRuleSummary)}
          />
        </form>

        <form className="ops-card" onSubmit={props.onSubmitFeeRule}>
          <header>
            <div>
              <p>Fee</p>
              <h2>手续费规则</h2>
            </div>
            <StatusBadge status={`${props.rules.feeRules.length}`} />
          </header>
          <div className="detail-grid">
            <label>
              <span>规则 ID</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onFeeRuleDraftChange({
                    ...props.feeRuleDraft,
                    id: event.target.value.trim(),
                  })
                }
                placeholder="PATCH 时填写 UUID"
                value={props.feeRuleDraft.id}
              />
            </label>
            <label>
              <span>规则 code</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onFeeRuleDraftChange({
                    ...props.feeRuleDraft,
                    code: event.target.value.trim().toUpperCase(),
                  })
                }
                placeholder="MARKET_SELL_FEE"
                value={props.feeRuleDraft.code}
              />
            </label>
            <label>
              <span>fee bps</span>
              <input
                disabled={formDisabled}
                inputMode="numeric"
                onChange={(event) =>
                  props.onFeeRuleDraftChange({
                    ...props.feeRuleDraft,
                    feeBps: event.target.value.trim(),
                  })
                }
                required
                value={props.feeRuleDraft.feeBps}
              />
            </label>
            <label>
              <span>最低费</span>
              <input
                disabled={formDisabled}
                inputMode="numeric"
                onChange={(event) =>
                  props.onFeeRuleDraftChange({
                    ...props.feeRuleDraft,
                    minFee: event.target.value.trim(),
                  })
                }
                value={props.feeRuleDraft.minFee}
              />
            </label>
            <label>
              <span>最高费</span>
              <input
                disabled={formDisabled}
                inputMode="numeric"
                onChange={(event) =>
                  props.onFeeRuleDraftChange({
                    ...props.feeRuleDraft,
                    maxFee: event.target.value.trim(),
                  })
                }
                value={props.feeRuleDraft.maxFee}
              />
            </label>
            <label>
              <span>startsAt</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onFeeRuleDraftChange({
                    ...props.feeRuleDraft,
                    startsAt: event.target.value.trim(),
                  })
                }
                placeholder="ISO，可为空"
                value={props.feeRuleDraft.startsAt}
              />
            </label>
            <label>
              <span>endsAt</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onFeeRuleDraftChange({
                    ...props.feeRuleDraft,
                    endsAt: event.target.value.trim(),
                  })
                }
                placeholder="ISO，可为空"
                value={props.feeRuleDraft.endsAt}
              />
            </label>
            <label>
              <span>Metadata JSON</span>
              <input
                disabled={formDisabled}
                onChange={(event) =>
                  props.onFeeRuleDraftChange({
                    ...props.feeRuleDraft,
                    metadata: event.target.value,
                  })
                }
                value={props.feeRuleDraft.metadata}
              />
            </label>
          </div>
          <label className="inline-check">
            <input
              checked={props.feeRuleDraft.active}
              disabled={formDisabled}
              onChange={(event) =>
                props.onFeeRuleDraftChange({
                  ...props.feeRuleDraft,
                  active: event.target.checked,
                })
              }
              type="checkbox"
            />
            <span>启用</span>
          </label>
          <button className="icon-button" disabled={formDisabled} type="submit">
            <Save aria-hidden="true" size={16} />
            <span>保存手续费规则</span>
          </button>
          <RuleSummaryList
            emptyText="暂无手续费规则"
            rows={props.rules.feeRules.map(formatFeeRuleSummary)}
          />
        </form>
      </div>
    </section>
  );
}

function RuleSummaryList(props: { emptyText: string; rows: string[] }) {
  return (
    <div className="stack-list stack-list--spaced">
      {props.rows.length === 0 ? (
        <p className="notice">{props.emptyText}</p>
      ) : (
        props.rows.slice(0, 5).map((row) => (
          <div className="list-row" key={row}>
            <small>{row}</small>
          </div>
        ))
      )}
    </div>
  );
}

function MarketPriceReferencePanel({
  stats,
}: {
  stats: MarketOpsStats | null;
}) {
  const rows = readPriceReferences(stats);

  return (
    <section className="detail-panel" aria-label="Market price references">
      <div className="detail-panel__header">
        <div>
          <h2>价格参考</h2>
          <p>
            按 template / form 展示地板价、active
            挂单均价、成交均价和最近成交价； active
            挂单均价与成交均价分列，避免运营误读。
          </p>
        </div>
        <StatusBadge status={`${rows.length}`} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Template / form</th>
              <th>地板价</th>
              <th>Active 挂单均价</th>
              <th>成交均价</th>
              <th>最近成交价</th>
              <th>样本 / 时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  后端暂未返回 template / form
                  价格参考，当前只能展示顶部聚合指标。
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={buildPriceReferenceKey(row, index)}>
                  <td>
                    <strong>{formatPriceReferenceTitle(row)}</strong>
                    <small>{formatPriceReferenceMeta(row)}</small>
                  </td>
                  <td>
                    <strong>{formatKcoin(row.floorPriceKcoin)}</strong>
                    <small>最低 active listing price</small>
                  </td>
                  <td>
                    <strong>
                      {formatKcoin(row.activeListingAvgPriceKcoin)}
                    </strong>
                    <small>只统计 active 挂单</small>
                  </td>
                  <td>
                    <strong>
                      {formatKcoin(row.completedOrderAvgPriceKcoin)}
                    </strong>
                    <small>只统计已成交订单</small>
                  </td>
                  <td>
                    <strong>{formatKcoin(row.lastSalePriceKcoin)}</strong>
                    <small>{formatRecentSaleMeta(row)}</small>
                  </td>
                  <td>
                    <strong>{formatPriceReferenceSamples(row)}</strong>
                    <small>快照 {formatDate(row.snapshotAt ?? null)}</small>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MarketRiskRevenuePanel({ stats }: { stats: MarketOpsStats | null }) {
  const priceFindings = readPriceHealthFindings(stats);
  const suspiciousGroups = readSuspiciousTradeGroups(stats);
  const feeSources = readFeeRevenueSources(stats);

  return (
    <section className="detail-panel" aria-label="Market risk and revenue">
      <div className="detail-panel__header">
        <div>
          <h2>价格健康 / 刷单 / 手续费</h2>
          <p>
            价格异常按 price health rule 展示；疑似刷单只展示关联计数、短 ID
            和脱敏摘要；手续费按后端声明来源分组。
          </p>
        </div>
        <StatusBadge
          status={`${priceFindings.length + suspiciousGroups.length}`}
        />
      </div>

      <div className="stack-list stack-list--spaced">
        <div className="list-row">
          <div>
            <strong>异常低价 / 高价挂单</strong>
            <small>{formatPriceHealthCounts(stats?.priceHealthCounts)}</small>
          </div>
          <StatusBadge status={`${priceFindings.length}`} />
        </div>
        {priceFindings.length === 0 ? (
          <p className="notice">
            后端暂未返回 price health rule 明细；可先参考异常挂单数和列表分组。
          </p>
        ) : (
          priceFindings.map((finding) => (
            <div className="list-row" key={finding.listingId}>
              <div>
                <strong>{shortId(finding.listingId)}</strong>
                <small>
                  {formatPriceReferenceTitle(finding)} / 当前{" "}
                  {formatKcoin(finding.unitPriceKcoin)} / 地板{" "}
                  {formatKcoin(finding.floorPriceKcoin)} / ratio{" "}
                  {formatBps(finding.ratioBps)}
                </small>
                <small>{finding.reason ?? finding.ruleSummary ?? "-"}</small>
              </div>
              <div className="list-row__actions">
                <StatusBadge status={finding.priceHealth ?? "unknown"} />
                {finding.status ? (
                  <StatusBadge status={finding.status} />
                ) : null}
              </div>
            </div>
          ))
        )}

        <div className="list-row">
          <div>
            <strong>同用户异常刷单</strong>
            <small>按买卖双方、设备、钱包、IP hash 关联风控结果展示。</small>
          </div>
          <StatusBadge status={`${suspiciousGroups.length}`} />
        </div>
        {suspiciousGroups.length === 0 ? (
          <p className="notice">
            暂无后端返回的疑似刷单分组；不会在前端展示完整钱包、设备或 IP hash。
          </p>
        ) : (
          suspiciousGroups.map((group, index) => (
            <div
              className="list-row"
              key={buildSuspiciousGroupKey(group, index)}
            >
              <div>
                <strong>{formatSuspiciousGroupTitle(group)}</strong>
                <small>{formatSuspiciousGroupEvidence(group)}</small>
                <small>{group.evidenceSummary ?? "-"}</small>
              </div>
              <div className="list-row__actions">
                <StatusBadge status={group.status ?? "review"} />
                {group.riskEventId ? (
                  <small>risk {shortId(group.riskEventId)}</small>
                ) : null}
              </div>
            </div>
          ))
        )}

        <div className="list-row">
          <div>
            <strong>平台手续费收入来源</strong>
            <small>
              优先展示 market.fee_settlements；也支持 ledger source 聚合。
            </small>
          </div>
          <StatusBadge status={`${feeSources.length}`} />
        </div>
        {feeSources.length === 0 ? (
          <p className="notice">
            后端暂未返回手续费来源拆分；顶部仍展示 24h 手续费收入聚合。
          </p>
        ) : (
          feeSources.map((source, index) => (
            <div
              className="list-row"
              key={`${source.source}:${source.status ?? "source"}:${index}`}
            >
              <div>
                <strong>{formatKcoin(source.amountKcoin)}</strong>
                <small>{source.sourceLabel ?? source.source}</small>
                <small>{formatFeeSourceCounts(source)}</small>
              </div>
              <div className="list-row__actions">
                <StatusBadge status={source.status ?? "source"} />
                <small>{formatDate(source.updatedAt ?? null)}</small>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function MarketListingsTable(props: {
  busyListingId: string | null;
  canWriteMarket: boolean;
  listings: MarketListingAdminItem[];
  selectedListingId: string;
  onForceCancel: (listing: MarketListingAdminItem) => void;
  onSelect: (listingId: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>挂单</th>
            <th>状态</th>
            <th>藏品</th>
            <th>价格</th>
            <th>用户</th>
            <th>时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {props.listings.length === 0 ? (
            <tr>
              <td colSpan={7}>暂无市场挂单</td>
            </tr>
          ) : (
            props.listings.map((listing) => (
              <MarketListingRow
                busy={props.busyListingId === listing.id}
                key={listing.id}
                listing={listing}
                selected={props.selectedListingId === listing.id}
                canWriteMarket={props.canWriteMarket}
                onForceCancel={props.onForceCancel}
                onSelect={props.onSelect}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function MarketListingRow(props: {
  busy: boolean;
  canWriteMarket: boolean;
  listing: MarketListingAdminItem;
  selected: boolean;
  onForceCancel: (listing: MarketListingAdminItem) => void;
  onSelect: (listingId: string) => void;
}) {
  const canForceCancel =
    props.canWriteMarket && props.listing.status === "active";

  return (
    <tr className={props.selected ? "is-selected" : ""}>
      <td>
        <strong>{shortId(props.listing.id)}</strong>
        <small>{props.listing.id}</small>
      </td>
      <td>
        <StatusBadge status={props.listing.status} />
        {props.listing.priceHealth ? (
          <small>{props.listing.priceHealth}</small>
        ) : null}
      </td>
      <td>
        <strong>{formatListingTemplate(props.listing)}</strong>
        <small>
          {props.listing.rarityCode ?? "-"}
          {props.listing.formName ? ` / ${props.listing.formName}` : ""}
        </small>
      </td>
      <td>
        <strong>{formatKcoin(props.listing.unitPriceKcoin)}</strong>
        <small>
          {formatCount(props.listing.remainingCount)}/
          {formatCount(props.listing.itemCount)} 件
        </small>
      </td>
      <td>
        <strong>{formatUser(props.listing)}</strong>
        <small>{props.listing.sellerTelegramId ?? "-"}</small>
      </td>
      <td>
        <strong>{formatDate(props.listing.createdAt ?? null)}</strong>
        <small>到期 {formatDate(props.listing.expiresAt ?? null)}</small>
      </td>
      <td>
        <div className="action-cell">
          <button
            className="text-button text-button--with-icon"
            onClick={() => props.onSelect(props.listing.id)}
            type="button"
          >
            <Eye aria-hidden="true" size={15} />
            <span>详情</span>
          </button>
          <button
            className="icon-button icon-button--danger"
            disabled={!canForceCancel || props.busy}
            onClick={() => props.onForceCancel(props.listing)}
            title={
              props.canWriteMarket
                ? "仅 active 挂单允许强制下架"
                : "需要 market:write 或 admin:write"
            }
            type="button"
          >
            <Ban aria-hidden="true" size={15} />
            <span>{props.busy ? "提交中" : "下架"}</span>
          </button>
        </div>
      </td>
    </tr>
  );
}

function MarketAnomalyGroups(props: {
  canWriteMarket: boolean;
  groups: Record<MarketAnomalyGroup, MarketListingAdminItem[]>;
  onForceCancel: (listing: MarketListingAdminItem) => void;
  onSelect: (listingId: string) => void;
}) {
  return (
    <section className="detail-panel" aria-label="Market anomaly listings">
      <div className="detail-panel__header">
        <div>
          <h2>异常挂单</h2>
          <p>按过低价、过高价、自买自卖疑似、锁异常独立分组。</p>
        </div>
        <StatusBadge status={`${countAnomalies(props.groups)}`} />
      </div>
      <div className="split-grid split-grid--even">
        <AnomalyGroup
          iconLabel="low"
          listings={props.groups.low_price}
          title="过低价"
          canWriteMarket={props.canWriteMarket}
          onForceCancel={props.onForceCancel}
          onSelect={props.onSelect}
        />
        <AnomalyGroup
          iconLabel="high"
          listings={props.groups.high_price}
          title="过高价"
          canWriteMarket={props.canWriteMarket}
          onForceCancel={props.onForceCancel}
          onSelect={props.onSelect}
        />
        <AnomalyGroup
          iconLabel="self"
          listings={props.groups.self_trade}
          title="自买自卖疑似"
          canWriteMarket={props.canWriteMarket}
          onForceCancel={props.onForceCancel}
          onSelect={props.onSelect}
        />
        <AnomalyGroup
          iconLabel="lock"
          listings={props.groups.lock}
          title="锁异常"
          canWriteMarket={props.canWriteMarket}
          onForceCancel={props.onForceCancel}
          onSelect={props.onSelect}
        />
      </div>
    </section>
  );
}

function AnomalyGroup(props: {
  canWriteMarket: boolean;
  iconLabel: string;
  listings: MarketListingAdminItem[];
  title: string;
  onForceCancel: (listing: MarketListingAdminItem) => void;
  onSelect: (listingId: string) => void;
}) {
  return (
    <section className="ops-card">
      <header>
        <div>
          <p>{props.iconLabel}</p>
          <h2>{props.title}</h2>
        </div>
        <StatusBadge status={`${props.listings.length}`} />
      </header>
      <div className="stack-list stack-list--spaced">
        {props.listings.length === 0 ? (
          <p className="notice">暂无异常挂单。</p>
        ) : (
          props.listings.map((listing) => (
            <div className="list-row" key={`${props.iconLabel}:${listing.id}`}>
              <div>
                <strong>{shortId(listing.id)}</strong>
                <small>
                  {formatListingTemplate(listing)} /{" "}
                  {formatKcoin(listing.unitPriceKcoin)}
                </small>
              </div>
              <div className="list-row__actions">
                <StatusBadge status={listing.status} />
                <button
                  className="text-button text-button--with-icon"
                  onClick={() => props.onSelect(listing.id)}
                  type="button"
                >
                  <Eye aria-hidden="true" size={15} />
                  <span>详情</span>
                </button>
                <button
                  className="icon-button icon-button--danger"
                  disabled={
                    !props.canWriteMarket || listing.status !== "active"
                  }
                  onClick={() => props.onForceCancel(listing)}
                  title={
                    props.canWriteMarket && listing.status === "active"
                      ? "强制下架"
                      : "需要写权限且仅 active 挂单允许强制下架"
                  }
                  type="button"
                >
                  <AlertTriangle aria-hidden="true" size={15} />
                  <span>下架</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function MarketListingDetail({ detail }: { detail: MarketListingAdminDetail }) {
  return (
    <div className="stack-list">
      <div className="detail-grid detail-grid--wide">
        <DetailItem label="挂单 ID" value={detail.id} />
        <DetailItem label="模板" value={formatTemplate(detail)} />
        <DetailItem label="形态" value={formatForm(detail)} />
        <DetailItem label="稀有度" value={detail.rarityCode} />
        <DetailItem
          label="数量"
          value={`${detail.remainingCount}/${detail.itemCount}`}
        />
        <DetailItem label="单价 Kcoin" value={String(detail.unitPriceKcoin)} />
        <DetailItem label="手续费 bps" value={String(detail.feeBps)} />
        <DetailItem
          label="预估净入账"
          value={String(detail.expectedNetAmount)}
        />
        <DetailItem label="价格健康" value={detail.priceHealth ?? "-"} />
        <DetailItem label="到期" value={formatDate(detail.expiresAt ?? null)} />
        <DetailItem label="创建" value={formatDate(detail.createdAt)} />
        <DetailItem label="更新" value={formatDate(detail.updatedAt)} />
      </div>

      <section className="ops-card">
        <header>
          <div>
            <p>Listing items</p>
            <h2>锁定资产</h2>
          </div>
          <StatusBadge status={`${detail.items.length}`} />
        </header>
        <div className="stack-list stack-list--spaced">
          {detail.items.length > 0 ? (
            detail.items.map((item) => (
              <div className="list-row" key={item.id}>
                <div>
                  <strong>{shortId(item.itemInstanceId)}</strong>
                  <small>
                    level {item.level ?? "-"} / power {item.power ?? "-"}
                  </small>
                </div>
                <div className="list-row__actions">
                  <StatusBadge status={item.status} />
                  {item.itemStatus ? (
                    <StatusBadge status={item.itemStatus} />
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <p className="notice">没有挂单资产记录。</p>
          )}
        </div>
      </section>

      <section className="ops-card">
        <header>
          <div>
            <p>Orders</p>
            <h2>成交记录</h2>
          </div>
          <StatusBadge status={`${detail.orders.length}`} />
        </header>
        <div className="stack-list stack-list--spaced">
          {detail.orders.length > 0 ? (
            detail.orders.map((order) => (
              <div className="list-row" key={order.id}>
                <div>
                  <strong>{shortId(order.id)}</strong>
                  <small>
                    {order.itemCount} 件 / {String(order.totalPriceKcoin)} Kcoin
                  </small>
                </div>
                <div className="list-row__actions">
                  <StatusBadge status={order.status} />
                  <small>{formatDate(order.createdAt ?? null)}</small>
                </div>
              </div>
            ))
          ) : (
            <p className="notice">没有成交记录。</p>
          )}
        </div>
      </section>

      <section className="ops-card">
        <header>
          <div>
            <p>Events</p>
            <h2>挂单事件</h2>
          </div>
          <a
            className="icon-button"
            href={`#audit?targetSchema=market&targetTable=listings&targetId=${encodeURIComponent(detail.id)}`}
          >
            <ExternalLink aria-hidden="true" size={15} />
            <span>审计</span>
          </a>
        </header>
        <div className="stack-list stack-list--spaced">
          {detail.events.length > 0 ? (
            detail.events.map((event) => (
              <div className="list-row" key={event.id}>
                <div>
                  <strong>{event.eventType}</strong>
                  <small>{shortId(event.id)}</small>
                </div>
                <small>{formatDate(event.createdAt ?? null)}</small>
              </div>
            ))
          ) : (
            <p className="notice">没有挂单事件。</p>
          )}
        </div>
      </section>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function readActiveListingValue(
  stats: MarketOpsStats | null,
): number | string | null | undefined {
  return stats?.activeListingValueKcoin ?? stats?.totalListingValueKcoin;
}

function readPriceReferences(
  stats: MarketOpsStats | null,
): MarketOpsPriceReferenceItem[] {
  return stats?.priceReferences ?? [];
}

function readPriceHealthFindings(
  stats: MarketOpsStats | null,
): MarketOpsPriceHealthFindingItem[] {
  return stats?.priceHealthFindings ?? [];
}

function readSuspiciousTradeGroups(
  stats: MarketOpsStats | null,
): MarketOpsSuspiciousTradeGroupItem[] {
  return stats?.suspiciousTradeGroups ?? [];
}

function readFeeRevenueSources(
  stats: MarketOpsStats | null,
): MarketOpsFeeRevenueSourceItem[] {
  return stats?.feeRevenueSources ?? [];
}

function buildPriceReferenceKey(
  row: MarketOpsPriceReferenceItem,
  index: number,
): string {
  return [
    row.templateId ?? row.templateSlug ?? "template",
    row.formId ?? row.formName ?? "form",
    row.lastSaleOrderId ?? index,
  ].join(":");
}

function buildSuspiciousGroupKey(
  group: MarketOpsSuspiciousTradeGroupItem,
  index: number,
): string {
  return group.id ?? group.riskEventId ?? `suspicious:${index}`;
}

function formatPriceReferenceTitle(ref: MarketOpsCatalogRef): string {
  const template =
    ref.templateName ??
    ref.templateSlug ??
    (ref.templateId ? shortId(ref.templateId) : "未知 template");
  const form = ref.formName ?? (ref.formId ? shortId(ref.formId) : "默认 form");

  return `${template} / ${form}`;
}

function formatPriceReferenceMeta(ref: MarketOpsCatalogRef): string {
  const parts = [
    ref.rarityCode ? `rarity ${ref.rarityCode}` : null,
    ref.templateId ? `template ${shortId(ref.templateId)}` : null,
    ref.formId ? `form ${shortId(ref.formId)}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" / ") : "-";
}

function formatPriceReferenceSamples(row: MarketOpsPriceReferenceItem): string {
  const completedCount = row.completedOrderCount ?? row.saleCount24h;

  return `active ${formatMetric(row.activeListingCount)} / 成交 ${formatMetric(
    completedCount,
  )}`;
}

function formatRecentSaleMeta(row: MarketOpsPriceReferenceItem): string {
  const parts = [
    row.lastSaleAt ? formatDate(row.lastSaleAt) : null,
    row.lastSaleOrderId ? `order ${shortId(row.lastSaleOrderId)}` : null,
    row.lastSaleListingId ? `listing ${shortId(row.lastSaleListingId)}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" / ") : "暂无最近成交";
}

function formatPriceHealthCounts(
  counts: Record<string, number> | null | undefined,
): string {
  const entries = Object.entries(counts ?? {});

  if (entries.length === 0) {
    return "后端暂未返回 price health counts";
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}: ${count}`)
    .join(" / ");
}

function formatSuspiciousGroupTitle(
  group: MarketOpsSuspiciousTradeGroupItem,
): string {
  const seller = group.sellerUserId
    ? `seller ${shortId(group.sellerUserId)}`
    : "seller -";
  const buyer = group.buyerUserId
    ? `buyer ${shortId(group.buyerUserId)}`
    : "buyer -";

  return `${seller} / ${buyer}`;
}

function formatSuspiciousGroupEvidence(
  group: MarketOpsSuspiciousTradeGroupItem,
): string {
  const parts = [
    `订单 ${formatMetric(group.orderCount)}`,
    `挂单 ${formatMetric(group.listingCount)}`,
    `成交额 ${formatKcoin(group.totalVolumeKcoin)}`,
    `设备 ${formatMetric(group.sharedDeviceCount)}`,
    `钱包 ${formatMetric(group.sharedWalletCount)}`,
    `IP hash ${formatMetric(group.sharedIpHashCount)}`,
  ];
  const relatedOrders = formatShortIdList(group.relatedOrderIds, "orders");
  const relatedListings = formatShortIdList(
    group.relatedListingIds,
    "listings",
  );

  return [parts.join(" / "), relatedOrders, relatedListings]
    .filter((part): part is string => Boolean(part))
    .join(" / ");
}

function formatShortIdList(
  values: string[] | null | undefined,
  label: string,
): string | null {
  if (!values || values.length === 0) {
    return null;
  }

  const visible = values.slice(0, 3).map(shortId).join(", ");
  const hiddenCount = values.length - 3;

  return hiddenCount > 0
    ? `${label} ${visible} +${hiddenCount}`
    : `${label} ${visible}`;
}

function formatFeeSourceCounts(source: MarketOpsFeeRevenueSourceItem): string {
  return [
    source.currencyCode ? `currency ${source.currencyCode}` : null,
    `orders ${formatMetric(source.orderCount)}`,
    `settlements ${formatMetric(source.settlementCount)}`,
    `ledger ${formatMetric(source.ledgerEntryCount)}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" / ");
}

function buildPriceRuleInput(draft: PriceRuleDraft, reason: string) {
  return {
    id: readOptionalDraftValue(draft.id),
    templateId: readOptionalDraftValue(draft.templateId),
    rarityCode: readOptionalDraftValue(draft.rarityCode),
    formIndex: parseOptionalIntegerDraft(draft.formIndex, "形态序号"),
    minPriceKcoin: parseRequiredNumberDraft(draft.minPriceKcoin, "最低价"),
    maxPriceKcoin: parseOptionalNumberDraft(draft.maxPriceKcoin, "最高价"),
    suggestedPriceKcoin: parseOptionalNumberDraft(
      draft.suggestedPriceKcoin,
      "建议价",
    ),
    active: draft.active,
    metadata: parseMetadataDraft(draft.metadata),
    reason,
  };
}

function buildHealthRuleInput(draft: HealthRuleDraft, reason: string) {
  const lowBps = parseRequiredIntegerDraft(draft.lowBps, "低价 bps");
  const highBps = parseRequiredIntegerDraft(draft.highBps, "高价 bps");

  if (!(lowBps < 10_000 && highBps > 10_000)) {
    throw new Error("健康阈值必须满足 lowBps < 10000 < highBps");
  }

  return {
    id: readOptionalDraftValue(draft.id),
    templateId: readOptionalDraftValue(draft.templateId),
    formId: readOptionalDraftValue(draft.formId),
    rarityCode: readOptionalDraftValue(draft.rarityCode),
    lowBps,
    highBps,
    active: draft.active,
    metadata: parseMetadataDraft(draft.metadata),
    reason,
  };
}

function buildFeeRuleInput(draft: FeeRuleDraft, reason: string) {
  const feeBps = parseRequiredIntegerDraft(draft.feeBps, "fee bps");

  if (feeBps < 0 || feeBps > 3000) {
    throw new Error("fee bps 必须在 0 到 3000 之间");
  }

  return {
    id: readOptionalDraftValue(draft.id),
    code: readOptionalDraftValue(draft.code),
    feeBps,
    minFee: parseOptionalIntegerDraft(draft.minFee, "最低费") ?? 0,
    maxFee: parseOptionalIntegerDraft(draft.maxFee, "最高费"),
    startsAt: readOptionalDraftValue(draft.startsAt),
    endsAt: readOptionalDraftValue(draft.endsAt),
    active: draft.active,
    metadata: parseMetadataDraft(draft.metadata),
    reason,
  };
}

function buildPriceRuleTarget(draft: PriceRuleDraft): string {
  return (
    readOptionalDraftValue(draft.id) ??
    readOptionalDraftValue(draft.templateId) ??
    readOptionalDraftValue(draft.rarityCode) ??
    "market-price-rule"
  );
}

function buildHealthRuleTarget(draft: HealthRuleDraft): string {
  return (
    readOptionalDraftValue(draft.id) ??
    readOptionalDraftValue(draft.formId) ??
    readOptionalDraftValue(draft.templateId) ??
    readOptionalDraftValue(draft.rarityCode) ??
    "market-health-rule"
  );
}

function buildFeeRuleTarget(draft: FeeRuleDraft): string {
  return (
    readOptionalDraftValue(draft.id) ??
    readOptionalDraftValue(draft.code) ??
    "market-fee-rule"
  );
}

function formatRuleActionTitle(action: MarketRuleAction | null): string {
  switch (action?.kind) {
    case "price":
      return "保存市场价格规则";
    case "health":
      return "保存价格健康规则";
    case "fee":
      return "保存市场手续费规则";
    case "rebuild":
      return "重建市场统计";
    default:
      return "确认市场操作";
  }
}

function formatRuleActionTargetLabel(action: MarketRuleAction | null): string {
  switch (action?.kind) {
    case "price":
      return "价格规则";
    case "health":
      return "健康规则";
    case "fee":
      return "手续费规则";
    case "rebuild":
      return "统计任务";
    default:
      return "市场操作";
  }
}

function formatRuleActionConfirmLabel(action: MarketRuleAction | null): string {
  return action?.kind === "rebuild" ? "确认重建" : "确认保存";
}

function formatPriceRuleSummary(rule: MarketPriceRule): string {
  return [
    shortId(rule.id),
    rule.rarityCode ?? "ALL",
    rule.templateId ? `template ${shortId(rule.templateId)}` : null,
    rule.formIndex ? `form #${rule.formIndex}` : null,
    `${formatKcoin(rule.minPriceKcoin)} - ${formatKcoin(rule.maxPriceKcoin)}`,
    rule.active ? "active" : "inactive",
  ]
    .filter((part): part is string => Boolean(part))
    .join(" / ");
}

function formatHealthRuleSummary(rule: MarketHealthRule): string {
  const lowBps =
    rule.lowBps ?? ratioToBps(rule.minRatioToFloor as number | string | null);
  const highBps =
    rule.highBps ?? ratioToBps(rule.maxRatioToFloor as number | string | null);

  return [
    shortId(rule.id),
    rule.rarityCode ?? "ALL",
    rule.formName ?? (rule.formId ? `form ${shortId(rule.formId)}` : null),
    rule.templateId ? `template ${shortId(rule.templateId)}` : null,
    `${lowBps ?? "-"} / ${highBps ?? "-"} bps`,
    rule.active ? "active" : "inactive",
  ]
    .filter((part): part is string => Boolean(part))
    .join(" / ");
}

function formatFeeRuleSummary(rule: MarketFeeRule): string {
  return [
    rule.code,
    `${rule.feeBps} bps`,
    `${rule.minFee ?? 0}-${rule.maxFee ?? "不限"} fee`,
    rule.startsAt ? `start ${formatDate(rule.startsAt)}` : null,
    rule.endsAt ? `end ${formatDate(rule.endsAt)}` : null,
    rule.active ? "active" : "inactive",
  ]
    .filter((part): part is string => Boolean(part))
    .join(" / ");
}

function ratioToBps(value: number | string | null | undefined): number | null {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.round(numericValue * 10_000);
}

function readOptionalDraftValue(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function parseRequiredNumberDraft(value: string, label: string): number {
  const normalized = Number(value);

  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${label} 必须是非负数字`);
  }

  return normalized;
}

function parseOptionalNumberDraft(value: string, label: string): number | null {
  if (!value.trim()) {
    return null;
  }

  return parseRequiredNumberDraft(value, label);
}

function parseRequiredIntegerDraft(value: string, label: string): number {
  const normalized = parseRequiredNumberDraft(value, label);

  if (!Number.isInteger(normalized)) {
    throw new Error(`${label} 必须是整数`);
  }

  return normalized;
}

function parseOptionalIntegerDraft(
  value: string,
  label: string,
): number | null {
  if (!value.trim()) {
    return null;
  }

  return parseRequiredIntegerDraft(value, label);
}

function parseMetadataDraft(value: string): Record<string, unknown> {
  const normalized = value.trim();

  if (!normalized) {
    return {};
  }

  const parsed = JSON.parse(normalized) as unknown;

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Metadata 必须是 JSON object");
  }

  return parsed as Record<string, unknown>;
}

function compactFilters(filters: MarketAdminListingFilters) {
  return {
    ...(filters.status.trim() ? { status: filters.status.trim() } : {}),
    ...(filters.rarityCode.trim()
      ? { rarityCode: filters.rarityCode.trim() }
      : {}),
    ...(filters.template.trim() ? { templateId: filters.template.trim() } : {}),
    ...(filters.minPrice.trim()
      ? { minPriceKcoin: filters.minPrice.trim() }
      : {}),
    ...(filters.maxPrice.trim()
      ? { maxPriceKcoin: filters.maxPrice.trim() }
      : {}),
    ...(filters.user.trim() ? { sellerUserId: filters.user.trim() } : {}),
  };
}

function readListingItems(
  response: MarketAdminListingsResponse,
): MarketListingAdminItem[] {
  return response.items;
}

function groupAnomalies(listings: MarketListingAdminItem[]) {
  const groups: Record<MarketAnomalyGroup, MarketListingAdminItem[]> = {
    high_price: [],
    lock: [],
    low_price: [],
    self_trade: [],
  };

  for (const listing of listings) {
    const flags = getListingAnomalyFlags(listing);

    if (flags.has("low_price")) {
      groups.low_price.push(listing);
    }

    if (flags.has("high_price")) {
      groups.high_price.push(listing);
    }

    if (flags.has("self_trade")) {
      groups.self_trade.push(listing);
    }

    if (flags.has("lock")) {
      groups.lock.push(listing);
    }
  }

  return groups;
}

function getListingAnomalyFlags(listing: MarketListingAdminItem) {
  const flags = new Set<MarketAnomalyGroup>();
  const values = [
    listing.priceHealth,
    listing.anomalyType,
    ...(listing.anomalyTypes ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  if (
    values.some(
      (value) =>
        value.includes("low") ||
        value.includes("under") ||
        value.includes("过低"),
    )
  ) {
    flags.add("low_price");
  }

  if (
    values.some(
      (value) =>
        value.includes("high") ||
        value.includes("over") ||
        value.includes("过高"),
    )
  ) {
    flags.add("high_price");
  }

  if (
    values.some(
      (value) =>
        value.includes("self") ||
        value.includes("wash") ||
        value.includes("自买") ||
        value.includes("刷单"),
    )
  ) {
    flags.add("self_trade");
  }

  if (
    listing.lockStatus?.toLowerCase() === "abnormal" ||
    values.some((value) => value.includes("lock") || value.includes("锁"))
  ) {
    flags.add("lock");
  }

  return flags;
}

function countAnomalies(
  groups: Record<MarketAnomalyGroup, MarketListingAdminItem[]>,
) {
  return Object.values(groups).reduce(
    (total, items) => total + items.length,
    0,
  );
}

function formatListingTemplate(listing: MarketListingAdminItem): string {
  if (listing.templateName) {
    return listing.templateName;
  }

  if (listing.templateSlug) {
    return listing.templateSlug;
  }

  return listing.templateId ? shortId(listing.templateId) : "-";
}

function formatTemplate(detail: MarketListingAdminDetail): string {
  if (!detail.template) {
    return shortId(detail.templateId);
  }

  return `${detail.template.displayName} / ${shortId(detail.template.id)}`;
}

function formatForm(detail: MarketListingAdminDetail): string {
  if (!detail.form) {
    return detail.formId ? shortId(detail.formId) : "-";
  }

  return `${detail.form.displayName} / ${shortId(detail.form.id)}`;
}

function formatUser(listing: MarketListingAdminItem): string {
  return listing.sellerUserId ? shortId(listing.sellerUserId) : "-";
}

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : String(value);
}

function formatMetric(value: number | string | null | undefined): string {
  return value === null || value === undefined ? "-" : String(value);
}

function formatKcoin(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return `${value} Kcoin`;
}

function formatBps(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return String(value);
  }

  return `${(numericValue / 100).toFixed(1)}%`;
}

function formatStatsWindow(
  window: MarketOpsStats["window"] | null | undefined,
): string {
  if (!window) {
    return "24h";
  }

  if (window.hours !== null && window.hours !== undefined) {
    return `${window.hours}h`;
  }

  if (window.startedAt || window.endedAt) {
    return `${formatDate(window.startedAt ?? null)} 起`;
  }

  return "24h";
}

function formatAdminLoadError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function readListingIdFromHash(): string {
  const [hashPath, query = ""] = window.location.hash.split("?");

  if (hashPath && hashPath !== "#market-ops") {
    return "";
  }

  return new URLSearchParams(query).get("listingId")?.trim() ?? "";
}
