import { LockKeyhole } from "lucide-react";

import type { AlbumItem } from "../album.types";

const RARITY_LABELS: Record<string, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};

type AlbumItemCardProps = {
  item: AlbumItem;
};

export function AlbumItemCard({ item }: AlbumItemCardProps) {
  const imageUrl = item.thumbUrl ?? item.imageUrl;
  const rarityLabel = formatRarity(item.rarity);
  const title = item.isCollected ? item.name : "未知藏品";
  const ariaLabel = item.isCollected
    ? `${item.name}，${rarityLabel}，已点亮`
    : `${rarityLabel}藏品，未点亮`;

  return (
    <article
      aria-label={ariaLabel}
      className="album-item-card"
      data-collected={item.isCollected ? "true" : "false"}
      data-rarity={getRarityTone(item.rarity)}
      role="listitem"
    >
      <div className="album-item-card__image" aria-hidden="true">
        {item.isCollected && imageUrl ? (
          <img src={imageUrl} alt="" />
        ) : (
          <span className="album-item-card__lock">
            <LockKeyhole aria-hidden="true" size={28} strokeWidth={2.2} />
          </span>
        )}
      </div>

      <div className="album-item-card__copy">
        <div className="album-item-card__title-row">
          <strong>{title}</strong>
          <span>{rarityLabel}</span>
        </div>

        {item.isCollected ? (
          <span className="album-item-card__meta">
            首次获得 {formatCollectedAt(item.firstCollectedAt)}
          </span>
        ) : (
          <span className="album-item-card__meta">未收集</span>
        )}

        {item.isCollected && item.collectedCount > 1 ? (
          <em>已获得 {item.collectedCount} 次</em>
        ) : null}
      </div>
    </article>
  );
}

function formatRarity(value: string): string {
  const normalized = value.toLowerCase();

  return RARITY_LABELS[normalized] ?? normalized.toUpperCase();
}

function getRarityTone(value: string): string {
  const normalized = value.toLowerCase();

  if (
    normalized === "common" ||
    normalized === "rare" ||
    normalized === "epic" ||
    normalized === "legendary" ||
    normalized === "mythic"
  ) {
    return normalized;
  }

  return "common";
}

function formatCollectedAt(value: string | null): string {
  if (!value) {
    return "已记录";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "已记录";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
