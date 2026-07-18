import { ChevronLeft, Trophy } from "lucide-react";
import { useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { useTelegramBackButton } from "../../platform/telegram/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { Badge, Button, Card, PageState } from "../../shared/ui/index.tsx";

export function AlbumPage(): ReactNode {
  const query = useApiQuery("album.get");
  const catalog = useApiQuery("catalog.get");
  const navigate = useNavigate();
  const back = useCallback(() => navigate(-1), [navigate]);
  useTelegramBackButton(true, back);
  const { blocked, run } = useOperation();
  const chains = query.data?.chains ?? [];
  const templates = catalog.data?.templates ?? [];
  const claim = (chainId: string) =>
    void run("正在领取图鉴奖励", async () => {
      const response = await apiRequest(
        "album.claim",
        { chain_id: chainId },
        { idempotencyKey: newIdempotencyKey() },
      );
      return { data: response.data, operationId: response.operationId };
    });
  return (
    <main className="page fullscreen">
      <header className="page-heading">
        <Button className="icon-only" onClick={back}>
          <ChevronLeft />
        </Button>
        <div>
          <span>ALBUM</span>
          <h1>进化图鉴</h1>
        </div>
        <Badge>
          {query.data?.unlocked_count ?? 0} / {query.data?.total_count ?? 210}
        </Badge>
      </header>
      <PageState
        loading={query.isLoading || catalog.isLoading}
        error={(query.error ?? catalog.error) as Error | null}
        onRetry={() => {
          void query.refetch();
          void catalog.refetch();
        }}
        empty={chains.length === 0}
      >
        <div className="album-list">
          {chains.map((chain) => {
            const nodes = templates.filter(
              (template) => template.chain_id === chain.chain_id,
            );
            const complete = chain.unlocked === 3;
            return (
              <Card key={chain.chain_id}>
                <div className="chain-head">
                  <div>
                    <Badge>{chain.chain_type}</Badge>
                    <h2>{chain.theme}</h2>
                  </div>
                  <span>{chain.unlocked} / 3</span>
                </div>
                <div className="chain-nodes">
                  {nodes.map((node) => (
                    <div
                      key={node.id}
                      className={
                        chain.unlocked >= node.stage
                          ? "unlocked"
                          : "locked"
                      }
                    >
                      <span>{node.stage}</span>
                      <strong>
                        {chain.unlocked >= node.stage
                          ? node.name
                          : "未点亮"}
                      </strong>
                    </div>
                  ))}
                </div>
                <Button
                  disabled={blocked || !complete || Boolean(chain.claimed)}
                  onClick={() => claim(chain.chain_id)}
                >
                  <Trophy />
                  {chain.claimed
                    ? "已领取"
                    : complete
                      ? "领取链奖励"
                      : "尚未完成"}
                </Button>
              </Card>
            );
          })}
        </div>
      </PageState>
    </main>
  );
}
