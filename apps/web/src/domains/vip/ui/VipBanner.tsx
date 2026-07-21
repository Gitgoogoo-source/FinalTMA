import { Crown, Gift, Gem, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Button, Card } from "../../../shared/ui/index.tsx";

export function VipBanner({ open }: { open(): void }): ReactNode {
  const vip = useApiQuery("vip.get");
  const pending = Boolean(
    vip.data?.pending_order &&
    ["pending", "processing", "paid"].includes(vip.data.pending_order.status),
  );
  return (
    <Card className="vip-banner vip-market-hero">
      <button className="vip-banner-summary" onClick={open}>
        <span className="vip-market-icon">
          <Crown />
        </span>
        <span>
          <small>POKEPETS MEMBERSHIP</small>
          <strong>
            {pending
              ? "VIP 月卡付款确认中"
              : vip.data?.active
                ? "VIP 月卡已生效"
                : vip.data?.ends_on
                  ? "VIP 月卡已过期"
                  : "VIP 月卡"}
          </strong>
          <small>
            {vip.data?.active
              ? `有效期至 ${vip.data.ends_on} · 已续费 ${vip.data.renewals_used}/2`
              : "查看真实价格、有效期与每日权益"}
          </small>
        </span>
      </button>
      <div className="vip-market-benefits" aria-label="VIP 月卡权益">
        <span>
          <Gem />
          每日 100 Fgems
        </span>
        <span>
          <Gift />
          每日免费稀有盲盒
        </span>
        <span>
          <ReceiptText />
          交易手续费返还
        </span>
      </div>
      <div className="vip-market-action">
        <span>
          {vip.isLoading
            ? "正在读取真实权益"
            : vip.error
              ? "月卡状态加载失败"
              : vip.data?.active
                ? `剩余 ${vip.data.remaining_days} 天`
                : `${vip.data?.stars_price ?? "—"} Stars · 30 天`}
        </span>
        <Button
          disabled={
            vip.isLoading ||
            pending ||
            Boolean(vip.data?.active && !vip.data.can_renew)
          }
          onClick={vip.error ? () => void vip.refetch() : open}
        >
          {vip.error
            ? "重新加载"
            : pending
              ? "确认中"
              : vip.data?.active
                ? vip.data.can_renew
                  ? "续费"
                  : "已达续费上限"
                : "购买"}
        </Button>
      </div>
    </Card>
  );
}
