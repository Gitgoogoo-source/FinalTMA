import { Crown, PackageMinus, PackagePlus, ShoppingCart } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { number, records, text } from "../../shared/lib/data.ts";
import {
  Badge,
  Button,
  Card,
  CatalogImage,
  PageState,
} from "../../shared/ui/index.tsx";
import { VipDialog } from "../vip/VipDialog.tsx";

type Tab = "buy" | "sell" | "manage";

export function MarketPage(): ReactNode {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.has("sell") ? "sell" : "buy");
  const [vipOpen, setVipOpen] = useState(false);
  const vip = useApiQuery("vip.status");
  const listings = useApiQuery("market.listings", {}, tab === "buy");
  const sellable = useApiQuery("market.sellable_items", {}, tab === "sell");
  const mine = useApiQuery("market.my_listings", {}, tab === "manage");
  const { blocked, run } = useOperation();
  const data =
    tab === "buy"
      ? records(listings.data?.templates)
      : tab === "sell"
        ? records(sellable.data?.items)
        : records(mine.data?.listings);
  const state = tab === "buy" ? listings : tab === "sell" ? sellable : mine;
  const preset = params.get("sell");
  const sorted = useMemo(
    () =>
      preset
        ? [...data].sort((a) => (a.template_id === preset ? -1 : 1))
        : data,
    [data, preset],
  );
  const submit = (
    route: string,
    item: Record<string, unknown>,
    quantity: number,
    label: string,
  ) =>
    void run(label, async () => {
      const response = await apiRequest(
        route,
        {
          template_id: item.template_id,
          ...(route === "market.cancel_listing" ? {} : { quantity }),
        },
        { idempotencyKey: newIdempotencyKey() },
      );
      return { data: response.data, operationId: response.operationId };
    });
  return (
    <main className="page">
      <header className="hero market-hero">
        <span>OFFICIAL MARKET</span>
        <h1>交易市场</h1>
        <p>官方价格 · FIFO 撮合 · 不展示卖家身份</p>
      </header>
      <Card className="vip-banner">
        <Crown />
        <div>
          <strong>{vip.data?.active ? "VIP 月卡已生效" : "VIP 月卡"}</strong>
          <small>
            {vip.data?.active
              ? `有效期至 ${text(vip.data.ends_on)}`
              : "查看真实价格、有效期与每日权益"}
          </small>
        </div>
        <Button disabled={vip.isLoading} onClick={() => setVipOpen(true)}>
          {vip.data?.active ? "查看" : "购买"}
        </Button>
      </Card>
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
              key={text(item.template_id)}
              item={item}
              tab={tab}
              blocked={blocked}
              onSubmit={submit}
            />
          ))}
        </div>
      </PageState>
      {vipOpen && <VipDialog close={() => setVipOpen(false)} />}
    </main>
  );
}

function MarketCard({
  item,
  tab,
  blocked,
  onSubmit,
}: {
  item: Record<string, unknown>;
  tab: Tab;
  blocked: boolean;
  onSubmit(
    route: string,
    item: Record<string, unknown>,
    quantity: number,
    label: string,
  ): void;
}): ReactNode {
  const [quantity, setQuantity] = useState(1);
  const [imageReady, setImageReady] = useState(tab === "manage");
  const available = number(
    tab === "buy"
      ? item.available_quantity
      : tab === "sell"
        ? item.available
        : item.quantity,
  );
  const price = item.unit_price ?? item.market_price;
  return (
    <Card className="market-card">
      {tab !== "manage" && (
        <CatalogImage
          path={item.image_path}
          alt={text(item.name)}
          onAvailability={setImageReady}
        />
      )}
      <div className="market-copy">
        <Badge>{text(item.rarity, tab === "manage" ? "出售中" : "")}</Badge>
        <h2>{text(item.name, text(item.template_id))}</h2>
        <p>
          官方单价 <strong>{text(price)} K</strong>
        </p>
        <p>
          {tab === "buy" ? "可买" : tab === "sell" ? "可用" : "出售中"}{" "}
          {text(available)}
        </p>
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
          blocked || !imageReady || available < 1 || quantity > available
        }
        onClick={() =>
          tab === "buy"
            ? onSubmit("market.buy", item, quantity, "正在确认市场购买")
            : tab === "sell"
              ? onSubmit(
                  "market.create_listing",
                  item,
                  quantity,
                  "正在创建出售",
                )
              : onSubmit("market.cancel_listing", item, 1, "正在下架未成交藏品")
        }
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
