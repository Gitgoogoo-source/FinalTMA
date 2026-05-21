import { Gift } from "lucide-react";
import type { CSSProperties } from "react";

import type { BlindBox } from "../box.types";

type PityProgressProps = {
  box: BlindBox;
};

export function PityProgress({ box }: PityProgressProps) {
  const pity = box.pityProgress;

  if (!pity) {
    return (
      <section className="box-pity box-pity--empty" aria-label="保底进度">
        <Gift aria-hidden="true" size={18} strokeWidth={2.4} />
        <span>保底规则待同步</span>
      </section>
    );
  }

  const completed = Math.min(pity.currentCount, pity.threshold);
  const progress = Math.max(
    0,
    Math.min(100, Math.round((completed / Math.max(pity.threshold, 1)) * 100)),
  );

  return (
    <section className="box-pity" aria-label="保底进度">
      <div
        className="box-pity__meter"
        style={
          {
            "--box-pity-progress": `${progress}%`,
          } as CSSProperties
        }
      >
        <span>
          {completed}/{pity.threshold}
        </span>
      </div>
      <div className="box-pity__copy">
        <strong>
          {pity.guaranteedNext
            ? "下一抽触发保底"
            : `再开 ${pity.remainingToGuaranteed} 次保底`}
        </strong>
        <span>{formatRarity(pity.targetRarity)} 或以上品质奖励</span>
      </div>
      <Gift aria-hidden="true" size={18} strokeWidth={2.4} />
    </section>
  );
}

function formatRarity(rarity: string): string {
  switch (rarity) {
    case "common":
      return "普通";
    case "rare":
      return "稀有";
    case "epic":
      return "史诗";
    case "legendary":
      return "传说";
    case "mythic":
      return "神话";
    default:
      return rarity;
  }
}
