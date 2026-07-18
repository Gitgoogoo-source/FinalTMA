import { Gift, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { records, text } from "../../shared/lib/data.ts";
import {
  Badge,
  Button,
  Card,
  CatalogImage,
  PageState,
} from "../../shared/ui/index.tsx";

export function GachaPage(): ReactNode {
  const boxes = useApiQuery("boxes.list");
  const pity = useApiQuery("boxes.pity");
  const { blocked, run } = useOperation();
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const items = records(boxes.data?.boxes);
  const pityItems = records(pity.data?.pity);
  const open = (box: Record<string, unknown>, count: 1 | 10) =>
    void run(count === 10 ? "正在准备十连开盒" : "正在开启盲盒", async () => {
      const response = await apiRequest(
        "boxes.create_open_order",
        { box_tier: box.tier, draw_count: count },
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
        loading={boxes.isLoading || pity.isLoading}
        error={(boxes.error ?? pity.error) as Error | null}
        onRetry={() => {
          void boxes.refetch();
          void pity.refetch();
        }}
        empty={items.length === 0}
      >
        <div className="box-grid">
          {items.map((box) => {
            const tier = text(box.tier);
            const progress = pityItems.find((item) => item.tier === tier);
            return (
              <Card key={tier} className={`box-card ${tier}`}>
                <Badge>{text(box.display_name)}</Badge>
                <CatalogImage
                  path={box.image_path}
                  alt={text(box.display_name)}
                  onAvailability={(available) =>
                    setReady((state) =>
                      state[tier] === available
                        ? state
                        : { ...state, [tier]: available },
                    )
                  }
                />
                <div className="price-row">
                  <strong>{text(box.single_price)} K</strong>
                  <span>十连 {text(box.ten_price)} K</span>
                </div>
                <div className="pity">
                  <ShieldCheck size={16} />
                  <span>
                    保底 {text(progress?.progress, "0")} /{" "}
                    {text(progress?.limit)}
                  </span>
                </div>
                <div className="button-row">
                  <Button
                    disabled={blocked || ready[tier] !== true}
                    onClick={() => open(box, 1)}
                  >
                    <Gift size={17} />
                    开启 1 次
                  </Button>
                  <Button
                    className="secondary"
                    disabled={blocked || ready[tier] !== true}
                    onClick={() => open(box, 10)}
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
