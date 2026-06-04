import { ChevronLeft } from "lucide-react";

import type { BlindBox } from "../box.types";

type BoxHeroProps = {
  box: BlindBox;
};

export function BoxHero({ box }: BoxHeroProps) {
  const imageUrl = box.heroImageUrl ?? box.coverImageUrl;
  const tierTone = getTierTone(box.tier);

  return (
    <section
      className={`box-hero box-hero--${tierTone}`}
      aria-label={`当前盲盒：${box.name}`}
    >
      <button
        className="box-hero__back"
        type="button"
        aria-label="返回上一页"
        onClick={() => {
          window.history.back();
        }}
      >
        <ChevronLeft aria-hidden="true" size={25} strokeWidth={2.8} />
      </button>

      <div className="box-hero__stage">
        <span className="box-hero__halo" aria-hidden="true" />
        <span className="box-hero__shadow" />
        {imageUrl ? (
          <img src={imageUrl} alt={box.name} />
        ) : (
          <span
            className={`box-hero__egg box-hero__egg--${tierTone}`}
            role="img"
            aria-label={box.name}
          >
            <span className="box-hero__egg-glow" aria-hidden="true" />
            <span className="box-hero__egg-core" aria-hidden="true">
              ?
            </span>
            <span
              className="box-hero__egg-line box-hero__egg-line--a"
              aria-hidden="true"
            />
            <span
              className="box-hero__egg-line box-hero__egg-line--b"
              aria-hidden="true"
            />
            <span
              className="box-hero__egg-line box-hero__egg-line--c"
              aria-hidden="true"
            />
          </span>
        )}
      </div>
    </section>
  );
}

function getTierTone(tier: string): "normal" | "rare" | "legendary" | "event" {
  if (tier === "rare") {
    return "rare";
  }

  if (tier === "legendary") {
    return "legendary";
  }

  if (tier === "event") {
    return "event";
  }

  return "normal";
}
