import { Coins } from "lucide-react";

import type { MarketListingCard } from "../trade.types";
import {
  formatKcoinWithUnit,
  getItemTypeLabel,
  getListingStatusLabel,
} from "../trade.utils";

type ListingCardProps = {
  listing: MarketListingCard;
};

export function ListingCard({ listing }: ListingCardProps) {
  const imageContent = listing.imageUrl ? (
    <img src={listing.imageUrl} alt={listing.itemName} />
  ) : (
    <span aria-hidden="true">{listing.itemName.slice(0, 1)}</span>
  );
  const disabled = listing.isOwnListing || !listing.canBuy;
  const buttonLabel = listing.isOwnListing ? "自己的挂单" : "购买";

  return (
    <article
      className={`market-listing-card market-listing-card--${getRarityTone(
        listing.rarityCode,
      )}`}
      data-listing-id={listing.listingId}
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

      <div className="market-listing-card__footer">
        <strong className="market-listing-card__price">
          <Coins aria-hidden="true" size={15} strokeWidth={2.5} />
          {formatKcoinWithUnit(listing.unitPriceKcoin)}
        </strong>
        <button
          className="market-listing-card__buy"
          disabled={disabled}
          title={listing.notBuyableReason ?? undefined}
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
