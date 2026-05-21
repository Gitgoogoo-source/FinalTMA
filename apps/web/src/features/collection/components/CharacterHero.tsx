import { Shield, Sparkles, Swords } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { CollectionInventoryItem } from "../collection.types";

type CharacterHeroProps = {
  item: CollectionInventoryItem;
};

export function CharacterHero({ item }: CharacterHeroProps) {
  const imageUrl = item.imageUrl ?? item.thumbnailUrl ?? item.avatarUrl;

  return (
    <section
      className={`character-hero character-hero--${item.rarity.code}`}
      aria-label="当前选中藏品"
    >
      <div className="character-hero__copy">
        <span className="character-hero__kicker">
          <Sparkles aria-hidden="true" size={15} strokeWidth={2.4} />
          {item.rarity.label}
        </span>
        <h1>{item.name}</h1>
        <p>{buildDescription(item)}</p>
      </div>

      <div className="character-hero__stage">
        <span className="character-hero__shadow" aria-hidden="true" />
        {imageUrl ? (
          <img src={imageUrl} alt={item.name} />
        ) : (
          <span className="character-hero__fallback" aria-hidden="true">
            {item.name.slice(0, 1)}
          </span>
        )}
      </div>

      <dl className="character-hero__stats" aria-label="藏品详情">
        <div>
          <dt>
            <Shield aria-hidden="true" size={14} strokeWidth={2.4} />
            等级
          </dt>
          <dd>Lv.{formatCurrencyAmount(item.level)}</dd>
        </div>
        <div>
          <dt>
            <Swords aria-hidden="true" size={14} strokeWidth={2.4} />
            战力
          </dt>
          <dd>{formatCurrencyAmount(item.power)}</dd>
        </div>
        <div>
          <dt>编号</dt>
          <dd>{item.serialNo ? `#${item.serialNo}` : "未编号"}</dd>
        </div>
      </dl>
    </section>
  );
}

function buildDescription(item: CollectionInventoryItem): string {
  if (item.description) {
    return item.description;
  }

  const meta = [
    item.series?.displayName,
    item.form?.displayName,
    item.subtitle,
  ].filter(isString);

  if (meta.length > 0) {
    return meta.join(" · ");
  }

  return "已进入你的库存，可在后续阶段用于成长、交易和链上 Mint。";
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
