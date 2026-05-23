import {
  AlertTriangle,
  BarChart3,
  Coins,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  X,
} from "lucide-react";

import type { MarketListingCard, MarketListingDetail } from "../trade.types";
import {
  formatKcoinWithUnit,
  getItemTypeLabel,
  getMarketBuyDisabledReason,
  getPriceHealthLabel,
} from "../trade.utils";
import { useListingDetail } from "../hooks/useListingDetail";

type ListingDetailSheetProps = {
  open: boolean;
  listingId: string | null;
  previewListing: MarketListingCard | null;
  balanceAvailable: string;
  isBuying: boolean;
  onBuy: (listing: MarketListingDetail) => void;
  onClose: () => void;
  onRetryListings: () => void;
};

export function ListingDetailSheet({
  balanceAvailable,
  isBuying,
  listingId,
  onBuy,
  onClose,
  onRetryListings,
  open,
  previewListing,
}: ListingDetailSheetProps) {
  const detailQuery = useListingDetail(open ? listingId : null);
  const listing = detailQuery.listing;
  const title = listing?.itemName ?? previewListing?.itemName ?? "商品详情";
  const imageUrl = listing?.imageUrl ?? previewListing?.imageUrl ?? null;
  const rarityLabel = listing?.rarityLabel ?? previewListing?.rarityLabel;
  const buyDisabledReason = listing
    ? getMarketBuyDisabledReason(listing, balanceAvailable)
    : null;
  const buyDisabled = Boolean(buyDisabledReason) || isBuying;

  if (!open) {
    return null;
  }

  return (
    <div className="listing-detail-sheet" role="presentation">
      <button
        aria-label="关闭商品详情"
        className="listing-detail-sheet__backdrop"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="listing-detail-title"
        aria-modal="true"
        className="listing-detail-sheet__panel"
        role="dialog"
      >
        <header className="listing-detail-sheet__header">
          <div>
            <span>商品详情</span>
            <h2 id="listing-detail-title">{title}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="listing-detail-sheet__body" aria-live="polite">
          <div className="listing-detail-sheet__hero">
            {imageUrl ? (
              <img src={imageUrl} alt={title} />
            ) : (
              <span aria-hidden="true">{title.slice(0, 1)}</span>
            )}
            {rarityLabel ? (
              <strong className="listing-detail-sheet__rarity">
                {rarityLabel}
              </strong>
            ) : null}
          </div>

          {detailQuery.isLoading ? (
            <DetailState title="详情加载中" detail="正在读取商品详情。" />
          ) : null}

          {detailQuery.isError ? (
            <DetailState
              tone="error"
              title="详情读取失败"
              detail="商品详情暂时无法读取，请稍后重试。"
              onRetry={() => {
                void detailQuery.refetch();
                onRetryListings();
              }}
            />
          ) : null}

          {!detailQuery.isLoading && !detailQuery.isError && !listing ? (
            <DetailState
              tone="error"
              title="挂单不可用"
              detail="挂单不存在或已经下架。"
              onRetry={() => {
                void detailQuery.refetch();
                onRetryListings();
              }}
            />
          ) : null}

          {listing ? (
            <>
              <section
                className="listing-detail-sheet__summary"
                aria-label="商品基础信息"
              >
                <div>
                  <span>藏品编号</span>
                  <strong>
                    {listing.serialNo ? `#${listing.serialNo}` : "暂无编号"}
                  </strong>
                </div>
                <div>
                  <span>类型</span>
                  <strong>{getItemTypeLabel(listing.typeCode)}</strong>
                </div>
                <div>
                  <span>剩余数量</span>
                  <strong>{listing.remainingCount}</strong>
                </div>
                <div>
                  <span>卖家</span>
                  <strong>
                    {listing.isOwnListing
                      ? "你自己"
                      : (listing.seller?.displayName ??
                        listing.sellerDisplayName ??
                        "匿名卖家")}
                  </strong>
                </div>
              </section>

              {listing.description ? (
                <p className="listing-detail-sheet__description">
                  {listing.description}
                </p>
              ) : null}

              <section className="listing-detail-price" aria-label="价格信息">
                <PriceMetric
                  icon="coins"
                  label="挂单价"
                  value={formatKcoinWithUnit(listing.unitPriceKcoin)}
                />
                <PriceMetric
                  label="市场参考价"
                  value={formatNullableKcoin(listing.referencePriceKcoin)}
                />
                <PriceMetric
                  label="最近成交价"
                  value={formatNullableKcoin(listing.lastSalePriceKcoin)}
                />
                <PriceMetric
                  label="地板价"
                  value={formatNullableKcoin(listing.floorPriceKcoin)}
                />
              </section>

              <section
                className="listing-detail-health"
                aria-label="价格健康状态"
              >
                <span
                  className={`listing-detail-health__badge listing-detail-health__badge--${listing.priceHealth}`}
                >
                  <ShieldCheck aria-hidden="true" size={15} strokeWidth={2.5} />
                  {getPriceHealthLabel(listing.priceHealth)}
                </span>
                <p>{getPriceHealthDescription(listing)}</p>
              </section>

              <section className="listing-detail-depth" aria-label="市场深度">
                <div className="listing-detail-depth__heading">
                  <div>
                    <span>市场深度</span>
                    <strong>
                      {listing.activeListingCount > 0
                        ? `${listing.activeListingCount} 个活跃挂单`
                        : "暂无参考"}
                    </strong>
                  </div>
                  <BarChart3 aria-hidden="true" size={18} strokeWidth={2.5} />
                </div>

                {listing.marketDepth.length > 0 ? (
                  <div className="listing-detail-depth__levels">
                    {listing.marketDepth.slice(0, 4).map((level) => (
                      <div
                        key={`${level.priceKcoin}-${level.listingCount}-${level.itemCount}`}
                      >
                        <span>{formatKcoinWithUnit(level.priceKcoin)}</span>
                        <strong>
                          {level.listingCount} 单 / {level.itemCount} 件
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="listing-detail-depth__empty">
                    <ShoppingBag aria-hidden="true" size={18} strokeWidth={2.3} />
                    <span>暂无深度</span>
                  </div>
                )}
              </section>

              <footer className="listing-detail-sheet__footer">
                {buyDisabledReason ? (
                  <span>{buyDisabledReason}</span>
                ) : (
                  <span>当前余额 {formatKcoinWithUnit(balanceAvailable)}</span>
                )}
                <button
                  disabled={buyDisabled}
                  onClick={() => onBuy(listing)}
                  type="button"
                >
                  <Coins aria-hidden="true" size={16} strokeWidth={2.5} />
                  {isBuying ? "购买中" : "购买"}
                </button>
              </footer>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PriceMetric({
  icon,
  label,
  value,
}: {
  icon?: "coins";
  label: string;
  value: string;
}) {
  return (
    <div className="listing-detail-price__metric">
      <span>
        {icon === "coins" ? (
          <Coins aria-hidden="true" size={13} strokeWidth={2.5} />
        ) : null}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailState({
  title,
  detail,
  tone = "neutral",
  onRetry,
}: {
  title: string;
  detail: string;
  tone?: "neutral" | "error";
  onRetry?: () => void;
}) {
  return (
    <div
      className={`listing-detail-state listing-detail-state--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {tone === "error" ? (
        <AlertTriangle aria-hidden="true" size={19} strokeWidth={2.3} />
      ) : null}
      <strong>{title}</strong>
      <span>{detail}</span>
      {onRetry ? (
        <button onClick={onRetry} type="button">
          <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
          重试
        </button>
      ) : null}
    </div>
  );
}

function formatNullableKcoin(value: number | null): string {
  return value === null ? "暂无参考" : formatKcoinWithUnit(value);
}

function getPriceHealthDescription(listing: MarketListingDetail): string {
  if (
    listing.priceHealth === "unknown" ||
    listing.referencePriceKcoin === null
  ) {
    return "暂无参考价";
  }

  if (listing.priceHealth === "too_high") {
    return "高于参考区间";
  }

  if (listing.priceHealth === "too_low") {
    return "低于参考区间";
  }

  return "价格正常";
}
