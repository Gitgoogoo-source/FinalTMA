import { Coins, HandCoins, Users } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { InviteStats } from "../tasks.types";

type InviteStatsPanelProps = {
  stats: InviteStats | null;
};

export function InviteStatsPanel({ stats }: InviteStatsPanelProps) {
  const cards = [
    {
      icon: Users,
      label: "已邀请",
      value: stats?.invitedCount ?? 0,
      suffix: "人",
    },
    {
      icon: Coins,
      label: "累计奖励",
      value: formatCurrencyAmount(stats?.totalRewardKcoin ?? 0),
    },
    {
      icon: HandCoins,
      label: "分红收益",
      value: formatCurrencyAmount(stats?.totalCommissionKcoin ?? 0),
    },
  ];

  return (
    <section className="invite-stats-panel" aria-label="邀请统计">
      {cards.map((card) => {
        const Icon = card.icon;

        return (
          <article className="invite-stat-card" key={card.label}>
            <span className="invite-stat-card__icon">
              <Icon aria-hidden="true" size={15} strokeWidth={2.5} />
            </span>
            <div>
              <span className="invite-stat-card__label">{card.label}</span>
              <strong>
                {card.value}
                {card.suffix ? <em>{card.suffix}</em> : null}
              </strong>
            </div>
          </article>
        );
      })}
    </section>
  );
}
