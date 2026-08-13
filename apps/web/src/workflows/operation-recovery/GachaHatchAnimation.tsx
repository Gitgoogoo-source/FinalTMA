import { useEffect, type ReactNode } from "react";

import {
  playGachaRitualBuildUp,
  playGachaRitualReveal,
} from "../../platform/audio/gachaRitualAudio.ts";
import {
  impactHaptic,
  selectionHaptic,
} from "../../platform/telegram/index.ts";
import { Button } from "../../shared/ui/Button.tsx";
import type { GachaHatchTier } from "./context.ts";
import {
  GachaRitualCanvas,
  type GachaRevealRarity,
} from "./GachaRitualCanvas.tsx";

export type { GachaHatchTier } from "./context.ts";
export type { GachaRevealRarity } from "./GachaRitualCanvas.tsx";

const RITUAL_BACKGROUND =
  "/assets/gacha/ritual/v1/moonlit-prism-garden-b1291c69.webp";

export function GachaHatchAnimation({
  tier,
  revealRarity,
  revealing,
  onMounted,
}: {
  tier: GachaHatchTier;
  revealRarity: GachaRevealRarity | null;
  revealing: boolean;
  onMounted(): void;
}): ReactNode {
  useEffect(() => {
    onMounted();
    const stopAudio = playGachaRitualBuildUp();
    const timers = [420, 1_420, 2_500].map((delay) =>
      window.setTimeout(selectionHaptic, delay),
    );
    return () => {
      stopAudio();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [onMounted]);

  useEffect(() => {
    if (!revealing || !revealRarity) return;
    const stopAudio = playGachaRitualReveal(revealRarity);
    impactHaptic(revealImpact(revealRarity));
    const echo = window.setTimeout(
      () => impactHaptic(revealRarity === "mythic" ? "heavy" : "medium"),
      240,
    );
    return () => {
      stopAudio();
      window.clearTimeout(echo);
    };
  }, [revealRarity, revealing]);

  const rarityClass = revealRarity ? ` rarity-${revealRarity}` : "";

  return (
    <section
      className={`gacha-moon-ritual tier-${tier}${revealing ? " is-revealing" : ""}${rarityClass}`}
      aria-label="月下灵契仪式正在进行，抽取结果将在仪式结束后展示"
    >
      <img
        className="gacha-moon-ritual-background"
        src={RITUAL_BACKGROUND}
        alt=""
        aria-hidden="true"
      />

      <div className="gacha-ritual-code-stage" aria-hidden="true">
        <GachaRitualCanvas revealing={revealing} rarity={revealRarity} />
        <svg
          className="gacha-ritual-vector"
          viewBox="0 0 430 930"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <linearGradient id="gacha-shell-fill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fffdfa" stopOpacity="0.68" />
              <stop offset="0.54" stopColor="#ffcf80" stopOpacity="0.12" />
              <stop offset="1" stopColor="#fffdfa" stopOpacity="0.5" />
            </linearGradient>
            <radialGradient id="gacha-core-fill">
              <stop offset="0" stopColor="#fffdfa" stopOpacity="0.98" />
              <stop offset="0.35" stopColor="#ffb43d" stopOpacity="0.72" />
              <stop offset="1" stopColor="#ff9c00" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="gacha-cleanplate-fill">
              <stop offset="0" stopColor="#142c39" stopOpacity="0.99" />
              <stop offset="0.72" stopColor="#193642" stopOpacity="0.96" />
              <stop offset="1" stopColor="#193642" stopOpacity="0" />
            </radialGradient>
            <filter
              id="gacha-soft-glow"
              x="-80%"
              y="-80%"
              width="260%"
              height="260%"
            >
              <feGaussianBlur stdDeviation="7" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <ellipse
            className="gacha-ritual-cleanplate"
            cx="215"
            cy="474"
            rx="188"
            ry="248"
            fill="url(#gacha-cleanplate-fill)"
          />

          <g className="gacha-ritual-water-rings">
            <ellipse cx="215" cy="620" rx="58" ry="17" />
            <ellipse cx="215" cy="620" rx="112" ry="31" />
            <ellipse cx="215" cy="620" rx="176" ry="48" />
          </g>

          <g className="gacha-ritual-energy-rings">
            <ellipse cx="215" cy="475" rx="134" ry="44" />
            <ellipse cx="215" cy="475" rx="112" ry="38" />
            <ellipse cx="215" cy="475" rx="92" ry="32" />
          </g>

          <circle
            className="gacha-ritual-core"
            cx="215"
            cy="492"
            r="92"
            fill="url(#gacha-core-fill)"
            filter="url(#gacha-soft-glow)"
          />

          <g className="gacha-ritual-cocoon" filter="url(#gacha-soft-glow)">
            <path
              className="gacha-ritual-shell gacha-ritual-shell--left"
              d="M215 300C154 318 121 398 128 488C135 572 171 629 215 646V300Z"
              fill="url(#gacha-shell-fill)"
            />
            <path
              className="gacha-ritual-shell gacha-ritual-shell--right"
              d="M215 300C276 318 309 398 302 488C295 572 259 629 215 646V300Z"
              fill="url(#gacha-shell-fill)"
            />
            <g className="gacha-ritual-lattice">
              <path d="M155 365L215 338L274 367M135 438L215 398L295 441M132 514L215 468L298 516M148 579L215 536L282 581M174 624L215 590L256 625" />
              <path d="M171 328L154 404L179 480L153 555L191 629M259 328L276 404L251 480L277 555L239 629M215 307V643" />
            </g>
            <g className="gacha-ritual-cracks">
              <path d="M215 327L197 383L220 420L191 474L214 514L187 570" />
              <path d="M215 385L243 418L225 461L260 500L238 548L264 592" />
              <path d="M197 383L168 408M191 474L158 493M243 418L275 433M260 500L289 522" />
            </g>
          </g>

          <g className="gacha-ritual-lightning">
            <path d="M215 376L178 426L199 446L147 511L190 498L165 569" />
            <path d="M229 366L268 414L246 447L296 495L258 490L283 552" />
            <path d="M198 474L142 455L159 489L105 502" />
            <path d="M239 469L290 447L279 486L330 506" />
          </g>
        </svg>
        <span className="gacha-ritual-flash" />
        <span className="gacha-ritual-vignette" />
      </div>

      <header className="gacha-moon-ritual-heading" aria-hidden="true">
        <small>月下灵契</small>
        <h2>灵光正在回应</h2>
      </header>

      <p className="gacha-moon-ritual-copy" aria-hidden="true">
        静候灵契显现
      </p>
    </section>
  );
}

function revealImpact(rarity: GachaRevealRarity): "light" | "medium" | "heavy" {
  if (rarity === "common") return "light";
  if (rarity === "rare" || rarity === "epic") return "medium";
  return "heavy";
}

export function GachaImageUnavailable({
  busy,
  onRetry,
}: {
  busy: boolean;
  onRetry(): void;
}): ReactNode {
  return (
    <section
      className="gacha-moon-ritual gacha-moon-image-unavailable"
      aria-labelledby="gacha-image-unavailable-title"
    >
      <img
        className="gacha-moon-ritual-background gacha-moon-image-unavailable-background"
        src={RITUAL_BACKGROUND}
        alt=""
        aria-hidden="true"
      />

      <header className="gacha-moon-ritual-heading">
        <small>月下灵契</small>
        <h2 id="gacha-image-unavailable-title">灵契尚未显现</h2>
      </header>

      <div className="gacha-moon-image-unavailable-action">
        <Button disabled={busy} onClick={onRetry}>
          {busy ? "显现中" : "再试一次"}
        </Button>
      </div>
    </section>
  );
}
