import { Gift, Sparkles, Star } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { CatalogImage } from "../../../shared/ui/index.tsx";
import { useApiQuery } from "../../../platform/query/index.ts";
import {
  registerSensitiveStateResetter,
  useSession,
} from "../../../platform/session/store.ts";
import { Button, Card, PageState } from "../../../shared/ui/index.tsx";
import {
  getAppMaxScrollTop,
  getAppScrollTop,
  scrollAppTo,
} from "../../../shared/navigation/appScroll.ts";
import { focusTaskTarget } from "../../../shared/navigation/focusTaskTarget.ts";
import { usePageSearchParams } from "../../../shared/navigation/pageActivity.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";
import { useNavigationIntent } from "../../../workflows/payment-recovery/index.ts";
type BoxTier = "normal" | "rare" | "legendary";
type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";
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
const boxArtPaths: Record<BoxTier, string> = {
  normal: "/assets/boxes/normal.webp",
  rare: "/assets/boxes/rare.webp",
  legendary: "/assets/boxes/legendary.webp",
};
const representativeCollectibles: Record<
  Rarity,
  { name: string; path: string }
> = {
  common: {
    name: "炭尾狐",
    path: "/assets/gacha/representatives/v1/common.webp",
  },
  rare: {
    name: "焰鬃狐",
    path: "/assets/gacha/representatives/v1/rare.webp",
  },
  epic: {
    name: "赤曜火狐",
    path: "/assets/gacha/representatives/v1/epic.webp",
  },
  legendary: {
    name: "九霄冰狐",
    path: "/assets/gacha/representatives/v1/legendary.webp",
  },
  mythic: {
    name: "创界星神龙",
    path: "/assets/gacha/representatives/v1/mythic.webp",
  },
};
const rarityOrder = ["common", "rare", "epic", "legendary", "mythic"] as const;

const pityLoadError = new Error("保底进度加载失败，请重试");

export function GachaView({
  dailyBenefits,
}: {
  dailyBenefits(onFreeRareClaimed: () => void): ReactNode;
}): ReactNode {
  const boxes = useApiQuery("gacha.bootstrap");
  const identity = useApiQuery("identity.bootstrap");
  const session = useSession();
  const { isBlocked, run } = useOperationRegistry();
  const { requestTopup } = useNavigationIntent();
  const blocked = isBlocked("gacha.open");
  const [params, setParams] = usePageSearchParams();
  const requestedTier = params.get("tier");
  const requestedRarity = params.get("rarity");
  const targetRarity = isRarity(requestedRarity) ? requestedRarity : null;
  const requestedFocus = params.get("focus");
  const resumedTier =
    params.get("resume") && isBoxTier(requestedTier) ? requestedTier : null;
  const resumedCount = params.get("count") === "10" ? 10 : 1;
  const remembered = session ? viewStates.get(session.userId) : undefined;
  const rareBox = boxes.data?.boxes.find((box) => box.tier === "rare");
  const autoSelectRare =
    Number(boxes.data?.entitlements.free_rare_box) > 0 &&
    (!targetRarity || (rareBox?.rarity_weights[targetRarity] ?? 0) > 0);
  const [selection, setSelection] = useState(() => ({
    tier: remembered?.selectedTier ?? "normal",
    touched: false,
  }));
  const selectedTier = isBoxTier(requestedTier)
    ? requestedTier
    : !selection.touched && autoSelectRare
      ? "rare"
      : selection.tier;
  const selectedTierRef = useRef(selectedTier);
  const rememberedScrollY = remembered?.scrollY ?? 0;
  const restoreScrollY = useRef(rememberedScrollY);
  const scrollRestored = useRef(rememberedScrollY === 0);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const singleAction = useRef<HTMLButtonElement>(null);
  const tenAction = useRef<HTMLButtonElement>(null);
  const items = useMemo(() => boxes.data?.boxes ?? [], [boxes.data?.boxes]);
  const visibleItems = useMemo(
    () =>
      targetRarity
        ? items.filter((box) => box.rarity_weights[targetRarity] > 0)
        : items,
    [items, targetRarity],
  );
  const pityItems = boxes.data?.pity ?? [];
  const rulesComplete = boxes.data?.rules_complete === true;
  const selectedBox =
    visibleItems.find((box) => box.tier === selectedTier) ??
    visibleItems[0] ??
    items[0];
  const selectedPity = pityItems.find(
    (item) => item.tier === selectedBox?.tier,
  );
  const validPity =
    selectedPity && selectedPity.progress < selectedPity.limit
      ? selectedPity
      : null;
  const previewRarities = selectedBox
    ? rarityOrder.filter((rarity) => selectedBox.rarity_weights[rarity] > 0)
    : [];
  const pityPercent = validPity
    ? Math.min(100, Math.max(0, (validPity.progress / validPity.limit) * 100))
    : 0;
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
  const selectTier = useCallback(
    (tier: BoxTier) => {
      setSelection({ tier, touched: true });
    },
    [setSelection],
  );
  const handleFreeRareClaimed = useCallback(() => {
    if (
      !targetRarity ||
      items.find((box) => box.tier === "rare")?.rarity_weights[targetRarity]
    )
      selectTier("rare");
    if (requestedTier) setParams({}, { replace: true });
  }, [items, requestedTier, selectTier, setParams, targetRarity]);

  useEffect(() => {
    if (selectedBox) selectedTierRef.current = selectedBox.tier;
  }, [selectedBox]);

  useEffect(() => {
    const target =
      requestedFocus === "gacha-single"
        ? singleAction.current
        : requestedFocus === "gacha-ten"
          ? tenAction.current
          : null;
    return target ? focusTaskTarget(target) : undefined;
  }, [ready, requestedFocus, selectedBox?.tier]);

  useLayoutEffect(() => {
    if (scrollRestored.current) return;
    scrollAppTo(restoreScrollY.current);
    if (restoreScrollY.current <= getAppMaxScrollTop() + 1)
      scrollRestored.current = true;
  }, [boxes.isLoading, selectedBox]);

  useLayoutEffect(() => {
    if (!session) return;
    const epoch = viewStateEpoch;
    const userId = session.userId;
    return () => {
      if (epoch !== viewStateEpoch) return;
      viewStates.set(userId, {
        selectedTier: selectedTierRef.current,
        scrollY: getAppScrollTop(),
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
  return (
    <main className="page gacha-page">
      <header className="page-heading gacha-heading">
        <div>
          <span>POKEPETS LAB</span>
          <h1>选择你的盲盒</h1>
        </div>
        <Sparkles aria-hidden="true" />
      </header>
      {targetRarity && visibleItems.length > 0 && (
        <Card className="gacha-target" role="status">
          <strong>可产出{rarityLabels[targetRarity]}的盲盒</strong>
          <p>
            共 {visibleItems.length} 档；下方概率、价格与保底均为当前真实规则。
          </p>
          <Button className="secondary" onClick={() => setParams({})}>
            查看全部盲盒
          </Button>
        </Card>
      )}
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
            <div className="gacha-hero">
              {dailyBenefits(handleFreeRareClaimed)}
              <div className={`gacha-stage ${selectedBox.tier}`}>
                <span className="stage-glow" aria-hidden="true" />
                {items.map((box) => {
                  const active = box.tier === selectedBox.tier;
                  return (
                    <span
                      key={box.tier}
                      className={`gacha-stage-art${active ? " active" : ""}`}
                      aria-hidden={!active}
                    >
                      <CatalogImage
                        path={boxArtPaths[box.tier]}
                        alt={active ? box.display_name : ""}
                        variant="detail"
                        loading="eager"
                        fetchPriority="high"
                        onAvailability={(available) =>
                          setReady((state) =>
                            state[box.tier] === available
                              ? state
                              : { ...state, [box.tier]: available },
                          )
                        }
                      />
                    </span>
                  );
                })}
              </div>
            </div>

            <div
              className="gacha-tier-selector"
              role="group"
              aria-label="盲盒档次"
            >
              {visibleItems.map((box) => {
                const active = box.tier === selectedBox.tier;
                return (
                  <button
                    key={box.tier}
                    className={active ? "active" : ""}
                    aria-pressed={active}
                    onClick={() => {
                      if (!active) selectTier(box.tier);
                      if (requestedTier)
                        setParams(
                          targetRarity ? { rarity: targetRarity } : {},
                          { replace: true },
                        );
                    }}
                  >
                    <span className="tier-art">
                      <CatalogImage
                        path={boxArtPaths[box.tier]}
                        alt=""
                        variant="thumbnail"
                        loading="lazy"
                      />
                    </span>
                    <strong>{box.display_name}</strong>
                    <i aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            <Card className="gacha-details">
              <section className="gacha-reward-preview">
                <header>
                  <strong>
                    <Star aria-hidden="true" />
                    可能获得
                  </strong>
                </header>
                <div
                  className="gacha-rarity-previews"
                  role="list"
                  style={{
                    gridTemplateColumns: `repeat(${previewRarities.length}, minmax(0, 1fr))`,
                  }}
                >
                  {previewRarities.map((rarity) => {
                    const representative = representativeCollectibles[rarity];
                    const probability =
                      selectedBox.rarity_weights[rarity] / 100;
                    return (
                      <article
                        key={rarity}
                        role="listitem"
                        aria-label={`${representative.name}，${rarityLabels[rarity]}代表藏品，稀有度出货概率 ${probability}%`}
                      >
                        <span className={`preview-art rarity-${rarity}`}>
                          <CatalogImage
                            path={representative.path}
                            alt={representative.name}
                            variant="thumbnail"
                            loading="lazy"
                          />
                        </span>
                        <strong className={`rarity-${rarity}`}>
                          {rarityLabels[rarity]} {probability}%
                        </strong>
                      </article>
                    );
                  })}
                </div>
              </section>
              {rulesComplete ? (
                <>
                  <div className="pity-capsule" aria-live="polite">
                    <span
                      className="pity-ring"
                      aria-label={
                        validPity
                          ? `当前进度 ${validPity.progress} / ${validPity.limit}`
                          : "保底进度暂不可用"
                      }
                      style={
                        {
                          "--pity-progress": `${pityPercent}%`,
                        } as CSSProperties
                      }
                    >
                      <i>
                        {validPity
                          ? `${validPity.progress}/${validPity.limit}`
                          : "—"}
                      </i>
                    </span>
                    <div className="pity-copy">
                      {validPity ? (
                        <strong className="pity-target">
                          {`还需 ${validPity.limit - validPity.progress} 次，必得${rarityLabels[validPity.target_rarity]}`}
                        </strong>
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
                    <span className="pity-gift" aria-hidden="true">
                      <Gift />
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
                ref={singleAction}
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
                ref={tenAction}
                className="ten-draw"
                disabled={
                  blocked || !rulesComplete || ready[selectedBox.tier] !== true
                }
                aria-disabled={
                  blocked || !rulesComplete || ready[selectedBox.tier] !== true
                }
                onClick={() => open(selectedBox.tier, 10)}
              >
                <b className="draw-discount">9折</b>
                {blocked ? (
                  "开盒中"
                ) : (
                  <>
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
    </main>
  );
}

function isBoxTier(value: string | null): value is BoxTier {
  return value === "normal" || value === "rare" || value === "legendary";
}

function isRarity(value: string | null): value is Rarity {
  return (
    value === "common" ||
    value === "rare" ||
    value === "epic" ||
    value === "legendary" ||
    value === "mythic"
  );
}
