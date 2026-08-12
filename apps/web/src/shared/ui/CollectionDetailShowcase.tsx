import { useState, type ReactNode, type Ref } from "react";

import { CatalogImage, type CatalogImageStatus } from "./CatalogImage.tsx";

export type CollectionDetailItem = {
  template_id: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary" | "mythic";
  stage: number;
  image_thumbnail_url: string;
  image_detail_url: string;
  combat_power: number;
  available: number;
  listed: number;
  trading: number;
  expedition: number;
  minting: number;
  battling: number;
};

type CollectionDetailSkill = {
  name: string;
  damage: number;
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
  skills = [],
  headingId,
  titleRef,
  titleTabIndex,
  newAcquisition = false,
  onImageAvailability,
  children,
  className = "",
}: {
  item: CollectionDetailItem;
  skills?: readonly CollectionDetailSkill[];
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
        <div className="inventory-title-copy">
          <h2 id={headingId}>{item.name}</h2>
          <strong className={`inventory-title-rarity ${item.rarity}`}>
            {rarityLabels[item.rarity]}
          </strong>
          {newAcquisition ? (
            <strong className="detail-new-acquisition">本次新获得</strong>
          ) : null}
        </div>
      </div>

      <div className="inventory-hero-art">
        {skills.length > 0 ? (
          <CollectionSkillRail key={item.template_id} skills={skills} />
        ) : null}
        <CollectionHeroImage
          key={item.template_id}
          item={item}
          onImageAvailability={onImageAvailability}
        />
      </div>

      <div className="inventory-metric-grid">
        <InventoryMetric
          label="进化阶段"
          value={`${item.stage} 阶`}
          tone="stage"
        />
        <InventoryMetric
          label="战斗力"
          value={item.combat_power.toLocaleString("zh-CN")}
          tone="power"
        />
      </div>

      <InventoryQuantitySummary item={item} />
      {children}
    </section>
  );
}

function CollectionHeroImage({
  item,
  onImageAvailability,
}: {
  item: CollectionDetailItem;
  onImageAvailability?: ((ready: boolean) => void) | undefined;
}): ReactNode {
  const [detailStatus, setDetailStatus] =
    useState<CatalogImageStatus>("loading");
  const showDetail = detailStatus !== "loading";

  return (
    <div
      className="inventory-hero-image-stack"
      role="img"
      aria-label={item.name}
    >
      <div
        className="inventory-hero-image-layer inventory-hero-image-preview"
        data-visible={!showDetail}
        aria-hidden="true"
      >
        <CatalogImage
          url={item.image_thumbnail_url}
          alt=""
          variant="thumbnail"
          loading="eager"
          fetchPriority="high"
        />
      </div>
      <div
        className="inventory-hero-image-layer inventory-hero-image-detail"
        data-visible={showDetail}
        aria-hidden="true"
      >
        <CatalogImage
          url={item.image_detail_url}
          alt=""
          variant="detail"
          loading="eager"
          fetchPriority="high"
          onStatusChange={(status) => {
            setDetailStatus(status);
            onImageAvailability?.(status === "ready");
          }}
        />
      </div>
    </div>
  );
}

function CollectionSkillRail({
  skills,
}: {
  skills: readonly CollectionDetailSkill[];
}): ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedSkill = skills[selectedIndex] ?? skills[0];

  if (!selectedSkill) {
    return null;
  }

  return (
    <div className="inventory-skill-rail" aria-label="宠物技能">
      <div className="inventory-skill-summary" aria-live="polite">
        <span className="inventory-skill-name">{selectedSkill.name}</span>
        <span className="inventory-skill-divider" aria-hidden="true" />
        <span className="inventory-skill-damage">
          伤害 <strong>{selectedSkill.damage}</strong>
        </span>
      </div>

      <div className="inventory-skill-tabs">
        {skills.map((skill, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={`${skill.name}-${index}`}
              type="button"
              className={`inventory-skill-tab skill-${index + 1}${selected ? " selected" : ""}`}
              aria-label={`${skill.name}，伤害 ${skill.damage}`}
              aria-pressed={selected}
              onClick={() => setSelectedIndex(index)}
            >
              <span
                className="inventory-skill-bar"
                style={{ width: selected ? 52 : 28 }}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </div>
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
  tone,
}: {
  label: string;
  value: string;
  tone: "stage" | "power";
}): ReactNode {
  return (
    <div
      className={`inventory-metric ${tone}`}
      aria-label={`${label} ${value}`}
    >
      <div className="inventory-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
