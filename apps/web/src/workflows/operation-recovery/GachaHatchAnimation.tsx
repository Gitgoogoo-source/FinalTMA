import { useState, type CSSProperties, type ReactNode } from "react";

import { telegram } from "../../platform/telegram/index.ts";

export type GachaHatchTier = "normal" | "rare" | "legendary";

const bulbs = Array.from({ length: 12 }, (_, index) => index);
const heatCells = Array.from({ length: 8 }, (_, index) => index);
const confetti = [
  [8, 18, -16],
  [18, 8, 12],
  [31, 14, -8],
  [69, 12, 15],
  [83, 7, -12],
  [92, 21, 9],
  [9, 61, 14],
  [20, 78, -10],
  [80, 76, 12],
  [92, 59, -15],
] as const;

export function GachaHatchAnimation({
  tier,
}: {
  tier: GachaHatchTier;
}): ReactNode {
  const [boost, setBoost] = useState(0);
  const [tapPulse, setTapPulse] = useState(0);
  const turbo = boost === heatCells.length;

  const addHeat = () => {
    setTapPulse((current) => current + 1);
    setBoost((current) => {
      const next = Math.min(current + 1, heatCells.length);
      try {
        telegram()?.HapticFeedback?.impactOccurred(
          next === heatCells.length && current !== next ? "heavy" : "light",
        );
      } catch {
        // Older Telegram clients can expose an unsupported haptic method.
      }
      return next;
    });
  };

  return (
    <button
      type="button"
      className={`gacha-hatch-animation tier-${tier}${turbo ? " is-turbo" : ""}`}
      style={
        {
          "--hatch-duration": "3s",
        } as CSSProperties
      }
      aria-label={`连续点击为像素盲盒机加热，当前 ${boost} 格；加热只增强动画，不影响开盒结果`}
      onClick={addHeat}
    >
      <span className="gacha-arcade-sky" aria-hidden="true" />
      <span className="gacha-arcade-confetti" aria-hidden="true">
        {confetti.map(([left, top, rotate], index) => (
          <i
            key={`${left}-${top}`}
            style={
              {
                "--confetti-left": `${left}%`,
                "--confetti-top": `${top}%`,
                "--confetti-rotate": `${rotate}deg`,
                "--confetti-delay": `${index * -0.025}s`,
              } as CSSProperties
            }
          />
        ))}
      </span>

      <span className="gacha-arcade-machine">
        <span className="gacha-arcade-marquee">
          <span className="gacha-arcade-bulbs" aria-hidden="true">
            {bulbs.map((bulb) => (
              <i key={bulb} />
            ))}
          </span>
          <strong>PIXEL PARTY</strong>
          <small>LUCKY HATCH</small>
        </span>

        <span className="gacha-arcade-screen">
          <span className="gacha-arcade-score">
            <small>HYPE</small>
            <b>{turbo ? "MAX!" : boost ? `×${boost}` : "GO!"}</b>
          </span>
          <span className="gacha-arcade-rays" aria-hidden="true" />
          <span className="gacha-arcade-flash" aria-hidden="true" />
          <svg
            className="gacha-arcade-sprite"
            viewBox="0 0 160 160"
            shapeRendering="crispEdges"
            aria-hidden="true"
          >
            <ellipse
              className="arcade-shadow"
              cx="80"
              cy="139"
              rx="43"
              ry="7"
            />

            <g className="arcade-mystery">
              <path
                className="mystery-outline"
                d="M62 42h36v7h10v10h7v41h-7v11H98v7H62v-7H52v-11h-7V59h7V49h10z"
              />
              <path
                className="mystery-body"
                d="M63 50h34v7h10v43h-9v10H62v-10h-9V57h10z"
              />
              <path
                className="mystery-shine"
                d="M61 58h10v8H61zM55 67h7v20h-7z"
              />
              <path
                className="mystery-mark"
                d="M70 66v-8h22v6h6v15h-6v6h-7v8H74V82h6v-6h7V69H76v5H65v-8zM74 101h12v12H74z"
              />
            </g>

            <g className="arcade-egg">
              <path
                className="egg-outline"
                d="M65 18h30v6h12v8h8v12h7v15h6v30h-6v15h-8v10h-12v7H58v-7H46v-10h-8V89h-6V59h6V44h7V32h8v-8h12z"
              />
              <path
                className="egg-body"
                d="M66 25h28v6h12v9h8v14h6v37h-6v13h-11v9H57v-9H46V91h-6V56h6V42h8V33h12z"
              />
              <path
                className="egg-highlight"
                d="M57 36h18v7H54v10h-7v23h-5V55h6V43h9z"
              />
              <path
                className="egg-shadow"
                d="M106 42h8v14h6v35h-6v13h-11v9H83v-7h15v-8h8z"
              />
              <path className="egg-ticket" d="M43 72h74v18H43z" />
              <path
                className="egg-ticket-light"
                d="M50 77h18v8H50zM76 77h8v8h-8zM92 77h18v8H92z"
              />
              <path
                className="egg-crack"
                d="M81 47v18l-8 8 9 9-10 9 9 14M82 65l13 6M73 73l-13 4M82 82l13 7"
              />
            </g>

            <g className="arcade-shell arcade-shell-left">
              <path
                className="shell-outline"
                d="M32 86h25l18 10v39H54v-5H43v-8H35v-12h-3z"
              />
              <path
                className="shell-body"
                d="M39 94h15l14 8v26H55v-5H46v-8h-7z"
              />
            </g>
            <g className="arcade-shell arcade-shell-right">
              <path
                className="shell-outline"
                d="M85 96l18-10h25v24h-3v12h-8v8h-11v5H85z"
              />
              <path
                className="shell-body"
                d="M92 102l14-8h15v21h-7v8h-9v5H92z"
              />
            </g>

            <g className="arcade-stars">
              <path d="M37 51h7v-8h7v8h8v7h-8v8h-7v-8h-7z" />
              <path d="M108 37h5v-6h6v6h6v6h-6v6h-6v-6h-5z" />
              <path d="M116 103h7v-8h7v8h8v7h-8v8h-7v-8h-7z" />
              <path d="M25 106h5v-6h6v6h6v6h-6v6h-6v-6h-5z" />
            </g>
          </svg>
          <span className="gacha-arcade-scanlines" aria-hidden="true" />
          {tapPulse > 0 ? (
            <span
              key={tapPulse}
              className="gacha-arcade-tap-pop"
              aria-hidden="true"
            >
              +HEAT
            </span>
          ) : null}
        </span>

        <span className="gacha-arcade-console">
          <span className="gacha-arcade-joystick" aria-hidden="true">
            <i />
          </span>
          <span className="gacha-arcade-heat" aria-hidden="true">
            <small>TURBO</small>
            <span>
              {heatCells.map((cell) => (
                <i key={cell} className={cell < boost ? "is-lit" : ""} />
              ))}
            </span>
          </span>
          <span className="gacha-arcade-tap" aria-hidden="true">
            <i />
            <strong>TAP</strong>
          </span>
        </span>
        <span className="gacha-arcade-base" aria-hidden="true" />
      </span>

      <span className="gacha-arcade-instruction">
        <strong>{turbo ? "TURBO MAX!" : "连续点击加热"}</strong>
        <small>只增强演出 · 不影响开盒结果</small>
      </span>
    </button>
  );
}
