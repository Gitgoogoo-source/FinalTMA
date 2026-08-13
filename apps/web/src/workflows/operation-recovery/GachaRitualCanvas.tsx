import { useEffect, useRef, type ReactNode } from "react";

import {
  createGachaSpiritField,
  type SpiritFieldColor,
} from "./GachaSpiritFieldRenderer.ts";

export type GachaRevealRarity =
  | "common"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";

const rarityColors: Record<GachaRevealRarity, SpiritFieldColor> = {
  common: [1, 0.992, 0.98],
  rare: [0.11, 0.89, 0.02],
  epic: [0.63, 0.4, 1],
  legendary: [1, 0.29, 0.19],
  mythic: [1, 0.61, 0],
};

const neutralGold: SpiritFieldColor = [1, 0.72, 0.29];

export function GachaRitualCanvas({
  revealing,
  rarity,
}: {
  revealing: boolean;
  rarity: GachaRevealRarity | null;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
    const renderer = createGachaSpiritField(canvas, {
      lowPower,
      reducedMotion,
    });
    const startedAt = performance.now();
    let animationFrame: number | null = null;

    const render = (now: number) => {
      const elapsed = Math.max(0, now - startedAt);
      const revealProgress = revealing ? clamp(elapsed / 700) : 0;
      const buildProgress = revealing ? 1 : clamp(elapsed / 3_300);
      renderer.resize();
      renderer.render({
        buildProgress,
        color: revealing && rarity ? rarityColors[rarity] : neutralGold,
        elapsedMs: revealing ? 3_300 + elapsed : elapsed,
        revealProgress,
      });

      const animationActive = revealing
        ? revealProgress < 1
        : buildProgress < 1;
      if (!reducedMotion && animationActive)
        animationFrame = window.requestAnimationFrame(render);
    };

    const handleResize = () => render(performance.now());
    window.addEventListener("resize", handleResize);
    render(startedAt + (reducedMotion ? 3_300 : 0));

    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
    };
  }, [rarity, revealing]);

  return <canvas ref={canvasRef} className="gacha-spirit-field-canvas" />;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
