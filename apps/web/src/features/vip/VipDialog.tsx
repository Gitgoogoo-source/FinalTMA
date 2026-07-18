import { Crown, Gift } from "lucide-react";
import type { ReactNode } from "react";

import { apiRequest, newIdempotencyKey } from "../../platform/api/client.ts";
import { useApiQuery } from "../../platform/query/index.ts";
import { telegram } from "../../platform/telegram/index.ts";
import { useOperation } from "../../shared/feedback/OperationContext.ts";
import { text } from "../../shared/lib/data.ts";
import { Badge, Button } from "../../shared/ui/index.tsx";

export function VipDialog({ close }: { close(): void }): ReactNode {
  const query = useApiQuery("vip.status");
  const { blocked, run } = useOperation();
  const act = (route: string, label: string) =>
    void run(label, async () => {
      const response = await apiRequest(
        route,
        {},
        { idempotencyKey: newIdempotencyKey() },
      );
      if (route === "vip.create_order" && response.data.invoice_url)
        telegram()?.openInvoice(text(response.data.invoice_url, ""));
      return { data: response.data, operationId: response.operationId };
    });
  return (
    <div className="modal-backdrop">
      <div className="modal vip">
        <Crown size={42} />
        <Badge>{query.data?.active ? "VIP 已生效" : "VIP 未生效"}</Badge>
        <h2>PokePets VIP 月卡</h2>
        {query.isLoading ? (
          <p>正在读取真实权益</p>
        ) : query.error ? (
          <Button onClick={() => void query.refetch()}>重新加载</Button>
        ) : (
          <>
            <p>
              {query.data?.active
                ? `有效期至 ${text(query.data?.ends_on)}`
                : "购买价格与有效期将在订单中确认"}
            </p>
            {query.data?.active ? (
              <div className="benefit-actions">
                <Button
                  disabled={blocked || Boolean(query.data?.fgems_claimed_today)}
                  onClick={() =>
                    act("vip.claim_daily", "正在领取 VIP 每日 Fgems")
                  }
                >
                  <Gift />
                  {query.data?.fgems_claimed_today
                    ? "Fgems 已领取"
                    : "领取每日 Fgems"}
                </Button>
                <Button
                  disabled={
                    blocked || Boolean(query.data?.free_box_claimed_today)
                  }
                  onClick={() =>
                    act("vip.claim_free_box", "正在领取 VIP 免费盲盒资格")
                  }
                >
                  <Gift />
                  {query.data?.free_box_claimed_today
                    ? "盲盒资格已领取"
                    : "领取免费盲盒资格"}
                </Button>
              </div>
            ) : (
              <Button
                disabled={blocked}
                onClick={() => act("vip.create_order", "正在创建 VIP 月卡订单")}
              >
                使用 Telegram Stars 购买
              </Button>
            )}
          </>
        )}
        <Button className="secondary" onClick={close}>
          关闭
        </Button>
      </div>
    </div>
  );
}
