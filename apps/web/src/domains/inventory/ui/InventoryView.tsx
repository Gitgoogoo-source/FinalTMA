import { BookOpen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { CatalogImage } from "../../../shared/ui/index.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useNewMarkers } from "../../../workflows/new-markers/index.ts";
import type { InventoryItem } from "../types.ts";

export function InventoryView({
  renderActions,
}: {
  renderActions(item: InventoryItem, imageReady: boolean): ReactNode;
}): ReactNode {
  const query = useApiQuery("inventory.list");
  const { templateIds: newTemplateIds, clearNew } = useNewMarkers();
  const navigate = useNavigate();
  const items = query.data?.items ?? [];
  const [selectedId, setSelectedId] = useState("");
  const [imageReady, setImageReady] = useState(false);
  const effectiveId = items.some((item) => item.template_id === selectedId)
    ? selectedId
    : (items[0]?.template_id ?? "");
  const item = items.find((candidate) => candidate.template_id === effectiveId);
  const itemIsNew = Boolean(item && newTemplateIds.has(item.template_id));
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
        {item && (
          <>
            <Card className="inventory-detail">
              <div className="art-panel">
                <CatalogImage
                  key={effectiveId}
                  path={item.image_path}
                  alt={item.name}
                  onAvailability={setImageReady}
                />
              </div>
              <div className="detail-copy">
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
            <div className="action-grid">{renderActions(item, imageReady)}</div>
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
                        setSelectedId(candidate.template_id);
                        setImageReady(false);
                      }
                      if (isNew) clearNew(candidate.template_id);
                    }}
                  >
                    <CatalogImage
                      path={candidate.image_path}
                      alt={candidate.name}
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
      </PageState>
      {!query.isLoading && items.length === 0 && (
        <Card>
          <h2>你还没有任何藏品。</h2>
          <p>去开盲盒，获得你的第一个藏品。</p>
          <Button onClick={() => navigate("/")}>去开盲盒</Button>
        </Card>
      )}
    </main>
  );
}
