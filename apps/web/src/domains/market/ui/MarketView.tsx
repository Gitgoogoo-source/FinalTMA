import {
  PackageMinus,
  PackagePlus,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { CatalogImage } from "../../../shared/ui/index.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { useNavigationIntent } from "../../../workflows/payment-recovery/index.ts";

type Tab = "buy" | "sell" | "manage";

export function MarketView({ vipBanner }: { vipBanner: ReactNode }): ReactNode {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.has("sell") ? "sell" : "buy");
  const identity = useApiQuery("identity.bootstrap");
  const listings = useApiQuery("market.bootstrap", {}, tab === "buy");
  const sellable = useApiQuery("market.bootstrap", {}, tab === "sell");
  const mine = useApiQuery("market.my_listings", {}, tab === "manage");
  const { isBlocked, run } = useOperationRegistry();
  const { requestTopup } = useNavigationIntent();
  const blocked =
    isBlocked("market.purchase") ||
    isBlocked("market.create_listing") ||
    isBlocked("market.cancel_listing");
  const data: MarketViewItem[] =
    tab === "buy"
      ? (listings.data?.templates ?? []).map((item) => ({
          ...item,
          available: item.available_quantity,
        }))
      : tab === "sell"
        ? (sellable.data?.sellable_items ?? []).map((item) => ({
            ...item,
            available: item.available,
          }))
        : (mine.data?.listings ?? []).map((item) => ({
            ...item,
            available: item.quantity,
          }));
  const state = tab === "buy" ? listings : tab === "sell" ? sellable : mine;
  const preset = params.get("sell");
  const resumedTemplate = params.get("resume")
    ? params.get("template_id")
    : null;
  const resumedQuantity = Math.max(1, Number(params.get("quantity") ?? 1));
  const sorted = useMemo(
    () =>
      preset
        ? [...data].sort((a) => (a.template_id === preset ? -1 : 1))
        : data,
    [data, preset],
  );
  const submit = (item: MarketViewItem, quantity: number) => {
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
      void run("正在创建出售", "market.create_listing", {
        template_id: item.template_id,
        quantity,
      });
      return;
    }
    void run("正在下架未成交藏品", "market.cancel_listing", {
      listing_id: item.listing_id ?? "",
    });
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
      {resumedTemplate && (
        <Card className="resume-intent">
          <strong>充值已到账</strong>
          <p>
            已恢复原购买选择。库存、单价、数量与总价将按当前真实状态重新确认，不会自动成交。
          </p>
          <Button
            disabled={
              blocked ||
              !data.some((item) => item.template_id === resumedTemplate)
            }
            onClick={() => {
              const item = data.find(
                (candidate) => candidate.template_id === resumedTemplate,
              );
              if (item) {
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
          className={tab === "buy" ? "active" : ""}
          onClick={() => setTab("buy")}
        >
          购买
        </button>
        <button
          className={tab === "sell" ? "active" : ""}
          onClick={() => setTab("sell")}
        >
          出售
        </button>
        <button
          className={tab === "manage" ? "active" : ""}
          onClick={() => setTab("manage")}
        >
          管理
        </button>
      </nav>
      <PageState
        loading={state.isLoading}
        error={state.error as Error | null}
        onRetry={() => void state.refetch()}
        empty={sorted.length === 0}
      >
        <div className="market-grid">
          {sorted.map((item) => (
            <MarketCard
              key={item.listing_id ?? item.template_id}
              item={item}
              tab={tab}
              blocked={blocked}
              onSubmit={submit}
            />
          ))}
        </div>
      </PageState>
    </main>
  );
}

type MarketViewItem = {
  template_id: string;
  name: string;
  rarity?: string;
  stage?: number | undefined;
  image_path: string;
  unit_price: number;
  available: number;
  listing_id?: string;
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
          path={item.image_path}
          alt={item.name}
          onAvailability={setImageReady}
        />
        <Badge>
          {item.rarity ?? (tab === "manage" ? "出售中" : "")}
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
        </div>
      </div>
      {tab !== "manage" && (
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
        {tab === "buy" ? (
          <>
            <ShoppingCart />
            确认购买
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
