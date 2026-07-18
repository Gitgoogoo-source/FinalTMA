import { BookOpen, Dna, Flame, Link2, ShoppingBag } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import {
  Badge,
  Button,
  Card,
  CatalogImage,
  PageState,
} from "../../shared/ui/index.tsx";

export function InventoryPage(): ReactNode {
  const query = useApiQuery("inventory.list");
  const { blocked, run } = useOperation();
  const navigate = useNavigate();
  const items = query.data?.items ?? [];
  const [selectedId, setSelectedId] = useState("");
  const [imageReady, setImageReady] = useState(false);
  const effectiveId = items.some((item) => item.template_id === selectedId)
    ? selectedId
    : (items[0]?.template_id ?? "");
  const item = items.find((candidate) => candidate.template_id === effectiveId);
  const evolve = (templateId: string) => void run("正在确认进化结果", async () => {
      const response = await apiRequest("inventory.evolve", { template_id: templateId }, {
        idempotencyKey: newIdempotencyKey(),
      });
      return { data: response.data, operationId: response.operationId };
    });
  const decompose = (templateId: string) => void run("正在确认分解结果", async () => {
      const response = await apiRequest("inventory.decompose", { template_id: templateId, quantity: 1 }, { idempotencyKey: newIdempotencyKey() });
      return { data: response.data, operationId: response.operationId };
    });
  return (
    <main className="page">
      <header className="page-heading">
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
                <Badge>
                  {item.rarity} · 第 {item.stage} 阶
                </Badge>
                <h2>{item.name}</h2>
                <p>战斗力 {item.combat_power}</p>
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
                    远征中<strong>{item.expedition}</strong>
                  </span>
                  <span>
                    Mint 中<strong>{item.minting}</strong>
                  </span>
                </div>
              </div>
            </Card>
            <div className="action-grid">
              <Button
                disabled={
                  blocked ||
                  !imageReady ||
                  item.available < 3 || item.stage >= 3
                }
                onClick={() =>
                  evolve(item.template_id)
                }
              >
                <Dna />
                进化
              </Button>
              <Button
                disabled={blocked || !imageReady || item.available < 1}
                onClick={() =>
                  decompose(item.template_id)
                }
              >
                <Flame />
                分解
              </Button>
              <Button
                disabled={blocked || !imageReady || item.available < 1}
                onClick={() =>
                  navigate(
                    `/market?sell=${encodeURIComponent(item.template_id)}`,
                  )
                }
              >
                <ShoppingBag />
                出售
              </Button>
              <Button
                disabled={blocked || !imageReady || item.available < 1}
                onClick={() =>
                  navigate(
                    `/mint/${encodeURIComponent(item.template_id)}`,
                  )
                }
              >
                <Link2 />
                Mint
              </Button>
            </div>
            <div className="thumbnail-strip">
              {items.map((candidate) => (
                <button
                  key={candidate.template_id}
                  className={
                    candidate.template_id === effectiveId ? "selected" : ""
                  }
                  onClick={() => {
                    setSelectedId(candidate.template_id);
                    setImageReady(false);
                  }}
                >
                  <CatalogImage
                    path={candidate.image_path}
                    alt={candidate.name}
                  />
                  <span>×{candidate.total}</span>
                </button>
              ))}
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
