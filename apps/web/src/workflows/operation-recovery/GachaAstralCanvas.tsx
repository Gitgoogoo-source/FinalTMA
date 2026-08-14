import { useEffect, useRef, type ReactNode } from "react";

import {
  claimGachaAstralField,
  type AstralFieldColor,
} from "./GachaAstralFieldRenderer.ts";

export type GachaRevealRarity =
  | "common"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";

const rarityColors: Record<GachaRevealRarity, AstralFieldColor> = {
  common: [1, 0.992, 0.98],
  rare: [0.11, 0.89, 0.02],
  epic: [0.63, 0.4, 1],
  legendary: [1, 0.29, 0.19],
  mythic: [1, 0.64, 0.18],
};

const neutralGold: AstralFieldColor = [1, 0.72, 0.28];
const GACHA_BUILD_DURATION_MS = 4_000;

export function GachaAstralCanvas({
  revealing,
  rarity,
}: {
  revealing: boolean;
  rarity: GachaRevealRarity | null;
}): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<AstralTimeline | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const lease = claimGachaAstralField();
    const { reducedMotion, renderer, surface } = lease;
    host.replaceChildren(surface);
    surface.classList.remove("is-parked");
    let buildStartedAt = performance.now();
    let revealStartedAt: number | null = null;
    let revealRarity: GachaRevealRarity | null = null;
    let animationFrame: number | null = null;
    let disposed = false;

    const draw = (now: number): boolean => {
      const revealingNow = revealStartedAt !== null && !reducedMotion;
      const buildElapsed = reducedMotion
        ? GACHA_BUILD_DURATION_MS
        : Math.max(0, now - buildStartedAt);
      const revealElapsed = revealingNow
        ? Math.max(0, now - (revealStartedAt ?? now))
        : 0;
      const revealProgress = revealingNow ? clamp(revealElapsed / 700) : 0;
      const buildProgress = revealingNow
        ? 1
        : clamp(buildElapsed / GACHA_BUILD_DURATION_MS);
      renderer.render({
        buildProgress,
        color:
          revealingNow && revealRarity
            ? rarityColors[revealRarity]
            : neutralGold,
        elapsedMs: revealingNow
          ? GACHA_BUILD_DURATION_MS + revealElapsed
          : buildElapsed,
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
    const timeline: AstralTimeline = {
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
    draw(buildStartedAt + (reducedMotion ? GACHA_BUILD_DURATION_MS : 0));
    schedule();

    return () => {
      disposed = true;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      if (timelineRef.current === timeline) timelineRef.current = null;
      lease.release();
    };
  }, []);

  useEffect(() => {
    timelineRef.current?.update(revealing, rarity);
  }, [rarity, revealing]);

  return <div ref={hostRef} className="gacha-astral-field-host" />;
}

type AstralTimeline = {
  update(revealing: boolean, rarity: GachaRevealRarity | null): void;
};

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
