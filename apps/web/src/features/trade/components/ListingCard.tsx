import { Coins, Diamond, PackageCheck } from "lucide-react";

import type { MarketListingCard } from "../trade.types";
import {
  formatKcoinWithUnit,
  getItemTypeLabel,
  getMarketRarityTone,
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
  const disabledReason = getMarketBuyDisabledReason(listing, balanceAvailable);
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
      className={`market-listing-card market-listing-card--${getMarketRarityTone(
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
            <span>
              {listing.serialNo ? `#${listing.serialNo}` : "暂无编号"}
            </span>
          </div>

          <div className="market-listing-card__badges">
            <span className="market-listing-card__rarity">
              <Diamond aria-hidden="true" size={11} strokeWidth={2.4} />
              {listing.rarityLabel}
            </span>
            <span className="market-listing-card__type">
              {getItemTypeLabel(listing.typeCode)}
            </span>
          </div>

          <span className="market-listing-card__stock">
            <PackageCheck aria-hidden="true" size={12} strokeWidth={2.4} />
            剩余 {listing.remainingCount}
          </span>
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
