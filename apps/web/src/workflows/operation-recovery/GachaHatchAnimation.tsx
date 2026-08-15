import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  playGachaRitualBuildUp,
  playGachaRitualReveal,
} from "../../platform/audio/gachaRitualAudio.ts";
import {
  impactHaptic,
  selectionHaptic,
} from "../../platform/telegram/index.ts";
import { isLowPowerAnimationDevice } from "../../platform/runtime/devicePerformance.ts";
import { Button } from "../../shared/ui/Button.tsx";
import type { GachaHatchTier } from "./context.ts";
import { GachaAstralBackdrop } from "./GachaAstralBackdrop.tsx";
import {
  GachaAstralCanvas,
  type GachaRevealRarity,
} from "./GachaAstralCanvas.tsx";
import { t } from "../../platform/i18n/index.ts";

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
  const [stageReady, setStageReady] = useState(false);
  const stopBuildUpAudioRef = useRef<(() => void) | null>(null);
  const handleStageReady = useCallback(() => {
    stopBuildUpAudioRef.current?.();
    stopBuildUpAudioRef.current = playGachaRitualBuildUp();
    setStageReady(true);
    onMounted();
  }, [onMounted]);

  useEffect(() => {
    return () => {
      stopBuildUpAudioRef.current?.();
      stopBuildUpAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!stageReady) return;
    const timers = isLowPowerAnimationDevice()
      ? []
      : [500, 2_000, 3_500].map((delay) =>
          window.setTimeout(selectionHaptic, delay),
        );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [stageReady]);

  useEffect(() => {
    if (!revealing || !revealRarity) return;
    const stopAudio = playGachaRitualReveal(revealRarity);
    const hapticsEnabled = !isLowPowerAnimationDevice();
    if (hapticsEnabled) impactHaptic(revealImpact(revealRarity));
    const echo = hapticsEnabled
      ? window.setTimeout(
          () => impactHaptic(revealRarity === "mythic" ? "heavy" : "medium"),
          240,
        )
      : null;
    return () => {
      stopAudio();
      if (echo !== null) window.clearTimeout(echo);
    };
  }, [revealRarity, revealing]);

  const rarityClass = revealRarity ? ` rarity-${revealRarity}` : "";

  return (
    <section
      className={`gacha-astral-ritual tier-${tier}${revealing ? " is-revealing" : ""}${rarityClass}`}
      aria-label={t("灵契黑洞正在汇聚，抽取结果将在金光绽放后展示")}
    >
      <GachaAstralBackdrop />

      <div className="gacha-ritual-code-stage" aria-hidden="true">
        <GachaAstralCanvas
          onReady={handleStageReady}
          revealing={revealing}
          rarity={revealRarity}
        />
        <span className="gacha-ritual-reveal-meteor" />
        <span className="gacha-ritual-burst-rays" />
        <span className="gacha-ritual-impact-ring" />
        <span className="gacha-ritual-flash" />
        <span className="gacha-ritual-vignette" />
      </div>

      <header className="gacha-astral-ritual-heading" aria-hidden="true">
        <small>{t("月下灵契")}</small>
        <h2>{t("灵光正在回应")}</h2>
      </header>

      <p className="gacha-astral-ritual-copy" aria-hidden="true">
        {t("静候灵契显现")}
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
        <small>{t("月下灵契")}</small>
        <h2 id="gacha-image-unavailable-title">{t("灵契尚未显现")}</h2>
      </header>

      <div className="gacha-astral-image-unavailable-action">
        <Button disabled={busy} onClick={onRetry}>
          {busy ? t("显现中") : t("再试一次")}
        </Button>
      </div>
    </section>
  );
}
