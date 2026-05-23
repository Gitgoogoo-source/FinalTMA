import { Coins, Edit3, Package, Tag, Trash2 } from "lucide-react";

import type { MarketListingStatus, MyListing } from "../trade.types";
import {
  formatKcoinWithUnit,
  getItemTypeLabel,
  getListingStatusLabel,
} from "../trade.utils";

type MyListingRowProps = {
  listing: MyListing;
  onCancel: (listing: MyListing) => void;
  onChangePrice: (listing: MyListing) => void;
};

export function MyListingRow({
  listing,
  onCancel,
  onChangePrice,
}: MyListingRowProps) {
  const isActionable = isListingActionable(listing.status);
  const imageContent = listing.imageUrl ? (
    <img src={listing.imageUrl} alt={listing.itemName} />
  ) : (
    <span aria-hidden="true">{listing.itemName.slice(0, 1)}</span>
  );
  const expectedNetAmount =
    listing.expectedNetAmountKcoin === null
      ? "暂无参考"
      : formatKcoinWithUnit(listing.expectedNetAmountKcoin);

  return (
    <article
      className={`my-listing-row my-listing-row--${getRarityTone(
        listing.rarityCode,
      )}`}
      data-listing-id={listing.listingId}
      data-testid="my-listing-row"
    >
      <div className="my-listing-row__image">{imageContent}</div>

      <div className="my-listing-row__body">
        <div className="my-listing-row__title">
          <div>
            <span>{listing.rarityLabel}</span>
            <h3>{listing.itemName}</h3>
          </div>
          <strong
            className={`my-listing-row__status my-listing-row__status--${listing.status}`}
          >
            {getListingStatusLabel(listing.status)}
          </strong>
        </div>

        <dl className="my-listing-row__meta">
          <div>
            <dt>单价</dt>
            <dd>
              <Coins aria-hidden="true" size={14} strokeWidth={2.5} />
              {formatKcoinWithUnit(listing.unitPriceKcoin)}
            </dd>
          </div>
          <div>
            <dt>剩余 / 总数</dt>
            <dd>
              <Package aria-hidden="true" size={14} strokeWidth={2.5} />
              {listing.remainingCount} / {listing.itemCount}
            </dd>
          </div>
          <div>
            <dt>类型</dt>
            <dd>
              <Tag aria-hidden="true" size={14} strokeWidth={2.5} />
              {getItemTypeLabel(listing.typeCode)}
            </dd>
          </div>
          <div>
            <dt>预计到账</dt>
            <dd>{expectedNetAmount}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{formatListingTime(listing.createdAt)}</dd>
          </div>
        </dl>
      </div>

      <div className="my-listing-row__actions">
        <button
          aria-label={`改价 ${listing.itemName}`}
          disabled={!isActionable}
          onClick={() => {
            if (isActionable) {
              onChangePrice(listing);
            }
          }}
          type="button"
        >
          <Edit3 aria-hidden="true" size={14} strokeWidth={2.5} />
          改价
        </button>
        <button
          aria-label={`下架 ${listing.itemName}`}
          disabled={!isActionable}
          onClick={() => {
            if (isActionable) {
              onCancel(listing);
            }
          }}
          type="button"
        >
          <Trash2 aria-hidden="true" size={14} strokeWidth={2.5} />
          下架
        </button>
      </div>
    </article>
  );
}

function isListingActionable(status: MarketListingStatus): boolean {
  return status === "active" || status === "partially_sold";
}

function formatListingTime(value: string | null): string {
  if (!value) {
    return "暂无";
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "暂无";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
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
