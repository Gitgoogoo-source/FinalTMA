import {
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type {
  BlindBox,
  BoxRewardPreviewItem,
  BoxRewardsResponse,
} from "../box.types";

type PossibleRewardsSheetProps = {
  open: boolean;
  box: BlindBox | null;
  rewards: BoxRewardPreviewItem[];
  isLoading: boolean;
  isError: boolean;
  poolVersion: number | null;
  pityRule: BoxRewardsResponse["pityRule"];
  generatedAt: string | null;
  errorMessage: string | null;
  onRetry: () => void;
  onClose: () => void;
};

export function PossibleRewardsSheet({
  open,
  box,
  rewards,
  isLoading,
  isError,
  poolVersion,
  pityRule,
  generatedAt,
  errorMessage,
  onRetry,
  onClose,
}: PossibleRewardsSheetProps) {
  if (!open) {
    return null;
  }

  const canShowRewards = !isLoading && !isError && rewards.length > 0;

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
            <span>可能获得</span>
            <h2 id="box-rewards-title">{box?.name ?? "可能获得"}</h2>
            <p>
              {poolVersion ? `当前奖励池 V${poolVersion}` : "当前生效奖励池"}
              {generatedAt ? ` · ${formatGeneratedAt(generatedAt)}` : ""}
            </p>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} strokeWidth={2.5} />
          </button>
        </header>

        <div className="box-rewards-sheet__body" aria-live="polite">
          {!isLoading && !isError ? (
            <RewardSummary
              rewardsCount={rewards.length}
              pityDescription={pityRule?.description ?? null}
            />
          ) : null}
          {isLoading ? (
            <SheetState
              title="奖励池加载中"
              detail="正在读取当前盲盒生效中的奖励池。"
            />
          ) : null}
          {isError ? (
            <SheetState
              tone="error"
              title="奖励池读取失败"
              detail={
                errorMessage ?? "当前盲盒没有可展示的生效奖励池，请稍后重试。"
              }
              onRetry={onRetry}
            />
          ) : null}
          {!isLoading && !isError && rewards.length === 0 ? (
            <SheetState
              title="暂无可展示奖励"
              detail="当前生效奖励池没有可展示的奖励项。"
            />
          ) : null}
          {canShowRewards ? (
            <div className="box-rewards-sheet__list">
              {rewards.map((reward) => (
                <RewardRow reward={reward} key={reward.poolItemId} />
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function RewardSummary({
  rewardsCount,
  pityDescription,
}: {
  rewardsCount: number;
  pityDescription: string | null;
}) {
  return (
    <div className="box-rewards-sheet__summary">
      <span>
        <Sparkles aria-hidden="true" size={14} strokeWidth={2.4} />
        {rewardsCount > 0 ? `${rewardsCount} 个奖励项` : "无奖励项"}
      </span>
      {pityDescription ? (
        <span>
          <ShieldCheck aria-hidden="true" size={14} strokeWidth={2.4} />
          {pityDescription}
        </span>
      ) : null}
    </div>
  );
}

function SheetState({
  title,
  detail,
  tone = "neutral",
  onRetry,
}: {
  title: string;
  detail: string;
  tone?: "neutral" | "error";
  onRetry?: () => void;
}) {
  return (
    <div
      className={`box-rewards-sheet__state box-rewards-sheet__state--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {tone === "error" ? (
        <AlertTriangle aria-hidden="true" size={19} strokeWidth={2.3} />
      ) : null}
      <strong>{title}</strong>
      <span>{detail}</span>
      {onRetry ? (
        <button onClick={onRetry} type="button">
          <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
          重试
        </button>
      ) : null}
    </div>
  );
}

function RewardRow({ reward }: { reward: BoxRewardPreviewItem }) {
  const stockLabel = getStockLabel(reward);
  const soldOut = reward.isLimited && reward.remainingStock === 0;

  return (
    <article
      className={`box-reward-row${soldOut ? " box-reward-row--sold-out" : ""}`}
      aria-label={`${reward.name}，${reward.rarityLabel}，概率 ${reward.displayProbability}`}
    >
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
        <div className="box-reward-row__tags" aria-label="奖励标签">
          {reward.isFeatured ? <RewardTag>精选</RewardTag> : null}
          {reward.isPityEligible ? (
            <RewardTag tone="pity">保底池</RewardTag>
          ) : null}
          {reward.isLimited ? <RewardTag tone="limited">限量</RewardTag> : null}
          {soldOut ? <RewardTag tone="sold">售罄</RewardTag> : null}
        </div>
      </div>
      <div className="box-reward-row__meta">
        <strong>{reward.displayProbability}</strong>
        <span>{stockLabel}</span>
      </div>
    </article>
  );
}

function RewardTag({
  children,
  tone = "neutral",
}: {
  children: string;
  tone?: "neutral" | "pity" | "limited" | "sold";
}) {
  return (
    <span className={`box-reward-tag box-reward-tag--${tone}`}>{children}</span>
  );
}

function getStockLabel(reward: BoxRewardPreviewItem): string {
  if (!reward.isLimited) {
    return "不限量";
  }

  if (reward.remainingStock === null) {
    return "库存同步中";
  }

  if (reward.remainingStock === 0) {
    return "已售罄";
  }

  return `剩余 ${formatCurrencyAmount(reward.remainingStock)}`;
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "刚刚同步";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
