import { Gift, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";

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

export function GachaPage(): ReactNode {
  const boxes = useApiQuery("gacha.bootstrap");
  const { blocked, run } = useOperation();
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const items = boxes.data?.boxes ?? [];
  const pityItems = boxes.data?.pity ?? [];
  const open = (tier: "normal" | "rare" | "legendary", count: 1 | 10) =>
    void run(count === 10 ? "正在准备十连开盒" : "正在开启盲盒", async () => {
      const response = await apiRequest(
        "gacha.open",
        { tier, draw_count: count },
        { idempotencyKey: newIdempotencyKey() },
      );
      return { data: response.data, operationId: response.operationId };
    });
  return (
    <main className="page">
      <header className="hero">
        <span>POKEPETS LAB</span>
        <h1>选择你的盲盒</h1>
        <p>价格、概率、免费资格与最终结果均由服务器确认。</p>
      </header>
      <PageState
        loading={boxes.isLoading}
        error={boxes.error as Error | null}
        onRetry={() => void boxes.refetch()}
        empty={items.length === 0}
      >
        <div className="box-grid">
          {items.map((box) => {
            const tier = box.tier;
            const progress = pityItems.find((item) => item.tier === tier);
            return (
              <Card key={tier} className={`box-card ${tier}`}>
                <Badge>{box.display_name}</Badge>
                <CatalogImage
                  path={box.image_path}
                  alt={box.display_name}
                  onAvailability={(available) =>
                    setReady((state) =>
                      state[tier] === available
                        ? state
                        : { ...state, [tier]: available },
                    )
                  }
                />
                <div className="price-row">
                  <strong>{box.single_price} K</strong>
                  <span>十连 {box.ten_price} K</span>
                </div>
                <div className="pity">
                  <ShieldCheck size={16} />
                  <span>
                    保底 {progress?.progress ?? 0} / {progress?.limit ?? box.pity_limit}
                  </span>
                </div>
                <div className="button-row">
                  <Button
                    disabled={blocked || ready[tier] !== true}
                    onClick={() => open(tier, 1)}
                  >
                    <Gift size={17} />
                    开启 1 次
                  </Button>
                  <Button
                    className="secondary"
                    disabled={blocked || ready[tier] !== true}
                    onClick={() => open(tier, 10)}
                  >
                    <Sparkles size={17} />
                    开启 10 次
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </PageState>
    </main>
  );
}
