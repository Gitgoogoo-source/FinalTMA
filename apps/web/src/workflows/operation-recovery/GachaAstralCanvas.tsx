import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";

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
const GACHA_SETTLE_FRAME_LIMIT = 6;
const GACHA_SETTLE_HEALTHY_FRAME_MS = 50;

export function GachaAstralCanvas({
  onReady,
  revealing,
  rarity,
}: {
  onReady(): void;
  revealing: boolean;
  rarity: GachaRevealRarity | null;
}): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<AstralTimeline | null>(null);
  const notifyReady = useEffectEvent(onReady);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const lease = claimGachaAstralField();
    const { canvas, reducedMotion, renderer } = lease;
    canvas.dataset.astralStage = "warming";
    host.replaceChildren(canvas);
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
    renderer.finishWarmup();

    const startBuild = () => {
      buildStartedAt = performance.now();
      canvas.dataset.astralStage = "ready";
      draw(buildStartedAt + (reducedMotion ? GACHA_BUILD_DURATION_MS : 0));
      schedule();
      notifyReady();
    };

    if (reducedMotion) {
      startBuild();
    } else {
      let settleFrameCount = 0;
      let consecutiveHealthyFrames = 0;
      let previousSettleAt = performance.now();
      const settleCompositor = (now: number) => {
        animationFrame = null;
        if (disposed) return;
        const interval = now - previousSettleAt;
        previousSettleAt = now;
        settleFrameCount += 1;
        consecutiveHealthyFrames =
          interval <= GACHA_SETTLE_HEALTHY_FRAME_MS
            ? consecutiveHealthyFrames + 1
            : 0;
        draw(buildStartedAt);
        if (
          (settleFrameCount >= 3 && consecutiveHealthyFrames >= 2) ||
          settleFrameCount >= GACHA_SETTLE_FRAME_LIMIT
        ) {
          startBuild();
          return;
        }
        animationFrame = window.requestAnimationFrame(settleCompositor);
      };
      animationFrame = window.requestAnimationFrame(settleCompositor);
    }

    return () => {
      disposed = true;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", handleResize);
      delete canvas.dataset.astralStage;
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
