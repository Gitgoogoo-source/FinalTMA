import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { RouteOutput } from "@pokepets/api-contracts/app";

import { Button } from "../../shared/ui/index.tsx";

type WheelResult = RouteOutput<"wheel.spin">;
type WheelReward = WheelResult["rewards"][number];

const rewardVisuals: Record<
  WheelReward["kind"],
  { image: string; name: string }
> = {
  fgems: { image: "/assets/wheel/fgems.webp", name: "Fgems" },
  kcoin: { image: "/assets/wheel/kcoin.webp", name: "K-coin" },
  free_normal_box: {
    image: "/assets/wheel/free-normal.webp",
    name: "免费普通",
  },
  free_rare_box: {
    image: "/assets/wheel/free-rare.webp",
    name: "免费稀有",
  },
};

export function WheelResultDialog({
  result,
  busy,
  error,
  onConfirm,
}: {
  operationId: string;
  result: WheelResult;
  busy: boolean;
  error: string | null;
  onConfirm(): void;
}): ReactNode {
  const rewards = [...result.rewards].sort(
    (left, right) => left.order - right.order,
  );
  const single = result.count === 1;
  return (
    <div
      className={`modal wheel-result-modal ${single ? "is-single" : "is-ten"}`}
    >
      <img
        className="wheel-result-gift"
        src="/assets/wheel/gift-box.webp"
        alt=""
        aria-hidden="true"
      />
      <span className="wheel-result-handle" aria-hidden="true" />

      <header className="wheel-result-heading">
        <Sparkles aria-hidden="true" />
        <h2 id="wheel-result-title">奖励到手</h2>
        <Sparkles aria-hidden="true" />
      </header>

      <ol
        className="wheel-result-grid"
        aria-label={`${result.count} 次有序奖励`}
      >
        {rewards.map((reward) => {
          const visual = rewardVisuals[reward.kind];
          return (
            <li
              key={`${reward.order}-${reward.kind}`}
              className={`wheel-reward-card reward-${reward.kind}`}
              aria-label={`第 ${reward.order} 次，${rewardAccessibleLabel(reward)}`}
            >
              <img src={visual.image} alt="" aria-hidden="true" />
              <strong>{rewardDisplayLabel(reward)}</strong>
            </li>
          );
        })}
      </ol>

      {result.milestone.awarded_fgems > 0 ? (
        <div className="wheel-result-bonus" aria-label="额外获得里程碑奖励">
          <img src={rewardVisuals.fgems.image} alt="" aria-hidden="true" />
          <span>额外获得</span>
          <strong>+{result.milestone.awarded_fgems} Fgems</strong>
        </div>
      ) : null}

      {error ? <p className="operation-ack-error">{error}</p> : null}
      <Button
        className="wheel-result-confirm"
        disabled={busy}
        onClick={onConfirm}
      >
        {busy ? "确认中..." : "确认结果"}
      </Button>
    </div>
  );
}

function rewardDisplayLabel(reward: WheelReward): string {
  const visual = rewardVisuals[reward.kind];
  return reward.kind === "free_normal_box" || reward.kind === "free_rare_box"
    ? visual.name
    : `${reward.amount} ${visual.name}`;
}

function rewardAccessibleLabel(reward: WheelReward): string {
  if (reward.kind === "free_normal_box") {
    return `免费普通盲盒资格 ${reward.amount} 次`;
  }
  if (reward.kind === "free_rare_box") {
    return `免费稀有盲盒资格 ${reward.amount} 次`;
  }
  return rewardDisplayLabel(reward);
}
