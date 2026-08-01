import { ReceiptText } from "lucide-react";
import type { ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Button, Card } from "../../../shared/ui/index.tsx";

export function VipBanner({ open }: { open(): void }): ReactNode {
  const vip = useApiQuery("vip.get");
  const pending = Boolean(
    vip.data?.pending_order &&
    ["pending", "processing", "paid"].includes(vip.data.pending_order.status),
  );
  const actionLabel = vip.error
    ? "重新加载"
    : pending
      ? "确认中"
      : vip.data?.active
        ? vip.data.can_renew
          ? "续费"
          : "已达续费上限"
        : "购买";
  const actionDetail = vip.isLoading
    ? "正在读取真实权益"
    : vip.error
      ? "月卡状态加载失败"
      : vip.data?.active
        ? `剩余 ${vip.data.remaining_days} 天`
        : `${vip.data?.stars_price ?? "—"} Stars · 30 天`;
  return (
    <Card className="vip-banner vip-market-hero">
      <img
        className="vip-market-art"
        src="/assets/vip/vip-membership-hero-v4.webp"
        alt=""
        aria-hidden="true"
        fetchPriority="high"
      />
      <button
        className="vip-banner-summary"
        aria-label="查看 VIP MONTHLY PASS 详情"
        onClick={open}
      >
        <span className="vip-market-icon">
          <img
            src="/assets/vip/vip-crown-medallion.webp"
            alt=""
            aria-hidden="true"
          />
        </span>
        <span>
          <small>POKEPETS MEMBERSHIP</small>
          <strong>VIP MONTHLY PASS</strong>
        </span>
      </button>
      <div className="vip-market-benefits" aria-label="VIP 月卡权益">
        <div className="vip-market-benefit vip-market-benefit--egg">
          <img src="/assets/vip/vip-rare-egg.webp" alt="" aria-hidden="true" />
          <small>每日免费稀有盲盒</small>
        </div>
        <div className="vip-market-benefit vip-market-benefit--fgems">
          <img
            src="/assets/vip/vip-fgems-crystal.webp"
            alt=""
            aria-hidden="true"
          />
          <small>每日 100 Fgems</small>
        </div>
        <div className="vip-market-benefit vip-market-benefit--rebate">
          <ReceiptText aria-hidden="true" />
          <small>交易手续费返还</small>
        </div>
      </div>
      <div className="vip-market-action">
        <Button
          className="vip-market-buy-button"
          disabled={
            vip.isLoading ||
            pending ||
            Boolean(vip.data?.active && !vip.data.can_renew)
          }
          onClick={vip.error ? () => void vip.refetch() : open}
        >
          <span>
            <b>{actionLabel}</b>
            <small>{actionDetail}</small>
          </span>
        </Button>
      </div>
    </Card>
  );
}
