import { Sparkles } from "lucide-react";

import type { BlindBox } from "../box.types";

type BoxHeroProps = {
  box: BlindBox;
};

export function BoxHero({ box }: BoxHeroProps) {
  const imageUrl = box.heroImageUrl ?? box.coverImageUrl;
  const tierTone = getTierTone(box.tier);

  return (
    <section className={`box-hero box-hero--${tierTone}`} aria-label="当前盲盒">
      <div className="box-hero__copy">
        <span className="box-hero__kicker">
          <Sparkles aria-hidden="true" size={15} strokeWidth={2.4} />
          盲盒-蛋
        </span>
        <h1>{box.name}</h1>
        {box.description ? <p>{box.description}</p> : null}
      </div>

      <div
        className="box-hero__stage"
        aria-hidden={imageUrl ? undefined : true}
      >
        <span className="box-hero__shadow" />
        {imageUrl ? (
          <img src={imageUrl} alt={box.name} />
        ) : (
          <span className={`box-hero__egg box-hero__egg--${tierTone}`}>
            <span />
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
