import {
  Coins,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import type { MarketMyListingStats } from "../trade.types";
import { formatKcoinWithUnit } from "../trade.utils";

type ListingStatsPanelProps = {
  isError?: boolean;
  isFetching?: boolean;
  isLoading?: boolean;
  onRetry: () => void;
  stats: MarketMyListingStats;
};

type StatMetric = {
  icon: LucideIcon;
  key: keyof MarketMyListingStats;
  label: string;
  tone: "cyan" | "gold" | "orange";
  value: string;
};

export function ListingStatsPanel({
  isError = false,
  isFetching = false,
  isLoading = false,
  onRetry,
  stats,
}: ListingStatsPanelProps) {
  const metrics: StatMetric[] = [
    {
      icon: ShoppingBag,
      key: "activeListingCount",
      label: "当前挂单数量",
      tone: "cyan",
      value: formatCount(stats.activeListingCount),
    },
    {
      icon: PackageCheck,
      key: "activeItemCount",
      label: "挂单商品数量",
      tone: "cyan",
      value: formatCount(stats.activeItemCount),
    },
    {
      icon: Coins,
      key: "totalListingValueKcoin",
      label: "总价值",
      tone: "gold",
      value: formatKcoinWithUnit(stats.totalListingValueKcoin),
    },
    {
      icon: WalletCards,
      key: "expectedNetAmountKcoin",
      label: "预计到账金额",
      tone: "gold",
      value: formatKcoinWithUnit(stats.expectedNetAmountKcoin),
    },
    {
      icon: TrendingUp,
      key: "sold24hCount",
      label: "24h 成交数量",
      tone: "orange",
      value: formatCount(stats.sold24hCount),
    },
    {
      icon: ReceiptText,
      key: "sold24hValueKcoin",
      label: "24h 成交额",
      tone: "orange",
      value: formatKcoinWithUnit(stats.sold24hValueKcoin),
    },
  ];

  return (
    <section
      aria-busy={isLoading || isFetching}
      aria-label="出售管理统计"
      className="listing-stats-panel"
      data-testid="listing-stats-panel"
    >
      <div className="listing-stats-panel__header">
        <div>
          <span>出售管理</span>
          <strong>报价统计</strong>
        </div>
        <StatsStatus
          isError={isError}
          isFetching={isFetching}
          isLoading={isLoading}
          onRetry={onRetry}
        />
      </div>

      <dl className="listing-stats-panel__grid">
        {metrics.map((metric) => (
          <StatCard
            isLoading={isLoading}
            key={metric.key}
            metric={metric}
          />
        ))}
      </dl>
    </section>
  );
}

function StatsStatus({
  isError,
  isFetching,
  isLoading,
  onRetry,
}: {
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  onRetry: () => void;
}) {
  if (isError) {
    return (
      <button
        className="listing-stats-panel__retry"
        onClick={onRetry}
        type="button"
      >
        <RefreshCw aria-hidden="true" size={14} strokeWidth={2.5} />
        重试
      </button>
    );
  }

  return (
    <span className="listing-stats-panel__status">
      {isLoading || isFetching ? "同步中" : "已更新"}
    </span>
  );
}

function StatCard({
  isLoading,
  metric,
}: {
  isLoading: boolean;
  metric: StatMetric;
}) {
  const Icon = metric.icon;

  return (
    <div className={`listing-stats-card listing-stats-card--${metric.tone}`}>
      <dt>
        <Icon aria-hidden="true" size={16} strokeWidth={2.4} />
        <span>{metric.label}</span>
      </dt>
      <dd>{isLoading ? "读取中" : metric.value}</dd>
    </div>
  );
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return Math.max(Math.trunc(value), 0).toLocaleString("zh-CN");
}
