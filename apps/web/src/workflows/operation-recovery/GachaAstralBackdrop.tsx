import type { ReactNode } from "react";

export function GachaAstralBackdrop({
  calm = false,
}: {
  calm?: boolean;
}): ReactNode {
  return (
    <div
      className={`gacha-astral-backdrop${calm ? " is-calm" : ""}`}
      aria-hidden="true"
    >
      <span className="gacha-astral-nebula gacha-astral-nebula-left" />
      <span className="gacha-astral-nebula gacha-astral-nebula-right" />
      <span className="gacha-astral-stars gacha-astral-stars-far" />
      <span className="gacha-astral-stars gacha-astral-stars-near" />
      <span className="gacha-astral-portal" />
      <span className="gacha-astral-horizon" />
    </div>
  );
}
