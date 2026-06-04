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
      <section
        className="box-pity box-pity--empty"
        aria-label={`${box.name} 保底进度`}
      >
        <Gift aria-hidden="true" size={22} strokeWidth={2.4} />
        <div className="box-pity__copy">
          <strong>保底规则待同步</strong>
          <span>当前盲盒暂未返回保底进度</span>
        </div>
      </section>
    );
  }

  const threshold = Math.max(pity.threshold, 0);
  const currentCount = Math.max(pity.currentCount, 0);
  const remainingToGuaranteed = Math.max(pity.remainingToGuaranteed, 0);
  const completed = Math.min(currentCount, threshold);
  const progress = Math.max(
    0,
    Math.min(100, Math.round((completed / Math.max(threshold, 1)) * 100)),
  );
  const targetRarity = formatRarity(pity.targetRarity);
  const headline = getPityHeadline({
    guaranteedNext: pity.guaranteedNext,
    remainingToGuaranteed,
    targetRarity,
  });

  return (
    <section
      className="box-pity"
      aria-label={`${box.name} 保底进度`}
    >
      <div
        className="box-pity__meter"
        style={
          {
            "--box-pity-progress": `${progress}%`,
          } as CSSProperties
        }
      >
        <span>
          {completed}/{threshold}
        </span>
      </div>
      <div className="box-pity__copy">
        <strong>{headline}</strong>
        <span>{targetRarity} 或以上品质的奖励</span>
      </div>
      <span className="box-pity__gift" aria-hidden="true">
        <Gift size={24} strokeWidth={2.4} />
      </span>
    </section>
  );
}

function getPityHeadline(input: {
  guaranteedNext: boolean;
  remainingToGuaranteed: number;
  targetRarity: string;
}): string {
  const { guaranteedNext, remainingToGuaranteed, targetRarity } = input;

  if (guaranteedNext) {
    return `下一次必得${targetRarity}`;
  }

  return `再开 ${remainingToGuaranteed} 次必得${targetRarity}`;
}

function formatRarity(rarity: string): string {
  switch (rarity.toLowerCase()) {
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
