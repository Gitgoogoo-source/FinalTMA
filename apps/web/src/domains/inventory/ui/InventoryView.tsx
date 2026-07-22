import { BookOpen, ChevronsUp, Crosshair, Star } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useApiQuery } from "../../../platform/query/index.ts";
import {
  Badge,
  Button,
  Card,
  CatalogImage,
  PageState,
} from "../../../shared/ui/index.tsx";
import { useNewMarkers } from "../../../workflows/new-markers/index.ts";
import type { InventoryItem } from "../types.ts";

const rarityLabels: Record<InventoryItem["rarity"], string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};

const thumbnailPageSize = 8;

export function InventoryView({
  renderActions,
}: {
  renderActions(item: InventoryItem, imageReady: boolean): ReactNode;
}): ReactNode {
  const query = useApiQuery("inventory.list");
  const [searchParams, setSearchParams] = useSearchParams();
  const targetId =
    searchParams.get("template") ?? searchParams.get("template_id") ?? "";
  const targetAction = searchParams.get("action");
  const catalog = useApiQuery("catalog.get", {}, Boolean(targetId));
  const { templateIds: newTemplateIds, clearNew } = useNewMarkers();
  const navigate = useNavigate();
  const items = (query.data?.items ?? []).filter((item) => item.available > 0);
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
  const detailRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const missingTargetRef = useRef<HTMLElement>(null);
  const focusedTarget = useRef("");
  const targetOwned = items.some(
    (candidate) => candidate.template_id === targetId,
  );
  const effectiveId = items.some((item) => item.template_id === selectedId)
    ? selectedId
    : targetId && !targetOwned
      ? ""
      : (items[0]?.template_id ?? "");
  const item = items.find((candidate) => candidate.template_id === effectiveId);
  const imageReady = imageState.templateId === effectiveId && imageState.ready;
  const targetTemplate = catalog.data?.templates.find(
    (candidate) => candidate.id === targetId,
  );
  const itemIsNew = Boolean(item && newTemplateIds.has(item.template_id));
  const thumbnailPages = Array.from(
    { length: Math.ceil(items.length / thumbnailPageSize) },
    (_, index) =>
      items.slice(index * thumbnailPageSize, (index + 1) * thumbnailPageSize),
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
        onClick={() => navigate("/album")}
      >
        <BookOpen />
        <span>图鉴</span>
      </Button>
      <PageState
        loading={query.isLoading}
        error={query.error as Error | null}
        onRetry={() => void query.refetch()}
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
            <section
              className="inventory-showcase"
              aria-labelledby="inventory-selected-name"
            >
              <div
                ref={item.template_id === targetId ? detailRef : undefined}
                className="inventory-title-board"
                tabIndex={item.template_id === targetId ? -1 : undefined}
              >
                <span>当前藏品</span>
                <h2 id="inventory-selected-name">{item.name}</h2>
                {itemIsNew && (
                  <strong className="detail-new-acquisition">本次新获得</strong>
                )}
              </div>

              <div className="inventory-hero-art">
                <CatalogImage
                  key={effectiveId}
                  path={item.image_detail_path}
                  alt={item.name}
                  variant="detail"
                  loading="eager"
                  fetchPriority="high"
                  onAvailability={(ready) =>
                    setImageState({ templateId: effectiveId, ready })
                  }
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

              <div className="inventory-thumbnail-viewport">
                <div className="inventory-thumbnail-pages">
                  {thumbnailPages.map((page, pageIndex) => (
                    <div
                      key={page[0]?.template_id ?? pageIndex}
                      className="thumbnail-strip inventory-thumbnail-page"
                      aria-label={`藏品选择第 ${pageIndex + 1} 页，共 ${thumbnailPages.length} 页`}
                    >
                      {page.map((candidate) => {
                        const selected = candidate.template_id === effectiveId;
                        const isNew = newTemplateIds.has(candidate.template_id);
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
                                setImageState({ templateId: "", ready: false });
                                setSearchParams({}, { replace: true });
                              }
                              if (isNew) clearNew(candidate.template_id);
                            }}
                          >
                            <CatalogImage
                              path={candidate.image_thumbnail_path}
                              alt={candidate.name}
                              variant="thumbnail"
                              loading="lazy"
                            />
                            <i className={`rarity-mark ${candidate.rarity}`} />
                            <span className="inventory-quantity-badge">
                              ×{candidate.available}
                            </span>
                            {isNew && <b className="new-marker">NEW</b>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </section>
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
              path={targetTemplate.image_thumbnail_path}
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
      {!query.isLoading && items.length === 0 && !targetId && (
        <Card>
          <h2>当前没有可用藏品。</h2>
          <p>出售中、Mint 中或远征中的藏品不会出现在选择区域。</p>
          <Button onClick={() => navigate("/")}>去开盲盒</Button>
        </Card>
      )}
    </main>
  );
}

function InventoryQuantitySummary({
  item,
}: {
  item: InventoryItem;
}): ReactNode {
  const quantities = [
    ["可用", item.available],
    ["出售中", item.listed],
    ["交易中", item.trading],
    ["Mint 中", item.minting],
    ["远征中", item.expedition],
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
