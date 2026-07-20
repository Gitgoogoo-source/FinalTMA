import { ChevronRight, Gift, ShieldCheck, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";

import { CatalogImage } from "../../../shared/ui/index.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import {
  registerSensitiveStateResetter,
  useSession,
} from "../../../platform/session/store.ts";
import { Badge, Button, Card, PageState } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { useNavigationIntent } from "../../../workflows/payment-recovery/index.ts";
import { GachaPoolDialog } from "./GachaPoolDialog.tsx";

type BoxTier = "normal" | "rare" | "legendary";
type GachaViewState = { selectedTier: BoxTier; scrollY: number };

const viewStates = new Map<string, GachaViewState>();
let viewStateEpoch = 0;
registerSensitiveStateResetter(() => {
  viewStateEpoch += 1;
  viewStates.clear();
});

const rarityLabels = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
} as const;

const pityLoadError = new Error("保底进度加载失败，请重试");

export function GachaView({
  dailyBenefits,
}: {
  dailyBenefits(onFreeRareClaimed: () => void): ReactNode;
}): ReactNode {
  const boxes = useApiQuery("gacha.bootstrap");
  const refetchBoxes = boxes.refetch;
  const identity = useApiQuery("identity.bootstrap");
  const session = useSession();
  const { isBlocked, run } = useOperationRegistry();
  const { requestTopup } = useNavigationIntent();
  const blocked = isBlocked("gacha.open");
  const [params, setParams] = useSearchParams();
  const requestedTier = params.get("tier");
  const resumedTier =
    params.get("resume") && isBoxTier(requestedTier) ? requestedTier : null;
  const resumedCount = params.get("count") === "10" ? 10 : 1;
  const remembered = session ? viewStates.get(session.userId) : undefined;
  const [selectedTier, setSelectedTier] = useState<BoxTier>(() =>
    isBoxTier(requestedTier)
      ? requestedTier
      : (remembered?.selectedTier ?? "normal"),
  );
  const selectedTierRef = useRef(selectedTier);
  const rememberedScrollY = remembered?.scrollY ?? 0;
  const restoreScrollY = useRef(rememberedScrollY);
  const scrollRestored = useRef(rememberedScrollY === 0);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [poolOpen, setPoolOpen] = useState(false);
  const poolTrigger = useRef<HTMLButtonElement>(null);
  const items = boxes.data?.boxes ?? [];
  const pityItems = boxes.data?.pity ?? [];
  const rulesComplete = boxes.data?.rules_complete === true;
  const freeNormalCount = Number(boxes.data?.entitlements.free_normal_box ?? 0);
  const freeRareCount = Number(boxes.data?.entitlements.free_rare_box ?? 0);
  const selectedBox =
    items.find((box) => box.tier === selectedTier) ?? items[0];
  const selectedPity = pityItems.find(
    (item) => item.tier === selectedBox?.tier,
  );
  const validPity =
    selectedPity && selectedPity.progress < selectedPity.limit
      ? selectedPity
      : null;
  const freeSingleCount =
    selectedBox?.tier === "normal"
      ? boxes.data?.entitlements.free_normal_box
      : selectedBox?.tier === "rare"
        ? boxes.data?.entitlements.free_rare_box
        : null;
  const freeSingle =
    freeSingleCount !== null &&
    freeSingleCount !== undefined &&
    freeSingleCount > 0;
  const pityFailed =
    Boolean(boxes.error) || Boolean(selectedPity && !validPity);
  const selectTier = useCallback((tier: BoxTier) => {
    selectedTierRef.current = tier;
    setSelectedTier(tier);
  }, []);
  const handleFreeRareClaimed = useCallback(() => {
    setSelectedTier("rare");
    if (requestedTier) setParams({}, { replace: true });
  }, [requestedTier, setParams]);

  useEffect(() => {
    let active = true;
    void refetchBoxes().then((result) => {
      if (
        active &&
        result.isSuccess &&
        Number(result.data.entitlements.free_rare_box) > 0
      )
        selectTier("rare");
    });
    return () => {
      active = false;
    };
  }, [refetchBoxes, selectTier]);

  useEffect(() => {
    selectedTierRef.current = selectedTier;
  }, [selectedTier]);

  useLayoutEffect(() => {
    if (scrollRestored.current) return;
    window.scrollTo({ top: restoreScrollY.current, left: 0, behavior: "auto" });
    const maxScroll = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    if (restoreScrollY.current <= maxScroll + 1) scrollRestored.current = true;
  }, [boxes.isLoading, selectedBox]);

  useLayoutEffect(() => {
    if (!session) return;
    const epoch = viewStateEpoch;
    const userId = session.userId;
    return () => {
      if (epoch !== viewStateEpoch) return;
      viewStates.set(userId, {
        selectedTier: selectedTierRef.current,
        scrollY: Math.max(0, window.scrollY),
      });
    };
  }, [session]);
  const open = (tier: BoxTier, count: 1 | 10) => {
    if (blocked || !rulesComplete) return;
    selectTier(tier);
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
  const closePool = () => {
    setPoolOpen(false);
    requestAnimationFrame(() => poolTrigger.current?.focus());
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
      {dailyBenefits(handleFreeRareClaimed)}
      {resumedTier && (
        <Card className="resume-intent">
          <strong>充值已到账</strong>
          <p>
            已恢复原开盒选择。价格、余额、资格与保底将按当前真实状态重新确认，不会自动开盒。
          </p>
          <Button
            disabled={blocked || !rulesComplete}
            aria-disabled={blocked || !rulesComplete}
            onClick={() => {
              selectTier(resumedTier);
              setParams({});
              open(resumedTier, resumedCount);
            }}
          >
            重新确认{resumedCount === 10 ? "十连" : "单抽"}
          </Button>
        </Card>
      )}
      <PageState
        loading={boxes.isLoading}
        error={items.length === 0 && boxes.error ? pityLoadError : null}
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
                variant="detail"
                loading="eager"
                fetchPriority="high"
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
                    onClick={() => {
                      setPoolOpen(false);
                      if (!active) {
                        selectTier(box.tier);
                        void boxes.refetch();
                      }
                      if (requestedTier) setParams({}, { replace: true });
                    }}
                  >
                    <span className="tier-art">
                      <CatalogImage
                        path={box.image_path}
                        alt=""
                        variant="thumbnail"
                        loading="lazy"
                      />
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
                <div className="gacha-detail-heading">
                  <Badge>{selectedBox.display_name}</Badge>
                  <button
                    ref={poolTrigger}
                    type="button"
                    className="gacha-pool-trigger"
                    aria-haspopup="dialog"
                    aria-expanded={poolOpen}
                    onClick={() => setPoolOpen(true)}
                  >
                    <span>
                      <strong>可能获得</strong>
                      <small>查看全部正式候选</small>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                </div>
                <span>概率由服务器最终确认</span>
              </div>
              {rulesComplete ? (
                <>
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
                  <div className="pity-capsule" aria-live="polite">
                    <div className="pity-copy">
                      {validPity ? (
                        <>
                          <span className="pity-progress">
                            当前进度：{validPity.progress} / {validPity.limit}
                          </span>
                          <strong className="pity-target">
                            {`再开 ${validPity.limit - validPity.progress} 次，必得${rarityLabels[validPity.target_rarity]}或以上藏品`}
                          </strong>
                        </>
                      ) : !pityFailed ? (
                        <span className="pity-placeholder">保底进度加载中</span>
                      ) : null}
                      {boxes.isFetching ? (
                        <small className="pity-status">刷新中</small>
                      ) : pityFailed ? (
                        <span className="pity-error">
                          保底进度加载失败，请重试
                          <button
                            type="button"
                            onClick={() => void boxes.refetch()}
                          >
                            重试
                          </button>
                        </span>
                      ) : null}
                    </div>
                    <ShieldCheck aria-hidden="true" />
                  </div>
                  <div className="gacha-free-summary">
                    <span>
                      免费普通<strong>{freeNormalCount}</strong>
                    </span>
                    <span>
                      免费稀有<strong>{freeRareCount}</strong>
                    </span>
                  </div>
                </>
              ) : (
                <div className="gacha-rule-failure" role="alert">
                  <strong>开盒规则加载失败，请重新加载</strong>
                  <Button
                    disabled={boxes.isFetching}
                    onClick={() => void boxes.refetch()}
                  >
                    {boxes.isFetching ? "正在重新加载" : "重新加载"}
                  </Button>
                </div>
              )}
            </Card>

            <div className="gacha-actions">
              <Button
                className="single-draw"
                disabled={
                  blocked || !rulesComplete || ready[selectedBox.tier] !== true
                }
                aria-disabled={
                  blocked || !rulesComplete || ready[selectedBox.tier] !== true
                }
                onClick={() => open(selectedBox.tier, 1)}
              >
                {blocked ? (
                  "开盒中"
                ) : (
                  <>
                    <Gift size={17} />
                    <span>
                      {rulesComplete ? "开 1 次" : "加载失败"}
                      {rulesComplete && (
                        <small>
                          {freeSingle
                            ? `免费 · 剩余 ${freeSingleCount} 次`
                            : `${selectedBox.single_price} K-coin`}
                        </small>
                      )}
                    </span>
                  </>
                )}
              </Button>
              <Button
                className="ten-draw"
                disabled={
                  blocked || !rulesComplete || ready[selectedBox.tier] !== true
                }
                aria-disabled={
                  blocked || !rulesComplete || ready[selectedBox.tier] !== true
                }
                onClick={() => open(selectedBox.tier, 10)}
              >
                {blocked ? (
                  "开盒中"
                ) : (
                  <>
                    <Sparkles size={17} />
                    <span>
                      {rulesComplete ? "开 10 次" : "加载失败"}
                      {rulesComplete && (
                        <small>{selectedBox.ten_price} K-coin</small>
                      )}
                    </span>
                  </>
                )}
              </Button>
            </div>
          </section>
        )}
      </PageState>
      {poolOpen && selectedBox && (
        <GachaPoolDialog tier={selectedBox.tier} close={closePool} />
      )}
    </main>
  );
}

function isBoxTier(value: string | null): value is BoxTier {
  return value === "normal" || value === "rare" || value === "legendary";
}
