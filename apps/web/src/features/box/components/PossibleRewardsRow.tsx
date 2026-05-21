import { ChevronRight, Star } from "lucide-react";

import type { BoxRewardPreviewItem } from "../box.types";

type PossibleRewardsRowProps = {
  rewards: BoxRewardPreviewItem[];
  isLoading: boolean;
  onOpen: () => void;
};

export function PossibleRewardsRow({
  rewards,
  isLoading,
  onOpen,
}: PossibleRewardsRowProps) {
  const previewRewards = rewards.slice(0, 5);

  return (
    <section className="box-rewards-row" aria-label="可能获得">
      <div className="box-rewards-row__header">
        <span>
          <Star aria-hidden="true" size={15} strokeWidth={2.4} />
          可能获得
        </span>
        <button onClick={onOpen} type="button">
          查看全部
          <ChevronRight aria-hidden="true" size={15} strokeWidth={2.4} />
        </button>
      </div>

      <button
        className="box-rewards-row__items"
        onClick={onOpen}
        type="button"
        disabled={isLoading}
      >
        {isLoading ? (
          <span className="box-rewards-row__loading">奖励池加载中</span>
        ) : null}
        {!isLoading && previewRewards.length === 0 ? (
          <span className="box-rewards-row__loading">暂无可展示奖励</span>
        ) : null}
        {previewRewards.map((reward) => (
          <span className="box-reward-avatar" key={reward.poolItemId}>
            <RewardImage reward={reward} />
            <small>{reward.rarityLabel}</small>
          </span>
        ))}
      </button>
    </section>
  );
}

function RewardImage({ reward }: { reward: BoxRewardPreviewItem }) {
  if (reward.imageUrl) {
    return <img src={reward.imageUrl} alt={reward.name} />;
  }

  return (
    <span
      className={`box-reward-avatar__fallback box-reward-avatar__fallback--${reward.rarity}`}
      aria-hidden="true"
    >
      {reward.name.slice(0, 1)}
    </span>
  );
}
