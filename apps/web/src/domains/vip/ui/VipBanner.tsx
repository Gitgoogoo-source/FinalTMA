import { Crown } from "lucide-react";
import type { ReactNode } from "react";

import { useApiQuery } from "../../../platform/query/index.ts";
import { Button, Card } from "../../../shared/ui/index.tsx";

export function VipBanner({ open }: { open(): void }): ReactNode {
  const vip = useApiQuery("vip.get");
  return (
    <Card className="vip-banner">
      <Crown />
      <div>
        <strong>{vip.data?.active ? "VIP 月卡已生效" : "VIP 月卡"}</strong>
        <small>
          {vip.data?.active
            ? `有效期至 ${vip.data.ends_on}`
            : "查看真实价格、有效期与每日权益"}
        </small>
      </div>
      <Button disabled={vip.isLoading} onClick={open}>
        {vip.data?.active ? "查看" : "购买"}
      </Button>
    </Card>
  );
}
