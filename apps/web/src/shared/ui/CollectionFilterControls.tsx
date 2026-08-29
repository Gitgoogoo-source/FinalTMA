import { ChevronDown, GitBranch, Layers3, Settings2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { localized, t, tp } from "../../platform/i18n/index.ts";
import "../styles/collection-filter-controls.css";

const collectionRarityLabels = localized({
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
} as const);

const collectionChainTypeLabels = localized({
  normal: "普通链",
  advanced: "高级链",
  top: "顶级链",
} as const);

export type CollectionRarity = keyof typeof collectionRarityLabels;
export type CollectionStage = 1 | 2 | 3;
export type CollectionChainType = keyof typeof collectionChainTypeLabels;

type CollectionFilter = "rarity" | "stage" | "chainType";

const rarityOptions: readonly CollectionRarity[] = [
  "common",
  "rare",
  "epic",
  "legendary",
  "mythic",
];
const stageOptions: readonly CollectionStage[] = [1, 2, 3];
const chainTypeOptions: readonly CollectionChainType[] = [
  "normal",
  "advanced",
  "top",
];

export function CollectionFilterControls({
  idPrefix,
  className,
  rarity,
  stage,
  chainType,
  resultCount,
  disabled = false,
  onRarityChange,
  onStageChange,
  onChainTypeChange,
}: {
  idPrefix: string;
  className?: string;
  rarity: CollectionRarity | null;
  stage: CollectionStage | null;
  chainType: CollectionChainType | null;
  resultCount: number;
  disabled?: boolean;
  onRarityChange(value: CollectionRarity | null): void;
  onStageChange(value: CollectionStage | null): void;
  onChainTypeChange(value: CollectionChainType | null): void;
}): ReactNode {
  const [openFilter, setOpenFilter] = useState<CollectionFilter | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const optionsId = `${idPrefix}-filter-options`;

  useEffect(() => {
    if (!openFilter) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !controlsRef.current?.contains(event.target)
      ) {
        setOpenFilter(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenFilter(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openFilter]);

  return (
    <div
      ref={controlsRef}
      className={`collection-filter-controls${className ? ` ${className}` : ""}`}
    >
      <div className="collection-filter-strip" aria-label={t("筛选宠物藏品")}>
        <CollectionFilterButton
          icon={<Settings2 aria-hidden="true" />}
          label={
            rarity === null ? t("全部稀有度") : collectionRarityLabels[rarity]
          }
          active={rarity !== null || openFilter === "rarity"}
          expanded={openFilter === "rarity"}
          controlsId={optionsId}
          disabled={disabled}
          onClick={() =>
            setOpenFilter((value) => (value === "rarity" ? null : "rarity"))
          }
        />
        <CollectionFilterButton
          icon={<Layers3 aria-hidden="true" />}
          label={stage === null ? t("全部阶段") : tp("第 {{0}} 阶", [stage])}
          active={stage !== null || openFilter === "stage"}
          expanded={openFilter === "stage"}
          controlsId={optionsId}
          disabled={disabled}
          onClick={() =>
            setOpenFilter((value) => (value === "stage" ? null : "stage"))
          }
        />
        <CollectionFilterButton
          icon={<GitBranch aria-hidden="true" />}
          label={
            chainType === null
              ? t("全部链型")
              : collectionChainTypeLabels[chainType]
          }
          active={chainType !== null || openFilter === "chainType"}
          expanded={openFilter === "chainType"}
          controlsId={optionsId}
          disabled={disabled}
          onClick={() =>
            setOpenFilter((value) =>
              value === "chainType" ? null : "chainType",
            )
          }
        />
      </div>

      {openFilter && !disabled ? (
        <div
          id={optionsId}
          className="collection-filter-panel"
          role="group"
          aria-label={t("选择藏品筛选条件")}
        >
          {openFilter === "rarity" ? (
            <>
              <CollectionFilterOption
                label={t("全部稀有度")}
                selected={rarity === null}
                onClick={() => {
                  onRarityChange(null);
                  setOpenFilter(null);
                }}
              />
              {rarityOptions.map((value) => (
                <CollectionFilterOption
                  key={value}
                  label={collectionRarityLabels[value]}
                  selected={rarity === value}
                  onClick={() => {
                    onRarityChange(value);
                    setOpenFilter(null);
                  }}
                />
              ))}
            </>
          ) : null}
          {openFilter === "stage" ? (
            <>
              <CollectionFilterOption
                label={t("全部阶段")}
                selected={stage === null}
                onClick={() => {
                  onStageChange(null);
                  setOpenFilter(null);
                }}
              />
              {stageOptions.map((value) => (
                <CollectionFilterOption
                  key={value}
                  label={tp("第 {{0}} 阶", [value])}
                  selected={stage === value}
                  onClick={() => {
                    onStageChange(value);
                    setOpenFilter(null);
                  }}
                />
              ))}
            </>
          ) : null}
          {openFilter === "chainType" ? (
            <>
              <CollectionFilterOption
                label={t("全部链型")}
                selected={chainType === null}
                onClick={() => {
                  onChainTypeChange(null);
                  setOpenFilter(null);
                }}
              />
              {chainTypeOptions.map((value) => (
                <CollectionFilterOption
                  key={value}
                  label={collectionChainTypeLabels[value]}
                  selected={chainType === value}
                  onClick={() => {
                    onChainTypeChange(value);
                    setOpenFilter(null);
                  }}
                />
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      <span className="collection-filter-status" aria-live="polite">
        {tp("当前显示 {{0}} 件藏品", [resultCount])}
      </span>
    </div>
  );
}

function CollectionFilterButton({
  icon,
  label,
  active,
  expanded,
  controlsId,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  expanded: boolean;
  controlsId: string;
  disabled: boolean;
  onClick(): void;
}): ReactNode {
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      aria-expanded={expanded}
      aria-controls={expanded ? controlsId : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      <ChevronDown aria-hidden="true" />
    </button>
  );
}

function CollectionFilterOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick(): void;
}): ReactNode {
  return (
    <button
      type="button"
      className={selected ? "active" : ""}
      aria-pressed={selected}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
