import { Gift, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { CatalogImage } from "../../../shared/ui/index.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { useNavigationIntent } from "../../../workflows/payment-recovery/index.ts";

type BoxTier = "normal" | "rare" | "legendary";

const rarityLabels = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
} as const;

export function GachaView(): ReactNode {
  const boxes = useApiQuery("gacha.bootstrap");
  const identity = useApiQuery("identity.bootstrap");
  const { isBlocked, run } = useOperationRegistry();
  const { requestTopup } = useNavigationIntent();
  const blocked = isBlocked("gacha.open");
  const [params, setParams] = useSearchParams();
  const resumedTier = params.get("resume") ? params.get("tier") : null;
  const resumedCount = params.get("count") === "10" ? 10 : 1;
  const [selectedTier, setSelectedTier] = useState<BoxTier>(() =>
    resumedTier && ["normal", "rare", "legendary"].includes(resumedTier)
      ? (resumedTier as BoxTier)
      : "normal",
  );
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const items = boxes.data?.boxes ?? [];
  const pityItems = boxes.data?.pity ?? [];
  const selectedBox =
    items.find((box) => box.tier === selectedTier) ?? items[0];
  const selectedPity = pityItems.find(
    (item) => item.tier === selectedBox?.tier,
  );
  const freeSingle = Boolean(
    selectedBox &&
    ((selectedBox.tier === "normal" &&
      Number(boxes.data?.entitlements.free_normal_box) > 0) ||
      (selectedBox.tier === "rare" &&
        Number(boxes.data?.entitlements.free_rare_box) > 0)),
  );
  const open = (tier: BoxTier, count: 1 | 10) => {
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
    <main className="page gacha-page">
      <header className="page-heading gacha-heading">
        <div>
          <span>POKEPETS LAB</span>
          <h1>选择你的盲盒</h1>
        </div>
        <Sparkles aria-hidden="true" />
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
        {selectedBox && (
          <section className="gacha-showcase">
            <div className={`gacha-stage ${selectedBox.tier}`}>
              <span className="stage-glow" aria-hidden="true" />
              <CatalogImage
                key={selectedBox.tier}
                path={selectedBox.image_path}
                alt={selectedBox.display_name}
                onAvailability={(available) =>
                  setReady((state) =>
                    state[selectedBox.tier] === available
                      ? state
                      : { ...state, [selectedBox.tier]: available },
                  )
                }
              />
            </div>

            <div
              className="gacha-tier-selector"
              role="group"
              aria-label="盲盒档次"
            >
              {items.map((box) => {
                const active = box.tier === selectedBox.tier;
                return (
                  <button
                    key={box.tier}
                    className={active ? "active" : ""}
                    aria-pressed={active}
                    onClick={() => setSelectedTier(box.tier)}
                  >
                    <span className="tier-art">
                      <CatalogImage path={box.image_path} alt="" />
                    </span>
                    <strong>{box.display_name}</strong>
                    <small>{box.single_price} K-coin</small>
                    <i aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            <Card className="gacha-details">
              <div className="gacha-detail-title">
                <div>
                  <Badge>{selectedBox.display_name}</Badge>
                  <strong>可能获得</strong>
                </div>
                <span>概率由服务器最终确认</span>
              </div>
              <div className="rarity-odds">
                {Object.entries(selectedBox.rarity_weights).map(
                  ([rarity, weight]) =>
                    weight > 0 ? (
                      <span key={rarity} className={`rarity-${rarity}`}>
                        <i />
                        {rarityLabels[rarity as keyof typeof rarityLabels]}
                        <strong>{weight / 100}%</strong>
                      </span>
                    ) : null,
                )}
              </div>
              <div className="pity-capsule">
                <span className="pity-ring">
                  {selectedPity?.progress ?? 0}/
                  {selectedPity?.limit ?? selectedBox.pity_limit}
                </span>
                <span>
                  距离保底还需
                  <strong>
                    {Math.max(
                      0,
                      (selectedPity?.limit ?? selectedBox.pity_limit) -
                        (selectedPity?.progress ?? 0),
                    )}
                  </strong>
                  抽
                </span>
                <ShieldCheck aria-hidden="true" />
              </div>
            </Card>

            <div className="gacha-actions">
              <Button
                className="single-draw"
                disabled={blocked || ready[selectedBox.tier] !== true}
                onClick={() => open(selectedBox.tier, 1)}
              >
                <Gift size={17} />
                <span>
                  开启 1 次
                  <small>
                    {freeSingle
                      ? "使用免费资格"
                      : `${selectedBox.single_price} K-coin`}
                  </small>
                </span>
              </Button>
              <Button
                className="ten-draw"
                disabled={blocked || ready[selectedBox.tier] !== true}
                onClick={() => open(selectedBox.tier, 10)}
              >
                <Sparkles size={17} />
                <span>
                  开启 10 次<small>{selectedBox.ten_price} K-coin</small>
                </span>
              </Button>
            </div>
          </section>
        )}
      </PageState>
    </main>
  );
}
