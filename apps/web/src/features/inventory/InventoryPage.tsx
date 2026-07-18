import { BookOpen, Dna, Flame, Link2, ShoppingBag } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { number, records, text } from "../../shared/lib/data.ts";
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
  const items = records(query.data?.items);
  const [selectedId, setSelectedId] = useState("");
  const [imageReady, setImageReady] = useState(false);
  const effectiveId = items.some((item) => item.template_id === selectedId)
    ? selectedId
    : text(items[0]?.template_id, "");
  const item = items.find((candidate) => candidate.template_id === effectiveId);
  const action = (
    id: "inventory.evolve" | "inventory.decompose",
    input: Record<string, unknown>,
    label: string,
  ) =>
    void run(label, async () => {
      const response = await apiRequest(id, input, {
        idempotencyKey: newIdempotencyKey(),
      });
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
                  alt={text(item.name)}
                  onAvailability={setImageReady}
                />
              </div>
              <div className="detail-copy">
                <Badge>
                  {text(item.rarity)} · 第 {text(item.stage)} 阶
                </Badge>
                <h2>{text(item.name)}</h2>
                <p>战斗力 {text(item.combat_power)}</p>
                <div className="stock-grid">
                  <span>
                    总数<strong>{text(item.total)}</strong>
                  </span>
                  <span>
                    可用<strong>{text(item.available)}</strong>
                  </span>
                  <span>
                    出售中<strong>{text(item.listed)}</strong>
                  </span>
                  <span>
                    远征中<strong>{text(item.expedition)}</strong>
                  </span>
                  <span>
                    Mint 中<strong>{text(item.minting)}</strong>
                  </span>
                </div>
              </div>
            </Card>
            <div className="action-grid">
              <Button
                disabled={
                  blocked ||
                  !imageReady ||
                  number(item.available) < 3 ||
                  number(item.stage) >= 3
                }
                onClick={() =>
                  action(
                    "inventory.evolve",
                    { template_id: item.template_id },
                    "正在确认进化结果",
                  )
                }
              >
                <Dna />
                进化
              </Button>
              <Button
                disabled={blocked || !imageReady || number(item.available) < 1}
                onClick={() =>
                  action(
                    "inventory.decompose",
                    { template_id: item.template_id, quantity: 1 },
                    "正在确认分解结果",
                  )
                }
              >
                <Flame />
                分解
              </Button>
              <Button
                disabled={blocked || !imageReady || number(item.available) < 1}
                onClick={() =>
                  navigate(
                    `/market?sell=${encodeURIComponent(text(item.template_id))}`,
                  )
                }
              >
                <ShoppingBag />
                出售
              </Button>
              <Button
                disabled={blocked || !imageReady || number(item.available) < 1}
                onClick={() =>
                  navigate(
                    `/mint/${encodeURIComponent(text(item.template_id))}`,
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
                  key={text(candidate.template_id)}
                  className={
                    candidate.template_id === effectiveId ? "selected" : ""
                  }
                  onClick={() => {
                    setSelectedId(text(candidate.template_id));
                    setImageReady(false);
                  }}
                >
                  <CatalogImage
                    path={candidate.image_path}
                    alt={text(candidate.name)}
                  />
                  <span>×{text(candidate.total)}</span>
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
