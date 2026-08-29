import { BookOpen } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useAppNavigate } from "../../../platform/navigation/index.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import { useCatalogQuery } from "../../../platform/query/useCatalogQuery.ts";
import { useSession } from "../../../platform/session/store.ts";
import {
  usePageActive,
  usePageSearchParams,
} from "../../../shared/navigation/pageActivity.tsx";
import { markFirstPlayablePageReady } from "../../../shared/navigation/firstPlayablePageReadiness.ts";
import { usePageModulePreparation } from "../../../shared/navigation/pageModulePreparation.ts";
import { Badge } from "../../../shared/ui/Badge.tsx";
import { Button } from "../../../shared/ui/Button.tsx";
import { Card } from "../../../shared/ui/Card.tsx";
import { CatalogImage } from "../../../shared/ui/CatalogImage.tsx";
import {
  CollectionFilterControls,
  type CollectionStage,
} from "../../../shared/ui/CollectionFilterControls.tsx";
import { CollectionDetailShowcase } from "../../../shared/ui/CollectionDetailShowcase.tsx";
import { PageState } from "../../../shared/ui/PageState.tsx";
import { useNewMarkers } from "../../../workflows/new-markers/context.ts";
import { getCollectionSkills } from "../collectionSkills.ts";
import type { InventoryItem } from "../types.ts";
import { useInventoryDetailPrewarm } from "../useInventoryDetailPrewarm.ts";
import { localized, t, tp } from "../../../platform/i18n/index.ts";

const rarityLabels: Record<InventoryItem["rarity"], string> = localized({
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
});

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
  const session = useSession();
  const { templateIds: newTemplateIds, clearNew } = useNewMarkers();
  const navigate = useAppNavigate();
  const preparePage = usePageModulePreparation();
  const pageActive = usePageActive();
  const ownedItems = (query.data?.items ?? []).filter((item) => item.total > 0);
  const emptyInventory =
    query.data !== undefined &&
    !query.isLoading &&
    ownedItems.length === 0 &&
    !targetId;
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
  const [stageFilter, setStageFilter] = useState<CollectionStage | null>(null);
  const [chainTypeFilter, setChainTypeFilter] = useState<
    InventoryItem["chain_type"] | null
  >(null);
  const [thumbnailPageIndex, setThumbnailPageIndex] = useState(0);
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
  const visibleThumbnailPageIndex = Math.min(
    thumbnailPageIndex,
    Math.max(thumbnailPages.length - 1, 0),
  );
  const visibleThumbnailPage = thumbnailPages[visibleThumbnailPageIndex] ?? [];
  const selectedThumbnailIndex = visibleThumbnailPage.findIndex(
    (candidate) => candidate.template_id === effectiveId,
  );
  const detailPrewarmUrls = visibleThumbnailPage
    .filter((candidate) => candidate.template_id !== effectiveId)
    .toSorted((left, right) =>
      selectedThumbnailIndex < 0
        ? 0
        : Math.abs(
            visibleThumbnailPage.indexOf(left) - selectedThumbnailIndex,
          ) -
          Math.abs(
            visibleThumbnailPage.indexOf(right) - selectedThumbnailIndex,
          ),
    )
    .slice(0, thumbnailPageSize - 1)
    .map((candidate) => candidate.image_detail_url);
  useEffect(() => {
    if (
      pageActive &&
      session &&
      query.data !== undefined &&
      !query.error &&
      (!targetId || !catalog.isLoading) &&
      (!item || imageReady)
    )
      markFirstPlayablePageReady(session.generation, "/inventory");
  }, [
    catalog.isLoading,
    imageReady,
    item,
    pageActive,
    query.data,
    query.error,
    session,
    targetId,
  ]);
  useInventoryDetailPrewarm({
    enabled: pageActive && imageReady,
    selectedUrl: item?.image_detail_url ?? "",
    urls: detailPrewarmUrls,
  });
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
    <main className={`page inventory-page${emptyInventory ? " is-empty" : ""}`}>
      <Button
        className="inventory-atlas-button"
        aria-label={t("打开图鉴")}
        onPointerEnter={() => preparePage("/album")}
        onPointerDown={() => preparePage("/album")}
        onFocus={() => preparePage("/album")}
        onClick={() => {
          preparePage("/album");
          navigate("/album");
        }}
      >
        <BookOpen />
        <span>{t("图鉴")}</span>
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
            {tp("已定位：{{0}} {{1}}", [
              t(item.name),
              targetAction === "evolve" ? t("，请查看进化操作") : "",
            ])}
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
                    ? tp("{{0}}进化操作", [t(item.name)])
                    : t("藏品操作")
                }
              >
                {renderActions(item, imageReady)}
              </div>

              <CollectionFilterControls
                idPrefix="inventory"
                className="inventory-filter-controls"
                rarity={rarityFilter}
                stage={stageFilter}
                chainType={chainTypeFilter}
                resultCount={filteredSelectableItems.length}
                onRarityChange={setRarityFilter}
                onStageChange={setStageFilter}
                onChainTypeChange={setChainTypeFilter}
              />

              <div
                className="inventory-thumbnail-viewport"
                onScroll={(event) => {
                  const viewport = event.currentTarget;
                  const pageCount = thumbnailPages.length;
                  if (pageCount < 2) {
                    setThumbnailPageIndex(0);
                    return;
                  }
                  const stride =
                    (viewport.scrollWidth - viewport.clientWidth) /
                    (pageCount - 1);
                  if (stride <= 0) return;
                  const nextIndex = Math.min(
                    pageCount - 1,
                    Math.max(0, Math.round(viewport.scrollLeft / stride)),
                  );
                  setThumbnailPageIndex((current) =>
                    current === nextIndex ? current : nextIndex,
                  );
                }}
              >
                {thumbnailPages.length > 0 ? (
                  <div className="inventory-thumbnail-pages">
                    {thumbnailPages.map((page, pageIndex) => (
                      <div
                        key={page[0]?.template_id ?? pageIndex}
                        className="thumbnail-strip inventory-thumbnail-page"
                        aria-label={tp("藏品选择第 {{0}} 页，共 {{1}} 页", [
                          pageIndex + 1,
                          thumbnailPages.length,
                        ])}
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
                              aria-label={tp(
                                "选择{{0}}，{{1}}，第 {{2}} 阶，可用 {{3}} 个{{4}}",
                                [
                                  t(candidate.name),
                                  rarityLabels[candidate.rarity],
                                  candidate.stage,
                                  candidate.available,
                                  isNew ? t("，本次新获得") : "",
                                ],
                              )}
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
                                alt={t(candidate.name)}
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
                    <strong>{t("没有符合筛选的藏品")}</strong>
                    <span>{t("换一个筛选条件看看吧")}</span>
                  </div>
                )}
              </div>
            </CollectionDetailShowcase>
          </>
        )}
        {targetId && !targetOwned && targetTemplate && (
          <Card
            ref={missingTargetRef}
            className="inventory-target-empty"
            tabIndex={-1}
            aria-labelledby="inventory-target-empty-title"
          >
            <CatalogImage
              url={targetTemplate.image_thumbnail_url}
              alt={t(targetTemplate.name)}
              variant="thumbnail"
              loading="eager"
            />
            <div>
              <Badge>
                {tp("{{0}} · 第 {{1}} 阶", [
                  targetTemplate.rarity,
                  targetTemplate.stage,
                ])}
              </Badge>
              <h2 id="inventory-target-empty-title">
                {t(targetTemplate.name)}
              </h2>
              <p>{t("当前可用：0")}</p>
              {targetAction === "evolve" && (
                <p>{t("当前没有这只上一阶材料，无法进行进化。")}</p>
              )}
              <Button
                className="secondary"
                onClick={() => navigate("/inventory")}
              >
                {t("查看当前藏品")}
              </Button>
            </div>
          </Card>
        )}
        {targetId && catalog.isLoading && (
          <div className="inventory-location" role="status">
            {t("正在定位目标藏品")}
          </div>
        )}
        {targetId && catalog.error && (
          <div className="inventory-location" role="alert">
            {t("目标藏品加载失败，请重新进入图鉴后再试")}
          </div>
        )}
        {targetId && catalog.data && !targetTemplate && (
          <div className="inventory-location" role="alert">
            {t("目标藏品不存在")}
          </div>
        )}
      </PageState>
      {emptyInventory && (
        <section
          className="inventory-empty"
          aria-labelledby="inventory-empty-title"
        >
          <img
            className="inventory-empty-art"
            src="/assets/inventory/collection-empty-anime-v1.webp"
            alt=""
            width="853"
            height="1844"
            loading="eager"
            decoding="async"
            fetchPriority="high"
            draggable={false}
            aria-hidden="true"
          />
          <div className="inventory-empty-copy">
            <h1 id="inventory-empty-title">{t("新故事从这里开始")}</h1>
            <p>{t("打开一个盲盒，开启你的藏品之旅。")}</p>
          </div>
          <Button
            className="inventory-empty-cta"
            onPointerEnter={() => preparePage("/")}
            onPointerDown={() => preparePage("/")}
            onFocus={() => preparePage("/")}
            onClick={() => {
              preparePage("/");
              navigate("/");
            }}
          >
            {t("去开盲盒")}
          </Button>
        </section>
      )}
    </main>
  );
}
