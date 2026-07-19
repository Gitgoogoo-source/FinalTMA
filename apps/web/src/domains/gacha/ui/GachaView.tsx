import { Gift, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { CatalogImage } from "../../catalog/index.ts";
import { useApiQuery } from "../../../platform/query/index.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { useNavigationIntent } from "../../../workflows/navigation-intent-resume/index.ts";

export function GachaView(): ReactNode {
  const boxes = useApiQuery("gacha.bootstrap");
  const identity = useApiQuery("identity.bootstrap");
  const { isBlocked, run } = useOperationRegistry();
  const { requestTopup } = useNavigationIntent();
  const blocked = isBlocked("gacha.open");
  const [params, setParams] = useSearchParams();
  const resumedTier = params.get("resume") ? params.get("tier") : null;
  const resumedCount = params.get("count") === "10" ? 10 : 1;
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const items = boxes.data?.boxes ?? [];
  const pityItems = boxes.data?.pity ?? [];
  const open = (tier: "normal" | "rare" | "legendary", count: 1 | 10) => {
    const box = items.find((candidate) => candidate.tier === tier);
    const free =
      count === 1 &&
      ((tier === "normal" &&
        Number(boxes.data?.entitlements.free_normal_box) > 0) ||
        (tier === "rare" &&
          Number(boxes.data?.entitlements.free_rare_box) > 0));
    const cost = count === 10 ? box?.ten_price : box?.single_price;
    const balance = identity.data?.assets.kcoin.available;
    if (
      !free &&
      cost !== undefined &&
      balance !== undefined &&
      balance < cost
    ) {
      requestTopup({ kind: "gacha", tier, draw_count: count }, cost - balance);
      return;
    }
    void run(count === 10 ? "正在准备十连开盒" : "正在开启盲盒", "gacha.open", {
      tier,
      draw_count: count,
    });
  };
  return (
    <main className="page">
      <header className="hero">
        <span>POKEPETS LAB</span>
        <h1>选择你的盲盒</h1>
        <p>价格、概率、免费资格与最终结果均由服务器确认。</p>
      </header>
      {resumedTier && ["normal", "rare", "legendary"].includes(resumedTier) && (
        <Card className="resume-intent">
          <strong>充值已到账</strong>
          <p>
            已恢复原开盒选择。价格、余额、资格与保底将按当前真实状态重新确认，不会自动开盒。
          </p>
          <Button
            disabled={blocked}
            onClick={() => {
              setParams({});
              open(
                resumedTier as "normal" | "rare" | "legendary",
                resumedCount,
              );
            }}
          >
            重新确认{resumedCount === 10 ? "十连" : "单抽"}
          </Button>
        </Card>
      )}
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
                    保底 {progress?.progress ?? 0} /{" "}
                    {progress?.limit ?? box.pity_limit}
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
