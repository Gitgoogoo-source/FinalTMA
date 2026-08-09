import {
  ArrowDownUp,
  Check,
  ChevronDown,
  Coins,
  Crown,
  Info,
  Layers3,
  PackageMinus,
  PackagePlus,
  PackageSearch,
  Percent,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Tags,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { useCatalogQuery } from "../../../platform/query/useCatalogQuery.ts";
import {
  usePageActive,
  usePageSearchParams,
} from "../../../shared/navigation/pageActivity.tsx";
import { AppModal } from "../../../shared/ui/AppModal.tsx";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { Card } from "../../../shared/ui/Card.tsx";
import { CatalogImage } from "../../../shared/ui/CatalogImage.tsx";
import { PageState } from "../../../shared/ui/PageState.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/context.ts";
import { useNavigationIntent } from "../../../workflows/payment-recovery/context.ts";
import { type MarketSoldEvent, useMarketSoldInbox } from "../soldInbox.ts";
import { MarketTabs, type MarketTab } from "./MarketTabs.tsx";
import { MarketSoldCoinEffect } from "./MarketSoldCoinEffect.tsx";
import {
  createMarketSoldCoinBurst,
  SOLD_CARD_DISMISS_DELAY_MS,
  SOLD_COIN_EFFECT_DURATION_MS,
  type MarketSoldCoinBurst,
} from "./marketSoldCoinEffect.ts";
import "./market-density.css";

type BuyFilter = "price" | "rarity" | "stage" | "sort";
type BuySort = "catalog" | "price-asc" | "price-desc" | "available";

export function MarketView({ vipBanner }: { vipBanner: ReactNode }): ReactNode {
  const [params, setParams] = usePageSearchParams();
  const requestedTab = parseTab(params.get("tab"));
  const [selectedTab, setSelectedTab] = useState<MarketTab>(
    requestedTab ?? (params.has("sell") ? "sell" : "buy"),
  );
  const tab = requestedTab ?? (params.has("sell") ? "sell" : selectedTab);
  const pageActive = usePageActive();
  const purchaseTarget = params.get("buy");
  const identity = useApiQuery("identity.bootstrap");
  const listings = useApiQuery("market.bootstrap", {}, tab === "buy");
  const targetListing = useApiQuery(
    "market.template",
    { template_id: purchaseTarget ?? "" },
    tab === "buy" && Boolean(purchaseTarget),
  );
  const sellable = useApiQuery("market.bootstrap", {}, tab === "sell");
  const {
    query: mine,
    listings: managedListings,
    soldEvents,
    dismiss: dismissSoldEvent,
  } = useMarketSoldInbox(pageActive, pageActive);
  const catalog = useCatalogQuery(soldEvents.length > 0);
  const { isBlocked, preload, run } = useOperationRegistry();
  const { requestTopup } = useNavigationIntent();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [priceFilter, setPriceFilter] = useState<number | null>(null);
  const [rarityFilter, setRarityFilter] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<number | null>(null);
  const [buySort, setBuySort] = useState<BuySort>("catalog");
  const [openFilter, setOpenFilter] = useState<BuyFilter | null>(null);
  const [pendingDelist, setPendingDelist] = useState<MarketViewItem | null>(
    null,
  );
  const [soldCoinBursts, setSoldCoinBursts] = useState<MarketSoldCoinBurst[]>(
    [],
  );
  const [dismissingSoldEvents, setDismissingSoldEvents] = useState<Set<string>>(
    () => new Set(),
  );
  const soldEffectTimers = useRef<Set<number>>(new Set());
  const listingInProgress = isBlocked("market.create_listing");
  const purchaseInProgress = isBlocked("market.purchase");
  const blocked =
    purchaseInProgress ||
    listingInProgress ||
    isBlocked("market.cancel_template_listings");
  const purchaseTemplates = (listings.data?.templates ?? [])
    .map((item) => {
      const current =
        item.template_id === purchaseTarget && targetListing.data
          ? targetListing.data
          : item;
      return { ...current, available: current.available_quantity };
    })
    .filter((item) => item.available + item.own_listed_quantity > 0);
  const data: MarketViewItem[] =
    tab === "buy"
      ? purchaseTemplates
      : tab === "sell"
        ? (sellable.data?.sellable_items ?? []).map((item) => ({
            ...item,
            available: item.available,
          }))
        : managedListings.map((item) => ({
            ...item,
            available: item.listed_quantity,
          }));
  const state = tab === "buy" ? listings : tab === "sell" ? sellable : mine;
  const preset = tab === "buy" ? purchaseTarget : null;
  const resumedTemplate = params.get("resume")
    ? params.get("template_id")
    : null;
  const requestedQuantity = parsePositiveQuantity(params.get("quantity"));
  const sorted = useMemo(
    () =>
      preset
        ? [...data].sort(
            (left, right) =>
              Number(right.template_id === preset) -
              Number(left.template_id === preset),
          )
        : data,
    [data, preset],
  );
  const priceOptions = useMemo(
    () =>
      [...new Set(purchaseTemplates.map((item) => item.unit_price))].sort(
        (left, right) => left - right,
      ),
    [purchaseTemplates],
  );
  const rarityOptions = useMemo(
    () =>
      [...new Set(purchaseTemplates.map((item) => item.rarity).filter(Boolean))]
        .map(String)
        .sort((left, right) => rarityOrder(left) - rarityOrder(right)),
    [purchaseTemplates],
  );
  const stageOptions = useMemo(
    () =>
      [
        ...new Set(
          purchaseTemplates
            .map((item) => item.stage)
            .filter((value): value is number => typeof value === "number"),
        ),
      ].sort((left, right) => left - right),
    [purchaseTemplates],
  );
  const visible = useMemo(() => {
    if (tab !== "buy") return sorted;
    const filtered = sorted.filter(
      (item) =>
        (priceFilter === null || item.unit_price === priceFilter) &&
        (rarityFilter === null || item.rarity === rarityFilter) &&
        (stageFilter === null || item.stage === stageFilter),
    );
    if (buySort === "price-asc")
      return [...filtered].sort(
        (left, right) => left.unit_price - right.unit_price,
      );
    if (buySort === "price-desc")
      return [...filtered].sort(
        (left, right) => right.unit_price - left.unit_price,
      );
    if (buySort === "available")
      return [...filtered].sort(
        (left, right) => right.available - left.available,
      );
    return filtered;
  }, [buySort, priceFilter, rarityFilter, sorted, stageFilter, tab]);
  const hasManageContent =
    tab === "manage" && (visible.length > 0 || soldEvents.length > 0);
  const selectedSellItem =
    tab === "sell"
      ? (visible.find((item) => item.template_id === params.get("sell")) ??
        visible[0])
      : undefined;
  const activeTemplateIds = new Set(
    managedListings.map((item) => item.template_id),
  );
  const selectTab = (nextTab: MarketTab) => {
    setSelectedTab(nextTab);
    setParams({}, { replace: true });
  };
  const submit = (item: MarketViewItem, quantity: number) => {
    setFeedback(null);
    if (tab === "buy") {
      const balance = identity.data?.assets.kcoin.available;
      const total = item.unit_price * quantity;
      if (balance !== undefined && balance < total) {
        requestTopup(
          { kind: "market", template_id: item.template_id, quantity },
          total - balance,
        );
        return;
      }
      void run(
        "购买中",
        "market.purchase",
        {
          template_id: item.template_id,
          quantity,
        },
        {
          presentation: {
            name: item.name,
            imagePath: item.image_thumbnail_url,
          },
        },
      );
      return;
    }
    if (tab === "sell") {
      const limit = sellable.data?.max_active_templates ?? 10;
      if (
        mine.data &&
        activeTemplateIds.size >= limit &&
        !activeTemplateIds.has(item.template_id)
      ) {
        setFeedback(`最多同时出售 ${limit} 种藏品，请先售罄或下架一种藏品`);
        return;
      }
      void run("正在创建出售", "market.create_listing", {
        template_id: item.template_id,
        quantity,
      });
      return;
    }
    setPendingDelist(item);
  };
  const confirmDelist = () => {
    if (!pendingDelist) return;
    const templateId = pendingDelist.template_id;
    setPendingDelist(null);
    void run(
      "正在下架该藏品的全部未成交数量",
      "market.cancel_template_listings",
      { template_id: templateId },
    );
  };
  const dismissSoldWithEffect = useCallback(
    (event: MarketSoldEvent, trigger: HTMLButtonElement) => {
      if (dismissingSoldEvents.has(event.sale_sequence)) return;
      const burst = createMarketSoldCoinBurst(event.sale_sequence, trigger);
      if (!burst) {
        dismissSoldEvent(event.sale_sequence);
        return;
      }

      setDismissingSoldEvents((current) => {
        const next = new Set(current);
        next.add(event.sale_sequence);
        return next;
      });
      setSoldCoinBursts((current) => [...current, burst]);

      const dismissTimer = window.setTimeout(() => {
        soldEffectTimers.current.delete(dismissTimer);
        dismissSoldEvent(event.sale_sequence);
        setDismissingSoldEvents((current) => {
          const next = new Set(current);
          next.delete(event.sale_sequence);
          return next;
        });
      }, SOLD_CARD_DISMISS_DELAY_MS);
      soldEffectTimers.current.add(dismissTimer);

      const cleanupTimer = window.setTimeout(() => {
        soldEffectTimers.current.delete(cleanupTimer);
        setSoldCoinBursts((current) =>
          current.filter((item) => item.id !== burst.id),
        );
      }, SOLD_COIN_EFFECT_DURATION_MS + 40);
      soldEffectTimers.current.add(cleanupTimer);
    },
    [dismissSoldEvent, dismissingSoldEvents],
  );
  useEffect(
    () => () => {
      soldEffectTimers.current.forEach((timer) => window.clearTimeout(timer));
      soldEffectTimers.current.clear();
    },
    [],
  );
  return (
    <main className={`page market-page market-page-${tab}`}>
      <MarketTabs
        activeTab={tab}
        focusActive={params.get("focus") === `market-${tab}`}
        focusReady={!state.isLoading}
        manageAttention={soldEvents.length > 0}
        onSelect={selectTab}
      />
      {tab === "buy" && purchaseTarget && targetListing.data && (
        <Card className="market-target" role="status">
          <strong>已定位：{targetListing.data.name}</strong>
          <p>
            {targetListing.data.available_quantity > 0
              ? `当前可买 ${targetListing.data.available_quantity} 个。`
              : targetListing.data.own_listed_quantity > 0
                ? "市场当前仅有你的挂单，不能购买自己的挂单。"
                : "市场当前没有有效挂单，该藏品不在购买列表中。"}
          </p>
          <Button className="secondary" onClick={() => setParams({})}>
            查看全部在售藏品
          </Button>
        </Card>
      )}
      {tab === "buy" && purchaseTarget && targetListing.isLoading && (
        <Card className="market-target" role="status">
          正在定位图鉴藏品的实时市场状态
        </Card>
      )}
      {tab === "buy" && purchaseTarget && targetListing.error && (
        <Card className="market-target" role="alert">
          <strong>目标藏品定位失败</strong>
          <p>完整市场目录仍可浏览，请重新进入图鉴后再试。</p>
        </Card>
      )}
      {resumedTemplate && (
        <Card className="resume-intent">
          <strong>充值已到账</strong>
          <p>
            已恢复原购买选择。库存、单价、数量与总价将按当前真实状态重新确认，不会自动成交。
          </p>
          <Button
            disabled={
              blocked ||
              !data.some(
                (item) =>
                  item.template_id === resumedTemplate && item.available > 0,
              )
            }
            onClick={() => {
              const item = data.find(
                (candidate) => candidate.template_id === resumedTemplate,
              );
              if (item && item.available > 0) {
                setParams({});
                submit(item, Math.min(item.available, requestedQuantity));
              }
            }}
          >
            重新确认购买
          </Button>
        </Card>
      )}
      {tab === "buy" && vipBanner}
      {tab === "buy" && (
        <div className="market-buy-controls">
          <div className="market-filter-strip">
            <MarketFilterButton
              icon={<Coins />}
              label={priceFilter === null ? "价格" : `${priceFilter} K`}
              active={priceFilter !== null || openFilter === "price"}
              expanded={openFilter === "price"}
              onClick={() =>
                setOpenFilter((value) => (value === "price" ? null : "price"))
              }
            />
            <MarketFilterButton
              icon={<ShoppingBag />}
              label={
                rarityFilter === null ? "稀有度" : rarityLabel(rarityFilter)
              }
              active={rarityFilter !== null || openFilter === "rarity"}
              expanded={openFilter === "rarity"}
              onClick={() =>
                setOpenFilter((value) => (value === "rarity" ? null : "rarity"))
              }
            />
            <MarketFilterButton
              icon={<Layers3 />}
              label={stageFilter === null ? "阶级" : `第 ${stageFilter} 阶`}
              active={stageFilter !== null || openFilter === "stage"}
              expanded={openFilter === "stage"}
              onClick={() =>
                setOpenFilter((value) => (value === "stage" ? null : "stage"))
              }
            />
            <MarketFilterButton
              icon={<ArrowDownUp />}
              label={sortLabel(buySort)}
              active={buySort !== "catalog" || openFilter === "sort"}
              expanded={openFilter === "sort"}
              onClick={() =>
                setOpenFilter((value) => (value === "sort" ? null : "sort"))
              }
            />
          </div>
          {openFilter && (
            <div className="market-filter-panel" role="group">
              {openFilter === "price" && (
                <>
                  <FilterOption
                    label="全部价格"
                    selected={priceFilter === null}
                    onClick={() => {
                      setPriceFilter(null);
                      setOpenFilter(null);
                    }}
                  />
                  {priceOptions.map((price) => (
                    <FilterOption
                      key={price}
                      label={`${price} K-coin`}
                      selected={priceFilter === price}
                      onClick={() => {
                        setPriceFilter(price);
                        setOpenFilter(null);
                      }}
                    />
                  ))}
                </>
              )}
              {openFilter === "rarity" && (
                <>
                  <FilterOption
                    label="全部稀有度"
                    selected={rarityFilter === null}
                    onClick={() => {
                      setRarityFilter(null);
                      setOpenFilter(null);
                    }}
                  />
                  {rarityOptions.map((rarity) => (
                    <FilterOption
                      key={rarity}
                      label={rarityLabel(rarity)}
                      selected={rarityFilter === rarity}
                      onClick={() => {
                        setRarityFilter(rarity);
                        setOpenFilter(null);
                      }}
                    />
                  ))}
                </>
              )}
              {openFilter === "stage" && (
                <>
                  <FilterOption
                    label="全部阶级"
                    selected={stageFilter === null}
                    onClick={() => {
                      setStageFilter(null);
                      setOpenFilter(null);
                    }}
                  />
                  {stageOptions.map((stage) => (
                    <FilterOption
                      key={stage}
                      label={`第 ${stage} 阶`}
                      selected={stageFilter === stage}
                      onClick={() => {
                        setStageFilter(stage);
                        setOpenFilter(null);
                      }}
                    />
                  ))}
                </>
              )}
              {openFilter === "sort" &&
                (
                  [
                    ["catalog", "默认排序"],
                    ["price-asc", "价格从低到高"],
                    ["price-desc", "价格从高到低"],
                    ["available", "可买数量优先"],
                  ] as const
                ).map(([value, label]) => (
                  <FilterOption
                    key={value}
                    label={label}
                    selected={buySort === value}
                    onClick={() => {
                      setBuySort(value);
                      setOpenFilter(null);
                    }}
                  />
                ))}
            </div>
          )}
          <div className="market-result-summary" aria-live="polite">
            <span>{visible.length} 件藏品</span>
            {(priceFilter !== null ||
              rarityFilter !== null ||
              stageFilter !== null ||
              buySort !== "catalog") && (
              <button
                type="button"
                onClick={() => {
                  setPriceFilter(null);
                  setRarityFilter(null);
                  setStageFilter(null);
                  setBuySort("catalog");
                  setOpenFilter(null);
                }}
              >
                重置
              </button>
            )}
          </div>
        </div>
      )}
      {feedback && (
        <Card className="resume-intent">
          <strong>{feedback}</strong>
          <p>管理页中的模板售罄或全部下架后会立即释放一个名额。</p>
          <Button onClick={() => void mine.refetch()}>刷新在售状态</Button>
        </Card>
      )}
      {tab === "manage" && mine.error && hasManageContent && (
        <Card className="resume-intent" role="status" aria-live="polite">
          <strong>出售状态暂未更新</strong>
          <p>已保留当前设备上的成交提醒，可以稍后再试。</p>
          <Button onClick={() => void mine.refetch()}>重新加载</Button>
        </Card>
      )}
      {tab === "sell" ? (
        <PageState
          loading={state.isLoading}
          error={state.error as Error | null}
          onRetry={() => void state.refetch()}
          hasContent={state.data !== undefined}
          retrying={state.isFetching}
          empty={!selectedSellItem}
        >
          {selectedSellItem && (
            <MarketSellWorkbench
              key={`${selectedSellItem.template_id}:${requestedQuantity}`}
              items={visible}
              selected={selectedSellItem}
              initialQuantity={requestedQuantity}
              blocked={blocked}
              listingInProgress={listingInProgress}
              feeBps={sellable.data?.fee_bps ?? 500}
              vipActive={sellable.data?.vip.active ?? false}
              vipRebateBps={sellable.data?.vip_rebate_bps ?? 2000}
              onSelect={(templateId) =>
                setParams({ sell: templateId }, { replace: true })
              }
              onSubmit={submit}
              onPrepare={() => preload("market.create_listing")}
            />
          )}
        </PageState>
      ) : (
        <PageState
          loading={state.isLoading && !hasManageContent}
          error={
            tab === "manage" && hasManageContent
              ? null
              : tab === "manage" && state.error
                ? new Error("出售状态暂未更新，请重新加载")
                : (state.error as Error | null)
          }
          onRetry={() => void state.refetch()}
          hasContent={state.data !== undefined}
          retrying={state.isFetching}
          empty={
            tab === "manage" && sorted.length === 0 && soldEvents.length === 0
          }
        >
          {hasManageContent ? (
            <div className="market-grid market-grid-manage" aria-live="polite">
              {soldEvents.map((event) => (
                <MarketSoldCard
                  key={`sold:${event.sale_sequence}`}
                  event={event}
                  imageUrl={
                    catalog.data?.templates.find(
                      (template) => template.id === event.template_id,
                    )?.image_thumbnail_url
                  }
                  dismissing={dismissingSoldEvents.has(event.sale_sequence)}
                  onDismiss={(trigger) => dismissSoldWithEffect(event, trigger)}
                />
              ))}
              {visible.map((item) => (
                <MarketListingCard
                  key={item.template_id}
                  item={item}
                  blocked={blocked}
                  onPrepare={() => preload("market.cancel_template_listings")}
                  onDelist={() => submit(item, 1)}
                />
              ))}
            </div>
          ) : visible.length ? (
            <div className={`market-grid market-grid-${tab}`}>
              {visible.map((item) => (
                <MarketCard
                  key={item.template_id}
                  item={item}
                  tab="buy"
                  blocked={blocked}
                  purchaseInProgress={purchaseInProgress}
                  balance={identity.data?.assets.kcoin.available}
                  onPrepare={(routeId) => preload(routeId)}
                  onSubmit={submit}
                />
              ))}
            </div>
          ) : (
            <div className="market-filter-empty">
              <PackageSearch aria-hidden="true" />
              <strong>
                {sorted.length ? "没有符合条件的藏品" : "市场暂无有效挂单"}
              </strong>
              <span>
                {sorted.length ? "调整筛选后再试" : "有玩家上架后将在这里显示"}
              </span>
            </div>
          )}
        </PageState>
      )}
      {pendingDelist && (
        <AppModal
          labelledBy="market-delist-confirm-title"
          onClose={blocked ? undefined : () => setPendingDelist(null)}
        >
          <div className="modal">
            <div className="operation-mark confirming">!</div>
            <h2 id="market-delist-confirm-title">确认全部下架</h2>
            <p>
              将下架“{pendingDelist.name}
              ”结算时仍未成交的全部数量。当前显示出售中
              {pendingDelist.available} 个，最终释放数量以后端原子裁决为准。
            </p>
            <Button
              disabled={blocked}
              onPointerDown={() => preload("market.cancel_template_listings")}
              onFocus={() => preload("market.cancel_template_listings")}
              onClick={confirmDelist}
            >
              确认全部下架
            </Button>
            <Button
              className="secondary"
              disabled={blocked}
              onClick={() => setPendingDelist(null)}
            >
              取消
            </Button>
          </div>
        </AppModal>
      )}
      <MarketSoldCoinEffect bursts={soldCoinBursts} />
    </main>
  );
}

function MarketFilterButton({
  icon,
  label,
  active,
  expanded,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  expanded: boolean;
  onClick(): void;
}): ReactNode {
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      <ChevronDown aria-hidden="true" />
    </button>
  );
}

function FilterOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick(): void;
}): ReactNode {
  return (
    <button
      type="button"
      className={selected ? "active" : ""}
      aria-pressed={selected}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function rarityOrder(value: string): number {
  return ["common", "rare", "epic", "legendary", "mythic"].indexOf(
    value.toLowerCase(),
  );
}

function rarityLabel(value: string | undefined): string {
  return (
    {
      common: "普通",
      rare: "稀有",
      epic: "史诗",
      legendary: "传说",
      mythic: "神话",
    }[value?.toLowerCase() ?? ""] ??
    value ??
    "未知"
  );
}

function formatKCoin(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function sortLabel(value: BuySort): string {
  return {
    catalog: "排序",
    "price-asc": "价格升序",
    "price-desc": "价格降序",
    available: "数量优先",
  }[value];
}

function parseTab(value: string | null): MarketTab | null {
  return value === "buy" || value === "sell" || value === "manage"
    ? value
    : null;
}

function parsePositiveQuantity(value: string | null): number {
  const quantity = Number(value ?? 1);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
}

type MarketViewItem = {
  template_id: string;
  name: string;
  rarity?: string;
  stage?: number | undefined;
  chain_type?: "normal" | "advanced" | "top";
  image_thumbnail_url: string;
  image_detail_url?: string;
  unit_price: number;
  available: number;
  own_listed_quantity?: number;
  total?: number;
  listed?: number;
};

function MarketListingCard({
  item,
  blocked,
  onPrepare,
  onDelist,
}: {
  item: MarketViewItem;
  blocked: boolean;
  onPrepare(): void;
  onDelist(): void;
}): ReactNode {
  return (
    <Card className="market-listing-card">
      <div className="market-listing-art">
        <CatalogImage
          url={item.image_thumbnail_url}
          alt={item.name}
          variant="thumbnail"
          loading="lazy"
        />
      </div>
      <div className="market-listing-copy">
        <h2>{item.name}</h2>
        <div className="market-listing-tags">
          <Badge>
            {rarityLabel(item.rarity)}
            {item.stage ? ` · 第 ${item.stage} 阶` : ""}
          </Badge>
          <span className="market-listing-status">
            出售中 ×{item.available}
          </span>
        </div>
        <p>
          官方单价
          <strong>
            {formatKCoin(item.unit_price)} <small>K-coin</small>
          </strong>
        </p>
      </div>
      <Button
        className="market-listing-delist"
        disabled={blocked || item.available < 1}
        onPointerDown={onPrepare}
        onFocus={onPrepare}
        onClick={onDelist}
      >
        <PackageMinus />
        下架
      </Button>
    </Card>
  );
}

function MarketSoldCard({
  event,
  imageUrl,
  dismissing,
  onDismiss,
}: {
  event: MarketSoldEvent;
  imageUrl: string | undefined;
  dismissing: boolean;
  onDismiss(trigger: HTMLButtonElement): void;
}): ReactNode {
  return (
    <button
      type="button"
      className="card market-listing-card market-listing-sold"
      aria-label={`${event.name} 已售出 ${event.quantity} 个，点击播放金币特效并隐藏这条成交提醒`}
      disabled={dismissing}
      onClick={(clickEvent) => onDismiss(clickEvent.currentTarget)}
    >
      <div className="market-listing-art">
        <CatalogImage
          url={imageUrl}
          alt={event.name}
          variant="thumbnail"
          loading="lazy"
        />
      </div>
      <div className="market-listing-copy">
        <h2>{event.name}</h2>
        <div className="market-listing-tags">
          <Badge>
            {rarityLabel(event.rarity)} · 第 {event.stage} 阶
          </Badge>
          <span className="market-listing-status">
            已售出 ×{event.quantity}
          </span>
        </div>
        <p>
          成交单价
          <strong>
            {formatKCoin(event.unit_price)} <small>K-coin</small>
          </strong>
        </p>
      </div>
      <span className="market-sold-stamp" aria-hidden="true">
        SOLD
      </span>
    </button>
  );
}

function MarketSellWorkbench({
  items,
  selected,
  initialQuantity,
  blocked,
  listingInProgress,
  feeBps,
  vipActive,
  vipRebateBps,
  onSelect,
  onPrepare,
  onSubmit,
}: {
  items: MarketViewItem[];
  selected: MarketViewItem;
  initialQuantity: number;
  blocked: boolean;
  listingInProgress: boolean;
  feeBps: number;
  vipActive: boolean;
  vipRebateBps: number;
  onSelect(templateId: string): void;
  onPrepare(): void;
  onSubmit(item: MarketViewItem, quantity: number): void;
}): ReactNode {
  const available = selected.available;
  const [quantity, setQuantity] = useState(() =>
    Math.min(available, initialQuantity),
  );
  const [imageReady, setImageReady] = useState(false);
  const gross = selected.unit_price * quantity;
  const fee = Math.floor((gross * feeBps) / 10_000);
  const net = gross - fee;
  const vipRebate = vipActive ? Math.floor((fee * vipRebateBps) / 10_000) : 0;
  const finalNet = net + vipRebate;
  return (
    <div className="market-sell-workbench">
      <Card className="market-sell-hero" aria-label="当前选中的出售藏品">
        <div className="market-sell-hero-art">
          <CatalogImage
            url={selected.image_detail_url ?? selected.image_thumbnail_url}
            alt={selected.name}
            variant={selected.image_detail_url ? "detail" : "thumbnail"}
            loading="eager"
            fetchPriority="high"
            onAvailability={setImageReady}
          />
        </div>
        <div className="market-sell-hero-copy">
          <Badge>{rarityLabel(selected.rarity)}</Badge>
          <h2>{selected.name}</h2>
          <p>
            {chainLabel(selected.chain_type)} · 第 {selected.stage ?? 1} 阶
          </p>
          <span className="market-sell-owned">
            你拥有 <strong>{selected.total ?? available}</strong> 份 · 出售中
            <strong>{selected.listed ?? 0}</strong>
          </span>
          <div className="market-sell-hero-facts">
            <span>
              <Crown aria-hidden="true" />
              <small>稀有度</small>
              <strong>{rarityLabel(selected.rarity)}</strong>
            </span>
            <span>
              <Layers3 aria-hidden="true" />
              <small>当前状态</small>
              <strong>可售 {available} 份</strong>
            </span>
          </div>
        </div>
      </Card>

      <div className="market-sell-gallery" aria-label="选择要出售的藏品">
        {items.map((item) => {
          const active = item.template_id === selected.template_id;
          return (
            <button
              key={item.template_id}
              type="button"
              className={active ? "active" : ""}
              aria-label={`选择${item.name}，可出售 ${item.available} 份`}
              aria-pressed={active}
              onClick={() => onSelect(item.template_id)}
            >
              <CatalogImage
                url={item.image_thumbnail_url}
                alt={item.name}
                variant="thumbnail"
                loading="lazy"
              />
              {item.available > 1 && <span>x{item.available}</span>}
              {active && (
                <i aria-hidden="true">
                  <Check />
                </i>
              )}
            </button>
          );
        })}
      </div>

      <Card className="market-sell-metrics" aria-live="polite">
        <MarketSellMetric
          icon={<Coins />}
          label="官方单价"
          value={`${selected.unit_price} K`}
          detail="固定价格"
        />
        <MarketSellMetric
          icon={<ShieldCheck />}
          label="预计成交"
          value={`${gross} K`}
          detail={`${quantity} 份藏品`}
        />
        <MarketSellMetric
          icon={<Percent />}
          label="平台手续费"
          value={`${fee} K`}
          detail={`${feeBps / 100}%`}
        />
      </Card>

      <Card className="market-sell-form">
        <div className="market-sell-quantity-row">
          <span>
            出售数量 <Info aria-hidden="true" />
          </span>
          <div className="quantity">
            <Button
              aria-label="减少出售数量"
              disabled={quantity <= 1}
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
            >
              −
            </Button>
            <strong>{quantity}</strong>
            <Button
              aria-label="增加出售数量"
              disabled={quantity >= available}
              onClick={() =>
                setQuantity((value) => Math.min(available, value + 1))
              }
            >
              ＋
            </Button>
          </div>
        </div>
        <div className="market-sell-settlement">
          <span>
            预计基础到账<strong>{net} K-coin</strong>
          </span>
          <span>
            月卡预计返还
            <strong>{vipActive ? `${vipRebate} K-coin` : "未开通"}</strong>
          </span>
          <small>实际手续费和返还按后续每次真实成交明细计算</small>
        </div>
        <Button
          className={`market-sell-confirm${listingInProgress ? " is-pending" : ""}`}
          disabled={blocked || !imageReady || available < 1}
          aria-busy={listingInProgress}
          aria-live="polite"
          onPointerDown={onPrepare}
          onFocus={onPrepare}
          onClick={() => onSubmit(selected, quantity)}
        >
          {listingInProgress ? (
            <span>出售中</span>
          ) : (
            <>
              <span>
                <Tags aria-hidden="true" />
                确认出售
              </span>
              <i aria-hidden="true" />
              <span>
                预计到手 <strong>{finalNet}</strong> K
              </span>
            </>
          )}
        </Button>
      </Card>
    </div>
  );
}

function MarketSellMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}): ReactNode {
  return (
    <span>
      <small>{label}</small>
      <strong>
        {icon}
        {value}
      </strong>
      <small>{detail}</small>
    </span>
  );
}

function chainLabel(value: MarketViewItem["chain_type"]): string {
  return {
    normal: "普通链",
    advanced: "高级链",
    top: "顶级链",
  }[value ?? "normal"];
}

function MarketCard({
  item,
  tab,
  blocked,
  purchaseInProgress,
  balance,
  onPrepare,
  onSubmit,
}: {
  item: MarketViewItem;
  tab: Exclude<MarketTab, "manage">;
  blocked: boolean;
  purchaseInProgress: boolean;
  balance: number | undefined;
  onPrepare(routeId: "market.purchase" | "market.create_listing"): void;
  onSubmit(item: MarketViewItem, quantity: number): void;
}): ReactNode {
  const [quantity, setQuantity] = useState(1);
  const [imageReady, setImageReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [purchaseSubmitted, setPurchaseSubmitted] = useState(false);
  const available = item.available;
  const price = item.unit_price;
  const purchaseDialogOpen =
    confirming && (!purchaseSubmitted || purchaseInProgress);
  return (
    <Card className={`market-card market-card-${tab}`}>
      <div className="market-art">
        <CatalogImage
          url={item.image_thumbnail_url}
          alt={item.name}
          variant="thumbnail"
          loading="lazy"
          onAvailability={setImageReady}
        />
        {tab !== "buy" && (
          <Badge>
            {rarityLabel(item.rarity)}
            {item.stage ? ` · 第 ${item.stage} 阶` : ""}
          </Badge>
        )}
      </div>
      <div className="market-copy">
        <h2>{item.name}</h2>
        {tab === "buy" && (
          <Badge>
            {rarityLabel(item.rarity)}
            {item.stage ? ` · 第 ${item.stage} 阶` : ""}
          </Badge>
        )}
        {tab !== "buy" && (
          <div className="market-meta">
            <p>
              官方单价 <strong>{price} K</strong>
            </p>
            <p>
              可用 <strong>{available}</strong>
            </p>
          </div>
        )}
      </div>
      {tab === "buy" && (
        <div className="market-buy-facts">
          <small>官方单价</small>
          <strong>{price} K</strong>
          <span>可买 {available}</span>
        </div>
      )}
      {tab === "sell" && available > 0 && (
        <div className="quantity">
          <Button
            onClick={() => setQuantity((value) => Math.max(1, value - 1))}
          >
            −
          </Button>
          <strong>{quantity}</strong>
          <Button
            onClick={() =>
              setQuantity((value) => Math.min(available, value + 1))
            }
          >
            ＋
          </Button>
        </div>
      )}
      <Button
        disabled={
          blocked || !imageReady || available < 1 || quantity > available
        }
        onPointerDown={() =>
          onPrepare(tab === "buy" ? "market.purchase" : "market.create_listing")
        }
        onFocus={() =>
          onPrepare(tab === "buy" ? "market.purchase" : "market.create_listing")
        }
        onClick={() => {
          if (tab === "buy") {
            setPurchaseSubmitted(false);
            setConfirming(true);
          } else onSubmit(item, quantity);
        }}
      >
        {tab === "buy" && available < 1 ? (
          <>{item.own_listed_quantity ? "自己的挂单" : "暂无挂单"}</>
        ) : tab === "buy" ? (
          <>
            <ShoppingCart />
            {available < 1 ? "暂无在售" : "购买"}
          </>
        ) : (
          <>
            <PackagePlus />
            确认出售
          </>
        )}
      </Button>
      {purchaseDialogOpen ? (
        <AppModal
          labelledBy={`market-purchase-${item.template_id}`}
          onClose={purchaseInProgress ? undefined : () => setConfirming(false)}
        >
          <div className="modal market-purchase-dialog">
            <div className="market-purchase-preview">
              <CatalogImage
                url={item.image_thumbnail_url}
                alt={item.name}
                variant="thumbnail"
                loading="eager"
              />
              <div>
                <Badge>
                  {rarityLabel(item.rarity)}
                  {item.stage ? ` · 第 ${item.stage} 阶` : ""}
                </Badge>
                <h2 id={`market-purchase-${item.template_id}`}>{item.name}</h2>
                <span>当前可买 {available} 个</span>
              </div>
            </div>
            <div className="market-purchase-price">
              <span>官方单价</span>
              <strong>{price} K-coin</strong>
            </div>
            <div className="market-purchase-quantity">
              <span>购买数量</span>
              <div className="quantity">
                <Button
                  aria-label="减少购买数量"
                  disabled={purchaseInProgress}
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                >
                  −
                </Button>
                <strong>{quantity}</strong>
                <Button
                  aria-label="增加购买数量"
                  disabled={purchaseInProgress}
                  onClick={() =>
                    setQuantity((value) => Math.min(available, value + 1))
                  }
                >
                  ＋
                </Button>
              </div>
            </div>
            <div className="market-purchase-totals">
              <span>
                预计总价<strong>{price * quantity} K-coin</strong>
              </span>
              <span>
                当前余额
                <strong>
                  {balance === undefined ? "正在读取" : `${balance} K-coin`}
                </strong>
              </span>
            </div>
            {balance !== undefined && balance < price * quantity && (
              <p className="market-purchase-warning">
                K-coin 余额不足，确认后将进入充值流程。
              </p>
            )}
            <Button
              className={`market-purchase-submit${purchaseInProgress ? " is-pending" : ""}`}
              disabled={blocked || quantity > available}
              aria-busy={purchaseInProgress}
              aria-live="polite"
              onPointerDown={() => onPrepare("market.purchase")}
              onFocus={() => onPrepare("market.purchase")}
              onClick={() => {
                setPurchaseSubmitted(true);
                if (balance !== undefined && balance < price * quantity)
                  setConfirming(false);
                onSubmit(item, quantity);
              }}
            >
              {purchaseInProgress ? (
                "购买中"
              ) : (
                <>
                  <ShoppingCart />
                  确认购买
                </>
              )}
            </Button>
            <Button
              className="secondary"
              disabled={purchaseInProgress}
              onClick={() => setConfirming(false)}
            >
              取消
            </Button>
          </div>
        </AppModal>
      ) : null}
    </Card>
  );
}
