import { Coins, HandCoins, Share2, Users } from "lucide-react";

import { formatCurrencyAmount } from "@/shared/lib/formatCurrency";

import type { InviteStats } from "../tasks.types";

type InviteStatsPanelProps = {
  stats: InviteStats | null;
};

export function InviteStatsPanel({ stats }: InviteStatsPanelProps) {
  const cards = [
    {
      icon: Users,
      label: "邀请人数",
      value: stats?.invitedCount ?? 0,
    },
    {
      icon: Share2,
      label: "有效邀请",
      value: stats?.validInviteCount ?? 0,
    },
    {
      icon: Coins,
      label: "邀请奖励",
      value: formatCurrencyAmount(stats?.totalRewardKcoin ?? 0),
      suffix: "KCOIN",
    },
    {
      icon: HandCoins,
      label: "分红收益",
      value: formatCurrencyAmount(stats?.commissionKcoin ?? 0),
      suffix: "KCOIN",
    },
  ];

  return (
    <section className="invite-stats-panel" aria-label="邀请统计">
      {cards.map((card) => {
        const Icon = card.icon;

        return (
          <article className="invite-stat-card" key={card.label}>
            <span>
              <Icon aria-hidden="true" size={15} strokeWidth={2.5} />
              {card.label}
            </span>
            <strong>
              {card.value}
              {card.suffix ? <em>{card.suffix}</em> : null}
            </strong>
          </article>
        );
      })}
    </section>
  );
}
