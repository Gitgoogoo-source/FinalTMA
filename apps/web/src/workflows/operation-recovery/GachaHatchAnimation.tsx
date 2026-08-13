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
import { GachaAstralBackdrop } from "./GachaAstralBackdrop.tsx";
import {
  GachaAstralCanvas,
  type GachaRevealRarity,
} from "./GachaAstralCanvas.tsx";

export type { GachaHatchTier } from "./context.ts";
export type { GachaRevealRarity } from "./GachaAstralCanvas.tsx";

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
      className={`gacha-astral-ritual tier-${tier}${revealing ? " is-revealing" : ""}${rarityClass}`}
      aria-label="灵契星轨正在跃迁，抽取结果将在跃迁结束后展示"
    >
      <GachaAstralBackdrop />

      <div className="gacha-ritual-code-stage" aria-hidden="true">
        <GachaAstralCanvas revealing={revealing} rarity={revealRarity} />
        <span className="gacha-ritual-warp-bloom" />
        <span className="gacha-ritual-reveal-meteor" />
        <span className="gacha-ritual-burst-rays" />
        <span className="gacha-ritual-impact-ring" />
        <span className="gacha-ritual-flash" />
        <span className="gacha-ritual-vignette" />
      </div>

      <header className="gacha-astral-ritual-heading" aria-hidden="true">
        <small>灵契跃迁</small>
        <h2>穿越星海</h2>
      </header>

      <p className="gacha-astral-ritual-copy" aria-hidden="true">
        前往未知回响
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
      className="gacha-astral-ritual gacha-astral-image-unavailable"
      aria-labelledby="gacha-image-unavailable-title"
    >
      <GachaAstralBackdrop calm />

      <header className="gacha-astral-ritual-heading">
        <small>灵契跃迁</small>
        <h2 id="gacha-image-unavailable-title">灵契尚未显现</h2>
      </header>

      <div className="gacha-astral-image-unavailable-action">
        <Button disabled={busy} onClick={onRetry}>
          {busy ? "显现中" : "再试一次"}
        </Button>
      </div>
    </section>
  );
}
