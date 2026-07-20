import { Crown } from "lucide-react";
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
    <Card className="vip-banner">
      <button className="vip-banner-summary" onClick={open}>
        <Crown />
        <span>
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
    </Card>
  );
}
