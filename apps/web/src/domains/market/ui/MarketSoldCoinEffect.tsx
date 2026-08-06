import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

import type { MarketSoldCoinBurst } from "./marketSoldCoinEffect.ts";
import "./market-sold-coin-effect.css";

const KCOIN_IMAGE_PATH = "/assets/wheel/kcoin.webp";

const COIN_ROTATIONS = [-16, 12, -7, 19, -11, 8, -20, 15, -5, 18, -13, 6];
const COIN_SCALES = [
  0.92, 1.08, 0.98, 1.12, 0.94, 1.04, 1.1, 0.96, 1.06, 0.9, 1.02, 1.08,
];

type CoinStyle = CSSProperties & {
  "--market-coin-scatter-x": string;
  "--market-coin-scatter-y": string;
  "--market-coin-target-x": string;
  "--market-coin-target-y": string;
  "--market-coin-rotation": string;
  "--market-coin-scale": string;
};

export function MarketSoldCoinEffect({
  bursts,
}: {
  bursts: readonly MarketSoldCoinBurst[];
}): ReactNode {
  if (bursts.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div className="market-sold-coin-layer" aria-hidden="true">
      {bursts.map((burst) => (
        <div key={burst.id}>
          {burst.spread.map((point, index) => {
            const style: CoinStyle = {
              left: burst.source.x,
              top: burst.source.y,
              "--market-coin-scatter-x": `${point.x - burst.source.x}px`,
              "--market-coin-scatter-y": `${point.y - burst.source.y}px`,
              "--market-coin-target-x": `${burst.target.x - burst.source.x}px`,
              "--market-coin-target-y": `${burst.target.y - burst.source.y}px`,
              "--market-coin-rotation": `${COIN_ROTATIONS[index] ?? 0}deg`,
              "--market-coin-scale": String(COIN_SCALES[index] ?? 1),
            };
            return (
              <span
                key={`${burst.id}:${index}`}
                className="market-sold-coin"
                style={style}
              >
                <img src={KCOIN_IMAGE_PATH} alt="" draggable={false} />
              </span>
            );
          })}
          <span
            className="market-sold-kcoin-glow"
            style={{ left: burst.target.x, top: burst.target.y }}
          />
        </div>
      ))}
    </div>,
    document.body,
  );
}
