import { Coins } from "lucide-react";

import type { MarketListingCard } from "../trade.types";
import {
  formatKcoinWithUnit,
  getItemTypeLabel,
  getListingStatusLabel,
  getMarketBuyDisabledReason,
} from "../trade.utils";

type ListingCardProps = {
  listing: MarketListingCard;
  balanceAvailable: string;
  onBuy: (listing: MarketListingCard) => void;
  onOpenDetail: (listing: MarketListingCard) => void;
};

export function ListingCard({
  balanceAvailable,
  listing,
  onBuy,
  onOpenDetail,
}: ListingCardProps) {
  const imageContent = listing.imageUrl ? (
    <img src={listing.imageUrl} alt={listing.itemName} />
  ) : (
    <span aria-hidden="true">{listing.itemName.slice(0, 1)}</span>
  );
  const disabledReason = getMarketBuyDisabledReason(
    listing,
    balanceAvailable,
  );
  const disabled = Boolean(disabledReason);
  const buttonLabel = getBuyButtonLabel(listing, disabledReason);
  const handleOpenDetail = () => {
    onOpenDetail(listing);
  };
  const handleBuy = () => {
    if (!disabled) {
      onBuy(listing);
    }
  };

  return (
    <article
      className={`market-listing-card market-listing-card--${getRarityTone(
        listing.rarityCode,
      )}`}
      data-listing-id={listing.listingId}
    >
      <button
        className="market-listing-card__detail"
        onClick={handleOpenDetail}
        type="button"
      >
        <div className="market-listing-card__image">{imageContent}</div>

        <div className="market-listing-card__body">
          <div className="market-listing-card__title">
            <h3>{listing.itemName}</h3>
            <span>{listing.rarityLabel}</span>
          </div>

          <dl className="market-listing-card__meta">
            <div>
              <dt>类型</dt>
              <dd>{getItemTypeLabel(listing.typeCode)}</dd>
            </div>
            <div>
              <dt>剩余</dt>
              <dd>{listing.remainingCount}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{getListingStatusLabel(listing.status)}</dd>
            </div>
          </dl>
        </div>
      </button>

      <div className="market-listing-card__footer">
        <strong className="market-listing-card__price">
          <Coins aria-hidden="true" size={15} strokeWidth={2.5} />
          {formatKcoinWithUnit(listing.unitPriceKcoin)}
        </strong>
        <button
          className="market-listing-card__buy"
          disabled={disabled}
          onClick={handleBuy}
          title={disabledReason ?? undefined}
          type="button"
        >
          {buttonLabel}
        </button>
      </div>
    </article>
  );
}

function getRarityTone(rarityCode: string): string {
  if (
    rarityCode === "common" ||
    rarityCode === "rare" ||
    rarityCode === "epic" ||
    rarityCode === "legendary" ||
    rarityCode === "mythic"
  ) {
    return rarityCode;
  }

  return "common";
}

function getBuyButtonLabel(
  listing: MarketListingCard,
  disabledReason: string | null,
): string {
  if (listing.isOwnListing) {
    return "自己的挂单";
  }

  if (disabledReason === "K-coin 余额不足") {
    return "余额不足";
  }

  return "购买";
}
