import {
  PackageMinus,
  PackagePlus,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { CatalogImage } from "../../../shared/ui/index.tsx";
import { focusTaskTarget } from "../../../shared/navigation/focusTaskTarget.ts";
import { useApiQuery } from "../../../platform/query/index.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { useNavigationIntent } from "../../../workflows/payment-recovery/index.ts";

type Tab = "buy" | "sell" | "manage";

export function MarketView({ vipBanner }: { vipBanner: ReactNode }): ReactNode {
  const [params, setParams] = useSearchParams();
  const requestedTab = parseTab(params.get("tab"));
  const [selectedTab, setSelectedTab] = useState<Tab>(
    requestedTab ?? (params.has("sell") ? "sell" : "buy"),
  );
  const tab = requestedTab ?? selectedTab;
  const tabButtons = useRef<Record<Tab, HTMLButtonElement | null>>({
    buy: null,
    sell: null,
    manage: null,
  });
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
  const activeTemplateIds = new Set(
    (mine.data?.listings ?? []).map((item) => item.template_id),
  );
  useEffect(() => {
    if (params.get("focus") !== `market-${tab}`) return;
    return focusTaskTarget(tabButtons.current[tab] ?? null);
  }, [params, state.isLoading, tab]);
  const selectTab = (nextTab: Tab) => {
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
      <header className="page-heading market-heading">
        <div>
          <span>OFFICIAL MARKET</span>
          <h1>交易市场</h1>
        </div>
        <ShoppingBag aria-hidden="true" />
      </header>
      {vipBanner}
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
      <nav className="segmented">
        <button
          ref={(element) => {
            tabButtons.current.buy = element;
          }}
          className={tab === "buy" ? "active" : ""}
          onClick={() => selectTab("buy")}
        >
          购买
        </button>
        <button
          ref={(element) => {
            tabButtons.current.sell = element;
          }}
          className={tab === "sell" ? "active" : ""}
          onClick={() => selectTab("sell")}
        >
          出售
        </button>
        <button
          ref={(element) => {
            tabButtons.current.manage = element;
          }}
          className={tab === "manage" ? "active" : ""}
          onClick={() => selectTab("manage")}
        >
          管理
        </button>
      </nav>
      {feedback && (
        <Card className="resume-intent">
          <strong>{feedback}</strong>
          <p>管理页中的模板售罄或全部下架后会立即释放一个名额。</p>
          <Button onClick={() => void mine.refetch()}>刷新在售状态</Button>
        </Card>
      )}
      <PageState
        loading={state.isLoading}
        error={state.error as Error | null}
        onRetry={() => void state.refetch()}
        empty={sorted.length === 0}
      >
        <div className="market-grid">
          {sorted.map((item) => (
            <MarketCard
              key={item.template_id}
              item={item}
              tab={tab}
              blocked={blocked}
              onSubmit={submit}
            />
          ))}
        </div>
      </PageState>
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

function parseTab(value: string | null): Tab | null {
  return value === "buy" || value === "sell" || value === "manage"
    ? value
    : null;
}

type MarketViewItem = {
  template_id: string;
  name: string;
  rarity?: string;
  stage?: number | undefined;
  image_thumbnail_path: string;
  unit_price: number;
  available: number;
  sold_quantity?: number;
  estimated_gross?: number;
  estimated_fee?: number;
  estimated_net?: number;
  estimated_vip_rebate?: number;
  status?: "active" | "partially_sold";
};

function MarketCard({
  item,
  tab,
  blocked,
  onSubmit,
}: {
  item: MarketViewItem;
  tab: Tab;
  blocked: boolean;
  onSubmit(item: MarketViewItem, quantity: number): void;
}): ReactNode {
  const [quantity, setQuantity] = useState(1);
  const [imageReady, setImageReady] = useState(false);
  const available = item.available;
  const price = item.unit_price;
  return (
    <Card className="market-card">
      <div className="market-art">
        <CatalogImage
          path={item.image_thumbnail_path}
          alt={item.name}
          variant="thumbnail"
          loading="lazy"
          onAvailability={setImageReady}
        />
        <Badge>
          {tab === "manage"
            ? item.status === "partially_sold"
              ? "部分成交"
              : "出售中"
            : item.rarity}
          {item.stage ? ` · 第 ${item.stage} 阶` : ""}
        </Badge>
      </div>
      <div className="market-copy">
        <h2>{item.name}</h2>
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
      {tab !== "manage" && available > 0 && (
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
        onClick={() => onSubmit(item, quantity)}
      >
        {tab === "buy" && available < 1 ? (
          <>售罄</>
        ) : tab === "buy" ? (
          <>
            <ShoppingCart />
            {available < 1 ? "暂无在售" : "确认购买"}
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
    </Card>
  );
}
