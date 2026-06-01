import {
  AlertTriangle,
  Ban,
  ExternalLink,
  Eye,
  RefreshCw,
  Search,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  fetchMarketAdminListings,
  fetchMarketListingDetail,
  fetchMarketOpsStats,
  forceCancelMarketListing,
} from "../admin.api";
import type {
  MarketAdminListingsResponse,
  MarketListingAdminDetail,
  MarketListingAdminItem,
  MarketOpsStats,
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

export function MarketOpsPage() {
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
    } catch (loadError) {
      setListings([]);
      setListError(formatAdminLoadError(loadError, "市场挂单列表加载失败"));
    } finally {
      setListLoading(false);
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
    await Promise.all([loadStats(), loadListings()]);
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
      await Promise.all([loadStats(), loadListings(), loadDetail(listingId)]);
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
            placeholder="template id / slug / name"
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
            placeholder="user id / telegram id"
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
            listings={listings}
            selectedListingId={listingId}
            onForceCancel={setCancelDraft}
            onSelect={selectListing}
          />
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
    </section>
  );
}

function MarketStatsStrip({ stats }: { stats: MarketOpsStats | null }) {
  return (
    <div className="metric-strip">
      <span>
        <strong>{formatMetric(stats?.activeListingCount)}</strong>
        <small>活跃挂单</small>
      </span>
      <span>
        <strong>{formatKcoin(stats?.volume24hKcoin)}</strong>
        <small>成交额</small>
      </span>
      <span>
        <strong>{formatKcoin(stats?.feeRevenueKcoin)}</strong>
        <small>手续费</small>
      </span>
      <span>
        <strong>{formatMetric(stats?.abnormalListingCount)}</strong>
        <small>异常挂单</small>
      </span>
    </div>
  );
}

function MarketListingsTable(props: {
  busyListingId: string | null;
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
  listing: MarketListingAdminItem;
  selected: boolean;
  onForceCancel: (listing: MarketListingAdminItem) => void;
  onSelect: (listingId: string) => void;
}) {
  const canForceCancel = props.listing.status === "active";

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
            title={canForceCancel ? "强制下架" : "仅 active 挂单允许强制下架"}
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
          onForceCancel={props.onForceCancel}
          onSelect={props.onSelect}
        />
        <AnomalyGroup
          iconLabel="high"
          listings={props.groups.high_price}
          title="过高价"
          onForceCancel={props.onForceCancel}
          onSelect={props.onSelect}
        />
        <AnomalyGroup
          iconLabel="self"
          listings={props.groups.self_trade}
          title="自买自卖疑似"
          onForceCancel={props.onForceCancel}
          onSelect={props.onSelect}
        />
        <AnomalyGroup
          iconLabel="lock"
          listings={props.groups.lock}
          title="锁异常"
          onForceCancel={props.onForceCancel}
          onSelect={props.onSelect}
        />
      </div>
    </section>
  );
}

function AnomalyGroup(props: {
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
                  disabled={listing.status !== "active"}
                  onClick={() => props.onForceCancel(listing)}
                  title={
                    listing.status === "active"
                      ? "强制下架"
                      : "仅 active 挂单允许强制下架"
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

function compactFilters(filters: MarketAdminListingFilters) {
  return {
    ...(filters.status.trim() ? { status: filters.status.trim() } : {}),
    ...(filters.rarityCode.trim()
      ? { rarityCode: filters.rarityCode.trim() }
      : {}),
    ...(filters.template.trim() ? { template: filters.template.trim() } : {}),
    ...(filters.minPrice.trim()
      ? { minPriceKcoin: filters.minPrice.trim() }
      : {}),
    ...(filters.maxPrice.trim()
      ? { maxPriceKcoin: filters.maxPrice.trim() }
      : {}),
    ...(filters.user.trim() ? { user: filters.user.trim() } : {}),
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
