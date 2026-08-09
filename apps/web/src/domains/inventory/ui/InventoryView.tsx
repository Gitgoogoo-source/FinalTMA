import {
  BookOpen,
  ChevronDown,
  GitBranch,
  Layers3,
  Settings2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useAppNavigate } from "../../../platform/navigation/index.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import { useCatalogQuery } from "../../../platform/query/useCatalogQuery.ts";
import { usePageSearchParams } from "../../../shared/navigation/pageActivity.tsx";
import { usePageModulePreparation } from "../../../shared/navigation/pageModulePreparation.ts";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { Card } from "../../../shared/ui/Card.tsx";
import { CatalogImage } from "../../../shared/ui/CatalogImage.tsx";
import { CollectionDetailShowcase } from "../../../shared/ui/CollectionDetailShowcase.tsx";
import { PageState } from "../../../shared/ui/PageState.tsx";
import { useNewMarkers } from "../../../workflows/new-markers/context.ts";
import { getCollectionSkills } from "../collectionSkills.ts";
import type { InventoryItem } from "../types.ts";

const rarityLabels: Record<InventoryItem["rarity"], string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};

const chainTypeLabels: Record<InventoryItem["chain_type"], string> = {
  normal: "普通链",
  advanced: "高级链",
  top: "顶级链",
};

const rarityOptions: InventoryItem["rarity"][] = [
  "common",
  "rare",
  "epic",
  "legendary",
  "mythic",
];
const stageOptions = [1, 2, 3] as const;
const chainTypeOptions: InventoryItem["chain_type"][] = [
  "normal",
  "advanced",
  "top",
];

type InventoryFilter = "rarity" | "stage" | "chainType";

const thumbnailPageSize = 8;

export function InventoryView({
  renderActions,
}: {
  renderActions(item: InventoryItem, imageReady: boolean): ReactNode;
}): ReactNode {
  const query = useApiQuery("inventory.list");
  const [searchParams, setSearchParams] = usePageSearchParams();
  const targetId =
    searchParams.get("template") ?? searchParams.get("template_id") ?? "";
  const targetAction = searchParams.get("action");
  const catalog = useCatalogQuery(Boolean(targetId));
  const { templateIds: newTemplateIds, clearNew } = useNewMarkers();
  const navigate = useAppNavigate();
  const preparePage = usePageModulePreparation();
  const ownedItems = (query.data?.items ?? []).filter((item) => item.total > 0);
  const selectableItems = ownedItems.filter((item) => item.available > 0);
  const [selection, setSelection] = useState({
    targetId,
    selectedId: targetId,
  });
  const selectedId =
    selection.targetId === targetId ? selection.selectedId : targetId;
  const [imageState, setImageState] = useState({
    templateId: "",
    ready: false,
  });
  const [rarityFilter, setRarityFilter] = useState<
    InventoryItem["rarity"] | null
  >(null);
  const [stageFilter, setStageFilter] = useState<number | null>(null);
  const [chainTypeFilter, setChainTypeFilter] = useState<
    InventoryItem["chain_type"] | null
  >(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const missingTargetRef = useRef<HTMLElement>(null);
  const focusedTarget = useRef("");
  const targetOwned = ownedItems.some(
    (candidate) => candidate.template_id === targetId,
  );
  const effectiveId =
    targetId && targetOwned
      ? targetId
      : selectableItems.some((item) => item.template_id === selectedId)
        ? selectedId
        : targetId
          ? ""
          : (selectableItems[0]?.template_id ??
            ownedItems[0]?.template_id ??
            "");
  const item = ownedItems.find(
    (candidate) => candidate.template_id === effectiveId,
  );
  const imageReady = imageState.templateId === effectiveId && imageState.ready;
  const targetTemplate = catalog.data?.templates.find(
    (candidate) => candidate.id === targetId,
  );
  const itemIsNew = Boolean(item && newTemplateIds.has(item.template_id));
  const filteredSelectableItems = selectableItems.filter(
    (candidate) =>
      (rarityFilter === null || candidate.rarity === rarityFilter) &&
      (stageFilter === null || candidate.stage === stageFilter) &&
      (chainTypeFilter === null || candidate.chain_type === chainTypeFilter),
  );
  const thumbnailPages = Array.from(
    { length: Math.ceil(filteredSelectableItems.length / thumbnailPageSize) },
    (_, index) =>
      filteredSelectableItems.slice(
        index * thumbnailPageSize,
        (index + 1) * thumbnailPageSize,
      ),
  );
  useEffect(() => {
    if (!item || targetId !== item.template_id || targetAction === "evolve")
      return;
    clearNew(item.template_id);
    if (!searchParams.has("view")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("view");
    setSearchParams(next, { replace: true });
  }, [clearNew, item, searchParams, setSearchParams, targetAction, targetId]);
  useEffect(() => {
    if (!targetId) focusedTarget.current = "";
  }, [targetId]);
  useEffect(() => {
    const focusKey = `${targetId}:${targetAction ?? "details"}`;
    if (!targetId || query.isLoading || focusedTarget.current === focusKey)
      return;
    const target = targetOwned
      ? targetAction === "evolve"
        ? actionsRef.current
        : detailRef.current
      : targetTemplate
        ? missingTargetRef.current
        : null;
    if (!target) return;
    focusedTarget.current = focusKey;
    requestAnimationFrame(() => {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [query.isLoading, targetAction, targetId, targetOwned, targetTemplate]);
  return (
    <main className="page inventory-page">
      <Button
        className="inventory-atlas-button"
        aria-label="打开图鉴"
        onPointerEnter={() => preparePage("/album")}
        onPointerDown={() => preparePage("/album")}
        onFocus={() => preparePage("/album")}
        onClick={() => {
          preparePage("/album");
          navigate("/album");
        }}
      >
        <BookOpen />
        <span>图鉴</span>
      </Button>
      <PageState
        loading={query.isLoading}
        error={query.error as Error | null}
        onRetry={() => void query.refetch()}
        hasContent={query.data !== undefined}
        retrying={query.isFetching}
        empty={false}
      >
        {targetId && item?.template_id === targetId && (
          <p className="inventory-location" role="status">
            已定位：{item.name}
            {targetAction === "evolve" ? "，请查看进化操作" : ""}
          </p>
        )}
        {item && (
          <>
            <CollectionDetailShowcase
              item={item}
              skills={getCollectionSkills(item.template_id)}
              headingId="inventory-selected-name"
              titleRef={item.template_id === targetId ? detailRef : undefined}
              titleTabIndex={item.template_id === targetId ? -1 : undefined}
              newAcquisition={itemIsNew}
              onImageAvailability={(ready) =>
                setImageState({ templateId: effectiveId, ready })
              }
            >
              <div
                ref={item.template_id === targetId ? actionsRef : undefined}
                className="action-grid inventory-action-grid"
                tabIndex={
                  item.template_id === targetId && targetAction === "evolve"
                    ? -1
                    : undefined
                }
                aria-label={
                  item.template_id === targetId && targetAction === "evolve"
                    ? `${item.name}进化操作`
                    : "藏品操作"
                }
              >
                {renderActions(item, imageReady)}
              </div>

              <InventoryFilterControls
                rarity={rarityFilter}
                stage={stageFilter}
                chainType={chainTypeFilter}
                resultCount={filteredSelectableItems.length}
                onRarityChange={setRarityFilter}
                onStageChange={setStageFilter}
                onChainTypeChange={setChainTypeFilter}
              />

              <div className="inventory-thumbnail-viewport">
                {thumbnailPages.length > 0 ? (
                  <div className="inventory-thumbnail-pages">
                    {thumbnailPages.map((page, pageIndex) => (
                      <div
                        key={page[0]?.template_id ?? pageIndex}
                        className="thumbnail-strip inventory-thumbnail-page"
                        aria-label={`藏品选择第 ${pageIndex + 1} 页，共 ${thumbnailPages.length} 页`}
                      >
                        {page.map((candidate) => {
                          const selected =
                            candidate.template_id === effectiveId;
                          const isNew = newTemplateIds.has(
                            candidate.template_id,
                          );
                          return (
                            <button
                              key={candidate.template_id}
                              className={selected ? "selected" : ""}
                              aria-pressed={selected}
                              aria-label={`选择${candidate.name}，${rarityLabels[candidate.rarity]}，第 ${candidate.stage} 阶，可用 ${candidate.available} 个${isNew ? "，本次新获得" : ""}`}
                              onClick={() => {
                                if (!selected) {
                                  setSelection({
                                    targetId: "",
                                    selectedId: candidate.template_id,
                                  });
                                  setImageState({
                                    templateId: "",
                                    ready: false,
                                  });
                                  setSearchParams({}, { replace: true });
                                }
                                if (isNew) clearNew(candidate.template_id);
                              }}
                            >
                              <CatalogImage
                                url={candidate.image_thumbnail_url}
                                alt={candidate.name}
                                variant="thumbnail"
                                loading="lazy"
                              />
                              <i
                                className={`rarity-mark ${candidate.rarity}`}
                              />
                              <span className="inventory-quantity-badge">
                                ×{candidate.available}
                              </span>
                              {isNew && <b className="new-marker">NEW</b>}
                            </button>
                          );
                        })}
                        {Array.from(
                          { length: thumbnailPageSize - page.length },
                          (_, emptyIndex) => (
                            <span
                              key={`empty-${emptyIndex}`}
                              className="inventory-thumbnail-spacer"
                              aria-hidden="true"
                            />
                          ),
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="inventory-filter-empty" role="status">
                    <strong>没有符合筛选的藏品</strong>
                    <span>换一个筛选条件看看吧</span>
                  </div>
                )}
              </div>
            </CollectionDetailShowcase>
          </>
        )}
        {targetId && !targetOwned && targetTemplate && (
          <section
            ref={missingTargetRef}
            className="card inventory-target-empty"
            tabIndex={-1}
            aria-labelledby="inventory-target-empty-title"
          >
            <CatalogImage
              url={targetTemplate.image_thumbnail_url}
              alt={targetTemplate.name}
              variant="thumbnail"
              loading="eager"
            />
            <div>
              <Badge>
                {targetTemplate.rarity} · 第 {targetTemplate.stage} 阶
              </Badge>
              <h2 id="inventory-target-empty-title">{targetTemplate.name}</h2>
              <p>当前可用：0</p>
              {targetAction === "evolve" && (
                <p>当前没有这只上一阶材料，无法进行进化。</p>
              )}
              <Button
                className="secondary"
                onClick={() => navigate("/inventory")}
              >
                查看当前藏品
              </Button>
            </div>
          </section>
        )}
        {targetId && catalog.isLoading && (
          <div className="inventory-location" role="status">
            正在定位目标藏品
          </div>
        )}
        {targetId && catalog.error && (
          <div className="inventory-location" role="alert">
            目标藏品加载失败，请重新进入图鉴后再试
          </div>
        )}
        {targetId && catalog.data && !targetTemplate && (
          <div className="inventory-location" role="alert">
            目标藏品不存在
          </div>
        )}
      </PageState>
      {!query.isLoading && ownedItems.length === 0 && !targetId && (
        <Card>
          <h2>当前没有可用藏品。</h2>
          <p>当前账号尚未持有藏品。</p>
          <Button
            onPointerEnter={() => preparePage("/")}
            onPointerDown={() => preparePage("/")}
            onFocus={() => preparePage("/")}
            onClick={() => {
              preparePage("/");
              navigate("/");
            }}
          >
            去开盲盒
          </Button>
        </Card>
      )}
    </main>
  );
}

function InventoryFilterControls({
  rarity,
  stage,
  chainType,
  resultCount,
  onRarityChange,
  onStageChange,
  onChainTypeChange,
}: {
  rarity: InventoryItem["rarity"] | null;
  stage: number | null;
  chainType: InventoryItem["chain_type"] | null;
  resultCount: number;
  onRarityChange(value: InventoryItem["rarity"] | null): void;
  onStageChange(value: number | null): void;
  onChainTypeChange(value: InventoryItem["chain_type"] | null): void;
}): ReactNode {
  const [openFilter, setOpenFilter] = useState<InventoryFilter | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

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
    <div ref={controlsRef} className="inventory-filter-controls">
      <div className="inventory-filter-strip" aria-label="筛选宠物藏品">
        <InventoryFilterButton
          icon={<Settings2 aria-hidden="true" />}
          label={rarity === null ? "全部稀有度" : rarityLabels[rarity]}
          active={rarity !== null || openFilter === "rarity"}
          expanded={openFilter === "rarity"}
          onClick={() =>
            setOpenFilter((value) => (value === "rarity" ? null : "rarity"))
          }
        />
        <InventoryFilterButton
          icon={<Layers3 aria-hidden="true" />}
          label={stage === null ? "全部阶段" : `第 ${stage} 阶`}
          active={stage !== null || openFilter === "stage"}
          expanded={openFilter === "stage"}
          onClick={() =>
            setOpenFilter((value) => (value === "stage" ? null : "stage"))
          }
        />
        <InventoryFilterButton
          icon={<GitBranch aria-hidden="true" />}
          label={chainType === null ? "全部链型" : chainTypeLabels[chainType]}
          active={chainType !== null || openFilter === "chainType"}
          expanded={openFilter === "chainType"}
          onClick={() =>
            setOpenFilter((value) =>
              value === "chainType" ? null : "chainType",
            )
          }
        />
      </div>

      {openFilter ? (
        <div
          id="inventory-filter-options"
          className="inventory-filter-panel"
          role="group"
          aria-label="选择藏品筛选条件"
        >
          {openFilter === "rarity" ? (
            <>
              <InventoryFilterOption
                label="全部稀有度"
                selected={rarity === null}
                onClick={() => {
                  onRarityChange(null);
                  setOpenFilter(null);
                }}
              />
              {rarityOptions.map((value) => (
                <InventoryFilterOption
                  key={value}
                  label={rarityLabels[value]}
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
              <InventoryFilterOption
                label="全部阶段"
                selected={stage === null}
                onClick={() => {
                  onStageChange(null);
                  setOpenFilter(null);
                }}
              />
              {stageOptions.map((value) => (
                <InventoryFilterOption
                  key={value}
                  label={`第 ${value} 阶`}
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
              <InventoryFilterOption
                label="全部链型"
                selected={chainType === null}
                onClick={() => {
                  onChainTypeChange(null);
                  setOpenFilter(null);
                }}
              />
              {chainTypeOptions.map((value) => (
                <InventoryFilterOption
                  key={value}
                  label={chainTypeLabels[value]}
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

      <span className="inventory-filter-status" aria-live="polite">
        当前显示 {resultCount} 件藏品
      </span>
    </div>
  );
}

function InventoryFilterButton({
  icon,
  label,
  active,
  expanded,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  expanded: boolean;
  onClick(): void;
}): ReactNode {
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      aria-expanded={expanded}
      aria-controls={expanded ? "inventory-filter-options" : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      <ChevronDown aria-hidden="true" />
    </button>
  );
}

function InventoryFilterOption({
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
