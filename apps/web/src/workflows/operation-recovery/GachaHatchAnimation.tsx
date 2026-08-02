import type { CSSProperties, ReactNode } from "react";

export type GachaHatchTier = "normal" | "rare" | "legendary";

const sparkPositions = [
  [50, 7],
  [76, 16],
  [89, 37],
  [87, 67],
  [72, 87],
  [28, 87],
  [13, 67],
  [11, 37],
  [24, 16],
] as const;

export function GachaHatchAnimation({
  tier,
}: {
  tier: GachaHatchTier;
}): ReactNode {
  return (
    <div
      className={`gacha-hatch-animation tier-${tier}`}
      style={{ "--hatch-duration": "3s" } as CSSProperties}
    >
      <span className="gacha-hatch-halo" aria-hidden="true" />
      <span className="gacha-hatch-rays" aria-hidden="true" />
      <div className="gacha-hatch-sparks" aria-hidden="true">
        {sparkPositions.map(([left, top], index) => (
          <i
            key={`${left}-${top}`}
            style={
              {
                "--spark-left": `${left}%`,
                "--spark-top": `${top}%`,
                "--spark-delay": `${index * 0.035}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <svg
        className="gacha-hatch-sprite"
        viewBox="0 0 160 160"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <ellipse className="pixel-shadow" cx="80" cy="141" rx="45" ry="7" />

        <g className="pixel-monster">
          <path
            className="monster-outline"
            d="M57 65h10V53h8V45h10v8h8v12h10v9h8v39h-8v12H93v8H67v-8H57v-12h-8V74h8z"
          />
          <path
            className="monster-body"
            d="M63 69h10V58h14v11h10v10h8v31h-9v11H64v-11h-9V79h8z"
          />
          <path className="monster-light" d="M63 76h8v-8h9v8h-8v20h-9z" />
          <path className="monster-dark" d="M88 70h9v9h8v31h-9V91h-8z" />
          <path
            className="monster-ear"
            d="M57 65h10V53h8v20H57zM85 53h8v12h10v8H85z"
          />
          <path className="monster-eye" d="M66 82h9v10h-9zM87 82h9v10h-9z" />
          <path
            className="monster-eye-glint"
            d="M67 83h3v3h-3zM88 83h3v3h-3z"
          />
          <path className="monster-mouth" d="M75 101h12v5H75z" />
          <path className="monster-tooth" d="M77 101h3v4h-3zM83 101h3v4h-3z" />
          <path
            className="monster-foot"
            d="M58 121h17v10H54v-6h4zM87 121h17v4h4v6H87z"
          />
        </g>

        <g className="pixel-egg">
          <path
            className="egg-outline"
            d="M64 18h32v6h12v8h8v12h7v14h6v30h-6v15h-8v11h-12v7H57v-7H45v-11h-8V88h-6V58h6V44h7V32h8v-8h12z"
          />
          <path
            className="egg-body"
            d="M65 25h30v6h12v9h8v14h6v36h-6v14h-11v9H56v-9H45V90h-6V56h6V42h8V33h12z"
          />
          <path
            className="egg-highlight"
            d="M58 36h17v7H55v9h-8v23h-5V55h6V43h10z"
          />
          <path
            className="egg-shadow"
            d="M107 42h8v13h6v35h-6v14h-11v9H83v-7h16v-8h8z"
          />
          <path
            className="egg-crack"
            d="M81 48v17l-8 8 9 9-10 9 9 13M82 65l13 6M73 73l-12 4M82 82l13 7"
          />
        </g>

        <g className="pixel-shell-left">
          <path
            className="shell-outline"
            d="M31 89h19l10 8 15-5v44H54v-5H43v-7H35v-12h-4z"
          />
          <path
            className="shell-body"
            d="M38 96h11l10 8 9-4v29H55v-5H45v-8h-7z"
          />
          <path className="shell-shadow" d="M45 116h10v8h13v5H55v-5H45z" />
        </g>
        <g className="pixel-shell-right">
          <path
            className="shell-outline"
            d="M85 92l15 5 10-8h19v23h-4v12h-8v7h-11v5H85z"
          />
          <path
            className="shell-body"
            d="M92 100l9 4 10-8h11v20h-7v8h-10v5H92z"
          />
          <path className="shell-shadow" d="M92 121h13v-5h10v8h-10v5H92z" />
        </g>

        <g className="pixel-fragments">
          <path className="fragment" d="M44 77h10v9H44z" />
          <path className="fragment" d="M106 72h10v10h-10z" />
          <path className="fragment" d="M72 55h8v8h-8z" />
          <path className="fragment" d="M91 57h7v7h-7z" />
        </g>
      </svg>
    </div>
  );
}
