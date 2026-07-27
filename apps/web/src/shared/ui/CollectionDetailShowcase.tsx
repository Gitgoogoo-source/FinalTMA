import { ChevronsUp, Crosshair, Star } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { CatalogImage } from "./CatalogImage.tsx";

export type CollectionDetailItem = {
  template_id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary" | "mythic";
  stage: number;
  image_detail_path: string;
  combat_power: number;
  available: number;
  listed: number;
  trading: number;
  expedition: number;
  minting: number;
  battling: number;
};

const rarityLabels: Record<CollectionDetailItem["rarity"], string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};

export function CollectionDetailShowcase({
  item,
  headingId,
  titleRef,
  titleTabIndex,
  newAcquisition = false,
  onImageAvailability,
  children,
  className = "",
}: {
  item: CollectionDetailItem;
  headingId: string;
  titleRef?: Ref<HTMLDivElement> | undefined;
  titleTabIndex?: number | undefined;
  newAcquisition?: boolean;
  onImageAvailability?: ((ready: boolean) => void) | undefined;
  children?: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <section
      className={`inventory-showcase ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <div
        ref={titleRef}
        className="inventory-title-board"
        tabIndex={titleTabIndex}
      >
        <span>当前藏品</span>
        <h2 id={headingId}>{item.name}</h2>
        {newAcquisition ? (
          <strong className="detail-new-acquisition">本次新获得</strong>
        ) : null}
      </div>

      <div className="inventory-hero-art">
        <CatalogImage
          key={item.template_id}
          path={item.image_detail_path}
          alt={item.name}
          variant="detail"
          loading="eager"
          fetchPriority="high"
          {...(onImageAvailability
            ? { onAvailability: onImageAvailability }
            : {})}
        />
      </div>

      <div className="inventory-metric-grid">
        <InventoryMetric
          label="稀有度"
          value={rarityLabels[item.rarity]}
          tone={item.rarity}
          icon={<Star />}
        />
        <InventoryMetric
          label="进化阶段"
          value={`${item.stage} 阶`}
          icon={<ChevronsUp />}
        />
        <InventoryMetric
          label="战斗力"
          value={item.combat_power.toLocaleString("zh-CN")}
          icon={<Crosshair />}
        />
      </div>

      <InventoryQuantitySummary item={item} />
      {children}
    </section>
  );
}

function InventoryQuantitySummary({
  item,
}: {
  item: CollectionDetailItem;
}): ReactNode {
  const quantities = [
    ["可用", item.available],
    ["出售中", item.listed],
    ["交易中", item.trading],
    ["Mint 中", item.minting],
    ["远征中", item.expedition],
    ["Battle 中", item.battling],
  ] as const;
  return (
    <div className="inventory-quantity-summary" aria-label="藏品状态数量">
      {quantities
        .filter(([label, quantity]) => label === "可用" || quantity > 0)
        .map(([label, quantity]) => (
          <span key={label}>
            {label} <strong>×{quantity}</strong>
          </span>
        ))}
    </div>
  );
}

function InventoryMetric({
  label,
  value,
  icon,
  tone = "",
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: string;
}): ReactNode {
  return (
    <div className={`inventory-metric ${tone}`}>
      <span>{label}</span>
      <i>{icon}</i>
      <strong>{value}</strong>
      <small aria-hidden="true">••••</small>
    </div>
  );
}
