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
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { CatalogImage } from "../../../shared/ui/index.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { useNavigationIntent } from "../../../workflows/payment-recovery/index.ts";
import { MarketTabs, type MarketTab } from "./MarketTabs.tsx";

type BuyFilter = "price" | "rarity" | "stage" | "sort";
type BuySort = "catalog" | "price-asc" | "price-desc" | "available";

export function MarketView({ vipBanner }: { vipBanner: ReactNode }): ReactNode {
  const [params, setParams] = useSearchParams();
  const requestedTab = parseTab(params.get("tab"));
  const [selectedTab, setSelectedTab] = useState<MarketTab>(
    requestedTab ?? (params.has("sell") ? "sell" : "buy"),
  );
  const tab = requestedTab ?? selectedTab;
  const purchaseTarget = params.get("buy");
  const identity = useApiQuery("identity.bootstrap");
  const listings = useApiQuery("market.bootstrap", {}, tab === "buy");
  const targetListing = useApiQuery(
    "market.template",
    { template_id: purchaseTarget ?? "" },
    tab === "buy" && Boolean(purchaseTarget),
  );
  const sellable = useApiQuery("market.bootstrap", {}, tab === "sell");
  const mine = useApiQuery("market.my_listings", {}, tab !== "buy");
  const { isBlocked, run } = useOperationRegistry();
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
  const blocked =
    isBlocked("market.purchase") ||
    isBlocked("market.create_listing") ||
    isBlocked("market.cancel_template_listings");
  const purchaseTemplates = (listings.data?.templates ?? []).map((item) => {
    const current =
      item.template_id === purchaseTarget && targetListing.data
        ? targetListing.data
        : item;
    return { ...current, available: current.available_quantity };
  });
  const data: MarketViewItem[] =
    tab === "buy"
      ? purchaseTemplates
      : tab === "sell"
        ? (sellable.data?.sellable_items ?? []).map((item) => ({
            ...item,
            available: item.available,
          }))
        : (mine.data?.listings ?? []).map((item) => ({
            ...item,
            available: item.listed_quantity,
          }));
  const state = tab === "buy" ? listings : tab === "sell" ? sellable : mine;
  const preset =
    tab === "buy" ? purchaseTarget : tab === "sell" ? params.get("sell") : null;
  const resumedTemplate = params.get("resume")
    ? params.get("template_id")
    : null;
  const resumedQuantity = Math.max(1, Number(params.get("quantity") ?? 1));
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
  const manageSummary = useMemo(
    () =>
      data.reduce(
        (summary, item) => ({
          listed: summary.listed + item.available,
          gross: summary.gross + (item.estimated_gross ?? 0),
          net: summary.net + (item.estimated_net ?? 0),
        }),
        { listed: 0, gross: 0, net: 0 },
      ),
    [data],
  );
  const selectedSellItem =
    tab === "sell"
      ? (visible.find((item) => item.template_id === params.get("sell")) ??
        visible[0])
      : undefined;
  const activeTemplateIds = new Set(
    (mine.data?.listings ?? []).map((item) => item.template_id),
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
      void run("正在确认市场购买", "market.purchase", {
        template_id: item.template_id,
        quantity,
      });
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
  return (
    <main className="page market-page">
      <MarketTabs
        activeTab={tab}
        focusActive={params.get("focus") === `market-${tab}`}
        focusReady={!state.isLoading}
        onSelect={selectTab}
      />
      {tab === "sell" ? (
        <header className="market-sell-heading">
          <Tags aria-hidden="true" />
          <div>
            <h1>出售 NFT</h1>
            <span>{sorted.length} 种藏品可出售</span>
          </div>
        </header>
      ) : null}
      {tab === "buy" && purchaseTarget && targetListing.data && (
        <Card className="market-target" role="status">
          <strong>已定位：{targetListing.data.name}</strong>
          <p>
            当前可买 {targetListing.data.available_quantity} 个；数量为 0
            表示市场当前没有在售。
          </p>
          <Button className="secondary" onClick={() => setParams({})}>
            查看全部藏品
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
                submit(item, Math.min(item.available, resumedQuantity));
              }
            }}
          >
            重新确认购买
          </Button>
        </Card>
      )}
      {tab === "buy" && vipBanner}
      {tab === "manage" && sorted.length > 0 && (
        <Card className="market-listing-summary" aria-label="出售汇总">
          <MarketListingSummaryMetric
            label="出售中"
            value={formatKCoin(manageSummary.listed)}
          />
          <MarketListingSummaryMetric
            label="总价值"
            value={formatKCoin(manageSummary.gross)}
            unit="K"
            accent
          />
          <MarketListingSummaryMetric
            label="预计到账"
            value={formatKCoin(manageSummary.net)}
            unit="K"
            accent
          />
        </Card>
      )}
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
      {tab === "sell" ? (
        <PageState
          loading={state.isLoading}
          error={state.error as Error | null}
          onRetry={() => void state.refetch()}
          empty={!selectedSellItem}
        >
          {selectedSellItem && (
            <MarketSellWorkbench
              key={selectedSellItem.template_id}
              items={visible}
              selected={selectedSellItem}
              blocked={blocked}
              feeBps={sellable.data?.fee_bps ?? 500}
              vipActive={sellable.data?.vip.active ?? false}
              vipRebateBps={sellable.data?.vip_rebate_bps ?? 2000}
              onSelect={(templateId) =>
                setParams({ sell: templateId }, { replace: true })
              }
              onSubmit={submit}
            />
          )}
        </PageState>
      ) : (
        <PageState
          loading={state.isLoading}
          error={state.error as Error | null}
          onRetry={() => void state.refetch()}
          empty={sorted.length === 0}
        >
          {visible.length ? (
            <div className={`market-grid market-grid-${tab}`}>
              {visible.map((item) =>
                tab === "manage" ? (
                  <MarketListingCard
                    key={item.template_id}
                    item={item}
                    blocked={blocked}
                    onDelist={() => submit(item, 1)}
                  />
                ) : (
                  <MarketCard
                    key={item.template_id}
                    item={item}
                    tab={tab}
                    blocked={blocked}
                    balance={identity.data?.assets.kcoin.available}
                    onSubmit={submit}
                  />
                ),
              )}
            </div>
          ) : (
            <div className="market-filter-empty">
              <PackageSearch aria-hidden="true" />
              <strong>没有符合条件的藏品</strong>
              <span>调整筛选后再试</span>
            </div>
          )}
        </PageState>
      )}
      {pendingDelist && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="market-delist-confirm-title"
        >
          <div className="modal">
            <div className="operation-mark confirming">!</div>
            <h2 id="market-delist-confirm-title">确认全部下架</h2>
            <p>
              将下架“{pendingDelist.name}
              ”结算时仍未成交的全部数量。当前显示出售中
              {pendingDelist.available} 个，最终释放数量以后端原子裁决为准。
            </p>
            <Button disabled={blocked} onClick={confirmDelist}>
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
        </div>
      )}
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

type MarketViewItem = {
  template_id: string;
  name: string;
  rarity?: string;
  stage?: number | undefined;
  chain_type?: "normal" | "advanced" | "top";
  image_thumbnail_path: string;
  image_detail_path?: string;
  unit_price: number;
  available: number;
  total?: number;
  listed?: number;
  sold_quantity?: number;
  estimated_gross?: number;
  estimated_fee?: number;
  estimated_net?: number;
  estimated_vip_rebate?: number;
  status?: "active" | "partially_sold";
};

function MarketListingSummaryMetric({
  label,
  value,
  unit,
  accent = false,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: boolean;
}): ReactNode {
  return (
    <span className={accent ? "accent" : ""}>
      <small>{label}</small>
      <strong>
        {value}
        {unit && <i>{unit}</i>}
      </strong>
    </span>
  );
}

function MarketListingCard({
  item,
  blocked,
  onDelist,
}: {
  item: MarketViewItem;
  blocked: boolean;
  onDelist(): void;
}): ReactNode {
  return (
    <Card className="market-listing-card">
      <div className="market-listing-art">
        <CatalogImage
          path={item.image_thumbnail_path}
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
            {item.status === "partially_sold" ? "部分成交" : "出售中"}
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
        onClick={onDelist}
      >
        <PackageMinus />
        下架
      </Button>
    </Card>
  );
}

function MarketSellWorkbench({
  items,
  selected,
  blocked,
  feeBps,
  vipActive,
  vipRebateBps,
  onSelect,
  onSubmit,
}: {
  items: MarketViewItem[];
  selected: MarketViewItem;
  blocked: boolean;
  feeBps: number;
  vipActive: boolean;
  vipRebateBps: number;
  onSelect(templateId: string): void;
  onSubmit(item: MarketViewItem, quantity: number): void;
}): ReactNode {
  const [quantity, setQuantity] = useState(1);
  const [imageReady, setImageReady] = useState(false);
  const available = selected.available;
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
            path={selected.image_detail_path ?? selected.image_thumbnail_path}
            alt={selected.name}
            variant={selected.image_detail_path ? "detail" : "thumbnail"}
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
                path={item.image_thumbnail_path}
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
          className="market-sell-confirm"
          disabled={blocked || !imageReady || available < 1}
          onClick={() => onSubmit(selected, quantity)}
        >
          <span>
            <Tags aria-hidden="true" />
            确认出售
          </span>
          <i aria-hidden="true" />
          <span>
            预计到手 <strong>{finalNet}</strong> K
          </span>
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
  balance,
  onSubmit,
}: {
  item: MarketViewItem;
  tab: MarketTab;
  blocked: boolean;
  balance: number | undefined;
  onSubmit(item: MarketViewItem, quantity: number): void;
}): ReactNode {
  const [quantity, setQuantity] = useState(1);
  const [imageReady, setImageReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const available = item.available;
  const price = item.unit_price;
  return (
    <Card className={`market-card market-card-${tab}`}>
      <div className="market-art">
        <CatalogImage
          path={item.image_thumbnail_path}
          alt={item.name}
          variant="thumbnail"
          loading="lazy"
          onAvailability={setImageReady}
        />
        {tab !== "buy" && (
          <Badge>
            {tab === "manage"
              ? item.status === "partially_sold"
                ? "部分成交"
                : "出售中"
              : rarityLabel(item.rarity)}
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
        <div className="market-meta">
          <p>
            官方单价 <strong>{price} K</strong>
          </p>
          <p>
            {tab === "buy" ? "可买" : tab === "sell" ? "可用" : "出售中"}{" "}
            <strong>{available}</strong>
          </p>
          {tab === "manage" && (
            <>
              <p>
                累计已售 <strong>{item.sold_quantity ?? 0}</strong>
              </p>
              <p>
                预计成交 <strong>{item.estimated_gross ?? 0} K</strong>
              </p>
              <p>
                预计手续费 <strong>{item.estimated_fee ?? 0} K</strong>
              </p>
              <p>
                预计到账 <strong>{item.estimated_net ?? 0} K</strong>
              </p>
              <p>
                月卡预计返还 <strong>{item.estimated_vip_rebate ?? 0} K</strong>
              </p>
            </>
          )}
        </div>
      </div>
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
          blocked ||
          (tab !== "manage" && !imageReady) ||
          available < 1 ||
          quantity > available
        }
        onClick={() =>
          tab === "buy" ? setConfirming(true) : onSubmit(item, quantity)
        }
      >
        {tab === "buy" && available < 1 ? (
          <>售罄</>
        ) : tab === "buy" ? (
          <>
            <ShoppingCart />
            {available < 1 ? "暂无在售" : "购买"}
          </>
        ) : tab === "sell" ? (
          <>
            <PackagePlus />
            确认出售
          </>
        ) : (
          <>
            <PackageMinus />
            全部下架
          </>
        )}
      </Button>
      {confirming && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`market-purchase-${item.template_id}`}
        >
          <div className="modal market-purchase-dialog">
            <div className="market-purchase-preview">
              <CatalogImage
                path={item.image_thumbnail_path}
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
                  onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                >
                  −
                </Button>
                <strong>{quantity}</strong>
                <Button
                  aria-label="增加购买数量"
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
              disabled={blocked || quantity > available}
              onClick={() => {
                setConfirming(false);
                onSubmit(item, quantity);
              }}
            >
              <ShoppingCart />
              确认购买
            </Button>
            <Button className="secondary" onClick={() => setConfirming(false)}>
              取消
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
