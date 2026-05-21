import { X } from "lucide-react";

import type { BlindBox, BoxRewardPreviewItem } from "../box.types";

type PossibleRewardsSheetProps = {
  open: boolean;
  box: BlindBox | null;
  rewards: BoxRewardPreviewItem[];
  isLoading: boolean;
  isError: boolean;
  onClose: () => void;
};

export function PossibleRewardsSheet({
  open,
  box,
  rewards,
  isLoading,
  isError,
  onClose,
}: PossibleRewardsSheetProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="box-rewards-sheet" role="presentation">
      <button
        className="box-rewards-sheet__backdrop"
        aria-label="关闭可能获得"
        onClick={onClose}
        type="button"
      />
      <section
        className="box-rewards-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="box-rewards-title"
      >
        <header className="box-rewards-sheet__header">
          <div>
            <span>奖励池</span>
            <h2 id="box-rewards-title">{box?.name ?? "可能获得"}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="box-rewards-sheet__body">
          {isLoading ? (
            <p className="box-rewards-sheet__state">加载中</p>
          ) : null}
          {isError ? (
            <p className="box-rewards-sheet__state">奖励池读取失败</p>
          ) : null}
          {!isLoading && !isError && rewards.length === 0 ? (
            <p className="box-rewards-sheet__state">暂无可展示奖励</p>
          ) : null}
          {rewards.map((reward) => (
            <RewardRow reward={reward} key={reward.poolItemId} />
          ))}
        </div>
      </section>
    </div>
  );
}

function RewardRow({ reward }: { reward: BoxRewardPreviewItem }) {
  return (
    <article className="box-reward-row">
      <div className="box-reward-row__image">
        {reward.imageUrl ? (
          <img src={reward.imageUrl} alt={reward.name} />
        ) : (
          <span
            className={`box-reward-avatar__fallback box-reward-avatar__fallback--${reward.rarity}`}
          >
            {reward.name.slice(0, 1)}
          </span>
        )}
      </div>
      <div className="box-reward-row__copy">
        <strong>{reward.name}</strong>
        <span>
          {reward.rarityLabel}
          {reward.itemTypeLabel ? ` · ${reward.itemTypeLabel}` : ""}
        </span>
      </div>
      <div className="box-reward-row__meta">
        <strong>{reward.displayProbability}</strong>
        <span>{reward.isPityEligible ? "保底池" : "随机池"}</span>
      </div>
    </article>
  );
}
