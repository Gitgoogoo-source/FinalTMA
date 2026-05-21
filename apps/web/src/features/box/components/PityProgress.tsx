import { CheckCircle2, Gift, Target } from "lucide-react";
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
        <Gift aria-hidden="true" size={18} strokeWidth={2.4} />
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
  const resetAfterHit =
    currentCount === 0 && pity.totalDraws > 0 && !pity.guaranteedNext;

  return (
    <section
      className={`box-pity${resetAfterHit ? " box-pity--reset" : ""}`}
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
        <strong>{getPityHeadline(pity.guaranteedNext, resetAfterHit)}</strong>
        <span>
          目标 {targetRarity} 或以上，累计开盒 {pity.totalDraws} 次
        </span>
        <div className="box-pity__stats" aria-label="保底明细">
          <PityStat label="目标稀有度" value={`${targetRarity}+`} />
          <PityStat label="累计未命中" value={`${currentCount}/${threshold}`} />
          <PityStat
            label="距离保底"
            value={
              pity.guaranteedNext ? "下一抽" : `${remainingToGuaranteed} 次`
            }
          />
        </div>
        {resetAfterHit ? (
          <span className="box-pity__reset">
            <CheckCircle2 aria-hidden="true" size={13} strokeWidth={2.5} />
            抽中目标稀有度后已重置
          </span>
        ) : null}
      </div>
      <Target aria-hidden="true" size={18} strokeWidth={2.4} />
    </section>
  );
}

function PityStat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function getPityHeadline(
  guaranteedNext: boolean,
  resetAfterHit: boolean,
): string {
  if (guaranteedNext) {
    return "下一抽触发保底";
  }

  if (resetAfterHit) {
    return "本轮保底已重置";
  }

  return "保底进度";
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
