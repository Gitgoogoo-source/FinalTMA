import { useEffect, type ReactNode } from "react";

import { selectionHaptic } from "../../platform/telegram/index.ts";

export type GachaHatchTier = "normal" | "rare" | "legendary";

const RITUAL_CLOSED_BACKGROUND =
  "/assets/gacha/ritual/v1/moonlit-prism-cocoon-96bc44bb.webp";
const RITUAL_OPEN_BACKGROUND =
  "/assets/gacha/ritual/v1/moonlit-prism-garden-b1291c69.webp";

export function GachaHatchAnimation({
  tier,
}: {
  tier: GachaHatchTier;
}): ReactNode {
  useEffect(() => {
    const timers = [520, 1_680, 2_520].map((delay) =>
      window.setTimeout(selectionHaptic, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [tier]);

  return (
    <section
      className={`gacha-moon-ritual tier-${tier}`}
      aria-label="月下灵契仪式正在进行，抽取结果将在仪式结束后展示"
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
