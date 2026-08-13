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
  const timelineRef = useRef<RitualTimeline | null>(null);

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
    let buildStartedAt = performance.now();
    let revealStartedAt: number | null = null;
    let revealRarity: GachaRevealRarity | null = null;
    let animationFrame: number | null = null;
    let disposed = false;

    const draw = (now: number): boolean => {
      const revealingNow = revealStartedAt !== null && !reducedMotion;
      const buildElapsed = reducedMotion
        ? 3_300
        : Math.max(0, now - buildStartedAt);
      const revealElapsed = revealingNow
        ? Math.max(0, now - (revealStartedAt ?? now))
        : 0;
      const revealProgress = revealingNow ? clamp(revealElapsed / 700) : 0;
      const buildProgress = revealingNow ? 1 : clamp(buildElapsed / 3_300);
      renderer.render({
        buildProgress,
        color:
          revealingNow && revealRarity
            ? rarityColors[revealRarity]
            : neutralGold,
        elapsedMs: revealingNow ? 3_300 + revealElapsed : buildElapsed,
        revealProgress,
      });
      return revealingNow ? revealProgress < 1 : buildProgress < 1;
    };

    const schedule = () => {
      if (disposed || reducedMotion || animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(render);
    };

    const render = (now: number) => {
      animationFrame = null;
      if (draw(now)) schedule();
    };

    const handleResize = () => {
      renderer.resize();
      if (animationFrame === null) draw(performance.now());
    };
    const timeline: RitualTimeline = {
      update(nextRevealing, nextRarity) {
        revealRarity = nextRarity;
        if (reducedMotion) return;
        if (nextRevealing) {
          revealStartedAt ??= performance.now();
        } else if (revealStartedAt !== null) {
          buildStartedAt = performance.now();
          revealStartedAt = null;
          revealRarity = null;
        }
        schedule();
      },
    };
    timelineRef.current = timeline;
    window.addEventListener("resize", handleResize);
    renderer.resize();
    draw(buildStartedAt + (reducedMotion ? 3_300 : 0));
    schedule();

    return () => {
      disposed = true;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      if (timelineRef.current === timeline) timelineRef.current = null;
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    timelineRef.current?.update(revealing, rarity);
  }, [rarity, revealing]);

  return <canvas ref={canvasRef} className="gacha-spirit-field-canvas" />;
}

type RitualTimeline = {
  update(revealing: boolean, rarity: GachaRevealRarity | null): void;
};

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
