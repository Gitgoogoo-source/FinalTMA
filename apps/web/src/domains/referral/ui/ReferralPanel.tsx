import { Copy, Send } from "lucide-react";
import type { ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { telegram } from "../../../platform/telegram/index.ts";
import { Badge, Button, Card } from "../../../shared/ui/index.tsx";
import { useOperationRegistry } from "../../../workflows/operation-recovery/index.ts";

export function ReferralPanel(): ReactNode {
  const query = useApiQuery("referral.get");
  const { isBlocked, run } = useOperationRegistry();
  const blocked = isBlocked("referral.share_event");
  const event = async (name: "copy_link" | "telegram_invite") => {
    const link = query.data?.link ?? "";
    if (name === "copy_link") await navigator.clipboard.writeText(link);
    else
      telegram()?.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(query.data?.share_text ?? "")}`,
      );
    await run(
      name === "copy_link" ? "正在记录复制邀请" : "正在记录 Telegram 邀请",
      "referral.share_event",
      { event: name },
    );
  };
  if (query.isLoading)
    return (
      <Card>
        <p>正在加载邀请数据</p>
      </Card>
    );
  if (query.error)
    return (
      <Card>
        <p>{(query.error as Error).message}</p>
        <Button onClick={() => void query.refetch()}>重新加载</Button>
      </Card>
    );
  return (
    <div className="referral-stack">
      <Card className="invite-card">
        <span>邀请好友一起开盲盒</span>
        <p>好友通过你的链接加入并完成首次有效充值后，你可获得 500 Fgems。</p>
        <p>累计 5 位与 10 位有效充值好友可分别获得免费普通、稀有盲盒资格。</p>
        <strong>{query.data?.referral_code}</strong>
        <code>{query.data?.link}</code>
        <div className="button-row">
          <Button disabled={blocked} onClick={() => void event("copy_link")}>
            <Copy />
            复制链接
          </Button>
          <Button
            className="secondary"
            disabled={blocked}
            onClick={() => void event("telegram_invite")}
          >
            <Send />
            Telegram 邀请
          </Button>
        </div>
      </Card>
      <div className="stats-row">
        <Card>
          <Badge>已绑定好友</Badge>
          <strong>{query.data?.bound_friends ?? 0}</strong>
        </Card>
        <Card>
          <Badge>有效充值好友</Badge>
          <strong>{query.data?.valid_recharge_friends ?? 0}</strong>
        </Card>
        <Card>
          <Badge>累计奖励</Badge>
          <strong>{query.data?.reward_fgems_total ?? 0} Fgems</strong>
        </Card>
      </div>
      <Card className="milestone-summary">
        <h3>奖励名额与阶梯进度</h3>
        <p>
          今日 {query.data?.rewarded_today ?? 0} / 20 · 生命周期{" "}
          {query.data?.rewarded_lifetime ?? 0} / 300
        </p>
        <p>
          5 人普通盲盒：{query.data?.milestone_5_status ?? "pending"} · 10
          人稀有盲盒：{query.data?.milestone_10_status ?? "pending"}
        </p>
      </Card>
    </div>
  );
}
