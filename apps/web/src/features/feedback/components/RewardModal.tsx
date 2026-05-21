import { Coins, Gem, Gift, Star, X } from "lucide-react";

import type { RewardModalItem, RewardModalState } from "../feedback.types";

type RewardModalProps = {
  modal: RewardModalState;
  onClose: () => void;
};

export function RewardModal({ modal, onClose }: RewardModalProps) {
  if (!modal.open) {
    return null;
  }

  return (
    <div className="reward-modal" role="presentation">
      <button
        aria-label="关闭奖励结果"
        className="reward-modal__backdrop"
        onClick={onClose}
        type="button"
      />
      <section
        aria-labelledby="reward-modal-title"
        aria-modal="true"
        className="reward-modal__panel"
        role="dialog"
      >
        <header className="reward-modal__header">
          <div>
            <span>奖励结果</span>
            <h2 id="reward-modal-title">{modal.title}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="reward-modal__body">
          {modal.message ? <p>{modal.message}</p> : null}
          <div className="reward-modal__rewards">
            {modal.rewards.map((reward, index) => (
              <RewardRow
                key={reward.id ?? `${reward.label}-${index}`}
                reward={reward}
              />
            ))}
          </div>
          <button
            className="reward-modal__confirm"
            onClick={onClose}
            type="button"
          >
            {modal.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function RewardRow({ reward }: { reward: RewardModalItem }) {
  return (
    <article className="reward-modal__reward">
      <RewardVisual reward={reward} />
      <div>
        <strong>{reward.label}</strong>
        {reward.detail ? <span>{reward.detail}</span> : null}
      </div>
      {reward.amount !== undefined ? <em>{reward.amount}</em> : null}
    </article>
  );
}

function RewardVisual({ reward }: { reward: RewardModalItem }) {
  if (reward.imageUrl) {
    return <img src={reward.imageUrl} alt="" />;
  }

  const tone = reward.tone ?? "item";
  const Icon =
    tone === "kcoin"
      ? Coins
      : tone === "fgems"
        ? Gem
        : tone === "stars"
          ? Star
          : Gift;

  return (
    <span className={`reward-modal__icon reward-modal__icon--${tone}`}>
      <Icon aria-hidden="true" size={20} strokeWidth={2.4} />
    </span>
  );
}
