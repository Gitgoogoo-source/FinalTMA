import { ChevronRight, Crown, Loader2 } from "lucide-react";

import type { VipPlan } from "../vip.types";

// 展示用价格，真实 Telegram Stars 发票金额以后端配置为准。
const VIP_MONTHLY_DISPLAY_PRICE_XTR = 199;

type VipSubscriptionBannerProps = {
  isVip: boolean;
  currentPeriodEnd: string | null;
  isLoading: boolean;
  isPending: boolean;
  plan: VipPlan | null;
  onSubscribe: () => void;
};

export function VipSubscriptionBanner({
  currentPeriodEnd,
  isLoading,
  isPending,
  isVip,
  onSubscribe,
  plan,
}: VipSubscriptionBannerProps) {
  const disabled = isLoading || isPending;

  return (
    <button
      aria-label={isVip ? "续费 VIP 月卡" : "订阅 VIP 月卡"}
      className="market-banner market-banner--link vip-subscription-banner"
      disabled={disabled}
      onClick={onSubscribe}
      type="button"
    >
      <div className="market-banner__copy">
        <span className="market-banner__kicker">
          <Crown aria-hidden="true" size={15} strokeWidth={2.4} />
          VIP 月卡
        </span>
        <h2>{isVip ? "续费 VIP 月卡" : "订阅 VIP 月卡"}</h2>
        <p>{createVipDescription(plan, isVip, currentPeriodEnd)}</p>
      </div>
      <span className="market-banner__action" aria-hidden="true">
        {isPending ? (
          <Loader2 className="vip-subscription-banner__spinner" size={18} />
        ) : (
          <ChevronRight size={18} strokeWidth={2.5} />
        )}
      </span>
    </button>
  );
}

function createVipDescription(
  plan: VipPlan | null,
  isVip: boolean,
  currentPeriodEnd: string | null,
): string {
  const benefits = [
    plan?.dailyFgems ? `每日 ${plan.dailyFgems} FGEMS` : null,
    plan?.dailyFreeBoxCount
      ? `每日 ${plan.dailyFreeBoxCount} 次免费盲盒`
      : null,
    plan?.feeRebateBps
      ? `手续费返还 ${formatBpsPercent(plan.feeRebateBps)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const price = `${VIP_MONTHLY_DISPLAY_PRICE_XTR} Stars`;
  const duration = plan?.durationDays ? `${plan.durationDays} 天` : "30 天";
  const activeHint =
    isVip && currentPeriodEnd
      ? `已开通至 ${formatDate(currentPeriodEnd)}，可继续续费。`
      : null;

  return [
    `${price} / ${duration}`,
    benefits || "每日福利、交易返还和 VIP 标识",
    activeHint,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatBpsPercent(value: number): string {
  const percent = value / 100;

  if (Number.isInteger(percent)) {
    return `${percent}%`;
  }

  return `${percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
