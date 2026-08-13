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
