import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import {
  impactHaptic,
  selectionHaptic,
} from "../../platform/telegram/index.ts";
import { CatalogImage } from "../../shared/ui/index.tsx";
import {
  playGachaOpeningSound,
  playGachaRevealSound,
  stopGachaAudio,
} from "./gacha-audio.ts";

export type GachaHatchTier = "normal" | "rare" | "legendary";

type GachaResult = RouteOutput<"gacha.open">;
type ResultItem = GachaResult["results"][number];
type Rarity = ResultItem["rarity"];
type GachaAnimationPhase =
  | "confirming"
  | "submitting"
  | "pending"
  | "unknown"
  | "succeeded"
  | "failed";

const RITUAL_CLOSED_BACKGROUND =
  "/assets/gacha/ritual/v1/moonlit-prism-cocoon-96bc44bb.webp";
const RITUAL_OPEN_BACKGROUND =
  "/assets/gacha/ritual/v1/moonlit-prism-garden-b1291c69.webp";
const INTRO_DURATION_MS = 1_450;
const REDUCED_MOTION_INTRO_MS = 280;
const TEN_REVEAL_BUDGET_MS = 4_450;
const rarityLabels: Record<Rarity, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  mythic: "神话",
};
const rarityWeights: Record<Rarity, number> = {
  common: 0.84,
  rare: 1,
  epic: 1.18,
  legendary: 1.42,
  mythic: 1.62,
};
const PARTICLE_COUNT = 24;

function orderedResults(result: GachaResult | null): ResultItem[] {
  return result
    ? [...result.results].sort((left, right) => left.order - right.order)
    : [];
}

function revealDurations(results: readonly ResultItem[]): number[] {
  if (results.length === 0) return [];
  if (results.length === 1)
    return [
      1_300 + Math.round((rarityWeights[results[0]!.rarity] - 0.84) * 650),
    ];
  const totalWeight = results.reduce(
    (total, item) => total + rarityWeights[item.rarity],
    0,
  );
  return results.map((item) =>
    Math.round(
      (TEN_REVEAL_BUDGET_MS * rarityWeights[item.rarity]) / totalWeight,
    ),
  );
}

function revealHaptic(rarity: Rarity): void {
  if (rarity === "legendary" || rarity === "mythic") {
    impactHaptic("medium");
    return;
  }
  if (rarity === "epic") {
    impactHaptic("light");
    return;
  }
  selectionHaptic();
}

export function GachaHatchAnimation({
  tier,
  phase,
  result,
  onComplete,
}: {
  tier: GachaHatchTier;
  phase: GachaAnimationPhase;
  result: GachaResult | null;
  onComplete(): void;
}): ReactNode {
  const [reducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [introReady, setIntroReady] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [skipRequested, setSkipRequested] = useState(false);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const results = useMemo(() => orderedResults(result), [result]);
  const durations = useMemo(() => revealDurations(results), [results]);
  const activeItem =
    activeIndex === null ? null : (results[activeIndex] ?? null);
  const activeDuration =
    activeIndex === null ? 0 : (durations[activeIndex] ?? 0);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    stopGachaAudio();
    playGachaOpeningSound();
    const hapticTimers = reducedMotion
      ? []
      : [360, 880, 1_280].map((delay) =>
          window.setTimeout(selectionHaptic, delay),
        );
    const introTimer = window.setTimeout(
      () => setIntroReady(true),
      reducedMotion ? REDUCED_MOTION_INTRO_MS : INTRO_DURATION_MS,
    );
    return () => {
      hapticTimers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(introTimer);
      stopGachaAudio();
    };
  }, [reducedMotion, tier]);

  useEffect(() => {
    let startTimer: number | undefined;
    if (skipRequested && (result || phase === "failed")) {
      finish();
    } else if (introReady) {
      if (phase === "failed") finish();
      else if (result && activeIndex === null) {
        if (reducedMotion) finish();
        else startTimer = window.setTimeout(() => setActiveIndex(0), 0);
      }
    }
    return () => {
      if (startTimer !== undefined) window.clearTimeout(startTimer);
    };
  }, [
    activeIndex,
    finish,
    introReady,
    phase,
    reducedMotion,
    result,
    skipRequested,
  ]);

  useEffect(() => {
    if (!activeItem || activeIndex === null || activeDuration <= 0) return;
    playGachaRevealSound(activeItem.rarity);
    revealHaptic(activeItem.rarity);
    const timer = window.setTimeout(() => {
      if (activeIndex >= results.length - 1) finish();
      else setActiveIndex(activeIndex + 1);
    }, activeDuration);
    return () => window.clearTimeout(timer);
  }, [activeDuration, activeIndex, activeItem, finish, results.length]);

  const skip = () => {
    if (skipRequested) return;
    selectionHaptic();
    setSkipRequested(true);
    if (result || phase === "failed") finish();
  };

  return (
    <section
      className={`gacha-moon-ritual tier-${tier}${activeItem ? " is-revealing" : ""}`}
      aria-label="月下灵契连续召唤演出"
    >
      <img
        className="gacha-moon-ritual-background gacha-moon-ritual-background--closed"
        src={RITUAL_CLOSED_BACKGROUND}
        alt=""
        aria-hidden="true"
      />
      <img
        className="gacha-moon-ritual-background gacha-moon-ritual-background--open"
        src={RITUAL_OPEN_BACKGROUND}
        alt=""
        aria-hidden="true"
      />

      <div className="gacha-ritual-vignette" aria-hidden="true" />
      <div className="gacha-ritual-mist" aria-hidden="true" />
      <div className="gacha-ritual-particles" aria-hidden="true">
        {Array.from({ length: PARTICLE_COUNT }, (_, index) => (
          <i key={index} />
        ))}
      </div>

      <button
        type="button"
        className="gacha-ritual-skip"
        disabled={skipRequested}
        aria-label="跳过召唤动画并查看全部结果"
        onClick={skip}
      >
        {skipRequested ? "即将揭晓" : "跳过"}
      </button>

      {results.length > 0 ? (
        <div className="gacha-reveal-preload" aria-hidden="true">
          {results.map((item) => (
            <CatalogImage
              key={`${item.order}-${item.template_id}`}
              path={item.image_detail_path}
              alt=""
              variant="detail"
              loading="eager"
              fetchPriority="high"
            />
          ))}
        </div>
      ) : null}

      {activeItem && activeIndex !== null ? (
        <article
          key={`${activeItem.order}-${activeItem.template_id}`}
          className={`gacha-reveal-item rarity-${activeItem.rarity}`}
          style={
            { "--reveal-duration": `${activeDuration}ms` } as CSSProperties
          }
          aria-live="polite"
          aria-label={`第 ${activeIndex + 1} 件，共 ${results.length} 件，${rarityLabels[activeItem.rarity]}藏品：${activeItem.name}`}
        >
          <div className="gacha-reveal-progress" aria-hidden="true">
            <span>灵契显现</span>
            <strong>
              {String(activeIndex + 1).padStart(2, "0")}
              <i>/</i>
              {String(results.length).padStart(2, "0")}
            </strong>
          </div>
          <div className="gacha-reveal-aura" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="gacha-reveal-beam" aria-hidden="true" />
          <div className="gacha-reveal-art">
            <CatalogImage
              path={activeItem.image_detail_path}
              alt={activeItem.name}
              variant="detail"
              loading="eager"
              fetchPriority="high"
            />
            <span className="gacha-moon-new">NEW</span>
          </div>
          <strong className="gacha-reveal-rarity">
            {rarityLabels[activeItem.rarity]}
          </strong>
        </article>
      ) : (
        <>
          <header className="gacha-moon-ritual-heading" aria-hidden="true">
            <small>月下灵契</small>
            <h2>灵光正在回应</h2>
          </header>
          <p className="gacha-moon-ritual-copy" aria-hidden="true">
            静候灵契显现
          </p>
        </>
      )}
    </section>
  );
}
