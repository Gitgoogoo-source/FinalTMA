import { Gift, Sparkles } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { prepareGachaRitualAudio } from "../../../platform/audio/gachaRitualAudio.ts";
import {
  registerSensitiveStateResetter,
  useSession,
} from "../../../platform/session/store.ts";
import { subscribeFreeRareClaimed } from "../../../shared/events/vipDailyBenefits.ts";
import {
  gachaDisplayProbabilityByTier,
  gachaRarityOrder,
  gachaRarityPresentation,
  type GachaRarity,
} from "../../../shared/assets/gachaRarityPresentation.ts";
import {
  boxArtUrl,
  boxHeroSizes,
  boxHeroSrcSet,
  boxThumbnailSizes,
  boxThumbnailSrcSet,
  fallbackToOriginalBoxArt,
  preloadBoxHeroArt,
  type BoxArtTier,
} from "../../../shared/assets/responsiveArt.ts";
import { Button } from "../../../shared/ui/Button.tsx";
import { Card } from "../../../shared/ui/Card.tsx";
import { PageState } from "../../../shared/ui/PageState.tsx";
import {
  getAppMaxScrollTop,
  getAppScrollTop,
  scrollAppTo,
} from "../../../shared/navigation/appScroll.ts";
import { focusTaskTarget } from "../../../shared/navigation/focusTaskTarget.ts";
import { markFirstScreenReady } from "../../../shared/navigation/firstScreenReadiness.ts";
import {
  usePageActive,
  usePageSearchParams,
} from "../../../shared/navigation/pageActivity.tsx";
import {
  useOperationBlocked,
  useOperationCommands,
} from "../../../workflows/operation-recovery/context.ts";
import { useNavigationIntent } from "../../../workflows/payment-recovery/context.ts";
import { t, tp } from "../../../platform/i18n/index.ts";
type BoxTier = BoxArtTier;
type Rarity = GachaRarity;
type GachaViewState = { selectedTier: BoxTier; scrollY: number };

const viewStates = new Map<string, GachaViewState>();
let viewStateEpoch = 0;
registerSensitiveStateResetter(() => {
  viewStateEpoch += 1;
  viewStates.clear();
});

const pityLoadError = () => new Error(t("保底进度加载失败，请重试"));
const GachaResumeDialog = lazy(() =>
  import("./GachaResumeDialog.tsx").then((module) => ({
    default: module.GachaResumeDialog,
  })),
);

export function GachaView(): ReactNode {
  const boxes = useApiQuery("gacha.bootstrap");
  const identity = useApiQuery("identity.summary");
  const session = useSession();
  const { preload, run } = useOperationCommands();
  const { clearGachaResume, gachaResume, requestTopup } = useNavigationIntent();
  const blocked = useOperationBlocked("gacha.open");
  const pageActive = usePageActive();
  const [params, setParams] = usePageSearchParams();
  const requestedTier = params.get("tier");
  const requestedRarity = params.get("rarity");
  const targetRarity = isRarity(requestedRarity) ? requestedRarity : null;
  const requestedFocus = params.get("focus");
  const requestedResumeOrderId = params.get("resume");
  const resumedCount = params.get("count") === "10" ? 10 : 1;
  const resumedTier =
    requestedResumeOrderId === gachaResume?.orderId &&
    requestedTier === gachaResume.intent.tier &&
    resumedCount === gachaResume.intent.draw_count &&
    isBoxTier(requestedTier)
      ? requestedTier
      : null;
  const remembered = session ? viewStates.get(session.userId) : undefined;
  const [selection, setSelection] = useState<BoxTier>(
    () => remembered?.selectedTier ?? "normal",
  );
  const selectedTier = isBoxTier(requestedTier) ? requestedTier : selection;
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
        ? items.filter(
            (box) => gachaDisplayProbabilityByTier[box.tier][targetRarity] > 0,
          )
        : items,
    [items, targetRarity],
  );
  const pityItems = boxes.data?.pity ?? [];
  const rulesComplete = boxes.data?.rules_complete === true;
  const selectedBox =
    visibleItems.find((box) => box.tier === selectedTier) ??
    visibleItems[0] ??
    items[0];
  const resumedBox = resumedTier
    ? items.find((box) => box.tier === resumedTier)
    : undefined;
  const resumedFreeSingleCount =
    resumedTier === "normal"
      ? boxes.data?.entitlements.free_normal_box
      : resumedTier === "rare"
        ? boxes.data?.entitlements.free_rare_box
        : null;
  const resumedFreeSingle =
    resumedCount === 1 && Number(resumedFreeSingleCount) > 0;
  const resumedCost = resumedBox
    ? resumedCount === 10
      ? resumedBox.ten_price
      : resumedBox.single_price
    : undefined;
  const firstScreenReady =
    pageActive &&
    Boolean(session?.generation) &&
    boxes.data !== undefined &&
    identity.data !== undefined &&
    !boxes.isFetching &&
    !identity.isFetching &&
    rulesComplete &&
    Boolean(selectedBox && ready[selectedBox.tier]);
  const selectedPity = pityItems.find(
    (item) => item.tier === selectedBox?.tier,
  );
  const validPity =
    selectedPity && selectedPity.progress < selectedPity.limit
      ? selectedPity
      : null;
  const previewRarities = selectedBox
    ? gachaRarityOrder.filter(
        (rarity) => gachaDisplayProbabilityByTier[selectedBox.tier][rarity] > 0,
      )
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
      setSelection(tier);
    },
    [setSelection],
  );
  const prepareTier = useCallback(
    (tier: BoxTier) => {
      if (tier !== selectedBox?.tier) preloadBoxHeroArt(tier);
    },
    [selectedBox?.tier],
  );
  const handleFreeRareClaimed = useCallback(() => {
    if (!targetRarity || gachaDisplayProbabilityByTier.rare[targetRarity] > 0)
      selectTier("rare");
    if (requestedTier) setParams({}, { replace: true });
  }, [requestedTier, selectTier, setParams, targetRarity]);

  useEffect(() => {
    if (!pageActive) return;
    return subscribeFreeRareClaimed(handleFreeRareClaimed);
  }, [handleFreeRareClaimed, pageActive]);

  useEffect(() => {
    if (firstScreenReady && session) markFirstScreenReady(session.generation);
  }, [firstScreenReady, session]);

  useEffect(() => {
    if (!firstScreenReady) return;
    preload("gacha.open");
  }, [firstScreenReady, preload]);

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
      void import("./GachaResumeDialog.tsx");
      requestTopup({ kind: "gacha", tier, draw_count: count }, cost - balance);
      return;
    }
    prepareGachaRitualAudio();
    void run(
      count === 10 ? t("正在准备十连开盒") : t("正在开启盲盒"),
      "gacha.open",
      {
        tier,
        draw_count: count,
      },
    );
  };
  return (
    <main className="page gacha-page">
      <header className="page-heading gacha-heading">
        <div>
          <span>EVOMYPET LAB</span>
          <h1>{t("选择你的盲盒")}</h1>
        </div>
        <Sparkles aria-hidden="true" />
      </header>
      {targetRarity && visibleItems.length > 0 && (
        <Card className="gacha-target" role="status">
          <strong>
            {tp("可产出{{0}}的盲盒", [
              gachaRarityPresentation[targetRarity].label,
            ])}
          </strong>
          <p>
            {tp("共 {{0}} 档；下方概率为固定公示，价格与保底按当前规则显示。", [
              visibleItems.length,
            ])}
          </p>
          <Button className="secondary" onClick={() => setParams({})}>
            {t("查看全部盲盒")}
          </Button>
        </Card>
      )}
      {resumedTier && resumedBox && resumedCost !== undefined && (
        <Suspense fallback={null}>
          <GachaResumeDialog
            tier={resumedBox.tier}
            displayName={t(resumedBox.display_name)}
            drawCount={resumedCount}
            cost={resumedCost}
            freeSingle={resumedFreeSingle}
            disabled={blocked || !rulesComplete}
            onPrepare={() => preload("gacha.open")}
            onClose={() => {
              clearGachaResume();
              selectTier(resumedTier);
              setParams({});
            }}
            onConfirm={() => {
              clearGachaResume();
              selectTier(resumedTier);
              setParams({});
              open(resumedTier, resumedCount);
            }}
          />
        </Suspense>
      )}
      <PageState
        loading={boxes.isLoading}
        error={items.length === 0 && boxes.error ? pityLoadError() : null}
        onRetry={() => void boxes.refetch()}
        empty={items.length === 0}
      >
        {selectedBox && (
          <section className="gacha-showcase">
            <div className="gacha-hero">
              <div className={`gacha-stage ${selectedBox.tier}`}>
                <span className="stage-glow" aria-hidden="true" />
                <span key={selectedBox.tier} className="gacha-stage-art active">
                  <img
                    className="catalog-image"
                    src={boxArtUrl(selectedBox.tier, 768)}
                    srcSet={boxHeroSrcSet(selectedBox.tier)}
                    sizes={boxHeroSizes}
                    alt={t(selectedBox.display_name)}
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                    onLoad={(event) => {
                      const image = event.currentTarget;
                      const tier = selectedBox.tier;
                      void image
                        .decode()
                        .then(() =>
                          setReady((state) =>
                            state[tier] === true
                              ? state
                              : { ...state, [tier]: true },
                          ),
                        )
                        .catch(() =>
                          setReady((state) =>
                            state[tier] === false
                              ? state
                              : { ...state, [tier]: false },
                          ),
                        );
                    }}
                    onError={(event) => {
                      if (
                        fallbackToOriginalBoxArt(
                          event.currentTarget,
                          selectedBox.tier,
                        )
                      )
                        return;
                      setReady((state) =>
                        state[selectedBox.tier] === false
                          ? state
                          : { ...state, [selectedBox.tier]: false },
                      );
                    }}
                  />
                </span>
              </div>
            </div>

            <div
              className="gacha-tier-selector"
              role="group"
              aria-label={t("盲盒档次")}
            >
              {visibleItems.map((box) => {
                const active = box.tier === selectedBox.tier;
                return (
                  <button
                    key={box.tier}
                    className={active ? "active" : ""}
                    aria-pressed={active}
                    onPointerEnter={() => prepareTier(box.tier)}
                    onPointerDown={() => prepareTier(box.tier)}
                    onFocus={() => prepareTier(box.tier)}
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
                      <img
                        className="catalog-image"
                        src={boxArtUrl(box.tier, 128)}
                        srcSet={boxThumbnailSrcSet(box.tier)}
                        sizes={boxThumbnailSizes}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(event) =>
                          void fallbackToOriginalBoxArt(
                            event.currentTarget,
                            box.tier,
                          )
                        }
                      />
                    </span>
                    <strong>{t(box.display_name)}</strong>
                    <i aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            <Card className="gacha-details">
              <div className="gacha-reward-preview">
                <div
                  className={`gacha-rarity-previews${selectedBox.tier === "normal" ? " normal-tier" : ""}`}
                  role="list"
                  style={{
                    gridTemplateColumns: `repeat(${previewRarities.length}, minmax(0, 1fr))`,
                  }}
                >
                  {previewRarities.map((rarity) => {
                    const presentation = gachaRarityPresentation[rarity];
                    const probability =
                      gachaDisplayProbabilityByTier[selectedBox.tier][rarity];
                    return (
                      <article
                        key={rarity}
                        role="listitem"
                        aria-label={tp(
                          "{{0}}稀有度代表图，公示总出货概率 {{1}}%",
                          [presentation.label, probability],
                        )}
                      >
                        <span className={`preview-art rarity-${rarity}`}>
                          <img
                            className="gacha-rarity-image"
                            src={presentation.imageSrc}
                            alt={presentation.imageAlt}
                            width={152}
                            height={152}
                            loading="eager"
                            decoding="async"
                          />
                        </span>
                        <strong className={`rarity-${rarity}`}>
                          {presentation.label} {probability}%
                        </strong>
                      </article>
                    );
                  })}
                </div>
              </div>
              <div className="gacha-pity-row">
                {rulesComplete ? (
                  <div className="pity-capsule" aria-live="polite">
                    <span
                      className="pity-ring"
                      aria-label={
                        validPity
                          ? tp("当前进度 {{0}} / {{1}}", [
                              validPity.progress,
                              validPity.limit,
                            ])
                          : t("保底进度暂不可用")
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
                          {tp("还需 {{0}} 次，必得{{1}}", [
                            validPity.limit - validPity.progress,
                            gachaRarityPresentation[validPity.target_rarity]
                              .label,
                          ])}
                        </strong>
                      ) : !pityFailed ? (
                        <span className="pity-placeholder">
                          {t("保底进度加载中")}
                        </span>
                      ) : null}
                      {boxes.isFetching ? (
                        <small className="pity-status">{t("刷新中")}</small>
                      ) : pityFailed ? (
                        <span className="pity-error">
                          {t("保底进度加载失败，请重试")}
                          <button
                            type="button"
                            onClick={() => void boxes.refetch()}
                          >
                            {t("重试")}
                          </button>
                        </span>
                      ) : null}
                    </div>
                    <span className="pity-gift" aria-hidden="true">
                      <Gift />
                    </span>
                  </div>
                ) : (
                  <div className="gacha-rule-failure" role="alert">
                    <strong>{t("开盒规则加载失败，请重新加载")}</strong>
                    <Button
                      disabled={boxes.isFetching}
                      onClick={() => void boxes.refetch()}
                    >
                      {boxes.isFetching ? t("正在重新加载") : t("重新加载")}
                    </Button>
                  </div>
                )}
              </div>
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
                onPointerDown={() => preload("gacha.open")}
                onFocus={() => preload("gacha.open")}
                onClick={() => open(selectedBox.tier, 1)}
              >
                {blocked ? (
                  t("开盒中")
                ) : (
                  <>
                    <span>
                      {rulesComplete ? t("开 1 次") : t("加载失败")}
                      {rulesComplete && (
                        <small>
                          {freeSingle
                            ? tp("免费 · 剩余 {{0}} 次", [freeSingleCount])
                            : `${selectedBox.single_price} Stars`}
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
                onPointerDown={() => preload("gacha.open")}
                onFocus={() => preload("gacha.open")}
                onClick={() => open(selectedBox.tier, 10)}
              >
                <b className="draw-discount">{t("9折")}</b>
                {blocked ? (
                  t("开盒中")
                ) : (
                  <>
                    <span>
                      {rulesComplete ? t("开 10 次") : t("加载失败")}
                      {rulesComplete && (
                        <small>{selectedBox.ten_price} Stars</small>
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
