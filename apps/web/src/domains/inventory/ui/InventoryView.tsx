import { BookOpen } from "lucide-react";
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
  const items = query.data?.items ?? [];
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
      <header className="page-heading inventory-heading">
        <div>
          <span>COLLECTION</span>
          <h1>我的藏品</h1>
        </div>
        <Button className="icon-button" onClick={() => navigate("/album")}>
          <BookOpen />
          图鉴
        </Button>
      </header>
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
            <Card className="inventory-detail">
              <div className="art-panel">
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
              <div
                ref={item.template_id === targetId ? detailRef : undefined}
                className="detail-copy"
                tabIndex={item.template_id === targetId ? -1 : undefined}
              >
                <span className="detail-eyebrow">CURRENT POKEPET</span>
                <Badge>
                  {item.rarity} · 第 {item.stage} 阶
                </Badge>
                <h2>{item.name}</h2>
                <p>战斗力 {item.combat_power}</p>
                {itemIsNew && (
                  <span className="detail-new-acquisition">本次新获得</span>
                )}
                <div className="stock-grid">
                  <span>
                    总数<strong>{item.total}</strong>
                  </span>
                  <span>
                    可用<strong>{item.available}</strong>
                  </span>
                  <span>
                    出售中<strong>{item.listed}</strong>
                  </span>
                  <span>
                    交易中<strong>{item.trading}</strong>
                  </span>
                  <span>
                    远征中<strong>{item.expedition}</strong>
                  </span>
                  <span>
                    Mint 中<strong>{item.minting}</strong>
                  </span>
                </div>
              </div>
            </Card>
            <div
              ref={item.template_id === targetId ? actionsRef : undefined}
              className="action-grid"
              tabIndex={
                item.template_id === targetId && targetAction === "evolve"
                  ? -1
                  : undefined
              }
              aria-label={
                item.template_id === targetId && targetAction === "evolve"
                  ? `${item.name}进化操作`
                  : undefined
              }
            >
              {renderActions(item, imageReady)}
            </div>
            <div className="thumbnail-strip">
              {items.map((candidate) => {
                const selected = candidate.template_id === effectiveId;
                const isNew = newTemplateIds.has(candidate.template_id);
                return (
                  <button
                    key={candidate.template_id}
                    className={selected ? "selected" : ""}
                    aria-pressed={selected}
                    aria-label={`选择${candidate.name}，共 ${candidate.total} 个${isNew ? "，本次新获得" : ""}`}
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
                    {isNew && <b className="new-marker">NEW</b>}
                    <span>×{candidate.total}</span>
                  </button>
                );
              })}
            </div>
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
              <p>当前拥有：0</p>
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
          <h2>你还没有任何藏品。</h2>
          <p>去开盲盒，获得你的第一个藏品。</p>
          <Button onClick={() => navigate("/")}>去开盲盒</Button>
        </Card>
      )}
    </main>
  );
}
